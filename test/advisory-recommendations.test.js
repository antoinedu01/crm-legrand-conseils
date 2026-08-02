// Tests du service de recommandations humaines (Legrand Diagnostic 360,
// Lot 7A). Base de test isolée (CRM_DATA_DIR), jamais data/**. Toutes les
// règles/questionnaires/foyers ici sont fictifs et techniques.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-recommendations-'));

const { default: db } = await import('../server/db.js');
const { createHousehold, addMember, removeMember, updateHousehold, AdvisoryError } = await import('../server/advisoryHouseholds.js');
const Q = await import('../server/advisoryQuestionnaires.js');
const S = await import('../server/advisorySessions.js');
const R = await import('../server/advisoryRules.js');
const E = await import('../server/advisoryRuleExecutions.js');
const REC = await import('../server/advisoryRecommendations.js');

const REQ = { session: { userEmail: 'conseiller-reco@exemple.ch' } };
db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run('conseiller-reco@exemple.ch', 'Conseiller', 'x');

function auditCount(action) {
  return db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?').get(action).n;
}
function auditRowsSince(action, sinceId) {
  return db.prepare('SELECT * FROM audit_log WHERE action = ? AND id > ? ORDER BY id ASC').all(action, sinceId);
}
function maxAuditId() {
  return db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM audit_log').get().id;
}
function rev(sessionId) {
  return db.prepare('SELECT revision FROM advisory_sessions WHERE id = ?').get(sessionId).revision;
}
function recRev(recId) {
  return db.prepare('SELECT revision FROM advisory_recommendations WHERE id = ?').get(recId).revision;
}
function ensureCompleted(sessionId) {
  const status = db.prepare('SELECT status FROM advisory_sessions WHERE id = ?').get(sessionId).status;
  if (status !== 'completed') S.completeSession(sessionId, rev(sessionId), REQ);
}
function uniqueKey(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

let clientCounter = 0;
function insertClient(over = {}) {
  clientCounter += 1;
  const data = { type: 'particulier', first_name: `P${clientCounter}`, last_name: 'Test', status: 'prospect', ...over };
  return db.prepare('INSERT INTO clients (type, first_name, last_name, status) VALUES (?, ?, ?, ?)')
    .run(data.type, data.first_name, data.last_name, data.status).lastInsertRowid;
}

function buildHouseholdWithChild() {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const childClientId = insertClient();
  const { id: childMemberId } = addMember(householdId, { member_role: 'enfant', client_id: childClientId }, REQ);
  const principalMember = db.prepare("SELECT id FROM household_members WHERE household_id = ? AND member_role = 'principal'").get(householdId);
  return { householdId, principalMemberId: principalMember.id, childMemberId };
}

function buildAndPublishQuestionnaire(domain) {
  const householdKey = uniqueKey(`${domain}-menage`);
  const memberKey = uniqueKey(`${domain}-membre`);
  const { id: qid } = Q.createQuestionnaire({ stable_key: uniqueKey(`quest-${domain}`), domain, name: `Démo reco ${domain}` }, REQ);
  const { id: vid } = Q.createDraftVersion(qid, {}, REQ);
  const { id: s1 } = Q.upsertSection(vid, { stable_key: 's_menage', title: 'Foyer', sort_order: 1, applies_to: 'household' }, REQ);
  Q.upsertQuestion(s1, { stable_key: householdKey, advisor_text: 'Question foyer fictive ?', type: 'boolean', sort_order: 1 }, REQ);
  const { id: s2 } = Q.upsertSection(vid, { stable_key: 's_membre', title: 'Membre', sort_order: 2, applies_to: 'member' }, REQ);
  Q.upsertQuestion(s2, { stable_key: memberKey, advisor_text: 'Question membre fictive ?', type: 'boolean', scope: 'member', sort_order: 1 }, REQ);
  Q.publishVersion(vid, REQ);
  return { vid, householdKey, memberKey };
}

function findQuestionId(versionId, stableKey) {
  const detail = Q.getVersionDetail(versionId);
  for (const section of detail.sections) for (const q of section.questions) if (q.stable_key === stableKey) return q.id;
  throw new Error('question introuvable');
}

function validRuleData(overrides = {}) {
  return {
    stable_key: uniqueKey('TEST-RULE-RECO'),
    title: 'Règle technique fictive de recommandation',
    conditions: { op: 'exists', ref: { answer: 'placeholder' } },
    required_data: [],
    result_finding_type: 'detected_need',
    result_payload: { category_hint: 'categorie_reco_fictive' },
    priority: 'medium',
    advisor_explanation: 'Explication technique fictive.',
    source: 'Exemple technique fictif — ne constitue pas un conseil d\'assurance.',
    source_reference: 'REF-RECO-001',
    effective_from: '2020-01-01',
    sort_order: 1,
    ...overrides,
  };
}

function archiveOtherPublishedForDomain(domain, keepRuleSetId) {
  const keep = db.prepare('SELECT stable_key FROM advisory_rule_sets WHERE id = ?').get(keepRuleSetId);
  const others = db.prepare("SELECT id FROM advisory_rule_sets WHERE domain = ? AND status = 'published' AND stable_key != ?").all(domain, keep.stable_key);
  for (const o of others) R.archiveRuleSet(o.id, REQ);
}
function publishForDomain(domain, ruleSetId) {
  archiveOtherPublishedForDomain(domain, ruleSetId);
  return R.publishRuleSet(ruleSetId, REQ);
}

const { householdId, principalMemberId, childMemberId } = buildHouseholdWithChild();
const { vid: healthVersionId, householdKey: HEALTH_Q, memberKey: HEALTH_MEMBER_Q } = buildAndPublishQuestionnaire('health');
const { vid: lifeVersionId, householdKey: LIFE_Q } = buildAndPublishQuestionnaire('life_pension');
const { vid: commonVersionId, householdKey: COMMON_Q } = buildAndPublishQuestionnaire('common');

function createAndStartSession(domain, versionId, hId = householdId) {
  const { id: sessionId } = S.createSession({
    household_id: hId, domain,
    questionnaire_versions: [{ questionnaire_version_id: versionId, domain, module_role: 'domain', display_order: 1 }],
  }, REQ);
  S.startSession(sessionId, rev(sessionId), REQ);
  return sessionId;
}

const DOMAIN_QUESTIONS = { health: { vid: healthVersionId, hh: HEALTH_Q, member: HEALTH_MEMBER_Q }, life_pension: { vid: lifeVersionId, hh: LIFE_Q }, common: { vid: commonVersionId, hh: COMMON_Q } };

// Helper central de ce fichier (proposé par la revue préalable
// backend-test-auditor) : produit une session COMPLETED avec exactement UN
// finding ACTIF, de la portée demandée. Réutilisé par la quasi-totalité des
// tests de service, qui n'ont besoin que d'un point de départ standard.
function createSessionWithActiveFinding(domain, { scope = 'household', memberId = null, householdIdOverride = null } = {}) {
  const { vid, hh, member } = DOMAIN_QUESTIONS[domain];
  const sessionId = createAndStartSession(domain, vid, householdIdOverride || householdId);
  const hhQId = findQuestionId(vid, hh);
  const answers = [{ question_id: hhQId, status: 'answered', value: true }];
  let conditions = { op: 'equals', ref: { answer: hh }, value: true };
  if (scope === 'member') {
    const memberQId = findQuestionId(vid, member);
    answers.push({ question_id: memberQId, household_member_id: memberId || principalMemberId, status: 'answered', value: true });
    conditions = { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: member }, value: true } };
  }
  S.recordAnswers(sessionId, answers, rev(sessionId), REQ);
  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey(`rs-reco-${domain}`), domain, name: 'Ensemble reco fictif' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({ stable_key: uniqueKey('RULE-RECO'), conditions, finding_scope: scope === 'member' ? 'member' : 'household' }), REQ);
  publishForDomain(domain, ruleSetId);
  ensureCompleted(sessionId);
  const result = E.executeRuleSetForSession(sessionId, domain, rev(sessionId), REQ, { rule_set_id: ruleSetId });
  const detail = E.getExecutionDetail(sessionId, result.execution_id);
  assert.equal(detail.findings.length, 1, 'précondition du helper : exactement un finding actif attendu');
  return { sessionId, findingId: detail.findings[0].id, executionId: result.execution_id, ruleSetId, memberId: scope === 'member' ? (memberId || principalMemberId) : null };
}

