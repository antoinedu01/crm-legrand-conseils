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

// --- Lot C : détails LCA (contract_lca) -------------------------------

test('LCA — création sans bloc lca, puis avec détails valides, et lecture', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Chloe', last_name: 'Lca', status: 'client',
  });

  const noLca = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 1200,
  });
  assert.equal(noLca.status, 201);
  let list = await auth(request(app).get('/api/contracts'));
  assert.equal(list.body.find((c) => c.id === noLca.body.id).lca, null);

  const withLca = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900,
    lca: {
      underwriting_status: 'acceptee_avec_reserve', waiting_period_days: 90,
      administrative_reservation_status: 'active', reservation_notes: 'genou droit, 3 ans',
      exclusions_status: 'presentes', exclusions_notes: 'sports à risque',
    },
  });
  assert.equal(withLca.status, 201);
  list = await auth(request(app).get('/api/contracts'));
  assert.deepEqual(list.body.find((c) => c.id === withLca.body.id).lca, {
    underwriting_status: 'acceptee_avec_reserve', waiting_period_days: 90,
    administrative_reservation_status: 'active', reservation_notes: 'genou droit, 3 ans',
    exclusions_status: 'presentes', exclusions_notes: 'sports à risque',
  });
});

test('LCA — les validations rejettent enum, type, borne, longueur et branche invalides', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Val', last_name: 'Lca', status: 'client',
  });
  const base = { client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900 };

  const badEnum = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lca: { underwriting_status: 'inexistant' } });
  assert.equal(badEnum.status, 400);

  const badType = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lca: { waiting_period_days: 'abc' } });
  assert.equal(badType.status, 400);

  const badRange = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lca: { waiting_period_days: -5 } });
  assert.equal(badRange.status, 400);

  const tooLong = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lca: { reservation_notes: 'x'.repeat(201) } });
  assert.equal(tooLong.status, 400);

  const wrongBranch = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 900,
    lca: { underwriting_status: 'acceptee' },
  });
  assert.equal(wrongBranch.status, 400);
});

test('LCA — rollback complet : aucun contrat créé si le bloc lca est invalide', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Rollback', last_name: 'Lca', status: 'client',
  });
  const before = (await auth(request(app).get('/api/contracts'))).body.length;
  const res = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900,
    lca: { underwriting_status: 'invalide' },
  });
  assert.equal(res.status, 400);
  const after = (await auth(request(app).get('/api/contracts'))).body.length;
  assert.equal(after, before, 'aucun contrat créé si le bloc lca est invalide');
});

test('LCA — rollback : une mise à jour invalide n’altère pas les détails existants', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Rollback', last_name: 'Update', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900,
    lca: { underwriting_status: 'acceptee', waiting_period_days: 30 },
  });
  const id = created.body.id;

  const bad = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ lca: { underwriting_status: 'invalide' } });
  assert.equal(bad.status, 400);

  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.lca.underwriting_status, 'acceptee', 'les détails existants ne doivent pas être altérés');
  assert.equal(row.lca.waiting_period_days, 30);
});

test('LCA — mise à jour crée puis modifie les détails ; changement de branche encadré', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Update', last_name: 'Lca', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900,
  });
  const id = created.body.id;

  const createDetails = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ lca: { underwriting_status: 'questionnaire_transmis' } });
  assert.equal(createDetails.status, 200);
  let row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.lca.underwriting_status, 'questionnaire_transmis');
  assert.equal(row.lca.exclusions_status, 'aucune', 'valeur par défaut SQL appliquée aux champs non fournis');

  const updateDetails = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ lca: { underwriting_status: 'acceptee', exclusions_status: 'presentes', exclusions_notes: 'tabac' } });
  assert.equal(updateDetails.status, 200);
  row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.lca.underwriting_status, 'acceptee');
  assert.equal(row.lca.exclusions_status, 'presentes');
  assert.equal(row.lca.exclusions_notes, 'tabac');

  const blocked = await auth(request(app).put(`/api/contracts/${id}`)).send({ branch: 'vie_3a' });
  assert.equal(blocked.status, 400);

  const allowed = await auth(request(app).put(`/api/contracts/${id}`)).send({ branch: 'vie_3a', lca: null });
  assert.equal(allowed.status, 200);
  row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.branch, 'vie_3a');
  assert.equal(row.lca, null);
});

test('LCA — suppression explicite des détails via lca: null', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Suppr', last_name: 'Lca', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900,
    lca: { underwriting_status: 'acceptee' },
  });
  const del = await auth(request(app).put(`/api/contracts/${created.body.id}`)).send({ lca: null });
  assert.equal(del.status, 200);
  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === created.body.id);
  assert.equal(row.lca, null);
});

test('LCA — la suppression du contrat supprime automatiquement contract_lca (CASCADE)', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Cascade', last_name: 'Lca', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900,
    lca: { underwriting_status: 'acceptee' },
  });
  const del = await auth(request(app).delete(`/api/contracts/${created.body.id}`));
  assert.equal(del.status, 200);
  const list = await auth(request(app).get('/api/contracts'));
  assert.ok(!list.body.find((c) => c.id === created.body.id), 'le contrat a bien été supprimé');
});

test('LCA — coexistence avec LAMal sans régression, et refus d’un bloc combiné incohérent', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Coexist', last_name: 'Test', status: 'client',
  });

  // Un contrat LAMal enrichi continue de fonctionner normalement.
  const lamalContract = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 3000,
    lamal: { care_model: 'standard', deductible: 300 },
  });
  assert.equal(lamalContract.status, 201);

  // Un contrat LCA enrichi coexiste sans interférence.
  const lcaContract = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900,
    lca: { underwriting_status: 'acceptee' },
  });
  assert.equal(lcaContract.status, 201);

  const list = await auth(request(app).get('/api/contracts'));
  const lamalRow = list.body.find((c) => c.id === lamalContract.body.id);
  const lcaRow = list.body.find((c) => c.id === lcaContract.body.id);
  assert.ok(lamalRow.lamal, 'le contrat LAMal conserve ses détails');
  assert.equal(lamalRow.lca, null);
  assert.ok(lcaRow.lca, 'le contrat LCA conserve ses détails');
  assert.equal(lcaRow.lamal, null);

  // Une même requête combinant lamal et lca non nuls est refusée quelle que
  // soit la branche choisie (aucune branche n'est compatible avec les deux).
  const combinedOnLamal = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 3000,
    lamal: { care_model: 'standard', deductible: 300 },
    lca: { underwriting_status: 'acceptee' },
  });
  assert.equal(combinedOnLamal.status, 400);

  const combinedOnLca = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900,
    lamal: { care_model: 'standard', deductible: 300 },
    lca: { underwriting_status: 'acceptee' },
  });
  assert.equal(combinedOnLca.status, 400);
});

test('LCA — non-régression de la génération de commission sur un contrat enrichi', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Commission', last_name: 'Lca', status: 'client',
  });
  const res = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900,
    acq_commission_rate: 5, status: 'actif',
    lca: { underwriting_status: 'acceptee' },
  });
  assert.equal(res.status, 201);
  const commissions = await auth(request(app).get('/api/commissions'));
  const acq = commissions.body.find((c) => c.contract_id === res.body.id && c.type === 'acquisition');
  assert.ok(acq, 'commission d’acquisition toujours générée automatiquement pour un contrat LCA enrichi');
  assert.equal(acq.amount, 45);
});

test('LCA — les entrées d’audit création/modification/suppression sont journalisées', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Audit', last_name: 'Lca', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900,
    lca: { underwriting_status: 'acceptee' },
  });
  await auth(request(app).put(`/api/contracts/${created.body.id}`))
    .send({ lca: { underwriting_status: 'refusee' } });
  await auth(request(app).put(`/api/contracts/${created.body.id}`)).send({ lca: null });

  const log = await auth(request(app).get('/api/compliance/audit-log?q=détails LCA'));
  assert.equal(log.status, 200);
  assert.ok(log.body.some((l) => l.action === 'création détails LCA'));
  assert.ok(log.body.some((l) => l.action === 'modification détails LCA'));
  assert.ok(log.body.some((l) => l.action === 'suppression détails LCA'));
});

test('Vie — création sans bloc life, puis avec détails valides, et lecture', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Chloe', last_name: 'Vie', status: 'client',
  });

  const noLife = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'vie_3a', annual_premium: 1200,
  });
  assert.equal(noLife.status, 201);
  let list = await auth(request(app).get('/api/contracts'));
  assert.equal(list.body.find((c) => c.id === noLife.body.id).life, null);

  const withLife = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'vie_3a', annual_premium: 2400,
    life: {
      component_type: 'mixte', insured_death_capital: 100000, insured_disability_capital: 50000,
      insured_rent: 0, surrender_value: 0, premium_waiver: true,
      indexation_type: 'fixe', policy_term_years: 20,
    },
  });
  assert.equal(withLife.status, 201);
  list = await auth(request(app).get('/api/contracts'));
  assert.deepEqual(list.body.find((c) => c.id === withLife.body.id).life, {
    component_type: 'mixte', insured_death_capital: 100000, insured_disability_capital: 50000,
    insured_rent: 0, surrender_value: 0, premium_waiver: true,
    indexation_type: 'fixe', policy_term_years: 20,
  });
});

