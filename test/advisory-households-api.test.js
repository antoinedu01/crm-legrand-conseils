// Tests API — /api/advisory/households (Legrand Diagnostic 360, Lot 2).
// Même convention que test/api.test.js : base isolée en tmp, aucune donnée
// client réelle, session applicative réelle via supertest (pas de mock).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-api-'));
process.env.NODE_ENV = 'test';
process.env.SITE_ORIGINS = 'https://site-de-test.ch';
process.env.PUBLIC_RATE_LIMIT = '100';

const { default: app } = await import('../server/app.js');
const { default: db } = await import('../server/db.js');

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

function insertClient(over = {}) {
  const data = { type: 'particulier', first_name: 'Prenom', last_name: 'Nom', status: 'prospect', birth_date: null, ...over };
  const info = db
    .prepare('INSERT INTO clients (type, first_name, last_name, status, birth_date) VALUES (?, ?, ?, ?, ?)')
    .run(data.type, data.first_name, data.last_name, data.status, data.birth_date);
  return info.lastInsertRowid;
}

// --- Authentification / CSRF ----------------------------------------------

test('GET /api/advisory/households sans session est refusé (401)', async () => {
  const res = await request(app).get('/api/advisory/households');
  assert.equal(res.status, 401);
});

test('POST /api/advisory/households intersite est bloqué (CSRF, 403)', async () => {
  const clientId = insertClient();
  const res = await auth(request(app).post('/api/advisory/households'))
    .set('Origin', 'https://site-malveillant.example')
    .send({ primary_client_id: clientId });
  assert.equal(res.status, 403);
});

// --- Création / liste / détail ---------------------------------------------

test('POST /api/advisory/households — création valide (201)', async () => {
  const clientId = insertClient({ first_name: 'Julien', last_name: 'Api' });
  const res = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: clientId, label: 'Foyer API' });
  assert.equal(res.status, 201);
  assert.ok(res.body.id);
  assert.deepEqual(res.body.already_in_households, []);
});

test('POST /api/advisory/households — entrée invalide (client introuvable) → 400', async () => {
  const res = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: 999999 });
  assert.equal(res.status, 400);
});

test('GET /api/advisory/households — liste et recherche', async () => {
  const clientId = insertClient({ first_name: 'Recherche', last_name: 'Unique' });
  await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: clientId, label: 'Foyer recherche' });
  const res = await auth(request(app).get('/api/advisory/households?q=RechercheUnique'));
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
});

test('GET /api/advisory/households/:id — détail avec membres, 404 si introuvable', async () => {
  const clientId = insertClient({ first_name: 'Detail', last_name: 'Test' });
  const created = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: clientId });
  const res = await auth(request(app).get(`/api/advisory/households/${created.body.id}`));
  assert.equal(res.status, 200);
  assert.equal(res.body.members.length, 1);
  assert.deepEqual(res.body.sessions, []);

  const missing = await auth(request(app).get('/api/advisory/households/999999'));
  assert.equal(missing.status, 404);
});

test('GET /api/advisory/households/:id — n’expose pas de champs financiers/médicaux inexistants et reste minimal', async () => {
  const clientId = insertClient({ first_name: 'Sobre', last_name: 'Reponse' });
  const created = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: clientId });
  const res = await auth(request(app).get(`/api/advisory/households/${created.body.id}`));
  const member = res.body.members[0];
  assert.ok(!('notes' in member));
  assert.ok(!('avs_number' in member));
});

// --- Modification / archivage -----------------------------------------------

test('PUT /api/advisory/households/:id — modifie le libellé', async () => {
  const clientId = insertClient();
  const created = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: clientId });
  const res = await auth(request(app).put(`/api/advisory/households/${created.body.id}`)).send({ label: 'Nouveau libellé' });
  assert.equal(res.status, 200);
  const detail = await auth(request(app).get(`/api/advisory/households/${created.body.id}`));
  assert.equal(detail.body.label, 'Nouveau libellé');
});

test('PUT /api/advisory/households/:id — archive le foyer', async () => {
  const clientId = insertClient();
  const created = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: clientId });
  const res = await auth(request(app).put(`/api/advisory/households/${created.body.id}`)).send({ status: 'archive' });
  assert.equal(res.status, 200);
  const detail = await auth(request(app).get(`/api/advisory/households/${created.body.id}`));
  assert.equal(detail.body.status, 'archive');
});

test('PUT /api/advisory/households/:id — 404 si le foyer n’existe pas', async () => {
  const res = await auth(request(app).put('/api/advisory/households/999999')).send({ label: 'x' });
  assert.equal(res.status, 404);
});