function baseDraft(sessionId, domain, over = {}) {
  return REC.createRecommendation(sessionId, { domain, scope: 'household', title: 'Titre technique fictif', advisor_rationale: 'Justification technique fictive.', ...over }, REQ);
}

// ============================================================================
// Création
// ============================================================================

test('createRecommendation — session/domain/scope valides produit un brouillon revision=1', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const before = auditCount('recommandation créée');
  const rec = REC.createRecommendation(sessionId, { domain: 'health', scope: 'household', title: 'T', advisor_rationale: 'R' }, REQ);
  assert.equal(rec.status, 'draft');
  assert.equal(rec.revision, 1);
  assert.equal(rec.session_id, sessionId);
  assert.equal(auditCount('recommandation créée'), before + 1);
});

test('createRecommendation — scope=member avec au moins un membre valide', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = REC.createRecommendation(sessionId, { domain: 'health', scope: 'member', member_ids: [principalMemberId], title: 'T', advisor_rationale: 'R' }, REQ);
  assert.deepEqual(rec.member_ids, [principalMemberId]);
});

test('createRecommendation — un ancien membre du snapshot reste ciblable après son départ', () => {
  const { householdId: hId } = buildHouseholdWithChild();
  const otherChildClientId = insertClient();
  const { id: leavingMemberId } = addMember(hId, { member_role: 'enfant', client_id: otherChildClientId }, REQ);
  const { id: sessionId } = S.createSession({ household_id: hId, domain: 'health', questionnaire_versions: [{ questionnaire_version_id: healthVersionId, domain: 'health', module_role: 'domain', display_order: 1 }] }, REQ);
  S.startSession(sessionId, rev(sessionId), REQ);
  removeMember(hId, leavingMemberId, REQ);
  ensureCompleted(sessionId);
  const rec = REC.createRecommendation(sessionId, { domain: 'health', scope: 'member', member_ids: [leavingMemberId], title: 'T', advisor_rationale: 'R' }, REQ);
  assert.deepEqual(rec.member_ids, [leavingMemberId]);
});

test('createRecommendation — un membre ajouté APRÈS le démarrage de la session est refusé (hors snapshot)', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const newClientId = insertClient();
  const { id: newMemberId } = addMember(householdId, { member_role: 'autre_charge', client_id: newClientId }, REQ);
  assert.throws(
    () => REC.createRecommendation(sessionId, { domain: 'health', scope: 'member', member_ids: [newMemberId], title: 'T', advisor_rationale: 'R' }, REQ),
    /périmètre figé/
  );
  // Nettoyage : ne pas laisser ce membre polluer sessionMembersFor des autres tests du même foyer.
  db.prepare("UPDATE household_members SET status = 'archive' WHERE id = ?").run(newMemberId);
});

test('createRecommendation — session non completed refusée (409)', () => {
  const { id: sessionId } = S.createSession({ household_id: householdId, domain: 'health', questionnaire_versions: [{ questionnaire_version_id: healthVersionId, domain: 'health', module_role: 'domain', display_order: 1 }] }, REQ);
  S.startSession(sessionId, rev(sessionId), REQ);
  assert.throws(
    () => REC.createRecommendation(sessionId, { domain: 'health', scope: 'household', title: 'T', advisor_rationale: 'R' }, REQ),
    (e) => e instanceof AdvisoryError && e.status === 409
  );
});

test('createRecommendation — création sans title refusée (400)', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  assert.throws(() => REC.createRecommendation(sessionId, { domain: 'health', scope: 'household', title: '', advisor_rationale: 'R' }, REQ), (e) => e.status === 400);
});

test('createRecommendation — création sans advisor_rationale refusée (400)', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  assert.throws(() => REC.createRecommendation(sessionId, { domain: 'health', scope: 'household', title: 'T', advisor_rationale: '' }, REQ), (e) => e.status === 400);
});

test('createRecommendation — domain=mixed refusé', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  assert.throws(() => REC.createRecommendation(sessionId, { domain: 'mixed', scope: 'household', title: 'T', advisor_rationale: 'R' }, REQ), (e) => e.status === 400);
});

test('createRecommendation — scope=session/household avec member_ids non vide refusé', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  assert.throws(() => REC.createRecommendation(sessionId, { domain: 'health', scope: 'household', member_ids: [principalMemberId], title: 'T', advisor_rationale: 'R' }, REQ), (e) => e.status === 400);
});

test('createRecommendation — foyer archivé refuse la création (409)', () => {
  const { householdId: hId } = buildHouseholdWithChild();
  const { id: sessionId } = S.createSession({ household_id: hId, domain: 'health', questionnaire_versions: [{ questionnaire_version_id: healthVersionId, domain: 'health', module_role: 'domain', display_order: 1 }] }, REQ);
  S.startSession(sessionId, rev(sessionId), REQ);
  ensureCompleted(sessionId);
  updateHousehold(hId, { status: 'archive' }, REQ);
  assert.throws(() => REC.createRecommendation(sessionId, { domain: 'health', scope: 'household', title: 'T', advisor_rationale: 'R' }, REQ), (e) => e.status === 409);
});

// ============================================================================
// Politique foyer archivé — blocage UNIFORME, y compris pour validate/
// dismiss/withdraw (GATE final ciblé §6 : `assertSessionWritable` est
// appelée sans exception par les 10 fonctions d'écriture, tranché par la
// revue `advisory-architect`, documenté dans DATA_MODEL.md). Le brouillon
// (et, pour withdraw, la validation) est construit AVANT l'archivage, pour
// isoler précisément l'action bloquée par le foyer archivé.
// ============================================================================

test('validateRecommendation — foyer archivé après liaison du finding : validation refusée (409)', () => {
  const { householdId: hId } = buildHouseholdWithChild();
  const { sessionId, findingId } = createSessionWithActiveFinding('health', { householdIdOverride: hId });
  const rec = baseDraft(sessionId, 'health', { summary: 'Résumé technique fictif.' });
  const linked = REC.linkFinding(sessionId, rec.id, findingId, rec.revision, REQ);
  updateHousehold(hId, { status: 'archive' }, REQ);
  assert.throws(
    () => REC.validateRecommendation(sessionId, rec.id, { expected_recommendation_revision: linked.revision, expected_session_revision: rev(sessionId) }, REQ),
    (e) => e instanceof AdvisoryError && e.status === 409
  );
});

test('dismissRecommendation — foyer archivé après création du brouillon : écartement refusé (409)', () => {
  const { householdId: hId } = buildHouseholdWithChild();
  const { id: sessionId } = S.createSession({ household_id: hId, domain: 'health', questionnaire_versions: [{ questionnaire_version_id: healthVersionId, domain: 'health', module_role: 'domain', display_order: 1 }] }, REQ);
  S.startSession(sessionId, rev(sessionId), REQ);
  ensureCompleted(sessionId);
  const rec = baseDraft(sessionId, 'health');
  updateHousehold(hId, { status: 'archive' }, REQ);
  assert.throws(
    () => REC.dismissRecommendation(sessionId, rec.id, { dismiss_reason: 'motif fictif', expected_recommendation_revision: rec.revision }, REQ),
    (e) => e instanceof AdvisoryError && e.status === 409
  );
});

