// Tests API — /api/advisory/sessions (Legrand Diagnostic 360, Lot 3A).
// Même convention que test/api.test.js et test/advisory-households-api.test.js.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-sessions-api-'));
process.env.NODE_ENV = 'test';
process.env.SITE_ORIGINS = 'https://site-de-test.ch';
process.env.PUBLIC_RATE_LIMIT = '100';

const { default: app } = await import('../server/app.js');
const { default: db } = await import('../server/db.js');

const PASSWORD = 'MotDePasseDeTest!42';
let cookie = '';
function auth(req) { return req.set('Cookie', cookie); }

before(async () => {
  const res = await request(app).post('/api/auth/setup').send({ email: 'test@exemple.ch', name: 'Testeur', password: PASSWORD });
  assert.equal(res.status, 200);
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
});

function insertClient(over = {}) {
  const data = { type: 'particulier', first_name: 'Prenom', last_name: 'Nom', status: 'prospect', ...over };
  return db
    .prepare('INSERT INTO clients (type, first_name, last_name, status) VALUES (?, ?, ?, ?)')
    .run(data.type, data.first_name, data.last_name, data.status).lastInsertRowid;
}

let counter = 0;
async function buildHouseholdAndPublishedVersion(domain = 'health') {
  counter += 1;
  const clientId = insertClient({ first_name: `Api${counter}`, last_name: 'Session' });
  const house = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: clientId });
  const q = await auth(request(app).post('/api/advisory/questionnaires')).send({ stable_key: `api-sess-${counter}`, domain, name: `Démo ${counter}` });
  const v = await auth(request(app).post(`/api/advisory/questionnaires/${q.body.id}/versions`)).send({});
  const sec = await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/sections`)).send({ stable_key: 's1', title: 'S', sort_order: 1 });
  const ques = await auth(request(app).post(`/api/advisory/questionnaires/sections/${sec.body.id}/questions`)).send({ stable_key: 'q1', advisor_text: 'X ?', type: 'boolean', required: true, sort_order: 1 });
  await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/publish`)).send({});
  return { householdId: house.body.id, versionId: v.body.id, questionId: ques.body.id };
}

async function createSimpleSession(domain = 'health') {
  const { householdId, versionId, questionId } = await buildHouseholdAndPublishedVersion(domain);
  const res = await auth(request(app).post('/api/advisory/sessions')).send({
    household_id: householdId, domain,
    questionnaire_versions: [{ questionnaire_version_id: versionId, domain, module_role: 'domain', display_order: 1 }],
  });
  return { sessionId: res.body.id, questionId, householdId };
}

// Lit la révision réelle courante d'une session via l'API elle-même (jamais
// un accès direct à la base) -- fournit `expected_revision` (contrôle de
// concurrence optimiste, GATE LOT 3B §2) à chaque appel HTTP mutateur de ce
// fichier de tests.
async function rev(sessionId) {
  const r = await auth(request(app).get(`/api/advisory/sessions/${sessionId}`));
  return r.body.revision;
}

// --- Authentification / CSRF ------------------------------------------------

test('GET /api/advisory/sessions sans session est refusé (401)', async () => {
  const res = await request(app).get('/api/advisory/sessions');
  assert.equal(res.status, 401);
});

test('POST /api/advisory/sessions intersite est bloqué (CSRF, 403)', async () => {
  const { householdId, versionId } = await buildHouseholdAndPublishedVersion();
  const res = await auth(request(app).post('/api/advisory/sessions'))
    .set('Origin', 'https://site-malveillant.example')
    .send({ household_id: householdId, domain: 'health', questionnaire_versions: [{ questionnaire_version_id: versionId, domain: 'health', module_role: 'domain', display_order: 1 }] });
  assert.equal(res.status, 403);
});

// --- Création / liste / détail -----------------------------------------

test('POST /api/advisory/sessions — création valide (201)', async () => {
  const { sessionId } = await createSimpleSession();
  assert.ok(sessionId);
  const detail = await auth(request(app).get(`/api/advisory/sessions/${sessionId}`));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.status, 'draft');
});