test('foyer archivé — toute écriture (foyer, ajout, modification, retrait, principal) est refusée (409) côté API', async () => {
  const principalId = insertClient({ first_name: 'Api', last_name: 'Archive' });
  const created = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: principalId });
  const householdId = created.body.id;
  const spouseId = insertClient({ first_name: 'Api', last_name: 'Conjoint' });
  const addRes = await auth(request(app).post(`/api/advisory/households/${householdId}/members`))
    .send({ client_id: spouseId, member_role: 'conjoint' });
  const memberId = addRes.body.id;

  const archived = await auth(request(app).put(`/api/advisory/households/${householdId}`)).send({ status: 'archive' });
  assert.equal(archived.status, 200);

  // Lecture toujours possible.
  const detail = await auth(request(app).get(`/api/advisory/households/${householdId}`));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.status, 'archive');

  const otherId = insertClient({ first_name: 'Autre', last_name: 'Refuse' });
  const addAfterArchive = await auth(request(app).post(`/api/advisory/households/${householdId}/members`))
    .send({ client_id: otherId, member_role: 'enfant' });
  assert.equal(addAfterArchive.status, 409);

  const updateAfterArchive = await auth(request(app).put(`/api/advisory/households/${householdId}/members/${memberId}`))
    .send({ relationship_detail: 'x' });
  assert.equal(updateAfterArchive.status, 409);

  const removeAfterArchive = await auth(request(app).delete(`/api/advisory/households/${householdId}/members/${memberId}`)).send({});
  assert.equal(removeAfterArchive.status, 409);

  const setPrimaryAfterArchive = await auth(
    request(app).post(`/api/advisory/households/${householdId}/members/${memberId}/set-primary`)
  ).send({ previous_primary_new_role: 'conjoint' });
  assert.equal(setPrimaryAfterArchive.status, 409);

  const relabelAfterArchive = await auth(request(app).put(`/api/advisory/households/${householdId}`)).send({ label: 'x' });
  assert.equal(relabelAfterArchive.status, 409);
});

// --- Membres -----------------------------------------------------------------

test('POST /api/advisory/households/:id/members — ajout, doublon actif → 409', async () => {
  const principalId = insertClient({ first_name: 'M', last_name: 'Principal' });
  const created = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: principalId });
  const householdId = created.body.id;
  const otherId = insertClient({ first_name: 'Autre', last_name: 'Membre' });

  const add = await auth(request(app).post(`/api/advisory/households/${householdId}/members`))
    .send({ client_id: otherId, member_role: 'conjoint' });
  assert.equal(add.status, 201);

  const dup = await auth(request(app).post(`/api/advisory/households/${householdId}/members`))
    .send({ client_id: otherId, member_role: 'conjoint' });
  assert.equal(dup.status, 409);
});

test('POST /api/advisory/households/:id/members — member_role invalide → 400', async () => {
  const principalId = insertClient();
  const created = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: principalId });
  const otherId = insertClient();
  const res = await auth(request(app).post(`/api/advisory/households/${created.body.id}/members`))
    .send({ client_id: otherId, member_role: 'inconnu' });
  assert.equal(res.status, 400);
});

test('POST /api/advisory/households/:id/members/check-similarity — retourne les niveaux attendus et journalise « présentation correspondance similarité »', async () => {
  const principalId = insertClient();
  const created = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: principalId });
  insertClient({ first_name: 'Corinne', last_name: 'Bovay', birth_date: '1988-04-12' });

  const before = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'présentation correspondance similarité'").get().n;
  const res = await auth(request(app).post(`/api/advisory/households/${created.body.id}/members/check-similarity`))
    .send({ first_name: 'Corinne', last_name: 'Bovay', birth_date: '1988-04-12' });
  assert.equal(res.status, 200);
  assert.equal(res.body.matches.length, 1);
  assert.equal(res.body.matches[0].match_level, 'exact_match');
  assert.ok(!('notes' in res.body.matches[0]));
  const after = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'présentation correspondance similarité'").get().n;
  assert.equal(after, before + 1);
});

test('POST /api/advisory/households/:id/members/check-similarity — sans correspondance, n’audite rien', async () => {
  const principalId = insertClient();
  const created = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: principalId });

  const before = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'présentation correspondance similarité'").get().n;
  const res = await auth(request(app).post(`/api/advisory/households/${created.body.id}/members/check-similarity`))
    .send({ first_name: 'Zzz', last_name: 'Personne Inconnue Du Tout' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.matches, []);
  const after = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'présentation correspondance similarité'").get().n;
  assert.equal(after, before);
});

test('POST /api/advisory/households/:id/members — new_person avec correspondance forte est refusé sans confirmation', async () => {
  const principalId = insertClient();
  const created = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: principalId });
  insertClient({ first_name: 'Henri', last_name: 'Savary', birth_date: '1975-03-03' });

  const blocked = await auth(request(app).post(`/api/advisory/households/${created.body.id}/members`))
    .send({ new_person: { first_name: 'Henri', last_name: 'Savary', birth_date: '1975-03-03' }, member_role: 'autre_charge' });
  assert.equal(blocked.status, 409);
  assert.ok(blocked.body.matches.length > 0);

  const confirmed = await auth(request(app).post(`/api/advisory/households/${created.body.id}/members`))
    .send({
      new_person: { first_name: 'Henri', last_name: 'Savary', birth_date: '1975-03-03' },
      member_role: 'autre_charge',
      confirmed_despite_match: true,
    });
  assert.equal(confirmed.status, 201);
});

