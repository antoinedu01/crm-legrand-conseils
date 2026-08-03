// Service métier — ensembles de règles et règles déterministes (Legrand
// Diagnostic 360, Lot 4A). Isolé de `server/routes/advisoryRules.js`, sur le
// même modèle que `server/advisoryQuestionnaires.js` (Lot 3A). Ce module gère
// exclusivement le CYCLE DE VIE des règles (création, édition en brouillon,
// validation de publication, publication, clonage, archivage) — jamais leur
// EXÉCUTION sur une session, qui vit dans `server/advisoryRuleExecutions.js`
// (même séparation que questionnaires/sessions au Lot 3A).
//
// Rappel de périmètre (non négociable, voir docs/advisory/RULES_ENGINE.md) :
// une règle produit uniquement un CONSTAT/BESOIN/LACUNE/AVERTISSEMENT/
// INFORMATION MANQUANTE/CATÉGORIE DE SOLUTION À EXAMINER (`finding`) —
// jamais un contrat à souscrire, un assureur, un produit précis, une
// recommandation finale, une validation de conseil, une promesse de
// rendement ou une conclusion fiscale certaine.

import crypto from 'crypto';
import db from './db.js';
import { assert, inEnum, isDateStr, checkTextFields } from './validate.js';
import { audit } from './audit.js';
import { AdvisoryError } from './advisoryHouseholds.js';
import {
  validateRuleConditionFormat, collectRuleDependencies, detectRuleCycle,
  maxDependencyDepth, findUnknownRuleReferences, refKind, evaluateRuleCondition,
  collectDirectAnswerKeys, MAX_RULE_DEPENDENCY_DEPTH,
} from './advisoryRuleConditions.js';
import { byCanonicalOrder, canonicalizeJson } from './canonicalJson.js';

// Une règle (et son rule_set) n'appartient jamais à `mixed` — cette valeur
// ne qualifie qu'une session (docs/advisory/RULES_ENGINE.md §2). Une session
// « mixed » exécute TROIS rule_sets distincts en trois exécutions séparées,
// jamais fusionnées (`common`, `health`, `life_pension`) — jamais un rule_set
// « mixed » (constat GATE LOT 4A, décision humaine confirmée) : `common`
// est le domaine des constats transverses au foyer, indépendants du parcours
// maladie ou vie/prévoyance (ex. composition du foyer) — facultatif pour une
// session, mais pleinement pris en charge par le moteur au même titre que
// `health`/`life_pension`.
export const RULE_SET_DOMAINS = ['common', 'health', 'life_pension'];
export const RULE_SET_STATUSES = ['draft', 'published', 'archived'];
// Cycle de vie d'une règle individuelle volontairement calqué sur celui,
// déjà éprouvé, d'`advisory_questions.status` (Lot 3A) plutôt qu'une
// nouvelle machine à états brouillon/valide propre à la règle (que
// suggérait la proposition initiale, docs/advisory/RULES_ENGINE.md §2/§6) —
// décision documentée (revue `rules-engine-auditor`, GATE LOT 4A) : la
// « validation humaine qui fait passer une règle à l'état valide » est
// exactement l'acte de publication du rule_set qui la contient (voir
// `publishRuleSet` ci-dessous, qui horodate alors `validated_by_user_id`/
// `validated_at` sur chaque règle active) — inventer un second cycle de vie
// parallèle propre à la règle aurait dupliqué cette même décision sans
// bénéfice réel, et aurait permis à tort qu'une règle soit « valide » alors
// que le rule_set qui la contient ne l'est pas encore.
export const RULE_STATUSES = ['active', 'archived'];
export const RULE_PRIORITIES = ['low', 'medium', 'high', 'critical'];
// Élargissement documenté des « 7 étapes » du LOT 1
// (docs/advisory/RULES_ENGINE.md §3) aux seules étapes 1 à 5 réellement du
// ressort du moteur de règles (étapes 6/7 — produit, recommandation validée
// — restent hors périmètre, jamais produites ici) : `fact`/
// `missing_information`/`solution_category` deviennent des types de finding
// à part entière, au même titre que `detected_need`/`gap`/`warning`.
// `contre_indication` du LOT 1 n'est PAS repris comme type distinct : une
// contre-indication reste une propriété d'un finding existant (son champ
// `contraindications`), jamais un type de finding séparé — ce choix évite un
// finding « orphelin » sans constat/besoin/lacune sous-jacent qu'il
// contredirait.
export const FINDING_TYPES = ['fact', 'detected_need', 'gap', 'warning', 'missing_information', 'solution_category'];
// Libellés français destinés à l'affichage (Lot 4B) — documentés ici plutôt
// que laissés implicites côté frontend, pour qu'une seule source de vérité
// existe entre le serveur (qui produit les findings) et l'écran qui les
// affiche.
export const FINDING_TYPE_LABELS = {
  fact: 'Constat',
  detected_need: 'Besoin détecté',
  gap: 'Lacune',
  warning: 'Avertissement',
  missing_information: 'Information manquante',
  solution_category: 'Catégorie de solution à examiner',
};
// Sémantique documentée des niveaux de priorité (docs/advisory/
// RULES_ENGINE.md §2 : « entier, pour l'ordonnancement de l'affichage ») —
// clarifiée ici en 4 niveaux nommés plutôt qu'un entier libre, pour rester
// cohérent avec le reste du CRM (jamais d'échelle numérique arbitraire sans
// signification documentée) :
// - low      : information de contexte, aucune action attendue à court terme
// - medium   : mérite d'être abordé pendant l'entretien, sans urgence
// - high     : à aborder explicitement pendant l'entretien en cours
// - critical : situation de risque significatif (ex. absence de couverture
//              incapacité de gain constatée) — jamais un jugement médical ou
//              actuariel certain, seulement un signal de priorité d'examen
export const RULE_PRIORITY_LABELS = { low: 'Basse', medium: 'Moyenne', high: 'Haute', critical: 'Critique' };

