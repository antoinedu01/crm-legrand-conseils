// Tests API — /api/advisory/retention (contrôles de conservation,
// anonymisation et effacement des données de diagnostic). Même convention
// que test/advisory-sessions-api.test.js. Base de test isolée
// (CRM_DATA_DIR), jamais data/**.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-retention-api-'));
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
async function buildHousehold() {
  counter += 1;
  const clientId = db
    .prepare('INSERT INTO clients (type, first_name, last_name, status) VALUES (?, ?, ?, ?)')
    .run('particulier', `Api${counter}`, 'Retention', 'prospect').lastInsertRowid;
  const res = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: clientId });
  return res.body.id;
}

// --- Authentification ------------------------------------------------------

test('GET .../retention/policies sans session est refusé (401)', async () => {
  const res = await request(app).get('/api/advisory/retention/policies');
  assert.equal(res.status, 401);
});

test('POST .../retention/dry-run intersite est bloqué (CSRF, 403)', async () => {
  const res = await request(app)
    .post('/api/advisory/retention/dry-run')
    .set('Cookie', cookie)
    .set('Origin', 'https://site-hostile.example');
  assert.equal(res.status, 403);
});

// --- Consultation ------------------------------------------------------------

test('GET .../retention/policies — les 5 catégories sont exposées, toutes désactivées par défaut, sans cache navigateur', async () => {
  const res = await auth(request(app).get('/api/advisory/retention/policies'));
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store, private');
  assert.equal(res.body.policies.length, 5);
  assert.ok(res.body.policies.every((p) => p.enabled === 0));
});

test('GET .../retention/config — purge réelle désactivée par défaut', async () => {
  const res = await auth(request(app).get('/api/advisory/retention/config'));
  assert.equal(res.status, 200);
  assert.equal(res.body.real_purge_enabled, 0);
});

// --- Legal hold --------------------------------------------------------------

test('POST/GET/lift .../households/:id/legal-holds — cycle complet, motif obligatoire, historique conservé', async () => {
  const householdId = await buildHousehold();

  const noReason = await auth(request(app).post(`/api/advisory/retention/households/${householdId}/legal-holds`)).send({});
  assert.equal(noReason.status, 400);

  const created = await auth(request(app).post(`/api/advisory/retention/households/${householdId}/legal-holds`)).send({ reason: 'Litige en cours.' });
  assert.equal(created.status, 201);
  assert.equal(created.body.active, 1);

  const second = await auth(request(app).post(`/api/advisory/retention/households/${householdId}/legal-holds`)).send({ reason: 'Autre motif.' });
  assert.equal(second.status, 409, 'un second hold actif est refusé tant que le premier n’est pas levé');

  const lifted = await auth(request(app).post(`/api/advisory/retention/households/${householdId}/legal-holds/${created.body.id}/lift`)).send({ ended_reason: 'Résolu.' });
  assert.equal(lifted.status, 200);
  assert.equal(lifted.body.active, 0);

  const list = await auth(request(app).get(`/api/advisory/retention/households/${householdId}/legal-holds`));
  assert.equal(list.status, 200);
  assert.equal(list.body.legal_holds.length, 1);
});

test('POST .../legal-holds sur un foyer inexistant renvoie 404', async () => {
  const res = await auth(request(app).post('/api/advisory/retention/households/999999/legal-holds')).send({ reason: 'X' });
  assert.equal(res.status, 404);
});

// --- Simulation (dry-run) ----------------------------------------------------

test('POST .../retention/dry-run — produit un rapport consultable ensuite par GET .../purge-runs/:id, jamais de purge réelle déclenchée', async () => {
  const run = await auth(request(app).post('/api/advisory/retention/dry-run')).send({});
  assert.equal(run.status, 201);
  assert.equal(run.body.run_type, 'dry_run');
  assert.ok(Array.isArray(run.body.items));

  const detail = await auth(request(app).get(`/api/advisory/retention/purge-runs/${run.body.id}`));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.id, run.body.id);

  const list = await auth(request(app).get('/api/advisory/retention/purge-runs?run_type=dry_run'));
  assert.equal(list.status, 200);
  assert.ok(list.body.runs.some((r) => r.id === run.body.id));

  // Aucune route de purge réelle n'existe -- absence de route, pas seulement
  // absence de bouton : /purge (sans -runs) ne doit correspondre à rien.
  const noPurgeRoute = await auth(request(app).post('/api/advisory/retention/purge')).send({});
  assert.equal(noPurgeRoute.status, 404);
});

test('GET .../purge-runs/:id introuvable renvoie 404', async () => {
  const res = await auth(request(app).get('/api/advisory/retention/purge-runs/999999'));
  assert.equal(res.status, 404);
});
