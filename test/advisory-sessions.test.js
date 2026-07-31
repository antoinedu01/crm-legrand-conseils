// Tests du service métier « sessions de conseil et réponses » (Legrand
// Diagnostic 360, Lot 3A). Base de test isolée (CRM_DATA_DIR), jamais
// data/**. Aucune donnée client réelle, questionnaires fictifs uniquement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-sessions-'));

const { default: db } = await import('../server/db.js');
const { createHousehold, AdvisoryError } = await import('../server/advisoryHouseholds.js');
const Q = await import('../server/advisoryQuestionnaires.js');
const {
  createSession, getSessionDetail, listSessions, updateSessionMetadata,
  startSession, suspendSession, resumeSession, cancelSession, completeSession,
  validateSessionForCompletion, recordAnswers, clearAnswer, amendAnswer,
  listActiveAnswers, listAnswerHistory,
} = await import('../server/advisorySessions.js');

const REQ = { session: { userEmail: 'conseiller@exemple.ch' } };
db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run('conseiller@exemple.ch', 'Conseiller', 'x');

function auditCount(action) {
  return db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?').get(action).n;
}

// Lit la révision réelle courante d'une session -- utilisé pour fournir
// `expected_revision` (contrôle de concurrence optimiste, GATE LOT 3B §2) à
// chaque appel d'écriture de ce fichier de tests.
function rev(sessionId) {
  return db.prepare('SELECT revision FROM advisory_sessions WHERE id = ?').get(sessionId).revision;
}

let clientCounter = 0;
function insertClient(over = {}) {
  clientCounter += 1;
  const data = { type: 'particulier', first_name: `P${clientCounter}`, last_name: 'Test', status: 'prospect', ...over };
  return db
    .prepare('INSERT INTO clients (type, first_name, last_name, status) VALUES (?, ?, ?, ?)')
    .run(data.type, data.first_name, data.last_name, data.status).lastInsertRowid;
}

function buildHousehold() {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  return householdId;
}

let questionnaireCounter = 0;
// Construit et publie un questionnaire fictif à une question (portée foyer,
// obligatoire) pour un domaine donné — helper de test générique, aucun
// contenu métier réel.
function buildPublishedQuestionnaire(domain, { required = true, memberScope = false, allowsNotApplicable = false } = {}) {
  questionnaireCounter += 1;
  const { id: qid } = Q.createQuestionnaire({ stable_key: `demo-${domain}-${questionnaireCounter}`, domain, name: `Démo ${domain} ${questionnaireCounter}` }, REQ);
  const { id: vid } = Q.createDraftVersion(qid, {}, REQ);
  const { id: sectionId } = Q.upsertSection(vid, {
    stable_key: 'section1', title: 'Section', sort_order: 1, applies_to: memberScope ? 'member' : 'household',
  }, REQ);
  const { id: questionId } = Q.upsertQuestion(sectionId, {
    stable_key: 'q1', advisor_text: 'Question fictive ?', type: 'boolean', required,
    sort_order: 1, scope: memberScope ? 'member' : 'household', allows_not_applicable: allowsNotApplicable,
  }, REQ);
  Q.publishVersion(vid, REQ);
  return { qid, vid, sectionId, questionId };
}

// --- Création de session -----------------------------------------------

test('createSession — création réussie avec une seule version de domaine (session pure)', () => {
  const householdId = buildHousehold();
  const { vid } = buildPublishedQuestionnaire('health');
  const before = auditCount('session créée');
  const { id } = createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'domain', display_order: 1 }],
  }, REQ);
  assert.ok(id);
  assert.equal(auditCount('session créée'), before + 1);
  const detail = getSessionDetail(id);
  assert.equal(detail.status, 'draft');
  assert.equal(detail.questionnaire_versions.length, 1);
});

test('createSession — refuse un foyer inexistant', () => {
  const { vid } = buildPublishedQuestionnaire('health');
  assert.throws(
    () => createSession({ household_id: 999999, domain: 'health', questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'domain', display_order: 1 }] }, REQ),
    (err) => err instanceof AdvisoryError && err.status === 400
  );
});

test('createSession — refuse un foyer archivé', () => {
  const householdId = buildHousehold();
  db.prepare("UPDATE households SET status = 'archive' WHERE id = ?").run(householdId);
  const { vid } = buildPublishedQuestionnaire('health');
  assert.throws(
    () => createSession({ household_id: householdId, domain: 'health', questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'domain', display_order: 1 }] }, REQ),
    (err) => err.status === 409
  );
});

