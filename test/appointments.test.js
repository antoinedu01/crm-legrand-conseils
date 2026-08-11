// Tests d'intégration de l'API rendez-vous (node:test + supertest).
// Lot A2b — API isolée, NON montée dans server/app.js.
//
// Harnais Express isolé (même convention que test/campaigns.test.js, lot
// A1a) : le routeur est monté directement, sans importer ni modifier
// server/app.js. Base de test isolée (CRM_DATA_DIR temporaire).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import session from 'express-session';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-appointments-'));
process.env.NODE_ENV = 'test';

const { default: db } = await import('../server/db.js');
const { appointmentsRouter } = await import('../server/routes/appointments.js');
const { requireAuth } = await import('../server/auth.js');
const { validationErrors } = await import('../server/validate.js');

function errorHandler(err, req, res, next) {
  if (err) return res.status(500).json({ error: 'Erreur interne du serveur.' });
  next();
}

function buildUnauthApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true }));
  app.use('/api/appointments', requireAuth, appointmentsRouter);
  app.use(validationErrors);
  app.use(errorHandler);
  return app;
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
const unauthApp = buildUnauthApp();

let clientA, clientB;

before(() => {
  clientA = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Jean', 'Dupont', 'prospect')")
    .run().lastInsertRowid;
  clientB = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Marie', 'Curie', 'client')")
    .run().lastInsertRowid;
});

test('accès sans session refusé (401)', async () => {
  const res = await request(unauthApp).get('/api/appointments');
  assert.equal(res.status, 401);
});

