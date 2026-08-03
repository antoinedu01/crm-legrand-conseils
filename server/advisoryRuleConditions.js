// Moteur de conditions du DSL de règles — Legrand Diagnostic 360, Lot 4A.
//
// Interpréteur JSON déclaratif fermé, déterministe, sans dépendance externe,
// sans IA, sans SQL dynamique, jamais `eval`/`new Function`. Module SÉPARÉ de
// `server/advisoryConditions.js` (conditions d'affichage de questionnaire,
// Lot 3A/3B, déjà publié et testé) — décision documentée, revue
// `rules-engine-auditor` (GATE LOT 4A) : l'univers référençable diffère
// réellement ici (contrats, résultat d'une autre règle, statut explicite de
// réponse), ce qui aurait rendu une réutilisation directe de
// `evaluateCondition`/`resolveRef`/`compare` incorrecte (leur sémantique —
// statut implicite, coercition `Number()` — ne convient pas au moteur de
// règles). Seuls les principes génériques sans sémantique de domaine propre
// (canonicalisation JSON, détection de cycle) sont partagés — voir
// `server/canonicalJson.js` et `detectRuleCycle` ci-dessous, construit sur le
// même principe de coloration DFS que `advisoryConditions.detectCycle`.
//
// Validation de FORMAT uniquement dans ce module (pas d'accès base de
// données) : la validation consciente du schéma réel (type déclaré d'une
// question référencée, existence d'une règle référencée dans le même rule
// set) est effectuée séparément par `server/advisoryRules.js` au moment de
// la publication — même séparation des responsabilités que
// `advisoryConditions.validateConditionFormat` (pur) vs
// `advisoryQuestionnaires.validateVersionForPublish` (conscient du schéma).

export const RULE_CONDITION_OPERATORS = [
  'equals', 'not_equals', 'in', 'not_in', 'exists', 'not_exists',
  'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal',
  'contains', 'all', 'any', 'and', 'or', 'not',
];
const COMBINATORS = ['and', 'or'];
const QUANTIFIERS = ['all', 'any'];
const QUANTIFIER_COLLECTIONS = ['members']; // seule collection énumérable supportée dans ce lot

// Même limite et même justification que `advisoryConditions.MAX_CONDITION_
// DEPTH` (éviter un débordement de pile sur un JSON pathologiquement
// imbriqué) — valeur reprise à l'identique plutôt que réinventée, bien que le
// module reste séparé.
const MAX_CONDITION_DEPTH = 20;

// Propriétés de session/foyer/membre explicitement autorisées — liste
// blanche stricte, jamais un accès dynamique générique.
const SESSION_PROPERTIES = ['domain', 'status'];
const MEMBER_PROPERTIES = ['member_role'];
const HOUSEHOLD_PROPERTIES = ['status'];
// Branches de contrat autorisées dans une condition — projection minimale
// contrôlée (jamais le contrat complet, jamais de calcul métier réel LAMal/
// 3a/3b à ce stade). Reprend l'énumération déjà existante de `contracts.
// branch` (server/db.js) : aucune branche inventée.
const CONTRACT_BRANCHES = ['vie_3a', 'vie_3b', 'lamal', 'lca', 'lpp', 'hypotheque', 'rc_menage', 'autre'];

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

// Exactement une référence bien formée parmi les 7 natures autorisées.
// Exportée (Lot 4A, `server/advisoryRules.js`) : réutilisée telle quelle pour
// valider les entrées de `required_data`, qui sont des références isolées
// (pas des conditions complètes) mais partagent exactement la même forme.
export function refKind(ref) {
  if (!isPlainObject(ref)) return null;
  const keys = ['answer', 'answer_status', 'session_property', 'member_property', 'household_property', 'contract_branch', 'rule_result']
    .filter((k) => k in ref);
  if (keys.length !== 1) return null;
  return keys[0];
}

// --- Validation de format (pure, aucun accès base) --------------------------

