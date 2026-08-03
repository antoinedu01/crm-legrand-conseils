// Tests du service métier « ensembles de règles et règles déterministes »
// (Legrand Diagnostic 360, Lot 4A). Base de test isolée (CRM_DATA_DIR),
// jamais data/**. Toutes les règles et questionnaires ici sont fictifs et
// techniques — aucun ne constitue un conseil d'assurance réel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-rules-'));

const { default: db } = await import('../server/db.js');
const {
  createQuestionnaire, createDraftVersion: createQuestionnaireDraftVersion, upsertSection, upsertQuestion, publishVersion,
} = await import('../server/advisoryQuestionnaires.js');
const {
  RULE_SET_DOMAINS, FINDING_TYPES, RULE_PRIORITIES,
  createRuleSet, createDraftVersion, getRuleSetDetail, listRuleSets,
  upsertRule, validateRuleSetForPublish, publishRuleSet, archiveRuleSet, cloneRuleSetToNewDraft,
} = await import('../server/advisoryRules.js');
const { AdvisoryError } = await import('../server/advisoryHouseholds.js');

const REQ = { session: { userEmail: 'conseiller-regles@exemple.ch' } };
db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run('conseiller-regles@exemple.ch', 'Conseiller', 'x');

function auditCount(action) {
  return db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?').get(action).n;
}

// Politique « un seul rule_set publié par domaine » (GATE LOT 4A, §2) :
// chaque test de ce fichier veut publier un rule_set isolé sans se soucier
// des autres tests — archive donc systématiquement toute AUTRE famille déjà
// publiée pour ce domaine avant de publier la nouvelle.
function publishFresh(ruleSetId) {
  const ruleSet = getRuleSetDetail(ruleSetId);
  const others = db.prepare("SELECT id FROM advisory_rule_sets WHERE domain = ? AND status = 'published' AND stable_key != ?").all(ruleSet.domain, ruleSet.stable_key);
  for (const o of others) archiveRuleSet(o.id, REQ);
  return publishRuleSet(ruleSetId, REQ);
}

