// Tests d'intégration de l'API (node:test + supertest).
// La base de test est isolée dans un dossier temporaire (CRM_DATA_DIR).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'));
process.env.NODE_ENV = 'test';

const { default: app } = await import('../server/app.js');

const PASSWORD = 'MotDePasseDeTest!42';
let cookie = '';

function auth(req) {
  return req.set('Cookie', cookie);
}

before(async () => {
  const res = await request(app)
    .post('/api/auth/setup')
    .send({ email: 'test@exemple.ch', name: 'Testeur', password: PASSWORD });
  assert.equal(res.status, 200);
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
});

test('l’accès sans session est refusé (401)', async () => {
  const res = await request(app).get('/api/clients');
  assert.equal(res.status, 401);
});

test('la connexion échoue avec un mauvais mot de passe', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'test@exemple.ch', password: 'faux-mot-de-passe' });
  assert.equal(res.status, 401);
});

test('la connexion réussit et la session persiste', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'test@exemple.ch', password: PASSWORD });
  assert.equal(res.status, 200);
  const c = res.headers['set-cookie'].map((x) => x.split(';')[0]).join('; ');
  const status = await request(app).get('/api/auth/status').set('Cookie', c);
  assert.equal(status.body.authenticated, true);
});

test('une requête de modification intersite est bloquée (CSRF)', async () => {
  const res = await auth(request(app).post('/api/clients'))
    .set('Origin', 'https://site-malveillant.example')
    .send({ last_name: 'Intrus' });
  assert.equal(res.status, 403);
});

test('création d’un client avec validation', async () => {
  const bad = await auth(request(app).post('/api/clients')).send({
    last_name: 'Duval', email: 'pas-un-email',
  });
  assert.equal(bad.status, 400);

  const ok = await auth(request(app).post('/api/clients')).send({
    first_name: 'Anne', last_name: 'Duval', email: 'anne.duval@exemple.ch',
    phone: '079 123 45 67', status: 'prospect', consent_data: 1, consent_date: '2026-07-01',
  });
  assert.equal(ok.status, 201);
  assert.ok(ok.body.id);
});

test('les doublons e-mail/téléphone sont détectés (409), forçables', async () => {
  const dup = await auth(request(app).post('/api/clients')).send({
    first_name: 'Annie', last_name: 'Duvale', email: 'ANNE.DUVAL@exemple.ch',
  });
  assert.equal(dup.status, 409);
  assert.ok(dup.body.duplicates.length >= 1);

  // même téléphone sous un autre format (+41 vs 079)
  const dupPhone = await auth(request(app).post('/api/clients')).send({
    last_name: 'Autre', phone: '+41 79 123 45 67',
  });
  assert.equal(dupPhone.status, 409);

  const forced = await auth(request(app).post('/api/clients')).send({
    last_name: 'Duvale-bis', email: 'anne.duval@exemple.ch', force: true,
  });
  assert.equal(forced.status, 201);
});

let contractId;
test('création d’un contrat : commission d’acquisition automatique + avertissements LSA', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Paul', last_name: 'Roch', status: 'client',
  });
  const res = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'vie_3a',
    annual_premium: 7056, acq_commission_rate: 4, rec_commission_rate: 1,
    status: 'actif', start_date: '2026-01-01',
  });
  assert.equal(res.status, 201);
  contractId = res.body.id;
  // mandat non signé + info LSA absente + consentement absent → 3 avertissements
  assert.equal(res.body.warnings.length, 3);

  const commissions = await auth(request(app).get('/api/commissions?year=2026'));
  const acq = commissions.body.find((c) => c.contract_id === contractId && c.type === 'acquisition');
  assert.ok(acq, 'commission d’acquisition créée automatiquement');
  assert.equal(acq.amount, 282.24);
});

test('un taux de commission invalide est refusé', async () => {
  const res = await auth(request(app).post('/api/contracts')).send({
    client_id: 1, company_id: 1, branch: 'vie_3a', annual_premium: 100, acq_commission_rate: 250,
  });
  assert.equal(res.status, 400);
});

test('génération des commissions récurrentes : pas de doublon d’une exécution à l’autre', async () => {
  const first = await auth(request(app).post('/api/commissions/generate-recurring')).send({ year: 2026 });
  assert.equal(first.status, 200);
  assert.ok(first.body.created >= 1);
  const second = await auth(request(app).post('/api/commissions/generate-recurring')).send({ year: 2026 });
  assert.equal(second.body.created, 0);
});