export function validateRuleConditionFormat(condition, path = 'condition', depth = 0) {
  const errors = [];
  if (depth > MAX_CONDITION_DEPTH) {
    return { valid: false, errors: [`${path} : profondeur d'imbrication excessive (max ${MAX_CONDITION_DEPTH}).`] };
  }
  if (!isPlainObject(condition)) {
    return { valid: false, errors: [`${path} : doit être un objet`] };
  }
  const { op } = condition;
  if (!RULE_CONDITION_OPERATORS.includes(op)) {
    return { valid: false, errors: [`${path}.op : opérateur inconnu « ${op} »`] };
  }

  if (COMBINATORS.includes(op)) {
    if (!Array.isArray(condition.conditions) || condition.conditions.length === 0) {
      errors.push(`${path}.conditions : requis, tableau non vide pour « ${op} »`);
    } else {
      condition.conditions.forEach((sub, i) => {
        const r = validateRuleConditionFormat(sub, `${path}.conditions[${i}]`, depth + 1);
        errors.push(...r.errors);
      });
    }
    return { valid: errors.length === 0, errors };
  }

  if (op === 'not') {
    if (!isPlainObject(condition.condition)) {
      errors.push(`${path}.condition : requis, objet unique pour « not » (jamais un tableau « conditions »)`);
    } else {
      const r = validateRuleConditionFormat(condition.condition, `${path}.condition`, depth + 1);
      errors.push(...r.errors);
    }
    return { valid: errors.length === 0, errors };
  }

  if (QUANTIFIERS.includes(op)) {
    // Quantificateur sur une collection énumérable (uniquement « members »
    // dans ce lot) : `all` vrai si TOUS les membres du foyer figé satisfont
    // `condition` (vacuité : vrai si aucun membre) ; `any` vrai si AU MOINS
    // UN membre la satisfait (vacuité : faux si aucun membre) — sémantique
    // clarifiée par la revue `rules-engine-auditor` (GATE LOT 4A), qui a
    // explicitement signalé l'ambiguïté du brief initial et demandé une
    // documentation univoque avant implémentation plutôt que de les traiter
    // comme de simples synonymes de and/or (ce qui aurait été redondant).
    if (!QUANTIFIER_COLLECTIONS.includes(condition.over)) {
      errors.push(`${path}.over : requis, doit être l'une de [${QUANTIFIER_COLLECTIONS.join(', ')}] pour « ${op} »`);
    }
    if (!isPlainObject(condition.condition)) {
      errors.push(`${path}.condition : requis, objet unique pour « ${op} »`);
    } else {
      const r = validateRuleConditionFormat(condition.condition, `${path}.condition`, depth + 1);
      errors.push(...r.errors);
    }
    return { valid: errors.length === 0, errors };
  }

  // Comparateur : exactement une référence bien formée.
  const kind = refKind(condition.ref);
  if (!kind) {
    errors.push(`${path}.ref : doit contenir exactement une référence (answer, answer_status, session_property, member_property, household_property, contract_branch ou rule_result)`);
  } else if (kind === 'session_property' && !SESSION_PROPERTIES.includes(condition.ref.session_property)) {
    errors.push(`${path}.ref.session_property : propriété non autorisée « ${condition.ref.session_property} »`);
  } else if (kind === 'member_property' && !MEMBER_PROPERTIES.includes(condition.ref.member_property)) {
    errors.push(`${path}.ref.member_property : propriété non autorisée « ${condition.ref.member_property} »`);
  } else if (kind === 'household_property' && !HOUSEHOLD_PROPERTIES.includes(condition.ref.household_property)) {
    errors.push(`${path}.ref.household_property : propriété non autorisée « ${condition.ref.household_property} »`);
  } else if (kind === 'contract_branch' && !CONTRACT_BRANCHES.includes(condition.ref.contract_branch)) {
    errors.push(`${path}.ref.contract_branch : branche de contrat inconnue « ${condition.ref.contract_branch} »`);
  } else if ((kind === 'answer' || kind === 'answer_status') && (typeof condition.ref[kind] !== 'string' || !condition.ref[kind])) {
    errors.push(`${path}.ref.${kind} : doit être une clé stable de question non vide`);
  } else if (kind === 'rule_result' && (typeof condition.ref.rule_result !== 'string' || !condition.ref.rule_result)) {
    errors.push(`${path}.ref.rule_result : doit être une clé stable de règle non vide`);
  }

  if (op === 'exists' || op === 'not_exists') {
    // Pas de `value` attendue.
  } else if (op === 'in' || op === 'not_in') {
    if (!Array.isArray(condition.value)) errors.push(`${path}.value : doit être un tableau pour « ${op} »`);
  } else if (op === 'contains') {
    if (!('value' in condition)) errors.push(`${path}.value : requis pour « contains »`);
    // Le type de la valeur résolue (tableau ou chaîne) n'est vérifiable
    // qu'à l'exécution/la publication (accès au type déclaré de la
    // question) — non vérifiable ici hors accès base.
  } else if (!('value' in condition)) {
    errors.push(`${path}.value : requis pour « ${op} »`);
  }
  // Interdiction stricte de conversion implicite dangereuse (revue
  // `rules-engine-auditor`) : contrairement à `advisoryConditions.compare`
  // (qui coerce silencieusement via `Number(value)`), les comparateurs
  // numériques exigent ici une valeur JSON déjà numérique dans la condition
  // elle-même -- une chaîne comme "300" est refusée à la validation, jamais
  // coercée à l'exécution.
  if (['greater_than', 'greater_or_equal', 'less_than', 'less_or_equal'].includes(op) && 'value' in condition && typeof condition.value !== 'number') {
    errors.push(`${path}.value : doit être un nombre pour « ${op} » (aucune conversion implicite depuis une chaîne)`);
  }
  return { valid: errors.length === 0, errors };
}