test('POST /api/advisory/sessions — foyer inexistant -> 400', async () => {
  const { versionId } = await buildHouseholdAndPublishedVersion();
  const res = await auth(request(app).post('/api/advisory/sessions')).send({
    household_id: 999999, domain: 'health', questionnaire_versions: [{ questionnaire_version_id: versionId, domain: 'health', module_role: 'domain', display_order: 1 }],
  });
  assert.equal(res.status, 400);
});

test('GET /api/advisory/sessions/:id — 404 si introuvable', async () => {
  const res = await auth(request(app).get('/api/advisory/sessions/999999'));
  assert.equal(res.status, 404);
});

test('GET /api/advisory/sessions — filtre par foyer et domaine', async () => {
  const { sessionId, householdId } = await createSimpleSession();
  const res = await auth(request(app).get(`/api/advisory/sessions?household_id=${householdId}&domain=health`));
  assert.equal(res.status, 200);
  assert.ok(res.body.some((r) => r.id === sessionId));
});

// --- Transitions ---------------------------------------------------------

test('POST .../start puis .../suspend puis .../resume — cycle complet', async () => {
  const { sessionId } = await createSimpleSession();
  const start = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({ expected_revision: await rev(sessionId) });
  assert.equal(start.status, 200);
  assert.equal(start.body.revision, 1);
  const suspend = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/suspend`)).send({ expected_revision: await rev(sessionId) });
  assert.equal(suspend.status, 200);
  const resume = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/resume`)).send({ expected_revision: await rev(sessionId) });
  assert.equal(resume.status, 200);
  const detail = await auth(request(app).get(`/api/advisory/sessions/${sessionId}`));
  assert.equal(detail.body.status, 'in_progress');
});

test('POST .../complete — refuse une transition interdite (409) depuis draft', async () => {
  const { sessionId } = await createSimpleSession();
  const res = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/complete`)).send({ expected_revision: await rev(sessionId) });
  assert.equal(res.status, 409);
});

test('POST .../start — refuse une révision attendue obsolète (409), aucune modification effectuée', async () => {
  const { sessionId } = await createSimpleSession();
  const staleRevision = await rev(sessionId);
  // Une première écriture fait avancer la révision réelle...
  await auth(request(app).put(`/api/advisory/sessions/${sessionId}`)).send({ title: 'Autre titre', expected_revision: staleRevision });
  // ...la révision connue par ce second appelant (staleRevision) est désormais obsolète.
  const res = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({ expected_revision: staleRevision });
  assert.equal(res.status, 409);
  const detail = await auth(request(app).get(`/api/advisory/sessions/${sessionId}`));
  assert.equal(detail.body.status, 'draft', 'la transition refusée ne doit avoir eu aucun effet');
});

test('POST .../cancel — annule et bloque toute écriture ultérieure', async () => {
  const { sessionId, questionId } = await createSimpleSession();
  const cancel = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/cancel`)).send({ expected_revision: await rev(sessionId) });
  assert.equal(cancel.status, 200);
  const write = await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers: [{ question_id: questionId, status: 'answered', value: true }], expected_revision: await rev(sessionId) });
  assert.equal(write.status, 409);
});

// --- Réponses --------------------------------------------------------------

test('PUT .../answers — enregistrement par lot, puis GET .../answers renvoie la réponse active', async () => {
  const { sessionId, questionId } = await createSimpleSession();
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({ expected_revision: await rev(sessionId) });
  const res = await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers: [{ question_id: questionId, status: 'answered', value: true }], expected_revision: await rev(sessionId) });
  assert.equal(res.status, 200);
  assert.equal(res.body.revision, 2);
  const list = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/answers`));
  assert.equal(list.status, 200);
  assert.equal(list.body.answers.length, 1);
  assert.equal(list.body.answers[0].value, true);
});

test('PUT .../answers — refuse une révision attendue obsolète (409), aucune réponse écrite, aucun audit de succès', async () => {
  const { sessionId, questionId } = await createSimpleSession();
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({ expected_revision: await rev(sessionId) });
  const staleRevision = await rev(sessionId);
  const before = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'réponse enregistrée'").get().n;
  const res = await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({
    answers: [{ question_id: questionId, status: 'answered', value: true }], expected_revision: staleRevision - 1,
  });
  assert.equal(res.status, 409);
  const list = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/answers`));
  assert.equal(list.body.answers.length, 0, 'aucune réponse ne doit être écrite après un refus de révision');
  const after = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'réponse enregistrée'").get().n;
  assert.equal(after, before, 'aucun audit de succès ne doit être produit après un refus de révision');
});

