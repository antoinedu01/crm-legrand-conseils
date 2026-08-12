// Tests d'intégration de l'attribution de revenu (node:test + supertest).
// Backend Analytics V2 — API isolée, LECTURE SEULE, NON montée dans
// server/app.js à ce stade (lot M0c10).
//
// Porté depuis feature/acquisition-os (lot A6a, test/acquisition-analytics.test.js)
// vers cette base d'intégration — PAR PORTAGE MANUEL, pas cherry-pick :
// les fixtures historiques utilisaient `commissions.amount` et les statuts
// français (attendue/payee/annulee), remplacés ici par
// `expected_amount_chf`/`received_amount_chf` et les 6 statuts anglais du
// modèle v15 (voir M0c9/M0c10). Toutes les assertions encore valides
// (leads, clients, contrats, attribution campagne/canal, non-attribué,
// coûts, caveats, anti-doublon) sont conservées ; les scénarios expected/
// received/disputed/cancelled/reversed sont nouveaux (V2).
//
// Harnais Express isolé (même convention que test/campaigns.test.js) : le
// routeur est monté directement, sans importer ni modifier server/app.js.
// Monté ici sur /api/acquisition/analytics (et non /api/acquisition-analytics
// comme le harnais historique) pour préfigurer sans ambiguïté le chemin de
// montage réel choisi en A2c/M0c5 (/api/acquisition/analytics) — choix de
// scaffolding de test uniquement, aucune conséquence fonctionnelle tant que
// le routeur n'est pas monté dans server/app.js (M0c11).
//
// Les fixtures sont insérées directement en base (accès direct à db, pas
// via une API d'écriture — ce routeur n'en a pas) pour construire des
// scénarios connus et vérifier que les agrégats ne se dupliquent jamais à
// cause des jointures 1:N (un client peut avoir plusieurs contrats, un
// contrat plusieurs commissions).
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
  app.use('/api/acquisition/analytics', requireAuth, acquisitionAnalyticsRouter);
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
  app.use('/api/acquisition/analytics', acquisitionAnalyticsRouter);
  return app;
}

const app = buildAuthedApp();
const unauthApp = buildUnauthApp();

async function getSummary() {
  return (await request(app).get('/api/acquisition/analytics/summary')).body;
}
async function getCampaigns() {
  return (await request(app).get('/api/acquisition/analytics/campaigns')).body;
}
async function getChannels() {
  return (await request(app).get('/api/acquisition/analytics/channels')).body;
}

let companyId;
function makeCompanyOnce() {
  if (companyId) return companyId;
  companyId = db
    .prepare('INSERT INTO companies (name, default_acq_rate, default_rec_rate) VALUES (?, ?, ?)')
    .run('Compagnie Test V2', 5, 2).lastInsertRowid;
  return companyId;
}

function makeClient(status = 'prospect', label = 'Fixture') {
  return db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Test', ?, ?)")
    .run(label, status).lastInsertRowid;
}

// Client + contrat minimal, sans lead_details (commission non attribuée par
// défaut) — utilisé par les scénarios expected/partial/disputed/cancelled
// qui ne portent que sur les totaux GLOBAUX de /summary.
function makeContract(label) {
  const clientId = makeClient('client', label);
  const contractId = db
    .prepare("INSERT INTO contracts (client_id, company_id, branch, annual_premium, status) VALUES (?, ?, 'lamal', 1000, 'actif')")
    .run(clientId, makeCompanyOnce()).lastInsertRowid;
  return { clientId, contractId };
}

// Client + contrat attribué à une campagne/canal donnés — utilisé par les
// scénarios reversal et with_commissions, qui portent sur les agrégats PAR
// CAMPAGNE/CANAL.
function makeAttributedContract(label, channelId, campaignId) {
  const clientId = makeClient('client', label);
  db.prepare('INSERT INTO lead_details (client_id, channel_id, campaign_id) VALUES (?, ?, ?)').run(clientId, channelId, campaignId);
  const contractId = db
    .prepare("INSERT INTO contracts (client_id, company_id, branch, annual_premium, status) VALUES (?, ?, 'lamal', 1000, 'actif')")
    .run(clientId, makeCompanyOnce()).lastInsertRowid;
  return { clientId, contractId };
}