// -- 1. GET liste vide --------------------------------------------------
test('GET / liste vide au départ', async () => {
  const res = await request(app).get('/api/appointments');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

// -- 2, 21, 22. POST valide, created_at/updated_at, audit ----------------
test('POST / crée un rendez-vous valide, avec created_at/updated_at cohérents et un audit', async () => {
  const res = await request(app)
    .post('/api/appointments')
    .send({ client_id: clientA, starts_at: '2026-09-04 09:30:00', ends_at: '2026-09-04 10:30:00' });
  assert.equal(res.status, 201);
  assert.ok(Number.isInteger(res.body.id));

  const row = db.prepare('SELECT * FROM appointments WHERE id = ?').get(res.body.id);
  assert.equal(row.client_id, clientA);
  assert.equal(row.starts_at, '2026-09-04 09:30:00');
  assert.equal(row.ends_at, '2026-09-04 10:30:00');
  assert.equal(row.status, 'booked');
  assert.equal(row.appointment_type, 'other');
  assert.equal(row.location_type, 'in_person');
  assert.ok(row.created_at);
  assert.ok(row.updated_at);

  const auditRow = db
    .prepare("SELECT * FROM audit_log WHERE entity = 'appointment' AND entity_id = ? ORDER BY id DESC LIMIT 1")
    .get(res.body.id);
  assert.ok(auditRow, 'la création doit être journalisée');
  assert.equal(auditRow.action, 'création rendez-vous');
  assert.equal(auditRow.user_email, 'test@exemple.ch');
});

// -- Démonstration explicite du format canonique stocké tel quel ---------
test('les timestamps sont stockés exactement sous la forme AAAA-MM-JJ HH:MM:SS et respectent le CHECK', async () => {
  const res = await request(app)
    .post('/api/appointments')
    .send({ client_id: clientA, starts_at: '2026-09-04 09:30:00', ends_at: '2026-09-04 10:30:00' });
  assert.equal(res.status, 201);
  const row = db.prepare('SELECT starts_at, ends_at FROM appointments WHERE id = ?').get(res.body.id);
  assert.equal(row.starts_at, '2026-09-04 09:30:00');
  assert.equal(row.ends_at, '2026-09-04 10:30:00');
  // Le CHECK (ends_at > starts_at) de la base a nécessairement été respecté
  // (sinon l'INSERT aurait levé une SqliteError et le status ne serait pas 201).
});

// -- 3. client inexistant --------------------------------------------------
test('POST / refuse un client_id inexistant (400)', async () => {
  const res = await request(app)
    .post('/api/appointments')
    .send({ client_id: 999999, starts_at: '2026-09-04 09:30:00', ends_at: '2026-09-04 10:30:00' });
  assert.equal(res.status, 400);
});

// -- 4, 5, 6. formats invalides ---------------------------------------------
test('POST / refuse starts_at invalide (400)', async () => {
  const res = await request(app)
    .post('/api/appointments')
    .send({ client_id: clientA, starts_at: 'pas une date', ends_at: '2026-09-04 10:30:00' });
  assert.equal(res.status, 400);
});

test('POST / refuse ends_at invalide (400)', async () => {
  const res = await request(app)
    .post('/api/appointments')
    .send({ client_id: clientA, starts_at: '2026-09-04 09:30:00', ends_at: 'pas une date' });
  assert.equal(res.status, 400);
});

test('POST / refuse les formats non canoniques (non paddé, slash, ISO avec T/Z)', async () => {
  const bad = ['2026-9-4 9:30:00', '04/09/2026 09:30:00', '2026-09-04T09:30:00Z', '2026-09-04'];
  for (const starts_at of bad) {
    const res = await request(app)
      .post('/api/appointments')
      .send({ client_id: clientA, starts_at, ends_at: '2026-09-04 10:30:00' });
    assert.equal(res.status, 400, `devrait refuser "${starts_at}"`);
  }
});

test('POST / refuse une date calendaire impossible (30 février)', async () => {
  const res = await request(app)
    .post('/api/appointments')
    .send({ client_id: clientA, starts_at: '2026-02-30 09:00:00', ends_at: '2026-02-30 10:00:00' });
  assert.equal(res.status, 400);
});

// -- 7. ends_at <= starts_at ------------------------------------------------
test('POST / refuse ends_at antérieur ou égal à starts_at (400)', async () => {
  const before2 = await request(app)
    .post('/api/appointments')
    .send({ client_id: clientA, starts_at: '2026-09-10 10:00:00', ends_at: '2026-09-10 09:00:00' });
  assert.equal(before2.status, 400);

  const equal = await request(app)
    .post('/api/appointments')
    .send({ client_id: clientA, starts_at: '2026-09-10 10:00:00', ends_at: '2026-09-10 10:00:00' });
  assert.equal(equal.status, 400);
});

// -- 8, 9, 10. enums invalides ------------------------------------------
test('POST / refuse un status inconnu (400)', async () => {
  const res = await request(app)
    .post('/api/appointments')
    .send({ client_id: clientA, starts_at: '2026-09-04 09:30:00', ends_at: '2026-09-04 10:30:00', status: 'not_a_status' });
  assert.equal(res.status, 400);
});

test('POST / refuse un appointment_type inconnu (400)', async () => {
  const res = await request(app)
    .post('/api/appointments')
    .send({ client_id: clientA, starts_at: '2026-09-04 09:30:00', ends_at: '2026-09-04 10:30:00', appointment_type: 'inconnu' });
  assert.equal(res.status, 400);
});

test('POST / refuse un location_type inconnu (400)', async () => {
  const res = await request(app)
    .post('/api/appointments')
    .send({ client_id: clientA, starts_at: '2026-09-04 09:30:00', ends_at: '2026-09-04 10:30:00', location_type: 'inconnu' });
  assert.equal(res.status, 400);
});

// -- 11, 12. GET /:id ------------------------------------------------------
test('GET /:id retourne le rendez-vous avec informations client', async () => {
  const created = await request(app)
    .post('/api/appointments')
    .send({ client_id: clientB, starts_at: '2026-09-05 08:00:00', ends_at: '2026-09-05 08:30:00' });
  const res = await request(app).get(`/api/appointments/${created.body.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.client_id, clientB);
  assert.equal(res.body.client_name, 'Marie Curie');
});

test('GET /:id inexistant -> 404', async () => {
  const res = await request(app).get('/api/appointments/999999');
  assert.equal(res.status, 404);
});

test('GET /:id invalide -> 400', async () => {
  const res = await request(app).get('/api/appointments/abc');
  assert.equal(res.status, 400);
});

// -- 13. PUT valide ----------------------------------------------------
test('PUT /:id modifie un rendez-vous valide', async () => {
  const created = await request(app)
    .post('/api/appointments')
    .send({ client_id: clientA, starts_at: '2026-09-06 10:00:00', ends_at: '2026-09-06 11:00:00' });
  const id = created.body.id;

  const res = await request(app).put(`/api/appointments/${id}`).send({ status: 'confirmed', notes: 'Confirmé par téléphone' });
  assert.equal(res.status, 200);

  const row = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  assert.equal(row.status, 'confirmed');
  assert.equal(row.notes, 'Confirmé par téléphone');

  const auditRow = db
    .prepare("SELECT * FROM audit_log WHERE entity = 'appointment' AND entity_id = ? AND action = 'modification rendez-vous' ORDER BY id DESC LIMIT 1")
    .get(id);
  assert.ok(auditRow, 'la modification doit être journalisée');
});

// -- 14. chronologie invalide après fusion --------------------------------
test('PUT /:id refuse une chronologie invalide après fusion avec l’existant (10:00→11:00, ends_at=09:30)', async () => {
  const created = await request(app)
    .post('/api/appointments')
    .send({ client_id: clientA, starts_at: '2026-09-07 10:00:00', ends_at: '2026-09-07 11:00:00' });
  const id = created.body.id;

  const res = await request(app).put(`/api/appointments/${id}`).send({ ends_at: '2026-09-07 09:30:00' });
  assert.equal(res.status, 400);

  const row = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  assert.equal(row.ends_at, '2026-09-07 11:00:00', 'la valeur ne doit pas avoir changé après un rejet 400');
});

test('PUT /:id refuse une chronologie invalide en ne changeant que starts_at (10:00→11:00, starts_at=11:30)', async () => {
  const created = await request(app)
    .post('/api/appointments')
    .send({ client_id: clientA, starts_at: '2026-09-08 10:00:00', ends_at: '2026-09-08 11:00:00' });
  const id = created.body.id;

  const res = await request(app).put(`/api/appointments/${id}`).send({ starts_at: '2026-09-08 11:30:00' });
  assert.equal(res.status, 400);
});

// -- 15. tentative de modification de client_id ---------------------------
test('PUT /:id ignore silencieusement client_id (immuable après création)', async () => {
  const created = await request(app)
    .post('/api/appointments')
    .send({ client_id: clientA, starts_at: '2026-09-09 10:00:00', ends_at: '2026-09-09 11:00:00' });
  const id = created.body.id;

  const res = await request(app).put(`/api/appointments/${id}`).send({ client_id: clientB, status: 'confirmed' });
  assert.equal(res.status, 200, 'la requête réussit car status est un champ modifiable valide');

  const row = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  assert.equal(row.client_id, clientA, 'client_id ne doit jamais changer via PUT');
  assert.equal(row.status, 'confirmed');
});

// -- 16. body PUT sans champ autorisé -------------------------------------
test('PUT /:id avec uniquement client_id (aucun champ modifiable réel) -> 400', async () => {
  const created = await request(app)
    .post('/api/appointments')
    .send({ client_id: clientA, starts_at: '2026-09-11 10:00:00', ends_at: '2026-09-11 11:00:00' });
  const id = created.body.id;

  const res = await request(app).put(`/api/appointments/${id}`).send({ client_id: clientB });
  assert.equal(res.status, 400);
});

test('PUT /:id avec un corps vide -> 400', async () => {
  const created = await request(app)
    .post('/api/appointments')
    .send({ client_id: clientA, starts_at: '2026-09-12 10:00:00', ends_at: '2026-09-12 11:00:00' });
  const id = created.body.id;

  const res = await request(app).put(`/api/appointments/${id}`).send({});
  assert.equal(res.status, 400);
});

test('PUT /:id sur un rendez-vous inexistant -> 404', async () => {
  const res = await request(app).put('/api/appointments/999999').send({ status: 'confirmed' });
  assert.equal(res.status, 404);
});

// -- 17, 18. plusieurs rendez-vous par client + filtre client_id ----------
test('plusieurs rendez-vous pour un même client, filtre client_id', async () => {
  const client = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Multi', 'Rdv', 'prospect')")
    .run().lastInsertRowid;
  await request(app).post('/api/appointments').send({ client_id: client, starts_at: '2026-10-01 09:00:00', ends_at: '2026-10-01 09:30:00' });
  await request(app).post('/api/appointments').send({ client_id: client, starts_at: '2026-10-02 09:00:00', ends_at: '2026-10-02 09:30:00' });

  const res = await request(app).get('/api/appointments').query({ client_id: client });
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
  assert.ok(res.body.every((a) => a.client_id === client));
});

// -- 19. filtre status ----------------------------------------------------
test('filtre status', async () => {
  const client = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Filtre', 'Status', 'prospect')")
    .run().lastInsertRowid;
  const a = await request(app).post('/api/appointments').send({ client_id: client, starts_at: '2026-10-05 09:00:00', ends_at: '2026-10-05 09:30:00' });
  await request(app).put(`/api/appointments/${a.body.id}`).send({ status: 'cancelled' });
  await request(app).post('/api/appointments').send({ client_id: client, starts_at: '2026-10-06 09:00:00', ends_at: '2026-10-06 09:30:00' });

  const res = await request(app).get('/api/appointments').query({ client_id: client, status: 'cancelled' });
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].status, 'cancelled');
});

test('filtre status invalide -> 400', async () => {
  const res = await request(app).get('/api/appointments').query({ status: 'inconnu' });
  assert.equal(res.status, 400);
});

// -- 20. filtres temporels from/to -----------------------------------------
test('filtres temporels from/to', async () => {
  const client = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Filtre', 'Temps', 'prospect')")
    .run().lastInsertRowid;
  await request(app).post('/api/appointments').send({ client_id: client, starts_at: '2026-11-01 09:00:00', ends_at: '2026-11-01 09:30:00' });
  await request(app).post('/api/appointments').send({ client_id: client, starts_at: '2026-11-15 09:00:00', ends_at: '2026-11-15 09:30:00' });
  await request(app).post('/api/appointments').send({ client_id: client, starts_at: '2026-11-30 09:00:00', ends_at: '2026-11-30 09:30:00' });

  const res = await request(app)
    .get('/api/appointments')
    .query({ client_id: client, from: '2026-11-10 00:00:00', to: '2026-11-20 00:00:00' });
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].starts_at, '2026-11-15 09:00:00');
});

test('filtre from invalide -> 400', async () => {
  const res = await request(app).get('/api/appointments').query({ from: 'pas une date' });
  assert.equal(res.status, 400);
});

// -- tri par starts_at ASC -------------------------------------------------
test('GET / trie par starts_at croissant', async () => {
  const client = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Tri', 'Ordre', 'prospect')")
    .run().lastInsertRowid;
  await request(app).post('/api/appointments').send({ client_id: client, starts_at: '2026-12-20 09:00:00', ends_at: '2026-12-20 09:30:00' });
  await request(app).post('/api/appointments').send({ client_id: client, starts_at: '2026-12-05 09:00:00', ends_at: '2026-12-05 09:30:00' });

  const res = await request(app).get('/api/appointments').query({ client_id: client });
  assert.equal(res.status, 200);
  assert.equal(res.body[0].starts_at, '2026-12-05 09:00:00');
  assert.equal(res.body[1].starts_at, '2026-12-20 09:00:00');
});

// -- 23. absence volontaire de DELETE ---------------------------------------
test('aucune route DELETE : la suppression physique n’est pas possible', async () => {
  const created = await request(app)
    .post('/api/appointments')
    .send({ client_id: clientA, starts_at: '2026-09-20 10:00:00', ends_at: '2026-09-20 11:00:00' });
  const id = created.body.id;

  const res = await request(app).delete(`/api/appointments/${id}`);
  assert.notEqual(res.status, 200, 'aucune route DELETE ne doit exister sur ce routeur');

  const stillThere = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  assert.ok(stillThere, 'le rendez-vous doit toujours exister — annulation via status=cancelled uniquement');
});
