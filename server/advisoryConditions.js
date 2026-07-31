// Moteur de conditions d'affichage — Legrand Diagnostic 360, Lot 3A.
//
// Interpréteur JSON déclaratif fermé, déterministe, sans dépendance externe,
// sans IA. Jamais de `eval`, jamais de `new Function`, jamais de SQL
// dynamique. Sert à décider si une section ou une question doit être
// affichée compte tenu des réponses déjà données dans la session.

export const CONDITION_OPERATORS = [
  'equals', 'not_equals', 'in', 'not_in', 'exists', 'not_exists',
  'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal',
  'and', 'or',
];
const COMBINATORS = ['and', 'or'];

// Aucune condition métier réelle n'a jamais besoin de plus de quelques
// niveaux d'imbrication and/or — cette limite existe uniquement pour éviter
// qu'un JSON pathologiquement imbriqué (des milliers de niveaux) ne fasse
// déborder la pile d'appel (RangeError non intercepté par AdvisoryError,
// confirmé empiriquement lors du GATE LOT 3A à partir d'environ 10 000
// niveaux). La limite de taille de requête (`express.json({ limit: '1mb' })`,
// server/app.js) borne déjà séparément le risque de largeur (un tableau
// `conditions` très large) : aucune limite de largeur supplémentaire n'est
// donc nécessaire ici, seule la profondeur pose un risque de pile.
const MAX_CONDITION_DEPTH = 20;

// Seules propriétés de session/membre référençables — liste blanche stricte,
// jamais un accès dynamique générique (évite toute pollution de prototype,
// même si l'entrée provient de notre propre base, pas d'un tiers).
const SESSION_PROPERTIES = ['domain'];
const MEMBER_PROPERTIES = ['member_role'];

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function refKind(ref) {
  if (!isPlainObject(ref)) return null;
  const keys = ['question', 'session_property', 'member_property'].filter((k) => k in ref);
  if (keys.length !== 1) return null;
  return keys[0];
}

// Validation structurelle pure — ne résout rien, ne lit aucune réponse.
// Retourne { valid, errors } (jamais un throw) pour permettre de collecter
// toutes les erreurs d'une version en une seule passe de publication.
export function validateConditionFormat(condition, path = 'condition', depth = 0) {
  const errors = [];
  if (depth > MAX_CONDITION_DEPTH) {
    return { valid: false, errors: [`${path} : profondeur d'imbrication excessive (max ${MAX_CONDITION_DEPTH}).`] };
  }
  if (!isPlainObject(condition)) {
    return { valid: false, errors: [`${path} : doit être un objet`] };
  }
  const { op } = condition;
  if (!CONDITION_OPERATORS.includes(op)) {
    return { valid: false, errors: [`${path}.op : opérateur inconnu « ${op} »`] };
  }
  if (COMBINATORS.includes(op)) {
    if (!Array.isArray(condition.conditions) || condition.conditions.length === 0) {
      errors.push(`${path}.conditions : requis, tableau non vide pour « ${op} »`);
    } else {
      condition.conditions.forEach((sub, i) => {
        const r = validateConditionFormat(sub, `${path}.conditions[${i}]`, depth + 1);
        errors.push(...r.errors);
      });
    }
    return { valid: errors.length === 0, errors };
  }
  // Comparateur : exactement une référence bien formée.
  const kind = refKind(condition.ref);
  if (!kind) {
    errors.push(`${path}.ref : doit contenir exactement une référence (question, session_property ou member_property)`);
  } else if (kind === 'session_property' && !SESSION_PROPERTIES.includes(condition.ref.session_property)) {
    errors.push(`${path}.ref.session_property : propriété non autorisée « ${condition.ref.session_property} »`);
  } else if (kind === 'member_property' && !MEMBER_PROPERTIES.includes(condition.ref.member_property)) {
    errors.push(`${path}.ref.member_property : propriété non autorisée « ${condition.ref.member_property} »`);
  } else if (kind === 'question' && (typeof condition.ref.question !== 'string' || !condition.ref.question)) {
    errors.push(`${path}.ref.question : doit être une clé stable non vide`);
  }
  if (op === 'exists' || op === 'not_exists') {
    // Pas de `value` attendue.
  } else if (op === 'in' || op === 'not_in') {
    if (!Array.isArray(condition.value)) errors.push(`${path}.value : doit être un tableau pour « ${op} »`);
  } else if (!('value' in condition)) {
    errors.push(`${path}.value : requis pour « ${op} »`);
  }
  return { valid: errors.length === 0, errors };
}

// Dépendances = clés stables des questions référencées (jamais les sections,
// qui ne sont jamais elles-mêmes référençables — voir collecte des cycles).
export function collectDependencies(condition, into = new Set()) {
  if (!isPlainObject(condition)) return into;
  if (COMBINATORS.includes(condition.op)) {
    (condition.conditions || []).forEach((sub) => collectDependencies(sub, into));
    return into;
  }
  if (condition.ref && condition.ref.question) into.add(condition.ref.question);
  return into;
}