test('Vie — les validations rejettent enum, type, borne et branche invalides', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Val', last_name: 'Vie', status: 'client',
  });
  const base = { client_id: client.body.id, company_id: 1, branch: 'vie_3a', annual_premium: 2400 };

  const badEnum = await auth(request(app).post('/api/contracts'))
    .send({ ...base, life: { component_type: 'inexistant' } });
  assert.equal(badEnum.status, 400);

  const badIndexationEnum = await auth(request(app).post('/api/contracts'))
    .send({ ...base, life: { component_type: 'mixte', indexation_type: 'inexistant' } });
  assert.equal(badIndexationEnum.status, 400);

  const badType = await auth(request(app).post('/api/contracts'))
    .send({ ...base, life: { component_type: 'mixte', insured_death_capital: 'abc' } });
  assert.equal(badType.status, 400);

  const numericString = await auth(request(app).post('/api/contracts'))
    .send({ ...base, life: { component_type: 'mixte', insured_death_capital: '1000' } });
  assert.equal(numericString.status, 400, 'une chaîne numérique ne doit pas être coercée silencieusement');

  const negativeCapital = await auth(request(app).post('/api/contracts'))
    .send({ ...base, life: { component_type: 'mixte', insured_rent: -100 } });
  assert.equal(negativeCapital.status, 400);

  const badTerm = await auth(request(app).post('/api/contracts'))
    .send({ ...base, life: { component_type: 'mixte', policy_term_years: 0 } });
  assert.equal(badTerm.status, 400, 'policy_term_years doit être strictement positif');

  const nonIntegerTerm = await auth(request(app).post('/api/contracts'))
    .send({ ...base, life: { component_type: 'mixte', policy_term_years: 5.5 } });
  assert.equal(nonIntegerTerm.status, 400);

  const wrongBranch = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 2400,
    life: { component_type: 'mixte' },
  });
  assert.equal(wrongBranch.status, 400);
});

// contract_life ne comporte aucun champ texte libre (pas de *_notes) ni aucun
// champ date métier : les scénarios génériques « texte trop long » et « date
// invalide » ne s'appliquent donc pas à ce bloc et ne sont pas dupliqués ici.

test('Vie — null explicite est rejeté sur les champs non nullable', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Null', last_name: 'Vie', status: 'client',
  });
  const base = { client_id: client.body.id, company_id: 1, branch: 'vie_3a', annual_premium: 2400 };

  const nullComponentType = await auth(request(app).post('/api/contracts'))
    .send({ ...base, life: { component_type: null } });
  assert.equal(nullComponentType.status, 400);

  const nullPremiumWaiver = await auth(request(app).post('/api/contracts'))
    .send({ ...base, life: { component_type: 'mixte', premium_waiver: null } });
  assert.equal(nullPremiumWaiver.status, 400);

  const nullIndexationType = await auth(request(app).post('/api/contracts'))
    .send({ ...base, life: { component_type: 'mixte', indexation_type: null } });
  assert.equal(nullIndexationType.status, 400);
});

test('Vie — rollback complet : aucun contrat créé si le bloc life est invalide', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Rollback', last_name: 'Vie', status: 'client',
  });
  const before = (await auth(request(app).get('/api/contracts'))).body.length;
  const res = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'vie_3a', annual_premium: 2400,
    life: { component_type: 'invalide' },
  });
  assert.equal(res.status, 400);
  const after = (await auth(request(app).get('/api/contracts'))).body.length;
  assert.equal(after, before, 'aucun contrat créé si le bloc life est invalide');
});

test('Vie — rollback : une mise à jour invalide n’altère pas les détails existants', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Rollback', last_name: 'UpdateVie', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'vie_3a', annual_premium: 2400,
    life: { component_type: 'mixte', insured_death_capital: 100000, policy_term_years: 15 },
  });
  const id = created.body.id;

  const bad = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ life: { component_type: 'invalide' } });
  assert.equal(bad.status, 400);

  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.life.component_type, 'mixte', 'les détails existants ne doivent pas être altérés');
  assert.equal(row.life.insured_death_capital, 100000);
  assert.equal(row.life.policy_term_years, 15);
});

test('Vie — mise à jour crée puis modifie partiellement les détails ; changement de branche encadré', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Update', last_name: 'Vie', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'vie_3a', annual_premium: 2400,
  });
  const id = created.body.id;

  const createDetails = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ life: { component_type: 'risque_pur', insured_death_capital: 80000 } });
  assert.equal(createDetails.status, 200);
  let row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.life.component_type, 'risque_pur');
  assert.equal(row.life.insured_death_capital, 80000);
  assert.equal(row.life.indexation_type, 'aucune', 'valeur par défaut SQL appliquée aux champs non fournis');
  assert.equal(row.life.premium_waiver, false, 'valeur par défaut SQL appliquée aux champs non fournis');

  // Mise à jour partielle : seul surrender_value est fourni, le reste (dont
  // insured_death_capital déjà enregistré) doit rester inchangé (CASE WHEN).
  const partialUpdate = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ life: { surrender_value: 5000 } });
  assert.equal(partialUpdate.status, 200);
  row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.life.surrender_value, 5000);
  assert.equal(row.life.component_type, 'risque_pur', 'champ non fourni conservé par la mise à jour partielle');
  assert.equal(row.life.insured_death_capital, 80000, 'champ non fourni conservé par la mise à jour partielle');

  const blocked = await auth(request(app).put(`/api/contracts/${id}`)).send({ branch: 'lca' });
  assert.equal(blocked.status, 400);

  const allowed = await auth(request(app).put(`/api/contracts/${id}`)).send({ branch: 'lca', life: null });
  assert.equal(allowed.status, 200);
  row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.branch, 'lca');
  assert.equal(row.life, null);
});

test('Vie — suppression explicite des détails via life: null', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Suppr', last_name: 'Vie', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'vie_3a', annual_premium: 2400,
    life: { component_type: 'mixte' },
  });
  const del = await auth(request(app).put(`/api/contracts/${created.body.id}`)).send({ life: null });
  assert.equal(del.status, 200);
  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === created.body.id);
  assert.equal(row.life, null);
});

test('Vie — la suppression du contrat supprime automatiquement contract_life (CASCADE)', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Cascade', last_name: 'Vie', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'vie_3a', annual_premium: 2400,
    life: { component_type: 'mixte' },
  });
  const del = await auth(request(app).delete(`/api/contracts/${created.body.id}`));
  assert.equal(del.status, 200);
  const list = await auth(request(app).get('/api/contracts'));
  assert.ok(!list.body.find((c) => c.id === created.body.id), 'le contrat a bien été supprimé');
});

test('Vie — coexistence avec LAMal et LCA sans régression, et refus de blocs combinés incohérents', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Coexist', last_name: 'Vie', status: 'client',
  });

  const lifeContract = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'vie_3a', annual_premium: 2400,
    life: { component_type: 'mixte', insured_death_capital: 100000 },
  });
  assert.equal(lifeContract.status, 201);

  const lamalContract = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 3000,
    lamal: { care_model: 'standard', deductible: 300 },
  });
  assert.equal(lamalContract.status, 201);

  const lcaContract = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900,
    lca: { underwriting_status: 'acceptee' },
  });
  assert.equal(lcaContract.status, 201);

  const list = await auth(request(app).get('/api/contracts'));
  const lifeRow = list.body.find((c) => c.id === lifeContract.body.id);
  const lamalRow = list.body.find((c) => c.id === lamalContract.body.id);
  const lcaRow = list.body.find((c) => c.id === lcaContract.body.id);
  assert.ok(lifeRow.life, 'le contrat vie conserve ses détails');
  assert.equal(lifeRow.lamal, null);
  assert.equal(lifeRow.lca, null);
  assert.ok(lamalRow.lamal, 'le contrat LAMal conserve ses détails, non affecté par le support vie');
  assert.equal(lamalRow.life, null);
  assert.ok(lcaRow.lca, 'le contrat LCA conserve ses détails, non affecté par le support vie');
  assert.equal(lcaRow.life, null);

  // Une même requête combinant life et lamal (ou life et lca) non nuls est
  // refusée quelle que soit la branche : aucune branche n'est jamais
  // compatible avec deux blocs spécialisés à la fois.
  const combinedLifeLamal = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'vie_3a', annual_premium: 2400,
    life: { component_type: 'mixte' },
    lamal: { care_model: 'standard', deductible: 300 },
  });
  assert.equal(combinedLifeLamal.status, 400);

  const combinedLifeLca = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'vie_3a', annual_premium: 2400,
    life: { component_type: 'mixte' },
    lca: { underwriting_status: 'acceptee' },
  });
  assert.equal(combinedLifeLca.status, 400);
});

test('Vie — non-régression de la génération de commission sur un contrat enrichi', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Commission', last_name: 'Vie', status: 'client',
  });
  const res = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'vie_3a', annual_premium: 2400,
    acq_commission_rate: 5, status: 'actif',
    life: { component_type: 'mixte' },
  });
  assert.equal(res.status, 201);
  const commissions = await auth(request(app).get('/api/commissions'));
  const acq = commissions.body.find((c) => c.contract_id === res.body.id && c.type === 'acquisition');
  assert.ok(acq, 'commission d’acquisition toujours générée automatiquement pour un contrat vie enrichi');
  assert.equal(acq.amount, 120);
});

