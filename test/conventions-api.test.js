// API des conventions de courtage et leur effet sur les contrats et les
// commissions. Base de test isolée (CRM_DATA_DIR), jamais data/**. Barèmes
// et libellés FICTIFS : aucun taux réel de compagnie dans le dépôt.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-conventions-api-'));
process.env.NODE_ENV = 'test';
process.env.SITE_ORIGINS = 'https://site-de-test.ch';
process.env.PUBLIC_RATE_LIMIT = '1000';

const { default: app } = await import('../server/app.js');
const { default: db } = await import('../server/db.js');

const PASSWORD = 'MotDePasseDeTest!42';
let cookie = '';
const auth = (req) => req.set('Cookie', cookie);

before(async () => {
  const res = await request(app)
    .post('/api/auth/setup')
    .send({ email: 'test-conventions@exemple.ch', name: 'Testeur', password: PASSWORD });
  assert.equal(res.status, 200);
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
});

let counter = 0;
async function makeClient() {
  counter += 1;
  const res = await auth(request(app).post('/api/clients')).send({
    first_name: 'Test', last_name: `Convention${counter}`, status: 'client',
    consent_data: 1, mandate_signed: 1, info_lsa_date: '2026-01-15',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

async function makeCompany(name) {
  const res = await auth(request(app).post('/api/companies')).send({ name });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

async function makeConvention(company_id, extra = {}) {
  const res = await auth(request(app).post('/api/conventions')).send({
    company_id, title: `Convention test ${company_id}-${counter++}`, status: 'signee', ...extra,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

async function makeRate(conventionId, body) {
  const res = await auth(request(app).post(`/api/conventions/${conventionId}/rates`)).send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

async function createContract(body) {
  const client_id = body.client_id ?? await makeClient();
  return auth(request(app).post('/api/contracts')).send({ status: 'actif', ...body, client_id });
}

function commissionsOf(contractId) {
  return db.prepare('SELECT * FROM commissions WHERE contract_id = ? ORDER BY id').all(contractId);
}

const PALIERS = [{ months: 12, pct: 100 }, { months: 24, pct: 50 }];

// --- 1. Rétrocompatibilité : aucun avertissement tant qu'aucune convention --

test('aucune convention saisie dans le CRM → aucun avertissement de convention à la création d’un contrat', async () => {
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM conventions').get().n, 0, 'précondition : base sans convention');
  const companyId = await makeCompany('Compagnie Sans Convention SA');
  const res = await createContract({ company_id: companyId, branch: 'lamal', annual_premium: 3000 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.warnings.length, 0, JSON.stringify(res.body.warnings));
  assert.equal(commissionsOf(res.body.id).length, 0, 'LAMal sans ligne de barème : aucune commission inventée');
});

// --- 2. CRUD et validation ------------------------------------------------

test('création d’une convention et de ses lignes, lecture groupée et lignes applicables', async () => {
  const companyId = await makeCompany('Assureur Alpha SA');
  const convId = await makeConvention(companyId, { intermediary_code: 'A-001', client_followup: 'compagnie' });
  const fixedId = await makeRate(convId, {
    branch: 'lamal', label: 'Base fictive', basis: 'fixe', value: 55,
    clawback_mode: 'paliers', clawback_steps: PALIERS, source_ref: 'Annexe fictive §1',
  });
  const inactiveId = await makeRate(convId, { branch: 'lamal', label: 'Ancienne ligne', basis: 'fixe', value: 40, active: false });

  const list = await auth(request(app).get('/api/conventions'));
  assert.equal(list.status, 200);
  const conv = list.body.find((c) => c.id === convId);
  assert.equal(conv.company_name, 'Assureur Alpha SA');
  assert.equal(conv.rates.length, 2);
  const fixed = conv.rates.find((r) => r.id === fixedId);
  assert.deepEqual(fixed.clawback_steps, PALIERS);
  assert.equal(fixed.active, true);

  const applicable = await auth(request(app).get(`/api/conventions/rates?company_id=${companyId}&branch=lamal`));
  assert.equal(applicable.status, 200);
  assert.deepEqual(applicable.body.map((r) => r.id), [fixedId], 'seules les lignes actives des conventions signées');
  assert.equal(applicable.body[0].convention_status, 'signee');

  const withInactive = await auth(request(app).get(`/api/conventions/rates?company_id=${companyId}&branch=lamal&include_inactive=1`));
  assert.deepEqual(withInactive.body.map((r) => r.id).sort(), [fixedId, inactiveId].sort());

  const companies = await auth(request(app).get('/api/companies'));
  assert.equal(companies.body.find((c) => c.id === companyId).convention_status, 'signee');
});

test('validation stricte des conventions et des lignes de barème', async () => {
  const companyId = await makeCompany('Assureur Validation SA');
  const noTitle = await auth(request(app).post('/api/conventions')).send({ company_id: companyId });
  assert.equal(noTitle.status, 400);
  const unknownCompany = await auth(request(app).post('/api/conventions')).send({ company_id: 999999, title: 'X' });
  assert.equal(unknownCompany.status, 400);
  const badStatus = await auth(request(app).post('/api/conventions')).send({ company_id: companyId, title: 'X', status: 'peut-etre' });
  assert.equal(badStatus.status, 400);
  const badDate = await auth(request(app).post('/api/conventions')).send({ company_id: companyId, title: 'X', effective_date: '01.07.2026' });
  assert.equal(badDate.status, 400);

  const convId = await makeConvention(companyId);
  const post = (body) => auth(request(app).post(`/api/conventions/${convId}/rates`)).send(body);
  assert.equal((await post({ branch: 'lamal', label: 'X', basis: 'inconnue', value: 1 })).status, 400, 'base inconnue');
  assert.equal((await post({ branch: 'voiture', label: 'X', basis: 'fixe', value: 1 })).status, 400, 'branche inconnue');
  assert.equal((await post({ branch: 'lamal', label: '', basis: 'fixe', value: 1 })).status, 400, 'libellé requis');
  assert.equal((await post({ branch: 'lamal', label: 'X', basis: 'fixe' })).status, 400, 'valeur requise');
  assert.equal((await post({ branch: 'lamal', label: 'X', basis: 'fixe', value: '55' })).status, 400, 'aucune coercition de chaîne');
  assert.equal((await post({ branch: 'lca', label: 'X', basis: 'mois_prime', value: 500 })).status, 400, 'nombre de mois borné');
  assert.equal((await post({ branch: 'lca', label: 'X', basis: 'mois_prime', value: 10, multiply_by_years: true })).status, 400,
    'multiplication par années réservée au % de prime annuelle');
  assert.equal((await post({ branch: 'lamal', label: 'X', basis: 'fixe', value: 1, clawback_mode: 'paliers', clawback_steps: [{ months: 24, pct: 50 }, { months: 12, pct: 100 }] })).status, 400,
    'paliers non croissants');
  assert.equal((await post({ branch: 'lamal', label: 'X', basis: 'fixe', value: 1, clawback_mode: 'prorata' })).status, 400,
    'prorata sans durée');
  assert.equal((await post({ branch: 'lamal', label: 'X', basis: 'a_confirmer' })).status, 201, 'à confirmer sans valeur : accepté');
});

// --- 3. Contrats : commission selon la convention ---------------------------

test('contrat LAMal avec une ligne fixe → commission attendue créée en montant fixe, tracée vers la ligne', async () => {
  const companyId = await makeCompany('Assureur Beta SA');
  const convId = await makeConvention(companyId);
  const rateId = await makeRate(convId, { branch: 'lamal', label: 'Base fictive Beta', basis: 'fixe', value: 55 });

  const res = await createContract({ company_id: companyId, branch: 'lamal', annual_premium: 4200, convention_rate_id: rateId, start_date: '2026-11-01' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.convention_commission.amount, 55);
  const rows = commissionsOf(res.body.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'acquisition');
  assert.equal(rows[0].commission_mode, 'fixed_amount', 'jamais de mode pourcentage en LAMal');
  assert.equal(rows[0].expected_amount_chf, 55);
  assert.equal(rows[0].convention_rate_id, rateId);
  assert.equal(rows[0].expected_payment_date, '2026-11-01');
  assert.match(rows[0].label, /convention — Base fictive Beta/);
  const contract = db.prepare('SELECT convention_rate_id FROM contracts WHERE id = ?').get(res.body.id);
  assert.equal(contract.convention_rate_id, rateId);
});

test('contrat LCA avec une ligne « N primes mensuelles » → montant = prime mensuelle × N, taux génériques ignorés', async () => {
  const companyId = await makeCompany('Assureur Gamma SA');
  const convId = await makeConvention(companyId);
  const rateId = await makeRate(convId, { branch: 'lca', label: 'Complémentaire fictive', basis: 'mois_prime', value: 10 });
  const res = await createContract({
    company_id: companyId, branch: 'lca', annual_premium: 1200, acq_commission_rate: 50, convention_rate_id: rateId,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const rows = commissionsOf(res.body.id);
  assert.equal(rows.length, 1, 'une seule commission : celle de la convention');
  assert.equal(rows[0].expected_amount_chf, 1000);
});

test('contrat Vie avec une ligne « production » : durée prise dans le bloc vie', async () => {
  const companyId = await makeCompany('Assureur Delta Vie SA');
  const convId = await makeConvention(companyId);
  const rateId = await makeRate(convId, { branch: 'vie_3a', label: 'Vie fictive', basis: 'pct_production', value: 2, max_years: 20, valuation_pct: 50 });
  const res = await createContract({
    company_id: companyId, branch: 'vie_3a', annual_premium: 3000, payment_frequency: 'mensuelle', convention_rate_id: rateId,
    life: { component_type: 'mixte', policy_term_years: 25 },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  // 3000 × 20 (plafond) × 50 % = 30'000 ; 2 % = 600
  assert.equal(commissionsOf(res.body.id)[0].expected_amount_chf, 600);

  const noTerm = await createContract({
    company_id: companyId, branch: 'vie_3a', annual_premium: 3000, payment_frequency: 'mensuelle', convention_rate_id: rateId,
    life: { component_type: 'mixte' },
  });
  assert.equal(noTerm.status, 201, 'une donnée manquante ne bloque pas la création du contrat');
  assert.equal(commissionsOf(noTerm.body.id).length, 0, 'aucune commission inventée sans durée');
  assert.ok(noTerm.body.warnings.some((w) => /non créée/.test(w)), JSON.stringify(noTerm.body.warnings));
});

test('ligne « à confirmer » → contrat créé, aucune commission, avertissement explicite', async () => {
  const companyId = await makeCompany('Assureur Epsilon SA');
  const convId = await makeConvention(companyId);
  const rateId = await makeRate(convId, { branch: 'lca', label: 'Barème non fourni', basis: 'a_confirmer' });
  const res = await createContract({ company_id: companyId, branch: 'lca', annual_premium: 900, convention_rate_id: rateId });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(commissionsOf(res.body.id).length, 0);
  assert.ok(res.body.warnings.some((w) => /Barème à confirmer/.test(w)), JSON.stringify(res.body.warnings));
});

test('rattachement refusé : autre compagnie, autre branche, ligne inactive, convention non signée', async () => {
  const companyA = await makeCompany('Assureur Zeta SA');
  const companyB = await makeCompany('Assureur Eta SA');
  const convA = await makeConvention(companyA);
  const rateA = await makeRate(convA, { branch: 'lamal', label: 'Ligne Zeta', basis: 'fixe', value: 50 });
  const inactive = await makeRate(convA, { branch: 'lamal', label: 'Ligne Zeta inactive', basis: 'fixe', value: 50, active: false });
  const pendingConv = await makeConvention(companyA, { status: 'en_attente' });
  const pendingRate = await makeRate(pendingConv, { branch: 'lamal', label: 'Ligne en attente', basis: 'fixe', value: 50 });

  const otherCompany = await createContract({ company_id: companyB, branch: 'lamal', annual_premium: 1000, convention_rate_id: rateA });
  assert.equal(otherCompany.status, 400);
  const otherBranch = await createContract({ company_id: companyA, branch: 'lca', annual_premium: 1000, convention_rate_id: rateA });
  assert.equal(otherBranch.status, 400);
  const inactiveRes = await createContract({ company_id: companyA, branch: 'lamal', annual_premium: 1000, convention_rate_id: inactive });
  assert.equal(inactiveRes.status, 400);
  const pendingRes = await createContract({ company_id: companyA, branch: 'lamal', annual_premium: 1000, convention_rate_id: pendingRate });
  assert.equal(pendingRes.status, 400);
  const missing = await createContract({ company_id: companyA, branch: 'lamal', annual_premium: 1000, convention_rate_id: 999999 });
  assert.equal(missing.status, 400);
});

test('avertissements : compagnie sans convention signée, branche non couverte par la convention', async () => {
  const signedCompany = await makeCompany('Assureur Theta SA');
  const convId = await makeConvention(signedCompany);
  await makeRate(convId, { branch: 'lamal', label: 'Ligne Theta', basis: 'fixe', value: 50 });
  const noConvention = await makeCompany('Assureur Iota SA');

  const uncovered = await createContract({ company_id: signedCompany, branch: 'vie_3b', annual_premium: 1000 });
  assert.equal(uncovered.status, 201);
  assert.ok(uncovered.body.warnings.some((w) => /ne prévoit aucune ligne/.test(w)), JSON.stringify(uncovered.body.warnings));

  const none = await createContract({ company_id: noConvention, branch: 'lamal', annual_premium: 1000 });
  assert.equal(none.status, 201);
  assert.ok(none.body.warnings.some((w) => /Aucune convention de courtage signée avec Assureur Iota SA/.test(w)), JSON.stringify(none.body.warnings));

  const covered = await createContract({ company_id: signedCompany, branch: 'lamal', annual_premium: 1000 });
  assert.equal(covered.body.warnings.length, 0, 'branche couverte : aucun avertissement (client en règle)');
});

// --- 4. Lignes utilisées : historique protégé --------------------------------

test('ligne déjà utilisée : montants figés, libellé modifiable, désactivation possible, suppression refusée', async () => {
  const companyId = await makeCompany('Assureur Kappa SA');
  const convId = await makeConvention(companyId);
  const rateId = await makeRate(convId, { branch: 'lamal', label: 'Ligne Kappa', basis: 'fixe', value: 50 });
  const contract = await createContract({ company_id: companyId, branch: 'lamal', annual_premium: 1000, convention_rate_id: rateId });
  assert.equal(contract.status, 201);

  const changeValue = await auth(request(app).put(`/api/conventions/rates/${rateId}`)).send({ value: 60 });
  assert.equal(changeValue.status, 400);
  assert.deepEqual(changeValue.body.locked_fields, ['value']);

  const rename = await auth(request(app).put(`/api/conventions/rates/${rateId}`)).send({ label: 'Ligne Kappa (2026)', conditions: 'Note' });
  assert.equal(rename.status, 200, JSON.stringify(rename.body));
  const deactivate = await auth(request(app).put(`/api/conventions/rates/${rateId}`)).send({ active: false });
  assert.equal(deactivate.status, 200, JSON.stringify(deactivate.body));
  assert.equal(db.prepare('SELECT active FROM convention_rates WHERE id = ?').get(rateId).active, 0);

  const del = await auth(request(app).delete(`/api/conventions/rates/${rateId}`));
  assert.equal(del.status, 400);
  const delConv = await auth(request(app).delete(`/api/conventions/${convId}`));
  assert.equal(delConv.status, 400);
  const delCompany = await auth(request(app).delete(`/api/companies/${companyId}`));
  assert.equal(delCompany.status, 400);
  assert.ok(db.prepare('SELECT id FROM convention_rates WHERE id = ?').get(rateId), 'la ligne existe toujours');
});

test('ligne et convention inutilisées : suppression possible, compagnie avec convention protégée', async () => {
  const companyId = await makeCompany('Assureur Lambda SA');
  const convId = await makeConvention(companyId);
  const rateId = await makeRate(convId, { branch: 'lca', label: 'Ligne Lambda', basis: 'fixe', value: 10 });
  const value = await auth(request(app).put(`/api/conventions/rates/${rateId}`)).send({ value: 12 });
  assert.equal(value.status, 200, 'ligne jamais utilisée : montant encore modifiable');
  assert.equal((await auth(request(app).delete(`/api/companies/${companyId}`))).status, 400);
  assert.equal((await auth(request(app).delete(`/api/conventions/rates/${rateId}`))).status, 200);
  assert.equal((await auth(request(app).delete(`/api/conventions/${convId}`))).status, 200);
  assert.equal((await auth(request(app).delete(`/api/companies/${companyId}`))).status, 200);
});

test('modification de contrat : changer de compagnie avec une ligne liée est refusé, retirer la ligne est accepté', async () => {
  const companyId = await makeCompany('Assureur Mu SA');
  const otherId = await makeCompany('Assureur Nu SA');
  const convId = await makeConvention(companyId);
  const rateId = await makeRate(convId, { branch: 'lamal', label: 'Ligne Mu', basis: 'fixe', value: 50 });
  const created = await createContract({ company_id: companyId, branch: 'lamal', annual_premium: 1000, convention_rate_id: rateId });
  const id = created.body.id;

  const move = await auth(request(app).put(`/api/contracts/${id}`)).send({ company_id: otherId });
  assert.equal(move.status, 400);
  assert.equal(db.prepare('SELECT company_id FROM contracts WHERE id = ?').get(id).company_id, companyId);

  const unlink = await auth(request(app).put(`/api/contracts/${id}`)).send({ company_id: otherId, convention_rate_id: null });
  assert.equal(unlink.status, 200, JSON.stringify(unlink.body));
  const row = db.prepare('SELECT company_id, convention_rate_id FROM contracts WHERE id = ?').get(id);
  assert.equal(row.company_id, otherId);
  assert.equal(row.convention_rate_id, null);
  assert.equal(commissionsOf(id)[0].convention_rate_id, rateId, 'la commission garde sa provenance');
});

// --- 5. Reprise -------------------------------------------------------------

test('estimation de reprise selon la convention (lecture seule)', async () => {
  const companyId = await makeCompany('Assureur Xi SA');
  const convId = await makeConvention(companyId);
  const rateId = await makeRate(convId, {
    branch: 'lca', label: 'Ligne Xi', basis: 'fixe', value: 200, clawback_mode: 'paliers', clawback_steps: PALIERS,
  });
  const created = await createContract({
    company_id: companyId, branch: 'lca', annual_premium: 1000, convention_rate_id: rateId, start_date: '2026-01-01',
  });
  const commission = commissionsOf(created.body.id)[0];

  const within = await auth(request(app).get(`/api/commissions/${commission.id}/clawback-estimate?coverage_end=2027-06-30`));
  assert.equal(within.status, 200);
  assert.equal(within.body.available, true);
  assert.equal(within.body.pct, 50);
  assert.equal(within.body.suggested_amount, 100);
  assert.equal(within.body.period_end, '2027-12-31');

  const after = await auth(request(app).get(`/api/commissions/${commission.id}/clawback-estimate?coverage_end=2028-03-31`));
  assert.equal(after.body.pct, 0);
  assert.equal(after.body.suggested_amount, 0);

  const bad = await auth(request(app).get(`/api/commissions/${commission.id}/clawback-estimate?coverage_end=31.12.2027`));
  assert.equal(bad.status, 400);

  const before = commissionsOf(created.body.id);
  assert.equal(before.length, 1, 'aucune écriture : l’estimation ne crée jamais de reprise');

  const plainCompany = await makeCompany('Assureur Omicron SA');
  const plain = await createContract({ company_id: plainCompany, branch: 'rc_menage', annual_premium: 1000, acq_commission_rate: 2 });
  const plainCommission = commissionsOf(plain.body.id)[0];
  const unavailable = await auth(request(app).get(`/api/commissions/${plainCommission.id}/clawback-estimate`));
  assert.equal(unavailable.body.available, false);
});

test('reprise : estimation réservée à la commission d’acquisition ; règle au prorata', async () => {
  const companyId = await makeCompany('Assureur Pi SA');
  const convId = await makeConvention(companyId);
  const rateId = await makeRate(convId, {
    branch: 'lca', label: 'Ligne Pi', basis: 'fixe', value: 240, clawback_mode: 'prorata', clawback_months: 24,
  });
  const created = await createContract({
    company_id: companyId, branch: 'lca', annual_premium: 1000, convention_rate_id: rateId, start_date: '2026-01-01',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const acquisition = commissionsOf(created.body.id)[0];
  // 12 mois couverts sur 24 : la moitié de la commission est reprise.
  const half = await auth(request(app).get(`/api/commissions/${acquisition.id}/clawback-estimate?coverage_end=2026-12-31`));
  assert.equal(half.status, 200);
  assert.equal(half.body.pct, 50);
  assert.equal(half.body.suggested_amount, 120);
  assert.equal(half.body.period_end, '2027-12-31');

  const recurring = db
    .prepare(`INSERT INTO commissions (contract_id, type, expected_amount_chf, status, commission_mode, convention_rate_id)
              VALUES (?, 'recurrente', 10, 'expected', 'fixed_amount', ?)`)
    .run(created.body.id, rateId).lastInsertRowid;
  const onRecurring = await auth(request(app).get(`/api/commissions/${recurring}/clawback-estimate?coverage_end=2026-12-31`));
  assert.equal(onRecurring.status, 200);
  assert.equal(onRecurring.body.available, false, 'aucune estimation pour une récurrente');

  const reversal = await auth(request(app).post(`/api/commissions/${acquisition.id}/reverse`)).send({ reversal_amount_chf: -120 });
  assert.equal(reversal.status, 201, JSON.stringify(reversal.body));
  const onReversal = await auth(request(app).get(`/api/commissions/${reversal.body.id}/clawback-estimate`));
  assert.equal(onReversal.body.available, false, 'aucune estimation pour une ligne de reprise');

  const impossible = await auth(request(app).get(`/api/commissions/${acquisition.id}/clawback-estimate?coverage_end=2027-02-30`));
  assert.equal(impossible.status, 400, 'date impossible refusée');
});

test('identifiants et dates stricts : booléen, décimal, 31 février, fin avant le début', async () => {
  const companyId = await makeCompany('Assureur Rho SA');
  const convId = await makeConvention(companyId);
  await makeRate(convId, { branch: 'lamal', label: 'Ligne Rho', basis: 'fixe', value: 50 });
  for (const bad of [true, 1.5, '7abc', 0, -3]) {
    const res = await createContract({ company_id: companyId, branch: 'lamal', annual_premium: 1000, convention_rate_id: bad });
    assert.equal(res.status, 400, `convention_rate_id ${JSON.stringify(bad)} refusé`);
  }
  const boolCompany = await auth(request(app).post('/api/conventions')).send({ company_id: true, title: 'X' });
  assert.equal(boolCompany.status, 400, 'company_id booléen refusé');
  const feb31 = await auth(request(app).post('/api/conventions')).send({ company_id: companyId, title: 'X', effective_date: '2026-02-31' });
  assert.equal(feb31.status, 400);
  const reversed = await auth(request(app).post('/api/conventions')).send({
    company_id: companyId, title: 'X', effective_date: '2026-07-01', end_date: '2026-06-30',
  });
  assert.equal(reversed.status, 400);
  const rates = await auth(request(app).get('/api/conventions/rates?company_id=true&branch=lamal'));
  assert.equal(rates.status, 400);
});

test('convention échue : lignes plus proposées, rattachement refusé, avertissement explicite', async () => {
  const companyId = await makeCompany('Assureur Sigma Échu SA');
  const convId = await makeConvention(companyId, { effective_date: '2020-01-01', end_date: '2021-12-31' });
  const rateId = await makeRate(convId, { branch: 'lamal', label: 'Ligne échue', basis: 'fixe', value: 50 });

  const applicable = await auth(request(app).get(`/api/conventions/rates?company_id=${companyId}&branch=lamal`));
  assert.deepEqual(applicable.body, [], 'convention échue : aucune ligne proposée');
  const all = await auth(request(app).get(`/api/conventions/rates?company_id=${companyId}&branch=lamal&include_inactive=1`));
  assert.equal(all.body.length, 1);
  assert.equal(all.body[0].convention_in_force, false);

  const linked = await createContract({ company_id: companyId, branch: 'lamal', annual_premium: 1000, convention_rate_id: rateId });
  assert.equal(linked.status, 400);
  assert.match(linked.body.error, /a pris fin le 31\.12\.2021/);
  const plain = await createContract({ company_id: companyId, branch: 'lamal', annual_premium: 1000 });
  assert.equal(plain.status, 201);
  assert.ok(plain.body.warnings.some((w) => /n’est plus en vigueur/.test(w)), JSON.stringify(plain.body.warnings));

  const list = await auth(request(app).get('/api/conventions'));
  assert.equal(list.body.find((c) => c.id === convId).in_force, false);
});

test('commission selon la convention : note sans détail de calcul ; récurrente de la ligne reprise par le contrat', async () => {
  const companyId = await makeCompany('Assureur Tau Note SA');
  const convId = await makeConvention(companyId);
  const rateId = await makeRate(convId, { branch: 'rc_menage', label: 'Ménage fictif', basis: 'pct_prime_annuelle', value: 12, rec_rate: 4 });
  const res = await createContract({ company_id: companyId, branch: 'rc_menage', annual_premium: 500, convention_rate_id: rateId });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.convention_commission.amount, 60);
  assert.match(res.body.convention_commission.formula, /12/, 'le détail reste affiché au conseiller');
  const [row] = commissionsOf(res.body.id);
  assert.equal(row.expected_amount_chf, 60);
  assert.doesNotMatch(row.notes || '', /\d|%|×|prime/, 'aucun taux ni calcul persisté dans la note');
  assert.equal(db.prepare('SELECT rec_commission_rate FROM contracts WHERE id = ?').get(res.body.id).rec_commission_rate, 4);
});

test('prime unique : une base périodique ne produit jamais de montant approximatif', async () => {
  const companyId = await makeCompany('Assureur Upsilon SA');
  const convId = await makeConvention(companyId);
  const rateId = await makeRate(convId, { branch: 'vie_3b', label: 'Ligne mensuelle', basis: 'mois_prime', value: 2 });
  const res = await createContract({
    company_id: companyId, branch: 'vie_3b', annual_premium: 50000, payment_frequency: 'unique', convention_rate_id: rateId,
    life: { component_type: 'mixte', policy_term_years: 10 },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(commissionsOf(res.body.id).length, 0);
  assert.ok(res.body.warnings.some((w) => /prime périodique/.test(w)), JSON.stringify(res.body.warnings));
});

test('ligne de barème : paramètres d’une autre base remis à vide, valeur informative admise pour « à confirmer »', async () => {
  const companyId = await makeCompany('Assureur Phi SA');
  const convId = await makeConvention(companyId);
  const fixedId = await makeRate(convId, { branch: 'lca', label: 'Fixe avec reliquats', basis: 'fixe', value: 30, max_years: 10, valuation_pct: 50 });
  const row = db.prepare('SELECT max_years, valuation_pct FROM convention_rates WHERE id = ?').get(fixedId);
  assert.deepEqual({ ...row }, { max_years: null, valuation_pct: null });
  await makeRate(convId, { branch: 'lca', label: 'Barème en attente', basis: 'a_confirmer', value: 150 });
});

test('usage d’une ligne : contrats et commissions comptés ; convention non déplaçable dès qu’une commission s’y rattache', async () => {
  const companyId = await makeCompany('Assureur Chi SA');
  const otherId = await makeCompany('Assureur Psi SA');
  const convId = await makeConvention(companyId);
  const rateId = await makeRate(convId, { branch: 'lca', label: 'Ligne Chi', basis: 'fixe', value: 20 });
  const contract = await createContract({ company_id: companyId, branch: 'lca', annual_premium: 800 });
  assert.equal(contract.status, 201, JSON.stringify(contract.body));
  db.prepare(`INSERT INTO commissions (contract_id, type, expected_amount_chf, status, commission_mode, convention_rate_id)
              VALUES (?, 'acquisition', 20, 'expected', 'fixed_amount', ?)`).run(contract.body.id, rateId);

  const list = await auth(request(app).get('/api/conventions'));
  const rate = list.body.find((c) => c.id === convId).rates.find((r) => r.id === rateId);
  assert.equal(rate.contracts_count, 0);
  assert.equal(rate.commissions_count, 1);
  assert.equal(rate.usage_count, 1);

  const move = await auth(request(app).put(`/api/conventions/${convId}`)).send({ company_id: otherId });
  assert.equal(move.status, 400, JSON.stringify(move.body));
  assert.equal(db.prepare('SELECT company_id FROM conventions WHERE id = ?').get(convId).company_id, companyId);
});

test('les routes conventions exigent une session authentifiée', async () => {
  const res = await request(app).get('/api/conventions');
  assert.equal(res.status, 401);
  const rates = await request(app).get('/api/conventions/rates?company_id=1&branch=lamal');
  assert.equal(rates.status, 401);
});