test('withdrawRecommendation — foyer archivé après validation : retrait refusé (409)', () => {
  const { householdId: hId } = buildHouseholdWithChild();
  const { sessionId, findingId } = createSessionWithActiveFinding('health', { householdIdOverride: hId });
  const rec = baseDraft(sessionId, 'health', { summary: 'Résumé technique fictif.' });
  const linked = REC.linkFinding(sessionId, rec.id, findingId, rec.revision, REQ);
  const validated = REC.validateRecommendation(sessionId, rec.id, { expected_recommendation_revision: linked.revision, expected_session_revision: rev(sessionId) }, REQ).recommendation;
  updateHousehold(hId, { status: 'archive' }, REQ);
  assert.throws(
    () => REC.withdrawRecommendation(sessionId, rec.id, { withdraw_reason: 'motif fictif', expected_recommendation_revision: validated.revision }, REQ),
    (e) => e instanceof AdvisoryError && e.status === 409
  );
});

// ============================================================================
// Portée et membres — mise à jour atomique
// ============================================================================

test('updateRecommendationDraft — passage household -> member atomique', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  const updated = REC.updateRecommendationDraft(sessionId, rec.id, { scope: 'member', member_ids: [principalMemberId], expected_recommendation_revision: rec.revision }, REQ);
  assert.equal(updated.scope, 'member');
  assert.deepEqual(updated.member_ids, [principalMemberId]);
  assert.equal(updated.revision, rec.revision + 1, 'une seule incrémentation pour la mutation atomique');
});

test('updateRecommendationDraft — passage member -> household atomique (retrait explicite)', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = REC.createRecommendation(sessionId, { domain: 'health', scope: 'member', member_ids: [principalMemberId], title: 'T', advisor_rationale: 'R' }, REQ);
  const updated = REC.updateRecommendationDraft(sessionId, rec.id, { scope: 'household', member_ids: [], expected_recommendation_revision: rec.revision }, REQ);
  assert.equal(updated.scope, 'household');
  assert.deepEqual(updated.member_ids, []);
});

test('updateRecommendationDraft — changement de scope sans member_ids explicite refusé (jamais un retrait implicite)', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = REC.createRecommendation(sessionId, { domain: 'health', scope: 'member', member_ids: [principalMemberId], title: 'T', advisor_rationale: 'R' }, REQ);
  assert.throws(
    () => REC.updateRecommendationDraft(sessionId, rec.id, { scope: 'household', expected_recommendation_revision: rec.revision }, REQ),
    /member_ids/
  );
});

test('updateRecommendationDraft — aucun état intermédiaire invalide persistant après un échec', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  assert.throws(
    () => REC.updateRecommendationDraft(sessionId, rec.id, { scope: 'member', member_ids: [], expected_recommendation_revision: rec.revision }, REQ),
    (e) => e.status === 400
  );
  const reloaded = REC.getRecommendationDetail(sessionId, rec.id, REQ);
  assert.equal(reloaded.scope, 'household', 'la portée ne doit pas avoir changé après un échec de validation');
  assert.equal(reloaded.revision, rec.revision, 'la révision ne doit pas avoir bougé après un échec');
});

test('linkMember/unlinkMember — retrait du dernier membre ciblé refusé', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = REC.createRecommendation(sessionId, { domain: 'health', scope: 'member', member_ids: [principalMemberId], title: 'T', advisor_rationale: 'R' }, REQ);
  assert.throws(
    () => REC.unlinkMember(sessionId, rec.id, principalMemberId, rec.revision, REQ),
    (e) => e.status === 400
  );
});

test('linkMember — ajouter un second membre puis retirer le premier fonctionne (jamais le dernier)', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = REC.createRecommendation(sessionId, { domain: 'health', scope: 'member', member_ids: [principalMemberId], title: 'T', advisor_rationale: 'R' }, REQ);
  const afterAdd = REC.linkMember(sessionId, rec.id, childMemberId, rec.revision, REQ);
  const afterRemove = REC.unlinkMember(sessionId, rec.id, principalMemberId, afterAdd.revision, REQ);
  assert.deepEqual(afterRemove.member_ids, [childMemberId]);
});

test('updateRecommendationDraft — une mutation regroupant plusieurs opérations n’incrémente la révision qu’une seule fois', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  const updated = REC.updateRecommendationDraft(sessionId, rec.id, {
    title: 'Nouveau titre', summary: 'Résumé', scope: 'member', member_ids: [principalMemberId], expected_recommendation_revision: rec.revision,
  }, REQ);
  assert.equal(updated.revision, rec.revision + 1);
  assert.equal(updated.title, 'Nouveau titre');
  assert.equal(updated.scope, 'member');
});

// ============================================================================
// Findings — cohérence domaine et membres
// ============================================================================

test('linkFinding — même session, même domaine acceptés', () => {
  const { sessionId, findingId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  const updated = REC.linkFinding(sessionId, rec.id, findingId, rec.revision, REQ);
  assert.deepEqual(updated.finding_ids, [findingId]);
});

test('linkFinding — finding d’une autre session refusé (404)', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const { findingId: otherFindingId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  assert.throws(() => REC.linkFinding(sessionId, rec.id, otherFindingId, rec.revision, REQ), (e) => e.status === 404);
});

test('linkFinding — finding d’un domaine différent refusé (409)', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const { sessionId: lifeSessionId, findingId: lifeFindingId } = createSessionWithActiveFinding('life_pension');
  const rec = baseDraft(sessionId, 'health');
  assert.throws(() => REC.linkFinding(sessionId, rec.id, lifeFindingId, rec.revision, REQ), (e) => e.status === 404 || e.status === 409);
  void lifeSessionId;
});

test('linkFinding — finding_scope=member ciblant un membre RATTACHÉ à la recommandation accepté', () => {
  const { sessionId, findingId } = createSessionWithActiveFinding('health', { scope: 'member', memberId: principalMemberId });
  const rec = REC.createRecommendation(sessionId, { domain: 'health', scope: 'member', member_ids: [principalMemberId], title: 'T', advisor_rationale: 'R' }, REQ);
  const updated = REC.linkFinding(sessionId, rec.id, findingId, rec.revision, REQ);
  assert.deepEqual(updated.finding_ids, [findingId]);
});

test('linkFinding — finding_scope=member concernant un AUTRE membre que celui ciblé (Alice/Bob) refusé (409)', () => {
  const { sessionId, findingId: bobFindingId } = createSessionWithActiveFinding('health', { scope: 'member', memberId: childMemberId });
  const rec = REC.createRecommendation(sessionId, { domain: 'health', scope: 'member', member_ids: [principalMemberId], title: 'T (destinée à Alice)', advisor_rationale: 'R' }, REQ);
  assert.throws(
    () => REC.linkFinding(sessionId, rec.id, bobFindingId, rec.revision, REQ),
    (e) => e.status === 409
  );
});

test('linkFinding — finding household accepté pour une recommandation scope=member', () => {
  const { sessionId, findingId } = createSessionWithActiveFinding('health', { scope: 'household' });
  const rec = REC.createRecommendation(sessionId, { domain: 'health', scope: 'member', member_ids: [principalMemberId], title: 'T', advisor_rationale: 'R' }, REQ);
  const updated = REC.linkFinding(sessionId, rec.id, findingId, rec.revision, REQ);
  assert.deepEqual(updated.finding_ids, [findingId]);
});

test('linkFinding — finding member autorisé pour une recommandation scope=household, sans ciblage implicite', () => {
  const { sessionId, findingId } = createSessionWithActiveFinding('health', { scope: 'member', memberId: principalMemberId });
  const rec = baseDraft(sessionId, 'health');
  const updated = REC.linkFinding(sessionId, rec.id, findingId, rec.revision, REQ);
  assert.deepEqual(updated.finding_ids, [findingId]);
  assert.deepEqual(updated.member_ids, [], 'le lien du finding ne doit jamais peupler automatiquement les membres ciblés');
});

// ============================================================================
// Révisions — concurrence optimiste propre à la recommandation
// ============================================================================

