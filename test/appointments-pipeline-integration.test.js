// Test d'intégration du raccordement POST /api/appointments → pipeline
// (lot A2d2). Utilise le VRAI routeur appointments.js (harnais isolé, même
// convention que test/appointments.test.js — pas server/app.js) pour
// vérifier le comportement de bout en bout via l'API, sans dupliquer les
// 30 tests métier de A2b ni les 14 tests unitaires du service (A2d1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import session from 'express-session';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-appointments-pipeline-integration-'));
process.env.NODE_ENV = 'test';

const { default: db } = await import('../server/db.js');
const { appointmentsRouter } = await import('../server/routes/appointments.js');
const { validationErrors } = await import('../server/validate.js');

function errorHandler(err, req, res, next) {
  if (err) return res.status(500).json({ error: 'Erreur interne du serveur.' });
  next();
}

function buildAuthedApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true }));
  app.use((req, res, next) => {
    req.session.userId = 1;
    req.session.userEmail = 'test@exemple.ch';
    next();
  });
  app.use('/api/appointments', appointmentsRouter);
  app.use(validationErrors);
  app.use(errorHandler);
  return app;
}

const app = buildAuthedApp();

function makeClient(status = 'prospect') {
  return db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Test', 'Sync', ?)")
    .run(status).lastInsertRowid;
}

function makeLead(clientId, pipelineStage) {
  db.prepare('INSERT INTO lead_details (client_id, pipeline_stage) VALUES (?, ?)').run(clientId, pipelineStage);
}

function stageOf(clientId) {
  return db.prepare('SELECT pipeline_stage FROM lead_details WHERE client_id = ?').get(clientId)?.pipeline_stage;
}

function counts() {
  return {
    appointments: db.prepare('SELECT COUNT(*) AS n FROM appointments').get().n,
    tasks: db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,
    activities: db.prepare('SELECT COUNT(*) AS n FROM activities').get().n,
    action_log: db.prepare('SELECT COUNT(*) AS n FROM action_log').get().n,
  };
}

let seq = 0;
function nextSlot() {
  // Chaque test réserve un créneau distinct pour éviter toute collision
  // fortuite avec le CHECK ends_at > starts_at ou entre tests.
  seq += 1;
  const day = String(10 + seq).padStart(2, '0');
  return {
    starts_at: `2026-09-${day} 09:00:00`,
    ends_at: `2026-09-${day} 09:30:00`,
  };
}

// -- 1-7. matrice stage avant -> POST booked -> stage après ----------------
const STAGE_MATRIX = [
  { before: 'nouveau', after: 'rdv', label: 'nouveau -> rdv' },
  { before: 'contacte', after: 'rdv', label: 'contacte -> rdv' },
  { before: 'rdv', after: 'rdv', label: 'rdv -> rdv (idempotent)' },
  { before: 'analyse', after: 'analyse', label: 'analyse -> analyse (pas de recul)' },
  { before: 'offre', after: 'offre', label: 'offre -> offre (pas de recul)' },
  { before: 'signe', after: 'signe', label: 'signe -> signe (pas de recul)' },
  { before: 'perdu', after: 'perdu', label: 'perdu -> perdu (pas de recul)' },
];

for (const { before: beforeStage, after, label } of STAGE_MATRIX) {
  test(`prospect + stage ${beforeStage} + POST booked -> ${label}`, async () => {
    const clientId = makeClient('prospect');
    makeLead(clientId, beforeStage);
    const slot = nextSlot();

    const res = await request(app).post('/api/appointments').send({ client_id: clientId, ...slot });
    assert.equal(res.status, 201);
    assert.equal(stageOf(clientId), after);
  });
}

// -- 8. client status='client' + POST booked -> pipeline inchangé -----------
test("client status='client' + POST booked -> pipeline inchangé", async () => {
  const clientId = makeClient('client');
  makeLead(clientId, 'nouveau');
  const slot = nextSlot();

  const res = await request(app).post('/api/appointments').send({ client_id: clientId, ...slot });
  assert.equal(res.status, 201);
  assert.equal(stageOf(clientId), 'nouveau', 'un client non prospect ne doit jamais être synchronisé');
});

// -- 9. prospect sans lead_details + POST booked -----------------------------
test('prospect sans lead_details + POST booked -> lead_details créé avec rdv', async () => {
  const clientId = makeClient('prospect');
  assert.equal(stageOf(clientId), undefined, 'précondition : aucune ligne lead_details');
  const slot = nextSlot();

  const res = await request(app).post('/api/appointments').send({ client_id: clientId, ...slot });
  assert.equal(res.status, 201);
  assert.equal(stageOf(clientId), 'rdv');
});