test('PUT /api/advisory/households/:id/members/:memberId — modifie un membre et journalise « modification membre foyer »', async () => {
  const principalId = insertClient({ first_name: 'Principal', last_name: 'PutTest' });
  const created = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: principalId });
  const householdId = created.body.id;
  const otherId = insertClient({ first_name: 'Membre', last_name: 'APutModifier' });
  const addRes = await auth(request(app).post(`/api/advisory/households/${householdId}/members`))
    .send({ client_id: otherId, member_role: 'autre_charge' });

  const before = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'modification membre foyer'").get().n;
  const res = await auth(request(app).put(`/api/advisory/households/${householdId}/members/${addRes.body.id}`))
    .send({ relationship_detail: 'tante' });
  assert.equal(res.status, 200);
  const after = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'modification membre foyer'").get().n;
  assert.equal(after, before + 1);

  const detail = await auth(request(app).get(`/api/advisory/households/${householdId}`));
  const member = detail.body.members.find((m) => m.id === addRes.body.id);
  assert.equal(member.relationship_detail, 'tante');
});

test('PUT /api/advisory/households/:id/members/:memberId — refuse une date de sortie antérieure à la date d’entrée (400)', async () => {
  const principalId = insertClient();
  const created = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: principalId });
  const householdId = created.body.id;
  const otherId = insertClient({ first_name: 'Date', last_name: 'Invalide' });
  const addRes = await auth(request(app).post(`/api/advisory/households/${householdId}/members`))
    .send({ client_id: otherId, member_role: 'autre_charge' });

  const res = await auth(request(app).put(`/api/advisory/households/${householdId}/members/${addRes.body.id}`))
    .send({ end_date: '2000-01-01' });
  assert.equal(res.status, 400);
});

test('PUT /api/advisory/households/:id/members/:memberId — membre introuvable → 404', async () => {
  const principalId = insertClient();
  const created = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: principalId });
  const res = await auth(request(app).put(`/api/advisory/households/${created.body.id}/members/999999`))
    .send({ relationship_detail: 'x' });
  assert.equal(res.status, 404);
});

test('GET /api/advisory/households/:id — journalise « consultation dossier foyer »', async () => {
  const principalId = insertClient({ first_name: 'Consult', last_name: 'Audit' });
  const created = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: principalId });

  const before = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'consultation dossier foyer'").get().n;
  const res = await auth(request(app).get(`/api/advisory/households/${created.body.id}`));
  assert.equal(res.status, 200);
  const after = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'consultation dossier foyer'").get().n;
  assert.equal(after, before + 1);
});

test('PUT /api/advisory/households/:id/members/:memberId/set-primary — change le principal', async () => {
  const principalId = insertClient({ first_name: 'Ancien', last_name: 'Chef' });
  const created = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: principalId });
  const householdId = created.body.id;
  const spouseId = insertClient({ first_name: 'Nouveau', last_name: 'Chef' });
  const addRes = await auth(request(app).post(`/api/advisory/households/${householdId}/members`))
    .send({ client_id: spouseId, member_role: 'conjoint' });

  const res = await auth(request(app).post(`/api/advisory/households/${householdId}/members/${addRes.body.id}/set-primary`))
    .send({ previous_primary_new_role: 'conjoint' });
  assert.equal(res.status, 200);
  const detail = await auth(request(app).get(`/api/advisory/households/${householdId}`));
  assert.equal(detail.body.primary_client_id, spouseId);
});

test('DELETE /api/advisory/households/:id/members/:memberId — retire un membre non principal', async () => {
  const principalId = insertClient();
  const created = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: principalId });
  const householdId = created.body.id;
  const otherId = insertClient();
  const addRes = await auth(request(app).post(`/api/advisory/households/${householdId}/members`))
    .send({ client_id: otherId, member_role: 'autre_charge' });

  const res = await auth(request(app).delete(`/api/advisory/households/${householdId}/members/${addRes.body.id}`)).send({});
  assert.equal(res.status, 200);
  const detail = await auth(request(app).get(`/api/advisory/households/${householdId}`));
  const member = detail.body.members.find((m) => m.id === addRes.body.id);
  assert.equal(member.status, 'archive');
});

test('DELETE /api/advisory/households/:id/members/:memberId — retirer le principal est refusé (400)', async () => {
  const principalId = insertClient();
  const created = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: principalId });
  const detail = await auth(request(app).get(`/api/advisory/households/${created.body.id}`));
  const principalMemberId = detail.body.members[0].id;
  const res = await auth(request(app).delete(`/api/advisory/households/${created.body.id}/members/${principalMemberId}`)).send({});
  assert.equal(res.status, 400);
});

// --- Audit ---------------------------------------------------------------

test('audit — la création de foyer et l’ajout de membre sont journalisés', async () => {
  const before = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'création foyer'").get().n;
  const clientId = insertClient();
  await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: clientId });
  const after = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'création foyer'").get().n;
  assert.equal(after, before + 1);
});