test('PUT .../answers — sans expected_revision -> 400', async () => {
  const { sessionId, questionId } = await createSimpleSession();
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({ expected_revision: await rev(sessionId) });
  const res = await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers: [{ question_id: questionId, status: 'answered', value: true }] });
  assert.equal(res.status, 400);
});

// Correctif final GATE LOT 3A : allows_not_applicable, désactivé par défaut.
test('PUT .../answers — statut not_applicable refusé (400) quand la question ne l’autorise pas', async () => {
  const { sessionId, questionId } = await createSimpleSession(); // question créée sans allows_not_applicable -> false
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({ expected_revision: await rev(sessionId) });
  const res = await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers: [{ question_id: questionId, status: 'not_applicable' }], expected_revision: await rev(sessionId) });
  assert.equal(res.status, 400);
});

test('POST .../suspend puis PUT .../answers — une session suspendue n’accepte plus aucune nouvelle réponse (409)', async () => {
  const { sessionId, questionId } = await createSimpleSession();
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({ expected_revision: await rev(sessionId) });
  await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers: [{ question_id: questionId, status: 'answered', value: true }], expected_revision: await rev(sessionId) });
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/suspend`)).send({ expected_revision: await rev(sessionId) });
  const write = await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers: [{ question_id: questionId, status: 'answered', value: false }], expected_revision: await rev(sessionId) });
  assert.equal(write.status, 409);
  const clear = await auth(request(app).delete(`/api/advisory/sessions/${sessionId}/answers/${questionId}`)).send({ expected_revision: await rev(sessionId) });
  assert.equal(clear.status, 409);
  const workspace = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/workspace`));
  assert.equal(workspace.body.actions.can_record_answers, false);
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/resume`)).send({ expected_revision: await rev(sessionId) });
  const writeAfterResume = await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers: [{ question_id: questionId, status: 'answered', value: false }], expected_revision: await rev(sessionId) });
  assert.equal(writeAfterResume.status, 200, 'la reprise réactive immédiatement la saisie');
});

// --- Workspace (Lot 3B) -----------------------------------------------------

test('GET .../workspace — sans session est refusé (401)', async () => {
  const res = await request(app).get('/api/advisory/sessions/1/workspace');
  assert.equal(res.status, 401);
});

test('GET .../workspace — session introuvable -> 404', async () => {
  const res = await auth(request(app).get('/api/advisory/sessions/999999/workspace'));
  assert.equal(res.status, 404);
});

test('GET .../workspace — projection complète : modules, progression, actions, foyer', async () => {
  const { sessionId, questionId, householdId } = await createSimpleSession();
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({ expected_revision: await rev(sessionId) });
  const res = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/workspace`));
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store, private');
  assert.equal(res.body.session.id, sessionId);
  assert.equal(res.body.session.status, 'in_progress');
  assert.equal(res.body.household.id, householdId);
  assert.equal(res.body.modules.length, 1);
  assert.equal(res.body.modules[0].domain, 'health');
  const q = res.body.modules[0].sections[0].instances[0].questions.find((x) => x.id === questionId);
  assert.equal(q.missing, true);
  assert.equal(res.body.progress.complete, false);
  assert.equal(res.body.actions.can_complete, true);
  assert.equal(res.body.actions.can_amend, false);

  await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers: [{ question_id: questionId, status: 'answered', value: true }], expected_revision: await rev(sessionId) });
  const after = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/workspace`));
  assert.equal(after.body.progress.complete, true);
  const qAfter = after.body.modules[0].sections[0].instances[0].questions.find((x) => x.id === questionId);
  assert.equal(qAfter.answer.value, true);
  assert.equal(qAfter.missing, false);
});

test('GET .../workspace — session finalisée : lecture seule et amendement autorisé', async () => {
  const { sessionId, questionId } = await createSimpleSession();
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({ expected_revision: await rev(sessionId) });
  await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers: [{ question_id: questionId, status: 'answered', value: true }], expected_revision: await rev(sessionId) });
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/complete`)).send({ expected_revision: await rev(sessionId) });
  const res = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/workspace`));
  assert.equal(res.status, 200);
  assert.equal(res.body.actions.can_record_answers, false);
  assert.equal(res.body.actions.can_amend, true);
});

test('GET .../completion-check — reflète les réponses obligatoires manquantes puis satisfaites', async () => {
  const { sessionId, questionId } = await createSimpleSession();
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({ expected_revision: await rev(sessionId) });
  const before = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/completion-check`));
  assert.equal(before.body.valid, false);
  assert.equal(before.headers['cache-control'], 'no-store, private');
  await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers: [{ question_id: questionId, status: 'answered', value: true }], expected_revision: await rev(sessionId) });
  const after = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/completion-check`));
  assert.equal(after.body.valid, true);
});

test('DELETE .../answers/:questionId — efface logiquement, conserve l’historique', async () => {
  const { sessionId, questionId } = await createSimpleSession();
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({ expected_revision: await rev(sessionId) });
  await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers: [{ question_id: questionId, status: 'answered', value: true }], expected_revision: await rev(sessionId) });
  const del = await auth(request(app).delete(`/api/advisory/sessions/${sessionId}/answers/${questionId}`)).send({ expected_revision: await rev(sessionId) });
  assert.equal(del.status, 200);
  const history = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/answers/history?question_id=${questionId}`));
  assert.equal(history.status, 200);
  assert.equal(history.headers['cache-control'], 'no-store, private');
  assert.equal(history.body.answers.length, 2);
  assert.equal(history.body.answers[1].status, 'cleared');
});