test('export nLPD du dossier client', async () => {
  const res = await auth(request(app).get('/api/clients/1/export'));
  assert.equal(res.status, 200);
  assert.ok(res.body.base_legale.includes('art. 25'));
  assert.ok(Array.isArray(res.body.contrats));
});

test('anonymisation : données personnelles effacées, dossier verrouillé', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Zoé', last_name: 'Efface', email: 'zoe@exemple.ch', avs_number: '756.1234.5678.90',
  });
  const id = client.body.id;
  const anon = await auth(request(app).post(`/api/clients/${id}/anonymize`));
  assert.equal(anon.status, 200);
  const detail = await auth(request(app).get(`/api/clients/${id}`));
  assert.equal(detail.body.email, null);
  assert.equal(detail.body.avs_number, null);
  assert.equal(detail.body.status, 'anonymise');
  const edit = await auth(request(app).put(`/api/clients/${id}`)).send({ last_name: 'Retour' });
  assert.equal(edit.status, 403);
});

test('le journal d’audit trace les actions sensibles', async () => {
  const res = await auth(request(app).get('/api/compliance/audit-log?q=anonymisation'));
  assert.equal(res.status, 200);
  assert.ok(res.body.length >= 1);
});

test('la sauvegarde produit un fichier SQLite', async () => {
  const res = await auth(request(app).get('/api/backup')).buffer(true).parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.subarray(0, 15).toString(), 'SQLite format 3');
});

test('un contrat avec commission payée ne peut pas être supprimé', async () => {
  const commissions = await auth(request(app).get('/api/commissions'));
  const acq = commissions.body.find((c) => c.contract_id === contractId && c.type === 'acquisition');
  await auth(request(app).put(`/api/commissions/${acq.id}`)).send({ status: 'payee' });
  const del = await auth(request(app).delete(`/api/contracts/${contractId}`));
  assert.equal(del.status, 400);
  assert.ok(del.body.error.includes('958f'));
});

test('cycle complet 2FA : activation, connexion en deux étapes, désactivation', async () => {
  const { totpCode } = await import('../server/totp.js');
  // activation
  const setup = await auth(request(app).post('/api/auth/2fa/setup'));
  assert.equal(setup.status, 200);
  const setupCookie = cookie; // même session
  const badEnable = await request(app).post('/api/auth/2fa/enable')
    .set('Cookie', setupCookie).send({ code: '000000' });
  assert.equal(badEnable.status, 400);
  const enable = await request(app).post('/api/auth/2fa/enable')
    .set('Cookie', setupCookie).send({ code: totpCode(setup.body.secret) });
  assert.equal(enable.status, 200);

  // connexion : le mot de passe seul ne suffit plus
  const login = await request(app).post('/api/auth/login')
    .send({ email: 'test@exemple.ch', password: PASSWORD });
  assert.equal(login.status, 200);
  assert.equal(login.body.requires2fa, true);
  const c2 = login.headers['set-cookie'].map((x) => x.split(';')[0]).join('; ');
  const st = await request(app).get('/api/auth/status').set('Cookie', c2);
  assert.equal(st.body.authenticated, false, 'pas de session avant le code');

  const badCode = await request(app).post('/api/auth/login/2fa')
    .set('Cookie', c2).send({ code: '000000' });
  assert.equal(badCode.status, 401);
  const good = await request(app).post('/api/auth/login/2fa')
    .set('Cookie', c2).send({ code: totpCode(setup.body.secret) });
  assert.equal(good.status, 200);
  const c3 = good.headers['set-cookie'].map((x) => x.split(';')[0]).join('; ');
  const st2 = await request(app).get('/api/auth/status').set('Cookie', c3);
  assert.equal(st2.body.authenticated, true);

  // désactivation (exige un code valide)
  const disable = await request(app).post('/api/auth/2fa/disable')
    .set('Cookie', c3).send({ code: totpCode(setup.body.secret) });
  assert.equal(disable.status, 200);
});

test('bloc 1 : les 14 canaux d’acquisition sont pré-remplis', async () => {
  const res = await auth(request(app).get('/api/channels'));
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 14);
  assert.ok(res.body.some((c) => c.key === 'recommandations'));
});