test('assertExpectedRecommendationRevision — expected_recommendation_revision manquant refusé (400)', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  assert.throws(() => REC.updateRecommendationDraft(sessionId, rec.id, { title: 'X' }, REQ), (e) => e.status === 400);
});

test('assertExpectedRecommendationRevision — révision obsolète refusée (409), aucune écriture', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  assert.throws(
    () => REC.updateRecommendationDraft(sessionId, rec.id, { title: 'X', expected_recommendation_revision: rec.revision + 5 }, REQ),
    (e) => e.status === 409
  );
  assert.equal(recRev(rec.id), rec.revision, 'la révision ne doit pas avoir bougé');
  const reloaded = REC.getRecommendationDetail(sessionId, rec.id, REQ);
  assert.equal(reloaded.title, rec.title, 'le titre ne doit pas avoir changé');
});

test('assertExpectedRecommendationRevision — révision correcte accepte l’écriture', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  const updated = REC.updateRecommendationDraft(sessionId, rec.id, { title: 'X', expected_recommendation_revision: rec.revision }, REQ);
  assert.equal(updated.title, 'X');
});

test('revision — incrémentée sur chaque type de mutation (draft, findings, membres, validation)', () => {
  const { sessionId, findingId } = createSessionWithActiveFinding('health');
  let rec = baseDraft(sessionId, 'health');
  assert.equal(rec.revision, 1);
  rec = REC.updateRecommendationDraft(sessionId, rec.id, { title: 'Y', expected_recommendation_revision: rec.revision }, REQ);
  assert.equal(rec.revision, 2);
  rec = REC.linkFinding(sessionId, rec.id, findingId, rec.revision, REQ);
  assert.equal(rec.revision, 3);
  rec = REC.updateRecommendationDraft(sessionId, rec.id, { summary: 'S', expected_recommendation_revision: rec.revision }, REQ);
  assert.equal(rec.revision, 4);
  const validated = REC.validateRecommendation(sessionId, rec.id, { expected_recommendation_revision: rec.revision, expected_session_revision: rev(sessionId) }, REQ);
  assert.equal(validated.recommendation.revision, 5);
});

// ============================================================================
// Validation
// ============================================================================

function validDraftReadyToValidate(domain = 'health') {
  const { sessionId, findingId } = createSessionWithActiveFinding(domain);
  const rec = REC.createRecommendation(sessionId, { domain, scope: 'household', title: 'T', advisor_rationale: 'R', summary: 'S', finding_ids: [findingId] }, REQ);
  return { sessionId, rec, findingId };
}

test('validateRecommendation — validation normale réussit et fige validated_session_revision', () => {
  const { sessionId, rec } = validDraftReadyToValidate();
  const before = auditCount('recommandation validée');
  const result = REC.validateRecommendation(sessionId, rec.id, { expected_recommendation_revision: rec.revision, expected_session_revision: rev(sessionId) }, REQ);
  assert.equal(result.recommendation.status, 'validated');
  assert.equal(result.recommendation.validated_session_revision, rev(sessionId));
  assert.equal(auditCount('recommandation validée'), before + 1);
});

test('validateRecommendation — session revision obsolète refusée (409), rien n’est écrit', () => {
  const { sessionId, rec } = validDraftReadyToValidate();
  assert.throws(
    () => REC.validateRecommendation(sessionId, rec.id, { expected_recommendation_revision: rec.revision, expected_session_revision: rev(sessionId) + 5 }, REQ),
    (e) => e.status === 409
  );
  assert.equal(db.prepare('SELECT status FROM advisory_recommendations WHERE id = ?').get(rec.id).status, 'draft');
});

test('validateRecommendation — recommendation revision obsolète refusée (409)', () => {
  const { sessionId, rec } = validDraftReadyToValidate();
  assert.throws(
    () => REC.validateRecommendation(sessionId, rec.id, { expected_recommendation_revision: rec.revision + 5, expected_session_revision: rev(sessionId) }, REQ),
    (e) => e.status === 409
  );
});

test('validateRecommendation — finding non active refusé (409)', () => {
  const { sessionId, rec, findingId } = validDraftReadyToValidate();
  E.dismissFinding(sessionId, findingId, { dismiss_reason: 'motif technique fictif', expected_revision: rev(sessionId) }, REQ);
  assert.throws(
    () => REC.validateRecommendation(sessionId, rec.id, { expected_recommendation_revision: rec.revision, expected_session_revision: rev(sessionId) }, REQ),
    (e) => e.status === 409
  );
});

test('validateRecommendation — aucun finding lié refusé (409)', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health', { summary: 'S' });
  assert.throws(
    () => REC.validateRecommendation(sessionId, rec.id, { expected_recommendation_revision: rec.revision, expected_session_revision: rev(sessionId) }, REQ),
    (e) => e.status === 400
  );
});

test('validateRecommendation — portée invalide (member sans membre) refusée avant même les findings', () => {
  const { sessionId, findingId } = createSessionWithActiveFinding('health', { scope: 'member', memberId: principalMemberId });
  const rec = REC.createRecommendation(sessionId, { domain: 'health', scope: 'member', member_ids: [principalMemberId], title: 'T', advisor_rationale: 'R', summary: 'S', finding_ids: [findingId] }, REQ);
  // Retire tous les membres en repassant délibérément par une écriture SQL directe pour simuler un état
  // qui ne devrait normalement jamais se produire (les routes normales l'empêchent) -- vérifie que
  // validateRecommendation reste défensif même si l'invariant était rompu par ailleurs.
  db.prepare('DELETE FROM advisory_recommendation_members WHERE recommendation_id = ?').run(rec.id);
  assert.throws(
    () => REC.validateRecommendation(sessionId, rec.id, { expected_recommendation_revision: rec.revision, expected_session_revision: rev(sessionId) }, REQ),
    (e) => e.status === 400
  );
});

test('validateRecommendation — rollback complet si un contrôle échoue au milieu (aucune trace partielle)', () => {
  const { sessionId, findingId } = createSessionWithActiveFinding('health');
  const rec = REC.createRecommendation(sessionId, { domain: 'health', scope: 'household', title: 'T', advisor_rationale: 'R', summary: 'S', finding_ids: [findingId] }, REQ);
  E.dismissFinding(sessionId, findingId, { dismiss_reason: 'motif fictif', expected_revision: rev(sessionId) }, REQ);
  const beforeAudit = auditCount('recommandation validée');
  assert.throws(() => REC.validateRecommendation(sessionId, rec.id, { expected_recommendation_revision: rec.revision, expected_session_revision: rev(sessionId) }, REQ));
  assert.equal(auditCount('recommandation validée'), beforeAudit, 'aucun audit de succès après un échec');
  const reloaded = db.prepare('SELECT * FROM advisory_recommendations WHERE id = ?').get(rec.id);
  assert.equal(reloaded.status, 'draft');
  assert.equal(reloaded.validated_by_user_id, null);
  assert.equal(reloaded.validated_at, null);
});

test('validateRecommendation — action impossible depuis un statut non-draft (409)', () => {
  const { sessionId, rec } = validDraftReadyToValidate();
  REC.validateRecommendation(sessionId, rec.id, { expected_recommendation_revision: rec.revision, expected_session_revision: rev(sessionId) }, REQ);
  assert.throws(
    () => REC.validateRecommendation(sessionId, rec.id, { expected_recommendation_revision: rec.revision + 1, expected_session_revision: rev(sessionId) }, REQ),
    (e) => e.status === 409
  );
});

// ============================================================================
// Écartement
// ============================================================================

test('dismissRecommendation — transition normale draft -> dismissed', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  const before = auditCount('recommandation écartée');
  const dismissed = REC.dismissRecommendation(sessionId, rec.id, { dismiss_reason: 'motif fictif', expected_recommendation_revision: rec.revision }, REQ);
  assert.equal(dismissed.status, 'dismissed');
  assert.equal(auditCount('recommandation écartée'), before + 1);
});