function uniqueKey(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

// Publie un mini-questionnaire fictif dans un domaine donné, avec une
// question booléenne de portée foyer (référençable par une règle), une
// question texte libre (utilisée pour vérifier le refus des dépendances sur
// du texte libre) et une question booléenne de portée membre (utilisée pour
// vérifier le refus d'une référence directe hors quantificateur all/any).
// Retourne les clés stables publiées.
function publishSupportingQuestionnaire(domain) {
  const boolKey = uniqueKey(`${domain}-bool`);
  const textKey = uniqueKey(`${domain}-texte`);
  const memberBoolKey = uniqueKey(`${domain}-membre-bool`);
  const { id: qid } = createQuestionnaire({ stable_key: uniqueKey(`quest-${domain}`), domain, name: `Questionnaire technique ${domain}` }, REQ);
  const { id: vid } = createQuestionnaireDraftVersion(qid, {}, REQ);
  const { id: sectionId } = upsertSection(vid, { stable_key: 'section_unique', title: 'Section', sort_order: 1 }, REQ);
  upsertQuestion(sectionId, { stable_key: boolKey, advisor_text: 'Question booléenne fictive ?', type: 'boolean', sort_order: 1 }, REQ);
  upsertQuestion(sectionId, { stable_key: textKey, advisor_text: 'Question texte libre fictive ?', type: 'text', sort_order: 2 }, REQ);
  const { id: memberSectionId } = upsertSection(vid, { stable_key: 'section_membre', title: 'Section membre', sort_order: 2, applies_to: 'member' }, REQ);
  upsertQuestion(memberSectionId, { stable_key: memberBoolKey, advisor_text: 'Question membre booléenne fictive ?', type: 'boolean', scope: 'member', sort_order: 1 }, REQ);
  publishVersion(vid, REQ);
  return { boolKey, textKey, memberBoolKey };
}

const HEALTH = publishSupportingQuestionnaire('health');
const LIFE = publishSupportingQuestionnaire('life_pension');
const COMMON = publishSupportingQuestionnaire('common');

function validRuleData(overrides = {}) {
  return {
    stable_key: uniqueKey('TEST-RULE'),
    title: 'Règle technique fictive',
    conditions: { op: 'equals', ref: { answer: HEALTH.boolKey }, value: true },
    required_data: [{ answer: HEALTH.boolKey }],
    result_finding_type: 'detected_need',
    result_payload: { category_hint: 'categorie_technique_fictive' },
    priority: 'medium',
    advisor_explanation: 'Explication technique fictive à destination du conseiller.',
    source: 'Exemple technique fictif — ne constitue pas un conseil d\'assurance.',
    source_reference: 'REF-FICTIVE-001',
    effective_from: '2020-01-01',
    sort_order: 1,
    ...overrides,
  };
}

function buildPublishableRuleSet(domain = 'health') {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs'), domain, name: 'Ensemble technique fictif' }, REQ);
  const key = domain === 'health' ? HEALTH.boolKey : LIFE.boolKey;
  upsertRule(ruleSetId, validRuleData({ conditions: { op: 'equals', ref: { answer: key }, value: true }, required_data: [{ answer: key }] }), REQ);
  return ruleSetId;
}

// --- RULE_SET_DOMAINS / constantes ------------------------------------------

test('RULE_SET_DOMAINS inclut common/health/life_pension, exclut toujours « mixed » (GATE LOT 4A §2)', () => {
  assert.deepEqual(RULE_SET_DOMAINS, ['common', 'health', 'life_pension']);
  assert.ok(!RULE_SET_DOMAINS.includes('mixed'));
});

test('FINDING_TYPES n\'inclut jamais recommandation/produit/assureur', () => {
  for (const forbidden of ['recommandation_validee', 'produit', 'assureur', 'contrat_a_souscrire']) {
    assert.ok(!FINDING_TYPES.includes(forbidden));
  }
});

// --- Ensembles de règles -----------------------------------------------------

test('createRuleSet — création en version 1, statut brouillon, et journalisation', () => {
  const before = auditCount('rule_set créé');
  const { id, version_number } = createRuleSet({ stable_key: uniqueKey('rs-creation'), domain: 'health', name: 'Démo' }, REQ);
  assert.ok(id);
  assert.equal(version_number, 1);
  const detail = getRuleSetDetail(id);
  assert.equal(detail.status, 'draft');
  assert.equal(auditCount('rule_set créé'), before + 1);
});

test('createRuleSet — refuse une clé stable déjà utilisée', () => {
  const key = uniqueKey('rs-dup');
  createRuleSet({ stable_key: key, domain: 'health', name: 'A' }, REQ);
  assert.throws(() => createRuleSet({ stable_key: key, domain: 'life_pension', name: 'B' }, REQ), (e) => e instanceof AdvisoryError && e.status === 409);
});

test('createRuleSet — refuse le domaine « mixed »', () => {
  assert.throws(() => createRuleSet({ stable_key: uniqueKey('rs-mixed'), domain: 'mixed', name: 'X' }, REQ));
});

// --- Domaine « common » (GATE LOT 4A §2, décision humaine confirmée) --------

test('createRuleSet — accepte le domaine « common » (constats transverses au foyer)', () => {
  const { id } = createRuleSet({ stable_key: uniqueKey('rs-common'), domain: 'common', name: 'Ensemble commun fictif' }, REQ);
  assert.equal(getRuleSetDetail(id).domain, 'common');
});

test('rule_set common — publié, cloné, archivé, cycle complet identique aux autres domaines', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-common-cycle'), domain: 'common', name: 'X' }, REQ);
  upsertRule(ruleSetId, validRuleData({
    conditions: { op: 'equals', ref: { answer: COMMON.boolKey }, value: true },
    required_data: [{ answer: COMMON.boolKey }],
  }), REQ);
  publishFresh(ruleSetId);
  assert.equal(getRuleSetDetail(ruleSetId).status, 'published');

  const clone = cloneRuleSetToNewDraft(ruleSetId, REQ);
  assert.equal(getRuleSetDetail(clone.id).domain, 'common');
  assert.equal(getRuleSetDetail(clone.id).status, 'draft');

  archiveRuleSet(ruleSetId, REQ);
  assert.equal(getRuleSetDetail(ruleSetId).status, 'archived');
});