// --- Dépendances (questions ET règles) --------------------------------------

// Retourne { questionKeys: Set, ruleKeys: Set } — séparés car ils alimentent
// deux contrôles distincts : `findUnknownReferences`-like pour les questions
// (accès base, dans advisoryRules.js) et `detectRuleCycle` pour les règles.
export function collectRuleDependencies(condition, into = { questionKeys: new Set(), ruleKeys: new Set() }) {
  if (!isPlainObject(condition)) return into;
  if (COMBINATORS.includes(condition.op)) {
    (condition.conditions || []).forEach((sub) => collectRuleDependencies(sub, into));
    return into;
  }
  if (condition.op === 'not' || QUANTIFIERS.includes(condition.op)) {
    collectRuleDependencies(condition.condition, into);
    return into;
  }
  if (condition.ref) {
    if (condition.ref.answer) into.questionKeys.add(condition.ref.answer);
    if (condition.ref.answer_status) into.questionKeys.add(condition.ref.answer_status);
    if (condition.ref.rule_result) into.ruleKeys.add(condition.ref.rule_result);
  }
  return into;
}

// Clés de question référencées HORS de tout quantificateur `all`/`any` —
// constat GATE LOT 4A (revue `rules-engine-auditor`) : une référence
// `answer`/`answer_status` à une question de portée « member » n'a de sens
// que sous un quantificateur (qui fournit le membre courant, `context.
// member`) ; référencée directement, elle résout systématiquement à
// « absente » (aucun membre courant), ce qui rend `not_exists` toujours vrai
// silencieusement — exactement le type d'hypothèse silencieuse que ce
// moteur s'interdit. Utilisée par `server/advisoryRules.js` au moment de la
// publication pour refuser toute règle qui référence directement une
// question de portée membre hors quantificateur (jamais une correction
// silencieuse à l'exécution).
export function collectDirectAnswerKeys(condition, into = new Set(), insideQuantifier = false) {
  if (!isPlainObject(condition)) return into;
  if (COMBINATORS.includes(condition.op)) {
    (condition.conditions || []).forEach((sub) => collectDirectAnswerKeys(sub, into, insideQuantifier));
    return into;
  }
  if (condition.op === 'not') {
    collectDirectAnswerKeys(condition.condition, into, insideQuantifier);
    return into;
  }
  if (QUANTIFIERS.includes(condition.op)) {
    collectDirectAnswerKeys(condition.condition, into, true);
    return into;
  }
  if (!insideQuantifier && condition.ref) {
    if (condition.ref.answer) into.add(condition.ref.answer);
    if (condition.ref.answer_status) into.add(condition.ref.answer_status);
  }
  return into;
}

// --- Détection de cycle entre règles (même principe que advisoryConditions.
// detectCycle, appliqué à un graphe { key, deps[] } abstrait) ---------------

// Limite de profondeur de dépendance entre règles -- bornage technique
// proportionné (même esprit que MAX_CONDITION_DEPTH), choix d'implémentation
// documenté : la revue `rules-engine-auditor` a signalé qu'une valeur précise
// relevait d'un jugement d'ingénierie plutôt que d'une question métier,
// laissant le choix final à l'implémentation.
export const MAX_RULE_DEPENDENCY_DEPTH = 5;