function insertCommission(contractId, { type = 'ajustement', expected, received = 0, status, reversalOf = null, reversalAmount = null }) {
  return db
    .prepare(
      `INSERT INTO commissions (
        contract_id, type, expected_amount_chf, received_amount_chf, status,
        commission_mode, reversal_of_commission_id, reversal_amount_chf
      ) VALUES (?, ?, ?, ?, ?, 'manual_adjustment', ?, ?)`
    )
    .run(contractId, type, expected, received, status, reversalOf, reversalAmount).lastInsertRowid;
}

let emptySummary, emptyCampaigns, emptyChannels;
let channelA, channelB, campaignXId, campaignYId;
let c1, c2, c3, c4, ct2a, ct2b, ct3, ct4;

before(async () => {
  // --- 1. Scénario 8 : capturer l'état "aucune donnée" AVANT toute fixture.
  emptySummary = await getSummary();
  emptyCampaigns = await getCampaigns();
  emptyChannels = await getChannels();

  // --- 2. Fixtures (ported baseline, adaptées au modèle v15).
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

  makeCompanyOnce();

  // Client 1 : lead attribué à une campagne (X), SANS contrat. [scénario 1]
  c1 = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Lead', 'SansContrat', 'prospect')")
    .run().lastInsertRowid;
  db.prepare('INSERT INTO lead_details (client_id, channel_id, campaign_id) VALUES (?, ?, ?)').run(c1, channelA, campaignXId);

  // Client 2 : lead attribué (campagne Y) -> client -> 2 CONTRATS, dont un
  // avec 2 commissions. [scénarios 2, 3, 9, 10 — anti-doublon]
  c2 = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Lead', 'Converti', 'client')")
    .run().lastInsertRowid;
  db.prepare('INSERT INTO lead_details (client_id, channel_id, campaign_id) VALUES (?, ?, ?)').run(c2, channelA, campaignYId);
  ct2a = db
    .prepare("INSERT INTO contracts (client_id, company_id, branch, annual_premium, status) VALUES (?, ?, 'lamal', 1200, 'actif')")
    .run(c2, companyId).lastInsertRowid;
  insertCommission(ct2a, { type: 'acquisition', expected: 100, received: 100, status: 'received' });
  insertCommission(ct2a, { type: 'recurrente', expected: 50, received: 0, status: 'expected' });
  ct2b = db
    .prepare("INSERT INTO contracts (client_id, company_id, branch, annual_premium, status) VALUES (?, ?, 'lca', 800, 'actif')")
    .run(c2, companyId).lastInsertRowid;
  insertCommission(ct2b, { type: 'acquisition', expected: 200, received: 200, status: 'received' });

  // Client 3 : lead attribué à un CANAL mais SANS campagne (campaign_id
  // NULL) -> client -> 1 contrat. [scénarios 5, 6]
  c3 = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Lead', 'SansCampagne', 'client')")
    .run().lastInsertRowid;
  db.prepare('INSERT INTO lead_details (client_id, channel_id, campaign_id) VALUES (?, ?, NULL)').run(c3, channelB);
  ct3 = db
    .prepare("INSERT INTO contracts (client_id, company_id, branch, annual_premium, status) VALUES (?, ?, 'vie_3a', 3000, 'actif')")
    .run(c3, companyId).lastInsertRowid;
  insertCommission(ct3, { type: 'acquisition', expected: 400, received: 400, status: 'received' });

  // Client 4 : client -> 1 contrat, mais AUCUNE ligne lead_details du tout
  // (jamais passé par un canal identifié). [scénario 7]
  c4 = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Client', 'SansLead', 'client')")
    .run().lastInsertRowid;
  ct4 = db
    .prepare("INSERT INTO contracts (client_id, company_id, branch, annual_premium, status) VALUES (?, ?, 'autre', 500, 'actif')")
    .run(c4, companyId).lastInsertRowid;
  insertCommission(ct4, { type: 'acquisition', expected: 90, received: 0, status: 'expected' });

  // Coûts d'acquisition sur le canal A uniquement.
  db.prepare("INSERT INTO channel_costs (channel_id, month, amount) VALUES (?, '2026-01', 500)").run(channelA);
});

test('accès sans session refusé (401)', async () => {
  const res = await request(unauthApp).get('/api/acquisition/analytics/summary');
  assert.equal(res.status, 401);
});