test('Vie — les entrées d’audit création/modification/suppression sont journalisées', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Audit', last_name: 'Vie', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'vie_3a', annual_premium: 2400,
    life: { component_type: 'mixte' },
  });
  await auth(request(app).put(`/api/contracts/${created.body.id}`))
    .send({ life: { component_type: 'rente' } });
  await auth(request(app).put(`/api/contracts/${created.body.id}`)).send({ life: null });

  const log = await auth(request(app).get('/api/compliance/audit-log?q=détails vie'));
  assert.equal(log.status, 200);
  assert.ok(log.body.some((l) => l.action === 'création détails vie'));
  assert.ok(log.body.some((l) => l.action === 'modification détails vie'));
  assert.ok(log.body.some((l) => l.action === 'suppression détails vie'));
});

test('Incapacité — création sans bloc income_protection, puis avec détails valides, et lecture', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Chloe', last_name: 'Incap', status: 'client',
  });

  const noIp = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'incapacite', annual_premium: 800,
  });
  assert.equal(noIp.status, 201);
  let list = await auth(request(app).get('/api/contracts'));
  assert.equal(list.body.find((c) => c.id === noIp.body.id).income_protection, null);

  const withIp = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'incapacite', annual_premium: 1500,
    income_protection: {
      benefit_type: 'indemnite_journaliere', insured_amount: 200, waiting_period_days: 30,
      benefit_duration_months: 24, disability_trigger_rate: 25, coordination_ai_lpp: true,
      premium_waiver: true, exclusions_notes: 'dos, suivi médical en cours',
    },
  });
  assert.equal(withIp.status, 201);
  list = await auth(request(app).get('/api/contracts'));
  assert.deepEqual(list.body.find((c) => c.id === withIp.body.id).income_protection, {
    benefit_type: 'indemnite_journaliere', insured_amount: 200, waiting_period_days: 30,
    benefit_duration_months: 24, disability_trigger_rate: 25, coordination_ai_lpp: true,
    premium_waiver: true, exclusions_notes: 'dos, suivi médical en cours',
  });
});

test('Incapacité — les validations rejettent enum, type, borne, texte trop long et branche invalides', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Val', last_name: 'Incap', status: 'client',
  });
  const base = { client_id: client.body.id, company_id: 1, branch: 'incapacite', annual_premium: 1500 };

  const badEnum = await auth(request(app).post('/api/contracts'))
    .send({ ...base, income_protection: { benefit_type: 'inexistant' } });
  assert.equal(badEnum.status, 400);

  const badType = await auth(request(app).post('/api/contracts'))
    .send({ ...base, income_protection: { benefit_type: 'rente', insured_amount: 'abc' } });
  assert.equal(badType.status, 400);

  const numericString = await auth(request(app).post('/api/contracts'))
    .send({ ...base, income_protection: { benefit_type: 'rente', insured_amount: '1000' } });
  assert.equal(numericString.status, 400, 'une chaîne numérique ne doit pas être coercée silencieusement');

  const negativeAmount = await auth(request(app).post('/api/contracts'))
    .send({ ...base, income_protection: { benefit_type: 'rente', insured_amount: -100 } });
  assert.equal(negativeAmount.status, 400);

  const negativeRate = await auth(request(app).post('/api/contracts'))
    .send({ ...base, income_protection: { benefit_type: 'rente', disability_trigger_rate: -1 } });
  assert.equal(negativeRate.status, 400);

  const rateTooHigh = await auth(request(app).post('/api/contracts'))
    .send({ ...base, income_protection: { benefit_type: 'rente', disability_trigger_rate: 101 } });
  assert.equal(rateTooHigh.status, 400, 'disability_trigger_rate doit rester entre 0 et 100');

  const nonIntegerWaiting = await auth(request(app).post('/api/contracts'))
    .send({ ...base, income_protection: { benefit_type: 'rente', waiting_period_days: 5.5 } });
  assert.equal(nonIntegerWaiting.status, 400, 'waiting_period_days doit être un entier');

  const zeroDuration = await auth(request(app).post('/api/contracts'))
    .send({ ...base, income_protection: { benefit_type: 'rente', benefit_duration_months: 0 } });
  assert.equal(zeroDuration.status, 400, 'benefit_duration_months doit être strictement positif');

  const tooLong = await auth(request(app).post('/api/contracts'))
    .send({ ...base, income_protection: { benefit_type: 'rente', exclusions_notes: 'x'.repeat(201) } });
  assert.equal(tooLong.status, 400);

  const wrongBranch = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 1500,
    income_protection: { benefit_type: 'rente' },
  });
  assert.equal(wrongBranch.status, 400);
});

// contract_income_protection ne comporte aucun champ date métier (seuls
// created_at/updated_at techniques) : le scénario générique « date invalide »
// ne s'applique donc pas à ce bloc et n'est pas dupliqué ici.

test('Incapacité — null explicite est rejeté sur les champs non nullable', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Null', last_name: 'Incap', status: 'client',
  });
  const base = { client_id: client.body.id, company_id: 1, branch: 'incapacite', annual_premium: 1500 };

  const nullBenefitType = await auth(request(app).post('/api/contracts'))
    .send({ ...base, income_protection: { benefit_type: null } });
  assert.equal(nullBenefitType.status, 400);

  const nullCoordination = await auth(request(app).post('/api/contracts'))
    .send({ ...base, income_protection: { benefit_type: 'rente', coordination_ai_lpp: null } });
  assert.equal(nullCoordination.status, 400);

  const nullPremiumWaiver = await auth(request(app).post('/api/contracts'))
    .send({ ...base, income_protection: { benefit_type: 'rente', premium_waiver: null } });
  assert.equal(nullPremiumWaiver.status, 400);
});

test('Incapacité — rollback complet : aucun contrat créé si le bloc income_protection est invalide', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Rollback', last_name: 'Incap', status: 'client',
  });
  const before = (await auth(request(app).get('/api/contracts'))).body.length;
  const res = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'incapacite', annual_premium: 1500,
    income_protection: { benefit_type: 'invalide' },
  });
  assert.equal(res.status, 400);
  const after = (await auth(request(app).get('/api/contracts'))).body.length;
  assert.equal(after, before, 'aucun contrat créé si le bloc income_protection est invalide');
});

test('Incapacité — rollback : une mise à jour invalide n’altère pas les détails existants', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Rollback', last_name: 'UpdateIncap', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'incapacite', annual_premium: 1500,
    income_protection: { benefit_type: 'rente', insured_amount: 60000, disability_trigger_rate: 40 },
  });
  const id = created.body.id;

  const bad = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ income_protection: { benefit_type: 'invalide' } });
  assert.equal(bad.status, 400);

  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.income_protection.benefit_type, 'rente', 'les détails existants ne doivent pas être altérés');
  assert.equal(row.income_protection.insured_amount, 60000);
  assert.equal(row.income_protection.disability_trigger_rate, 40);
});

test('Incapacité — mise à jour crée puis modifie partiellement les détails ; changement de branche encadré', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Update', last_name: 'Incap', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'incapacite', annual_premium: 1500,
  });
  const id = created.body.id;

  const createDetails = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ income_protection: { benefit_type: 'capital', insured_amount: 50000 } });
  assert.equal(createDetails.status, 200);
  let row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.income_protection.benefit_type, 'capital');
  assert.equal(row.income_protection.insured_amount, 50000);
  assert.equal(row.income_protection.coordination_ai_lpp, false, 'valeur par défaut SQL appliquée aux champs non fournis');
  assert.equal(row.income_protection.premium_waiver, false, 'valeur par défaut SQL appliquée aux champs non fournis');

  // Mise à jour partielle : seul disability_trigger_rate est fourni, le
  // reste (dont insured_amount déjà enregistré) doit rester inchangé.
  const partialUpdate = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ income_protection: { disability_trigger_rate: 33 } });
  assert.equal(partialUpdate.status, 200);
  row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.income_protection.disability_trigger_rate, 33);
  assert.equal(row.income_protection.benefit_type, 'capital', 'champ non fourni conservé par la mise à jour partielle');
  assert.equal(row.income_protection.insured_amount, 50000, 'champ non fourni conservé par la mise à jour partielle');

  const blocked = await auth(request(app).put(`/api/contracts/${id}`)).send({ branch: 'lca' });
  assert.equal(blocked.status, 400);

  const allowed = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ branch: 'lca', income_protection: null });
  assert.equal(allowed.status, 200);
  row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.branch, 'lca');
  assert.equal(row.income_protection, null);
});

test('Incapacité — suppression explicite des détails via income_protection: null', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Suppr', last_name: 'Incap', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'incapacite', annual_premium: 1500,
    income_protection: { benefit_type: 'rente' },
  });
  const del = await auth(request(app).put(`/api/contracts/${created.body.id}`))
    .send({ income_protection: null });
  assert.equal(del.status, 200);
  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === created.body.id);
  assert.equal(row.income_protection, null);
});

test('Incapacité — la suppression du contrat supprime automatiquement contract_income_protection (CASCADE)', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Cascade', last_name: 'Incap', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'incapacite', annual_premium: 1500,
    income_protection: { benefit_type: 'rente' },
  });
  const del = await auth(request(app).delete(`/api/contracts/${created.body.id}`));
  assert.equal(del.status, 200);
  const list = await auth(request(app).get('/api/contracts'));
  assert.ok(!list.body.find((c) => c.id === created.body.id), 'le contrat a bien été supprimé');
});

