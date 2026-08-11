// Test d'intégration du raccordement POST /api/today/result (result =
// 'rdv_pris') → service pipeline commun (lot A2d3). Utilise la VRAIE
// application server/app.js (comme test/api.test.js, qui teste déjà
// aujourd'hui le workflow « plan d'action quotidien »), pour vérifier le
// comportement réel via l'API, sans dupliquer la grosse suite existante.
//
// Objectif : prouver que today.js n'implémente plus sa propre logique de
// mutation pipeline (upsert manuel écrasant toujours vers 'rdv') mais
// délègue entièrement à syncPipelineOnAppointmentBooked (server/
// appointments-pipeline.js, lot A2d1), avec la même protection
// anti-régression que POST /api/appointments (lot A2d2).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-today-pipeline-'));
process.env.NODE_ENV = 'test';

const { default: app } = await import('../server/app.js');
const { default: db } = await import('../server/db.js');

const PASSWORD = 'MotDePasseDeTest!42';
let cookie = '';

before(async () => {
  const res = await request(app)
    .post('/api/auth/setup')
    .send({ email: 'test-today-pipeline@exemple.ch', name: 'Testeur', password: PASSWORD });
  assert.equal(res.status, 200);
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
});

function auth(req) {
  return req.set('Cookie', cookie);
}

function makeClient(status = 'prospect') {
  return db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Test', 'TodayPipeline', ?)")
    .run(status).lastInsertRowid;
}

function makeLead(clientId, pipelineStage) {
  db.prepare('INSERT INTO lead_details (client_id, pipeline_stage) VALUES (?, ?)').run(clientId, pipelineStage);
}

function stageOf(clientId) {
  return db.prepare('SELECT pipeline_stage FROM lead_details WHERE client_id = ?').get(clientId)?.pipeline_stage;
}

async function postResult(clientId, result, extra = {}) {
  return auth(request(app).post('/api/today/result')).send({
    action_key: `test:${clientId}:${Date.now()}:${Math.random()}`,
    action_type: 'confirmation_rdv',
    client_id: clientId,
    result,
    ...extra,
  });
}

// -- 1-7. matrice stage avant -> rdv_pris -> stage après --------------------
const STAGE_MATRIX = [
  { before: 'nouveau', after: 'rdv' },
  { before: 'contacte', after: 'rdv' },
  { before: 'rdv', after: 'rdv' },
  { before: 'analyse', after: 'analyse' },
  { before: 'offre', after: 'offre' },
  { before: 'signe', after: 'signe' },
  { before: 'perdu', after: 'perdu' },
];

for (const { before: beforeStage, after } of STAGE_MATRIX) {
  test(`prospect + stage ${beforeStage} + rdv_pris -> ${after}`, async () => {
    const clientId = makeClient('prospect');
    makeLead(clientId, beforeStage);

    const res = await postResult(clientId, 'rdv_pris');
    assert.equal(res.status, 200);
    assert.equal(stageOf(clientId), after);
  });
}

// -- 8. prospect sans lead_details -------------------------------------------
test('prospect sans lead_details + rdv_pris -> lead_details créé avec rdv', async () => {
  const clientId = makeClient('prospect');
  assert.equal(stageOf(clientId), undefined, 'précondition : aucune ligne lead_details');

  const res = await postResult(clientId, 'rdv_pris');
  assert.equal(res.status, 200);
  assert.equal(stageOf(clientId), 'rdv');
});

// -- 9, 10. clients non prospects --------------------------------------------
for (const status of ['client', 'ancien']) {
  test(`status client='${status}' + rdv_pris -> aucune mutation pipeline`, async () => {
    const clientId = makeClient(status);
    makeLead(clientId, 'nouveau');

    const res = await postResult(clientId, 'rdv_pris');
    assert.equal(res.status, 200);
    assert.equal(stageOf(clientId), 'nouveau', `un client status=${status} ne doit jamais être synchronisé`);
  });
}