test('scénario 8 — aucune donnée : agrégats à zéro, pas d’erreur', () => {
  assert.equal(emptySummary.leads.total, 0);
  assert.equal(emptySummary.clients.total_converted, 0);
  assert.equal(emptySummary.contracts.total, 0);
  assert.equal(emptySummary.commissions.expected_amount, 0);
  assert.equal(emptySummary.commissions.received_amount, 0);
  assert.deepEqual(emptySummary.commissions.by_status, {}, 'aucune commission -> by_status vide, aucune clé fabriquée à zéro');
  assert.equal(emptySummary.channel_costs.total_amount, 0);
  assert.equal(emptySummary.campaigns.total, 0);
  assert.deepEqual(emptyCampaigns.campaigns, []);
  assert.equal(emptyCampaigns.unattributed.clients_total, 0);
  assert.equal(emptyCampaigns.unattributed.expected_commissions_amount, 0);
  assert.equal(emptyCampaigns.unattributed.received_commissions_amount, 0);
  assert.ok(Array.isArray(emptyChannels.channels));
  assert.ok(emptyChannels.channels.length >= 2, 'les canaux seedés doivent apparaître même sans aucune activité');
  assert.ok(emptyChannels.channels.every((c) => c.leads === 0 && c.contracts === 0 && c.costs_total === 0));
});

test('GET /summary reflète l’ensemble des fixtures, y compris le non attribué', async () => {
  const s = await getSummary();

  assert.equal(s.leads.total, 3, 'c1, c2, c3 ont une ligne lead_details ; c4 non');
  assert.equal(s.clients.total_converted, 3, 'c2, c3, c4 sont status=client');
  assert.equal(s.clients.attributed, 2, 'c2 (campagne) et c3 (canal seul) sont attribués');
  assert.equal(s.clients.unattributed, 1, 'c4 seul, sans lead_details');

  assert.equal(s.contracts.total, 4, 'ct2a, ct2b, ct3, ct4');
  assert.equal(s.contracts.attributed, 3, 'ct2a, ct2b (client c2), ct3 (client c3)');
  assert.equal(s.contracts.unattributed, 1, 'ct4 (client c4, sans lead_details)');

  // V2 : expected et received séparés (aucune ligne cancelled dans ce jeu).
  assert.equal(s.commissions.expected_amount, 840, '100+50+200+400+90');
  assert.equal(s.commissions.received_amount, 700, '100+0+200+400+0');
  assert.equal(s.commissions.by_status.expected.count, 2, 'ct2a (50) et ct4 (90)');
  assert.equal(s.commissions.by_status.expected.expected_amount, 140, '50+90');
  assert.equal(s.commissions.by_status.expected.received_amount, 0);
  assert.equal(s.commissions.by_status.received.count, 3, 'ct2a (100), ct2b (200), ct3 (400)');
  assert.equal(s.commissions.by_status.received.expected_amount, 700);
  assert.equal(s.commissions.by_status.received.received_amount, 700);

  assert.equal(s.channel_costs.total_amount, 500);

  assert.equal(s.campaigns.total, 2);
  assert.equal(s.campaigns.with_leads, 2, 'campagnes X et Y ont chacune au moins un lead');
  assert.equal(s.campaigns.with_contracts, 1, 'seule la campagne Y (via c2) a des contrats');
  assert.equal(s.campaigns.with_commissions, 1, 'seule la campagne Y a des commissions non cancelled');

  assert.ok(Array.isArray(s.caveats) && s.caveats.length > 0, 'les limites (CAC/ROAS non calculés) doivent être explicites');
});

test('scénario 1 — lead attribué à une campagne (X) sans contrat', async () => {
  const res = await getCampaigns();
  const x = res.campaigns.find((c) => c.campaign_id === campaignXId);
  assert.ok(x, 'la campagne X doit apparaître');
  assert.equal(x.leads, 1);
  assert.equal(x.clients_converted, 0, 'c1 est encore prospect');
  assert.equal(x.contracts, 0);
  assert.equal(x.expected_commissions_amount, 0);
  assert.equal(x.received_commissions_amount, 0);
});