test('publishRuleSet — politique « un seul rule_set publié par domaine » : une AUTRE famille déjà publiée bloque, la MÊME famille republiée archive automatiquement l\'ancienne version', () => {
  const domain = 'common';
  const { id: familyA } = createRuleSet({ stable_key: uniqueKey('rs-common-family-a'), domain, name: 'A' }, REQ);
  upsertRule(familyA, validRuleData({ conditions: { op: 'exists', ref: { answer: COMMON.boolKey } }, required_data: [] }), REQ);
  publishFresh(familyA);

  const { id: familyB } = createRuleSet({ stable_key: uniqueKey('rs-common-family-b'), domain, name: 'B' }, REQ);
  upsertRule(familyB, validRuleData({ conditions: { op: 'exists', ref: { answer: COMMON.boolKey } }, required_data: [] }), REQ);
  assert.throws(
    () => publishRuleSet(familyB, REQ),
    (e) => e instanceof AdvisoryError && e.status === 409 && /déjà publié/.test(e.message)
  );

  // Une NOUVELLE VERSION de la même famille (A), en revanche, archive
  // automatiquement l'ancienne version publiée de CETTE famille.
  const v2 = createDraftVersion(familyA, {}, REQ);
  upsertRule(v2.id, validRuleData({ conditions: { op: 'exists', ref: { answer: COMMON.boolKey } }, required_data: [] }), REQ);
  publishRuleSet(v2.id, REQ);
  assert.equal(getRuleSetDetail(familyA).status, 'archived', 'la version 1 est automatiquement archivée par la publication de la version 2');
  assert.equal(getRuleSetDetail(v2.id).status, 'published');
});

test('exécution du moteur — refuse toujours un rule_set de domaine « mixed » (n\'existe structurellement pas)', () => {
  assert.ok(!RULE_SET_DOMAINS.includes('mixed'));
});

test('createDraftVersion — numéro de version strictement croissant par famille (stable_key)', () => {
  const { id, } = createRuleSet({ stable_key: uniqueKey('rs-versions'), domain: 'health', name: 'V1' }, REQ);
  const v2 = createDraftVersion(id, {}, REQ);
  assert.equal(v2.version_number, 2);
  const v3 = createDraftVersion(v2.id, {}, REQ);
  assert.equal(v3.version_number, 3);
});

test('listRuleSets — filtre par domaine et statut', () => {
  const key = uniqueKey('rs-liste');
  const { id } = createRuleSet({ stable_key: key, domain: 'life_pension', name: 'Liste' }, REQ);
  const rows = listRuleSets({ domain: 'life_pension', status: 'draft' });
  assert.ok(rows.some((r) => r.id === id));
  assert.ok(listRuleSets({ domain: 'health', status: 'draft' }).every((r) => r.id !== id));
});

test('archiveRuleSet — archive et journalise, idempotent', () => {
  const { id } = createRuleSet({ stable_key: uniqueKey('rs-archive'), domain: 'health', name: 'Archive' }, REQ);
  archiveRuleSet(id, REQ);
  assert.equal(getRuleSetDetail(id).status, 'archived');
  assert.doesNotThrow(() => archiveRuleSet(id, REQ));
});

// --- Règles individuelles ----------------------------------------------------

test('upsertRule — création d\'une règle bien formée, lecture via getRuleSetDetail', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-rule-ok'), domain: 'health', name: 'X' }, REQ);
  const before = auditCount('règle créée');
  const { id: ruleId } = upsertRule(ruleSetId, validRuleData(), REQ);
  assert.ok(ruleId);
  assert.equal(auditCount('règle créée'), before + 1);
  const detail = getRuleSetDetail(ruleSetId);
  assert.equal(detail.rules.length, 1);
  assert.equal(detail.rules[0].domain, 'health', 'le domaine est toujours dérivé du rule_set, jamais fourni par l\'appelant');
});

test('upsertRule — refuse un type de finding hors périmètre', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-finding'), domain: 'health', name: 'X' }, REQ);
  assert.throws(() => upsertRule(ruleSetId, validRuleData({ result_finding_type: 'recommandation_validee' }), REQ));
});

test('upsertRule — refuse un opérateur inconnu dans les conditions (jamais eval/new Function)', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-op'), domain: 'health', name: 'X' }, REQ);
  assert.throws(() => upsertRule(ruleSetId, validRuleData({ conditions: { op: 'eval', ref: { answer: HEALTH.boolKey } } }), REQ));
});

test('upsertRule — refuse une clé stable dupliquée au sein du même rule_set', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-rule-dup'), domain: 'health', name: 'X' }, REQ);
  const data = validRuleData({ stable_key: 'TEST-RULE-DUP' });
  upsertRule(ruleSetId, data, REQ);
  assert.throws(() => upsertRule(ruleSetId, { ...data, sort_order: 2 }, REQ), (e) => e instanceof AdvisoryError && e.status === 409);
});

test('upsertRule — refuse une required_data hors des natures answer/contract_branch', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-reqdata'), domain: 'health', name: 'X' }, REQ);
  assert.throws(() => upsertRule(ruleSetId, validRuleData({ required_data: [{ session_property: 'domain' }] }), REQ));
  assert.throws(() => upsertRule(ruleSetId, validRuleData({ required_data: [{ rule_result: 'AUTRE' }] }), REQ));
});