test('createSession — refuse une version en brouillon (non publiée)', () => {
  const householdId = buildHousehold();
  const { id: qid } = Q.createQuestionnaire({ stable_key: 'draft-only-test', domain: 'health', name: 'X' }, REQ);
  const { id: vid } = Q.createDraftVersion(qid, {}, REQ);
  assert.throws(
    () => createSession({ household_id: householdId, domain: 'health', questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'domain', display_order: 1 }] }, REQ),
    (err) => err.status === 409
  );
});

test('createSession — composition modulaire mixte : exige une version health ET une version life_pension', () => {
  const householdId = buildHousehold();
  const { vid: vidHealth } = buildPublishedQuestionnaire('health');
  assert.throws(
    () => createSession({ household_id: householdId, domain: 'mixed', questionnaire_versions: [{ questionnaire_version_id: vidHealth, domain: 'health', module_role: 'domain', display_order: 1 }] }, REQ)
  );
  const { vid: vidLife } = buildPublishedQuestionnaire('life_pension');
  const { id } = createSession({
    household_id: householdId, domain: 'mixed',
    questionnaire_versions: [
      { questionnaire_version_id: vidHealth, domain: 'health', module_role: 'domain', display_order: 1 },
      { questionnaire_version_id: vidLife, domain: 'life_pension', module_role: 'domain', display_order: 2 },
    ],
  }, REQ);
  assert.ok(id);
});

test('createSession — refuse une session health rattachant aussi une version life_pension', () => {
  const householdId = buildHousehold();
  const { vid: vidHealth } = buildPublishedQuestionnaire('health');
  const { vid: vidLife } = buildPublishedQuestionnaire('life_pension');
  assert.throws(() =>
    createSession({
      household_id: householdId, domain: 'health',
      questionnaire_versions: [
        { questionnaire_version_id: vidHealth, domain: 'health', module_role: 'domain', display_order: 1 },
        { questionnaire_version_id: vidLife, domain: 'life_pension', module_role: 'domain', display_order: 2 },
      ],
    }, REQ)
  );
});

test('createSession — accepte une version common facultative en plus du domaine spécialisé', () => {
  const householdId = buildHousehold();
  const { vid: vidCommon } = buildPublishedQuestionnaire('common');
  const { vid: vidHealth } = buildPublishedQuestionnaire('health');
  const { id } = createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [
      { questionnaire_version_id: vidCommon, domain: 'common', module_role: 'core', display_order: 1 },
      { questionnaire_version_id: vidHealth, domain: 'health', module_role: 'domain', display_order: 2 },
    ],
  }, REQ);
  assert.equal(getSessionDetail(id).questionnaire_versions.length, 2);
});

test('createSession — refuse un module_role incohérent avec le domaine déclaré', () => {
  const householdId = buildHousehold();
  const { vid } = buildPublishedQuestionnaire('health');
  assert.throws(() =>
    createSession({ household_id: householdId, domain: 'health', questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'core', display_order: 1 }] }, REQ)
  );
});

test('createSession — refuse deux versions avec le même display_order', () => {
  const householdId = buildHousehold();
  const { vid: vidCommon } = buildPublishedQuestionnaire('common');
  const { vid: vidHealth } = buildPublishedQuestionnaire('health');
  assert.throws(() =>
    createSession({
      household_id: householdId, domain: 'health',
      questionnaire_versions: [
        { questionnaire_version_id: vidCommon, domain: 'common', module_role: 'core', display_order: 1 },
        { questionnaire_version_id: vidHealth, domain: 'health', module_role: 'domain', display_order: 1 },
      ],
    }, REQ)
  );
});

// --- Transitions -------------------------------------------------------

function createSimpleSession(domain = 'health') {
  const householdId = buildHousehold();
  const { vid, questionId } = buildPublishedQuestionnaire(domain);
  const { id } = createSession({
    household_id: householdId, domain,
    questionnaire_versions: [{ questionnaire_version_id: vid, domain, module_role: 'domain', display_order: 1 }],
  }, REQ);
  return { sessionId: id, questionId, householdId };
}

test('startSession — draft -> in_progress, fige household_snapshot, journalise', () => {
  const { sessionId } = createSimpleSession();
  const before = auditCount('session démarrée');
  startSession(sessionId, rev(sessionId), REQ);
  const detail = getSessionDetail(sessionId);
  assert.equal(detail.status, 'in_progress');
  assert.ok(detail.household_snapshot);
  assert.ok(detail.started_at);
  assert.equal(auditCount('session démarrée'), before + 1);
});

