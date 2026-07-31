// Tests API — /api/advisory/questionnaires (Legrand Diagnostic 360, Lot 3A).
// Même convention que test/api.test.js et test/advisory-households-api.test.js.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-questionnaires-api-'));
process.env.NODE_ENV = 'test';
process.env.SITE_ORIGINS = 'https://site-de-test.ch';
process.env.PUBLIC_RATE_LIMIT = '100';

const { default: app } = await import('../server/app.js');

const PASSWORD = 'MotDePasseDeTest!42';
let cookie = '';
function auth(req) { return req.set('Cookie', cookie); }

before(async () => {
  const res = await request(app).post('/api/auth/setup').send({ email: 'test@exemple.ch', name: 'Testeur', password: PASSWORD });
  assert.equal(res.status, 200);
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
});

let counter = 0;
async function buildPublishedVersion(domain = 'health') {
  counter += 1;
  const q = await auth(request(app).post('/api/advisory/questionnaires')).send({ stable_key: `api-demo-${counter}`, domain, name: `Démo ${counter}` });
  const v = await auth(request(app).post(`/api/advisory/questionnaires/${q.body.id}/versions`)).send({});
  const sec = await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/sections`)).send({ stable_key: 's1', title: 'Section', sort_order: 1 });
  const ques = await auth(request(app).post(`/api/advisory/questionnaires/sections/${sec.body.id}/questions`)).send({ stable_key: 'q1', advisor_text: 'X ?', type: 'boolean', required: true, sort_order: 1 });
  await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/publish`)).send({});
  return { questionnaireId: q.body.id, versionId: v.body.id, sectionId: sec.body.id, questionId: ques.body.id };
}

// --- Authentification / CSRF ------------------------------------------------

test('GET /api/advisory/questionnaires sans session est refusé (401)', async () => {
  const res = await request(app).get('/api/advisory/questionnaires');
  assert.equal(res.status, 401);
});

test('POST /api/advisory/questionnaires intersite est bloqué (CSRF, 403)', async () => {
  const res = await auth(request(app).post('/api/advisory/questionnaires'))
    .set('Origin', 'https://site-malveillant.example')
    .send({ stable_key: 'x', domain: 'health', name: 'X' });
  assert.equal(res.status, 403);
});

// --- Questionnaires ----------------------------------------------------

test('POST /api/advisory/questionnaires — création valide (201) puis 409 sur clé stable dupliquée', async () => {
  const res = await auth(request(app).post('/api/advisory/questionnaires')).send({ stable_key: 'api-unique-key', domain: 'health', name: 'Démo' });
  assert.equal(res.status, 201);
  const dup = await auth(request(app).post('/api/advisory/questionnaires')).send({ stable_key: 'api-unique-key', domain: 'life_pension', name: 'Autre' });
  assert.equal(dup.status, 409);
});

test('POST /api/advisory/questionnaires — domaine invalide -> 400', async () => {
  const res = await auth(request(app).post('/api/advisory/questionnaires')).send({ stable_key: 'api-bad-domain', domain: 'mixed', name: 'X' });
  assert.equal(res.status, 400);
});

test('GET /api/advisory/questionnaires — liste filtrable par domaine', async () => {
  await auth(request(app).post('/api/advisory/questionnaires')).send({ stable_key: 'api-filter-key', domain: 'life_pension', name: 'Filtre' });
  const res = await auth(request(app).get('/api/advisory/questionnaires?domain=life_pension'));
  assert.equal(res.status, 200);
  assert.ok(res.body.every((r) => r.domain === 'life_pension'));
});

// --- Versions / sections / questions / options --------------------------

test('Cycle complet : version brouillon -> sections -> questions -> options -> publication', async () => {
  const { versionId, sectionId } = await buildPublishedVersion();
  const res = await auth(request(app).get(`/api/advisory/questionnaires/versions/${versionId}`));
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'published');
  assert.equal(res.body.sections.length, 1);
  assert.equal(res.body.sections[0].id, sectionId);
});

test('GET /api/advisory/questionnaires/versions/:id — 404 si introuvable', async () => {
  const res = await auth(request(app).get('/api/advisory/questionnaires/versions/999999'));
  assert.equal(res.status, 404);
});

test('POST .../sections puis modification refusée après publication (409)', async () => {
  const { versionId } = await buildPublishedVersion();
  const res = await auth(request(app).post(`/api/advisory/questionnaires/versions/${versionId}/sections`)).send({ stable_key: 'nouvelle', title: 'X', sort_order: 2 });
  assert.equal(res.status, 409);
});

test('GET .../versions/:id/validate — signale une référence de condition inconnue', async () => {
  const q = await auth(request(app).post('/api/advisory/questionnaires')).send({ stable_key: 'api-cond-key', domain: 'health', name: 'X' });
  const v = await auth(request(app).post(`/api/advisory/questionnaires/${q.body.id}/versions`)).send({});
  const sec = await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/sections`)).send({ stable_key: 's1', title: 'S', sort_order: 1 });
  await auth(request(app).post(`/api/advisory/questionnaires/sections/${sec.body.id}/questions`)).send({
    stable_key: 'q1', advisor_text: 'X', type: 'boolean', sort_order: 1,
    display_condition: { op: 'exists', ref: { question: 'inconnue' } },
  });
  const check = await auth(request(app).get(`/api/advisory/questionnaires/versions/${v.body.id}/validate`));
  assert.equal(check.status, 200);
  assert.equal(check.body.valid, false);
});

test('POST .../publish — refuse une version invalide avec le détail des erreurs (409)', async () => {
  const q = await auth(request(app).post('/api/advisory/questionnaires')).send({ stable_key: 'api-invalid-pub', domain: 'health', name: 'X' });
  const v = await auth(request(app).post(`/api/advisory/questionnaires/${q.body.id}/versions`)).send({});
  const res = await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/publish`)).send({});
  assert.equal(res.status, 409);
  assert.ok(Array.isArray(res.body.errors));
});

test('GET /api/advisory/questionnaires/versions — filtre par domaine et statut publié', async () => {
  const { versionId } = await buildPublishedVersion('life_pension');
  const res = await auth(request(app).get('/api/advisory/questionnaires/versions?domain=life_pension&status=published'));
  assert.equal(res.status, 200);
  assert.ok(res.body.some((v) => v.id === versionId));
});

test('POST .../archive puis .../clone — clone un contenu publié en nouveau brouillon indépendant', async () => {
  const { versionId } = await buildPublishedVersion();
  const clone = await auth(request(app).post(`/api/advisory/questionnaires/versions/${versionId}/clone`)).send({});
  assert.equal(clone.status, 201);
  const cloneDetail = await auth(request(app).get(`/api/advisory/questionnaires/versions/${clone.body.id}`));
  assert.equal(cloneDetail.body.status, 'draft');

  const archive = await auth(request(app).post(`/api/advisory/questionnaires/versions/${versionId}/archive`)).send({});
  assert.equal(archive.status, 200);
  const detail = await auth(request(app).get(`/api/advisory/questionnaires/versions/${versionId}`));
  assert.equal(detail.body.status, 'archived');
});
