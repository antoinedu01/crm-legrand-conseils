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

test('bloc 3 : plan d’action quotidien — génération, résultat et enchaînement', async () => {
  // un nouveau prospect urgent doit apparaître dans le plan du jour
  const p = await auth(request(app).post('/api/clients')).send({
    first_name: 'Nora', last_name: 'DuJour', phone: '079 555 66 77',
    email: 'nora.dujour@exemple.ch', status: 'prospect', force: true,
  });
  await auth(request(app).put(`/api/clients/${p.body.id}/lead`)).send({
    main_need: 'LAMal / caisse maladie', urgent: 1,
  });

  const plan = await auth(request(app).get('/api/today'));
  assert.equal(plan.status, 200);
  const action = plan.body.find((a) => a.client_id === p.body.id && a.type === 'nouveau_prospect');
  assert.ok(action, 'le nouveau prospect est dans le plan du jour');
  assert.equal(action.priority, 'haute');
  assert.ok(action.reason.length > 5 && action.objective.length > 5, 'raison et objectif présents');

  // résultat « rendez-vous pris » : tâche créée + prospect passé à l'étape RDV
  const result = await auth(request(app).post('/api/today/result')).send({
    action_key: action.key, action_type: action.type,
    client_id: p.body.id, result: 'rdv_pris', note: 'RDV jeudi 14h',
  });
  assert.equal(result.status, 200);
  assert.ok(result.body.next.includes('RDV'), 'la prochaine étape est expliquée');

  const detail = await auth(request(app).get(`/api/clients/${p.body.id}`));
  assert.equal(detail.body.lead.pipeline_stage, 'rdv');
  assert.ok(detail.body.tasks.some((t) => t.title.includes('Préparer')), 'tâche de préparation créée');
  assert.ok(detail.body.activities.some((a) => a.content.includes('Rendez-vous pris')), 'activité journalisée');

  // l'action traitée ne réapparaît plus ; l'action « confirmer le RDV » prend le relais
  const plan2 = await auth(request(app).get('/api/today'));
  assert.ok(!plan2.body.find((a) => a.key === action.key), 'l’action traitée a disparu');

  // résultat invalide refusé
  const bad = await auth(request(app).post('/api/today/result')).send({
    action_key: 'x', result: 'nimporte',
  });
  assert.equal(bad.status, 400);
});

test('bloc 3 : une tâche en retard apparaît en priorité haute et « fait » la termine', async () => {
  const t = await auth(request(app).post('/api/tasks')).send({
    title: 'Tâche oubliée', due_date: '2026-01-05', priority: 'normale',
  });
  const plan = await auth(request(app).get('/api/today'));
  const action = plan.body.find((a) => a.task_id === t.body.id);
  assert.ok(action, 'la tâche en retard est dans le plan');
  assert.equal(action.priority, 'haute');

  await auth(request(app).post('/api/today/result')).send({
    action_key: action.key, action_type: action.type, task_id: t.body.id, result: 'fait',
  });
  const tasks = await auth(request(app).get('/api/tasks?status=terminee'));
  assert.ok(tasks.body.some((x) => x.id === t.body.id), 'la tâche est terminée');
});

test('formulaire public du site : CORS, consentement, anti-robot, doublons', async () => {
  const SITE = 'https://site-de-test.ch';
  // préflight CORS accepté pour l'origine du site
  const pre = await request(app).options('/api/public/lead').set('Origin', SITE);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers['access-control-allow-origin'], SITE);

  // origine inconnue refusée
  const badOrigin = await request(app).post('/api/public/lead')
    .set('Origin', 'https://autre-site.example').send({});
  assert.equal(badOrigin.status, 403);

  // sans consentement → refusé
  const noConsent = await request(app).post('/api/public/lead').set('Origin', SITE).send({
    first_name: 'Lia', last_name: 'DuSite', phone: '079 222 33 44',
  });
  assert.equal(noConsent.status, 400);

  // champ-piège rempli → ok silencieux, rien créé
  const before = (await auth(request(app).get('/api/clients'))).body.length;
  const bot = await request(app).post('/api/public/lead').set('Origin', SITE).send({
    first_name: 'Bot', last_name: 'Spam', phone: '000', consent: 1, website: 'http://spam',
  });
  assert.equal(bot.status, 200);
  const afterBot = (await auth(request(app).get('/api/clients'))).body.length;
  assert.equal(afterBot, before, 'aucun dossier créé pour le robot');

  // lead valide → prospect créé avec canal site + consentement horodaté
  const ok = await request(app).post('/api/public/lead').set('Origin', SITE).send({
    first_name: 'Lia', last_name: 'DuSite', phone: '079 222 33 44', canton: 'vd',
    main_need: 'LAMal / caisse maladie', contact_pref: 'Soir (17h-19h)', consent: 1,
    consent_text_version: 'v1-2026', tool: 'comparateur_lamal',
    details: 'Canton: Vaud · Franchise: 2500 · Modèle: Telmed',
    source_page: '/comparateur-lamal',
  });
  assert.equal(ok.status, 201);
  const clients = (await auth(request(app).get('/api/clients?q=DuSite'))).body;
  assert.equal(clients.length, 1);
  const detail = (await auth(request(app).get(`/api/clients/${clients[0].id}`))).body;
  assert.equal(detail.canton, 'VD');
  assert.equal(detail.lead.main_need, 'LAMal / caisse maladie');
  assert.ok(detail.activities.some((a) => a.content.includes('comparateur_lamal')));

  // même téléphone → pas de doublon, tâche de recontact créée
  const dup = await request(app).post('/api/public/lead').set('Origin', SITE).send({
    first_name: 'Lia', last_name: 'DuSite', phone: '+41 79 222 33 44', consent: 1, tool: 'resiliation',
  });
  assert.equal(dup.status, 201);
  const clients2 = (await auth(request(app).get('/api/clients?q=DuSite'))).body;
  assert.equal(clients2.length, 1, 'pas de second dossier');
  const detail2 = (await auth(request(app).get(`/api/clients/${clients[0].id}`))).body;
  assert.ok(detail2.tasks.some((t) => t.title.includes('nouvelle demande via le site')));
});