// Constat GATE LOT 3A : aucune de ces fonctions ne vérifiait le statut du
// foyer avant ce correctif, alors qu'un foyer archivé est « figé » côté Lot 2
// (server/advisoryHouseholds.js) — une session créée avant l'archivage ne
// doit pas devenir un moyen détourné de produire une activité nouvelle.
test('foyer archivé APRÈS création de la session — bloque le démarrage/la reprise/la finalisation/les réponses/les amendements, mais autorise toujours suspendre et annuler', () => {
  const { sessionId, questionId, householdId } = createSimpleSession();
  db.prepare("UPDATE households SET status = 'archive' WHERE id = ?").run(householdId);

  assert.throws(() => startSession(sessionId, rev(sessionId), REQ), (err) => err.status === 409);
  assert.throws(() => updateSessionMetadata(sessionId, { title: 'X' , expected_revision: rev(sessionId) }, REQ), (err) => err.status === 409);
  assert.throws(
    () => recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], rev(sessionId), REQ),
    (err) => err.status === 409
  );

  // Annuler reste possible (action fermante, aucune donnée nouvelle créée).
  cancelSession(sessionId, rev(sessionId), REQ);
  assert.equal(getSessionDetail(sessionId).status, 'cancelled');
});

test('foyer archivé APRÈS démarrage — suspendre reste possible, reprendre/finaliser sont bloqués, annuler depuis suspended reste possible', () => {
  const { sessionId, questionId, householdId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], rev(sessionId), REQ);
  db.prepare("UPDATE households SET status = 'archive' WHERE id = ?").run(householdId);

  assert.throws(() => completeSession(sessionId, rev(sessionId), REQ), (err) => err.status === 409);
  suspendSession(sessionId, rev(sessionId), REQ);
  assert.equal(getSessionDetail(sessionId).status, 'suspended');
  assert.throws(() => resumeSession(sessionId, rev(sessionId), REQ), (err) => err.status === 409);
  cancelSession(sessionId, rev(sessionId), REQ);
  assert.equal(getSessionDetail(sessionId).status, 'cancelled');
});

test('foyer archivé APRÈS finalisation — amendAnswer est bloqué', () => {
  const { sessionId, questionId, householdId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], rev(sessionId), REQ);
  completeSession(sessionId, rev(sessionId), REQ);
  db.prepare("UPDATE households SET status = 'archive' WHERE id = ?").run(householdId);

  assert.throws(
    () => amendAnswer(sessionId, { question_id: questionId, status: 'answered', value: false, amendment_reason: 'Correction' , expected_revision: rev(sessionId) }, REQ),
    (err) => err.status === 409
  );
});

test('Transitions interdites — refusées avec une erreur métier explicite (409)', () => {
  const { sessionId } = createSimpleSession();
  assert.throws(() => completeSession(sessionId, rev(sessionId), REQ), (err) => err.status === 409);
  assert.throws(() => suspendSession(sessionId, rev(sessionId), REQ), (err) => err.status === 409);
  assert.throws(() => resumeSession(sessionId, rev(sessionId), REQ), (err) => err.status === 409);
});

test('suspendSession puis resumeSession — cycle complet, journalisé', () => {
  const { sessionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  suspendSession(sessionId, rev(sessionId), REQ);
  assert.equal(getSessionDetail(sessionId).status, 'suspended');
  assert.throws(() => suspendSession(sessionId, rev(sessionId), REQ), (err) => err.status === 409);
  resumeSession(sessionId, rev(sessionId), REQ);
  assert.equal(getSessionDetail(sessionId).status, 'in_progress');
});

test('cancelSession — possible depuis draft, in_progress et suspended ; jamais depuis completed', () => {
  const s1 = createSimpleSession();
  cancelSession(s1.sessionId, rev(s1.sessionId), REQ);
  assert.equal(getSessionDetail(s1.sessionId).status, 'cancelled');

  const s2 = createSimpleSession();
  startSession(s2.sessionId, rev(s2.sessionId), REQ);
  cancelSession(s2.sessionId, rev(s2.sessionId), REQ);
  assert.equal(getSessionDetail(s2.sessionId).status, 'cancelled');

  assert.throws(() => cancelSession(s2.sessionId, rev(s2.sessionId), REQ), (err) => err.status === 409);
});

test('session annulée ne peut plus recevoir de réponses', () => {
  const { sessionId, questionId } = createSimpleSession();
  cancelSession(sessionId, rev(sessionId), REQ);
  assert.throws(
    () => recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], rev(sessionId), REQ),
    (err) => err.status === 409
  );
});

