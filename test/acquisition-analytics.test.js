// Tests d'intégration de l'attribution de revenu (node:test + supertest).
// Lot A6a — API isolée, LECTURE SEULE, NON montée dans server/app.js.
//
// Harnais Express isolé (même convention que test/campaigns.test.js, lot
// A1a) : le routeur est monté directement, sans importer ni modifier
// server/app.js. Base de test isolée (CRM_DATA_DIR temporaire).
//
// Les fixtures sont insérées directement en base (accès direct à db, pas
// via une API d'écriture — ce routeur n'en a pas et ce n'est pas son rôle
// d'être testé ici) pour construire un scénario connu et vérifier que les
// agrégats ne se dupliquent jamais à cause des jointures 1:N (un client
// peut avoir plusieurs contrats, un contrat plusieurs commissions).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import session from 'express-session';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-acq-analytics-'));
process.env.NODE_ENV = 'test';

const { default: db } = await import('../server/db.js');
const { acquisitionAnalyticsRouter } = await import('../server/routes/acquisition-analytics.js');
const { requireAuth } = await import('../server/auth.js');

function buildUnauthApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true }));
  app.use('/api/acquisition-analytics', requireAuth, acquisitionAnalyticsRouter);
  return app;
}

function buildAuthedApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true }));
  app.use((req, res, next) => {
    req.session.userId = 1;
    next();
  });
  app.use('/api/acquisition-analytics', acquisitionAnalyticsRouter);
  return app;
}

const app = buildAuthedApp();
const unauthApp = buildUnauthApp();

let emptySummary, emptyCampaigns, emptyChannels;
let channelA, channelB, campaignXId, campaignYId;
let c1, c2, c3, c4, ct2a, ct2b, ct3, ct4;

before(async () => {
  // --- 1. Scénario 8 : capturer l'état "aucune donnée" AVANT toute fixture.
  // À ce stade, seuls les 14 canaux seedés existent (aucune campagne, aucun
  // client, aucun contrat, aucune commission, aucun coût).
  emptySummary = (await request(app).get('/api/acquisition-analytics/summary')).body;
  emptyCampaigns = (await request(app).get('/api/acquisition-analytics/campaigns')).body;
  emptyChannels = (await request(app).get('/api/acquisition-analytics/channels')).body;

  // --- 2. Fixtures.
  const channels = db.prepare('SELECT id FROM channels ORDER BY id LIMIT 2').all();
  assert.equal(channels.length, 2, 'le seed doit fournir au moins 2 canaux pour ce test');
  channelA = channels[0].id;
  channelB = channels[1].id;

  campaignXId = db
    .prepare('INSERT INTO campaigns (name, channel_id) VALUES (?, ?)')
    .run('Campagne X — leads sans contrat', channelA).lastInsertRowid;
  campaignYId = db
    .prepare('INSERT INTO campaigns (name, channel_id) VALUES (?, ?)')
    .run('Campagne Y — leads convertis', channelA).lastInsertRowid;

  const companyId = db
    .prepare('INSERT INTO companies (name, default_acq_rate, default_rec_rate) VALUES (?, ?, ?)')
    .run('Compagnie Test', 5, 2).lastInsertRowid;

  // Client 1 : lead attribué à une campagne (X), SANS contrat. [scénario 1]
  c1 = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Lead', 'SansContrat', 'prospect')")
    .run().lastInsertRowid;
  db.prepare('INSERT INTO lead_details (client_id, channel_id, campaign_id) VALUES (?, ?, ?)').run(c1, channelA, campaignXId);

  // Client 2 : lead attribué (campagne Y) -> client -> 2 CONTRATS, dont un
  // avec 2 commissions. [scénarios 2, 3, 9, 10]
  c2 = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Lead', 'Converti', 'client')")
    .run().lastInsertRowid;
  db.prepare('INSERT INTO lead_details (client_id, channel_id, campaign_id) VALUES (?, ?, ?)').run(c2, channelA, campaignYId);
  ct2a = db
    .prepare("INSERT INTO contracts (client_id, company_id, branch, annual_premium, status) VALUES (?, ?, 'lamal', 1200, 'actif')")
    .run(c2, companyId).lastInsertRowid;
  db.prepare("INSERT INTO commissions (contract_id, type, amount, status) VALUES (?, 'acquisition', 100, 'payee')").run(ct2a);
  db.prepare("INSERT INTO commissions (contract_id, type, amount, status) VALUES (?, 'recurrente', 50, 'attendue')").run(ct2a);
  ct2b = db
    .prepare("INSERT INTO contracts (client_id, company_id, branch, annual_premium, status) VALUES (?, ?, 'lca', 800, 'actif')")
    .run(c2, companyId).lastInsertRowid;
  db.prepare("INSERT INTO commissions (contract_id, type, amount, status) VALUES (?, 'acquisition', 200, 'payee')").run(ct2b);

  // Client 3 : lead attribué à un CANAL mais SANS campagne (campaign_id
  // NULL) -> client -> 1 contrat. [scénarios 5, 6]
  c3 = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Lead', 'SansCampagne', 'client')")
    .run().lastInsertRowid;
  db.prepare('INSERT INTO lead_details (client_id, channel_id, campaign_id) VALUES (?, ?, NULL)').run(c3, channelB);
  ct3 = db
    .prepare("INSERT INTO contracts (client_id, company_id, branch, annual_premium, status) VALUES (?, ?, 'vie_3a', 3000, 'actif')")
    .run(c3, companyId).lastInsertRowid;
  db.prepare("INSERT INTO commissions (contract_id, type, amount, status) VALUES (?, 'acquisition', 400, 'payee')").run(ct3);

  // Client 4 : client -> 1 contrat, mais AUCUNE ligne lead_details du tout
  // (jamais passé par un canal identifié). [scénario 7]
  c4 = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Client', 'SansLead', 'client')")
    .run().lastInsertRowid;
  ct4 = db
    .prepare("INSERT INTO contracts (client_id, company_id, branch, annual_premium, status) VALUES (?, ?, 'autre', 500, 'actif')")
    .run(c4, companyId).lastInsertRowid;
  db.prepare("INSERT INTO commissions (contract_id, type, amount, status) VALUES (?, 'acquisition', 90, 'attendue')").run(ct4);

  // Coûts d'acquisition sur le canal A uniquement (jamais sur un canal ni
  // une campagne inutilisés) — utilisé pour vérifier que costs_total est
  // exposé brut, sans ratio CAC calculé.
  db.prepare("INSERT INTO channel_costs (channel_id, month, amount) VALUES (?, '2026-01', 500)").run(channelA);
});