test('scénarios 2, 3, 9, 10 — campagne Y : 1 lead, 2 contrats, commissions correctement additionnées (expected + received), aucun doublon', async () => {
  const res = await getCampaigns();
  const y = res.campaigns.find((c) => c.campaign_id === campaignYId);
  assert.ok(y, 'la campagne Y doit apparaître');

  // Anti-double-comptage : la campagne Y n'a qu'UN client (c2), qui a
  // pourtant 2 contrats et 3 lignes de commission au total.
  assert.equal(y.leads, 1, 'un seul client (c2) malgré 2 contrats et 3 commissions — pas de multiplication par jointure');
  assert.equal(y.clients_converted, 1);
  assert.equal(y.contracts, 2, 'ct2a et ct2b, tous deux comptés');
  assert.equal(y.expected_commissions_amount, 350, '100 + 50 + 200, correctement additionnées malgré 2 contrats');
  assert.equal(y.received_commissions_amount, 300, '100 + 0 + 200');
});

test('scénario 4 — plusieurs campagnes restent indépendantes l’une de l’autre', async () => {
  const res = await getCampaigns();
  assert.equal(res.campaigns.length, 2);
  const ids = res.campaigns.map((c) => c.campaign_id).sort();
  assert.deepEqual(ids, [campaignXId, campaignYId].sort());
});

test('scénario 5 — agrégation par canal : A et B distincts, canaux inutilisés à zéro', async () => {
  const res = await getChannels();
  const rows = res.channels;

  const a = rows.find((c) => c.channel_id === channelA);
  assert.equal(a.leads, 2, 'c1 et c2 sont sur le canal A');
  assert.equal(a.clients_converted, 1, 'seul c2 est converti');
  assert.equal(a.contracts, 2, 'ct2a et ct2b, via c2');
  assert.equal(a.expected_commissions_amount, 350);
  assert.equal(a.received_commissions_amount, 300);
  assert.equal(a.costs_total, 500);

  const b = rows.find((c) => c.channel_id === channelB);
  assert.equal(b.leads, 1, 'c3 seul sur le canal B');
  assert.equal(b.contracts, 1);
  assert.equal(b.expected_commissions_amount, 400);
  assert.equal(b.received_commissions_amount, 400);
  assert.equal(b.costs_total, 0, 'aucun coût saisi sur le canal B');

  const untouched = rows.find((c) => c.channel_id !== channelA && c.channel_id !== channelB);
  assert.ok(untouched, 'au moins un canal seedé ne doit avoir reçu aucune fixture');
  assert.equal(untouched.leads, 0);
  assert.equal(untouched.contracts, 0);
  assert.equal(untouched.expected_commissions_amount, 0);
  assert.equal(untouched.received_commissions_amount, 0);
  assert.equal(untouched.costs_total, 0);
});

test('scénario 6 — client/contrat avec canal mais SANS campagne : absent de /campaigns, présent en non-attribué campagne', async () => {
  const campaigns = await getCampaigns();
  assert.ok(
    !campaigns.campaigns.some((c) => c.campaign_id === null),
    'c3 ne doit créer aucune fausse ligne de campagne'
  );
  // c3 (ct3, 400) et c4 (ct4, 90) sont tous deux sans campaign_id.
  assert.equal(campaigns.unattributed.clients_total, 2, 'c3 et c4 : ni l’un ni l’autre n’a de campaign_id');
  assert.equal(campaigns.unattributed.contracts, 2, 'ct3 et ct4');
  assert.equal(campaigns.unattributed.expected_commissions_amount, 490, '400 + 90');
  assert.equal(campaigns.unattributed.received_commissions_amount, 400, '400 (ct3, received) + 0 (ct4, expected)');

  const channels = await getChannels();
  const b = channels.channels.find((c) => c.channel_id === channelB);
  assert.equal(b.leads, 1, 'c3 reste bien rattaché au canal B malgré l’absence de campagne');
});

test('scénario 7 — client/contrat entièrement SANS lead_details : jamais perdu des totaux globaux', async () => {
  const summary = await getSummary();
  assert.ok(summary.contracts.total >= 4, 'ct4 doit être compté dans le total global des contrats');
  assert.equal(summary.contracts.unattributed, 1, 'ct4 uniquement — ct2a/ct2b/ct3 sont attribués');

  const channels = await getChannels();
  assert.equal(channels.unattributed.clients_total, 1, 'c4 seul, sans aucune ligne lead_details');
  assert.equal(channels.unattributed.contracts, 1, 'ct4');
  assert.equal(channels.unattributed.expected_commissions_amount, 90);
  assert.equal(channels.unattributed.received_commissions_amount, 0, 'ct4 est encore au statut expected');

  const campaigns = await getCampaigns();
  assert.ok(campaigns.unattributed.clients_total >= 1);
});

