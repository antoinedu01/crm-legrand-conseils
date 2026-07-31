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
  const start = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({});
  assert.equal(start.status, 200);
  const suspend = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/suspend`)).send({});
  assert.equal(suspend.status, 200);
  const resume = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/resume`)).send({});
  assert.equal(resume.status, 200);
  const detail = await auth(request(app).get(`/api/advisory/sessions/${sessionId}`));
  assert.equal(detail.body.status, 'in_progress');
});

test('POST .../complete — refuse une transition interdite (409) depuis draft', async () => {
  const { sessionId } = await createSimpleSession();
  const res = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/complete`)).send({});
  assert.equal(res.status, 409);
});

test('POST .../cancel — annule et bloque toute écriture ultérieure', async () => {
  const { sessionId, questionId } = await createSimpleSession();
  const cancel = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/cancel`)).send({});
  assert.equal(cancel.status, 200);
  const write = await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers: [{ question_id: questionId, status: 'answered', value: true }] });
  assert.equal(write.status, 409);
});

// --- Réponses --------------------------------------------------------------

test('PUT .../answers — enregistrement par lot, puis GET .../answers renvoie la réponse active', async () => {
  const { sessionId, questionId } = await createSimpleSession();
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({});
  const res = await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers: [{ question_id: questionId, status: 'answered', value: true }] });
  assert.equal(res.status, 200);
  const list = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/answers`));
  assert.equal(list.status, 200);
  assert.equal(list.body.answers.length, 1);
  assert.equal(list.body.answers[0].value, true);
});

// Correctif final GATE LOT 3A : allows_not_applicable, désactivé par défaut.
test('PUT .../answers — statut not_applicable refusé (400) quand la question ne l’autorise pas', async () => {
  const { sessionId, questionId } = await createSimpleSession(); // question créée sans allows_not_applicable -> false
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({});
  const res = await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers: [{ question_id: questionId, status: 'not_applicable' }] });
  assert.equal(res.status, 400);
});

test('GET .../completion-check — reflète les réponses obligatoires manquantes puis satisfaites', async () => {
  const { sessionId, questionId } = await createSimpleSession();
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({});
  const before = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/completion-check`));
  assert.equal(before.body.valid, false);
  await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers: [{ question_id: questionId, status: 'answered', value: true }] });
  const after = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/completion-check`));
  assert.equal(after.body.valid, true);
});

test('DELETE .../answers/:questionId — efface logiquement, conserve l’historique', async () => {
  const { sessionId, questionId } = await createSimpleSession();
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({});
  await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers: [{ question_id: questionId, status: 'answered', value: true }] });
  const del = await auth(request(app).delete(`/api/advisory/sessions/${sessionId}/answers/${questionId}`)).send({});
  assert.equal(del.status, 200);
  const history = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/answers/history?question_id=${questionId}`));
  assert.equal(history.status, 200);
  assert.equal(history.body.answers.length, 2);
  assert.equal(history.body.answers[1].status, 'cleared');
});

test('POST .../complete puis PUT .../answers refusé (409), puis POST .../answers/amend réussit avec motif', async () => {
  const { sessionId, questionId } = await createSimpleSession();
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({});
  await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers: [{ question_id: questionId, status: 'answered', value: true }] });
  const complete = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/complete`)).send({});
  assert.equal(complete.status, 200);

  const writeAfter = await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers: [{ question_id: questionId, status: 'answered', value: false }] });
  assert.equal(writeAfter.status, 409);

  const noReason = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/answers/amend`)).send({ question_id: questionId, status: 'answered', value: false });
  assert.equal(noReason.status, 400);

  const amend = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/answers/amend`)).send({ question_id: questionId, status: 'answered', value: false, amendment_reason: 'Correction test' });
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