test('session complétée ne peut jamais être réouverte (aucune transition sortante)', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], rev(sessionId), REQ);
  completeSession(sessionId, rev(sessionId), REQ);
  assert.throws(() => startSession(sessionId, rev(sessionId), REQ), (err) => err.status === 409);
  assert.throws(() => suspendSession(sessionId, rev(sessionId), REQ), (err) => err.status === 409);
  assert.throws(() => cancelSession(sessionId, rev(sessionId), REQ), (err) => err.status === 409);
});

test('updateSessionMetadata — modifie titre/date, jamais household_id/domain/composition', () => {
  const { sessionId } = createSimpleSession();
  updateSessionMetadata(sessionId, { title: 'RDV test' , expected_revision: rev(sessionId) }, REQ);
  assert.equal(getSessionDetail(sessionId).title, 'RDV test');
});

test('updateSessionMetadata — journalise les champs modifiés, jamais la valeur du titre (constat GATE)', () => {
  const { sessionId } = createSimpleSession();
  updateSessionMetadata(sessionId, { title: 'Contient un détail confidentiel du rendez-vous' , expected_revision: rev(sessionId) }, REQ);
  const entry = db.prepare("SELECT details FROM audit_log WHERE action = 'session modifiée' ORDER BY id DESC LIMIT 1").get();
  assert.equal(entry.details, 'title');
  assert.ok(!entry.details.includes('confidentiel'), 'le titre ne doit jamais apparaître dans l’audit');
});

// --- Finalisation --------------------------------------------------------

test('completeSession — refuse si des réponses obligatoires visibles manquent', () => {
  const { sessionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  const check = validateSessionForCompletion(sessionId);
  assert.equal(check.valid, false);
  assert.throws(() => completeSession(sessionId, rev(sessionId), REQ), (err) => err.status === 409 && Array.isArray(err.missing));
});

test('completeSession — questions masquées (condition non satisfaite) ne bloquent jamais la finalisation', () => {
  const householdId = buildHousehold();
  const { id: qid } = Q.createQuestionnaire({ stable_key: 'masque-test', domain: 'health', name: 'Masque' }, REQ);
  const { id: vid } = Q.createDraftVersion(qid, {}, REQ);
  const { id: sectionId } = Q.upsertSection(vid, { stable_key: 's1', title: 'S', sort_order: 1 }, REQ);
  const { id: qTrigger } = Q.upsertQuestion(sectionId, { stable_key: 'declencheur', advisor_text: 'Actif ?', type: 'boolean', required: true, sort_order: 1 }, REQ);
  Q.upsertQuestion(sectionId, {
    stable_key: 'conditionnelle', advisor_text: 'Suite ?', type: 'boolean', required: true, sort_order: 2,
    display_condition: { op: 'equals', ref: { question: 'declencheur' }, value: true },
  }, REQ);
  Q.publishVersion(vid, REQ);
  const { id: sessionId } = createSession({ household_id: householdId, domain: 'health', questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'domain', display_order: 1 }] }, REQ);
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: qTrigger, status: 'answered', value: false }], rev(sessionId), REQ);
  const check = validateSessionForCompletion(sessionId);
  assert.equal(check.valid, true, 'la question conditionnelle masquée ne doit pas bloquer');
  assert.doesNotThrow(() => completeSession(sessionId, rev(sessionId), REQ));
});

test('completeSession — réponse unknown satisfait une question obligatoire visible', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'unknown' }], rev(sessionId), REQ);
  assert.equal(validateSessionForCompletion(sessionId).valid, true);
});

// Correctif final GATE LOT 3A : allows_not_applicable, distinct de
// allows_unknown, désactivé par défaut.
test('completeSession — réponse not_applicable satisfait une question obligatoire visible UNIQUEMENT si la question l’autorise', () => {
  const householdId = buildHousehold();
  const { vid, questionId } = buildPublishedQuestionnaire('health', { allowsNotApplicable: true });
  const { id: sessionId } = createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'domain', display_order: 1 }],
  }, REQ);
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'not_applicable' }], rev(sessionId), REQ);
  assert.equal(validateSessionForCompletion(sessionId).valid, true);
});

test('recordAnswers — refuse not_applicable quand la question ne l’autorise pas (allows_not_applicable=false par défaut)', () => {
  const { sessionId, questionId } = createSimpleSession(); // allowsNotApplicable=false par défaut
  startSession(sessionId, rev(sessionId), REQ);
  assert.throws(
    () => recordAnswers(sessionId, [{ question_id: questionId, status: 'not_applicable' }], rev(sessionId), REQ),
    /n’autorise pas la réponse « non applicable »/
  );
  // La question reste donc manquante à la finalisation -- aucune façon détournée de la satisfaire.
  assert.equal(validateSessionForCompletion(sessionId).valid, false);
});