// -- Non-régression des effets historiques de rdv_pris -----------------------
test('rdv_pris conserve intégralement ses effets historiques (action_log, activity, tâche, audit)', async () => {
  const clientId = makeClient('prospect');
  makeLead(clientId, 'nouveau');

  const beforeCounts = {
    action_log: db.prepare('SELECT COUNT(*) AS n FROM action_log').get().n,
    activities: db.prepare('SELECT COUNT(*) AS n FROM activities').get().n,
    tasks: db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,
    audit_log: db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n,
  };

  const res = await postResult(clientId, 'rdv_pris', { note: 'RDV jeudi 14h' });
  assert.equal(res.status, 200);
  assert.ok(res.body.next.includes('RDV'), 'le message de prochaine étape est inchangé');

  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM action_log').get().n,
    beforeCounts.action_log + 1,
    'action_log doit toujours être créé'
  );
  const activity = db
    .prepare("SELECT * FROM activities WHERE client_id = ? ORDER BY id DESC LIMIT 1")
    .get(clientId);
  assert.ok(activity && activity.content.includes('Rendez-vous pris'), 'activity toujours journalisée');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM activities').get().n,
    beforeCounts.activities + 1
  );

  const task = db
    .prepare("SELECT * FROM tasks WHERE client_id = ? ORDER BY id DESC LIMIT 1")
    .get(clientId);
  assert.ok(task, 'la tâche de préparation doit toujours être créée');
  assert.ok(task.title.includes('Préparer et confirmer le RDV'), 'titre de tâche inchangé');
  assert.equal(task.priority, 'haute', 'priorité de tâche inchangée');
  const expectedDue = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  assert.equal(task.due_date, expectedDue, 'échéance à J+1 inchangée');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,
    beforeCounts.tasks + 1,
    'une seule tâche créée (pas de doublon)'
  );

  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n,
    beforeCounts.audit_log + 1,
    'audit existant toujours généré'
  );
  const auditRow = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 1').get();
  assert.equal(auditRow.action, 'résultat action commerciale');
});

// -- Autre résultat non affecté par A2d3 -------------------------------------
test("le résultat 'pas_joint' reste inchangé (autre branche du workflow non affectée)", async () => {
  const clientId = makeClient('prospect');
  makeLead(clientId, 'analyse');

  const res = await postResult(clientId, 'pas_joint');
  assert.equal(res.status, 200);
  assert.ok(res.body.next.includes('Rappeler'));

  assert.equal(stageOf(clientId), 'analyse', 'pas_joint ne doit jamais toucher au pipeline');
  const task = db
    .prepare("SELECT * FROM tasks WHERE client_id = ? ORDER BY id DESC LIMIT 1")
    .get(clientId);
  assert.ok(task.title.includes('Rappeler'));
  assert.equal(task.priority, 'normale');
  const expectedDue = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  assert.equal(task.due_date, expectedDue, 'échéance à J+2 inchangée pour pas_joint');
});

// -- Aucun appointment fictif créé -------------------------------------------
test("rdv_pris ne crée jamais de ligne dans appointments (pas de date/heure disponible)", async () => {
  const clientId = makeClient('prospect');
  makeLead(clientId, 'nouveau');
  const before2 = db.prepare('SELECT COUNT(*) AS n FROM appointments').get().n;

  await postResult(clientId, 'rdv_pris');

  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM appointments').get().n,
    before2,
    'today.js ne doit jamais insérer dans appointments'
  );
});

// -- Cohérence des deux chemins (A2d2 et A2d3 partagent le même service) ----
test('POST /api/appointments (booked) et POST /api/today/result (rdv_pris) appliquent la même protection anti-régression', async () => {
  const clientViaAppointment = makeClient('prospect');
  makeLead(clientViaAppointment, 'analyse');
  const clientViaToday = makeClient('prospect');
  makeLead(clientViaToday, 'analyse');

  const apptRes = await auth(request(app).post('/api/appointments')).send({
    client_id: clientViaAppointment,
    starts_at: '2026-09-20 09:00:00',
    ends_at: '2026-09-20 09:30:00',
  });
  assert.equal(apptRes.status, 201);

  const todayRes = await postResult(clientViaToday, 'rdv_pris');
  assert.equal(todayRes.status, 200);

  assert.equal(stageOf(clientViaAppointment), 'analyse', 'chemin A (POST /api/appointments) : aucune régression');
  assert.equal(stageOf(clientViaToday), 'analyse', 'chemin B (POST /api/today/result) : aucune régression');
  assert.equal(
    stageOf(clientViaAppointment),
    stageOf(clientViaToday),
    'les deux chemins doivent produire exactement le même résultat pour un état de départ identique'
  );
});
