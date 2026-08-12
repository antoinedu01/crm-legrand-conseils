// Test d'intégration du montage réel de l'API analytics d'acquisition
// (lot A6b). Contrairement à test/acquisition-analytics.test.js (harnais
// isolé, lot A6a/M0c10, qui teste la logique métier avec des fixtures), ce
// fichier importe la VRAIE application server/app.js pour vérifier
// uniquement le montage et l'authentification — pas la logique métier,
// déjà couverte en M0c10. Convention identique à
// test/campaigns-integration.test.js et test/appointments-integration.test.js.
//
// Porté depuis feature/acquisition-os (lot A6b, commit 71e8727) vers cette
// base d'intégration — PAR PORTAGE MANUEL, pas cherry-pick (voir M0c11) :
// server/app.js a évolué indépendamment ici (Diagnostic 360, Campaigns,
// Appointments), et le backend Analytics intégré est V2 (M0c10), pas
// identique au backend historique A6a. Les 7 scénarios historiques ne
// référençaient aucun champ commissions (seulement des formes de tableau
// et des codes HTTP) : aucune assertion existante n'était donc devenue
// obsolète — mais M0c11 exige explicitement (§11) une confirmation du
// contrat V2 via le vrai runtime, ajoutée ici en assertions nouvelles sur
// les 3 endpoints, sans toucher aux assertions historiques.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-acq-analytics-integration-'));
process.env.NODE_ENV = 'test';
process.env.SITE_ORIGINS = 'https://site-de-test.ch';
process.env.PUBLIC_RATE_LIMIT = '100';

const { default: app } = await import('../server/app.js');

const PASSWORD = 'MotDePasseDeTest!42';
let cookie = '';

before(async () => {
  const res = await request(app)
    .post('/api/auth/setup')
    .send({ email: 'test-acq-analytics@exemple.ch', name: 'Testeur', password: PASSWORD });
  assert.equal(res.status, 200);
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
});

test('GET /api/acquisition/analytics/summary sans authentification est refusé (401)', async () => {
  const res = await request(app).get('/api/acquisition/analytics/summary');
  assert.equal(res.status, 401);
});

test('GET /api/acquisition/analytics/summary authentifié est accessible (200) et respecte le contrat V2', async () => {
  const res = await request(app).get('/api/acquisition/analytics/summary').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.caveats));

  // Contrat V2 (M0c9/M0c10) confirmé via le vrai server/app.js, pas
  // seulement via le harnais isolé de M0c10 : expected/received séparés,
  // aucun champ legacy conservé.
  assert.equal(typeof res.body.commissions.expected_amount, 'number');
  assert.equal(typeof res.body.commissions.received_amount, 'number');
  assert.equal(typeof res.body.commissions.by_status, 'object');
  assert.equal(res.body.commissions.total_amount, undefined, 'le champ legacy total_amount ne doit plus exister');
});

test('GET /api/acquisition/analytics/campaigns authentifié est accessible (200) et respecte le contrat V2', async () => {
  const res = await request(app).get('/api/acquisition/analytics/campaigns').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.campaigns));
  assert.equal(typeof res.body.unattributed.expected_commissions_amount, 'number');
  assert.equal(typeof res.body.unattributed.received_commissions_amount, 'number');
  assert.equal(res.body.unattributed.commissions_amount, undefined, 'le champ legacy commissions_amount ne doit plus exister');
});

test('GET /api/acquisition/analytics/channels authentifié est accessible (200) et respecte le contrat V2', async () => {
  const res = await request(app).get('/api/acquisition/analytics/channels').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.channels));
  assert.equal(typeof res.body.unattributed.expected_commissions_amount, 'number');
  assert.equal(typeof res.body.unattributed.received_commissions_amount, 'number');
  assert.equal(res.body.unattributed.commissions_amount, undefined, 'le champ legacy commissions_amount ne doit plus exister');
});

test('le montage de /api/acquisition/analytics ne modifie pas le comportement de /api/public/lead', async () => {
  const res = await request(app)
    .post('/api/public/lead')
    .set('Origin', 'https://site-de-test.ch')
    .send({
      first_name: 'Paul',
      last_name: 'Martin',
      email: 'paul.martin.a6b@exemple.ch',
      main_need: 'LAMal / caisse maladie',
      consent: true,
    });
  assert.equal(res.status, 201);
});

test('le montage de /api/acquisition/analytics ne modifie pas la protection CORS de /api/public/lead', async () => {
  const res = await request(app)
    .post('/api/public/lead')
    .set('Origin', 'https://site-malveillant.example')
    .send({ first_name: 'X', last_name: 'Y', email: 'x@exemple.ch', consent: true });
  assert.equal(res.status, 403);
});

test('non-régression A1b : /api/campaigns reste accessible authentifié', async () => {
  const res = await request(app).get('/api/campaigns').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
});