// Résout une référence vers { present: bool, value } — `present` est faux
// pour toute réponse absente, `unknown`, `not_applicable` ou `cleared` (seul
// le statut `answered` avec une valeur constitue une donnée « existante » —
// règle explicite, documentée, tranchant l'ambiguïté relevée en revue).
function resolveRef(ref, context) {
  const kind = refKind(ref);
  if (kind === 'question') {
    const answer = context.getAnswer ? context.getAnswer(ref.question) : undefined;
    if (!answer || answer.status !== 'answered') return { present: false, value: undefined };
    return { present: true, value: answer.value };
  }
  if (kind === 'session_property') {
    if (ref.session_property !== 'domain') return { present: false, value: undefined };
    const v = context.session ? context.session.domain : undefined;
    return { present: v != null, value: v };
  }
  if (kind === 'member_property') {
    if (ref.member_property !== 'member_role') return { present: false, value: undefined };
    const v = context.member ? context.member.member_role : undefined;
    return { present: v != null, value: v };
  }
  return { present: false, value: undefined };
}

function compare(op, resolved, expected) {
  const { present, value } = resolved;
  if (op === 'exists') return present;
  if (op === 'not_exists') return !present;
  // Toute comparaison sur une donnée absente est toujours fausse — jamais de
  // vérité par défaut (« pas de réponse » ne satisfait ni equals ni
  // not_equals) : règle explicite, documentée, la plus prévisible.
  if (!present) return false;
  switch (op) {
    case 'equals': return value === expected;
    case 'not_equals': return value !== expected;
    case 'in': return Array.isArray(expected) && expected.includes(value);
    case 'not_in': return Array.isArray(expected) && !expected.includes(value);
    case 'greater_than': return Number(value) > Number(expected);
    case 'greater_or_equal': return Number(value) >= Number(expected);
    case 'less_than': return Number(value) < Number(expected);
    case 'less_or_equal': return Number(value) <= Number(expected);
    default: return false;
  }
}

// Résolution pure et déterministe : même condition + même contexte → même
// résultat, toujours. Aucune horloge, aucun aléatoire, aucune E/S. `and`/`or`
// utilisent `.every()`/`.some()`, qui court-circuitent bien au niveau du
// moteur JavaScript — mais sans effet sur le résultat, la logique booléenne
// étant pure (aucune sous-condition ne lève d'exception ni n'a d'effet de
// bord, seule `evaluateCondition` elle-même y accède).
export function evaluateCondition(condition, context = {}) {
  if (!isPlainObject(condition)) return true; // absence de condition = toujours visible
  // Garde défensive alignée sur `collectDependencies`/`validateConditionFormat` :
  // une condition non préalablement validée (ex. appel direct hors du
  // pipeline de publication) ne doit jamais lever une exception ici.
  if (condition.op === 'and') return (condition.conditions || []).every((c) => evaluateCondition(c, context));
  if (condition.op === 'or') return (condition.conditions || []).some((c) => evaluateCondition(c, context));
  return compare(condition.op, resolveRef(condition.ref, context), condition.value);
}

// Détection de cycle sur l'ensemble des conditions d'une version (sections +
// questions). Les sections ne sont jamais la CIBLE d'une dépendance (aucune
// condition ne peut référencer une section, seulement une question) : elles
// ne peuvent donc mathématiquement jamais participer à un cycle, mais sont
// tout de même incluses comme nœuds sources par exhaustivité et robustesse
// si le format venait à évoluer.
//
// `nodes` : tableau de { key, condition } où `key` est la clé stable de la
// question (ou un identifiant synthétique `section:<stable_key>` pour une
// section) et `condition` son `display_condition` (peut être null/undefined).
export function detectCycle(nodes) {
  const graph = new Map();
  for (const { key, condition } of nodes) {
    graph.set(key, [...collectDependencies(condition)]);
  }
  const WHITE = 0; const GRAY = 1; const BLACK = 2;
  const color = new Map(nodes.map((n) => [n.key, WHITE]));
  const path = [];

  function visit(key) {
    color.set(key, GRAY);
    path.push(key);
    for (const dep of graph.get(key) || []) {
      if (!graph.has(dep)) continue; // référence inconnue : signalée séparément, pas ici
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

// Références à une question inconnue de la version — à appeler à la
// publication, jamais à l'exécution.
export function findUnknownReferences(nodes, knownQuestionKeys) {
  const known = new Set(knownQuestionKeys);
  const unknown = [];
  for (const { key, condition } of nodes) {
    for (const dep of collectDependencies(condition)) {
      if (!known.has(dep)) unknown.push({ from: key, question: dep });
    }
  }
  return unknown;
}