test('upsertRule — result_payload : refuse toute clé hors « category_hint »', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-payload-key'), domain: 'health', name: 'X' }, REQ);
  assert.throws(() => upsertRule(ruleSetId, validRuleData({ result_payload: { category_hint: 'x', insurer: 'CSS' } }), REQ));
});

test('upsertRule — result_payload : refuse une valeur évoquant un assureur (liste noire)', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-payload-deny'), domain: 'health', name: 'X' }, REQ);
  assert.throws(() => upsertRule(ruleSetId, validRuleData({ result_payload: { category_hint: 'proposition_axa' } }), REQ));
});

test('upsertRule — refuse un sort_order non entier', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-sort'), domain: 'health', name: 'X' }, REQ);
  assert.throws(() => upsertRule(ruleSetId, validRuleData({ sort_order: 'premier' }), REQ));
});

test('upsertRule — refuse une priorité inconnue, accepte les 4 niveaux documentés', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-prio'), domain: 'health', name: 'X' }, REQ);
  assert.throws(() => upsertRule(ruleSetId, validRuleData({ priority: 'urgentissime' }), REQ));
  for (const p of RULE_PRIORITIES) {
    assert.doesNotThrow(() => upsertRule(ruleSetId, validRuleData({ stable_key: uniqueKey('TEST-RULE-PRIO'), priority: p }), REQ));
  }
});

test('upsertRule — refuse toute modification une fois le rule_set publié', () => {
  const ruleSetId = buildPublishableRuleSet();
  publishFresh(ruleSetId);
  assert.throws(() => upsertRule(ruleSetId, validRuleData(), REQ), (e) => e instanceof AdvisoryError && e.status === 409);
});

// --- Validation de publication -----------------------------------------------

test('validateRuleSetForPublish — refuse un ensemble sans aucune règle active', () => {
  const { id } = createRuleSet({ stable_key: uniqueKey('rs-empty'), domain: 'health', name: 'Vide' }, REQ);
  const r = validateRuleSetForPublish(id);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('Aucune règle active')));
});

test('validateRuleSetForPublish — refuse une règle sans source/source_reference/effective_from/explication', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-missing-meta'), domain: 'health', name: 'X' }, REQ);
  upsertRule(ruleSetId, validRuleData({ source: '', source_reference: '', effective_from: null, advisor_explanation: '   ' }), REQ);
  const r = validateRuleSetForPublish(ruleSetId);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('source obligatoire')));
  assert.ok(r.errors.some((e) => e.includes('référence de source')));
  assert.ok(r.errors.some((e) => e.includes("date d'effet")));
  assert.ok(r.errors.some((e) => e.includes('explication conseiller')));
});

test('validateRuleSetForPublish — refuse une règle dépendant d\'une question à texte libre', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-text-forbidden'), domain: 'health', name: 'X' }, REQ);
  upsertRule(ruleSetId, validRuleData({
    conditions: { op: 'exists', ref: { answer: HEALTH.textKey } },
    required_data: [{ answer: HEALTH.textKey }],
  }), REQ);
  const r = validateRuleSetForPublish(ruleSetId);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('texte libre')));
});

test('validateRuleSetForPublish — refuse une référence à une question totalement inconnue', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-unknown-q'), domain: 'health', name: 'X' }, REQ);
  upsertRule(ruleSetId, validRuleData({
    conditions: { op: 'exists', ref: { answer: 'question-totalement-absente' } },
    required_data: [{ answer: 'question-totalement-absente' }],
  }), REQ);
  const r = validateRuleSetForPublish(ruleSetId);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('question inconnue')));
});

test('validateRuleSetForPublish — refuse une référence DIRECTE (hors all/any) à une question de portée membre', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-direct-member'), domain: 'health', name: 'X' }, REQ);
  upsertRule(ruleSetId, validRuleData({
    conditions: { op: 'exists', ref: { answer: HEALTH.memberBoolKey } },
    required_data: [],
  }), REQ);
  const r = validateRuleSetForPublish(ruleSetId);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('quantificateur')));
});

test('validateRuleSetForPublish — accepte une question de portée membre correctement enveloppée dans all/any', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-quantified-member'), domain: 'health', name: 'X' }, REQ);
  upsertRule(ruleSetId, validRuleData({
    conditions: { op: 'any', over: 'members', condition: { op: 'exists', ref: { answer: HEALTH.memberBoolKey } } },
    required_data: [],
  }), REQ);
  const r = validateRuleSetForPublish(ruleSetId);
  assert.equal(r.valid, true);
});

