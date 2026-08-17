// Tests d'intégration du registre de campagnes (node:test + supertest).
// Lot A1a — API isolée, NON montée dans server/app.js à ce stade.
//
// Ce fichier construit son propre harnais Express minimal (mêmes briques
// que server/app.js : express.json, une session, requireAuth, le routeur
// testé, puis validationErrors) sans importer ni modifier server/app.js.
// La base de test est isolée dans un dossier temporaire (CRM_DATA_DIR),
// comme test/api.test.js.
import { test, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
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

// --- A4.4 : clés de tracking stables (campaigns.key) -----------------------

test('1. POST crée une key non vide', async () => {
  const res = await request(app).post('/api/campaigns').send({ name: 'Key Non Vide' });
  assert.equal(res.status, 201);
  assert.ok(typeof res.body.key === 'string' && res.body.key.length > 0);
});

test('2. la key générée respecte le format cmp_<32 hex>', async () => {
  const res = await request(app).post('/api/campaigns').send({ name: 'Key Format' });
  assert.equal(res.status, 201);
  assert.match(res.body.key, /^cmp_[a-f0-9]{32}$/);
});

test('3. deux campagnes distinctes ont deux keys différentes', async () => {
  const a = await request(app).post('/api/campaigns').send({ name: 'Key A' });
  const b = await request(app).post('/api/campaigns').send({ name: 'Key B' });
  assert.notEqual(a.body.key, b.body.key);
});

test('4. GET /api/campaigns (liste) expose key pour chaque campagne', async () => {
  const created = await request(app).post('/api/campaigns').send({ name: 'Key Dans La Liste' });
  const res = await request(app).get('/api/campaigns');
  assert.equal(res.status, 200);
  const found = res.body.find((c) => c.id === created.body.id);
  assert.ok(found);
  assert.equal(found.key, created.body.key);
});

test('5. GET /api/campaigns/:id expose key', async () => {
  const created = await request(app).post('/api/campaigns').send({ name: 'Key Dans Le Détail' });
  const res = await request(app).get(`/api/campaigns/${created.body.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.key, created.body.key);
});

test('6. PUT modifiant le nom ne change jamais la key', async () => {
  const created = await request(app).post('/api/campaigns').send({ name: 'Avant Renommage' });
  const originalKey = created.body.key;
  const res = await request(app).put(`/api/campaigns/${created.body.id}`).send({ name: 'Après Renommage' });
  assert.equal(res.status, 200);
  const detail = await request(app).get(`/api/campaigns/${created.body.id}`);
  assert.equal(detail.body.key, originalKey);
});

test('7. PUT modifiant le canal ne change jamais la key', async () => {
  const created = await request(app).post('/api/campaigns').send({ name: 'Avant Canal' });
  const originalKey = created.body.key;
  const res = await request(app).put(`/api/campaigns/${created.body.id}`).send({ channel_id: channelId });
  assert.equal(res.status, 200);
  const detail = await request(app).get(`/api/campaigns/${created.body.id}`);
  assert.equal(detail.body.key, originalKey);
});

test('8. PUT modifiant le statut ne change jamais la key', async () => {
  const created = await request(app).post('/api/campaigns').send({ name: 'Avant Statut' });
  const originalKey = created.body.key;
  const res = await request(app).put(`/api/campaigns/${created.body.id}`).send({ status: 'active' });
  assert.equal(res.status, 200);
  const detail = await request(app).get(`/api/campaigns/${created.body.id}`);
  assert.equal(detail.body.key, originalKey);
});

test('9. un payload client contenant "key" ne peut jamais la modifier (POST et PUT)', async () => {
  const created = await request(app)
    .post('/api/campaigns')
    .send({ name: 'Key Imposée', key: 'cmp_valeur_choisie_par_le_client' });
  assert.equal(created.status, 201);
  assert.notEqual(created.body.key, 'cmp_valeur_choisie_par_le_client');
  assert.match(created.body.key, /^cmp_[a-f0-9]{32}$/);

  const originalKey = created.body.key;
  const res = await request(app)
    .put(`/api/campaigns/${created.body.id}`)
    .send({ name: 'Key Toujours Imposée', key: 'cmp_autre_valeur_choisie' });
  assert.equal(res.status, 200);
  const detail = await request(app).get(`/api/campaigns/${created.body.id}`);
  assert.equal(detail.body.key, originalKey, 'le payload PUT ne doit jamais pouvoir modifier key');
});

test('10. campagne legacy key=NULL : ensure-key génère et persiste une clé', async () => {
  const legacyId = db
    .prepare("INSERT INTO campaigns (name, status, key) VALUES ('Campagne Legacy', 'active', NULL)")
    .run().lastInsertRowid;
  const res = await request(app).post(`/api/campaigns/${legacyId}/ensure-key`);
  assert.equal(res.status, 200);
  assert.match(res.body.key, /^cmp_[a-f0-9]{32}$/);
  const row = db.prepare('SELECT key, name, channel_id, status FROM campaigns WHERE id = ?').get(legacyId);
  assert.equal(row.key, res.body.key);
  assert.equal(row.name, 'Campagne Legacy', 'ensure-key ne doit modifier aucun autre champ');
  assert.equal(row.status, 'active');
});

test('11. ensure-key est idempotent : un second appel retourne la même key, sans la changer', async () => {
  const legacyId = db
    .prepare("INSERT INTO campaigns (name, status, key) VALUES ('Legacy Idempotent', 'active', NULL)")
    .run().lastInsertRowid;
  const first = await request(app).post(`/api/campaigns/${legacyId}/ensure-key`);
  assert.equal(first.status, 200);
  const second = await request(app).post(`/api/campaigns/${legacyId}/ensure-key`);
  assert.equal(second.status, 200);
  assert.equal(second.body.key, first.body.key);
});

test('12. ensure-key sur une campagne inconnue -> 404', async () => {
  const res = await request(app).post('/api/campaigns/999999/ensure-key');
  assert.equal(res.status, 404);
});

test('13. collision de key simulée : régénération automatique jusqu’à succès', async (t) => {
  const fixedUuids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
  const collidingKey = `cmp_${fixedUuids[0].replace(/-/g, '')}`;
  db.prepare("INSERT INTO campaigns (name, status, key) VALUES ('Déjà Cette Clé', 'active', ?)").run(collidingKey);

  let call = 0;
  t.mock.method(crypto, 'randomUUID', () => fixedUuids[call++]);
  t.after(() => mock.restoreAll());

  const res = await request(app).post('/api/campaigns').send({ name: 'Collision Simulée' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(call, 2, 'la première tentative doit avoir collisionné, la seconde doit avoir réussi');
  assert.equal(res.body.key, `cmp_${fixedUuids[1].replace(/-/g, '')}`);
});

test('14. une vraie erreur DB (hors collision de key) n’est jamais masquée', async (t) => {
  // Simule une véritable erreur DB survenant pendant l'INSERT (distincte
  // d'une collision sur campaigns.key) : isCampaignKeyCollision() doit la
  // laisser remonter immédiatement, sans aucune tentative de régénération.
  // Un simple rejet de validation (ex. channel_id inexistant, déjà couvert
  // par le test « channel_id inexistant refusé » plus haut) ne touche
  // jamais la base et ne prouve donc rien ici : il faut une erreur qui
  // survient réellement au niveau de insert.run().
  const originalPrepare = db.prepare.bind(db);
  let insertAttempts = 0;
  t.mock.method(db, 'prepare', (sql) => {
    if (typeof sql === 'string' && sql.startsWith('INSERT INTO campaigns')) {
      return {
        run: () => {
          insertAttempts += 1;
          const err = new Error('NOT NULL constraint failed: campaigns.status');
          err.code = 'SQLITE_CONSTRAINT_NOTNULL';
          throw err;
        },
      };
    }
    return originalPrepare(sql);
  });
  t.after(() => mock.restoreAll());

  const res = await request(app).post('/api/campaigns').send({ name: 'Erreur DB Non Masquée' });

  assert.equal(insertAttempts, 1, 'une erreur non-collision ne doit jamais déclencher de régénération de clé');
  assert.equal(res.status, 500, 'l’erreur DB doit remonter (500), jamais être masquée en faux succès');

  const list = await request(app).get('/api/campaigns');
  assert.ok(
    !list.body.some((c) => c.name === 'Erreur DB Non Masquée'),
    'aucune campagne ne doit être créée en cas d’erreur DB réelle'
  );
});

test('15. audit de ensure-key : uniquement lorsqu’une clé est réellement générée', async () => {
  const countBefore = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'génération clé de campagne (legacy)'").get().n;
  const legacyId = db
    .prepare("INSERT INTO campaigns (name, status, key) VALUES ('Legacy Audit', 'active', NULL)")
    .run().lastInsertRowid;

  await request(app).post(`/api/campaigns/${legacyId}/ensure-key`);
  const countAfterFirst = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'génération clé de campagne (legacy)'").get().n;
  assert.equal(countAfterFirst, countBefore + 1, 'un audit doit être créé quand une clé est réellement générée');

  await request(app).post(`/api/campaigns/${legacyId}/ensure-key`);
  const countAfterSecond = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'génération clé de campagne (legacy)'").get().n;
  assert.equal(countAfterSecond, countAfterFirst, 'aucun audit supplémentaire pour un appel idempotent sans mutation');
});