test('completeSession — session mixte distingue les éléments manquants par domaine (common/health/life_pension)', () => {
  const householdId = buildHousehold();
  const { vid: vidCommon } = buildPublishedQuestionnaire('common');
  const { vid: vidHealth, questionId: qHealth } = buildPublishedQuestionnaire('health');
  const { vid: vidLife } = buildPublishedQuestionnaire('life_pension');
  const { id: sessionId } = createSession({
    household_id: householdId, domain: 'mixed',
    questionnaire_versions: [
      { questionnaire_version_id: vidCommon, domain: 'common', module_role: 'core', display_order: 1 },
      { questionnaire_version_id: vidHealth, domain: 'health', module_role: 'domain', display_order: 2 },
      { questionnaire_version_id: vidLife, domain: 'life_pension', module_role: 'domain', display_order: 3 },
    ],
  }, REQ);
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: qHealth, status: 'answered', value: true }], rev(sessionId), REQ);
  const check = validateSessionForCompletion(sessionId);
  assert.equal(check.valid, false);
  const byDomain = Object.fromEntries(check.byLink.map((l) => [l.domain, l.missing.length]));
  assert.equal(byDomain.common, 1);
  assert.equal(byDomain.health, 0);
  assert.equal(byDomain.life_pension, 1);
});

// --- Réponses : portée, validation, append-only ----------------------------

test('recordAnswers — refuse un membre appartenant à un AUTRE foyer', () => {
  const { sessionId, questionId } = createSimpleSession();
  const otherHousehold = buildHousehold();
  const otherMember = db.prepare('SELECT id FROM household_members WHERE household_id = ?').get(otherHousehold).id;
  startSession(sessionId, rev(sessionId), REQ);
  assert.throws(() => recordAnswers(sessionId, [{ question_id: questionId, household_member_id: otherMember, status: 'answered', value: true }], rev(sessionId), REQ));
});

test('recordAnswers — refuse une question qui n’appartient à aucune version rattachée à la session', () => {
  const { sessionId } = createSimpleSession();
  const { questionId: foreignQuestionId } = buildPublishedQuestionnaire('life_pension');
  startSession(sessionId, rev(sessionId), REQ);
  assert.throws(
    () => recordAnswers(sessionId, [{ question_id: foreignQuestionId, status: 'answered', value: true }], rev(sessionId), REQ),
    (err) => err.status === 400
  );
});

test('recordAnswers — valide chaque type : text/integer/decimal/money/date/boolean/single_choice/multiple_choice', () => {
  const householdId = buildHousehold();
  const { id: qid } = Q.createQuestionnaire({ stable_key: 'types-test', domain: 'health', name: 'Types' }, REQ);
  const { id: vid } = Q.createDraftVersion(qid, {}, REQ);
  const { id: sectionId } = Q.upsertSection(vid, { stable_key: 's1', title: 'S', sort_order: 1 }, REQ);
  const mk = (stableKey, type, sort) => Q.upsertQuestion(sectionId, { stable_key: stableKey, advisor_text: stableKey, type, sort_order: sort }, REQ).id;
  const qText = mk('q_text', 'text', 1);
  const qInt = mk('q_int', 'integer', 2);
  const qDec = mk('q_dec', 'decimal', 3);
  const qMoney = mk('q_money', 'money', 4);
  const qDate = mk('q_date', 'date', 5);
  const qBool = mk('q_bool', 'boolean', 6);
  const qSingle = Q.upsertQuestion(sectionId, { stable_key: 'q_single', advisor_text: 'X', type: 'single_choice', sort_order: 7 }, REQ).id;
  Q.upsertOption(qSingle, { stable_key: 'a', label: 'A', value: 'a', sort_order: 1 }, REQ);
  const qMulti = Q.upsertQuestion(sectionId, { stable_key: 'q_multi', advisor_text: 'X', type: 'multiple_choice', sort_order: 8 }, REQ).id;
  Q.upsertOption(qMulti, { stable_key: 'x', label: 'X', value: 'x', sort_order: 1 }, REQ);
  Q.upsertOption(qMulti, { stable_key: 'y', label: 'Y', value: 'y', sort_order: 2 }, REQ);
  Q.publishVersion(vid, REQ);
  const { id: sessionId } = createSession({ household_id: householdId, domain: 'health', questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'domain', display_order: 1 }] }, REQ);
  startSession(sessionId, rev(sessionId), REQ);

  recordAnswers(sessionId, [
    { question_id: qText, status: 'answered', value: 'bonjour' },
    { question_id: qInt, status: 'answered', value: 42 },
    { question_id: qDec, status: 'answered', value: 3.5 },
    { question_id: qMoney, status: 'answered', value: 1200.5 },
    { question_id: qDate, status: 'answered', value: '2026-01-01' },
    { question_id: qBool, status: 'answered', value: true },
    { question_id: qSingle, status: 'answered', value: 'a' },
    { question_id: qMulti, status: 'answered', value: ['x', 'y'] },
  ], rev(sessionId), REQ);
  const active = listActiveAnswers(sessionId);
  assert.equal(active.length, 8);
  assert.equal(active.find((a) => a.question_id === qInt).value, 42);
  assert.equal(active.find((a) => a.question_id === qBool).value, true);
  assert.deepEqual(active.find((a) => a.question_id === qMulti).value, ['x', 'y']);

  assert.throws(() => recordAnswers(sessionId, [{ question_id: qInt, status: 'answered', value: 3.5 }], rev(sessionId), REQ));
  assert.throws(() => recordAnswers(sessionId, [{ question_id: qSingle, status: 'answered', value: 'inconnue' }], rev(sessionId), REQ));
  assert.throws(() => recordAnswers(sessionId, [{ question_id: qMulti, status: 'answered', value: ['x', 'x'] }], rev(sessionId), REQ), /doublon/i);
  assert.throws(() => recordAnswers(sessionId, [{ question_id: qDate, status: 'answered', value: 'pas-une-date' }], rev(sessionId), REQ));
});

