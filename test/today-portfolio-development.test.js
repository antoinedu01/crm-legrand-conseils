// Tests d'intégration du chantier « développement de portefeuille » (Lot 1).
// Deux volets :
//  - couverture des deux règles déjà en production dans server/routes/today.js
//    (`vente_complementaire`, `anniversaire_contrat`) qui n'avaient encore
//    aucun test avant ce lot ;
//  - les deux nouvelles règles ajoutées par ce lot (`manque_prevoyance`,
//    `manque_sante`), généralisation de `vente_complementaire` aux groupes
//    de branches LAMal/LCA <-> vie_3a/vie_3b.
// Base de test isolée dans un dossier temporaire (CRM_DATA_DIR), comme
// test/api.test.js.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-portfolio-'));
process.env.NODE_ENV = 'test';
process.env.SITE_ORIGINS = 'https://site-de-test.ch';
process.env.PUBLIC_RATE_LIMIT = '100';

const { default: app } = await import('../server/app.js');

const PASSWORD = 'MotDePasseDeTest!42';
let cookie = '';

function auth(req) {
  return req.set('Cookie', cookie);
}

before(async () => {
  const res = await request(app)
    .post('/api/auth/setup')
    .send({ email: 'test-portfolio@exemple.ch', name: 'Testeur', password: PASSWORD });
  assert.equal(res.status, 200);
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
});

