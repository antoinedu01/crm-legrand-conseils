// Test d'intégration du montage réel de l'API campagnes (lot A1b).
// Contrairement à test/campaigns.test.js (harnais isolé, lot A1a), ce
// fichier importe la VRAIE application server/app.js pour vérifier que
// /api/campaigns est correctement monté et protégé par requireAuth, au
// même titre que les autres routes privées. Convention identique à
// test/api.test.js (base de test isolée via CRM_DATA_DIR).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-campaigns-integration-'));
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
    .send({ email: 'test-campaigns@exemple.ch', name: 'Testeur', password: PASSWORD });
  assert.equal(res.status, 200);
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
});

test('GET /api/campaigns sans authentification est refusé (401), comme les autres routes privées', async () => {
  const res = await request(app).get('/api/campaigns');
  assert.equal(res.status, 401);
});

test('GET /api/campaigns authentifié est accessible (200) une fois monté', async () => {
  const res = await request(app).get('/api/campaigns').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
});

test('POST /api/campaigns authentifié fonctionne avec des données valides', async () => {
  const channel = db.prepare('SELECT id FROM channels ORDER BY id LIMIT 1').get();
  assert.ok(channel, 'Le seed de channels doit fournir au moins un canal pour ce test.');

  const res = await request(app)
    .post('/api/campaigns')
    .set('Cookie', cookie)
    .send({ name: 'Campagne montée en intégration', channel_id: channel.id });
  assert.equal(res.status, 201);
  assert.ok(Number.isInteger(res.body.id));

  const detail = await request(app).get(`/api/campaigns/${res.body.id}`).set('Cookie', cookie);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.name, 'Campagne montée en intégration');
});

test('le montage de /api/campaigns ne modifie pas le comportement de /api/public/lead', async () => {
  const res = await request(app)
    .post('/api/public/lead')
    .set('Origin', 'https://site-de-test.ch')
    .send({
      first_name: 'Marie',
      last_name: 'Dupont',
      email: 'marie.dupont.a1b@exemple.ch',
      main_need: 'LAMal / caisse maladie',
      consent: true,
    });
  assert.equal(res.status, 201);
});

test('le montage de /api/campaigns ne modifie pas la protection CORS de /api/public/lead', async () => {
  const res = await request(app)
    .post('/api/public/lead')
    .set('Origin', 'https://site-malveillant.example')
    .send({ first_name: 'X', last_name: 'Y', email: 'x@exemple.ch', consent: true });
  assert.equal(res.status, 403);
});