test('dismissRecommendation — motif obligatoire (400)', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  assert.throws(() => REC.dismissRecommendation(sessionId, rec.id, { dismiss_reason: '', expected_recommendation_revision: rec.revision }, REQ), (e) => e.status === 400);
});

test('dismissRecommendation — concurrence : révision obsolète refusée (409)', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  assert.throws(() => REC.dismissRecommendation(sessionId, rec.id, { dismiss_reason: 'motif', expected_recommendation_revision: rec.revision + 1 }, REQ), (e) => e.status === 409);
});

test('dismissRecommendation — immutabilité après transition (redismiss refusé)', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  const dismissed = REC.dismissRecommendation(sessionId, rec.id, { dismiss_reason: 'motif', expected_recommendation_revision: rec.revision }, REQ);
  assert.throws(() => REC.dismissRecommendation(sessionId, rec.id, { dismiss_reason: 'motif 2', expected_recommendation_revision: dismissed.revision }, REQ), (e) => e.status === 409);
});

// ============================================================================
// Retrait
// ============================================================================

test('withdrawRecommendation — transition normale validated -> withdrawn', () => {
  const { sessionId, rec } = validDraftReadyToValidate();
  const validated = REC.validateRecommendation(sessionId, rec.id, { expected_recommendation_revision: rec.revision, expected_session_revision: rev(sessionId) }, REQ).recommendation;
  const before = auditCount('recommandation retirée');
  const withdrawn = REC.withdrawRecommendation(sessionId, rec.id, { withdraw_reason: 'motif fictif', expected_recommendation_revision: validated.revision }, REQ);
  assert.equal(withdrawn.status, 'withdrawn');
  assert.equal(auditCount('recommandation retirée'), before + 1);
});

test('withdrawRecommendation — motif obligatoire (400)', () => {
  const { sessionId, rec } = validDraftReadyToValidate();
  const validated = REC.validateRecommendation(sessionId, rec.id, { expected_recommendation_revision: rec.revision, expected_session_revision: rev(sessionId) }, REQ).recommendation;
  assert.throws(() => REC.withdrawRecommendation(sessionId, rec.id, { withdraw_reason: '', expected_recommendation_revision: validated.revision }, REQ), (e) => e.status === 400);
});

test('withdrawRecommendation — un brouillon (draft) ne peut pas être retiré (409)', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  assert.throws(() => REC.withdrawRecommendation(sessionId, rec.id, { withdraw_reason: 'motif', expected_recommendation_revision: rec.revision }, REQ), (e) => e.status === 409);
});

test('withdrawRecommendation — contenu historique reste immuable', () => {
  const { sessionId, rec } = validDraftReadyToValidate();
  const validated = REC.validateRecommendation(sessionId, rec.id, { expected_recommendation_revision: rec.revision, expected_session_revision: rev(sessionId) }, REQ).recommendation;
  REC.withdrawRecommendation(sessionId, rec.id, { withdraw_reason: 'motif', expected_recommendation_revision: validated.revision }, REQ);
  const row = db.prepare('SELECT * FROM advisory_recommendations WHERE id = ?').get(rec.id);
  assert.equal(row.title, rec.title);
  assert.equal(row.advisor_rationale, rec.advisor_rationale);
  assert.equal(row.validated_session_revision, validated.validated_session_revision);
});

// ============================================================================
// Remplacement
// ============================================================================

function validatedRecommendation(domain = 'health') {
  const { sessionId, rec } = validDraftReadyToValidate(domain);
  const validated = REC.validateRecommendation(sessionId, rec.id, { expected_recommendation_revision: rec.revision, expected_session_revision: rev(sessionId) }, REQ).recommendation;
  return { sessionId, source: validated };
}

test('createReplacement — création normale : brouillon draft, supersedes_recommendation_id renseigné, domaine hérité', () => {
  const { sessionId, source } = validatedRecommendation();
  const replacement = REC.createReplacement(sessionId, source.id, {
    expected_source_recommendation_revision: source.revision, title: 'Version corrigée', advisor_rationale: 'R2', scope: 'household',
  }, REQ);
  assert.equal(replacement.status, 'draft');
  assert.equal(replacement.supersedes_recommendation_id, source.id);
  assert.equal(replacement.domain, source.domain);
});

test('createReplacement — source non validated refusée (draft)', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const draft = baseDraft(sessionId, 'health');
  assert.throws(
    () => REC.createReplacement(sessionId, draft.id, { expected_source_recommendation_revision: draft.revision, title: 'X', advisor_rationale: 'R', scope: 'household' }, REQ),
    (e) => e.status === 400
  );
});

test('createReplacement — révision de la source obsolète refusée (409)', () => {
  const { sessionId, source } = validatedRecommendation();
  assert.throws(
    () => REC.createReplacement(sessionId, source.id, { expected_source_recommendation_revision: source.revision + 5, title: 'X', advisor_rationale: 'R', scope: 'household' }, REQ),
    (e) => e.status === 409
  );
});

test('createReplacement — premier brouillon de remplacement dismissed puis nouveau remplacement autorisé', () => {
  const { sessionId, source } = validatedRecommendation();
  const first = REC.createReplacement(sessionId, source.id, { expected_source_recommendation_revision: source.revision, title: 'Essai 1', advisor_rationale: 'R', scope: 'household' }, REQ);
  REC.dismissRecommendation(sessionId, first.id, { dismiss_reason: 'motif fictif', expected_recommendation_revision: first.revision }, REQ);
  const second = REC.createReplacement(sessionId, source.id, { expected_source_recommendation_revision: source.revision, title: 'Essai 2', advisor_rationale: 'R', scope: 'household' }, REQ);
  assert.equal(second.status, 'draft');
  assert.equal(second.supersedes_recommendation_id, source.id);
});

test('createReplacement — deux successeurs NON dismissed simultanés refusés (409)', () => {
  const { sessionId, source } = validatedRecommendation();
  REC.createReplacement(sessionId, source.id, { expected_source_recommendation_revision: source.revision, title: 'Essai 1', advisor_rationale: 'R', scope: 'household' }, REQ);
  assert.throws(
    () => REC.createReplacement(sessionId, source.id, { expected_source_recommendation_revision: source.revision, title: 'Essai 2', advisor_rationale: 'R', scope: 'household' }, REQ),
    (e) => e.status === 409
  );
});

test('validateRecommendation (remplacement) — bascule atomique : ancienne superseded, nouvelle validated, révisions des deux augmentées', () => {
  const { sessionId, source } = validatedRecommendation();
  const replacement = REC.createReplacement(sessionId, source.id, { expected_source_recommendation_revision: source.revision, title: 'Version corrigée', advisor_rationale: 'R2', scope: 'household' }, REQ);
  // Le remplacement doit lui-même citer un finding valide de la MÊME session/domaine que la source.
  const sourceSessionFinding = db.prepare(
    `SELECT f.id FROM advisory_findings f WHERE f.session_id = ? AND f.domain = ? AND f.status = 'active' LIMIT 1`
  ).get(sessionId, source.domain);
  const withFinding = REC.linkFinding(sessionId, replacement.id, sourceSessionFinding.id, replacement.revision, REQ);
  const withSummary = REC.updateRecommendationDraft(sessionId, replacement.id, { summary: 'S2', expected_recommendation_revision: withFinding.revision }, REQ);

  const beforeReplacedAudit = auditCount('recommandation remplacée');
  const result = REC.validateRecommendation(sessionId, replacement.id, { expected_recommendation_revision: withSummary.revision, expected_session_revision: rev(sessionId) }, REQ);
  assert.equal(result.recommendation.status, 'validated');
  assert.equal(result.supersedes.status, 'superseded');
  assert.equal(result.supersedes.revision, source.revision + 1);
  assert.equal(auditCount('recommandation remplacée'), beforeReplacedAudit + 1);
  const reloadedSource = db.prepare('SELECT status FROM advisory_recommendations WHERE id = ?').get(source.id);
  assert.equal(reloadedSource.status, 'superseded');
});