test('Incapacité — coexistence avec LAMal, LCA et vie sans régression, et refus de blocs combinés incohérents', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Coexist', last_name: 'Incap', status: 'client',
  });

  const ipContract = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'incapacite', annual_premium: 1500,
    income_protection: { benefit_type: 'rente', insured_amount: 60000 },
  });
  assert.equal(ipContract.status, 201);

  const lamalContract = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 3000,
    lamal: { care_model: 'standard', deductible: 300 },
  });
  assert.equal(lamalContract.status, 201);

  const lcaContract = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900,
    lca: { underwriting_status: 'acceptee' },
  });
  assert.equal(lcaContract.status, 201);

  const lifeContract = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'vie_3a', annual_premium: 2400,
    life: { component_type: 'mixte' },
  });
  assert.equal(lifeContract.status, 201);

  const list = await auth(request(app).get('/api/contracts'));
  const ipRow = list.body.find((c) => c.id === ipContract.body.id);
  const lamalRow = list.body.find((c) => c.id === lamalContract.body.id);
  const lcaRow = list.body.find((c) => c.id === lcaContract.body.id);
  const lifeRow = list.body.find((c) => c.id === lifeContract.body.id);
  assert.ok(ipRow.income_protection, 'le contrat incapacité conserve ses détails');
  assert.equal(ipRow.lamal, null);
  assert.equal(ipRow.lca, null);
  assert.equal(ipRow.life, null);
  assert.ok(lamalRow.lamal, 'le contrat LAMal conserve ses détails, non affecté par le support incapacité');
  assert.equal(lamalRow.income_protection, null);
  assert.ok(lcaRow.lca, 'le contrat LCA conserve ses détails, non affecté par le support incapacité');
  assert.equal(lcaRow.income_protection, null);
  assert.ok(lifeRow.life, 'le contrat vie conserve ses détails, non affecté par le support incapacité');
  assert.equal(lifeRow.income_protection, null);

  // Une même requête combinant income_protection et lamal/lca/life non nuls
  // est refusée quelle que soit la branche : aucune branche n'est jamais
  // compatible avec deux blocs spécialisés à la fois.
  const combinedWithLamal = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'incapacite', annual_premium: 1500,
    income_protection: { benefit_type: 'rente' },
    lamal: { care_model: 'standard', deductible: 300 },
  });
  assert.equal(combinedWithLamal.status, 400);

  const combinedWithLca = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'incapacite', annual_premium: 1500,
    income_protection: { benefit_type: 'rente' },
    lca: { underwriting_status: 'acceptee' },
  });
  assert.equal(combinedWithLca.status, 400);

  const combinedWithLife = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'incapacite', annual_premium: 1500,
    income_protection: { benefit_type: 'rente' },
    life: { component_type: 'mixte' },
  });
  assert.equal(combinedWithLife.status, 400);
});

test('Incapacité — non-régression de la génération de commission sur un contrat enrichi', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Commission', last_name: 'Incap', status: 'client',
  });
  const res = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'incapacite', annual_premium: 1500,
    acq_commission_rate: 5, status: 'actif',
    income_protection: { benefit_type: 'rente' },
  });
  assert.equal(res.status, 201);
  const commissions = await auth(request(app).get('/api/commissions'));
  const acq = commissions.body.find((c) => c.contract_id === res.body.id && c.type === 'acquisition');
  assert.ok(acq, 'commission d’acquisition toujours générée automatiquement pour un contrat incapacité enrichi');
  assert.equal(acq.amount, 75);
});

test('Incapacité — les entrées d’audit création/modification/suppression sont journalisées', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Audit', last_name: 'Incap', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'incapacite', annual_premium: 1500,
    income_protection: { benefit_type: 'rente' },
  });
  await auth(request(app).put(`/api/contracts/${created.body.id}`))
    .send({ income_protection: { benefit_type: 'capital' } });
  await auth(request(app).put(`/api/contracts/${created.body.id}`)).send({ income_protection: null });

  const log = await auth(request(app).get('/api/compliance/audit-log?q=détails incapacité'));
  assert.equal(log.status, 200);
  assert.ok(log.body.some((l) => l.action === 'création détails incapacité de gain'));
  assert.ok(log.body.some((l) => l.action === 'modification détails incapacité de gain'));
  assert.ok(log.body.some((l) => l.action === 'suppression détails incapacité de gain'));
});

// Correction : une mise à jour partielle qui omet le champ enum non nullable
// utilisé dans le message d'audit (underwriting_status / component_type /
// benefit_type) ne doit jamais produire une entrée d'audit affichant "null"
// pour ce champ — la ligne relue en base après l'UPDATE doit refléter la
// vraie valeur conservée par COALESCE, pas le marqueur interne de writeLca/
// writeLife/writeIncomeProtection. Vérifie aussi qu'un champ nullable
// explicitement mis à null continue de l'être réellement en base.

test('LCA — correction audit : une mise à jour partielle sans underwriting_status conserve la vraie valeur (pas de « statut null »)', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Correction', last_name: 'Lca', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900,
    lca: { underwriting_status: 'acceptee', reservation_notes: 'genou droit' },
  });
  const id = created.body.id;

  // Mise à jour partielle omettant underwriting_status : la vraie valeur
  // doit être conservée en base ET reflétée dans l'audit.
  const partial = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ lca: { reservation_notes: 'genou droit, opéré' } });
  assert.equal(partial.status, 200);

  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.lca.underwriting_status, 'acceptee', 'champ non fourni conservé en base');
  assert.equal(row.lca.reservation_notes, 'genou droit, opéré');

  const log = await auth(request(app).get(`/api/compliance/audit-log?q=modification détails LCA`));
  const entry = log.body.find((l) => l.entity_id === id && l.action === 'modification détails LCA');
  assert.ok(entry, 'une entrée d’audit de modification doit exister');
  assert.equal(entry.details, 'statut acceptee', 'l’audit doit refléter la vraie valeur, jamais « statut null »');
  assert.ok(!String(entry.details).includes('null'), 'l’audit ne doit jamais contenir « null »');

  // Champ nullable explicitement mis à null : doit continuer à être
  // réellement effacé en base (distinct de « absent »).
  const clearNullable = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ lca: { reservation_notes: null } });
  assert.equal(clearNullable.status, 200);
  const rowAfterClear = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(rowAfterClear.lca.reservation_notes, null, 'un champ nullable explicitement mis à null doit rester null');
  assert.equal(rowAfterClear.lca.underwriting_status, 'acceptee', 'les autres champs non fournis restent inchangés');
});

test('Vie — correction audit : une mise à jour partielle sans component_type conserve la vraie valeur (pas de « composante null »)', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Correction', last_name: 'Vie', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'vie_3a', annual_premium: 2400,
    life: { component_type: 'mixte', insured_rent: 500 },
  });
  const id = created.body.id;

  const partial = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ life: { surrender_value: 1000 } });
  assert.equal(partial.status, 200);

  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.life.component_type, 'mixte', 'champ non fourni conservé en base');
  assert.equal(row.life.surrender_value, 1000);

  const log = await auth(request(app).get('/api/compliance/audit-log?q=modification détails vie'));
  const entry = log.body.find((l) => l.entity_id === id && l.action === 'modification détails vie');
  assert.ok(entry, 'une entrée d’audit de modification doit exister');
  assert.equal(entry.details, 'composante mixte', 'l’audit doit refléter la vraie valeur, jamais « composante null »');
  assert.ok(!String(entry.details).includes('null'), 'l’audit ne doit jamais contenir « null »');

  const clearNullable = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ life: { insured_rent: null } });
  assert.equal(clearNullable.status, 200);
  const rowAfterClear = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(rowAfterClear.life.insured_rent, null, 'un champ nullable explicitement mis à null doit rester null');
  assert.equal(rowAfterClear.life.component_type, 'mixte', 'les autres champs non fournis restent inchangés');
});

test('Incapacité — correction audit : une mise à jour partielle sans benefit_type conserve la vraie valeur (pas de « type null »)', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Correction', last_name: 'Incap', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'incapacite', annual_premium: 1500,
    income_protection: { benefit_type: 'rente', insured_amount: 60000 },
  });
  const id = created.body.id;

  const partial = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ income_protection: { disability_trigger_rate: 40 } });
  assert.equal(partial.status, 200);

  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.income_protection.benefit_type, 'rente', 'champ non fourni conservé en base');
  assert.equal(row.income_protection.disability_trigger_rate, 40);

  const log = await auth(request(app).get('/api/compliance/audit-log?q=modification détails incapacité'));
  const entry = log.body.find((l) => l.entity_id === id && l.action === 'modification détails incapacité de gain');
  assert.ok(entry, 'une entrée d’audit de modification doit exister');
  assert.equal(entry.details, 'type rente', 'l’audit doit refléter la vraie valeur, jamais « type null »');
  assert.ok(!String(entry.details).includes('null'), 'l’audit ne doit jamais contenir « null »');

  const clearNullable = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ income_protection: { insured_amount: null } });
  assert.equal(clearNullable.status, 200);
  const rowAfterClear = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(rowAfterClear.income_protection.insured_amount, null, 'un champ nullable explicitement mis à null doit rester null');
  assert.equal(rowAfterClear.income_protection.benefit_type, 'rente', 'les autres champs non fournis restent inchangés');
});