// Constat GATE LOT 4A §12 (revue advisory-architect) : la contrainte
// finding_scope=member exigeant une racine all/any (server/advisoryRules.js
// §validateRuleSetForPublish) n'était testée nulle part — les deux tests
// précédents exercent `resolveQuantifierMembers`/la référence directe hors
// quantificateur, mais aucun ne pose jamais `finding_scope: 'member'` sur la
// règle elle-même.
test('validateRuleSetForPublish — refuse finding_scope=member dont la condition racine n\'est PAS un quantificateur all/any', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-member-scope-bad-root'), domain: 'health', name: 'X' }, REQ);
  upsertRule(ruleSetId, validRuleData({
    finding_scope: 'member',
    conditions: { op: 'exists', ref: { answer: HEALTH.boolKey } },
    required_data: [],
  }), REQ);
  const r = validateRuleSetForPublish(ruleSetId);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('finding_scope = member') && e.includes('quantificateur')));
});

test('validateRuleSetForPublish — accepte finding_scope=member dont la condition racine EST exactement un quantificateur all/any', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-member-scope-good-root'), domain: 'health', name: 'X' }, REQ);
  upsertRule(ruleSetId, validRuleData({
    finding_scope: 'member',
    conditions: { op: 'any', over: 'members', condition: { op: 'exists', ref: { answer: HEALTH.memberBoolKey } } },
    required_data: [],
  }), REQ);
  const r = validateRuleSetForPublish(ruleSetId);
  assert.equal(r.valid, true);
});

test('validateRuleSetForPublish — détecte un cycle entre règles via rule_result', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-cycle'), domain: 'health', name: 'X' }, REQ);
  upsertRule(ruleSetId, validRuleData({ stable_key: 'TEST-RULE-A', conditions: { op: 'equals', ref: { rule_result: 'TEST-RULE-B' }, value: true } }), REQ);
  upsertRule(ruleSetId, validRuleData({ stable_key: 'TEST-RULE-B', conditions: { op: 'equals', ref: { rule_result: 'TEST-RULE-A' }, value: true } }), REQ);
  const r = validateRuleSetForPublish(ruleSetId);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('circulaire')));
});

test('validateRuleSetForPublish — refuse une référence rule_result vers une règle inconnue', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-unknown-rule'), domain: 'health', name: 'X' }, REQ);
  upsertRule(ruleSetId, validRuleData({ conditions: { op: 'equals', ref: { rule_result: 'TEST-RULE-INEXISTANTE' }, value: true } }), REQ);
  const r = validateRuleSetForPublish(ruleSetId);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('règle inconnue')));
});

test('validateRuleSetForPublish — refuse une profondeur de dépendance entre règles excessive', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-depth'), domain: 'health', name: 'X' }, REQ);
  const n = 8;
  for (let i = 0; i < n; i++) {
    const conditions = i === 0
      ? { op: 'equals', ref: { answer: HEALTH.boolKey }, value: true }
      : { op: 'equals', ref: { rule_result: `TEST-RULE-CHAIN-${i - 1}` }, value: true };
    upsertRule(ruleSetId, validRuleData({ stable_key: `TEST-RULE-CHAIN-${i}`, conditions, required_data: i === 0 ? [{ answer: HEALTH.boolKey }] : [] }), REQ);
  }
  const r = validateRuleSetForPublish(ruleSetId);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('Profondeur de dépendance')));
});

test('validateRuleSetForPublish — signale (sans bloquer) deux règles à conditions strictement identiques', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-dup-cond'), domain: 'health', name: 'X' }, REQ);
  const conditions = { op: 'equals', ref: { answer: HEALTH.boolKey }, value: true };
  upsertRule(ruleSetId, validRuleData({ stable_key: 'TEST-RULE-IDENT-1', conditions }), REQ);
  upsertRule(ruleSetId, validRuleData({ stable_key: 'TEST-RULE-IDENT-2', conditions }), REQ);
  const r = validateRuleSetForPublish(ruleSetId);
  assert.equal(r.valid, true, 'un doublon de conditions est une alerte, jamais un blocage (RULES_ENGINE.md §5)');
  assert.ok(r.warnings.some((w) => w.includes('strictement identiques')));
});