test('createReplacement — pré-condition : la source reste validated et la nouvelle reste draft si les contrôles échouent AVANT la transaction', () => {
  const { sessionId, source } = validatedRecommendation();
  const replacement = REC.createReplacement(sessionId, source.id, { expected_source_recommendation_revision: source.revision, title: 'X', advisor_rationale: 'R', scope: 'household' }, REQ);
  // Aucun finding lié -> la validation échoue AVANT la transaction (contrôle
  // "au moins un finding"), prouvant que les pré-conditions bloquent bien
  // toute écriture avant même l'ouverture de la transaction.
  assert.throws(() => REC.validateRecommendation(sessionId, replacement.id, {
    expected_recommendation_revision: replacement.revision, expected_session_revision: rev(sessionId),
  }, REQ));
  assert.equal(db.prepare('SELECT status FROM advisory_recommendations WHERE id = ?').get(source.id).status, 'validated');
  assert.equal(db.prepare('SELECT status FROM advisory_recommendations WHERE id = ?').get(replacement.id).status, 'draft');
});

// Correctif (revue finale backend-test-auditor) : le test ci-dessus ne
// prouve qu'un échec AVANT l'ouverture de la transaction (pré-condition).
// Celui-ci force un échec RÉEL entre les deux UPDATE de la transaction de
// validateRecommendation (l'ancienne recommandation passe déjà à
// "superseded" avant que le déclencheur n'interrompe la seconde écriture)
// -- même technique que le rollback forcé du Lot 4A
// (test/advisory-rules.test.js, publishRuleSet) : déclencheur SQL temporaire
// (RAISE(ABORT, ...)), local à ce test, jamais un mécanisme ajouté au code
// de production, supprimé immédiatement après usage.
test('validateRecommendation (remplacement) — rollback forcé : un échec ENTRE les deux UPDATE de la transaction annule TOUT, y compris la supersession déjà exécutée', () => {
  const { sessionId, source } = validatedRecommendation();
  const replacement = REC.createReplacement(sessionId, source.id, { expected_source_recommendation_revision: source.revision, title: 'X', advisor_rationale: 'R', summary: 'S', scope: 'household' }, REQ);
  const sourceSessionFinding = db.prepare(`SELECT f.id FROM advisory_findings f WHERE f.session_id = ? AND f.domain = ? AND f.status = 'active' LIMIT 1`).get(sessionId, source.domain);
  const withFinding = REC.linkFinding(sessionId, replacement.id, sourceSessionFinding.id, replacement.revision, REQ);

  const beforeValidatedAudit = auditCount('recommandation validée');
  const beforeReplacedAudit = auditCount('recommandation remplacée');

  db.exec(`
    CREATE TRIGGER trg_force_rollback_reco_test
    BEFORE UPDATE OF validated_at ON advisory_recommendations
    WHEN NEW.id = ${replacement.id}
    BEGIN
      SELECT RAISE(ABORT, 'échec forcé pour test de rollback (LOT 7A, revue finale)');
    END;
  `);
  try {
    assert.throws(
      () => REC.validateRecommendation(sessionId, replacement.id, { expected_recommendation_revision: withFinding.revision, expected_session_revision: rev(sessionId) }, REQ),
      /échec forcé pour test de rollback/
    );
  } finally {
    db.exec('DROP TRIGGER trg_force_rollback_reco_test');
  }

  // La source, dont l'UPDATE vers "superseded" s'est bien exécuté EN
  // PREMIER dans la transaction, doit être revenue à "validated" -- la
  // preuve que le rollback annule aussi une écriture déjà effectuée avant
  // l'échec, pas seulement la dernière.
  const reloadedSource = db.prepare('SELECT status, revision FROM advisory_recommendations WHERE id = ?').get(source.id);
  assert.equal(reloadedSource.status, 'validated', 'la supersession déjà exécutée doit être annulée par le rollback');
  assert.equal(reloadedSource.revision, source.revision, 'la révision de la source ne doit pas avoir bougé après rollback');
  const reloadedReplacement = db.prepare('SELECT status, validated_at FROM advisory_recommendations WHERE id = ?').get(replacement.id);
  assert.equal(reloadedReplacement.status, 'draft', 'le remplacement ne doit jamais rester "validated" après un rollback');
  assert.equal(reloadedReplacement.validated_at, null, 'la toute dernière écriture avortée ne doit laisser aucune trace');
  assert.equal(auditCount('recommandation validée'), beforeValidatedAudit, 'aucun audit de succès après un rollback');
  assert.equal(auditCount('recommandation remplacée'), beforeReplacedAudit, 'aucun audit de remplacement après un rollback');
});

test('createReplacement — la source est modifiée (retirée) entre la création du remplacement et sa validation : refus 409, rien n’est écrit', () => {
  const { sessionId, source } = validatedRecommendation();
  const replacement = REC.createReplacement(sessionId, source.id, { expected_source_recommendation_revision: source.revision, title: 'X', advisor_rationale: 'R', summary: 'S', scope: 'household' }, REQ);
  const sourceSessionFinding = db.prepare(`SELECT f.id FROM advisory_findings f WHERE f.session_id = ? AND f.domain = ? AND f.status = 'active' LIMIT 1`).get(sessionId, source.domain);
  const withFinding = REC.linkFinding(sessionId, replacement.id, sourceSessionFinding.id, replacement.revision, REQ);
  const withdrawnSource = REC.withdrawRecommendation(sessionId, source.id, { withdraw_reason: 'motif fictif', expected_recommendation_revision: source.revision }, REQ);
  void withdrawnSource;
  assert.throws(
    () => REC.validateRecommendation(sessionId, replacement.id, { expected_recommendation_revision: withFinding.revision, expected_session_revision: rev(sessionId) }, REQ),
    (e) => e.status === 409
  );
  assert.equal(db.prepare('SELECT status FROM advisory_recommendations WHERE id = ?').get(replacement.id).status, 'draft');
});

test('index unique partiel — deux connexions SQLite réelles : la seconde createReplacement concurrente échoue par contrainte SQLite', () => {
  const { sessionId, source } = validatedRecommendation();
  const dataFile = path.join(process.env.CRM_DATA_DIR, 'crm.sqlite');
  const dbA = new Database(dataFile);
  const dbB = new Database(dataFile);
  dbA.pragma('busy_timeout = 200');
  dbB.pragma('busy_timeout = 200');
  try {
    dbA.exec('BEGIN IMMEDIATE');
    dbA.prepare(
      `INSERT INTO advisory_recommendations (session_id, domain, scope, status, revision, title, advisor_rationale, created_by_user_id, supersedes_recommendation_id)
       VALUES (?, ?, 'household', 'draft', 1, 'Concurrent A', 'R', 1, ?)`
    ).run(sessionId, source.domain, source.id);

    assert.throws(() => {
      dbB.exec('BEGIN IMMEDIATE');
      dbB.prepare(
        `INSERT INTO advisory_recommendations (session_id, domain, scope, status, revision, title, advisor_rationale, created_by_user_id, supersedes_recommendation_id)
         VALUES (?, ?, 'household', 'draft', 1, 'Concurrent B', 'R', 1, ?)`
      ).run(sessionId, source.domain, source.id);
    }, (e) => e.code === 'SQLITE_BUSY');
    try { dbB.exec('ROLLBACK'); } catch { /* déjà annulée par SQLITE_BUSY */ }

    dbA.exec('COMMIT');

    assert.throws(() => {
      dbB.prepare(
        `INSERT INTO advisory_recommendations (session_id, domain, scope, status, revision, title, advisor_rationale, created_by_user_id, supersedes_recommendation_id)
         VALUES (?, ?, 'household', 'draft', 1, 'Concurrent C', 'R', 1, ?)`
      ).run(sessionId, source.domain, source.id);
    }, (e) => e.code === 'SQLITE_CONSTRAINT_UNIQUE');
  } finally {
    dbA.close();
    dbB.close();
  }
});

