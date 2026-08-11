// Test d'intégration du montage réel de l'API rendez-vous (lot A2c).
// Contrairement à test/appointments.test.js (harnais isolé, lot A2b, qui
// teste toute la logique métier), ce fichier importe la VRAIE application
// server/app.js pour vérifier uniquement le montage et l'authentification
// — pas la logique métier, déjà couverte en A2b. Convention identique à
// test/campaigns-integration.test.js (A1b) et
// test/acquisition-analytics-integration.test.js (A6b).
//
// Base de test isolée via CRM_DATA_DIR (dossier temporaire), exactement
// comme test/api.test.js : le chargement de server/app.js exécute la
// migration v9 sur cette base temporaire (attendu), jamais sur une base
// réelle ni sur data/**.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-appointments-integration-'));
process.env.NODE_ENV = 'test';
process.env.SITE_ORIGINS = 'https://site-de-test.ch';
process.env.PUBLIC_RATE_LIMIT = '100';

const { default: app } = await import('../server/app.js');
const { default: db } = await import('../server/db.js');

const PASSWORD = 'MotDePasseDeTest!42';
let cookie = '';

before(async () => {
  const res = await request(app)
    .post('/api/auth/setup')
    .send({ email: 'test-appointments@exemple.ch', name: 'Testeur', password: PASSWORD });
  assert.equal(res.status, 200);
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
});

test('GET /api/appointments sans authentification est refusé (401)', async () => {
  const res = await request(app).get('/api/appointments');
  assert.equal(res.status, 401);
});

test('GET /api/appointments authentifié est accessible (200)', async () => {
  const res = await request(app).get('/api/appointments').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
});

test('POST /api/appointments authentifié fonctionne avec un client valide et des timestamps canoniques', async () => {
  const client = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Test', 'Intégration', 'prospect')")
    .run();
  const res = await request(app)
    .post('/api/appointments')
    .set('Cookie', cookie)
    .send({ client_id: client.lastInsertRowid, starts_at: '2026-09-04 09:30:00', ends_at: '2026-09-04 10:30:00' });
  assert.equal(res.status, 201);
  assert.ok(Number.isInteger(res.body.id));

  const detail = await request(app).get(`/api/appointments/${res.body.id}`).set('Cookie', cookie);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.client_id, client.lastInsertRowid);
  assert.equal(detail.body.starts_at, '2026-09-04 09:30:00');
});

test('le montage de /api/appointments ne modifie pas /api/campaigns', async () => {
  const res = await request(app).get('/api/campaigns').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
});

test('le montage de /api/appointments ne modifie pas /api/acquisition/analytics/summary', async () => {
  const res = await request(app).get('/api/acquisition/analytics/summary').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.caveats));
});

test('le montage de /api/appointments ne modifie pas le comportement de /api/public/lead', async () => {
  const res = await request(app)
    .post('/api/public/lead')
    .set('Origin', 'https://site-de-test.ch')
    .send({
      first_name: 'Paul',
      last_name: 'Martin',
      email: 'paul.martin.a2c@exemple.ch',
      main_need: 'LAMal / caisse maladie',
      consent: true,
    });
  assert.equal(res.status, 201);
});

test('le montage de /api/appointments ne modifie pas la protection CORS de /api/public/lead', async () => {
  const res = await request(app)
    .post('/api/public/lead')
    .set('Origin', 'https://site-malveillant.example')
    .send({ first_name: 'X', last_name: 'Y', email: 'x@exemple.ch', consent: true });
  assert.equal(res.status, 403);
});
