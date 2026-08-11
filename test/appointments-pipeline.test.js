// Tests du service métier isolé server/appointments-pipeline.js (lot A2d1).
// Tests unitaires/DB : pas d'Express, pas de supertest — appel direct de la
// fonction avec une base SQLite temporaire (CRM_DATA_DIR), comme les autres
// tests de ce dépôt. Le service n'est appelé par aucune route à ce stade.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-appointments-pipeline-'));
process.env.NODE_ENV = 'test';

const { default: db } = await import('../server/db.js');
const { syncPipelineOnAppointmentBooked } = await import('../server/appointments-pipeline.js');

function makeClient(status = 'prospect') {
  return db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Test', 'Pipeline', ?)")
    .run(status).lastInsertRowid;
}

function makeLead(clientId, pipelineStage) {
  db.prepare('INSERT INTO lead_details (client_id, pipeline_stage) VALUES (?, ?)').run(clientId, pipelineStage);
}

function countAll(table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

before(() => {
  // Sanity check sur les tables annexes dont on va vérifier l'absence
  // d'effet de bord — doivent exister dans le schéma.
  assert.equal(countAll('tasks'), 0);
  assert.equal(countAll('activities'), 0);
  assert.equal(countAll('action_log'), 0);
});

// -- 1. prospect + nouveau -> rdv ------------------------------------------
test('prospect + stage nouveau -> rdv', () => {
  const clientId = makeClient('prospect');
  makeLead(clientId, 'nouveau');

  const result = syncPipelineOnAppointmentBooked(db, clientId);
  assert.deepEqual(result, { changed: true, previousStage: 'nouveau', nextStage: 'rdv', reason: result.reason });
  assert.ok(result.reason.length > 0);

  const lead = db.prepare('SELECT pipeline_stage FROM lead_details WHERE client_id = ?').get(clientId);
  assert.equal(lead.pipeline_stage, 'rdv');
});

// -- 2. prospect + contacte -> rdv ------------------------------------------
test('prospect + stage contacte -> rdv', () => {
  const clientId = makeClient('prospect');
  makeLead(clientId, 'contacte');

  const result = syncPipelineOnAppointmentBooked(db, clientId);
  assert.equal(result.changed, true);
  assert.equal(result.previousStage, 'contacte');
  assert.equal(result.nextStage, 'rdv');

  const lead = db.prepare('SELECT pipeline_stage FROM lead_details WHERE client_id = ?').get(clientId);
  assert.equal(lead.pipeline_stage, 'rdv');
});

// -- 3. prospect + rdv -> aucun changement (idempotent) ----------------------
test('prospect + stage rdv -> aucun changement', () => {
  const clientId = makeClient('prospect');
  makeLead(clientId, 'rdv');

  const result = syncPipelineOnAppointmentBooked(db, clientId);
  assert.equal(result.changed, false);
  assert.equal(result.previousStage, 'rdv');
  assert.equal(result.nextStage, 'rdv');

  const lead = db.prepare('SELECT pipeline_stage FROM lead_details WHERE client_id = ?').get(clientId);
  assert.equal(lead.pipeline_stage, 'rdv');
});

// -- 4-7. anti-régression : analyse/offre/signe/perdu ne reculent jamais ----
for (const stage of ['analyse', 'offre', 'signe', 'perdu']) {
  test(`prospect + stage ${stage} -> aucun recul`, () => {
    const clientId = makeClient('prospect');
    makeLead(clientId, stage);

    const result = syncPipelineOnAppointmentBooked(db, clientId);
    assert.equal(result.changed, false);
    assert.equal(result.previousStage, stage);
    assert.equal(result.nextStage, stage);

    const lead = db.prepare('SELECT pipeline_stage FROM lead_details WHERE client_id = ?').get(clientId);
    assert.equal(lead.pipeline_stage, stage, `le stage ${stage} ne doit jamais reculer vers rdv`);
  });
}

// -- 8. client status='client' -> aucun changement --------------------------
test("client status='client' -> aucun changement", () => {
  const clientId = makeClient('client');
  makeLead(clientId, 'nouveau');

  const result = syncPipelineOnAppointmentBooked(db, clientId);
  assert.equal(result.changed, false);

  const lead = db.prepare('SELECT pipeline_stage FROM lead_details WHERE client_id = ?').get(clientId);
  assert.equal(lead.pipeline_stage, 'nouveau', 'un client non prospect ne doit jamais être modifié');
});

// -- 9. client status='ancien' -> aucun changement ---------------------------
test("client status='ancien' -> aucun changement", () => {
  const clientId = makeClient('ancien');
  makeLead(clientId, 'nouveau');

  const result = syncPipelineOnAppointmentBooked(db, clientId);
  assert.equal(result.changed, false);

  const lead = db.prepare('SELECT pipeline_stage FROM lead_details WHERE client_id = ?').get(clientId);
  assert.equal(lead.pipeline_stage, 'nouveau');
});

// -- 10. client inexistant ---------------------------------------------------
test('client inexistant -> résultat explicite, aucune écriture', () => {
  const result = syncPipelineOnAppointmentBooked(db, 999999);
  assert.equal(result.changed, false);
  assert.equal(result.previousStage, null);
  assert.equal(result.nextStage, null);
  assert.ok(result.reason.length > 0);

  const lead = db.prepare('SELECT * FROM lead_details WHERE client_id = ?').get(999999);
  assert.equal(lead, undefined, 'aucune ligne lead_details ne doit être créée pour un client inexistant');
});

// -- 11. lead_details absent : conforme au comportement réel de today.js ----
test('lead_details absent + prospect -> création avec pipeline_stage=rdv (comportement réel de today.js)', () => {
  const clientId = makeClient('prospect');
  const before2 = db.prepare('SELECT * FROM lead_details WHERE client_id = ?').get(clientId);
  assert.equal(before2, undefined, 'précondition : aucune ligne lead_details avant l’appel');

  const result = syncPipelineOnAppointmentBooked(db, clientId);
  assert.equal(result.changed, true);
  assert.equal(result.previousStage, 'nouveau', 'un client sans lead_details est traité comme "nouveau", même convention que prospects.js/today.js');
  assert.equal(result.nextStage, 'rdv');

  const lead = db.prepare('SELECT * FROM lead_details WHERE client_id = ?').get(clientId);
  assert.ok(lead, 'une ligne lead_details doit être créée, comme le fait déjà today.js');
  assert.equal(lead.pipeline_stage, 'rdv');
});

// -- 12. deux appels successifs -> le second est idempotent ------------------
test('deux appels successifs -> le second est idempotent', () => {
  const clientId = makeClient('prospect');
  makeLead(clientId, 'nouveau');

  const first = syncPipelineOnAppointmentBooked(db, clientId);
  assert.equal(first.changed, true);
  assert.equal(first.nextStage, 'rdv');

  const second = syncPipelineOnAppointmentBooked(db, clientId);
  assert.equal(second.changed, false);
  assert.equal(second.previousStage, 'rdv');
  assert.equal(second.nextStage, 'rdv');

  const lead = db.prepare('SELECT pipeline_stage FROM lead_details WHERE client_id = ?').get(clientId);
  assert.equal(lead.pipeline_stage, 'rdv');
});

// -- Absence d'effets de bord -------------------------------------------------
test('aucune tâche, aucune activity, aucun action_log créés par le service', () => {
  const before2 = {
    tasks: countAll('tasks'),
    activities: countAll('activities'),
    action_log: countAll('action_log'),
  };

  const clientId = makeClient('prospect');
  makeLead(clientId, 'nouveau');
  syncPipelineOnAppointmentBooked(db, clientId);
  syncPipelineOnAppointmentBooked(db, clientId); // second appel, y compris idempotent

  assert.equal(countAll('tasks'), before2.tasks, 'aucune tâche ne doit être créée par ce service');
  assert.equal(countAll('activities'), before2.activities, 'aucune activity ne doit être créée par ce service');
  assert.equal(countAll('action_log'), before2.action_log, 'aucun action_log ne doit être créé par ce service');
});

test('aucune autre donnée client modifiée', () => {
  const clientId = makeClient('prospect');
  makeLead(clientId, 'nouveau');
  const before2 = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);

  syncPipelineOnAppointmentBooked(db, clientId);

  const after = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  assert.deepEqual(after, before2, 'le service ne doit modifier aucun champ de clients, uniquement lead_details.pipeline_stage');
});