// ============================================================================
// Déclarations explicites « rien identifié »
// ============================================================================

test('déclarations explicites — non renseigné : flag=0, texte vide', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  assert.equal(rec.no_alternatives_identified, false);
  assert.equal(rec.alternatives_considered, null);
});

test('déclarations explicites — examiné mais rien identifié : flag=1, texte vide', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  const updated = REC.updateRecommendationDraft(sessionId, rec.id, { no_alternatives_identified: true, expected_recommendation_revision: rec.revision }, REQ);
  assert.equal(updated.no_alternatives_identified, true);
  assert.equal(updated.alternatives_considered, null);
});

test('déclarations explicites — texte effectivement rédigé : flag=0, texte renseigné', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  const updated = REC.updateRecommendationDraft(sessionId, rec.id, { alternatives_considered: 'Option B envisagée.', expected_recommendation_revision: rec.revision }, REQ);
  assert.equal(updated.no_alternatives_identified, false);
  assert.equal(updated.alternatives_considered, 'Option B envisagée.');
});

test('déclarations explicites — incompatibilité alternatives : texte + flag=1 refusé', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  assert.throws(
    () => REC.updateRecommendationDraft(sessionId, rec.id, { alternatives_considered: 'Texte', no_alternatives_identified: true, expected_recommendation_revision: rec.revision }, REQ),
    (e) => e.status === 400
  );
});

test('déclarations explicites — incompatibilité risques : texte + flag=1 refusé', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  assert.throws(
    () => REC.updateRecommendationDraft(sessionId, rec.id, { risks: 'Texte', no_additional_risks_identified: true, expected_recommendation_revision: rec.revision }, REQ),
    (e) => e.status === 400
  );
});

test('déclarations explicites — incompatibilité informations manquantes : texte + flag=1 refusé', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  assert.throws(
    () => REC.updateRecommendationDraft(sessionId, rec.id, { missing_information: 'Texte', no_missing_information_known: true, expected_recommendation_revision: rec.revision }, REQ),
    (e) => e.status === 400
  );
});

test('déclarations explicites — alternative_rejection_reason renseigné avec no_alternatives_identified=1 également refusé', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  assert.throws(
    () => REC.updateRecommendationDraft(sessionId, rec.id, { alternative_rejection_reason: 'Texte', no_alternatives_identified: true, expected_recommendation_revision: rec.revision }, REQ),
    (e) => e.status === 400
  );
});

test('déclarations explicites — jamais renseignées automatiquement par le moteur (absentes après une simple création)', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  assert.equal(rec.no_alternatives_identified, false);
  assert.equal(rec.no_additional_risks_identified, false);
  assert.equal(rec.no_missing_information_known, false);
});

// ============================================================================
// Obsolescence dérivée
// ============================================================================

test('potentially_stale — false juste après validation', () => {
  const { sessionId, source } = validatedRecommendation();
  const detail = REC.getRecommendationDetail(sessionId, source.id, REQ);
  assert.equal(detail.potentially_stale, false);
});

test('potentially_stale — devient true quand la session est amendée (revision change) après validation', () => {
  const { sessionId, source } = validatedRecommendation();
  const hhQId = findQuestionId(healthVersionId, HEALTH_Q);
  S.amendAnswer(sessionId, { question_id: hhQId, status: 'answered', value: false, amendment_reason: 'Correction fictive', expected_revision: rev(sessionId) }, REQ);
  const detail = REC.getRecommendationDetail(sessionId, source.id, REQ);
  assert.equal(detail.potentially_stale, true);
});

test('potentially_stale — devient true quand un finding cité est écarté après validation', () => {
  const { sessionId, rec, findingId } = validDraftReadyToValidate();
  const validated = REC.validateRecommendation(sessionId, rec.id, { expected_recommendation_revision: rec.revision, expected_session_revision: rev(sessionId) }, REQ).recommendation;
  assert.equal(REC.getRecommendationDetail(sessionId, validated.id, REQ).potentially_stale, false);
  E.dismissFinding(sessionId, findingId, { dismiss_reason: 'motif fictif', expected_revision: rev(sessionId) }, REQ);
  assert.equal(REC.getRecommendationDetail(sessionId, validated.id, REQ).potentially_stale, true);
});

test('potentially_stale — devient true quand l’exécution source est supersédée par une réexécution', () => {
  const { sessionId, rec, findingId } = validDraftReadyToValidate();
  void findingId;
  const validated = REC.validateRecommendation(sessionId, rec.id, { expected_recommendation_revision: rec.revision, expected_session_revision: rev(sessionId) }, REQ).recommendation;
  const hhQId = findQuestionId(healthVersionId, HEALTH_Q);
  S.amendAnswer(sessionId, { question_id: hhQId, status: 'answered', value: true, amendment_reason: 'Re-confirmation fictive', expected_revision: rev(sessionId) }, REQ);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, {});
  const detail = REC.getRecommendationDetail(sessionId, validated.id, REQ);
  assert.equal(detail.potentially_stale, true);
});

test('potentially_stale — aucun changement automatique de statut malgré l’obsolescence', () => {
  const { sessionId, source } = validatedRecommendation();
  const hhQId = findQuestionId(healthVersionId, HEALTH_Q);
  S.amendAnswer(sessionId, { question_id: hhQId, status: 'answered', value: false, amendment_reason: 'Correction fictive', expected_revision: rev(sessionId) }, REQ);
  const row = db.prepare('SELECT status FROM advisory_recommendations WHERE id = ?').get(source.id);
  assert.equal(row.status, 'validated', 'jamais de bascule automatique malgré potentially_stale');
});

test('potentially_stale — toujours false pour un brouillon (draft), aucune notion d’obsolescence avant validation', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const rec = baseDraft(sessionId, 'health');
  assert.equal(REC.getRecommendationDetail(sessionId, rec.id, REQ).potentially_stale, false);
});

// ============================================================================
// Audits — minimisation et déduplication
// ============================================================================