// -- 10. POST sans champ status -> default booked -> synchronisation -------
test('POST sans champ status -> default booked -> synchronisation effectuée', async () => {
  const clientId = makeClient('prospect');
  makeLead(clientId, 'nouveau');
  const slot = nextSlot();

  const res = await request(app).post('/api/appointments').send({ client_id: clientId, ...slot });
  assert.equal(res.status, 201);
  const row = db.prepare('SELECT status FROM appointments WHERE id = ?').get(res.body.id);
  assert.equal(row.status, 'booked', 'défaut SQL attendu');
  assert.equal(stageOf(clientId), 'rdv');
});

// -- 11-14. autres statuts -> aucune synchronisation ------------------------
for (const status of ['confirmed', 'completed', 'no_show', 'cancelled']) {
  test(`POST status='${status}' -> aucune synchronisation`, async () => {
    const clientId = makeClient('prospect');
    makeLead(clientId, 'nouveau');
    const slot = nextSlot();

    const res = await request(app).post('/api/appointments').send({ client_id: clientId, status, ...slot });
    assert.equal(res.status, 201);
    assert.equal(stageOf(clientId), 'nouveau', `status=${status} ne doit déclencher aucune synchronisation`);
  });
}

// -- 15. POST invalide / appointment non créé -> pipeline ne change pas ----
test('POST invalide (client inexistant) -> aucun appointment créé, pipeline ne change pas', async () => {
  const before2 = counts();
  const slot = nextSlot();

  const res = await request(app).post('/api/appointments').send({ client_id: 999999, ...slot });
  assert.equal(res.status, 400);

  const after = counts();
  assert.equal(after.appointments, before2.appointments, 'aucun appointment ne doit avoir été créé');
  assert.equal(stageOf(999999), undefined, 'aucune ligne lead_details ne doit exister pour un client inexistant');
});

// -- 16. PUT vers booked -> aucune synchronisation dans A2d2 -----------------
test("PUT d'un appointment existant vers status=booked -> aucune synchronisation dans A2d2", async () => {
  const clientId = makeClient('prospect');
  makeLead(clientId, 'nouveau');
  const slot = nextSlot();

  const created = await request(app)
    .post('/api/appointments')
    .send({ client_id: clientId, status: 'confirmed', ...slot });
  assert.equal(created.status, 201);
  assert.equal(stageOf(clientId), 'nouveau', 'confirmed à la création ne synchronise pas');

  const put = await request(app).put(`/api/appointments/${created.body.id}`).send({ status: 'booked' });
  assert.equal(put.status, 200);
  assert.equal(stageOf(clientId), 'nouveau', 'PUT vers booked ne doit déclencher aucune synchronisation dans ce lot');
});

// -- 17. plusieurs appointments booked successifs -> idempotent -------------
test('plusieurs rendez-vous booked successifs pour le même client -> idempotent, pas de régression', async () => {
  const clientId = makeClient('prospect');
  makeLead(clientId, 'nouveau');

  const first = await request(app).post('/api/appointments').send({ client_id: clientId, ...nextSlot() });
  assert.equal(first.status, 201);
  assert.equal(stageOf(clientId), 'rdv');

  const second = await request(app).post('/api/appointments').send({ client_id: clientId, ...nextSlot() });
  assert.equal(second.status, 201);
  assert.equal(stageOf(clientId), 'rdv', 'un second rendez-vous booked doit rester idempotent (toujours rdv)');

  const rows = db.prepare('SELECT COUNT(*) AS n FROM appointments WHERE client_id = ?').get(clientId).n;
  assert.equal(rows, 2, 'les deux rendez-vous doivent bien exister');
});

// -- 18, 19, 20. aucun effet de bord additionnel -----------------------------
test('A2d2 ne crée aucune task, activity ou action_log supplémentaire', async () => {
  const clientId = makeClient('prospect');
  makeLead(clientId, 'nouveau');
  const before2 = counts();

  await request(app).post('/api/appointments').send({ client_id: clientId, ...nextSlot() });

  const after = counts();
  assert.equal(after.tasks, before2.tasks, 'aucune tâche ne doit être créée par A2d2');
  assert.equal(after.activities, before2.activities, 'aucune activity ne doit être créée par A2d2');
  assert.equal(after.action_log, before2.action_log, 'aucun action_log ne doit être créé par A2d2');
});

// -- Traçabilité dans l'audit existant (sans modifier audit()) --------------
test('le résultat de la synchronisation est visible dans les détails de l’audit existant', async () => {
  const clientId = makeClient('prospect');
  makeLead(clientId, 'nouveau');

  const res = await request(app).post('/api/appointments').send({ client_id: clientId, ...nextSlot() });
  assert.equal(res.status, 201);

  const auditRow = db
    .prepare("SELECT * FROM audit_log WHERE entity = 'appointment' AND entity_id = ? ORDER BY id DESC LIMIT 1")
    .get(res.body.id);
  assert.ok(auditRow);
  assert.match(auditRow.details, /pipeline nouveau → rdv/);
});