test('validateRuleSetForPublish — signale (sans bloquer) un recoupement simulé sur la même catégorie', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-overlap'), domain: 'health', name: 'X' }, REQ);
  upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-OVERLAP-1',
    conditions: { op: 'equals', ref: { answer: HEALTH.boolKey }, value: true },
    result_payload: { category_hint: 'categorie_partagee_fictive' },
  }), REQ);
  upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-OVERLAP-2',
    conditions: { op: 'equals', ref: { answer: HEALTH.boolKey }, value: true },
    result_finding_type: 'gap',
    result_payload: { category_hint: 'categorie_partagee_fictive' },
  }), REQ);
  const r = validateRuleSetForPublish(ruleSetId);
  assert.equal(r.valid, true);
  assert.ok(r.warnings.some((w) => w.includes('Recoupement possible')));
});

test('validateRuleSetForPublish — un ensemble bien formé est valide, sans erreur', () => {
  const ruleSetId = buildPublishableRuleSet();
  const r = validateRuleSetForPublish(ruleSetId);
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
});

// --- Publication ---------------------------------------------------------

test('publishRuleSet — refuse si la validation échoue, expose les erreurs, ne modifie rien', () => {
  const { id: ruleSetId } = createRuleSet({ stable_key: uniqueKey('rs-publish-fail'), domain: 'health', name: 'X' }, REQ);
  assert.throws(() => publishFresh(ruleSetId), (e) => e instanceof AdvisoryError && e.status === 409 && Array.isArray(e.errors));
  assert.equal(getRuleSetDetail(ruleSetId).status, 'draft');
});

test('publishRuleSet — succès : statut publié, empreinte de contenu, règles et rule_set horodatés/validés', () => {
  const ruleSetId = buildPublishableRuleSet();
  const before = auditCount('rule_set publié');
  const result = publishFresh(ruleSetId);
  assert.ok(result.content_hash);
  const detail = getRuleSetDetail(ruleSetId);
  assert.equal(detail.status, 'published');
  assert.ok(detail.validated_by_user_id);
  assert.ok(detail.validated_at);
  assert.ok(detail.published_at);
  assert.ok(detail.rules[0].validated_by_user_id);
  assert.ok(detail.rules[0].validated_at);
  assert.equal(auditCount('rule_set publié'), before + 1);
});

test('publishRuleSet — refuse de republier un ensemble déjà publié ou archivé', () => {
  const ruleSetId = buildPublishableRuleSet();
  publishFresh(ruleSetId);
  assert.throws(() => publishRuleSet(ruleSetId, REQ), (e) => e instanceof AdvisoryError && e.status === 409);
  const { id: archived } = createRuleSet({ stable_key: uniqueKey('rs-archived'), domain: 'health', name: 'X' }, REQ);
  archiveRuleSet(archived, REQ);
  assert.throws(() => publishRuleSet(archived, REQ), (e) => e instanceof AdvisoryError && e.status === 409);
});