test('LPP/IJM — création sans bloc lpp_ijm, puis avec détails valides, et lecture', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Chloe', last_name: 'Lpp', status: 'client',
  });

  const noLppIjm = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lpp', annual_premium: 1800,
  });
  assert.equal(noLppIjm.status, 201);
  let list = await auth(request(app).get('/api/contracts'));
  assert.equal(list.body.find((c) => c.id === noLppIjm.body.id).lpp_ijm, null);

  const withLppIjm = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lpp', annual_premium: 2400,
    lpp_ijm: {
      product_type: 'lpp', institution_name: 'Fondation collective XY', retirement_capital: 80000,
      disability_pension: 12000, daily_allowance: 0, waiting_period_days: 30, benefit_duration_days: 730,
    },
  });
  assert.equal(withLppIjm.status, 201);
  list = await auth(request(app).get('/api/contracts'));
  assert.deepEqual(list.body.find((c) => c.id === withLppIjm.body.id).lpp_ijm, {
    product_type: 'lpp', institution_name: 'Fondation collective XY', retirement_capital: 80000,
    disability_pension: 12000, daily_allowance: 0, waiting_period_days: 30, benefit_duration_days: 730,
  });
});

test('LPP/IJM — les validations rejettent enum, type, borne, texte trop long et branche invalides', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Val', last_name: 'Lpp', status: 'client',
  });
  const base = { client_id: client.body.id, company_id: 1, branch: 'lpp', annual_premium: 2400 };

  const badEnum = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lpp_ijm: { product_type: 'inexistant' } });
  assert.equal(badEnum.status, 400);

  const badType = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lpp_ijm: { product_type: 'lpp', retirement_capital: 'abc' } });
  assert.equal(badType.status, 400);

  const numericString = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lpp_ijm: { product_type: 'lpp', retirement_capital: '80000' } });
  assert.equal(numericString.status, 400, 'une chaîne numérique ne doit pas être coercée silencieusement');

  const negativeAmount = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lpp_ijm: { product_type: 'lpp', disability_pension: -100 } });
  assert.equal(negativeAmount.status, 400);

  const negativeRetirementCapital = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lpp_ijm: { product_type: 'lpp', retirement_capital: -1 } });
  assert.equal(negativeRetirementCapital.status, 400);

  const negativeDailyAllowance = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lpp_ijm: { product_type: 'ijm', daily_allowance: -1 } });
  assert.equal(negativeDailyAllowance.status, 400);

  const negativeWaiting = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lpp_ijm: { product_type: 'ijm', waiting_period_days: -1 } });
  assert.equal(negativeWaiting.status, 400, 'waiting_period_days doit être non négatif');

  const nonIntegerWaiting = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lpp_ijm: { product_type: 'ijm', waiting_period_days: 5.5 } });
  assert.equal(nonIntegerWaiting.status, 400, 'waiting_period_days doit être un entier');

  const zeroDuration = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lpp_ijm: { product_type: 'ijm', benefit_duration_days: 0 } });
  assert.equal(zeroDuration.status, 400, 'benefit_duration_days doit être strictement positif');

  const nonIntegerDuration = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lpp_ijm: { product_type: 'ijm', benefit_duration_days: 10.5 } });
  assert.equal(nonIntegerDuration.status, 400, 'benefit_duration_days doit être un entier');

  const tooLong = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lpp_ijm: { product_type: 'lpp', institution_name: 'x'.repeat(201) } });
  assert.equal(tooLong.status, 400);

  const wrongBranch = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 2400,
    lpp_ijm: { product_type: 'lpp' },
  });
  assert.equal(wrongBranch.status, 400);
});

// contract_lpp_ijm ne comporte aucune colonne booléenne (contrairement à
// contract_income_protection ou contract_life) : le scénario générique
// « rejet d'un booléen invalide » ne s'applique donc pas à ce bloc et n'est
// pas dupliqué ici.

test('LPP/IJM — null explicite est rejeté sur product_type', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Null', last_name: 'Lpp', status: 'client',
  });
  const base = { client_id: client.body.id, company_id: 1, branch: 'lpp', annual_premium: 2400 };

  const nullProductType = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lpp_ijm: { product_type: null } });
  assert.equal(nullProductType.status, 400);

  // Même rejet attendu côté PUT, sur un contrat déjà enrichi.
  const created = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lpp_ijm: { product_type: 'lpp' } });
  const nullProductTypeOnUpdate = await auth(request(app).put(`/api/contracts/${created.body.id}`))
    .send({ lpp_ijm: { product_type: null } });
  assert.equal(nullProductTypeOnUpdate.status, 400);
  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === created.body.id);
  assert.equal(row.lpp_ijm.product_type, 'lpp', 'un null explicite rejeté ne doit pas altérer la valeur existante');
});

test('LPP/IJM — rollback complet : aucun contrat créé si le bloc lpp_ijm est invalide', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Rollback', last_name: 'Lpp', status: 'client',
  });
  const before = (await auth(request(app).get('/api/contracts'))).body.length;
  const res = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lpp', annual_premium: 2400,
    lpp_ijm: { product_type: 'invalide' },
  });
  assert.equal(res.status, 400);
  const after = (await auth(request(app).get('/api/contracts'))).body.length;
  assert.equal(after, before, 'aucun contrat créé si le bloc lpp_ijm est invalide');
});

test('LPP/IJM — rollback : une mise à jour invalide n’altère pas les détails existants', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Rollback', last_name: 'UpdateLpp', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lpp', annual_premium: 2400,
    lpp_ijm: { product_type: 'lpp', retirement_capital: 60000, waiting_period_days: 90 },
  });
  const id = created.body.id;

  const bad = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ lpp_ijm: { product_type: 'invalide' } });
  assert.equal(bad.status, 400);

  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.lpp_ijm.product_type, 'lpp', 'les détails existants ne doivent pas être altérés');
  assert.equal(row.lpp_ijm.retirement_capital, 60000);
  assert.equal(row.lpp_ijm.waiting_period_days, 90);
});

test('LPP/IJM — mise à jour crée puis modifie partiellement les détails ; changement de branche encadré', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Update', last_name: 'Lpp', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lpp', annual_premium: 2400,
  });
  const id = created.body.id;

  const createDetails = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ lpp_ijm: { product_type: 'ijm', daily_allowance: 150 } });
  assert.equal(createDetails.status, 200);
  let row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.lpp_ijm.product_type, 'ijm');
  assert.equal(row.lpp_ijm.daily_allowance, 150);
  assert.equal(row.lpp_ijm.institution_name, null, 'champ nullable non fourni reste null');

  // Mise à jour partielle : seul waiting_period_days est fourni, le reste
  // (dont daily_allowance déjà enregistré) doit rester inchangé.
  const partialUpdate = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ lpp_ijm: { waiting_period_days: 60 } });
  assert.equal(partialUpdate.status, 200);
  row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.lpp_ijm.waiting_period_days, 60);
  assert.equal(row.lpp_ijm.product_type, 'ijm', 'champ non fourni conservé par la mise à jour partielle');
  assert.equal(row.lpp_ijm.daily_allowance, 150, 'champ non fourni conservé par la mise à jour partielle');

  const blocked = await auth(request(app).put(`/api/contracts/${id}`)).send({ branch: 'lca' });
  assert.equal(blocked.status, 400);

  const allowed = await auth(request(app).put(`/api/contracts/${id}`)).send({ branch: 'lca', lpp_ijm: null });
  assert.equal(allowed.status, 200);
  row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.branch, 'lca');
  assert.equal(row.lpp_ijm, null);
});

test('LPP/IJM — suppression explicite des détails via lpp_ijm: null', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Suppr', last_name: 'Lpp', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lpp', annual_premium: 2400,
    lpp_ijm: { product_type: 'lpp' },
  });
  const del = await auth(request(app).put(`/api/contracts/${created.body.id}`)).send({ lpp_ijm: null });
  assert.equal(del.status, 200);
  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === created.body.id);
  assert.equal(row.lpp_ijm, null);
});

test('LPP/IJM — la suppression du contrat supprime automatiquement contract_lpp_ijm (CASCADE)', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Cascade', last_name: 'Lpp', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lpp', annual_premium: 2400,
    lpp_ijm: { product_type: 'lpp' },
  });
  const del = await auth(request(app).delete(`/api/contracts/${created.body.id}`));
  assert.equal(del.status, 200);
  const list = await auth(request(app).get('/api/contracts'));
  assert.ok(!list.body.find((c) => c.id === created.body.id), 'le contrat a bien été supprimé');
});

