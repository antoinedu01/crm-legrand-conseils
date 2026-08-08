// LOT 7A-T : le moteur d'exécution des règles doit respecter la
// `display_condition` d'une question lors du calcul de `required_data` —
// une question non applicable (condition d'affichage fausse) pour un membre
// ne doit jamais produire un finding `missing_information` pour ce membre.
// Fichier dédié, isolé du reste de la suite `advisory-rule-executions.test.js`
// (fixtures propres, sans dépendance croisée). Base de test isolée
// (CRM_DATA_DIR), jamais data/**. Tout le contenu ici est fictif et
// technique — aucune donnée d'assurance réelle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-rule-exec-displaycond-'));

const { default: db } = await import('../server/db.js');
const { createHousehold, addMember } = await import('../server/advisoryHouseholds.js');
const Q = await import('../server/advisoryQuestionnaires.js');
const S = await import('../server/advisorySessions.js');
const R = await import('../server/advisoryRules.js');
const E = await import('../server/advisoryRuleExecutions.js');

const REQ = { session: { userEmail: 'conseiller-displaycond@exemple.ch' } };
db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run('conseiller-displaycond@exemple.ch', 'Conseiller', 'x');

function rev(sessionId) {
  return db.prepare('SELECT revision FROM advisory_sessions WHERE id = ?').get(sessionId).revision;
}
function ensureCompleted(sessionId) {
  const status = db.prepare('SELECT status FROM advisory_sessions WHERE id = ?').get(sessionId).status;
  if (status !== 'completed') S.completeSession(sessionId, rev(sessionId), REQ);
}
function uniqueKey(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}
let clientCounter = 0;
function insertClient() {
  clientCounter += 1;
  return db.prepare('INSERT INTO clients (type, first_name, last_name, status) VALUES (?, ?, ?, ?)')
    .run('particulier', `P${clientCounter}`, 'Test', 'prospect').lastInsertRowid;
}
function findQuestionId(versionId, stableKey) {
  const detail = Q.getVersionDetail(versionId);
  for (const section of detail.sections) for (const q of section.questions) if (q.stable_key === stableKey) return q.id;
  throw new Error('question introuvable');
}
function validRuleData(overrides = {}) {
  return {
    stable_key: uniqueKey('TEST-RULE-DISPLAYCOND'),
    title: 'Règle technique fictive — display_condition',
    conditions: { op: 'exists', ref: { answer: 'placeholder' } },
    required_data: [],
    result_finding_type: 'detected_need',
    result_payload: { category_hint: 'categorie_displaycond_fictive' },
    priority: 'medium',
    advisor_explanation: 'Explication technique fictive.',
    source: 'Exemple technique fictif — ne constitue pas un conseil d\'assurance.',
    source_reference: 'REF-DISPLAYCOND-001',
    effective_from: '2020-01-01',
    sort_order: 1,
    ...overrides,
  };
}

// Foyer à un seul membre (principal) — pour les scénarios A/B/C (un seul
// membre à la fois, aucune interaction de fan-out à isoler).
function buildSingleMemberHousehold() {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const principalMember = db.prepare("SELECT id FROM household_members WHERE household_id = ? AND member_role = 'principal'").get(householdId);
  return { householdId, principalMemberId: principalMember.id };
}
// Foyer à deux membres (principal + enfant) — pour les scénarios D/E/F
// (fan-out multi-membres et quantificateurs all/any).
function buildTwoMemberHousehold() {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const childClientId = insertClient();
  const { id: childMemberId } = addMember(householdId, { member_role: 'enfant', client_id: childClientId }, REQ);
  const principalMember = db.prepare("SELECT id FROM household_members WHERE household_id = ? AND member_role = 'principal'").get(householdId);
  return { householdId, principalMemberId: principalMember.id, childMemberId };
}