// Correctif SQL ciblé (second GATE, avant commit) : matrice explicite des
// scénarios du service `publishRuleSet` désormais adossé à l'index UNIQUE
// PARTIEL de server/db.js (idx_advisory_rule_sets_one_published_per_domain).
test('publishRuleSet — matrice complète du correctif SQL : première publication, nouvelle version, archivage AVANT republication, autre famille refusée, domaines indépendants', () => {
  const domain = 'life_pension';
  // Domaine nettoyé d'abord (les autres tests de ce fichier publient aussi
  // sur life_pension) pour observer une « première publication » propre.
  for (const o of db.prepare("SELECT id FROM advisory_rule_sets WHERE domain = ? AND status = 'published'").all(domain)) {
    archiveRuleSet(o.id, REQ);
  }

  // 1. Première publication : succès.
  const { id: familyA } = createRuleSet({ stable_key: uniqueKey('rs-matrix-a'), domain, name: 'A' }, REQ);
  upsertRule(familyA, validRuleData({ conditions: { op: 'exists', ref: { answer: LIFE.boolKey } }, required_data: [] }), REQ);
  publishRuleSet(familyA, REQ);
  assert.equal(getRuleSetDetail(familyA).status, 'published');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM advisory_rule_sets WHERE domain = ? AND status = 'published'").get(domain).n, 1);

  // 2. Nouvelle version de la MÊME famille : archivage de l'ancienne AVANT
  // publication de la nouvelle, dans la même transaction -- l'index unique
  // partiel étant vérifié statement par statement (jamais différé en
  // SQLite), cette opération n'aurait PU réussir dans le mauvais ordre.
  const v2 = createDraftVersion(familyA, {}, REQ);
  upsertRule(v2.id, validRuleData({ conditions: { op: 'exists', ref: { answer: LIFE.boolKey } }, required_data: [] }), REQ);
  assert.doesNotThrow(() => publishRuleSet(v2.id, REQ), 'la republication d\'une nouvelle version de la même famille doit réussir : preuve indirecte que l\'archivage précède bien la publication');
  // Nouvelle version publiée, ancienne version archivée.
  assert.equal(getRuleSetDetail(familyA).status, 'archived');
  assert.equal(getRuleSetDetail(v2.id).status, 'published');
  // Toujours exactement UNE ligne "published" pour ce domaine à tout moment.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM advisory_rule_sets WHERE domain = ? AND status = 'published'").get(domain).n, 1);

  // Autre famille du même domaine : refusée avec 409, message clair
  // (jamais une fuite SQL brute -- vérifié explicitement ci-dessous).
  const { id: familyB } = createRuleSet({ stable_key: uniqueKey('rs-matrix-b'), domain, name: 'B' }, REQ);
  upsertRule(familyB, validRuleData({ conditions: { op: 'exists', ref: { answer: LIFE.boolKey } }, required_data: [] }), REQ);
  const currentlyPublishedStableKey = db.prepare("SELECT stable_key FROM advisory_rule_sets WHERE domain = ? AND status = 'published'").get(domain).stable_key;
  assert.throws(
    () => publishRuleSet(familyB, REQ),
    (e) => {
      assert.ok(e instanceof AdvisoryError);
      assert.equal(e.status, 409);
      // Constat revue générale (GATE LOT 4A, correctif SQL) : une simple
      // recherche de "SQLITE"/"UNIQUE constraint" laisserait passer une
      // fuite partielle (ex. "constraint" seul, ou le nom brut de la
      // table/colonne). Vérification renforcée : correspondance EXACTE
      // avec le message clair attendu, PLUS une liste élargie de motifs
      // SQL/techniques à bannir explicitement.
      assert.equal(
        e.message,
        `Un autre ensemble de règles (« ${currentlyPublishedStableKey} ») est déjà publié pour le domaine « ${domain} ». Archivez-le explicitement avant de publier celui-ci.`
      );
      const forbidden = ['sqlite', 'constraint', 'advisory_rule_sets', 'select ', 'insert ', 'update ', 'delete ', '.domain', '.stable_key'];
      for (const term of forbidden) {
        assert.ok(!e.message.toLowerCase().includes(term), `le message d'erreur ne doit jamais exposer de détail SQL/technique (« ${term} » trouvé dans « ${e.message} »)`);
      }
      return true;
    }
  );

  // Domaines DIFFÉRENTS : totalement indépendants au niveau service —
  // publier pour un autre domaine ne doit jamais être affecté.
  const { id: otherDomainFamily } = createRuleSet({ stable_key: uniqueKey('rs-matrix-other-domain'), domain: 'common', name: 'C' }, REQ);
  upsertRule(otherDomainFamily, validRuleData({ conditions: { op: 'exists', ref: { answer: COMMON.boolKey } }, required_data: [] }), REQ);
  assert.doesNotThrow(() => publishFresh(otherDomainFamily));
  assert.equal(getRuleSetDetail(otherDomainFamily).status, 'published');
});