// --- Lot B : détails LAMal (contract_lamal) --------------------------

test('LAMal — création sans bloc lamal, puis avec détails valides, et lecture', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Ines', last_name: 'Lamal', status: 'client',
  });

  const noLamal = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 3600,
  });
  assert.equal(noLamal.status, 201);
  let list = await auth(request(app).get('/api/contracts'));
  assert.equal(list.body.find((c) => c.id === noLamal.body.id).lamal, null);

  const withLamal = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 4200,
    lamal: { care_model: 'telmed', deductible: 2500, accident_coverage: false, canton: 'ge', tariff_region: '1' },
  });
  assert.equal(withLamal.status, 201);
  list = await auth(request(app).get('/api/contracts'));
  assert.deepEqual(list.body.find((c) => c.id === withLamal.body.id).lamal, {
    care_model: 'telmed', deductible: 2500, accident_coverage: false, canton: 'GE', tariff_region: '1',
  });
});

test('LAMal — les validations rejettent care_model, franchise, canton, type et branche invalides', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Marc', last_name: 'Validation', status: 'client',
  });
  const base = { client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 3000 };

  const badCareModel = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lamal: { care_model: 'inexistant', deductible: 300 } });
  assert.equal(badCareModel.status, 400);

  const badDeductible = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lamal: { care_model: 'standard', deductible: 1234 } });
  assert.equal(badDeductible.status, 400);

  const badCanton = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lamal: { care_model: 'standard', deductible: 300, canton: 'ZZ' } });
  assert.equal(badCanton.status, 400);

  const badAccident = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lamal: { care_model: 'standard', deductible: 300, accident_coverage: 'oui' } });
  assert.equal(badAccident.status, 400);

  const wrongBranch = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'vie_3a', annual_premium: 3000,
    lamal: { care_model: 'standard', deductible: 300 },
  });
  assert.equal(wrongBranch.status, 400);
});

test('LAMal — rollback complet : aucun contrat créé si le bloc lamal est invalide', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Rollback', last_name: 'Test', status: 'client',
  });
  const before = (await auth(request(app).get('/api/contracts'))).body.length;
  const res = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 3000,
    lamal: { care_model: 'invalide', deductible: 300 },
  });
  assert.equal(res.status, 400);
  const after = (await auth(request(app).get('/api/contracts'))).body.length;
  assert.equal(after, before, 'aucun contrat créé si le bloc lamal est invalide');
});

test('LAMal — mise à jour crée puis modifie les détails ; changement de branche encadré', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Update', last_name: 'Lamal', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 3000,
  });
  const id = created.body.id;

  const createDetails = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ lamal: { care_model: 'standard', deductible: 300, accident_coverage: true, canton: 'VD' } });
  assert.equal(createDetails.status, 200);
  let row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.lamal.deductible, 300);
  assert.equal(row.lamal.accident_coverage, true);

  const updateDetails = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ lamal: { care_model: 'hmo', deductible: 2500, accident_coverage: false, canton: 'VD' } });
  assert.equal(updateDetails.status, 200);
  row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.lamal.care_model, 'hmo');
  assert.equal(row.lamal.deductible, 2500);

  const blocked = await auth(request(app).put(`/api/contracts/${id}`)).send({ branch: 'vie_3a' });
  assert.equal(blocked.status, 400);

  const allowed = await auth(request(app).put(`/api/contracts/${id}`)).send({ branch: 'vie_3a', lamal: null });
  assert.equal(allowed.status, 200);
  row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.branch, 'vie_3a');
  assert.equal(row.lamal, null);
});

test('LAMal — suppression explicite des détails via lamal: null', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Suppr', last_name: 'Lamal', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 3000,
    lamal: { care_model: 'standard', deductible: 300 },
  });
  const del = await auth(request(app).put(`/api/contracts/${created.body.id}`)).send({ lamal: null });
  assert.equal(del.status, 200);
  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === created.body.id);
  assert.equal(row.lamal, null);
});

test('LAMal — la suppression du contrat supprime automatiquement contract_lamal (CASCADE)', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Cascade', last_name: 'Lamal', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 1200,
    lamal: { care_model: 'standard', deductible: 300 },
  });
  const del = await auth(request(app).delete(`/api/contracts/${created.body.id}`));
  assert.equal(del.status, 200);
  const list = await auth(request(app).get('/api/contracts'));
  assert.ok(!list.body.find((c) => c.id === created.body.id), 'le contrat a bien été supprimé');
});

test('LAMal — non-régression de la génération de commission sur un contrat enrichi', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Commission', last_name: 'Lamal', status: 'client',
  });
  const res = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 3000,
    acq_commission_rate: 3, status: 'actif',
    lamal: { care_model: 'standard', deductible: 300 },
  });
  assert.equal(res.status, 201);
  const commissions = await auth(request(app).get('/api/commissions'));
  const acq = commissions.body.find((c) => c.contract_id === res.body.id && c.type === 'acquisition');
  assert.ok(acq, 'commission d’acquisition toujours générée automatiquement pour un contrat LAMal enrichi');
  assert.equal(acq.amount, 90);
});