// Portée déclarée d'un finding (GATE LOT 4A, décision de conception humaine
// confirmée) — chaque règle DOIT déclarer explicitement à qui son finding
// s'adresse, jamais laissé implicite ni déduit après coup par une interface :
// - `session`   : un seul finding lié à la session dans son ensemble
//                 (household_member_id toujours NULL) ;
// - `household` : un seul finding agrégé lié au foyer de la session
//                 (household_member_id toujours NULL) ;
// - `member`    : un finding DISTINCT pour chaque membre du foyer figé
//                 (snapshot de la session) satisfaisant réellement la
//                 condition de la règle — household_member_id OBLIGATOIRE
//                 sur chacun. Zéro membre correspondant = zéro finding,
//                 jamais une attribution arbitraire au premier membre venu.
export const FINDING_SCOPES = ['session', 'household', 'member'];
export const FINDING_SCOPE_LABELS = { session: 'Session', household: 'Foyer', member: 'Membre du foyer' };

// Seules deux natures de référence désignent une DONNÉE (au sens de
// « donnée requise pour évaluer la règle ») — les autres natures
// (session_property/member_property/household_property : toujours
// structurellement présentes ; rule_result : une DÉPENDANCE entre règles,
// pas une donnée collectée) n'ont pas leur place dans `required_data`.
const REQUIRED_DATA_KINDS = ['answer', 'contract_branch'];

// Seule clé autorisée dans `result_payload` (docs/advisory/RULES_ENGINE.md
// §2 : « catégorie de besoin/lacune, jamais un produit nommé ») — toute
// autre clé est structurellement refusée, jamais seulement déconseillée.
const RESULT_PAYLOAD_ALLOWED_KEYS = ['category_hint'];
// Liste noire de sous-chaînes évoquant un produit ou un assureur précis —
// défense en profondeur en complément de la liste blanche de clés
// ci-dessus (qui empêche déjà un champ dédié « insurer »/« product », mais
// pas une valeur de `category_hint` qui glisserait un nom propre dans du
// texte libre). Liste non exhaustive par nature — documentée comme telle,
// jamais présentée comme une garantie absolue (voir SECURITY_PRIVACY.md).
const RESULT_PAYLOAD_DENYLIST = [
  'axa', 'allianz', 'helvetia', 'swisslife', 'swiss life', 'zurich', 'baloise', 'bâloise',
  'generali', 'css', 'sanitas', 'sympany', 'assura', 'groupe mutuel', 'visana', 'concordia',
  'prime annuelle', 'police n', 'numéro de police', 'assureur', 'compagnie d\'assurance',
];

function assertResultPayloadAllowed(payload) {
  if (payload == null) return;
  assert(typeof payload === 'object' && !Array.isArray(payload), 'result_payload doit être un objet JSON.');
  for (const key of Object.keys(payload)) {
    assert(RESULT_PAYLOAD_ALLOWED_KEYS.includes(key), `result_payload : clé non autorisée « ${key} » (seule « category_hint » est permise).`);
  }
  const flat = JSON.stringify(payload).toLowerCase();
  for (const term of RESULT_PAYLOAD_DENYLIST) {
    assert(!flat.includes(term), `result_payload : évoque potentiellement un produit ou un assureur précis (« ${term} »), interdit dans ce moteur.`);
  }
}

// --- Lecture -----------------------------------------------------------

