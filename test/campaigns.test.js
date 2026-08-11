// Tests d'intégration du registre de campagnes (node:test + supertest).
// Lot A1a — API isolée, NON montée dans server/app.js à ce stade.
//
// Ce fichier construit son propre harnais Express minimal (mêmes briques
// que server/app.js : express.json, une session, requireAuth, le routeur
// testé, puis validationErrors) sans importer ni modifier server/app.js.
// La base de test est isolée dans un dossier temporaire (CRM_DATA_DIR),
// comme test/api.test.js.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import session from 'express-session';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-campaigns-'));
process.env.NODE_ENV = 'test';

const { default: db } = await import('../server/db.js');
const { campaignsRouter } = await import('../server/routes/campaigns.js');
const { requireAuth } = await import('../server/auth.js');
const { validationErrors } = await import('../server/validate.js');

function errorHandler(err, req, res, next) {
  if (err) return res.status(500).json({ error: 'Erreur interne du serveur.' });
  next();
}

// Harnais « non authentifié » : reproduit exactement le montage prévu en
// production (requireAuth avant le routeur), pour vérifier que l'API reste
// protégée une fois branchée.
function buildUnauthApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true }));
  app.use('/api/campaigns', requireAuth, campaignsRouter);
  app.use(validationErrors);
  app.use(errorHandler);
  return app;
}

// Harnais « authentifié » : injecte une session valide avant le routeur,
// pour tester le comportement fonctionnel sans dépendre du flux de
// connexion complet (hors périmètre de ce lot, /api/auth n'étant pas monté
// ici).
function buildAuthedApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true }));
  app.use((req, res, next) => {
    req.session.userId = 1;
    next();
  });
  app.use('/api/campaigns', campaignsRouter);
  app.use(validationErrors);
  app.use(errorHandler);
  return app;
}

const app = buildAuthedApp();
const unauthApp = buildUnauthApp();

let channelId;
let channelName;

before(() => {
  const channel = db.prepare('SELECT id, name FROM channels ORDER BY id LIMIT 1').get();
  assert.ok(channel, 'Le seed de channels doit fournir au moins un canal pour les tests.');
  channelId = channel.id;
  channelName = channel.name;
});

test('accès sans session refusé (401)', async () => {
  const res = await request(unauthApp).get('/api/campaigns');
  assert.equal(res.status, 401);
});

test('liste des campagnes (tableau, vide ou non)', async () => {
  const res = await request(app).get('/api/campaigns');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
});

test('campagne inexistante -> 404', async () => {
  const res = await request(app).get('/api/campaigns/999999');
  assert.equal(res.status, 404);
});

test('identifiant de campagne invalide -> 400', async () => {
  const res = await request(app).get('/api/campaigns/abc');
  assert.equal(res.status, 400);
});

test('création valide : nom + canal existant', async () => {
  const res = await request(app)
    .post('/api/campaigns')
    .send({ name: 'Lancement LinkedIn', channel_id: channelId });
  assert.equal(res.status, 201);
  assert.ok(Number.isInteger(res.body.id));

  const detail = await request(app).get(`/api/campaigns/${res.body.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.name, 'Lancement LinkedIn');
  assert.equal(detail.body.channel_id, channelId);
  assert.equal(detail.body.channel_name, channelName); // LEFT JOIN vers channels
  assert.equal(detail.body.status, 'brouillon'); // valeur par défaut du schéma (server/db.js)
});

test('channel_id inexistant refusé (400)', async () => {
  const res = await request(app)
    .post('/api/campaigns')
    .send({ name: 'Campagne orpheline', channel_id: 999999 });
  assert.equal(res.status, 400);

  const list = await request(app).get('/api/campaigns');
  assert.ok(!list.body.some((c) => c.name === 'Campagne orpheline'), 'aucune campagne orpheline ne doit être créée');
});

test('données invalides : nom manquant -> 400', async () => {
  const res = await request(app).post('/api/campaigns').send({ channel_id: channelId });
  assert.equal(res.status, 400);
});

test('données invalides : nom vide -> 400', async () => {
  const res = await request(app).post('/api/campaigns').send({ name: '   ' });
  assert.equal(res.status, 400);
});

test('modification valide (nom et statut)', async () => {
  const created = await request(app).post('/api/campaigns').send({ name: 'À renommer' });
  const id = created.body.id;

  const res = await request(app).put(`/api/campaigns/${id}`).send({ name: 'Renommée', status: 'active' });
  assert.equal(res.status, 200);

  const detail = await request(app).get(`/api/campaigns/${id}`);
  assert.equal(detail.body.name, 'Renommée');
  assert.equal(detail.body.status, 'active');
});

test('modification d’une campagne inexistante -> 404', async () => {
  const res = await request(app).put('/api/campaigns/999999').send({ name: 'X' });
  assert.equal(res.status, 404);
});

test('modification : channel_id inexistant refusé (400), campagne inchangée', async () => {
  const created = await request(app).post('/api/campaigns').send({ name: 'Stable', channel_id: channelId });
  const id = created.body.id;

  const res = await request(app).put(`/api/campaigns/${id}`).send({ channel_id: 999999 });
  assert.equal(res.status, 400);

  const detail = await request(app).get(`/api/campaigns/${id}`);
  assert.equal(detail.body.channel_id, channelId, 'le canal ne doit pas avoir changé après un rejet 400');
});

test('modification : un champ hors whitelist (id, created_at) est ignoré, jamais écrasé', async () => {
  const created = await request(app).post('/api/campaigns').send({ name: 'Protégée' });
  const id = created.body.id;
  const before2 = await request(app).get(`/api/campaigns/${id}`);

  const res = await request(app)
    .put(`/api/campaigns/${id}`)
    .send({ name: 'Protégée', id: 999999, created_at: '2000-01-01T00:00:00.000Z' });
  assert.equal(res.status, 200);

  const after = await request(app).get(`/api/campaigns/${id}`);
  assert.equal(after.body.id, id, 'l’id réel ne doit jamais être modifiable via le corps de la requête');
  assert.equal(after.body.created_at, before2.body.created_at, 'created_at ne doit jamais être modifiable via le corps de la requête');
});

test('modification : uniquement des champs hors whitelist -> aucun effet (no-op)', async () => {
  const created = await request(app).post('/api/campaigns').send({ name: 'Intacte' });
  const id = created.body.id;
  const before2 = await request(app).get(`/api/campaigns/${id}`);

  const res = await request(app).put(`/api/campaigns/${id}`).send({ is_admin: true, owner: 'quelqu’un' });
  assert.equal(res.status, 200);

  const after = await request(app).get(`/api/campaigns/${id}`);
  assert.deepEqual(after.body, before2.body, 'aucun champ ne doit changer si seuls des champs non autorisés sont envoyés');
});