// ============================================================================
// V2 — sémantique statuts (décision métier M0c9/M0c10)
// ============================================================================

test('disputed est inclus dans expected_amount (production toujours réclamée) et visible distinctement dans by_status', async () => {
  const before2 = await getSummary();
  const { contractId } = makeContract('Disputed');
  insertCommission(contractId, { expected: 100, received: 0, status: 'disputed' });
  const after = await getSummary();

  assert.equal(after.commissions.expected_amount - before2.commissions.expected_amount, 100, 'disputed doit augmenter expected_amount');
  assert.equal(after.commissions.received_amount - before2.commissions.received_amount, 0);

  const disputedBefore = before2.commissions.by_status.disputed || { count: 0, expected_amount: 0, received_amount: 0 };
  const disputedAfter = after.commissions.by_status.disputed;
  assert.ok(disputedAfter, 'by_status.disputed doit exister dès qu’une commission disputed existe');
  assert.equal(disputedAfter.count - disputedBefore.count, 1);
  assert.equal(disputedAfter.expected_amount - disputedBefore.expected_amount, 100);
  assert.equal(disputedAfter.received_amount - disputedBefore.received_amount, 0);
});

test('cancelled est exclu des totaux économiques mais reste visible avec son montant brut dans by_status', async () => {
  const before2 = await getSummary();
  const { contractId } = makeContract('Cancelled');
  insertCommission(contractId, { expected: 100, received: 0, status: 'cancelled' });
  const after = await getSummary();

  assert.equal(after.commissions.expected_amount - before2.commissions.expected_amount, 0, 'cancelled ne doit jamais augmenter expected_amount');
  assert.equal(after.commissions.received_amount - before2.commissions.received_amount, 0, 'cancelled ne doit jamais augmenter received_amount');

  const cancelledBefore = before2.commissions.by_status.cancelled || { count: 0, expected_amount: 0, received_amount: 0 };
  const cancelledAfter = after.commissions.by_status.cancelled;
  assert.ok(cancelledAfter, 'by_status.cancelled doit rester visible (vue diagnostique brute)');
  assert.equal(cancelledAfter.count - cancelledBefore.count, 1);
  assert.equal(cancelledAfter.expected_amount - cancelledBefore.expected_amount, 100, 'le montant historique brut doit rester visible dans by_status malgré l’exclusion des totaux');
});

test('partially_received : expected reçoit le montant contractuel complet, received le montant réellement encaissé', async () => {
  const before2 = await getSummary();
  const { contractId } = makeContract('PartiallyReceived');
  insertCommission(contractId, { expected: 100, received: 40, status: 'partially_received' });
  const after = await getSummary();

  assert.equal(after.commissions.expected_amount - before2.commissions.expected_amount, 100);
  assert.equal(after.commissions.received_amount - before2.commissions.received_amount, 40);
  const beforeStatus = before2.commissions.by_status.partially_received || { count: 0, expected_amount: 0, received_amount: 0 };
  const afterStatus = after.commissions.by_status.partially_received;
  assert.equal(afterStatus.count - beforeStatus.count, 1);
  assert.equal(afterStatus.expected_amount - beforeStatus.expected_amount, 100);
  assert.equal(afterStatus.received_amount - beforeStatus.received_amount, 40);
});

// ============================================================================
// V2 — reversal (reprise), les deux phases du lifecycle
// ============================================================================