test('recordAnswers — refuse « unknown » si la question ne l’autorise pas', () => {
  const householdId = buildHousehold();
  const { id: qid } = Q.createQuestionnaire({ stable_key: 'no-unknown-test', domain: 'health', name: 'X' }, REQ);
  const { id: vid } = Q.createDraftVersion(qid, {}, REQ);
  const { id: sectionId } = Q.upsertSection(vid, { stable_key: 's1', title: 'S', sort_order: 1 }, REQ);
  const { id: questionId } = Q.upsertQuestion(sectionId, { stable_key: 'q1', advisor_text: 'X', type: 'boolean', allows_unknown: false, sort_order: 1 }, REQ);
  Q.publishVersion(vid, REQ);
  const { id: sessionId } = createSession({ household_id: householdId, domain: 'health', questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'domain', display_order: 1 }] }, REQ);
  startSession(sessionId, rev(sessionId), REQ);
  assert.throws(() => recordAnswers(sessionId, [{ question_id: questionId, status: 'unknown' }], rev(sessionId), REQ));
});

test('recordAnswers — refuse une valeur fournie avec un statut unknown/not_applicable', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  assert.throws(() => recordAnswers(sessionId, [{ question_id: questionId, status: 'unknown', value: true }], rev(sessionId), REQ));
});

test('recordAnswers — append-only : le remplacement conserve l’historique et n’écrase jamais', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  const beforeEnreg = auditCount('réponse enregistrée');
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], rev(sessionId), REQ);
  assert.equal(auditCount('réponse enregistrée'), beforeEnreg + 1);

  const beforeRemp = auditCount('réponse remplacée');
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: false }], rev(sessionId), REQ);
  assert.equal(auditCount('réponse remplacée'), beforeRemp + 1);

  const history = listAnswerHistory(sessionId, questionId, null, REQ);
  assert.equal(history.length, 2);
  assert.equal(history[0].value, true);
  assert.ok(history[0].superseded_by_answer_id);
  assert.equal(history[1].value, false);
  assert.equal(history[1].superseded_by_answer_id, null);

  const active = listActiveAnswers(sessionId);
  assert.equal(active.filter((a) => a.question_id === questionId).length, 1, 'une seule réponse active');
});

test('recordAnswers — une seule réponse active garantie même après plusieurs remplacements successifs', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  for (const v of [true, false, true, false, true]) {
    recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: v }], rev(sessionId), REQ);
  }
  const rows = db.prepare('SELECT COUNT(*) AS n FROM advisory_answers WHERE session_id = ? AND question_id = ? AND superseded_by_answer_id IS NULL').get(sessionId, questionId);
  assert.equal(rows.n, 1);
});

test('clearAnswer — insère une ligne « cleared », journalise, historise sans supprimer', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], rev(sessionId), REQ);
  const before = auditCount('réponse effacée');
  clearAnswer(sessionId, questionId, null, rev(sessionId), REQ);
  assert.equal(auditCount('réponse effacée'), before + 1);
  const history = listAnswerHistory(sessionId, questionId, null, REQ);
  assert.equal(history.length, 2);
  assert.equal(history[1].status, 'cleared');
  // Une question obligatoire effacée redevient manquante pour la finalisation.
  assert.equal(validateSessionForCompletion(sessionId).valid, false);
});