// Questionnaire fictif : une question « porte » (GATE_Q, portée membre, sans
// condition) et une question « détail » (DETAIL_Q, portée membre, visible
// uniquement si GATE_Q = true) — exactement le patron d'usage réel visé par
// LOT 7A-T (ex. LOT 7A : détail de couverture accident externe visible
// seulement si une couverture externe est déclarée).
function buildConditionalQuestionnaire() {
  const GATE_Q = uniqueKey('gate-q');
  const DETAIL_Q = uniqueKey('detail-q');
  const { id: qid } = Q.createQuestionnaire({ stable_key: uniqueKey('quest-displaycond'), domain: 'health', name: 'Démo display_condition' }, REQ);
  const { id: vid } = Q.createDraftVersion(qid, {}, REQ);
  const { id: sid } = Q.upsertSection(vid, { stable_key: 's_membre', title: 'Membre', sort_order: 1, applies_to: 'member' }, REQ);
  Q.upsertQuestion(sid, { stable_key: GATE_Q, advisor_text: 'Question porte fictive ?', type: 'boolean', scope: 'member', sort_order: 1 }, REQ);
  Q.upsertQuestion(sid, {
    stable_key: DETAIL_Q, advisor_text: 'Question détail fictive (conditionnelle) ?', type: 'boolean', scope: 'member', sort_order: 2,
    display_condition: { op: 'equals', ref: { question: GATE_Q }, value: true },
  }, REQ);
  Q.publishVersion(vid, REQ);
  return { vid, GATE_Q, DETAIL_Q };
}

function createAndStartSession(householdId, versionId) {
  const { id: sessionId } = S.createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: versionId, domain: 'health', module_role: 'domain', display_order: 1 }],
  }, REQ);
  S.startSession(sessionId, rev(sessionId), REQ);
  return sessionId;
}
function archiveOtherPublishedForDomain(domain, keepRuleSetId) {
  const keep = db.prepare('SELECT stable_key FROM advisory_rule_sets WHERE id = ?').get(keepRuleSetId);
  const others = db.prepare("SELECT id FROM advisory_rule_sets WHERE domain = ? AND status = 'published' AND stable_key != ?").all(domain, keep.stable_key);
  for (const o of others) R.archiveRuleSet(o.id, REQ);
}
function publishHealthRuleSet(ruleSetId) {
  archiveOtherPublishedForDomain('health', ruleSetId);
  return R.publishRuleSet(ruleSetId, REQ);
}

// Règle unique : finding_scope=member, quantificateur `any`, condition et
// required_data portant tous deux sur DETAIL_Q — le cas exact visé par
// l'invariant LOT 7A-T.
function buildAndPublishDetailRuleSet(DETAIL_Q) {
  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-displaycond'), domain: 'health', name: 'Ensemble display_condition fictif' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-DETAIL-ANY',
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: DETAIL_Q }, value: true } },
    required_data: [{ answer: DETAIL_Q }],
    finding_scope: 'member',
  }), REQ);
  publishHealthRuleSet(ruleSetId);
  return ruleSetId;
}

function missingInfoFor(detail, memberId) {
  return detail.findings.filter((f) => f.finding_type === 'missing_information' && (memberId === undefined || f.household_member_id === memberId));
}
function substantiveFor(detail, memberId) {
  return detail.findings.filter((f) => f.finding_type !== 'missing_information' && (memberId === undefined || f.household_member_id === memberId));
}

// --- A. Question masquée + référencée en required_data → aucun missing_information ---

test('LOT 7A-T — A. question member display_condition=false + required_data → aucun missing_information', () => {
  const { householdId, principalMemberId } = buildSingleMemberHousehold();
  const { vid, GATE_Q, DETAIL_Q } = buildConditionalQuestionnaire();
  const sessionId = createAndStartSession(householdId, vid);
  const gateQId = findQuestionId(vid, GATE_Q);
  // GATE_Q = false → DETAIL_Q masquée pour ce membre, jamais répondue.
  S.recordAnswers(sessionId, [{ question_id: gateQId, household_member_id: principalMemberId, status: 'answered', value: false }], rev(sessionId), REQ);
  const ruleSetId = buildAndPublishDetailRuleSet(DETAIL_Q);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);

  assert.equal(missingInfoFor(detail, principalMemberId).length, 0, 'aucun missing_information : la question était non applicable pour ce membre');
  assert.equal(substantiveFor(detail, principalMemberId).length, 0, 'la condition (DETAIL_Q=true) ne peut pas non plus se déclencher : GATE_Q=false');
});

// --- B. Même question, display_condition=true, jamais répondue → missing_information ---

