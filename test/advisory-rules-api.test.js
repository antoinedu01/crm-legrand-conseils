// Tests API — /api/advisory/rule-sets (Legrand Diagnostic 360, Lot 4A).
// Même convention que test/advisory-questionnaires-api.test.js. Toutes les
// règles ici sont fictives et techniques — aucune ne constitue un conseil
// d'assurance réel.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-rules-api-'));
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

let counter = 0;
function uniqueKey(prefix) {
  counter += 1;
  return `${prefix}-${counter}-${Math.random().toString(36).slice(2)}`;
}

// Publie un mini-questionnaire fictif avec une question booléenne, pour que
// les règles créées ci-dessous puissent référencer une clé stable connue.
async function buildPublishedQuestionForRules(domain = 'health') {
  const q = await auth(request(app).post('/api/advisory/questionnaires')).send({ stable_key: uniqueKey('rules-api-quest'), domain, name: 'Démo' });
  const v = await auth(request(app).post(`/api/advisory/questionnaires/${q.body.id}/versions`)).send({});
  const sec = await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/sections`)).send({ stable_key: 's1', title: 'S', sort_order: 1 });
  const key = uniqueKey('q');
  await auth(request(app).post(`/api/advisory/questionnaires/sections/${sec.body.id}/questions`)).send({ stable_key: key, advisor_text: 'X ?', type: 'boolean', sort_order: 1 });
  await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/publish`)).send({});
  return key;
}

function validRulePayload(answerKey, overrides = {}) {
  return {
    stable_key: uniqueKey('TEST-RULE-API'),
    title: 'Règle technique fictive API',
    conditions: { op: 'equals', ref: { answer: answerKey }, value: true },
    required_data: [{ answer: answerKey }],
    result_finding_type: 'detected_need',
    result_payload: { category_hint: 'categorie_api_fictive' },
    priority: 'medium',
    advisor_explanation: 'Explication technique fictive.',
    source: 'Exemple technique fictif — ne constitue pas un conseil d\'assurance.',
    source_reference: 'REF-API-001',
    effective_from: '2020-01-01',
    sort_order: 1,
    ...overrides,
  };
}

async function createRuleSetViaApi(domain = 'health') {
  const res = await auth(request(app).post('/api/advisory/rule-sets')).send({ stable_key: uniqueKey('rs-api'), domain, name: 'Ensemble API fictif' });
  return res.body.id;
}

// Politique « un seul rule_set publié par domaine » (GATE LOT 4A, §2) :
// chaque test veut publier un rule_set isolé sans se soucier des autres —
// archive donc systématiquement toute AUTRE famille déjà publiée pour ce
// domaine avant de publier la nouvelle.
async function publishFreshApi(ruleSetId) {
  const rs = db.prepare('SELECT domain, stable_key FROM advisory_rule_sets WHERE id = ?').get(ruleSetId);
  const others = db.prepare("SELECT id FROM advisory_rule_sets WHERE domain = ? AND status = 'published' AND stable_key != ?").all(rs.domain, rs.stable_key);
  for (const o of others) await auth(request(app).post(`/api/advisory/rule-sets/${o.id}/archive`));
  return auth(request(app).post(`/api/advisory/rule-sets/${ruleSetId}/publish`));
}

// --- Authentification / CSRF ------------------------------------------------

test('GET /api/advisory/rule-sets sans session est refusé (401)', async () => {
  const res = await request(app).get('/api/advisory/rule-sets');
  assert.equal(res.status, 401);
});

test('POST /api/advisory/rule-sets intersite est bloqué (CSRF, 403)', async () => {
  const res = await auth(request(app).post('/api/advisory/rule-sets'))
    .set('Origin', 'https://site-malveillant.example')
    .send({ stable_key: uniqueKey('rs-csrf'), domain: 'health', name: 'X' });
  assert.equal(res.status, 403);
});

// --- Cache / no-store sur les lectures sensibles ----------------------------

test('GET /api/advisory/rule-sets/:id/validate — Cache-Control: no-store, private', async () => {
  const ruleSetId = await createRuleSetViaApi();
  const res = await auth(request(app).get(`/api/advisory/rule-sets/${ruleSetId}/validate`));
  assert.equal(res.status, 200);
  assert.match(res.headers['cache-control'], /no-store/);
});

// --- Cycle complet : création -> règle -> validation -> publication --------

test('Cycle complet : rule_set brouillon -> règle -> lecture du détail', async () => {
  const answerKey = await buildPublishedQuestionForRules('health');
  const ruleSetId = await createRuleSetViaApi('health');
  const ruleRes = await auth(request(app).post(`/api/advisory/rule-sets/${ruleSetId}/rules`)).send(validRulePayload(answerKey));
  assert.equal(ruleRes.status, 201);

  const detail = await auth(request(app).get(`/api/advisory/rule-sets/${ruleSetId}`));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.status, 'draft');
  assert.equal(detail.body.rules.length, 1);
});