export function detectRuleCycle(nodes) {
  const graph = new Map();
  for (const { key, ruleKeys } of nodes) graph.set(key, [...ruleKeys]);
  const WHITE = 0; const GRAY = 1; const BLACK = 2;
  const color = new Map(nodes.map((n) => [n.key, WHITE]));
  const path = [];

  function visit(key) {
    color.set(key, GRAY);
    path.push(key);
    for (const dep of graph.get(key) || []) {
      if (!graph.has(dep)) continue; // référence inconnue : signalée séparément
      const c = color.get(dep);
      if (c === GRAY) {
        const cycleStart = path.indexOf(dep);
        return path.slice(cycleStart).concat(dep);
      }
      if (c === WHITE) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    path.pop();
    color.set(key, BLACK);
    return null;
  }

  for (const { key } of nodes) {
    if (color.get(key) === WHITE) {
      const cycle = visit(key);
      if (cycle) return cycle;
    }
  }
  return null;
}

// Profondeur maximale de la chaîne de dépendances (longueur du plus long
// chemin), calculée séparément du cycle lui-même — un graphe acyclique peut
// tout de même excéder la profondeur autorisée.
export function maxDependencyDepth(nodes) {
  const graph = new Map(nodes.map((n) => [n.key, [...n.ruleKeys]]));
  const memo = new Map();
  function depth(key, seen) {
    if (memo.has(key)) return memo.get(key);
    if (seen.has(key)) return 0; // cycle déjà signalé séparément, ne pas boucler ici
    const deps = graph.get(key) || [];
    if (deps.length === 0) { memo.set(key, 0); return 0; }
    const next = new Set(seen); next.add(key);
    const d = 1 + Math.max(...deps.map((k) => (graph.has(k) ? depth(k, next) : 0)));
    memo.set(key, d);
    return d;
  }
  let max = 0;
  for (const { key } of nodes) max = Math.max(max, depth(key, new Set()));
  return max;
}

// Références vers une règle inconnue du même rule_set — à appeler à la
// publication, jamais à l'exécution.
export function findUnknownRuleReferences(nodes, knownRuleKeys) {
  const known = new Set(knownRuleKeys);
  const unknown = [];
  for (const { key, ruleKeys } of nodes) {
    for (const dep of ruleKeys) {
      if (!known.has(dep)) unknown.push({ from: key, rule: dep });
    }
  }
  return unknown;
}

// --- Résolution et évaluation -----------------------------------------------

// `context` attendu :
// {
//   session: { domain, status },
//   household: { status },
//   member: { member_role } | null,      -- membre courant (évaluation par instance)
//   members: [{ member_role, ... }],     -- tous les membres du snapshot figé (pour all/any)
//   getAnswer(stableKey, member) => { status, value } | undefined,
//   getContractBranchStatus(branch) => string | undefined,
//   getRuleResult(stableKey) => boolean | undefined,
// }
//
// `getAnswer` reçoit toujours le membre COURANT (`context.member`, tel quel
// -- `null` hors quantificateur) en second argument, explicitement, plutôt
// qu'un accès implicite via `this` -- seul moyen pour une réponse de portée
// « member » d'être résolue correctement lorsqu'un `all`/`any` fait varier
// le membre courant à travers des appels récursifs successifs (le premier
// argument seul ne suffirait pas : deux appels à `getAnswer('meme_cle', ...)`
// à l'intérieur d'un `all` doivent pouvoir résoudre deux réponses
// DIFFÉRENTES, une par membre). Les appelants dont les questions sont
// toutes de portée « household » peuvent simplement ignorer ce second
// argument (rétrocompatible, voir `test/advisory-conditions.test.js`-style
// closures qui ne lisent que le premier).
//
// Exportée sous le nom `resolveRuleRef` (Lot 4A, `server/advisoryRules.js` /
// moteur d'exécution) : réutilisée telle quelle pour déterminer si une
// entrée de `required_data` est disponible pour une session donnée (même
// notion de présence que pour une condition, jamais réimplémentée).
export function resolveRuleRef(ref, context) {
  return resolveRef(ref, context);
}

function resolveRef(ref, context) {
  const kind = refKind(ref);
  if (kind === 'answer') {
    const answer = context.getAnswer ? context.getAnswer(ref.answer, context.member) : undefined;
    if (!answer || answer.status !== 'answered') return { present: false, value: undefined };
    return { present: true, value: answer.value };
  }
  if (kind === 'answer_status') {
    const answer = context.getAnswer ? context.getAnswer(ref.answer_status, context.member) : undefined;
    return { present: true, value: answer ? answer.status : 'absent' };
  }
  if (kind === 'session_property') {
    const v = context.session ? context.session[ref.session_property] : undefined;
    return { present: v != null, value: v };
  }
  if (kind === 'member_property') {
    const v = context.member ? context.member[ref.member_property] : undefined;
    return { present: v != null, value: v };
  }
  if (kind === 'household_property') {
    const v = context.household ? context.household[ref.household_property] : undefined;
    return { present: v != null, value: v };
  }
  if (kind === 'contract_branch') {
    const v = context.getContractBranchStatus ? context.getContractBranchStatus(ref.contract_branch) : undefined;
    return { present: v != null, value: v };
  }
  if (kind === 'rule_result') {
    const v = context.getRuleResult ? context.getRuleResult(ref.rule_result) : undefined;
    return { present: v != null, value: !!v };
  }
  return { present: false, value: undefined };
}

function compare(op, resolved, expected) {
  const { present, value } = resolved;
  if (op === 'exists') return present;
  if (op === 'not_exists') return !present;
  // Toute comparaison sur une donnée absente est toujours fausse — jamais de
  // vérité par défaut, même règle explicite que le moteur de conditions.
  if (!present) return false;
  switch (op) {
    case 'equals': return value === expected;
    case 'not_equals': return value !== expected;
    case 'in': return Array.isArray(expected) && expected.includes(value);
    case 'not_in': return Array.isArray(expected) && !expected.includes(value);
    // Types déjà vérifiés à la validation (aucune coercition ici) — un appel
    // direct hors du pipeline de publication ne doit toutefois jamais lever
    // d'exception : défense en profondeur, retourne simplement `false`.
    case 'greater_than': return typeof value === 'number' && typeof expected === 'number' && value > expected;
    case 'greater_or_equal': return typeof value === 'number' && typeof expected === 'number' && value >= expected;
    case 'less_than': return typeof value === 'number' && typeof expected === 'number' && value < expected;
    case 'less_or_equal': return typeof value === 'number' && typeof expected === 'number' && value <= expected;
    case 'contains':
      if (Array.isArray(value)) return value.includes(expected);
      if (typeof value === 'string') return typeof expected === 'string' && value.includes(expected);
      return false;
    default: return false;
  }
}

// Résolution pure et déterministe : même condition + même contexte → même
// résultat, toujours. Aucune horloge, aucun aléatoire, aucune E/S.
export function evaluateRuleCondition(condition, context = {}) {
  if (!isPlainObject(condition)) return true; // absence de condition = toujours vraie (aucune restriction)
  if (condition.op === 'and') return (condition.conditions || []).every((c) => evaluateRuleCondition(c, context));
  if (condition.op === 'or') return (condition.conditions || []).some((c) => evaluateRuleCondition(c, context));
  if (condition.op === 'not') return !evaluateRuleCondition(condition.condition, context);
  if (condition.op === 'all' || condition.op === 'any') {
    const members = context.members || [];
    const evalForMember = (m) => evaluateRuleCondition(condition.condition, { ...context, member: m });
    return condition.op === 'all' ? members.every(evalForMember) : members.some(evalForMember);
  }
  return compare(condition.op, resolveRef(condition.ref, context), condition.value);
}

// Attribution DÉTERMINISTE des membres correspondant réellement à un
// quantificateur racine `all`/`any` (Lot 4A GATE §3, `finding_scope =
// member`) — jamais une attribution arbitraire au premier membre venu.
// `condition` DOIT être exactement un nœud `{ op: 'all'|'any', over:
// 'members', condition: ... }` (vérifié par `validateRuleSetForPublish`
// avant que ceci ne soit jamais appelé) : la validation de format garantit
// déjà cette forme, cette fonction ne la revalide pas.
// - `any` : chaque membre qui satisfait la sous-condition est un « match ».
// - `all` : soit TOUS les membres satisfont (chacun est alors un « match »),
//   soit au moins un échoue et alors AUCUN n'est un match (un `all` qui
//   échoue partiellement ne produit jamais de finding pour les membres qui,
//   eux, satisfaisaient la sous-condition — la règle ne s'est pas
//   déclenchée dans son ensemble).
// Zéro membre dans le contexte -> tableau vide dans tous les cas (rien à
// attribuer), cohérent avec « zéro membre correspondant = zéro finding ».
export function resolveQuantifierMembers(condition, context = {}) {
  const members = context.members || [];
  const satisfies = (m) => evaluateRuleCondition(condition.condition, { ...context, member: m });
  if (condition.op === 'any') return members.filter(satisfies);
  if (condition.op === 'all') return members.every(satisfies) ? members : [];
  return [];
}
