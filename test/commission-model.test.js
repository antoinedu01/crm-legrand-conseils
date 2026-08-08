// Tests du modèle de commission corrigé pour la LAMal et les assurances
// complémentaires LCA (fix/fixed-health-commission-model). Base de test
// isolée (CRM_DATA_DIR), jamais data/**, aucune donnée client réelle.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import request from 'supertest';
import Database from 'better-sqlite3';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-commission-model-'));
process.env.NODE_ENV = 'test';
process.env.SITE_ORIGINS = 'https://site-de-test.ch';
process.env.PUBLIC_RATE_LIMIT = '1000';

const { default: app } = await import('../server/app.js');

const PASSWORD = 'MotDePasseDeTest!42';
let cookie = '';

function auth(req) {
  return req.set('Cookie', cookie);
}

before(async () => {
  const res = await request(app)
    .post('/api/auth/setup')
    .send({ email: 'test-commissions@exemple.ch', name: 'Testeur', password: PASSWORD });
  assert.equal(res.status, 200);
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
});

async function makeClient(lastName) {
  const res = await auth(request(app).post('/api/clients')).send({
    first_name: 'Test', last_name: lastName, status: 'client',
  });
  assert.equal(res.status, 201);
  return res.body.id;
}

async function makeContract({ branch, client_id, annual_premium = 3000, acq_commission_rate = 0 }) {
  const res = await auth(request(app).post('/api/contracts')).send({
    client_id, company_id: 1, branch, annual_premium, status: 'actif', acq_commission_rate,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

// --- 1/2/10 : commission LAMal/LCA fixe, aucun calcul par pourcentage ----

test('commission LAMal fixe : création manuelle en montant fixe, aucun calcul automatique à la création du contrat', async () => {
  const clientId = await makeClient('LamalFixe');
  const contractId = await makeContract({ branch: 'lamal', client_id: clientId, annual_premium: 4620, acq_commission_rate: 3 });

  const autoCheck = await auth(request(app).get('/api/commissions'));
  assert.equal(autoCheck.body.find((c) => c.contract_id === contractId), undefined,
    'aucune commission ne doit être créée automatiquement pour un contrat LAMal');

  const res = await auth(request(app).post('/api/commissions')).send({
    contract_id: contractId, commission_mode: 'fixed_amount', expected_amount_chf: 90,
    expected_payment_date: '2026-09-30', status: 'expected',
  });
  assert.equal(res.status, 201);

  const list = await auth(request(app).get('/api/commissions'));
  const row = list.body.find((c) => c.id === res.body.id);
  assert.equal(row.commission_mode, 'fixed_amount');
  assert.equal(row.expected_amount_chf, 90);
  assert.equal(row.received_amount_chf, 0);
  assert.equal(row.status, 'expected');
});

test('commission complémentaire (LCA) fixe : création manuelle en montant fixe', async () => {
  const clientId = await makeClient('LcaFixe');
  const contractId = await makeContract({ branch: 'lca', client_id: clientId, annual_premium: 1800 });
  const res = await auth(request(app).post('/api/commissions')).send({
    contract_id: contractId, commission_mode: 'fixed_amount', expected_amount_chf: 60, status: 'expected',
  });
  assert.equal(res.status, 201);
  const list = await auth(request(app).get('/api/commissions'));
  assert.equal(list.body.find((c) => c.id === res.body.id).commission_mode, 'fixed_amount');
});

test('absence de calcul par pourcentage en mode fixed_amount : le mode « percentage » est refusé pour LAMal/LCA', async () => {
  const clientId = await makeClient('PourcentageRefuse');
  const lamalId = await makeContract({ branch: 'lamal', client_id: clientId, annual_premium: 3000 });
  const rejectLamal = await auth(request(app).post('/api/commissions')).send({
    contract_id: lamalId, commission_mode: 'percentage', expected_amount_chf: 100, status: 'expected',
  });
  assert.equal(rejectLamal.status, 400);
  assert.match(rejectLamal.body.error, /pourcentage/i);

  const lcaId = await makeContract({ branch: 'lca', client_id: clientId, annual_premium: 1000 });
  const rejectLca = await auth(request(app).post('/api/commissions')).send({
    contract_id: lcaId, commission_mode: 'percentage', expected_amount_chf: 50, status: 'expected',
  });
  assert.equal(rejectLca.status, 400);
});

test('mode par défaut : fixed_amount pour LAMal/LCA quand commission_mode est omis, percentage pour les autres branches', async () => {
  const clientId = await makeClient('ModeParDefaut');
  const lamalId = await makeContract({ branch: 'lamal', client_id: clientId });
  const resLamal = await auth(request(app).post('/api/commissions')).send({
    contract_id: lamalId, expected_amount_chf: 90, status: 'expected',
  });
  assert.equal(resLamal.status, 201);
  const rowLamal = (await auth(request(app).get('/api/commissions'))).body.find((c) => c.id === resLamal.body.id);
  assert.equal(rowLamal.commission_mode, 'fixed_amount');

  const hypId = await makeContract({ branch: 'hypotheque', client_id: clientId, annual_premium: 5000, acq_commission_rate: 4 });
  const resVie = await auth(request(app).post('/api/commissions')).send({
    contract_id: hypId, expected_amount_chf: 200, status: 'expected',
  });
  assert.equal(resVie.status, 201);
  const rowVie = (await auth(request(app).get('/api/commissions'))).body.find((c) => c.id === resVie.body.id);
  assert.equal(rowVie.commission_mode, 'percentage');
});

// --- 3 : plusieurs commissions sur un même dossier ------------------------

test('plusieurs commissions distinctes sur un même contrat (LAMal, Global Smart, Mundo, hospitalisation)', async () => {
  const clientId = await makeClient('MultiLignes');
  const contractId = await makeContract({ branch: 'lca', client_id: clientId, annual_premium: 2000 });

  const lines = ['Global Smart', 'Mundo', 'Hospitalisation'];
  const ids = [];
  for (const product_name of lines) {
    const res = await auth(request(app).post('/api/commissions')).send({
      contract_id: contractId, commission_mode: 'fixed_amount', expected_amount_chf: 50,
      product_name, status: 'expected',
    });
    assert.equal(res.status, 201);
    ids.push(res.body.id);
  }
  const list = (await auth(request(app).get('/api/commissions'))).body.filter((c) => c.contract_id === contractId);
  assert.equal(list.length, 3, 'chaque ligne conserve sa propre existence, aucune fusion');
  const products = list.map((c) => c.product_name).sort();
  assert.deepEqual(products, ['Global Smart', 'Hospitalisation', 'Mundo']);
  // Chaque ligne conserve son propre montant et son propre statut, modifiables indépendamment.
  await auth(request(app).put(`/api/commissions/${ids[0]}`)).send({ status: 'received' });
  const after = (await auth(request(app).get('/api/commissions'))).body.filter((c) => c.contract_id === contractId);
  const changed = after.find((c) => c.id === ids[0]);
  const untouched1 = after.find((c) => c.id === ids[1]);
  const untouched2 = after.find((c) => c.id === ids[2]);
  assert.equal(changed.status, 'received');
  assert.equal(untouched1.status, 'expected');
  assert.equal(untouched2.status, 'expected');
});

// --- 4/5/6 : montant attendu / reçu / paiement partiel --------------------

test('montant attendu et montant reçu sont deux champs distincts', async () => {
  const clientId = await makeClient('AttenduRecu');
  const contractId = await makeContract({ branch: 'lamal', client_id: clientId });
  const res = await auth(request(app).post('/api/commissions')).send({
    contract_id: contractId, commission_mode: 'fixed_amount', expected_amount_chf: 100, status: 'expected',
  });
  const row = (await auth(request(app).get('/api/commissions'))).body.find((c) => c.id === res.body.id);
  assert.equal(row.expected_amount_chf, 100);
  assert.equal(row.received_amount_chf, 0);

  await auth(request(app).put(`/api/commissions/${res.body.id}`)).send({ status: 'received' });
  const updated = (await auth(request(app).get('/api/commissions'))).body.find((c) => c.id === res.body.id);
  assert.equal(updated.expected_amount_chf, 100, 'le montant attendu ne change pas');
  assert.equal(updated.received_amount_chf, 100, 'marquer « reçue » sans montant reprend le montant attendu en totalité');
  assert.ok(updated.received_payment_date);
});

test('paiement partiel : received_amount_chf < expected_amount_chf avec le statut partially_received', async () => {
  const clientId = await makeClient('PaiementPartiel');
  const contractId = await makeContract({ branch: 'lamal', client_id: clientId });
  const res = await auth(request(app).post('/api/commissions')).send({
    contract_id: contractId, commission_mode: 'fixed_amount', expected_amount_chf: 100, status: 'expected',
  });
  const put = await auth(request(app).put(`/api/commissions/${res.body.id}`)).send({
    status: 'partially_received', received_amount_chf: 40,
  });
  assert.equal(put.status, 200);
  const row = (await auth(request(app).get('/api/commissions'))).body.find((c) => c.id === res.body.id);
  assert.equal(row.status, 'partially_received');
  assert.equal(row.received_amount_chf, 40);
  assert.equal(row.expected_amount_chf, 100);
});

test('un montant reçu supérieur au montant attendu est rejeté', async () => {
  const clientId = await makeClient('DepassementRecu');
  const contractId = await makeContract({ branch: 'lamal', client_id: clientId });
  const res = await auth(request(app).post('/api/commissions')).send({
    contract_id: contractId, commission_mode: 'fixed_amount', expected_amount_chf: 50, status: 'expected',
  });
  const put = await auth(request(app).put(`/api/commissions/${res.body.id}`)).send({ received_amount_chf: 999 });
  assert.equal(put.status, 400);
});

// --- 7 : solde -------------------------------------------------------------

test('solde restant = montant attendu − montant reçu, y compris avec des lignes partielles', async () => {
  const clientId = await makeClient('Solde');
  const contractId = await makeContract({ branch: 'lamal', client_id: clientId });
  const a = await auth(request(app).post('/api/commissions')).send({
    contract_id: contractId, commission_mode: 'fixed_amount', expected_amount_chf: 100, status: 'expected',
  });
  const b = await auth(request(app).post('/api/commissions')).send({
    contract_id: contractId, commission_mode: 'fixed_amount', expected_amount_chf: 60, status: 'expected',
  });
  await auth(request(app).put(`/api/commissions/${a.body.id}`)).send({ status: 'partially_received', received_amount_chf: 30 });
  await auth(request(app).put(`/api/commissions/${b.body.id}`)).send({ status: 'received' });

  const rows = (await auth(request(app).get('/api/commissions'))).body.filter((c) => c.contract_id === contractId);
  const totalExpected = rows.reduce((s, c) => s + c.expected_amount_chf, 0);
  const totalReceived = rows.reduce((s, c) => s + c.received_amount_chf, 0);
  assert.equal(totalExpected, 160);
  assert.equal(totalReceived, 90);
  assert.equal(totalExpected - totalReceived, 70, 'solde restant = 160 − 90 = 70');
});

// --- 8/9 : reprise négative + historique ------------------------------------

test('reprise de commission : ligne négative liée, jamais de suppression ni d’altération de l’originale (historique)', async () => {
  const clientId = await makeClient('Reprise');
  const contractId = await makeContract({ branch: 'lamal', client_id: clientId });
  const orig = await auth(request(app).post('/api/commissions')).send({
    contract_id: contractId, commission_mode: 'fixed_amount', expected_amount_chf: 100, status: 'expected',
  });
  await auth(request(app).put(`/api/commissions/${orig.body.id}`)).send({ status: 'received' });
  const origBefore = (await auth(request(app).get('/api/commissions'))).body.find((c) => c.id === orig.body.id);

  const reversal = await auth(request(app).post(`/api/commissions/${orig.body.id}/reverse`)).send({
    reversal_amount_chf: -100, expected_payment_date: '2026-11-01', notes: 'Résiliation rétroactive',
  });
  assert.equal(reversal.status, 201);
  assert.equal(reversal.body.reversed_commission_id, orig.body.id);

  const list = await auth(request(app).get('/api/commissions'));
  const origAfter = list.body.find((c) => c.id === orig.body.id);
  const reversalRow = list.body.find((c) => c.id === reversal.body.id);

  // Historique : la ligne d'origine n'est ni supprimée ni altérée dans son montant.
  assert.equal(origAfter.expected_amount_chf, origBefore.expected_amount_chf, 'montant attendu original inchangé');
  assert.equal(origAfter.received_amount_chf, origBefore.received_amount_chf, 'montant reçu original inchangé');
  assert.equal(origAfter.status, 'reversed', 'seul le statut de la ligne d’origine évolue');

  // Écriture négative liée.
  assert.equal(reversalRow.expected_amount_chf, -100);
  assert.equal(reversalRow.reversal_amount_chf, -100);
  assert.equal(reversalRow.reversal_of_commission_id, orig.body.id);
  assert.equal(reversalRow.type, 'reprise');

  // Net attendu/reçu recalculé correctement par simple somme.
  const rows = list.body.filter((c) => c.contract_id === contractId);
  const netExpected = rows.reduce((s, c) => s + c.expected_amount_chf, 0);
  assert.equal(netExpected, 0, '100 (originale) + (-100) (reprise) = 0');
});

test('une commission déjà reçue ou une reprise ne peuvent jamais être supprimées', async () => {
  const clientId = await makeClient('SuppressionInterdite');
  const contractId = await makeContract({ branch: 'lamal', client_id: clientId });
  const orig = await auth(request(app).post('/api/commissions')).send({
    contract_id: contractId, commission_mode: 'fixed_amount', expected_amount_chf: 80, status: 'received', received_amount_chf: 80,
  });
  const delOrig = await auth(request(app).del(`/api/commissions/${orig.body.id}`));
  assert.equal(delOrig.status, 400);

  const reversal = await auth(request(app).post(`/api/commissions/${orig.body.id}/reverse`)).send({
    reversal_amount_chf: -80,
  });
  const delReversal = await auth(request(app).del(`/api/commissions/${reversal.body.id}`));
  assert.equal(delReversal.status, 400, 'une ligne de reprise ne peut pas non plus être supprimée');
});

test('les champs financiers (montant attendu, mode, type) sont verrouillés après réception ou reprise', async () => {
  const clientId = await makeClient('ChampsVerrouilles');
  const contractId = await makeContract({ branch: 'lamal', client_id: clientId });
  const res = await auth(request(app).post('/api/commissions')).send({
    contract_id: contractId, commission_mode: 'fixed_amount', expected_amount_chf: 100, status: 'received', received_amount_chf: 100,
  });
  const attempt = await auth(request(app).put(`/api/commissions/${res.body.id}`)).send({ expected_amount_chf: 500 });
  assert.equal(attempt.status, 400);
  const row = (await auth(request(app).get('/api/commissions'))).body.find((c) => c.id === res.body.id);
  assert.equal(row.expected_amount_chf, 100, 'le montant attendu reste inchangé après le rejet');
});

// --- 11/14 : maintien du mode percentage, contrats non concernés inchangés -

test('maintien du mode percentage pour la branche vie : la génération automatique à la création reste inchangée', async () => {
  const clientId = await makeClient('ViePourcentage');
  const res = await auth(request(app).post('/api/contracts')).send({
    client_id: clientId, company_id: 1, branch: 'vie_3a', annual_premium: 6000,
    payment_frequency: 'annuelle', acq_commission_rate: 4, status: 'actif',
    life: { component_type: 'mixte', policy_term_years: 10 },
  });
  assert.equal(res.status, 201);
  const commissions = await auth(request(app).get('/api/commissions'));
  const acq = commissions.body.find((c) => c.contract_id === res.body.id && c.type === 'acquisition');
  assert.ok(acq, 'la génération automatique reste inchangée pour la branche vie');
  assert.equal(acq.commission_mode, 'percentage');
  assert.equal(acq.expected_amount_chf, 6000 * 10 * 4 / 100);
});

test('les contrats et commissions non concernés (Incapacité, LPP/IJM) restent inchangés', async () => {
  const clientId = await makeClient('NonConcerne');
  const res = await auth(request(app).post('/api/contracts')).send({
    client_id: clientId, company_id: 1, branch: 'incapacite', annual_premium: 1500,
    acq_commission_rate: 5, status: 'actif', income_protection: { benefit_type: 'rente' },
  });
  assert.equal(res.status, 201);
  const acq = (await auth(request(app).get('/api/commissions'))).body.find((c) => c.contract_id === res.body.id);
  assert.ok(acq, 'la génération automatique reste inchangée pour Incapacité');
  assert.equal(acq.commission_mode, 'percentage');
  assert.equal(acq.expected_amount_chf, 75);
});

test('generate-recurring exclut structurellement les branches LAMal/LCA', async () => {
  const clientId = await makeClient('RecurrenteExclusion');
  const lamalId = await auth(request(app).post('/api/contracts')).send({
    client_id: clientId, company_id: 1, branch: 'lamal', annual_premium: 3000,
    rec_commission_rate: 2, status: 'actif',
  });
  const vieId = await auth(request(app).post('/api/contracts')).send({
    client_id: clientId, company_id: 1, branch: 'vie_3b', annual_premium: 4000,
    rec_commission_rate: 2, status: 'actif',
  });
  const gen = await auth(request(app).post('/api/commissions/generate-recurring')).send({ year: 2031 });
  assert.equal(gen.status, 200);
  const list = await auth(request(app).get('/api/commissions?year=2031'));
  assert.equal(list.body.find((c) => c.contract_id === lamalId.body.id), undefined, 'aucune récurrente générée pour LAMal');
  assert.ok(list.body.find((c) => c.contract_id === vieId.body.id), 'la récurrente vie reste générée automatiquement');
});

// --- 12 : aucun montant codé en dur par assureur ---------------------------

test('aucun montant ou taux de commission n’est codé en dur par nom de compagnie dans le code source', () => {
  const insurerNames = [
    'Swiss Life', 'AXA', 'Helvetia', 'Zurich', 'Bâloise', 'Allianz Suisse',
    'Groupe Mutuel', 'CSS', 'Visana', 'Sanitas', 'Concordia', 'Generali',
  ];
  const sources = [
    fs.readFileSync(path.join(process.cwd(), 'server/commissionCalc.js'), 'utf8'),
    fs.readFileSync(path.join(process.cwd(), 'server/routes/commissions.js'), 'utf8'),
    fs.readFileSync(path.join(process.cwd(), 'server/routes/contracts.js'), 'utf8'),
  ];
  for (const source of sources) {
    for (const name of insurerNames) {
      assert.ok(!source.includes(name), `${name} ne doit jamais apparaître dans la logique de calcul de commission`);
    }
  }
});

// --- 13 : conservation des anciennes données (migration) -------------------

test('migration 15 : une commission historique (montant, dates, statut) est intégralement préservée, jamais transformée silencieusement', async () => {
  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-commission-legacy-'));
  const { pathToFileURL } = await import('url');
  const dbModuleUrl = pathToFileURL(path.join(process.cwd(), 'server/db.js')).href;
  const prevDir = process.env.CRM_DATA_DIR;

  // Construit une base VALIDE et à jour (toutes tables, via le vrai db.js),
  // y insère une commission historique typique, puis fait reculer
  // uniquement la table `commissions` à sa forme pré-migration-15 (et
  // refixe user_version = 14) — même technique que buildLegacyV10/V11
  // (test/migrations.test.js) : garantit un schéma légitime sur toutes les
  // AUTRES tables, jamais une reconstruction manuelle partielle et fragile.
  process.env.CRM_DATA_DIR = legacyDir;
  const scratchMod = await import(`${dbModuleUrl}?legacy-commission-scratch-${Date.now()}-${Math.random()}`);
  const scratch = scratchMod.default;
  const companyId = scratch.prepare("INSERT INTO companies (name) VALUES ('Compagnie historique')").run().lastInsertRowid;
  const clientId = scratch.prepare("INSERT INTO clients (first_name, last_name) VALUES ('Ancien', 'Client')").run().lastInsertRowid;
  const contractId = scratch
    .prepare("INSERT INTO contracts (client_id, company_id, branch, annual_premium) VALUES (?, ?, 'lamal', 4620)")
    .run(clientId, companyId).lastInsertRowid;
  scratch.prepare(`
    INSERT INTO commissions (
      contract_id, type, label, expected_amount_chf, received_amount_chf, expected_payment_date,
      received_payment_date, status, commission_mode, notes
    ) VALUES (?, 'acquisition', 'Commission historique', 138.6, 138.6, '2025-01-01', '2025-03-01', 'received', 'percentage', 'note historique')
  `).run(contractId);
  scratch.pragma('wal_checkpoint(TRUNCATE)');
  scratch.close();

  const revert = new Database(path.join(legacyDir, 'crm.sqlite'));
  revert.exec(`
    DROP TRIGGER IF EXISTS trg_commissions_status_valid_insert;
    DROP TRIGGER IF EXISTS trg_commissions_status_valid_update;
    DROP TRIGGER IF EXISTS trg_commissions_reversal_pair_insert;
    DROP TRIGGER IF EXISTS trg_commissions_reversal_pair_update;
  `);
  revert.exec(`UPDATE commissions SET status = 'payee' WHERE status = 'received'`);
  revert.exec(`
    ALTER TABLE commissions RENAME COLUMN expected_amount_chf TO amount;
    ALTER TABLE commissions RENAME COLUMN expected_payment_date TO due_date;
    ALTER TABLE commissions RENAME COLUMN received_payment_date TO paid_date;
    ALTER TABLE commissions DROP COLUMN received_amount_chf;
    ALTER TABLE commissions DROP COLUMN commission_mode;
    ALTER TABLE commissions DROP COLUMN product_name;
    ALTER TABLE commissions DROP COLUMN insured_label;
    ALTER TABLE commissions DROP COLUMN insurer_statement_reference;
    ALTER TABLE commissions DROP COLUMN accounting_period;
    ALTER TABLE commissions DROP COLUMN reversal_of_commission_id;
    ALTER TABLE commissions DROP COLUMN reversal_amount_chf;
  `);
  revert.pragma('user_version = 14');
  revert.close();

  const mod = await import(`${dbModuleUrl}?legacy-commission-${Date.now()}-${Math.random()}`);
  const migrated = mod.default;
  process.env.CRM_DATA_DIR = prevDir;

  const row = migrated.prepare('SELECT * FROM commissions WHERE id = 1').get();
  assert.equal(row.expected_amount_chf, 138.6, 'montant préservé, jamais recalculé');
  assert.equal(row.received_amount_chf, 138.6, 'intégralement reçu, comme le code historique le garantissait');
  assert.equal(row.expected_payment_date, '2025-01-01');
  assert.equal(row.received_payment_date, '2025-03-01');
  assert.equal(row.status, 'received');
  assert.equal(row.commission_mode, 'percentage', 'type acquisition historique -> mode percentage, seule description honnête de son mode de calcul réel');
  assert.equal(row.notes, 'note historique');
  assert.equal(migrated.pragma('integrity_check', { simple: true }), 'ok');
});

// --- 15 : environnement de démonstration isolé ------------------------------

test('script de démonstration commission : refuse de s’exécuter sans CRM_DATA_DIR isolé', () => {
  assert.throws(() => {
    execFileSync('node', ['server/seed-commission-demo.js'], {
      cwd: process.cwd(),
      env: { ...process.env, CRM_DATA_DIR: '' },
      stdio: 'pipe',
    });
  });
});

test('script de démonstration commission : refuse explicitement de cibler le répertoire de données réel', () => {
  const realDataDir = path.join(process.cwd(), 'data');
  assert.throws(() => {
    execFileSync('node', ['server/seed-commission-demo.js'], {
      cwd: process.cwd(),
      env: { ...process.env, CRM_DATA_DIR: realDataDir },
      stdio: 'pipe',
    });
  });
});

test('script de démonstration commission : réussit sur une base isolée et couvre tous les scénarios requis', () => {
  const demoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-commission-demo-'));
  const out = execFileSync('node', ['server/seed-commission-demo.js'], {
    cwd: process.cwd(),
    env: { ...process.env, CRM_DATA_DIR: demoDir },
    stdio: 'pipe',
  }).toString();
  assert.match(out, /LAMal seul/);
  assert.match(out, /foyer multi-membre/i);
  assert.match(out, /offre refusée/i);
  assert.match(out, /pourcentage/i);
  assert.match(out, /reprise/i);

  const check = new Database(path.join(demoDir, 'crm.sqlite'));
  const clientCount = check.prepare("SELECT COUNT(*) AS n FROM clients WHERE first_name = 'DEMO'").get().n;
  assert.equal(clientCount, 5, 'les 5 dossiers de démonstration doivent être présents');
  const reversalRow = check.prepare("SELECT * FROM commissions WHERE type = 'reprise'").get();
  assert.ok(reversalRow, 'la reprise de démonstration doit exister');
  assert.equal(reversalRow.reversal_amount_chf, -20);
  check.close();

  fs.rmSync(demoDir, { recursive: true, force: true });
});