// MICRO-GATE LOT 4B §2 : la navigation par answer_id (SessionWorkspace.jsx)
// ne transmet JAMAIS answer_id au serveur -- elle réutilise cette même
// route, scopée session+question+membre, et vérifie CÔTÉ CLIENT que
// l'identifiant annoncé figure parmi les lignes renvoyées. Le contrat HTTP
// de cette route doit donc rester IDENTIQUE (statut 200, même forme de
// payload) que la session/question interrogées contiennent ou non la ligne
// qu'un appelant aurait en tête -- jamais un statut ou une forme de réponse
// distincte qui permettrait de deviner qu'un identifiant précis existe
// ailleurs (autre session, autre foyer) ou n'existe pas du tout.
test('GET .../answers/history — contrat HTTP identique (200, même forme) que la session interrogée porte ou non la réponse d\'une AUTRE session du même foyer', async () => {
  const { householdId, versionId, questionId } = await buildHouseholdAndPublishedVersion('health');
  const sessionA = await auth(request(app).post('/api/advisory/sessions')).send({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: versionId, domain: 'health', module_role: 'domain', display_order: 1 }],
  });
  await auth(request(app).put(`/api/advisory/sessions/${sessionA.body.id}/answers`)).send({
    answers: [{ question_id: questionId, status: 'answered', value: true }], expected_revision: await rev(sessionA.body.id),
  });
  const answerIdA = (await auth(request(app).get(`/api/advisory/sessions/${sessionA.body.id}/answers/history?question_id=${questionId}`))).body.answers[0].id;

  // Même FOYER, même question technique, session B DISTINCTE.
  const sessionB = await auth(request(app).post('/api/advisory/sessions')).send({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: versionId, domain: 'health', module_role: 'domain', display_order: 1 }],
  });
  const historyB = await auth(request(app).get(`/api/advisory/sessions/${sessionB.body.id}/answers/history?question_id=${questionId}`));

  // Contrat identique dans les deux cas : 200, `{ answers: [...] }`, jamais
  // un 404/403 distinct pour signaler qu'« une réponse existe ailleurs ».
  assert.equal(historyB.status, 200);
  assert.ok(Array.isArray(historyB.body.answers));
  assert.equal(historyB.body.answers.length, 0, 'session B n\'a elle-même aucune réponse pour cette question');
  assert.ok(!historyB.body.answers.some((a) => a.id === answerIdA), 'l\'identifiant de la réponse de la session A ne doit jamais apparaître dans la réponse de la session B');
});