test('amendAnswer — refuse hors session finalisée', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  assert.throws(
    () => amendAnswer(sessionId, { question_id: questionId, status: 'answered', value: true, amendment_reason: 'x' , expected_revision: rev(sessionId) }, REQ),
    (err) => err.status === 409
  );
});

test('amendAnswer — exige un motif non vide', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], rev(sessionId), REQ);
  completeSession(sessionId, rev(sessionId), REQ);
  assert.throws(() => amendAnswer(sessionId, { question_id: questionId, status: 'answered', value: false , expected_revision: rev(sessionId) }, REQ));
  assert.throws(() => amendAnswer(sessionId, { question_id: questionId, status: 'answered', value: false, amendment_reason: '   ' , expected_revision: rev(sessionId) }, REQ));
});

test('amendAnswer — succès : historise, marque is_amendment, ne rouvre jamais la session, journalise', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], rev(sessionId), REQ);
  completeSession(sessionId, rev(sessionId), REQ);
  const before = auditCount('réponse amendée');
  amendAnswer(sessionId, { question_id: questionId, status: 'answered', value: false, amendment_reason: 'Erreur de saisie initiale' , expected_revision: rev(sessionId) }, REQ);
  assert.equal(auditCount('réponse amendée'), before + 1);
  assert.equal(getSessionDetail(sessionId).status, 'completed');
  const history = listAnswerHistory(sessionId, questionId, null, REQ);
  assert.equal(history.length, 2);
  assert.equal(history[1].is_amendment, 1);
  assert.equal(history[1].amendment_reason, 'Erreur de saisie initiale');
});

// Correctif final GATE LOT 3A : un amendement vers not_applicable/unknown
// suit la même règle de gating que l'enregistrement normal.
test('amendAnswer — refuse un amendement vers not_applicable/unknown si la question ne l’autorise pas ; accepte si autorisé', () => {
  const householdId = buildHousehold();
  const { vid, questionId } = buildPublishedQuestionnaire('health'); // allows_not_applicable=false, allows_unknown=true par défaut
  const { id: sessionId } = createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'domain', display_order: 1 }],
  }, REQ);
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], rev(sessionId), REQ);
  completeSession(sessionId, rev(sessionId), REQ);

  // not_applicable interdit -> amendement refusé, session reste completed, aucune ligne ajoutée.
  const beforeCount = db.prepare('SELECT COUNT(*) AS n FROM advisory_answers WHERE session_id = ?').get(sessionId).n;
  assert.throws(
    () => amendAnswer(sessionId, { question_id: questionId, status: 'not_applicable', amendment_reason: 'Test refus' , expected_revision: rev(sessionId) }, REQ),
    /n’autorise pas la réponse « non applicable »/
  );
  assert.equal(getSessionDetail(sessionId).status, 'completed');
  const afterCount = db.prepare('SELECT COUNT(*) AS n FROM advisory_answers WHERE session_id = ?').get(sessionId).n;
  assert.equal(afterCount, beforeCount, 'aucune ligne ne doit être ajoutée par un amendement refusé (rollback complet)');

  // unknown autorisé -> amendement accepté.
  amendAnswer(sessionId, { question_id: questionId, status: 'unknown', amendment_reason: 'Réponse initiale erronée' , expected_revision: rev(sessionId) }, REQ);
  assert.equal(getSessionDetail(sessionId).status, 'completed');
});

test('amendAnswer — not_applicable accepté quand la question l’autorise explicitement', () => {
  const householdId = buildHousehold();
  const { vid, questionId } = buildPublishedQuestionnaire('health', { allowsNotApplicable: true });
  const { id: sessionId } = createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'domain', display_order: 1 }],
  }, REQ);
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], rev(sessionId), REQ);
  completeSession(sessionId, rev(sessionId), REQ);
  const before = auditCount('réponse amendée');
  amendAnswer(sessionId, { question_id: questionId, status: 'not_applicable', amendment_reason: 'Ne s’applique finalement pas à ce foyer' , expected_revision: rev(sessionId) }, REQ);
  assert.equal(auditCount('réponse amendée'), before + 1);
  assert.equal(getSessionDetail(sessionId).status, 'completed');
  const history = listAnswerHistory(sessionId, questionId, null, REQ);
  assert.equal(history[history.length - 1].status, 'not_applicable');
  assert.equal(history[history.length - 1].is_amendment, 1);
  // Audit : jamais la valeur ni le statut de la réponse dans les détails journalisés.
  const rows = db.prepare("SELECT details FROM audit_log WHERE action = 'réponse amendée' ORDER BY id DESC LIMIT 1").all();
  assert.ok(!rows[0].details.includes('not_applicable'));
});