test('accès sans session refusé (401)', async () => {
  const res = await request(unauthApp).get('/api/acquisition-analytics/summary');
  assert.equal(res.status, 401);
});

test('scénario 8 — aucune donnée : agrégats à zéro, pas d’erreur', () => {
  assert.equal(emptySummary.leads.total, 0);
  assert.equal(emptySummary.clients.total_converted, 0);
  assert.equal(emptySummary.contracts.total, 0);
  assert.equal(emptySummary.commissions.total_amount, 0);
  assert.equal(emptySummary.channel_costs.total_amount, 0);
  assert.equal(emptySummary.campaigns.total, 0);
  assert.deepEqual(emptyCampaigns.campaigns, []);
  assert.equal(emptyCampaigns.unattributed.clients_total, 0);
  assert.ok(Array.isArray(emptyChannels.channels));
  assert.ok(emptyChannels.channels.length >= 2, 'les canaux seedés doivent apparaître même sans aucune activité');
  assert.ok(emptyChannels.channels.every((c) => c.leads === 0 && c.contracts === 0 && c.costs_total === 0));
});

test('GET /summary reflète l’ensemble des fixtures, y compris le non attribué', async () => {
  const res = await request(app).get('/api/acquisition-analytics/summary');
  assert.equal(res.status, 200);
  const s = res.body;

  assert.equal(s.leads.total, 3, 'c1, c2, c3 ont une ligne lead_details ; c4 non');
  assert.equal(s.clients.total_converted, 3, 'c2, c3, c4 sont status=client');
  assert.equal(s.clients.attributed, 2, 'c2 (campagne) et c3 (canal seul) sont attribués');
  assert.equal(s.clients.unattributed, 1, 'c4 seul, sans lead_details');

  assert.equal(s.contracts.total, 4, 'ct2a, ct2b, ct3, ct4');
  assert.equal(s.contracts.attributed, 3, 'ct2a, ct2b (client c2), ct3 (client c3)');
  assert.equal(s.contracts.unattributed, 1, 'ct4 (client c4, sans lead_details)');

  assert.equal(s.commissions.total_amount, 840, '100+50+200+400+90');
  assert.equal(s.commissions.by_status.payee, 700, '100+200+400');
  assert.equal(s.commissions.by_status.attendue, 140, '50+90');

  assert.equal(s.channel_costs.total_amount, 500);

  assert.equal(s.campaigns.total, 2);
  assert.equal(s.campaigns.with_leads, 2, 'campagnes X et Y ont chacune au moins un lead');
  assert.equal(s.campaigns.with_contracts, 1, 'seule la campagne Y (via c2) a des contrats');
  assert.equal(s.campaigns.with_commissions, 1, 'seule la campagne Y a des commissions');

  assert.ok(Array.isArray(s.caveats) && s.caveats.length > 0, 'les limites (CAC/ROAS non calculés) doivent être explicites');
});

test('scénario 1 — lead attribué à une campagne (X) sans contrat', async () => {
  const res = await request(app).get('/api/acquisition-analytics/campaigns');
  const x = res.body.campaigns.find((c) => c.campaign_id === campaignXId);
  assert.ok(x, 'la campagne X doit apparaître');
  assert.equal(x.leads, 1);
  assert.equal(x.clients_converted, 0, 'c1 est encore prospect');
  assert.equal(x.contracts, 0);
  assert.equal(x.commissions_amount, 0);
});