test('POST /api/advisory/rule-sets/:id/rules — puis publication réussie (200), contenu figé en lecture', async () => {
  const answerKey = await buildPublishedQuestionForRules('health');
  const ruleSetId = await createRuleSetViaApi('health');
  await auth(request(app).post(`/api/advisory/rule-sets/${ruleSetId}/rules`)).send(validRulePayload(answerKey));
  const publish = await publishFreshApi(ruleSetId);
  assert.equal(publish.status, 200);
  assert.ok(publish.body.content_hash);

  const detail = await auth(request(app).get(`/api/advisory/rule-sets/${ruleSetId}`));
  assert.equal(detail.body.status, 'published');

  // Une règle ne peut plus être modifiée une fois le rule_set publié.
  const blocked = await auth(request(app).post(`/api/advisory/rule-sets/${ruleSetId}/rules`)).send(validRulePayload(answerKey));
  assert.equal(blocked.status, 409);
});

test('GET /api/advisory/rule-sets/:id/validate — expose les erreurs de validation sans rien publier', async () => {
  const ruleSetId = await createRuleSetViaApi('health');
  const res = await auth(request(app).get(`/api/advisory/rule-sets/${ruleSetId}/validate`));
  assert.equal(res.status, 200);
  assert.equal(res.body.valid, false);
  assert.ok(res.body.errors.length > 0);
});

test('POST /api/advisory/rule-sets/:id/publish — 409 avec liste d\'erreurs si invalide', async () => {
  const ruleSetId = await createRuleSetViaApi('health');
  const res = await publishFreshApi(ruleSetId);
  assert.equal(res.status, 409);
  assert.ok(Array.isArray(res.body.errors));
});

test('PUT /api/advisory/rule-sets/:id/rules/:ruleId — modifie une règle existante en brouillon', async () => {
  const answerKey = await buildPublishedQuestionForRules('health');
  const ruleSetId = await createRuleSetViaApi('health');
  const created = await auth(request(app).post(`/api/advisory/rule-sets/${ruleSetId}/rules`)).send(validRulePayload(answerKey));
  const updated = await auth(request(app).put(`/api/advisory/rule-sets/${ruleSetId}/rules/${created.body.id}`))
    .send(validRulePayload(answerKey, { stable_key: 'TEST-RULE-API-RENAMED', title: 'Titre modifié' }));
  assert.equal(updated.status, 200);
  const detail = await auth(request(app).get(`/api/advisory/rule-sets/${ruleSetId}`));
  assert.equal(detail.body.rules[0].title, 'Titre modifié');
});

test('POST /api/advisory/rule-sets/:id/versions — nouvelle version brouillon, numéro croissant', async () => {
  const ruleSetId = await createRuleSetViaApi('health');
  const res = await auth(request(app).post(`/api/advisory/rule-sets/${ruleSetId}/versions`)).send({});
  assert.equal(res.status, 201);
  assert.equal(res.body.version_number, 2);
});

test('POST /api/advisory/rule-sets/:id/clone — copie les règles vers une nouvelle version', async () => {
  const answerKey = await buildPublishedQuestionForRules('health');
  const ruleSetId = await createRuleSetViaApi('health');
  await auth(request(app).post(`/api/advisory/rule-sets/${ruleSetId}/rules`)).send(validRulePayload(answerKey));
  await publishFreshApi(ruleSetId);
  const clone = await auth(request(app).post(`/api/advisory/rule-sets/${ruleSetId}/clone`));
  assert.equal(clone.status, 201);
  const detail = await auth(request(app).get(`/api/advisory/rule-sets/${clone.body.id}`));
  assert.equal(detail.body.status, 'draft');
  assert.equal(detail.body.rules.length, 1);
});

test('POST /api/advisory/rule-sets/:id/archive — archive, idempotent', async () => {
  const ruleSetId = await createRuleSetViaApi('health');
  const res = await auth(request(app).post(`/api/advisory/rule-sets/${ruleSetId}/archive`));
  assert.equal(res.status, 200);
  const detail = await auth(request(app).get(`/api/advisory/rule-sets/${ruleSetId}`));
  assert.equal(detail.body.status, 'archived');
});

test('GET /api/advisory/rule-sets/:id — 404 si introuvable', async () => {
  const res = await auth(request(app).get('/api/advisory/rule-sets/999999'));
  assert.equal(res.status, 404);
});

test('POST /api/advisory/rule-sets — domaine « mixed » refusé (400)', async () => {
  const res = await auth(request(app).post('/api/advisory/rule-sets')).send({ stable_key: uniqueKey('rs-mixed'), domain: 'mixed', name: 'X' });
  assert.equal(res.status, 400);
});

test('GET /api/advisory/rule-sets — filtre par domaine et statut', async () => {
  const ruleSetId = await createRuleSetViaApi('life_pension');
  const res = await auth(request(app).get('/api/advisory/rule-sets?domain=life_pension&status=draft'));
  assert.equal(res.status, 200);
  assert.ok(res.body.some((r) => r.id === ruleSetId));
});