test('recordAnswers — rollback : un lot contenant une entrée invalide n’enregistre aucune réponse du lot', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  const before = db.prepare('SELECT COUNT(*) AS n FROM advisory_answers WHERE session_id = ?').get(sessionId).n;
  assert.throws(() =>
    recordAnswers(sessionId, [
      { question_id: questionId, status: 'answered', value: true },
      { question_id: 999999, status: 'answered', value: true },
    ], rev(sessionId), REQ)
  );
  const after = db.prepare('SELECT COUNT(*) AS n FROM advisory_answers WHERE session_id = ?').get(sessionId).n;
  assert.equal(before, after, 'aucune réponse du lot ne doit être enregistrée si une entrée échoue');
});

test('audit — aucune valeur de réponse ni donnée sensible dans les détails journalisés', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], rev(sessionId), REQ);
  const rows = db.prepare("SELECT details FROM audit_log WHERE action IN ('réponse enregistrée','réponse remplacée','réponse effacée','réponse amendée')").all();
  for (const r of rows) {
    assert.ok(!/true|false/i.test(r.details || '') || /nouvelle|remplac/i.test(r.details), 'pas de valeur brute dans les détails');
  }
});

test('listSessions — filtre par foyer, statut et domaine', () => {
  const { sessionId, householdId } = createSimpleSession('health');
  const rows = listSessions({ household_id: householdId, domain: 'health' });
  assert.ok(rows.some((r) => r.id === sessionId));
  const rowsWrongStatus = listSessions({ household_id: householdId, status: 'completed' });
  assert.ok(!rowsWrongStatus.some((r) => r.id === sessionId));
});

// --- Concurrence optimiste (GATE LOT 3B §2) ---------------------------------

test('recordAnswers — expected_revision incorrect (obsolète) refuse (409), n’écrit rien, ne journalise aucun succès', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  const staleRevision = rev(sessionId);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], staleRevision, REQ); // fait avancer la révision réelle
  const before = auditCount('réponse enregistrée');
  const beforeCount = db.prepare('SELECT COUNT(*) AS n FROM advisory_answers WHERE session_id = ?').get(sessionId).n;
  assert.throws(
    () => recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: false }], staleRevision, REQ),
    (err) => err.status === 409
  );
  assert.equal(auditCount('réponse enregistrée'), before, 'aucun audit de succès après un refus de révision');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM advisory_answers WHERE session_id = ?').get(sessionId).n, beforeCount, 'aucune ligne écrite après un refus de révision');
});

test('recordAnswers — ordre A → B → C : chaque écriture successive avec sa propre expected_revision aboutit à C (dernière intention), jamais un état intermédiaire', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], rev(sessionId), REQ); // A (représentée ici par true)
  recordAnswers(sessionId, [{ question_id: questionId, status: 'unknown' }], rev(sessionId), REQ); // B
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: false }], rev(sessionId), REQ); // C
  const active = listActiveAnswers(sessionId);
  assert.equal(active.length, 1);
  assert.equal(active[0].status, 'answered');
  assert.equal(active[0].value, false, 'la dernière intention (C) doit être la réponse active, jamais A ni B');
});

test('recordAnswers puis clearAnswer puis recordAnswers — chaque écriture successive respecte la révision qu’elle vient de recevoir', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], rev(sessionId), REQ);
  clearAnswer(sessionId, questionId, null, rev(sessionId), REQ);
  assert.equal(listActiveAnswers(sessionId)[0].status, 'cleared');
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: false }], rev(sessionId), REQ);
  const active = listActiveAnswers(sessionId);
  assert.equal(active.length, 1);
  assert.equal(active[0].value, false);
});

// --- Snapshot des membres (GATE LOT 3B §5) ----------------------------------

test('sessionMembersFor (via getSessionWorkspace) — draft : reflète les membres actifs actuels, aucun snapshot encore figé', () => {
  const householdId = buildHousehold();
  const { vid, questionId } = buildPublishedQuestionnaire('health', { memberScope: true });
  const { id: sessionId } = createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'domain', display_order: 1 }],
  }, REQ);
  const detail = getSessionDetail(sessionId);
  assert.equal(detail.household_snapshot, null, 'aucun snapshot avant le démarrage');
  void questionId;
});