test('LOT 7A-T — B. question member display_condition=true + non répondue → missing_information', () => {
  const { householdId, principalMemberId } = buildSingleMemberHousehold();
  const { vid, GATE_Q, DETAIL_Q } = buildConditionalQuestionnaire();
  const sessionId = createAndStartSession(householdId, vid);
  const gateQId = findQuestionId(vid, GATE_Q);
  // GATE_Q = true → DETAIL_Q visible pour ce membre, mais jamais répondue.
  S.recordAnswers(sessionId, [{ question_id: gateQId, household_member_id: principalMemberId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ruleSetId = buildAndPublishDetailRuleSet(DETAIL_Q);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);

  assert.equal(missingInfoFor(detail, principalMemberId).length, 1, 'la question est applicable et non répondue : doit rester manquante');
});

// --- C. Même question, visible, réponse status=unknown → missing_information ---

test('LOT 7A-T — C. question member display_condition=true + réponse status=unknown → missing_information', () => {
  const { householdId, principalMemberId } = buildSingleMemberHousehold();
  const { vid, GATE_Q, DETAIL_Q } = buildConditionalQuestionnaire();
  const sessionId = createAndStartSession(householdId, vid);
  const gateQId = findQuestionId(vid, GATE_Q);
  const detailQId = findQuestionId(vid, DETAIL_Q);
  S.recordAnswers(sessionId, [
    { question_id: gateQId, household_member_id: principalMemberId, status: 'answered', value: true },
    { question_id: detailQId, household_member_id: principalMemberId, status: 'unknown' },
  ], rev(sessionId), REQ);
  const ruleSetId = buildAndPublishDetailRuleSet(DETAIL_Q);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);

  assert.equal(missingInfoFor(detail, principalMemberId).length, 1, 'un statut unknown explicite reste une donnée manquante, jamais une conclusion par défaut');
});

// --- D. Foyer 2 membres : A masqué, B visible mais manquant ---

test('LOT 7A-T — D. foyer 2 membres : membre A masqué (rien), membre B visible et manquant (missing_information)', () => {
  const { householdId, principalMemberId, childMemberId } = buildTwoMemberHousehold();
  const { vid, GATE_Q, DETAIL_Q } = buildConditionalQuestionnaire();
  const sessionId = createAndStartSession(householdId, vid);
  const gateQId = findQuestionId(vid, GATE_Q);
  S.recordAnswers(sessionId, [
    { question_id: gateQId, household_member_id: principalMemberId, status: 'answered', value: false }, // A : DETAIL_Q masquée
    { question_id: gateQId, household_member_id: childMemberId, status: 'answered', value: true },       // B : DETAIL_Q visible, jamais répondue
  ], rev(sessionId), REQ);
  const ruleSetId = buildAndPublishDetailRuleSet(DETAIL_Q);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);

  assert.equal(missingInfoFor(detail, principalMemberId).length, 0, 'membre A : question non applicable, jamais manquante');
  assert.equal(missingInfoFor(detail, childMemberId).length, 1, 'membre B : question applicable et non répondue, bien manquante');
  // La donnée manquante de B ne doit jamais empêcher A d'être correctement
  // évalué (jamais un blocage global faute d'un seul membre concerné).
  assert.equal(substantiveFor(detail, principalMemberId).length, 0);
});

// --- E. Même scénario, réponse valide pour B → aucun missing_information pour les deux ---

test('LOT 7A-T — E. foyer 2 membres : membre A masqué, membre B répond → aucun missing_information pour les deux', () => {
  const { householdId, principalMemberId, childMemberId } = buildTwoMemberHousehold();
  const { vid, GATE_Q, DETAIL_Q } = buildConditionalQuestionnaire();
  const sessionId = createAndStartSession(householdId, vid);
  const gateQId = findQuestionId(vid, GATE_Q);
  const detailQId = findQuestionId(vid, DETAIL_Q);
  S.recordAnswers(sessionId, [
    { question_id: gateQId, household_member_id: principalMemberId, status: 'answered', value: false },
    { question_id: gateQId, household_member_id: childMemberId, status: 'answered', value: true },
    { question_id: detailQId, household_member_id: childMemberId, status: 'answered', value: true },
  ], rev(sessionId), REQ);
  const ruleSetId = buildAndPublishDetailRuleSet(DETAIL_Q);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);

  assert.equal(missingInfoFor(detail).length, 0, 'aucun missing_information : A non applicable, B a répondu');
  assert.equal(substantiveFor(detail, childMemberId).length, 1, 'B satisfait la condition (DETAIL_Q=true) : un finding substantif lui est attribué');
  assert.equal(substantiveFor(detail, principalMemberId).length, 0, 'A ne peut jamais satisfaire une condition sur une question qui ne lui est pas applicable');
});