test('LPP/IJM — coexistence avec LAMal, LCA, vie et incapacité sans régression, et refus de blocs combinés incohérents', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Coexist', last_name: 'Lpp', status: 'client',
  });

  const lppIjmContract = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lpp', annual_premium: 2400,
    lpp_ijm: { product_type: 'lpp', retirement_capital: 60000 },
  });
  assert.equal(lppIjmContract.status, 201);

  const lamalContract = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 3000,
    lamal: { care_model: 'standard', deductible: 300 },
  });
  assert.equal(lamalContract.status, 201);

  const lcaContract = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900,
    lca: { underwriting_status: 'acceptee' },
  });
  assert.equal(lcaContract.status, 201);

  const lifeContract = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'vie_3a', annual_premium: 2400,
    life: { component_type: 'mixte' },
  });
  assert.equal(lifeContract.status, 201);

  const incomeProtectionContract = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'incapacite', annual_premium: 1500,
    income_protection: { benefit_type: 'rente' },
  });
  assert.equal(incomeProtectionContract.status, 201);

  const list = await auth(request(app).get('/api/contracts'));
  const lppIjmRow = list.body.find((c) => c.id === lppIjmContract.body.id);
  const lamalRow = list.body.find((c) => c.id === lamalContract.body.id);
  const lcaRow = list.body.find((c) => c.id === lcaContract.body.id);
  const lifeRow = list.body.find((c) => c.id === lifeContract.body.id);
  const incomeProtectionRow = list.body.find((c) => c.id === incomeProtectionContract.body.id);
  assert.ok(lppIjmRow.lpp_ijm, 'le contrat LPP/IJM conserve ses détails');
  assert.equal(lppIjmRow.lamal, null);
  assert.equal(lppIjmRow.lca, null);
  assert.equal(lppIjmRow.life, null);
  assert.equal(lppIjmRow.income_protection, null);
  assert.ok(lamalRow.lamal, 'le contrat LAMal conserve ses détails, non affecté par le support LPP/IJM');
  assert.equal(lamalRow.lpp_ijm, null);
  assert.ok(lcaRow.lca, 'le contrat LCA conserve ses détails, non affecté par le support LPP/IJM');
  assert.equal(lcaRow.lpp_ijm, null);
  assert.ok(lifeRow.life, 'le contrat vie conserve ses détails, non affecté par le support LPP/IJM');
  assert.equal(lifeRow.lpp_ijm, null);
  assert.ok(incomeProtectionRow.income_protection, 'le contrat incapacité conserve ses détails, non affecté par le support LPP/IJM');
  assert.equal(incomeProtectionRow.lpp_ijm, null);

  // Une même requête combinant lpp_ijm et lamal/lca/life/income_protection
  // non nuls est refusée quelle que soit la branche : aucune branche n'est
  // jamais compatible avec deux blocs spécialisés à la fois.
  const combinedWithLamal = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lpp', annual_premium: 2400,
    lpp_ijm: { product_type: 'lpp' },
    lamal: { care_model: 'standard', deductible: 300 },
  });
  assert.equal(combinedWithLamal.status, 400);

  const combinedWithLca = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lpp', annual_premium: 2400,
    lpp_ijm: { product_type: 'lpp' },
    lca: { underwriting_status: 'acceptee' },
  });
  assert.equal(combinedWithLca.status, 400);

  const combinedWithLife = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lpp', annual_premium: 2400,
    lpp_ijm: { product_type: 'lpp' },
    life: { component_type: 'mixte' },
  });
  assert.equal(combinedWithLife.status, 400);

  const combinedWithIncomeProtection = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lpp', annual_premium: 2400,
    lpp_ijm: { product_type: 'lpp' },
    income_protection: { benefit_type: 'rente' },
  });
  assert.equal(combinedWithIncomeProtection.status, 400);
});

test('LPP/IJM — non-régression de la génération de commission sur un contrat enrichi', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Commission', last_name: 'Lpp', status: 'client',
  });
  const res = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lpp', annual_premium: 2000,
    acq_commission_rate: 5, status: 'actif',
    lpp_ijm: { product_type: 'lpp' },
  });
  assert.equal(res.status, 201);
  const commissions = await auth(request(app).get('/api/commissions'));
  const acq = commissions.body.find((c) => c.contract_id === res.body.id && c.type === 'acquisition');
  assert.ok(acq, 'commission d’acquisition toujours générée automatiquement pour un contrat LPP/IJM enrichi');
  assert.equal(acq.amount, 100);
});

test('LPP/IJM — les entrées d’audit création/modification/suppression sont journalisées', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Audit', last_name: 'Lpp', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lpp', annual_premium: 2400,
    lpp_ijm: { product_type: 'lpp' },
  });
  await auth(request(app).put(`/api/contracts/${created.body.id}`))
    .send({ lpp_ijm: { product_type: 'ijm' } });
  await auth(request(app).put(`/api/contracts/${created.body.id}`)).send({ lpp_ijm: null });

  const log = await auth(request(app).get('/api/compliance/audit-log?q=détails LPP'));
  assert.equal(log.status, 200);
  assert.ok(log.body.some((l) => l.action === 'création détails LPP/IJM'));
  assert.ok(log.body.some((l) => l.action === 'modification détails LPP/IJM'));
  assert.ok(log.body.some((l) => l.action === 'suppression détails LPP/IJM'));
});

test('LPP/IJM — correction audit : une mise à jour partielle sans product_type conserve la vraie valeur (pas de « type null »)', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Correction', last_name: 'Lpp', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lpp', annual_premium: 2400,
    lpp_ijm: { product_type: 'lpp', retirement_capital: 60000 },
  });
  assert.equal(created.status, 201);
  const id = created.body.id;

  const partial = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ lpp_ijm: { waiting_period_days: 45 } });
  assert.equal(partial.status, 200);

  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.lpp_ijm.product_type, 'lpp', 'champ non fourni conservé en base');
  assert.equal(row.lpp_ijm.waiting_period_days, 45);

  const log = await auth(request(app).get('/api/compliance/audit-log?q=modification détails LPP'));
  const entry = log.body.find((l) => l.entity_id === id && l.action === 'modification détails LPP/IJM');
  assert.ok(entry, 'une entrée d’audit de modification doit exister');
  assert.equal(entry.details, 'type lpp', 'l’audit doit refléter la vraie valeur, jamais « type null »');
  assert.ok(!String(entry.details).includes('null'), 'l’audit ne doit jamais contenir « null »');

  const clearNullable = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ lpp_ijm: { retirement_capital: null } });
  assert.equal(clearNullable.status, 200);
  const rowAfterClear = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(rowAfterClear.lpp_ijm.retirement_capital, null, 'un champ nullable explicitement mis à null doit rester null');
  assert.equal(rowAfterClear.lpp_ijm.product_type, 'lpp', 'les autres champs non fournis restent inchangés');
});

// --- Lot G1 : corrections de cohérence des validations -------------------
// Ces tests reproduisent d'abord les défauts (coercition de type via
// Number(...) sur LAMal.deductible et LCA.waiting_period_days ; null
// explicite silencieusement ignoré sur les trois enums NOT NULL DEFAULT de
// contract_lca), avant correction de server/routes/contracts.js.

test('LAMal — G1 : deductible rejette toute coercition de type (chaîne, décimal, booléen, objet)', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'G1', last_name: 'LamalCoercion', status: 'client',
  });
  const base = { client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 900 };
  const invalidValues = ['300', '2500', '0', 'abc', 300.5, null, true, false, {}, []];
  const before = (await auth(request(app).get('/api/contracts'))).body.length;
  for (const deductible of invalidValues) {
    const res = await auth(request(app).post('/api/contracts'))
      .send({ ...base, lamal: { care_model: 'standard', deductible } });
    assert.equal(res.status, 400, `deductible=${JSON.stringify(deductible)} doit être rejeté`);
  }
  const after = (await auth(request(app).get('/api/contracts'))).body.length;
  assert.equal(after, before, 'aucun contrat ne doit être créé pour une valeur de deductible rejetée');

  const ok = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lamal: { care_model: 'standard', deductible: 300 } });
  assert.equal(ok.status, 201, 'une franchise numérique valide doit toujours être acceptée');
  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === ok.body.id);
  assert.equal(row.lamal.deductible, 300);
});

test('LCA — G1 : waiting_period_days rejette toute coercition de type (chaîne, décimal, négatif, booléen, objet)', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'G1', last_name: 'LcaCoercion', status: 'client',
  });
  const base = { client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900 };
  const invalidValues = ['0', '30', '90', 'abc', 1.5, -1, true, false, {}, []];
  const before = (await auth(request(app).get('/api/contracts'))).body.length;
  for (const waiting_period_days of invalidValues) {
    const res = await auth(request(app).post('/api/contracts'))
      .send({ ...base, lca: { waiting_period_days } });
    assert.equal(res.status, 400, `waiting_period_days=${JSON.stringify(waiting_period_days)} doit être rejeté`);
  }
  const after = (await auth(request(app).get('/api/contracts'))).body.length;
  assert.equal(after, before, 'aucun contrat ne doit être créé pour une valeur de waiting_period_days rejetée');

  const okZero = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lca: { waiting_period_days: 0 } });
  assert.equal(okZero.status, 201, '0 (entier réel) doit être accepté');
  let row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === okZero.body.id);
  assert.equal(row.lca.waiting_period_days, 0);

  const okNull = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lca: { waiting_period_days: null } });
  assert.equal(okNull.status, 201, 'null doit être accepté (champ nullable)');
  row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === okNull.body.id);
  assert.equal(row.lca.waiting_period_days, null);
});

test('LCA — G1 : null explicite est rejeté sur les trois enums non nullables, en POST, avec rollback complet', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'G1', last_name: 'LcaEnumNullPost', status: 'client',
  });
  const base = { client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900 };

  const before = (await auth(request(app).get('/api/contracts'))).body.length;

  const badUnderwriting = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lca: { underwriting_status: null } });
  assert.equal(badUnderwriting.status, 400);

  const badReservation = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lca: { administrative_reservation_status: null } });
  assert.equal(badReservation.status, 400);

  const badExclusions = await auth(request(app).post('/api/contracts'))
    .send({ ...base, lca: { exclusions_status: null } });
  assert.equal(badExclusions.status, 400);

  const after = (await auth(request(app).get('/api/contracts'))).body.length;
  assert.equal(after, before, 'aucun contrat créé si un enum LCA est explicitement null');
});