// Constat compliance-privacy-reviewer (MICRO-GATE §4) : le test ci-dessus ne
// couvrait, au niveau HTTP, que le cas « autre session du même foyer » --
// les trois autres cas (autre foyer, question incohérente, membre
// incohérent) n'étaient vérifiés qu'au niveau service. Complété ici avec la
// même rigueur (200, forme identique, identifiant étranger absent du corps
// JSON) pour ces trois cas.
test('GET .../answers/history — contrat HTTP identique (200, même forme) pour une réponse d\'un AUTRE foyer', async () => {
  const houseA = await buildHouseholdAndPublishedVersion('health');
  const sessionA = await auth(request(app).post('/api/advisory/sessions')).send({
    household_id: houseA.householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: houseA.versionId, domain: 'health', module_role: 'domain', display_order: 1 }],
  });
  await auth(request(app).put(`/api/advisory/sessions/${sessionA.body.id}/answers`)).send({
    answers: [{ question_id: houseA.questionId, status: 'answered', value: true }], expected_revision: await rev(sessionA.body.id),
  });
  const answerIdA = (await auth(request(app).get(`/api/advisory/sessions/${sessionA.body.id}/answers/history?question_id=${houseA.questionId}`))).body.answers[0].id;

  // FOYER DISTINCT, question technique DIFFÉRENTE (chaque foyer publie sa
  // propre version de questionnaire) -- aucun answer_id du foyer A ne peut
  // structurellement se retrouver dans l'historique du foyer B.
  const houseB = await buildHouseholdAndPublishedVersion('health');
  const sessionB = await auth(request(app).post('/api/advisory/sessions')).send({
    household_id: houseB.householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: houseB.versionId, domain: 'health', module_role: 'domain', display_order: 1 }],
  });
  const historyB = await auth(request(app).get(`/api/advisory/sessions/${sessionB.body.id}/answers/history?question_id=${houseB.questionId}`));

  assert.equal(historyB.status, 200);
  assert.ok(Array.isArray(historyB.body.answers));
  assert.equal(historyB.body.answers.length, 0);
  assert.ok(!historyB.body.answers.some((a) => a.id === answerIdA));
});

test('GET .../answers/history — contrat HTTP identique (200, même forme) quand la question interrogée est INCOHÉRENTE avec l\'answer_id recherché par l\'appelant', async () => {
  // Questionnaire construit avec DEUX questions foyer AVANT publication
  // (jamais d'ajout après coup -- un questionnaire publié est immuable).
  const q = await auth(request(app).post('/api/advisory/questionnaires')).send({ stable_key: `two-quest-${Date.now()}`, domain: 'health', name: 'Deux questions' });
  const v = await auth(request(app).post(`/api/advisory/questionnaires/${q.body.id}/versions`)).send({});
  const sec = await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/sections`)).send({ stable_key: 's1', title: 'S', sort_order: 1 });
  const questionA = await auth(request(app).post(`/api/advisory/questionnaires/sections/${sec.body.id}/questions`)).send({ stable_key: `qa-${Date.now()}`, advisor_text: 'X ?', type: 'boolean', sort_order: 1 });
  const questionB = await auth(request(app).post(`/api/advisory/questionnaires/sections/${sec.body.id}/questions`)).send({ stable_key: `qb-${Date.now()}`, advisor_text: 'Y ?', type: 'boolean', sort_order: 2 });
  await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/publish`)).send({});

  const clientId = insertClient({ first_name: `TwoQ${Date.now()}`, last_name: 'Test' });
  const house = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: clientId });
  const session = await auth(request(app).post('/api/advisory/sessions')).send({
    household_id: house.body.id, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: v.body.id, domain: 'health', module_role: 'domain', display_order: 1 }],
  });
  await auth(request(app).put(`/api/advisory/sessions/${session.body.id}/answers`)).send({
    answers: [
      { question_id: questionA.body.id, status: 'answered', value: true },
      { question_id: questionB.body.id, status: 'answered', value: true },
    ], expected_revision: await rev(session.body.id),
  });
  const answerIdB = (await auth(request(app).get(`/api/advisory/sessions/${session.body.id}/answers/history?question_id=${questionB.body.id}`))).body.answers[0].id;

  // Interroge la question A alors que l'answer_id recherché appartient à B.
  const history = await auth(request(app).get(`/api/advisory/sessions/${session.body.id}/answers/history?question_id=${questionA.body.id}`));
  assert.equal(history.status, 200);
  assert.ok(Array.isArray(history.body.answers));
  assert.ok(!history.body.answers.some((a) => a.id === answerIdB));
});