test('reversal — phase A (reprise créée, pas encore remboursée) : expected net = 0, received net = montant historiquement encaissé, campagne ET canal', async () => {
  const channels = db.prepare('SELECT id FROM channels ORDER BY id LIMIT 3').all();
  const channelR = channels[2].id;
  const campaignRId = db
    .prepare('INSERT INTO campaigns (name, channel_id) VALUES (?, ?)')
    .run('Campagne Reversal — phase A', channelR).lastInsertRowid;

  const summaryBefore = await getSummary();
  const { contractId } = makeAttributedContract('ReversalPhaseA', channelR, campaignRId);
  // Ligne d'origine : reçue en totalité, puis reprise — seul son statut a
  // évolué, son montant reste inchangé (server/routes/commissions.js).
  const originalId = insertCommission(contractId, { type: 'acquisition', expected: 100, received: 100, status: 'reversed' });
  // Reprise : montant négatif, PAS ENCORE remboursée (received = 0, status
  // = 'expected' — c'est une créance future, pas un fait encore réalisé).
  insertCommission(contractId, {
    type: 'reprise', expected: -100, received: 0, status: 'expected',
    reversalOf: originalId, reversalAmount: -100,
  });

  const campaigns = await getCampaigns();
  const campaignRow = campaigns.campaigns.find((c) => c.campaign_id === campaignRId);
  assert.ok(campaignRow);
  assert.equal(campaignRow.expected_commissions_amount, 0, '100 (originale) + (-100) (reprise) = 0 : production neutralisée');
  assert.equal(campaignRow.received_commissions_amount, 100, 'le cash a historiquement été reçu et n’a pas encore été remboursé');

  const channelsRes = await getChannels();
  const channelRow = channelsRes.channels.find((c) => c.channel_id === channelR);
  assert.ok(channelRow);
  assert.equal(channelRow.expected_commissions_amount, 0);
  assert.equal(channelRow.received_commissions_amount, 100);

  const summaryAfter = await getSummary();
  assert.equal(
    summaryAfter.campaigns.with_commissions - summaryBefore.campaigns.with_commissions, 1,
    'la campagne a bien généré une activité de commission (2 lignes non cancelled), même si son solde net est 0'
  );
});

test('reversal — phase B (reprise réellement remboursée) : expected net = 0, received net = 0', async () => {
  const channels = db.prepare('SELECT id FROM channels ORDER BY id LIMIT 4').all();
  const channelR2 = channels[3].id;
  const campaignR2Id = db
    .prepare('INSERT INTO campaigns (name, channel_id) VALUES (?, ?)')
    .run('Campagne Reversal — phase B', channelR2).lastInsertRowid;

  const { contractId } = makeAttributedContract('ReversalPhaseB', channelR2, campaignR2Id);
  const originalId = insertCommission(contractId, { type: 'acquisition', expected: 100, received: 100, status: 'reversed' });
  // Cette fois la reprise a été effectivement remboursée : elle passe à
  // 'received' avec un montant reçu négatif (même signe que son expected).
  insertCommission(contractId, {
    type: 'reprise', expected: -100, received: -100, status: 'received',
    reversalOf: originalId, reversalAmount: -100,
  });

  const campaigns = await getCampaigns();
  const campaignRow = campaigns.campaigns.find((c) => c.campaign_id === campaignR2Id);
  assert.ok(campaignRow);
  assert.equal(campaignRow.expected_commissions_amount, 0);
  assert.equal(campaignRow.received_commissions_amount, 0, 'le remboursement effectif ramène le cash net à 0');

  const channelsRes = await getChannels();
  const channelRow = channelsRes.channels.find((c) => c.channel_id === channelR2);
  assert.ok(channelRow);
  assert.equal(channelRow.expected_commissions_amount, 0);
  assert.equal(channelRow.received_commissions_amount, 0);
});

test('with_commissions reste vrai pour une campagne au net zéro après reversal, mais faux pour une campagne uniquement cancelled', async () => {
  const channels = db.prepare('SELECT id FROM channels ORDER BY id LIMIT 5').all();
  const channelOnlyCancelled = channels[4].id;
  const campaignOnlyCancelledId = db
    .prepare('INSERT INTO campaigns (name, channel_id) VALUES (?, ?)')
    .run('Campagne uniquement cancelled', channelOnlyCancelled).lastInsertRowid;

  const summaryBefore = await getSummary();
  const { contractId } = makeAttributedContract('OnlyCancelled', channelOnlyCancelled, campaignOnlyCancelledId);
  insertCommission(contractId, { expected: 100, received: 0, status: 'cancelled' });
  const summaryAfter = await getSummary();

  assert.equal(
    summaryAfter.campaigns.with_commissions - summaryBefore.campaigns.with_commissions, 0,
    'une campagne dont l’unique commission est cancelled ne doit jamais compter comme with_commissions'
  );

  const campaigns = await getCampaigns();
  const row = campaigns.campaigns.find((c) => c.campaign_id === campaignOnlyCancelledId);
  assert.ok(row);
  assert.equal(row.expected_commissions_amount, 0);
  assert.equal(row.received_commissions_amount, 0);
});