export function listRuleSets({ domain, status, stable_key } = {}) {
  let sql = 'SELECT * FROM advisory_rule_sets WHERE 1=1';
  const params = [];
  if (domain) { sql += ' AND domain = ?'; params.push(domain); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (stable_key) { sql += ' AND stable_key = ?'; params.push(stable_key); }
  sql += ' ORDER BY stable_key, version_number DESC';
  return db.prepare(sql).all(...params);
}

function getRuleSet(id) {
  return db.prepare('SELECT * FROM advisory_rule_sets WHERE id = ?').get(id);
}

function requireRuleSet(id) {
  const ruleSet = getRuleSet(id);
  if (!ruleSet) throw new AdvisoryError('Ensemble de règles introuvable.', 404);
  return ruleSet;
}

function getRulesForSet(ruleSetId) {
  return db
    .prepare('SELECT * FROM advisory_rules WHERE rule_set_id = ? ORDER BY sort_order, id')
    .all(ruleSetId)
    .map((r) => ({
      ...r,
      conditions: JSON.parse(r.conditions),
      required_data: JSON.parse(r.required_data),
      result_payload: r.result_payload ? JSON.parse(r.result_payload) : null,
      warnings: r.warnings ? JSON.parse(r.warnings) : [],
      contraindications: r.contraindications ? JSON.parse(r.contraindications) : [],
    }));
}

export function getRuleSetDetail(id) {
  const ruleSet = getRuleSet(id);
  if (!ruleSet) return null;
  return { ...ruleSet, rules: getRulesForSet(id) };
}

function getRule(ruleId) {
  return db.prepare('SELECT * FROM advisory_rules WHERE id = ?').get(ruleId);
}

// --- Écriture : ensembles de règles ------------------------------------

export function createRuleSet({ stable_key, domain, name, description } = {}, req) {
  assert(stable_key, 'La clé stable est requise.');
  assert(inEnum(domain, RULE_SET_DOMAINS) && domain != null, 'Domaine de rule_set inconnu (common, health ou life_pension uniquement, jamais mixed).');
  assert(name, 'Le nom est requis.');
  checkTextFields({ stable_key, name }, ['stable_key', 'name'], 200);
  checkTextFields({ description }, ['description'], 2000);
  const existing = db.prepare('SELECT id FROM advisory_rule_sets WHERE stable_key = ?').get(stable_key);
  if (existing) throw new AdvisoryError('Cette clé stable est déjà utilisée par un autre ensemble de règles.', 409);
  const email = req?.session?.userEmail;
  const userId = email ? db.prepare('SELECT id FROM users WHERE email = ?').get(email)?.id : null;
  const info = db
    .prepare(
      `INSERT INTO advisory_rule_sets (stable_key, domain, version_number, name, description, created_by_user_id)
       VALUES (?, ?, 1, ?, ?, ?)`
    )
    .run(stable_key, domain, name, description || null, userId || null);
  audit(req, 'rule_set créé', 'advisory_rule_set', info.lastInsertRowid, `${domain} — ${stable_key} v1`);
  return { id: info.lastInsertRowid, version_number: 1 };
}

// Nouvelle version VIDE de la même famille (même stable_key/domain) — pour
// repartir de zéro sur une nouvelle version plutôt que d'éditer une version
// déjà publiée (jamais modifiée en place). Voir `cloneRuleSetToNewDraft`
// pour repartir du CONTENU d'une version existante.
export function createDraftVersion(ruleSetId, { name, description, changelog } = {}, req) {
  const source = requireRuleSet(ruleSetId);
  checkTextFields({ changelog }, ['changelog'], 2000);
  checkTextFields({ name, description }, ['name', 'description'], 2000);
  const last = db.prepare('SELECT MAX(version_number) AS n FROM advisory_rule_sets WHERE stable_key = ?').get(source.stable_key);
  const versionNumber = (last.n || 0) + 1;
  const email = req?.session?.userEmail;
  const userId = email ? db.prepare('SELECT id FROM users WHERE email = ?').get(email)?.id : null;
  const info = db
    .prepare(
      `INSERT INTO advisory_rule_sets (stable_key, domain, version_number, name, description, changelog, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(source.stable_key, source.domain, versionNumber, name || source.name, description ?? source.description, changelog || null, userId || null);
  audit(req, 'rule_set version créée', 'advisory_rule_set', info.lastInsertRowid, `${source.stable_key} v${versionNumber}`);
  return { id: info.lastInsertRowid, version_number: versionNumber };
}

function assertRuleSetDraft(ruleSet) {
  if (!ruleSet) throw new AdvisoryError('Ensemble de règles introuvable.', 404);
  if (ruleSet.status !== 'draft') throw new AdvisoryError('Seul un ensemble de règles en brouillon peut être modifié.', 409);
}

export function archiveRuleSet(id, req) {
  const ruleSet = requireRuleSet(id);
  if (ruleSet.status === 'archived') return { ok: true };
  db.prepare("UPDATE advisory_rule_sets SET status = 'archived', archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
  audit(req, 'rule_set archivé', 'advisory_rule_set', id, `${ruleSet.stable_key} v${ruleSet.version_number}`);
  return { ok: true };
}

// Clone le CONTENU d'un rule_set existant (ses règles) vers une nouvelle
// version brouillon de la MÊME famille — permet de partir d'un ensemble
// déjà publié plutôt que de ressaisir chaque règle. Les clés stables de
// règle sont préservées (continuité entre versions, même principe que
// `cloneVersionToNewDraft` pour les questionnaires). `validated_by_user_id`/
// `validated_at` NE SONT PAS copiés : la nouvelle version est un nouveau
// brouillon qui devra à nouveau franchir la publication pour que ses règles
// soient (re)validées — la validation d'une version antérieure ne vaut
// jamais pour une version différente, même à contenu identique.
export function cloneRuleSetToNewDraft(ruleSetId, req) {
  const source = requireRuleSet(ruleSetId);
  const rules = getRulesForSet(ruleSetId);
  const email = req?.session?.userEmail;
  const userId = email ? db.prepare('SELECT id FROM users WHERE email = ?').get(email)?.id : null;

  const newId = db.transaction(() => {
    const last = db.prepare('SELECT MAX(version_number) AS n FROM advisory_rule_sets WHERE stable_key = ?').get(source.stable_key);
    const versionNumber = (last.n || 0) + 1;
    const info = db
      .prepare(
        `INSERT INTO advisory_rule_sets (stable_key, domain, version_number, name, description, changelog, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(source.stable_key, source.domain, versionNumber, source.name, source.description, `Cloné depuis la version ${source.version_number}`, userId || null);
    const newRuleSetId = info.lastInsertRowid;
    for (const rule of rules) {
      db.prepare(
        `INSERT INTO advisory_rules
          (rule_set_id, stable_key, domain, title, description, conditions, required_data, result_finding_type, result_payload,
           priority, finding_scope, advisor_explanation, client_explanation, warnings, contraindications, source, source_reference,
           effective_from, effective_until, sort_order, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newRuleSetId, rule.stable_key, rule.domain, rule.title, rule.description,
        JSON.stringify(rule.conditions), JSON.stringify(rule.required_data), rule.result_finding_type,
        rule.result_payload ? JSON.stringify(rule.result_payload) : null, rule.priority, rule.finding_scope,
        rule.advisor_explanation, rule.client_explanation, JSON.stringify(rule.warnings), JSON.stringify(rule.contraindications),
        rule.source, rule.source_reference, rule.effective_from, rule.effective_until, rule.sort_order, rule.status
      );
    }
    return newRuleSetId;
  })();

  audit(req, 'rule_set cloné', 'advisory_rule_set', newId, `${source.stable_key} — depuis v${source.version_number}`);
  return { id: newId };
}

// --- Écriture : règles individuelles -----------------------------------

export function upsertRule(ruleSetId, data = {}, req) {
  const ruleSet = requireRuleSet(ruleSetId);
  assertRuleSetDraft(ruleSet);
  const {
    id, stable_key, title, description, conditions, required_data, result_finding_type, result_payload,
    priority, advisor_explanation, client_explanation, warnings, contraindications,
    source, source_reference, effective_from, effective_until, sort_order, status, finding_scope,
  } = data;

  assert(stable_key, 'La clé stable de règle est requise.');
  assert(title, 'Le titre est requis.');
  assert(advisor_explanation, "L'explication conseiller est requise.");
  assert(Number.isInteger(sort_order), 'sort_order doit être un entier.');
  assert(inEnum(status || 'active', RULE_STATUSES), 'Statut de règle inconnu.');
  assert(inEnum(priority || 'medium', RULE_PRIORITIES) && (priority || 'medium') != null, 'Priorité inconnue.');
  assert(inEnum(result_finding_type, FINDING_TYPES) && result_finding_type != null, 'Type de finding inconnu ou hors périmètre.');
  assert(inEnum(finding_scope || 'household', FINDING_SCOPES), 'Portée de finding inconnue (session, household ou member attendu).');
  checkTextFields({ stable_key, title, source, source_reference }, ['stable_key', 'title', 'source', 'source_reference'], 300);
  checkTextFields({ description, advisor_explanation, client_explanation }, ['description', 'advisor_explanation', 'client_explanation'], 3000);
  assert(isDateStr(effective_from), 'Date d’effet invalide (AAAA-MM-JJ).');
  assert(isDateStr(effective_until), 'Date de fin invalide (AAAA-MM-JJ).');
  if (effective_from && effective_until) {
    assert(effective_from <= effective_until, 'La date de fin doit être postérieure ou égale à la date d’effet.');
  }

  const condCheck = validateRuleConditionFormat(conditions);
  assert(condCheck.valid, `Conditions invalides : ${condCheck.errors.join('; ')}`);

  assert(Array.isArray(required_data), 'required_data doit être un tableau de références.');
  required_data.forEach((ref, i) => {
    const kind = refKind(ref);
    assert(kind && REQUIRED_DATA_KINDS.includes(kind), `required_data[${i}] : doit être une référence « answer » ou « contract_branch ».`);
  });

  if (warnings != null) {
    assert(Array.isArray(warnings) && warnings.every((w) => typeof w === 'string'), 'warnings doit être un tableau de textes.');
    warnings.forEach((w) => assert(w.length <= 500, 'Un avertissement dépasse 500 caractères.'));
  }
  if (contraindications != null) {
    assert(Array.isArray(contraindications) && contraindications.every((c) => typeof c === 'string'), 'contraindications doit être un tableau de textes.');
    contraindications.forEach((c) => assert(c.length <= 500, 'Une contre-indication dépasse 500 caractères.'));
  }
  assertResultPayloadAllowed(result_payload);

  const conditionsJson = JSON.stringify(conditions);
  const requiredDataJson = JSON.stringify(required_data);
  const payloadJson = result_payload != null ? JSON.stringify(result_payload) : null;
  const warningsJson = JSON.stringify(warnings || []);
  const contraindicationsJson = JSON.stringify(contraindications || []);
  // Le domaine n'est jamais fourni par l'appelant : toujours dérivé du
  // rule_set parent, jamais une seconde source de vérité divergente
  // (même principe que la cohérence questionnaire/domaine vérifiée dans
  // `advisorySessions.createSession`).
  const domain = ruleSet.domain;

  if (id) {
    const existing = db.prepare('SELECT * FROM advisory_rules WHERE id = ? AND rule_set_id = ?').get(id, ruleSetId);
    if (!existing) throw new AdvisoryError('Règle introuvable dans cet ensemble.', 404);
    const dup = db.prepare('SELECT id FROM advisory_rules WHERE rule_set_id = ? AND stable_key = ? AND id != ?').get(ruleSetId, stable_key, id);
    if (dup) throw new AdvisoryError('Cette clé stable est déjà utilisée par une autre règle de cet ensemble.', 409);
    db.prepare(
      `UPDATE advisory_rules SET stable_key=?, domain=?, title=?, description=?, conditions=?, required_data=?,
       result_finding_type=?, result_payload=?, priority=?, finding_scope=?, advisor_explanation=?, client_explanation=?,
       warnings=?, contraindications=?, source=?, source_reference=?, effective_from=?, effective_until=?,
       sort_order=?, status=?, updated_at=datetime('now') WHERE id=?`
    ).run(
      stable_key, domain, title, description || null, conditionsJson, requiredDataJson,
      result_finding_type, payloadJson, priority || 'medium', finding_scope || 'household', advisor_explanation, client_explanation || null,
      warningsJson, contraindicationsJson, source || null, source_reference || null,
      effective_from || null, effective_until || null, sort_order, status || 'active', id
    );
    audit(req, 'règle modifiée', 'advisory_rule_set', ruleSetId, stable_key);
    return { id };
  }
  const dup = db.prepare('SELECT id FROM advisory_rules WHERE rule_set_id = ? AND stable_key = ?').get(ruleSetId, stable_key);
  if (dup) throw new AdvisoryError('Cette clé stable est déjà utilisée par une autre règle de cet ensemble.', 409);
  const info = db
    .prepare(
      `INSERT INTO advisory_rules
        (rule_set_id, stable_key, domain, title, description, conditions, required_data, result_finding_type, result_payload,
         priority, finding_scope, advisor_explanation, client_explanation, warnings, contraindications, source, source_reference,
         effective_from, effective_until, sort_order, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ruleSetId, stable_key, domain, title, description || null, conditionsJson, requiredDataJson,
      result_finding_type, payloadJson, priority || 'medium', finding_scope || 'household', advisor_explanation, client_explanation || null,
      warningsJson, contraindicationsJson, source || null, source_reference || null,
      effective_from || null, effective_until || null, sort_order, status || 'active'
    );
  audit(req, 'règle créée', 'advisory_rule_set', ruleSetId, stable_key);
  return { id: info.lastInsertRowid };
}

// --- Validation de schéma (accès base) sur les références answer/contract --

// Recherche le(s) type(s) déclarés d'une question par clé stable, à travers
// TOUTES les versions PUBLIÉES de questionnaire du domaine du rule_set ou
// « common » — une règle ne référence jamais une version précise de
// questionnaire (elle survit aux nouvelles versions), seulement une clé
// stable. Retourne un tableau (généralement 0 ou 1 élément ; plusieurs types
// distincts pour une même clé à travers des questionnaires différents est
// une incohérence de configuration signalée telle quelle, jamais résolue
// silencieusement en n'en gardant qu'un).
function knownQuestionTypesFor(domain, stableKey) {
  const rows = db
    .prepare(
      `SELECT DISTINCT q.type FROM advisory_questions q
       JOIN advisory_questionnaire_versions v ON v.id = q.questionnaire_version_id
       JOIN advisory_questionnaires qq ON qq.id = v.questionnaire_id
       WHERE v.status = 'published' AND qq.domain IN (?, 'common') AND q.stable_key = ?`
    )
    .all(domain, stableKey);
  return rows.map((r) => r.type);
}

// Même principe que `knownQuestionTypesFor`, pour la portée plutôt que le
// type — utilisé pour refuser toute référence DIRECTE (hors quantificateur
// `all`/`any`) à une question de portée « member » (voir
// `collectDirectAnswerKeys`, constat GATE LOT 4A, revue
// `rules-engine-auditor`) : une telle référence résoudrait systématiquement
// à « absente » à l'exécution (aucun membre courant hors quantificateur),
// ce qui rendrait `not_exists` silencieusement toujours vrai — exactement
// le type d'hypothèse silencieuse que ce moteur s'interdit.
function knownQuestionScopesFor(domain, stableKey) {
  const rows = db
    .prepare(
      `SELECT DISTINCT q.scope FROM advisory_questions q
       JOIN advisory_questionnaire_versions v ON v.id = q.questionnaire_version_id
       JOIN advisory_questionnaires qq ON qq.id = v.questionnaire_id
       WHERE v.status = 'published' AND qq.domain IN (?, 'common') AND q.stable_key = ?`
    )
    .all(domain, stableKey);
  return rows.map((r) => r.scope);
}

function answerStableKeysFor(rule) {
  const keys = new Set();
  const deps = collectRuleDependencies(rule.conditions);
  for (const k of deps.questionKeys) keys.add(k);
  for (const ref of rule.required_data) {
    if (refKind(ref) === 'answer') keys.add(ref.answer);
  }
  return keys;
}

// --- Validation de publication (pure vis-à-vis de l'écriture, mais lit la
// base pour la validation de schéma réel — même séparation que
// `advisoryQuestionnaires.validateVersionForPublish`) ------------------------

// Empreinte canonique du CONTENU d'une règle (jamais de son identifiant, de
// son rule_set, de son statut ni de ses dates) — utilisée uniquement pour
// détecter deux règles à conditions strictement identiques au sein du même
// rule_set (docs/advisory/RULES_ENGINE.md §5 : alerte, jamais un blocage).
function conditionFingerprint(rule) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalizeJson(rule.conditions))).digest('hex');
}

export function validateRuleSetForPublish(ruleSetId) {
  const ruleSet = requireRuleSet(ruleSetId);
  const rules = getRulesForSet(ruleSetId);
  const errors = [];
  const warnings = [];
  const activeRules = rules.filter((r) => r.status === 'active');

  if (activeRules.length === 0) errors.push('Aucune règle active dans cet ensemble.');

  const nodes = activeRules.map((r) => ({ key: r.stable_key, ruleKeys: [...collectRuleDependencies(r.conditions).ruleKeys] }));
  const activeKeys = activeRules.map((r) => r.stable_key);

  for (const rule of activeRules) {
    const condCheck = validateRuleConditionFormat(rule.conditions);
    if (!condCheck.valid) errors.push(`Règle « ${rule.stable_key} » : conditions invalides (${condCheck.errors.join('; ')}).`);
    if (!inEnum(rule.result_finding_type, FINDING_TYPES) || rule.result_finding_type == null) {
      errors.push(`Règle « ${rule.stable_key} » : type de finding hors périmètre « ${rule.result_finding_type} ».`);
    }
    try {
      assertResultPayloadAllowed(rule.result_payload);
    } catch (e) {
      errors.push(`Règle « ${rule.stable_key} » : ${e.message}`);
    }
    if (!rule.source || !rule.source.trim()) errors.push(`Règle « ${rule.stable_key} » : source obligatoire manquante avant publication.`);
    if (!rule.source_reference || !rule.source_reference.trim()) errors.push(`Règle « ${rule.stable_key} » : référence de source obligatoire manquante avant publication.`);
    if (!rule.effective_from) errors.push(`Règle « ${rule.stable_key} » : date d'effet obligatoire manquante avant publication.`);
    if (!rule.advisor_explanation || !rule.advisor_explanation.trim()) errors.push(`Règle « ${rule.stable_key} » : explication conseiller obligatoire manquante.`);

    for (const stableKey of answerStableKeysFor(rule)) {
      const types = knownQuestionTypesFor(ruleSet.domain, stableKey);
      if (types.length === 0) {
        errors.push(`Règle « ${rule.stable_key} » : référence une question inconnue des questionnaires publiés (« ${stableKey} »).`);
      } else if (types.includes('text') || types.includes('long_text')) {
        errors.push(`Règle « ${rule.stable_key} » : dépend d'une question à texte libre (« ${stableKey} »), interdit pour une règle déterministe.`);
      }
    }

    // Référence directe (hors all/any) à une question de portée « member » —
    // interdite (voir commentaire de `knownQuestionScopesFor` ci-dessus).
    for (const stableKey of collectDirectAnswerKeys(rule.conditions)) {
      const scopes = knownQuestionScopesFor(ruleSet.domain, stableKey);
      if (scopes.includes('member')) {
        errors.push(`Règle « ${rule.stable_key} » : référence directement (hors quantificateur all/any) la question de portée membre « ${stableKey} » — enveloppez cette référence dans un « all » ou un « any » sur les membres.`);
      }
    }

    // finding_scope = member : la règle DOIT être structurée de façon à ce
    // que le moteur puisse identifier de façon déterministe QUELS membres
    // correspondent (GATE LOT 4A §3.4) — jamais une attribution arbitraire.
    // La seule forme non ambiguë retenue : la condition RACINE de la règle
    // est elle-même exactement un quantificateur `all`/`any` sur les
    // membres (voir `resolveQuantifierMembers`, server/
    // advisoryRuleConditions.js) — pas un `and`/`or` mêlant un quantificateur
    // à d'autres conditions non liées à un membre précis, ce qui rendrait
    // « quel membre correspond réellement » indéterminable.
    if (rule.finding_scope === 'member') {
      const rootOp = (rule.conditions && typeof rule.conditions === 'object' && !Array.isArray(rule.conditions)) ? rule.conditions.op : null;
      if (rootOp !== 'all' && rootOp !== 'any') {
        errors.push(`Règle « ${rule.stable_key} » : finding_scope = member exige que la condition racine soit exactement un quantificateur « all » ou « any » sur les membres, pour une attribution déterministe (jamais ambiguë).`);
      }
    }
  }

  const unknownRuleRefs = findUnknownRuleReferences(nodes, activeKeys);
  for (const u of unknownRuleRefs) {
    errors.push(`Règle « ${u.from} » référence une règle inconnue ou inactive de cet ensemble : « ${u.rule} ».`);
  }
  const cycle = detectRuleCycle(nodes);
  if (cycle) errors.push(`Dépendance circulaire détectée entre règles : ${cycle.join(' → ')}.`);
  else {
    const depth = maxDependencyDepth(nodes);
    if (depth > MAX_RULE_DEPENDENCY_DEPTH) {
      errors.push(`Profondeur de dépendance entre règles excessive (${depth}, maximum ${MAX_RULE_DEPENDENCY_DEPTH}).`);
    }
  }

  // Doublons de conditions strictement identiques — alerte non bloquante
  // (docs/advisory/RULES_ENGINE.md §5 : « la décision de fusionner ou non
  // revient à l'humain qui publie »).
  const byFingerprint = new Map();
  for (const rule of activeRules) {
    const fp = conditionFingerprint(rule);
    if (!byFingerprint.has(fp)) byFingerprint.set(fp, []);
    byFingerprint.get(fp).push(rule.stable_key);
  }
  for (const [, keys] of byFingerprint) {
    if (keys.length > 1) warnings.push(`Conditions strictement identiques entre les règles : ${keys.join(', ')} — fusion à examiner.`);
  }

  warnings.push(...simulateOverlaps(activeRules));

  return { valid: errors.length === 0, errors, warnings };
}

// Simulation bornée de recoupement (docs/advisory/RULES_ENGINE.md §4 :
// « simule des combinaisons de réponses types et signale toute collision »,
// confirmé par la revue `rules-engine-auditor` comme un contrôle
// COMPLÉMENTAIRE à la comparaison en temps réel à l'exécution, pas un
// substitut). Décision d'implémentation documentée : le moteur ne peut pas
// deviner qu'un recoupement de catégorie est réellement CONTRADICTOIRE
// (docs/advisory/RULES_ENGINE.md §4, second point : deux règles qui se
// déclenchent ensemble sur un même sujet sont explicitement autorisées à
// coexister, c'est au conseiller de trancher) — cette simulation reste donc
// une ALERTE informationnelle de recoupement (jamais bloquante), portant sur
// les valeurs de `equals`/`in` explicitement citées dans les conditions des
// règles actives (les seules qu'on puisse énumérer sans deviner un domaine
// de valeurs arbitraire), bornée à un nombre de profils raisonnable. Toute
// troncature est signalée explicitement plutôt que silencieusement omise.
const MAX_SIMULATED_PROFILES = 256;
const MAX_SIMULATED_REFS = 8;

function literalRefsAndValues(condition, into = new Map()) {
  if (!condition || typeof condition !== 'object') return into;
  if (['and', 'or'].includes(condition.op)) { (condition.conditions || []).forEach((c) => literalRefsAndValues(c, into)); return into; }
  if (condition.op === 'not' || ['all', 'any'].includes(condition.op)) { literalRefsAndValues(condition.condition, into); return into; }
  if ((condition.op === 'equals' || condition.op === 'in') && condition.ref && (condition.ref.answer || condition.ref.contract_branch)) {
    const key = condition.ref.answer ? `answer:${condition.ref.answer}` : `contract_branch:${condition.ref.contract_branch}`;
    if (!into.has(key)) into.set(key, new Set());
    const values = condition.op === 'equals' ? [condition.value] : (Array.isArray(condition.value) ? condition.value : []);
    for (const v of values) into.get(key).add(v);
  }
  return into;
}

function simulateOverlaps(activeRules) {
  const refValues = new Map();
  for (const rule of activeRules) literalRefsAndValues(rule.conditions, refValues);
  const refs = [...refValues.keys()].slice(0, MAX_SIMULATED_REFS);
  const truncatedRefs = refValues.size > MAX_SIMULATED_REFS;

  // Produit cartésien borné des valeurs observées par référence (jamais
  // l'univers complet des valeurs possibles — seulement celles citées
  // littéralement par au moins une condition, ce qui suffit à démasquer un
  // recoupement construit à partir des règles elles-mêmes).
  let profiles = [{}];
  let truncatedProfiles = false;
  for (const ref of refs) {
    const values = [...refValues.get(ref)];
    const next = [];
    for (const profile of profiles) {
      for (const v of values) {
        if (next.length >= MAX_SIMULATED_PROFILES) { truncatedProfiles = true; break; }
        next.push({ ...profile, [ref]: v });
      }
      if (next.length >= MAX_SIMULATED_PROFILES) break;
    }
    profiles = next.length ? next : profiles;
  }

  function contextFor(profile) {
    return {
      getAnswer: (k) => (('answer:' + k) in profile ? { status: 'answered', value: profile['answer:' + k] } : undefined),
      getContractBranchStatus: (b) => (('contract_branch:' + b) in profile ? profile['contract_branch:' + b] : undefined),
      getRuleResult: () => undefined,
      session: {}, household: {}, member: null, members: [],
    };
  }

  const overlapsByCategory = new Map();
  for (const profile of profiles) {
    const ctx = contextFor(profile);
    const firing = activeRules.filter((r) => {
      try { return evaluateRuleCondition(r.conditions, ctx); } catch { return false; }
    });
    const byCategory = new Map();
    for (const rule of firing) {
      const category = rule.result_payload?.category_hint;
      if (!category) continue;
      if (!byCategory.has(category)) byCategory.set(category, new Set());
      byCategory.get(category).add(rule.stable_key);
    }
    for (const [category, keys] of byCategory) {
      if (keys.size > 1) {
        const setKey = `${category}::${[...keys].sort().join(',')}`;
        overlapsByCategory.set(setKey, { category, keys: [...keys].sort() });
      }
    }
  }

  const messages = [...overlapsByCategory.values()].map(
    (o) => `Recoupement possible sur la catégorie « ${o.category} » entre les règles : ${o.keys.join(', ')} — au moins une combinaison de réponses simulée déclenche ces règles simultanément (information, jamais un blocage : cf. RULES_ENGINE.md §4).`
  );
  if (truncatedRefs) messages.push(`Simulation de recoupement partielle : ${refValues.size - MAX_SIMULATED_REFS} référence(s) supplémentaire(s) non incluse(s) dans la simulation (limite ${MAX_SIMULATED_REFS}).`);
  if (truncatedProfiles) messages.push(`Simulation de recoupement partielle : nombre de combinaisons simulées plafonné à ${MAX_SIMULATED_PROFILES}.`);
  return messages;
}

// --- Publication ---------------------------------------------------------

function computeRuleSetContentHash(ruleSetId) {
  const rules = getRulesForSet(ruleSetId)
    .filter((r) => r.status === 'active')
    .slice()
    .sort(byCanonicalOrder)
    .map((r) => ({
      stable_key: r.stable_key,
      domain: r.domain,
      title: r.title,
      description: r.description ?? null,
      conditions: canonicalizeJson(r.conditions),
      required_data: canonicalizeJson(r.required_data),
      result_finding_type: r.result_finding_type,
      result_payload: r.result_payload ? canonicalizeJson(r.result_payload) : null,
      priority: r.priority,
      advisor_explanation: r.advisor_explanation,
      client_explanation: r.client_explanation ?? null,
      warnings: r.warnings,
      contraindications: r.contraindications,
      source: r.source,
      source_reference: r.source_reference,
      effective_from: r.effective_from ?? null,
      effective_until: r.effective_until ?? null,
      sort_order: r.sort_order,
    }));
  return crypto.createHash('sha256').update(JSON.stringify(rules)).digest('hex');
}

// Politique « un seul rule_set publié par domaine » (GATE LOT 4A, décision
// d'implémentation retenue — le brief demandait explicitement de trancher
// une politique) : une AUTRE famille (stable_key différent) déjà publiée
// pour le même domaine bloque la publication (409, décision humaine requise
// — archiver l'ancienne famille explicitement avant de publier la nouvelle,
// jamais un remplacement silencieux d'un rule_set potentiellement encore en
// cours d'usage réel dans une session active). En revanche, une AUTRE
// VERSION de la MÊME famille déjà publiée est automatiquement archivée dans
// la même transaction : il ne s'agit alors que d'une nouvelle version de la
// même règle logique — jamais surprenant, et sans risque pour les sessions
// déjà figées sur l'ancienne version (une ré-exécution reste possible sur
// un rule_set archivé, voir `advisoryRuleExecutions.executeRuleSetForSession`).
function assertNoOtherPublishedFamilyForDomain(ruleSet) {
  const other = db
    .prepare("SELECT stable_key FROM advisory_rule_sets WHERE domain = ? AND status = 'published' AND stable_key != ?")
    .get(ruleSet.domain, ruleSet.stable_key);
  if (other) {
    throw new AdvisoryError(
      `Un autre ensemble de règles (« ${other.stable_key} ») est déjà publié pour le domaine « ${ruleSet.domain} ». Archivez-le explicitement avant de publier celui-ci.`,
      409
    );
  }
}

export function publishRuleSet(ruleSetId, req) {
  const ruleSet = requireRuleSet(ruleSetId);
  if (ruleSet.status !== 'draft') throw new AdvisoryError('Seul un ensemble de règles en brouillon peut être publié.', 409);
  assertNoOtherPublishedFamilyForDomain(ruleSet);
  const check = validateRuleSetForPublish(ruleSetId);
  if (!check.valid) {
    const err = new AdvisoryError('Cet ensemble de règles contient des erreurs et ne peut pas être publié.', 409);
    err.errors = check.errors;
    err.warnings = check.warnings;
    throw err;
  }
  const hash = computeRuleSetContentHash(ruleSetId);
  const email = req?.session?.userEmail;
  const userId = email ? db.prepare('SELECT id FROM users WHERE email = ?').get(email)?.id : null;

  const supersededVersion = db
    .prepare("SELECT id, version_number FROM advisory_rule_sets WHERE stable_key = ? AND status = 'published' AND id != ?")
    .get(ruleSet.stable_key, ruleSetId);

  // GATE LOT 4A (correctif ciblé avant commit, décision humaine confirmée) :
  // la politique « un seul rule_set publié par domaine » est désormais
  // garantie par un index UNIQUE PARTIEL SQLite
  // (idx_advisory_rule_sets_one_published_per_domain, server/db.js migration
  // 11), pas seulement par `assertNoOtherPublishedFamilyForDomain`
  // ci-dessus — qui reste la voie normale (message clair, décision humaine
  // explicite requise) mais ne suffirait plus seule si ce processus
  // n'était plus le seul à écrire dans ce fichier SQLite. L'archivage de
  // l'ancienne VERSION de la même famille doit impérativement précéder la
  // publication de la nouvelle dans cette même transaction : l'index étant
  // vérifié statement par statement (jamais différé en SQLite), publier
  // d'abord violerait la contrainte tant que l'ancienne ligne reste
  // 'published'.
  try {
    db.transaction(() => {
      if (supersededVersion) {
        db.prepare("UPDATE advisory_rule_sets SET status = 'archived', archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
          .run(supersededVersion.id);
      }
      db.prepare(
        `UPDATE advisory_rule_sets
         SET status = 'published', content_hash = ?, validated_by_user_id = ?, validated_at = datetime('now'),
             published_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`
      ).run(hash, userId || null, ruleSetId);
      // L'acte de publication EST l'acte de validation humaine de chaque
      // règle active qu'il contient (voir commentaire de RULE_STATUSES
      // ci-dessus) — jamais une validation silencieuse antérieure non tracée.
      db.prepare(
        `UPDATE advisory_rules SET validated_by_user_id = ?, validated_at = datetime('now'), updated_at = datetime('now')
         WHERE rule_set_id = ? AND status = 'active'`
      ).run(userId || null, ruleSetId);
    })();
  } catch (err) {
    // better-sqlite3/SQLite ne rapporte jamais le nom de l'index dans le
    // message d'une violation UNIQUE, uniquement les colonnes couvertes
    // (« UNIQUE constraint failed: advisory_rule_sets.domain » pour l'index
    // partiel ci-dessus — à distinguer de la contrainte de table
    // `UNIQUE(stable_key, version_number)`, qui référence d'autres colonnes
    // et ne peut donc jamais être confondue avec celle-ci, vérifié
    // empiriquement).
    if (err.code && err.code.startsWith('SQLITE_CONSTRAINT') && /advisory_rule_sets\.domain\b/.test(err.message)) {
      throw new AdvisoryError(
        `Un autre ensemble de règles est déjà publié pour le domaine « ${ruleSet.domain} » (détecté au niveau base de données lors de cette publication). Rechargez et archivez-le explicitement avant de réessayer.`,
        409
      );
    }
    throw err;
  }

  audit(req, 'rule_set publié', 'advisory_rule_set', ruleSetId, `${ruleSet.stable_key} v${ruleSet.version_number}`);
  if (supersededVersion) {
    audit(req, 'rule_set archivé', 'advisory_rule_set', supersededVersion.id, `${ruleSet.stable_key} v${supersededVersion.version_number} — supersédé par v${ruleSet.version_number}`);
  }
  return { ok: true, content_hash: hash, warnings: check.warnings };
}

export { getRule, getRulesForSet };