// --- F. Quantificateurs all/any : aucune régression ---

test('LOT 7A-T — F. quantificateur any : composition correcte avec une question masquée pour un seul membre', () => {
  // Reprend exactement le scénario D (déjà `any`) : le résultat de D suffit à
  // couvrir la composition `any` + question conditionnelle. Ce test vérifie
  // en plus que la règle NE SE DÉCLENCHE PAS pour le membre masqué même si
  // l'autre membre, lui, répond positivement — le quantificateur `any` reste
  // porté par membre, jamais une vérité globale contaminée par un autre membre.
  const { householdId, principalMemberId, childMemberId } = buildTwoMemberHousehold();
  const { vid, GATE_Q, DETAIL_Q } = buildConditionalQuestionnaire();
  const sessionId = createAndStartSession(householdId, vid);
  const gateQId = findQuestionId(vid, GATE_Q);
  const detailQId = findQuestionId(vid, DETAIL_Q);
  S.recordAnswers(sessionId, [
    { question_id: gateQId, household_member_id: principalMemberId, status: 'answered', value: false }, // A : masquée
    { question_id: gateQId, household_member_id: childMemberId, status: 'answered', value: true },
    { question_id: detailQId, household_member_id: childMemberId, status: 'answered', value: true },     // B : répond positivement
  ], rev(sessionId), REQ);
  const ruleSetId = buildAndPublishDetailRuleSet(DETAIL_Q);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);

  assert.equal(detail.findings.length, 1, 'un seul finding au total : substantif pour B, rien pour A');
  assert.equal(detail.findings[0].household_member_id, childMemberId);
  assert.equal(detail.findings[0].finding_type, 'detected_need');
});

test('LOT 7A-T — F. quantificateur all : question masquée pour un membre n\'entraîne jamais un missing_information à tort', () => {
  const { householdId, principalMemberId, childMemberId } = buildTwoMemberHousehold();
  const { vid, GATE_Q, DETAIL_Q } = buildConditionalQuestionnaire();
  const sessionId = createAndStartSession(householdId, vid);
  const gateQId = findQuestionId(vid, GATE_Q);
  // Les deux membres ont GATE_Q=false : DETAIL_Q masquée pour les DEUX.
  S.recordAnswers(sessionId, [
    { question_id: gateQId, household_member_id: principalMemberId, status: 'answered', value: false },
    { question_id: gateQId, household_member_id: childMemberId, status: 'answered', value: false },
  ], rev(sessionId), REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-displaycond-all'), domain: 'health', name: 'Ensemble all fictif' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-DETAIL-ALL',
    conditions: { op: 'all', over: 'members', condition: { op: 'equals', ref: { answer: DETAIL_Q }, value: true } },
    required_data: [{ answer: DETAIL_Q }],
    finding_scope: 'member',
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);

  assert.equal(missingInfoFor(detail).length, 0, 'DETAIL_Q non applicable pour les deux membres : jamais manquante');
  assert.equal(substantiveFor(detail).length, 0, 'condition jamais satisfaite (DETAIL_Q non répondue pour personne) : silence, pas un faux positif');
});

// --- Non-régression v1 : sans display_condition, comportement inchangé ---

test('LOT 7A-T — non-régression : question member SANS display_condition, jamais répondue → missing_information (comportement v1 inchangé)', () => {
  const { householdId, principalMemberId } = buildSingleMemberHousehold();
  // Réutilise uniquement GATE_Q (sans display_condition) comme required_data
  // — exactement le cas v1 (aucune des 9 questions historiques n'a de
  // display_condition).
  const { vid, GATE_Q } = buildConditionalQuestionnaire();
  const sessionId = createAndStartSession(householdId, vid);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-noregression'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-GATE-UNCONDITIONAL',
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: GATE_Q }, value: true } },
    required_data: [{ answer: GATE_Q }],
    finding_scope: 'member',
  }), REQ);
  publishHealthRuleSet(ruleSetId);

  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);

  assert.equal(missingInfoFor(detail, principalMemberId).length, 1, 'GATE_Q sans display_condition, non répondue : reste manquante, exactement comme avant LOT 7A-T');
});
