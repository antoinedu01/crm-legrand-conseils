// A4.4 — Tests d'intégration croisée pour campaigns.key.
// Vérifie que la clé générée par l'API Campaigns (server/routes/campaigns.js)
// est réellement exploitable telle quelle par les deux consommateurs déjà
// existants, SANS qu'aucun des deux n'ait été modifié dans ce lot :
//   - le resolver (server/acquisition-attribution.js, A4.2)
//   - la capture d'un lead public (POST /api/public/lead, A4.3)
// ainsi que le parcours de rattrapage legacy (POST /:id/ensure-key) sur une
// campagne insérée directement en base, hors API.
// Même convention que test/campaigns-integration.test.js et
// test/public-lead-attribution.test.js : VRAIE application server/app.js,
// base de test isolée (CRM_DATA_DIR).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-campaign-key-integration-'));
process.env.NODE_ENV = 'test';
process.env.SITE_ORIGINS = 'https://site-de-test.ch';
process.env.PUBLIC_RATE_LIMIT = '1000';

const { default: app } = await import('../server/app.js');
const { default: db } = await import('../server/db.js');
const { resolveLeadAttribution } = await import('../server/acquisition-attribution.js');

const SITE = 'https://site-de-test.ch';
const PASSWORD = 'MotDePasseDeTest!42';
let cookie = '';

before(async () => {
  const res = await request(app)
    .post('/api/auth/setup')
    .send({ email: 'test-campaign-key@exemple.ch', name: 'Testeur', password: PASSWORD });
  assert.equal(res.status, 200);
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
});

let seq = 0;
function uniqueEmail(prefix) {
  seq += 1;
  return `${prefix}-${seq}@example.test`;
}

function clientByEmail(email) {
  return db.prepare('SELECT * FROM clients WHERE email = ?').get(email);
}
function leadDetailsOf(clientId) {
  return db.prepare('SELECT * FROM lead_details WHERE client_id = ?').get(clientId);
}
function attributionOf(clientId) {
  return db.prepare('SELECT * FROM lead_attribution WHERE client_id = ?').get(clientId);
}

// §19 — API Campaigns -> key -> resolver (server/acquisition-attribution.js, non modifié)
test('19. une campagne créée via POST /api/campaigns est résolue correctement par resolveLeadAttribution', async () => {
  const channel = db.prepare('SELECT id FROM channels ORDER BY id LIMIT 1').get();
  assert.ok(channel, 'Le seed de channels doit fournir au moins un canal pour ce test.');

  const created = await request(app)
    .post('/api/campaigns')
    .set('Cookie', cookie)
    .send({ name: 'Campagne Resolver Cross-Feature', channel_id: channel.id });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.ok(typeof created.body.key === 'string' && created.body.key.length > 0);

  const attribution = resolveLeadAttribution(db, { campaignKey: created.body.key });
  assert.equal(attribution.campaignId, created.body.id);
  assert.equal(attribution.channelId, channel.id);
  assert.equal(attribution.campaignMatched, true);
  assert.equal(attribution.resolution, 'campaign');
});

test('19b. une campagne créée sans canal propre résout un campaignId mais pas de channelId dérivé', async () => {
  const created = await request(app)
    .post('/api/campaigns')
    .set('Cookie', cookie)
    .send({ name: 'Campagne Resolver Sans Canal' });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const attribution = resolveLeadAttribution(db, { campaignKey: created.body.key });
  assert.equal(attribution.campaignId, created.body.id);
  assert.equal(attribution.channelId, null);
  assert.equal(attribution.campaignMatched, true);
});

// §20 — API Campaigns -> key -> POST /api/public/lead (non modifié)
test('20. une campagne créée via POST /api/campaigns est acceptée comme campaign_key par POST /api/public/lead', async () => {
  const channel = db.prepare('SELECT id FROM channels ORDER BY id LIMIT 1').get();
  const created = await request(app)
    .post('/api/campaigns')
    .set('Cookie', cookie)
    .send({ name: 'Campagne Public Lead Cross-Feature', channel_id: channel.id });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const email = uniqueEmail('campaign-key-public-lead');
  const lead = await request(app)
    .post('/api/public/lead')
    .set('Origin', SITE)
    .send({
      first_name: 'Camille',
      last_name: 'CrossFeature',
      email,
      consent: 1,
      campaign_key: created.body.key,
    });
  assert.equal(lead.status, 201, JSON.stringify(lead.body));

  const client = clientByEmail(email);
  assert.ok(client, 'le lead doit avoir créé un client');

  const details = leadDetailsOf(client.id);
  assert.equal(details.campaign_id, created.body.id);
  assert.equal(details.channel_id, channel.id);

  const attribution = attributionOf(client.id);
  assert.equal(attribution.campaign_id, created.body.id);
  assert.equal(attribution.channel_id, channel.id);
  assert.equal(attribution.raw_campaign_key, created.body.key);
});

// §21 — campagne legacy insérée hors API (key = NULL) -> ensure-key
test('21. ensure-key sur une campagne insérée directement en base (hors API) génère une clé sans toucher aux autres colonnes ni aux autres campagnes', async () => {
  const channel = db.prepare('SELECT id FROM channels ORDER BY id LIMIT 1').get();

  // Témoin : une autre campagne, avec sa propre clé déjà générée, ne doit
  // jamais être affectée par l'appel ensure-key ciblé sur la campagne legacy.
  const witness = await request(app)
    .post('/api/campaigns')
    .set('Cookie', cookie)
    .send({ name: 'Campagne Témoin Non Affectée' });
  assert.equal(witness.status, 201);
  const witnessBefore = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(witness.body.id);

  const legacyId = db
    .prepare("INSERT INTO campaigns (name, channel_id, status, key) VALUES (?, ?, 'active', NULL)")
    .run('Campagne Legacy Directe DB', channel.id).lastInsertRowid;
  const legacyBefore = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(legacyId);
  assert.equal(legacyBefore.key, null);

  const res = await request(app)
    .post(`/api/campaigns/${legacyId}/ensure-key`)
    .set('Cookie', cookie);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.id, legacyId);
  assert.ok(typeof res.body.key === 'string' && res.body.key.length > 0);

  const legacyAfter = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(legacyId);
  assert.equal(legacyAfter.key, res.body.key);
  assert.equal(legacyAfter.name, legacyBefore.name);
  assert.equal(legacyAfter.channel_id, legacyBefore.channel_id);
  assert.equal(legacyAfter.status, legacyBefore.status);
  assert.equal(legacyAfter.created_at, legacyBefore.created_at);

  const witnessAfter = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(witness.body.id);
  assert.deepEqual(witnessAfter, witnessBefore, 'ensure-key sur une autre campagne ne doit jamais modifier la campagne témoin');

  // La clé générée pour la campagne legacy est elle-même exploitable par le
  // resolver, exactement comme une clé générée à la création.
  const attribution = resolveLeadAttribution(db, { campaignKey: res.body.key });
  assert.equal(attribution.campaignId, legacyId);
});