// Correctif SQL ciblé (second GATE, avant commit) : rollback forcé.
// Provoque volontairement un échec APRÈS l'archivage de l'ancienne version
// mais AVANT la fin de la transaction de publishRuleSet — au moment de la
// toute dernière écriture (l'horodatage de validation des règles actives,
// qui intervient après l'archivage ET après le passage à "published" de la
// nouvelle version). Technique locale au test, sans aucun mécanisme
// dangereux ajouté au code de production : un déclencheur SQL temporaire
// (RAISE(ABORT, ...)), fonctionnalité SQLite standard, ciblé précisément sur
// le rule_set de ce test (jamais les autres) et supprimé immédiatement après
// usage.
test('publishRuleSet — rollback forcé : un échec après l\'archivage mais avant la fin de la transaction annule TOUT, y compris l\'archivage déjà exécuté', () => {
  const domain = 'health';
  for (const o of db.prepare("SELECT id FROM advisory_rule_sets WHERE domain = ? AND status = 'published'").all(domain)) {
    archiveRuleSet(o.id, REQ);
  }

  const { id: familyId } = createRuleSet({ stable_key: uniqueKey('rs-rollback'), domain, name: 'A' }, REQ);
  upsertRule(familyId, validRuleData({ conditions: { op: 'exists', ref: { answer: HEALTH.boolKey } }, required_data: [] }), REQ);
  publishRuleSet(familyId, REQ);
  assert.equal(getRuleSetDetail(familyId).status, 'published');

  const v2 = createDraftVersion(familyId, {}, REQ);
  upsertRule(v2.id, validRuleData({ conditions: { op: 'exists', ref: { answer: HEALTH.boolKey } }, required_data: [] }), REQ);

  const before = {
    publishedAudits: auditCount('rule_set publié'),
    archivedAudits: auditCount('rule_set archivé'),
  };

  db.exec(`
    CREATE TRIGGER trg_force_rollback_test
    BEFORE UPDATE OF validated_by_user_id ON advisory_rules
    WHEN NEW.rule_set_id = ${v2.id}
    BEGIN
      SELECT RAISE(ABORT, 'échec forcé pour test de rollback (GATE LOT 4A, correctif SQL)');
    END;
  `);
  try {
    assert.throws(() => publishRuleSet(v2.id, REQ), /échec forcé pour test de rollback/);
  } finally {
    db.exec('DROP TRIGGER trg_force_rollback_test');
  }

  // L'ancienne version reste "published" -- l'archivage exécuté PENDANT la
  // transaction annulée n'a jamais été persisté.
  assert.equal(getRuleSetDetail(familyId).status, 'published', 'l\'archivage de l\'ancienne version doit être annulé par le rollback');
  // La nouvelle version reste "draft" -- jamais "published".
  assert.equal(getRuleSetDetail(v2.id).status, 'draft', 'la nouvelle version ne doit jamais rester "published" après un rollback');
  // Exactement UNE version publiée pour ce domaine, ni zéro ni deux.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM advisory_rule_sets WHERE domain = ? AND status = 'published'").get(domain).n, 1);
  // Aucun audit de succès (ni publication ni archivage) sur une transaction
  // qui n'a jamais abouti.
  assert.equal(auditCount('rule_set publié'), before.publishedAudits, 'aucun audit "rule_set publié" ne doit apparaître pour une publication qui a échoué');
  assert.equal(auditCount('rule_set archivé'), before.archivedAudits, 'aucun audit "rule_set archivé" ne doit apparaître pour un archivage annulé par le rollback');
  // Aucun état intermédiaire persistant : la règle de la nouvelle version
  // n'a jamais reçu son horodatage de validation (dernière écriture avortée).
  assert.equal(getRuleSetDetail(v2.id).rules[0].validated_at, null);
});

test('content_hash — indépendant de l\'ordre d\'insertion et des identifiants techniques (deux ensembles équivalents produisent le même hash)', () => {
  const { id: rsA } = createRuleSet({ stable_key: uniqueKey('rs-hash-a'), domain: 'health', name: 'A' }, REQ);
  upsertRule(rsA, validRuleData({ stable_key: 'TEST-RULE-Z', sort_order: 2 }), REQ);
  upsertRule(rsA, validRuleData({ stable_key: 'TEST-RULE-A', sort_order: 1 }), REQ);

  const { id: rsB } = createRuleSet({ stable_key: uniqueKey('rs-hash-b'), domain: 'health', name: 'A' }, REQ);
  upsertRule(rsB, validRuleData({ stable_key: 'TEST-RULE-A', sort_order: 1 }), REQ);
  upsertRule(rsB, validRuleData({ stable_key: 'TEST-RULE-Z', sort_order: 2 }), REQ);

  // rsB est une famille DIFFÉRENTE du même domaine : publishFresh archive rsA
  // au moment de publier rsB, mais hashA a déjà été capturé avant (valeur de
  // retour), donc l'archivage ultérieur de rsA ne l'affecte jamais.
  const hashA = publishFresh(rsA).content_hash;
  const hashB = publishFresh(rsB).content_hash;
  assert.equal(hashA, hashB);
});

// --- Clonage ---------------------------------------------------------------

test('cloneRuleSetToNewDraft — copie les règles vers une nouvelle version, réinitialise la validation', () => {
  const ruleSetId = buildPublishableRuleSet();
  publishFresh(ruleSetId);
  const before = auditCount('rule_set cloné');
  const { id: cloneId } = cloneRuleSetToNewDraft(ruleSetId, REQ);
  assert.equal(auditCount('rule_set cloné'), before + 1);
  const detail = getRuleSetDetail(cloneId);
  assert.equal(detail.status, 'draft');
  assert.equal(detail.version_number, 2);
  assert.equal(detail.rules.length, 1);
  assert.equal(detail.rules[0].validated_by_user_id, null, 'un clone est un nouveau brouillon, jamais déjà validé');
  assert.equal(detail.rules[0].stable_key, getRuleSetDetail(ruleSetId).rules[0].stable_key, 'la clé stable de règle est préservée');
});