test('LCA — G1 : null explicite est rejeté sur les trois enums non nullables, en PUT, sans aucune altération', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'G1', last_name: 'LcaEnumNullPut', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900,
    acq_commission_rate: 5, status: 'actif',
    lca: {
      underwriting_status: 'acceptee', administrative_reservation_status: 'active',
      exclusions_status: 'presentes',
    },
  });
  assert.equal(created.status, 201);
  const id = created.body.id;

  const commissionsBefore = await auth(request(app).get('/api/commissions'));
  const acqBefore = commissionsBefore.body.find((c) => c.contract_id === id && c.type === 'acquisition');
  assert.ok(acqBefore, 'commission d’acquisition générée à la création');

  const fields = ['underwriting_status', 'administrative_reservation_status', 'exclusions_status'];
  for (const field of fields) {
    const res = await auth(request(app).put(`/api/contracts/${id}`)).send({ lca: { [field]: null } });
    assert.equal(res.status, 400, `${field}: null doit être rejeté en PUT`);
  }

  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.lca.underwriting_status, 'acceptee', 'le contrat_lca ne doit pas être altéré après rejet');
  assert.equal(row.lca.administrative_reservation_status, 'active');
  assert.equal(row.lca.exclusions_status, 'presentes');
  assert.equal(row.branch, 'lca', 'le contrat générique ne doit pas être altéré après rejet');
  assert.equal(row.annual_premium, 900);

  const log = await auth(request(app).get('/api/compliance/audit-log?q=modification détails LCA'));
  const entry = log.body.find((l) => l.entity_id === id && l.action === 'modification détails LCA');
  assert.ok(!entry, 'aucun audit de modification LCA ne doit être créé après un rejet de validation');

  const commissionsAfter = await auth(request(app).get('/api/commissions'));
  const acqAfter = commissionsAfter.body.find((c) => c.contract_id === id && c.type === 'acquisition');
  assert.equal(acqAfter.amount, acqBefore.amount, 'la commission ne doit pas être altérée après un rejet de validation');
  assert.equal(acqAfter.status, acqBefore.status);
});

test('LCA — G1 : absence des trois enums en PUT préserve les valeurs existantes ; une valeur valide les met à jour', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'G1', last_name: 'LcaEnumPreserve', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900,
    lca: {
      underwriting_status: 'acceptee', administrative_reservation_status: 'active',
      exclusions_status: 'presentes',
    },
  });
  const id = created.body.id;

  // Absence des trois enums (autre champ fourni) : préservation attendue.
  const preserve = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ lca: { reservation_notes: 'suivi administratif' } });
  assert.equal(preserve.status, 200);
  let row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.lca.underwriting_status, 'acceptee', 'champ non fourni conservé');
  assert.equal(row.lca.administrative_reservation_status, 'active', 'champ non fourni conservé');
  assert.equal(row.lca.exclusions_status, 'presentes', 'champ non fourni conservé');
  assert.equal(row.lca.reservation_notes, 'suivi administratif');

  // Valeur enum valide : mise à jour effective, les deux autres préservés.
  const update = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ lca: { underwriting_status: 'refusee' } });
  assert.equal(update.status, 200);
  row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.lca.underwriting_status, 'refusee', 'la nouvelle valeur enum doit être appliquée');
  assert.equal(row.lca.administrative_reservation_status, 'active', 'champ non fourni conservé');
  assert.equal(row.lca.exclusions_status, 'presentes', 'champ non fourni conservé');
});

test('LCA — G1 : non-régression des defaults SQL à la création sans les enums, et de la suppression du bloc via lca: null', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'G1', last_name: 'LcaDefaults', status: 'client',
  });

  // Création sans les enums : les DEFAULT SQL existants doivent s'appliquer,
  // comportement inchangé par la correction G1.
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900,
    lca: { waiting_period_days: 15 },
  });
  assert.equal(created.status, 201);
  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === created.body.id);
  assert.equal(row.lca.underwriting_status, 'non_requis', 'valeur par défaut SQL non modifiée par G1');
  assert.equal(row.lca.administrative_reservation_status, 'aucune', 'valeur par défaut SQL non modifiée par G1');
  assert.equal(row.lca.exclusions_status, 'aucune', 'valeur par défaut SQL non modifiée par G1');

  // Suppression du bloc complet via lca: null : comportement inchangé.
  const del = await auth(request(app).put(`/api/contracts/${created.body.id}`)).send({ lca: null });
  assert.equal(del.status, 200);
  const rowAfterDelete = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === created.body.id);
  assert.equal(rowAfterDelete.lca, null, 'lca: null doit toujours supprimer le bloc complet');
});

test('LAMal/LCA — G1 : la coercition de type reste rejetée en PUT sur un contrat existant', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'G1', last_name: 'CoercionPut', status: 'client',
  });
  const lamalContract = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 900,
    lamal: { care_model: 'standard', deductible: 300 },
  });
  const badLamalPut = await auth(request(app).put(`/api/contracts/${lamalContract.body.id}`))
    .send({ lamal: { care_model: 'standard', deductible: '2500' } });
  assert.equal(badLamalPut.status, 400, 'deductible="2500" doit être rejeté en PUT');
  const lamalRow = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === lamalContract.body.id);
  assert.equal(lamalRow.lamal.deductible, 300, 'la valeur existante ne doit pas être altérée après rejet');

  const lcaContract = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lca', annual_premium: 900,
    lca: { waiting_period_days: 10 },
  });
  const badLcaPut = await auth(request(app).put(`/api/contracts/${lcaContract.body.id}`))
    .send({ lca: { waiting_period_days: '30' } });
  assert.equal(badLcaPut.status, 400, 'waiting_period_days="30" doit être rejeté en PUT');
  const lcaRow = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === lcaContract.body.id);
  assert.equal(lcaRow.lca.waiting_period_days, 10, 'la valeur existante ne doit pas être altérée après rejet');
});

// --- Lot G2 : complément de couverture ------------------------------------

test('LAMal — les entrées d’audit création/modification/suppression sont journalisées', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Audit', last_name: 'Lamal', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 3000,
    lamal: { care_model: 'standard', deductible: 300 },
  });
  assert.equal(created.status, 201);
  const id = created.body.id;

  const updated = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ lamal: { care_model: 'hmo', deductible: 500, accident_coverage: true } });
  assert.equal(updated.status, 200);

  const deleted = await auth(request(app).put(`/api/contracts/${id}`)).send({ lamal: null });
  assert.equal(deleted.status, 200);

  const log = await auth(request(app).get('/api/compliance/audit-log?q=détails LAMal'));
  assert.equal(log.status, 200);
  assert.ok(
    log.body.find((l) => l.entity_id === id && l.action === 'création détails LAMal'),
    'une entrée « création détails LAMal » doit exister pour ce contrat'
  );
  assert.ok(
    log.body.find((l) => l.entity_id === id && l.action === 'modification détails LAMal'),
    'une entrée « modification détails LAMal » doit exister pour ce contrat'
  );
  assert.ok(
    log.body.find((l) => l.entity_id === id && l.action === 'suppression détails LAMal'),
    'une entrée « suppression détails LAMal » doit exister pour ce contrat'
  );
  // Aucune donnée médicale ni texte libre sensible n'est journalisée : le
  // schéma contract_lamal ne comporte aucun champ de cette nature.
});

test('LAMal — création d’un contrat avec lamal: null explicite (comportement actuel : aucune ligne créée)', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'NullCreate', last_name: 'Lamal', status: 'client',
  });
  const res = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 3000,
    lamal: null,
  });
  assert.equal(res.status, 201, 'lamal: null explicite à la création ne doit pas provoquer d’erreur');
  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === res.body.id);
  assert.equal(row.lamal, null, 'aucune ligne contract_lamal ne doit être créée');
});

test('LAMal — lamal: null en mise à jour : audit de suppression, commissions et contrat générique préservés', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'NullUpdate', last_name: 'Lamal', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 3000,
    acq_commission_rate: 4, status: 'actif',
    lamal: { care_model: 'standard', deductible: 300 },
  });
  assert.equal(created.status, 201);
  const id = created.body.id;

  const commissionsBefore = await auth(request(app).get('/api/commissions'));
  const acqBefore = commissionsBefore.body.find((c) => c.contract_id === id && c.type === 'acquisition');
  assert.ok(acqBefore, 'commission d’acquisition générée à la création');

  const del = await auth(request(app).put(`/api/contracts/${id}`)).send({ lamal: null });
  assert.equal(del.status, 200);

  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.lamal, null, 'le bloc LAMal doit être supprimé');
  assert.equal(row.branch, 'lamal', 'le contrat générique doit rester présent');
  assert.equal(row.annual_premium, 3000, 'le contrat générique ne doit pas être altéré');

  const commissionsAfter = await auth(request(app).get('/api/commissions'));
  const acqAfter = commissionsAfter.body.find((c) => c.contract_id === id && c.type === 'acquisition');
  assert.ok(acqAfter, 'la commission existante doit toujours exister');
  assert.equal(acqAfter.amount, acqBefore.amount, 'la commission ne doit pas être altérée');
  assert.equal(acqAfter.status, acqBefore.status);

  const log = await auth(request(app).get('/api/compliance/audit-log?q=suppression détails LAMal'));
  assert.ok(
    log.body.find((l) => l.entity_id === id && l.action === 'suppression détails LAMal'),
    'l’audit de suppression des détails LAMal doit être créé'
  );
});