// Correctif (revue finale compliance-privacy-reviewer + backend-test-auditor) :
// la version précédente de ce test n'exerçait réellement que 8 des 13
// actions d'audit avec le marqueur, les 5 autres n'étant vérifiées que par
// `auditCount` (présence), jamais par une vérification d'absence de fuite.
// Corrigé : les 13 actions sont maintenant TOUTES déclenchées avec le
// marqueur dans les champs narratifs concernés, et le test vérifie
// explicitement que les 13 noms d'action apparaissent bien dans la fenêtre
// auditée (pas seulement qu'aucune fuite n'a été trouvée parmi ce qui a pu
// se déclencher par hasard).
test('audit — les 13 actions sont toutes exercées et ne journalisent jamais de contenu narratif (marqueur distinctif absent de audit_log.details)', () => {
  const marker = 'MARQUEUR-DISTINCTIF-RECO-' + Math.random().toString(36).slice(2);
  const sinceId = maxAuditId();
  const ALL_ACTIONS = [
    'recommandation créée', 'recommandation modifiée', 'recommandation validée', 'recommandation écartée',
    'recommandation retirée', 'recommandation remplacée', 'consultation recommandations session',
    'consultation recommandations sensibles', 'consultation historique recommandations',
    'finding lié', 'finding délié', 'membre lié', 'membre délié',
  ];

  // --- création, findings, modification, validation, remplacement (créée/modifiée/validée/remplacée/finding lié/finding délié) ---
  const { sessionId, findingId } = createSessionWithActiveFinding('health');
  const rec = REC.createRecommendation(sessionId, {
    domain: 'health', scope: 'household', title: marker, advisor_rationale: marker, summary: marker,
    expected_benefits: marker, limitations: marker, risks: marker, alternatives_considered: marker,
    alternative_rejection_reason: marker, missing_information: marker, warnings: marker, reservations: marker,
  }, REQ);
  const afterLink = REC.linkFinding(sessionId, rec.id, findingId, rec.revision, REQ);
  const afterUnlink = REC.unlinkFinding(sessionId, rec.id, findingId, afterLink.revision, REQ);
  const afterRelink = REC.linkFinding(sessionId, rec.id, findingId, afterUnlink.revision, REQ);
  const afterModify = REC.updateRecommendationDraft(sessionId, rec.id, { title: marker + '-v2', expected_recommendation_revision: afterRelink.revision }, REQ);
  const validated = REC.validateRecommendation(sessionId, rec.id, { expected_recommendation_revision: afterModify.revision, expected_session_revision: rev(sessionId) }, REQ).recommendation;

  const replacement = REC.createReplacement(sessionId, validated.id, {
    expected_source_recommendation_revision: validated.revision, title: marker, advisor_rationale: marker, summary: marker, scope: 'household',
  }, REQ);
  const replacementWithFinding = REC.linkFinding(sessionId, replacement.id, findingId, replacement.revision, REQ);
  REC.validateRecommendation(sessionId, replacement.id, { expected_recommendation_revision: replacementWithFinding.revision, expected_session_revision: rev(sessionId) }, REQ);

  // --- retrait (retirée), sur une recommandation validée distincte ---
  const { sessionId: sessionIdWithdraw, findingId: findingIdWithdraw } = createSessionWithActiveFinding('health');
  const recToWithdraw = REC.createRecommendation(sessionIdWithdraw, {
    domain: 'health', scope: 'household', title: marker, advisor_rationale: marker, summary: marker, finding_ids: [findingIdWithdraw],
  }, REQ);
  const validatedToWithdraw = REC.validateRecommendation(sessionIdWithdraw, recToWithdraw.id, { expected_recommendation_revision: recToWithdraw.revision, expected_session_revision: rev(sessionIdWithdraw) }, REQ).recommendation;
  REC.withdrawRecommendation(sessionIdWithdraw, recToWithdraw.id, { withdraw_reason: marker, expected_recommendation_revision: validatedToWithdraw.revision }, REQ);

  // --- écartement (écartée) ---
  const { sessionId: sessionId2 } = createSessionWithActiveFinding('health');
  const draft2 = baseDraft(sessionId2, 'health', { title: marker, advisor_rationale: marker });
  REC.dismissRecommendation(sessionId2, draft2.id, { dismiss_reason: marker, expected_recommendation_revision: draft2.revision }, REQ);

  // --- membres (membre lié / membre délié) ---
  const { sessionId: sessionId3 } = createSessionWithActiveFinding('health');
  const memberRec = REC.createRecommendation(sessionId3, { domain: 'health', scope: 'member', member_ids: [principalMemberId], title: marker, advisor_rationale: marker }, REQ);
  const afterMemberLink = REC.linkMember(sessionId3, memberRec.id, childMemberId, memberRec.revision, REQ);
  REC.unlinkMember(sessionId3, memberRec.id, childMemberId, afterMemberLink.revision, REQ);

  // --- consultation recommandations sensibles (session dédiée pour éviter toute déduplication croisée) ---
  const { sessionId: sessionId4, findingId: findingId4 } = createSessionWithActiveFinding('health');
  db.prepare("UPDATE advisory_findings SET used_inputs_ref = '[{\"kind\":\"answer\",\"sensitivity_at_execution\":true}]' WHERE id = ?").run(findingId4);
  const sensitiveRec = REC.createRecommendation(sessionId4, { domain: 'health', scope: 'household', title: marker, advisor_rationale: marker, finding_ids: [findingId4] }, REQ);
  REC.getRecommendationDetail(sessionId4, sensitiveRec.id, REQ);

  // --- consultations ordinaires (session/historique) ---
  REC.getSessionRecommendationsList(sessionId, {}, REQ);
  REC.getSessionRecommendationsHistory(sessionId, {}, REQ);
  REC.getRecommendationDetail(sessionId, rec.id, REQ);

  const rows = db.prepare('SELECT action, details FROM audit_log WHERE id > ?').all(sinceId);
  for (const row of rows) {
    assert.ok(!String(row.details || '').includes(marker), `fuite détectée dans audit_log.details (action « ${row.action} ») : ${row.details}`);
  }
  const seenActions = new Set(rows.map((r) => r.action));
  for (const action of ALL_ACTIONS) {
    assert.ok(seenActions.has(action), `action « ${action} » jamais déclenchée par ce scénario -- couverture incomplète`);
  }
});

test('audit — consultation recommandations session dédupliquée sur 15 minutes', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const before = auditCount('consultation recommandations session');
  REC.getSessionRecommendationsList(sessionId, {}, REQ);
  REC.getSessionRecommendationsList(sessionId, {}, REQ);
  REC.getSessionRecommendationsList(sessionId, {}, REQ);
  assert.equal(auditCount('consultation recommandations session'), before + 1, 'trois lectures rapprochées ne doivent produire qu’UNE seule entrée');
});

test('audit — consultation historique recommandations toujours journalisée, jamais dédupliquée', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const before = auditCount('consultation historique recommandations');
  REC.getSessionRecommendationsHistory(sessionId, {}, REQ);
  REC.getSessionRecommendationsHistory(sessionId, {}, REQ);
  assert.equal(auditCount('consultation historique recommandations'), before + 2);
});

test('audit — consultation recommandations sensibles dérivée : recommandation citant un finding sensible', () => {
  const { sessionId, findingId } = createSessionWithActiveFinding('health');
  db.prepare(
    "UPDATE advisory_findings SET used_inputs_ref = '[{\"kind\":\"answer\",\"sensitivity_at_execution\":true}]' WHERE id = ?"
  ).run(findingId);
  const rec = baseDraft(sessionId, 'health');
  REC.linkFinding(sessionId, rec.id, findingId, rec.revision, REQ);
  const before = auditCount('consultation recommandations sensibles');
  REC.getRecommendationDetail(sessionId, rec.id, REQ);
  assert.equal(auditCount('consultation recommandations sensibles'), before + 1);
});

test('audit — consultation recommandations sensibles évaluée sur TOUS les statuts du finding cité, pas seulement actif', () => {
  const { sessionId, findingId } = createSessionWithActiveFinding('health');
  db.prepare(
    "UPDATE advisory_findings SET used_inputs_ref = '[{\"kind\":\"answer\",\"sensitivity_at_execution\":true}]' WHERE id = ?"
  ).run(findingId);
  const rec = baseDraft(sessionId, 'health');
  REC.linkFinding(sessionId, rec.id, findingId, rec.revision, REQ);
  E.dismissFinding(sessionId, findingId, { dismiss_reason: 'motif fictif', expected_revision: rev(sessionId) }, REQ);
  const before = auditCount('consultation recommandations sensibles');
  REC.getRecommendationDetail(sessionId, rec.id, REQ);
  assert.equal(auditCount('consultation recommandations sensibles'), before + 1, 'la sensibilité reste figée même après écartement du finding');
});

test('audit — recommandation créée attribue le bon utilisateur (jamais système)', () => {
  const { sessionId } = createSessionWithActiveFinding('health');
  const sinceId = maxAuditId();
  baseDraft(sessionId, 'health');
  const rows = auditRowsSince('recommandation créée', sinceId);
  assert.ok(rows.length >= 1);
  assert.equal(rows[rows.length - 1].user_email, 'conseiller-reco@exemple.ch');
});

test('IDOR — une recommandation adressée avec le mauvais session_id est introuvable (404)', () => {
  const { sessionId: sessionA } = createSessionWithActiveFinding('health');
  const { sessionId: sessionB } = createSessionWithActiveFinding('health');
  const recA = baseDraft(sessionA, 'health');
  assert.throws(() => REC.getRecommendationDetail(sessionB, recA.id, REQ), (e) => e.status === 404);
});