test('GET .../answers/history — contrat HTTP identique (200, même forme) quand le MEMBRE interrogé est incohérent avec l\'answer_id recherché', async () => {
  const q = await auth(request(app).post('/api/advisory/questionnaires')).send({ stable_key: `member-quest-${Date.now()}`, domain: 'health', name: 'Membre' });
  const v = await auth(request(app).post(`/api/advisory/questionnaires/${q.body.id}/versions`)).send({});
  const sec = await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/sections`)).send({ stable_key: 's1', title: 'S', sort_order: 1, applies_to: 'member' });
  const question = await auth(request(app).post(`/api/advisory/questionnaires/sections/${sec.body.id}/questions`)).send({ stable_key: `mq-${Date.now()}`, advisor_text: 'Z ?', type: 'boolean', scope: 'member', sort_order: 1 });
  await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/publish`)).send({});

  const clientId = insertClient({ first_name: `Membre${Date.now()}`, last_name: 'Test' });
  const house = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: clientId });
  const childClientId = insertClient({ first_name: `Enfant${Date.now()}`, last_name: 'Test' });
  const child = await auth(request(app).post(`/api/advisory/households/${house.body.id}/members`)).send({ member_role: 'enfant', client_id: childClientId });
  const principal = (await auth(request(app).get(`/api/advisory/households/${house.body.id}`))).body.members.find((m) => m.member_role === 'principal');

  const session = await auth(request(app).post('/api/advisory/sessions')).send({
    household_id: house.body.id, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: v.body.id, domain: 'health', module_role: 'domain', display_order: 1 }],
  });
  await auth(request(app).put(`/api/advisory/sessions/${session.body.id}/answers`)).send({
    answers: [{ question_id: question.body.id, household_member_id: principal.id, status: 'answered', value: true }],
    expected_revision: await rev(session.body.id),
  });
  const principalAnswerId = (await auth(request(app).get(`/api/advisory/sessions/${session.body.id}/answers/history?question_id=${question.body.id}&household_member_id=${principal.id}`))).body.answers[0].id;

  // Interroge le membre ENFANT (aucune réponse) alors que l'answer_id
  // recherché appartient au PRINCIPAL.
  const history = await auth(request(app).get(`/api/advisory/sessions/${session.body.id}/answers/history?question_id=${question.body.id}&household_member_id=${child.body.id}`));
  assert.equal(history.status, 200);
  assert.ok(Array.isArray(history.body.answers));
  assert.equal(history.body.answers.length, 0);
  assert.ok(!history.body.answers.some((a) => a.id === principalAnswerId));
});

test('POST .../complete puis PUT .../answers refusé (409), puis POST .../answers/amend réussit avec motif', async () => {
  const { sessionId, questionId } = await createSimpleSession();
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({ expected_revision: await rev(sessionId) });
  await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers: [{ question_id: questionId, status: 'answered', value: true }], expected_revision: await rev(sessionId) });
  const complete = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/complete`)).send({ expected_revision: await rev(sessionId) });
  assert.equal(complete.status, 200);

  const writeAfter = await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers: [{ question_id: questionId, status: 'answered', value: false }], expected_revision: await rev(sessionId) });
  assert.equal(writeAfter.status, 409);

  const noReason = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/answers/amend`)).send({ question_id: questionId, status: 'answered', value: false, expected_revision: await rev(sessionId) });
  assert.equal(noReason.status, 400);

  const amend = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/answers/amend`)).send({ question_id: questionId, status: 'answered', value: false, amendment_reason: 'Correction test', expected_revision: await rev(sessionId) });
  assert.equal(amend.status, 201);
  const detail = await auth(request(app).get(`/api/advisory/sessions/${sessionId}`));
  assert.equal(detail.body.status, 'completed', 'la session reste finalisée après amendement');
});

test('audit — session créée et réponse enregistrée sont bien journalisées', async () => {
  const before = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'session créée'").get().n;
  await createSimpleSession();
  const after = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'session créée'").get().n;
  assert.equal(after, before + 1);
});