test('scénarios 2, 3, 9, 10 — campagne Y : 1 lead, 2 contrats, commissions correctement additionnées, aucun doublon', async () => {
  const res = await request(app).get('/api/acquisition-analytics/campaigns');
  const y = res.body.campaigns.find((c) => c.campaign_id === campaignYId);
  assert.ok(y, 'la campagne Y doit apparaître');

  // Anti-double-comptage : la campagne Y n'a qu'UN client (c2), qui a
  // pourtant 2 contrats et 3 lignes de commission au total. Une jointure
  // naïve client -> contracts -> commissions produirait 3 lignes pour ce
  // client et gonflerait "leads" à 3 ; ici il doit rester à 1.
  assert.equal(y.leads, 1, 'un seul client (c2) malgré 2 contrats et 3 commissions — pas de multiplication par jointure');
  assert.equal(y.clients_converted, 1);
  assert.equal(y.contracts, 2, 'ct2a et ct2b, tous deux comptés');
  assert.equal(y.commissions_amount, 350, '100 + 50 + 200, correctement additionnées malgré 2 contrats');
});

test('scénario 4 — plusieurs campagnes restent indépendantes l’une de l’autre', async () => {
  const res = await request(app).get('/api/acquisition-analytics/campaigns');
  assert.equal(res.body.campaigns.length, 2);
  const ids = res.body.campaigns.map((c) => c.campaign_id).sort();
  assert.deepEqual(ids, [campaignXId, campaignYId].sort());
});

test('scénario 5 — agrégation par canal : A et B distincts, canaux inutilisés à zéro', async () => {
  const res = await request(app).get('/api/acquisition-analytics/channels');
  const rows = res.body.channels;

  const a = rows.find((c) => c.channel_id === channelA);
  assert.equal(a.leads, 2, 'c1 et c2 sont sur le canal A');
  assert.equal(a.clients_converted, 1, 'seul c2 est converti');
  assert.equal(a.contracts, 2, 'ct2a et ct2b, via c2');
  assert.equal(a.commissions_amount, 350);
  assert.equal(a.costs_total, 500);

  const b = rows.find((c) => c.channel_id === channelB);
  assert.equal(b.leads, 1, 'c3 seul sur le canal B');
  assert.equal(b.contracts, 1);
  assert.equal(b.commissions_amount, 400);
  assert.equal(b.costs_total, 0, 'aucun coût saisi sur le canal B');

  const untouched = rows.find((c) => c.channel_id !== channelA && c.channel_id !== channelB);
  assert.ok(untouched, 'au moins un canal seedé ne doit avoir reçu aucune fixture');
  assert.equal(untouched.leads, 0);
  assert.equal(untouched.contracts, 0);
  assert.equal(untouched.commissions_amount, 0);
  assert.equal(untouched.costs_total, 0);
});

test('scénario 6 — client/contrat avec canal mais SANS campagne : absent de /campaigns, présent en non-attribué campagne', async () => {
  const campaigns = (await request(app).get('/api/acquisition-analytics/campaigns')).body;
  assert.ok(
    !campaigns.campaigns.some((c) => c.campaign_id === null),
    'c3 ne doit créer aucune fausse ligne de campagne'
  );
  // c3 (avec ct3, commission 400) et c4 (avec ct4, commission 90) sont tous
  // deux sans campaign_id -> comptés dans le bloc "unattributed" de /campaigns.
  assert.equal(campaigns.unattributed.clients_total, 2, 'c3 et c4 : ni l’un ni l’autre n’a de campaign_id');
  assert.equal(campaigns.unattributed.contracts, 2, 'ct3 et ct4');
  assert.equal(campaigns.unattributed.commissions_amount, 490, '400 + 90');

  const channels = (await request(app).get('/api/acquisition-analytics/channels')).body;
  const b = channels.channels.find((c) => c.channel_id === channelB);
  assert.equal(b.leads, 1, 'c3 reste bien rattaché au canal B malgré l’absence de campagne');
});

test('scénario 7 — client/contrat entièrement SANS lead_details : jamais perdu des totaux globaux', async () => {
  const summary = (await request(app).get('/api/acquisition-analytics/summary')).body;
  // c4/ct4 n'ont pas de lead_details du tout : ils doivent néanmoins être
  // comptés dans les totaux globaux (contracts.total, commissions.total_amount)
  // et apparaître explicitement dans unattributed, jamais disparaître.
  assert.ok(summary.contracts.total >= 4, 'ct4 doit être compté dans le total global des contrats');
  assert.equal(summary.contracts.unattributed, 1, 'ct4 uniquement — ct2a/ct2b/ct3 sont attribués');

  const channels = (await request(app).get('/api/acquisition-analytics/channels')).body;
  assert.equal(channels.unattributed.clients_total, 1, 'c4 seul, sans aucune ligne lead_details');
  assert.equal(channels.unattributed.contracts, 1, 'ct4');
  assert.equal(channels.unattributed.commissions_amount, 90);

  const campaigns = (await request(app).get('/api/acquisition-analytics/campaigns')).body;
  // c4 doit aussi apparaître dans le non-attribué "campagne" (en plus de c3).
  assert.ok(campaigns.unattributed.clients_total >= 1);
});