test('LAMal — rejet d’un PUT partiel (care_model ou deductible manquant), sans altération', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'PartialReject', last_name: 'Lamal', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 3000,
    acq_commission_rate: 4, status: 'actif',
    lamal: { care_model: 'standard', deductible: 300, canton: 'VD' },
  });
  const id = created.body.id;

  const commissionsBefore = await auth(request(app).get('/api/commissions'));
  const acqBefore = commissionsBefore.body.find((c) => c.contract_id === id && c.type === 'acquisition');

  const missingCareModel = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ lamal: { deductible: 500 } });
  assert.equal(missingCareModel.status, 400, 'un objet LAMal sans care_model doit être rejeté (pas de mise à jour partielle)');

  const missingDeductible = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ lamal: { care_model: 'hmo' } });
  assert.equal(missingDeductible.status, 400, 'un objet LAMal sans deductible doit être rejeté (pas de mise à jour partielle)');

  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.lamal.care_model, 'standard', 'les détails LAMal existants ne doivent pas être altérés');
  assert.equal(row.lamal.deductible, 300);
  assert.equal(row.lamal.canton, 'VD');
  assert.equal(row.annual_premium, 3000, 'le contrat générique ne doit pas être altéré');

  const commissionsAfter = await auth(request(app).get('/api/commissions'));
  const acqAfter = commissionsAfter.body.find((c) => c.contract_id === id && c.type === 'acquisition');
  assert.equal(acqAfter.amount, acqBefore.amount, 'les commissions ne doivent pas être altérées');

  const log = await auth(request(app).get('/api/compliance/audit-log?q=modification détails LAMal'));
  assert.ok(
    !log.body.find((l) => l.entity_id === id && l.action === 'modification détails LAMal'),
    'aucune entrée d’audit de modification LAMal ne doit être créée après un rejet'
  );
});

test('LAMal — rollback logique d’un PUT combinant champ générique valide et bloc LAMal invalide', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'Rollback', last_name: 'LamalGeneric', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 3000,
    acq_commission_rate: 4, status: 'actif',
    lamal: { care_model: 'standard', deductible: 300 },
  });
  const id = created.body.id;

  const commissionsBefore = await auth(request(app).get('/api/commissions'));
  const acqBefore = commissionsBefore.body.find((c) => c.contract_id === id && c.type === 'acquisition');

  const res = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ notes: 'note générique modifiée', lamal: { care_model: 'invalide', deductible: 300 } });
  assert.equal(res.status, 400, 'la requête combinée doit être rejetée dans son ensemble');

  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.notEqual(row.notes, 'note générique modifiée', 'le champ générique ne doit pas avoir changé');
  assert.equal(row.lamal.care_model, 'standard', 'le bloc LAMal ne doit pas avoir changé');
  assert.equal(row.lamal.deductible, 300);

  const commissionsAfter = await auth(request(app).get('/api/commissions'));
  const acqAfter = commissionsAfter.body.find((c) => c.contract_id === id && c.type === 'acquisition');
  assert.equal(acqAfter.amount, acqBefore.amount, 'les commissions ne doivent pas avoir changé');

  const log = await auth(request(app).get('/api/compliance/audit-log?q=modification'));
  assert.ok(
    !log.body.find((l) => l.entity_id === id && (l.action === 'modification contrat' || l.action === 'modification détails LAMal')),
    'aucune entrée d’audit de modification ne doit être créée après un rejet atomique'
  );
});

test('LAMal — rejet d’un tariff_region dépassant 20 caractères', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'TooLong', last_name: 'Lamal', status: 'client',
  });
  const before = (await auth(request(app).get('/api/contracts'))).body.length;
  const res = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'lamal', annual_premium: 3000,
    lamal: { care_model: 'standard', deductible: 300, tariff_region: 'x'.repeat(21) },
  });
  assert.equal(res.status, 400, 'tariff_region de 21 caractères doit être rejeté (limite = 20)');
  const after = (await auth(request(app).get('/api/contracts'))).body.length;
  assert.equal(after, before, 'aucun contrat ne doit être créé si tariff_region dépasse la limite');
});

test('Vie — rejet de component_type: null en PUT sur une ligne existante, sans altération', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'PutNull', last_name: 'Vie', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'vie_3a', annual_premium: 2400,
    acq_commission_rate: 5, status: 'actif',
    life: { component_type: 'mixte', insured_death_capital: 50000 },
  });
  const id = created.body.id;

  const commissionsBefore = await auth(request(app).get('/api/commissions'));
  const acqBefore = commissionsBefore.body.find((c) => c.contract_id === id && c.type === 'acquisition');

  const res = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ life: { component_type: null } });
  assert.equal(res.status, 400, 'component_type: null doit être rejeté en PUT');

  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.life.component_type, 'mixte', 'la ligne vie ne doit pas être altérée');
  assert.equal(row.life.insured_death_capital, 50000);
  assert.equal(row.annual_premium, 2400, 'le contrat générique ne doit pas être altéré');

  const commissionsAfter = await auth(request(app).get('/api/commissions'));
  const acqAfter = commissionsAfter.body.find((c) => c.contract_id === id && c.type === 'acquisition');
  assert.equal(acqAfter.amount, acqBefore.amount, 'les commissions ne doivent pas être altérées');

  const log = await auth(request(app).get('/api/compliance/audit-log?q=modification détails vie'));
  assert.ok(
    !log.body.find((l) => l.entity_id === id && l.action === 'modification détails vie'),
    'aucune entrée d’audit de modification vie ne doit être créée après un rejet'
  );
});

test('Vie — rejet d’une valeur non booléenne invalide pour premium_waiver', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'BadBool', last_name: 'Vie', status: 'client',
  });
  const before = (await auth(request(app).get('/api/contracts'))).body.length;
  const res = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'vie_3a', annual_premium: 2400,
    life: { component_type: 'mixte', premium_waiver: 'oui' },
  });
  assert.equal(res.status, 400, 'premium_waiver="oui" doit être rejeté (booléen strict attendu)');
  const after = (await auth(request(app).get('/api/contracts'))).body.length;
  assert.equal(after, before, 'aucun contrat ne doit être créé si premium_waiver est invalide');
});

test('Incapacité — rejet de benefit_type: null en PUT sur une ligne existante, sans altération', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'PutNull', last_name: 'Incap', status: 'client',
  });
  const created = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: 1, branch: 'incapacite', annual_premium: 1500,
    acq_commission_rate: 5, status: 'actif',
    income_protection: { benefit_type: 'rente', insured_amount: 60000 },
  });
  const id = created.body.id;

  const commissionsBefore = await auth(request(app).get('/api/commissions'));
  const acqBefore = commissionsBefore.body.find((c) => c.contract_id === id && c.type === 'acquisition');

  const res = await auth(request(app).put(`/api/contracts/${id}`))
    .send({ income_protection: { benefit_type: null } });
  assert.equal(res.status, 400, 'benefit_type: null doit être rejeté en PUT');

  const row = (await auth(request(app).get('/api/contracts'))).body.find((c) => c.id === id);
  assert.equal(row.income_protection.benefit_type, 'rente', 'la ligne incapacité ne doit pas être altérée');
  assert.equal(row.income_protection.insured_amount, 60000);
  assert.equal(row.annual_premium, 1500, 'le contrat générique ne doit pas être altéré');

  const commissionsAfter = await auth(request(app).get('/api/commissions'));
  const acqAfter = commissionsAfter.body.find((c) => c.contract_id === id && c.type === 'acquisition');
  assert.equal(acqAfter.amount, acqBefore.amount, 'les commissions ne doivent pas être altérées');

  const log = await auth(request(app).get('/api/compliance/audit-log?q=modification détails incapacité'));
  assert.ok(
    !log.body.find((l) => l.entity_id === id && l.action === 'modification détails incapacité de gain'),
    'aucune entrée d’audit de modification incapacité ne doit être créée après un rejet'
  );
});

test('Incapacité — rejet de valeurs non booléennes invalides pour coordination_ai_lpp et premium_waiver', async () => {
  const client = await auth(request(app).post('/api/clients')).send({
    first_name: 'BadBool', last_name: 'Incap', status: 'client',
  });
  const base = { client_id: client.body.id, company_id: 1, branch: 'incapacite', annual_premium: 1500 };
  const before = (await auth(request(app).get('/api/contracts'))).body.length;

  const badCoordination = await auth(request(app).post('/api/contracts'))
    .send({ ...base, income_protection: { benefit_type: 'rente', coordination_ai_lpp: 'oui' } });
  assert.equal(badCoordination.status, 400, 'coordination_ai_lpp="oui" doit être rejeté (booléen strict attendu)');

  const badPremiumWaiver = await auth(request(app).post('/api/contracts'))
    .send({ ...base, income_protection: { benefit_type: 'rente', premium_waiver: 'oui' } });
  assert.equal(badPremiumWaiver.status, 400, 'premium_waiver="oui" doit être rejeté (booléen strict attendu)');

  const after = (await auth(request(app).get('/api/contracts'))).body.length;
  assert.equal(after, before, 'aucun contrat ne doit être créé si coordination_ai_lpp/premium_waiver est invalide');
});
