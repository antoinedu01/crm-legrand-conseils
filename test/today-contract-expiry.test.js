// Tests d'intégration du Lot 2 (développement de portefeuille) :
// échéances de contrat rendues actionnables dans le plan du jour, et
// horodatage de `contracts.review_last_date` uniquement quand un résultat
// est explicitement logué sur une action de type `echeance_contrat`.
// Base de test isolée dans un dossier temporaire (CRM_DATA_DIR), comme
// test/today-portfolio-development.test.js.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-echeances-'));
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
    .send({ email: 'test-echeances@exemple.ch', name: 'Testeur', password: PASSWORD });
  assert.equal(res.status, 200);
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
});

function isoDaysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function makeClient(lastName) {
  const res = await auth(request(app).post('/api/clients')).send({
    first_name: 'Test', last_name: lastName, status: 'client',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

async function makeContract({ client_id, end_date, status = 'actif', branch = 'lamal' }) {
  const res = await auth(request(app).post('/api/contracts')).send({
    client_id, company_id: 1, branch, annual_premium: 3000, status, end_date,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

async function findAction(clientId, type) {
  const plan = await auth(request(app).get('/api/today'));
  assert.equal(plan.status, 200);
  return plan.body.find((a) => a.client_id === clientId && a.type === type);
}

test('echeance_contrat — contrat à 20 jours de l’échéance : priorité haute', async () => {
  const clientId = await makeClient('EcheanceProche');
  const contractId = await makeContract({ client_id: clientId, end_date: isoDaysFromNow(20) });

  const action = await findAction(clientId, 'echeance_contrat');
  assert.ok(action, 'le contrat à 20 jours de l’échéance apparaît dans le plan du jour');
  assert.equal(action.priority, 'haute', 'moins de 30 jours -> priorité haute');
  assert.equal(action.contract_id, contractId);
  assert.ok(action.reason.includes('20 jours'), action.reason);
});

test('echeance_contrat — contrat à 60 jours de l’échéance : priorité normale', async () => {
  const clientId = await makeClient('EcheanceMoyenne');
  await makeContract({ client_id: clientId, end_date: isoDaysFromNow(60) });

  const action = await findAction(clientId, 'echeance_contrat');
  assert.ok(action, 'le contrat à 60 jours de l’échéance apparaît');
  assert.equal(action.priority, 'normale', 'entre 30 et 90 jours -> priorité normale');
});

test('echeance_contrat — contrat à 120 jours (hors fenêtre 90 jours) : n’apparaît pas', async () => {
  const clientId = await makeClient('EcheanceLointaine');
  await makeContract({ client_id: clientId, end_date: isoDaysFromNow(120) });

  const action = await findAction(clientId, 'echeance_contrat');
  assert.equal(action, undefined, 'hors de la fenêtre de 90 jours, aucun signal');
});

test('echeance_contrat — contrat dont l’échéance est déjà dépassée : priorité haute, texte "dépassée"', async () => {
  const clientId = await makeClient('EcheanceDepassee');
  await makeContract({ client_id: clientId, end_date: isoDaysFromNow(-10) });

  const action = await findAction(clientId, 'echeance_contrat');
  assert.ok(action, 'un contrat déjà échu et toujours actif est signalé');
  assert.equal(action.priority, 'haute');
  assert.ok(action.reason.includes('dépassée depuis 10 jours'), action.reason);
});

test('echeance_contrat — un contrat résilié n’apparaît jamais, même proche de la date de fin', async () => {
  const clientId = await makeClient('EcheanceResiliee');
  await makeContract({ client_id: clientId, end_date: isoDaysFromNow(10), status: 'resilie' });

  const action = await findAction(clientId, 'echeance_contrat');
  assert.equal(action, undefined, 'seuls les contrats actifs sont concernés');
});

test('résultat logué sur echeance_contrat : review_last_date est horodaté sur ce contrat, review_next_date n’est jamais touché', async () => {
  const clientId = await makeClient('EcheanceResultat');
  const contractId = await makeContract({ client_id: clientId, end_date: isoDaysFromNow(15) });

  const before = await auth(request(app).get(`/api/contracts?client_id=${clientId}`));
  const beforeContract = before.body.find((c) => c.id === contractId);
  assert.equal(beforeContract.review_last_date, null, 'review_last_date est vide avant tout traitement');
  assert.equal(beforeContract.review_next_date, null, 'review_next_date reste vide, comme avant ce lot');

  const action = await findAction(clientId, 'echeance_contrat');
  assert.ok(action);
  const result = await auth(request(app).post('/api/today/result')).send({
    action_key: action.key, action_type: action.type, client_id: clientId,
    contract_id: contractId, result: 'a_relancer', note: 'À rappeler avant l’échéance',
  });
  assert.equal(result.status, 200);

  const after = await auth(request(app).get(`/api/contracts?client_id=${clientId}`));
  const afterContract = after.body.find((c) => c.id === contractId);
  const todayStr = new Date().toISOString().slice(0, 10);
  assert.equal(afterContract.review_last_date, todayStr, 'review_last_date est horodaté à aujourd’hui');
  assert.equal(afterContract.review_next_date, null, 'aucune planification automatique : review_next_date reste vide');
});

test('l’action traitée ne réapparaît pas immédiatement (dé-doublonnage 30 jours)', async () => {
  const clientId = await makeClient('EcheanceDedoublonnage');
  const contractId = await makeContract({ client_id: clientId, end_date: isoDaysFromNow(5) });

  const action = await findAction(clientId, 'echeance_contrat');
  assert.ok(action);
  await auth(request(app).post('/api/today/result')).send({
    action_key: action.key, action_type: action.type, client_id: clientId,
    contract_id: contractId, result: 'fait',
  });
  const after = await findAction(clientId, 'echeance_contrat');
  assert.equal(after, undefined, 'l’action traitée ne réapparaît pas avant la fenêtre de dé-doublonnage');
});

test('review_last_date n’est jamais touché pour un autre type d’action, même avec un contract_id fourni', async () => {
  const clientId = await makeClient('AutreTypeAction');
  const contractId = await makeContract({ client_id: clientId, end_date: isoDaysFromNow(500) }); // hors fenêtre échéance

  // Une action d'un autre type porte parfois aussi un contract_id
  // (ex. anniversaire_contrat) — le garde-fou doit être sur action_type,
  // jamais sur la simple présence de contract_id dans la requête.
  const result = await auth(request(app).post('/api/today/result')).send({
    action_key: `anniversaire:${contractId}`, action_type: 'anniversaire_contrat',
    client_id: clientId, contract_id: contractId, result: 'fait',
  });
  assert.equal(result.status, 200);

  const after = await auth(request(app).get(`/api/contracts?client_id=${clientId}`));
  const afterContract = after.body.find((c) => c.id === contractId);
  assert.equal(afterContract.review_last_date, null, 'seul action_type = echeance_contrat écrit review_last_date');
});