async function makeClient(lastName, overrides = {}) {
  const res = await auth(request(app).post('/api/clients')).send({
    first_name: 'Test', last_name: lastName, status: 'client', ...overrides,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

async function makeContract({ branch, client_id, annual_premium = 3000, start_date, status = 'actif' }) {
  const res = await auth(request(app).post('/api/contracts')).send({
    client_id, company_id: 1, branch, annual_premium, status, start_date,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

async function findAction(clientId, type) {
  const plan = await auth(request(app).get('/api/today'));
  assert.equal(plan.status, 200);
  return plan.body.find((a) => a.client_id === clientId && a.type === type);
}

// ------- règles déjà en production, jusqu'ici sans aucun test -------

test('vente_complementaire — client actif sans couverture incapacité de gain apparaît, puis disparaît après un résultat logué', async () => {
  const clientId = await makeClient('SansIncapacite');
  await makeContract({ branch: 'lamal', client_id: clientId, annual_premium: 4000 });

  const action = await findAction(clientId, 'vente_complementaire');
  assert.ok(action, 'le client sans couverture incapacité apparaît dans le plan du jour');
  assert.equal(action.priority, 'basse');
  assert.ok(action.reason.includes('incapacité'));

  await auth(request(app).post('/api/today/result')).send({
    action_key: action.key, action_type: action.type, client_id: clientId, result: 'sans_suite',
  });
  const after = await findAction(clientId, 'vente_complementaire');
  assert.equal(after, undefined, 'l’action traitée ne réapparaît plus (dé-doublonnage)');
});

test('vente_complementaire — un client avec une couverture incapacité active n’apparaît jamais', async () => {
  const clientId = await makeClient('AvecIncapacite');
  await makeContract({ branch: 'incapacite', client_id: clientId, annual_premium: 1500 });

  const action = await findAction(clientId, 'vente_complementaire');
  assert.equal(action, undefined, 'aucun signal pour un client déjà couvert');
});

test('anniversaire_contrat — un contrat dont l’anniversaire tombe dans 10 jours apparaît, un contrat récent (< 1 an) n’apparaît pas', async () => {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 10);
  const pad = (n) => String(n).padStart(2, '0');
  const anniversaryStartDate = `${target.getFullYear() - 2}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;

  const clientId = await makeClient('AnniversaireProche');
  const contractId = await makeContract({
    branch: 'vie_3a', client_id: clientId, annual_premium: 2000, start_date: anniversaryStartDate,
  });

  const action = await findAction(clientId, 'anniversaire_contrat');
  assert.ok(action, 'le contrat dont l’anniversaire tombe dans 10 jours apparaît');
  assert.equal(action.contract_id, contractId);
  assert.equal(action.priority, 'normale');

  // Contrat souscrit aujourd'hui même (moins d'un an) : jamais un « anniversaire »
  const recentClientId = await makeClient('ContratRecent');
  await makeContract({
    branch: 'vie_3a', client_id: recentClientId, annual_premium: 2000,
    start_date: now.toISOString().slice(0, 10),
  });
  const recentAction = await findAction(recentClientId, 'anniversaire_contrat');
  assert.equal(recentAction, undefined, 'un contrat de moins d’un an n’a pas encore d’anniversaire');
});

// ------- nouvelles règles de ce lot -------

test('manque_prevoyance — client avec LAMal actif, sans aucun contrat 3a/3b actif', async () => {
  const clientId = await makeClient('SanteSeule');
  await makeContract({ branch: 'lamal', client_id: clientId, annual_premium: 4000 });

  const action = await findAction(clientId, 'manque_prevoyance');
  assert.ok(action, 'le client avec seulement du LAMal est signalé');
  assert.equal(action.priority, 'basse');
  assert.ok(action.reason.includes('prévoyance'));

  await auth(request(app).post('/api/today/result')).send({
    action_key: action.key, action_type: action.type, client_id: clientId, result: 'sans_suite',
  });
  const after = await findAction(clientId, 'manque_prevoyance');
  assert.equal(after, undefined, 'l’action traitée ne réapparaît plus');
});

test('manque_prevoyance — LCA seul (sans LAMal) déclenche aussi le signal', async () => {
  const clientId = await makeClient('LcaSeul');
  await makeContract({ branch: 'lca', client_id: clientId, annual_premium: 1800 });

  const action = await findAction(clientId, 'manque_prevoyance');
  assert.ok(action, 'le groupe santé se déclenche aussi via LCA seul, pas seulement LAMal');
});

test('manque_sante — client avec 3a actif, sans aucun contrat LAMal/LCA actif', async () => {
  const clientId = await makeClient('PrevoyanceSeule');
  await makeContract({ branch: 'vie_3a', client_id: clientId, annual_premium: 5000 });

  const action = await findAction(clientId, 'manque_sante');
  assert.ok(action, 'le client avec seulement du 3a est signalé');
  assert.equal(action.priority, 'basse');
  assert.ok(action.reason.includes('maladie'));
});

test('manque_sante — 3b seul (sans 3a) déclenche aussi le signal', async () => {
  const clientId = await makeClient('TroisBSeul');
  await makeContract({ branch: 'vie_3b', client_id: clientId, annual_premium: 3000 });

  const action = await findAction(clientId, 'manque_sante');
  assert.ok(action, 'le groupe prévoyance se déclenche aussi via 3b seul, pas seulement 3a');
});

test('client avec les deux groupes (LAMal + 3a) — ni manque_prevoyance ni manque_sante', async () => {
  const clientId = await makeClient('DejaComplet');
  await makeContract({ branch: 'lamal', client_id: clientId, annual_premium: 4000 });
  await makeContract({ branch: 'vie_3a', client_id: clientId, annual_premium: 5000 });

  assert.equal(await findAction(clientId, 'manque_prevoyance'), undefined, 'aucun manque prévoyance : le client a du 3a');
  assert.equal(await findAction(clientId, 'manque_sante'), undefined, 'aucun manque santé : le client a du LAMal');
});

test('un contrat résilié ne compte pas comme couverture active — le manque est bien détecté', async () => {
  const clientId = await makeClient('ContratResilie');
  await makeContract({ branch: 'lamal', client_id: clientId, annual_premium: 4000, status: 'resilie' });
  await makeContract({ branch: 'vie_3a', client_id: clientId, annual_premium: 5000 });

  // Le seul contrat "santé" est résilié (statut != 'actif') : le client n'a
  // donc aucune couverture santé active, exactement comme s'il n'en avait
  // jamais eu — manque_sante doit se déclencher (même sémantique que
  // vente_complementaire/incapacite : seul le statut 'actif' compte).
  const action = await findAction(clientId, 'manque_sante');
  assert.ok(action, 'un contrat résilié ne vaut pas couverture active : le manque est détecté');
  // Le client a bien du 3a actif, donc pas de manque_prevoyance.
  assert.equal(await findAction(clientId, 'manque_prevoyance'), undefined);
});

test('un client "entreprise" n’est jamais signalé (règle limitée aux particuliers, comme vente_complementaire)', async () => {
  const clientId = await makeClient('EntrepriseTest', { type: 'entreprise', company_name: 'Test Sàrl' });
  await makeContract({ branch: 'lamal', client_id: clientId, annual_premium: 4000 });

  assert.equal(await findAction(clientId, 'manque_prevoyance'), undefined, 'les entreprises sont hors périmètre de ce signal');
});
