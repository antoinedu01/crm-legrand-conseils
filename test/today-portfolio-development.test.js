// Tests d'intégration du chantier « développement de portefeuille »
// (Lots 1 et 3). Trois volets :
//  - couverture des deux règles déjà en production dans server/routes/today.js
//    (`vente_complementaire`, `anniversaire_contrat`) qui n'avaient encore
//    aucun test avant le Lot 1 ;
//  - les deux règles ajoutées par le Lot 1 (`manque_prevoyance`,
//    `manque_sante`), généralisation de `vente_complementaire` aux groupes
//    de branches LAMal/LCA <-> vie_3a/vie_3b — testées ici avec des primes
//    volontairement sous les seuils du Lot 3, pour isoler la détection de
//    base de la priorisation ;
//  - la priorisation par seuil de prime ajoutée par le Lot 3 (section
//    dédiée en bas de fichier) : priorité 'normale' au-dessus du seuil
//    (LAMal/LCA >= 1'500 CHF/an, vie_3a/3b >= 4'000 CHF/an, sur la prime du
//    groupe déjà détenu), 'basse' en dessous — jamais 'haute'.
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
  // Prime volontairement sous le seuil de priorisation du Lot 3 (1'500) :
  // ce test isole la détection de base, pas la priorisation (voir plus bas).
  await makeContract({ branch: 'lamal', client_id: clientId, annual_premium: 800 });

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
  // Prime volontairement sous le seuil de priorisation du Lot 3 (4'000).
  await makeContract({ branch: 'vie_3a', client_id: clientId, annual_premium: 1000 });

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

// ------- priorisation par seuil de prime (Lot 3) -------

test('manque_prevoyance — prime LAMal/LCA exactement au seuil (1\'500) : priorité normale', async () => {
  const clientId = await makeClient('SeuilPrevoyancePile');
  await makeContract({ branch: 'lamal', client_id: clientId, annual_premium: 1500 });

  const action = await findAction(clientId, 'manque_prevoyance');
  assert.ok(action);
  assert.equal(action.priority, 'normale', 'le seuil est inclusif (>=), pas strictement supérieur');
});

test('manque_prevoyance — prime LAMal/LCA juste sous le seuil (1\'499) : priorité basse', async () => {
  const clientId = await makeClient('SeuilPrevoyanceSous');
  await makeContract({ branch: 'lamal', client_id: clientId, annual_premium: 1499 });

  const action = await findAction(clientId, 'manque_prevoyance');
  assert.ok(action);
  assert.equal(action.priority, 'basse');
});

test('manque_prevoyance — le seuil se calcule sur la somme de plusieurs contrats du groupe, pas un seul', async () => {
  const clientId = await makeClient('SeuilPrevoyanceSomme');
  // Deux contrats de 800 CHF, aucun ne dépasse seul le seuil, la somme (1'600) si.
  await makeContract({ branch: 'lamal', client_id: clientId, annual_premium: 800 });
  await makeContract({ branch: 'lca', client_id: clientId, annual_premium: 800 });

  const action = await findAction(clientId, 'manque_prevoyance');
  assert.ok(action);
  assert.equal(action.priority, 'normale', 'la somme des deux contrats (1\'600) dépasse le seuil de 1\'500');
});

test('manque_sante — prime vie_3a/3b exactement au seuil (4\'000) : priorité normale', async () => {
  const clientId = await makeClient('SeuilSantePile');
  await makeContract({ branch: 'vie_3a', client_id: clientId, annual_premium: 4000 });

  const action = await findAction(clientId, 'manque_sante');
  assert.ok(action);
  assert.equal(action.priority, 'normale');
});

test('manque_sante — prime vie_3a/3b juste sous le seuil (3\'999) : priorité basse', async () => {
  const clientId = await makeClient('SeuilSanteSous');
  await makeContract({ branch: 'vie_3a', client_id: clientId, annual_premium: 3999 });

  const action = await findAction(clientId, 'manque_sante');
  assert.ok(action);
  assert.equal(action.priority, 'basse');
});

test('la priorisation ne dépasse jamais "normale" : jamais "haute" même pour une prime très élevée', async () => {
  const clientId = await makeClient('SeuilJamaisHaute');
  await makeContract({ branch: 'vie_3a', client_id: clientId, annual_premium: 50000 });

  const action = await findAction(clientId, 'manque_sante');
  assert.ok(action);
  assert.equal(action.priority, 'normale', '"haute" reste réservée aux échéances proches et aux prospects urgents');
});

test('un contrat résilié n’entre pas dans le calcul du seuil (held_premium ne compte que les contrats actifs)', async () => {
  const clientId = await makeClient('SeuilContratResilie');
  // Contrat résilié de 10'000 : ne doit jamais faire franchir le seuil.
  await makeContract({ branch: 'lamal', client_id: clientId, annual_premium: 10000, status: 'resilie' });
  await makeContract({ branch: 'lca', client_id: clientId, annual_premium: 800 });

  const action = await findAction(clientId, 'manque_prevoyance');
  assert.ok(action);
  assert.equal(action.priority, 'basse', 'seul le contrat LCA actif (800) compte, pas le LAMal résilié (10\'000)');
});