test('bloc 1 : origine d’un prospect (canal, parrain, pipeline) et statistiques du canal', async () => {
  const year = new Date().getFullYear();
  const channels = await auth(request(app).get('/api/channels'));
  const reco = channels.body.find((c) => c.key === 'recommandations');

  const prospect = await auth(request(app).post('/api/clients')).send({
    first_name: 'Léa', last_name: 'Nouvelle', status: 'prospect', force: true,
  });
  // upsert : création puis mise à jour
  const put1 = await auth(request(app).put(`/api/clients/${prospect.body.id}/lead`))
    .send({ channel_id: reco.id, referrer_client_id: 1, main_need: 'Prévoyance 3a' });
  assert.equal(put1.status, 200);
  const put2 = await auth(request(app).put(`/api/clients/${prospect.body.id}/lead`))
    .send({ pipeline_stage: 'contacte' });
  assert.equal(put2.status, 200);

  // étape inconnue et auto-parrainage refusés
  const badStage = await auth(request(app).put(`/api/clients/${prospect.body.id}/lead`))
    .send({ pipeline_stage: 'inexistant' });
  assert.equal(badStage.status, 400);
  const selfRef = await auth(request(app).put(`/api/clients/${prospect.body.id}/lead`))
    .send({ referrer_client_id: prospect.body.id });
  assert.equal(selfRef.status, 400);

  // la fiche client renvoie l'origine complète
  const detail = await auth(request(app).get(`/api/clients/${prospect.body.id}`));
  assert.equal(detail.body.lead.pipeline_stage, 'contacte');
  assert.equal(detail.body.lead.channel_name, 'Recommandations de clients');
  assert.ok(detail.body.lead.referrer_name);

  // saisie d'un coût + statistiques agrégées
  const month = `${year}-01`;
  const cost = await auth(request(app).post(`/api/channels/${reco.id}/costs`))
    .send({ month, amount: 120.5, notes: 'cartes de parrainage' });
  assert.equal(cost.status, 201);
  const badCost = await auth(request(app).post(`/api/channels/${reco.id}/costs`))
    .send({ month: 'janvier', amount: 10 });
  assert.equal(badCost.status, 400);

  const stats = await auth(request(app).get(`/api/channels?year=${year}`));
  const recoStats = stats.body.find((c) => c.id === reco.id);
  assert.ok(recoStats.leads_year >= 1);
  assert.equal(recoStats.costs_year, 120.5);
});

test('bloc 2 : scoring avec raisons affichées, classement et réglages', async () => {
  const channels = await auth(request(app).get('/api/channels'));
  const reco = channels.body.find((c) => c.key === 'recommandations');

  const p = await auth(request(app).post('/api/clients')).send({
    first_name: 'Hugo', last_name: 'Score', email: 'hugo.score@exemple.ch',
    phone: '078 111 22 33', status: 'prospect', force: true,
  });
  await auth(request(app).put(`/api/clients/${p.body.id}/lead`)).send({
    channel_id: reco.id, referrer_client_id: 1, main_need: 'Incapacité de gain',
    urgent: 1, pipeline_stage: 'rdv', age_range: '26-35', work_situation: 'Salarié(e)',
    contact_pref: 'Soir (17h-19h)',
  });
  await auth(request(app).post(`/api/clients/${p.body.id}/activities`))
    .send({ type: 'appel', content: 'Premier appel très positif.' });

  const list = await auth(request(app).get('/api/prospects'));
  assert.equal(list.status, 200);
  const hugo = list.body.find((x) => x.id === p.body.id);
  assert.ok(hugo, 'le prospect apparaît dans le pipeline');
  // recommandé 20 + besoin 15 + urgent 20 + rdv 20 + coordonnées 10 + profil 10 + plage 5 + échange récent 10 = 110
  assert.equal(hugo.score, 110);
  assert.equal(hugo.classement, 'prioritaire');
  assert.ok(hugo.reasons.length >= 7, 'les raisons du score sont listées');
  assert.ok(hugo.reasons.some((r) => r.label.includes('Recommandé')));

  // le tri place le meilleur score en premier
  assert.equal(list.body[0].id, hugo.id);

  // réglage d'une règle : désactiver « urgent » fait baisser le score de 20
  const rules = await auth(request(app).get('/api/prospects/scoring-rules'));
  const urgentRule = rules.body.find((r) => r.key === 'urgent');
  await auth(request(app).put(`/api/prospects/scoring-rules/${urgentRule.id}`)).send({ active: 0 });
  const list2 = await auth(request(app).get('/api/prospects'));
  assert.equal(list2.body.find((x) => x.id === p.body.id).score, 90);
  await auth(request(app).put(`/api/prospects/scoring-rules/${urgentRule.id}`)).send({ active: 1 });

  // points invalides refusés
  const bad = await auth(request(app).put(`/api/prospects/scoring-rules/${urgentRule.id}`)).send({ points: 5000 });
  assert.equal(bad.status, 400);
});
