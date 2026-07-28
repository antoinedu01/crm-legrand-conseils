// Tests du service métier « socle foyer » (Legrand Diagnostic 360, Lot 2).
// Base de test isolée dans un dossier temporaire (CRM_DATA_DIR), jamais
// data/**. Aucune donnée client réelle. Suit la convention de
// `test/migrations.test.js`/`test/api.test.js` (base isolée par processus).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-households-'));

const { default: db } = await import('../server/db.js');
const {
  AdvisoryError, listHouseholds, getHouseholdDetail, createHousehold, updateHousehold,
  checkSimilarity, addMember, updateMember, removeMember, setPrimaryMember,
} = await import('../server/advisoryHouseholds.js');

const REQ = { session: { userEmail: 'test@exemple.ch' } };

function insertClient(over = {}) {
  const data = {
    type: 'particulier', first_name: 'Prenom', last_name: 'Nom', status: 'prospect', birth_date: null,
    ...over,
  };
  const info = db
    .prepare(
      'INSERT INTO clients (type, first_name, last_name, status, birth_date) VALUES (?, ?, ?, ?, ?)'
    )
    .run(data.type, data.first_name, data.last_name, data.status, data.birth_date);
  return info.lastInsertRowid;
}

function auditCount(action) {
  return db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?').get(action).n;
}

// --- Création de foyer --------------------------------------------------

test('createHousehold — création atomique du foyer et de son principal', () => {
  const clientId = insertClient({ first_name: 'Julien', last_name: 'Moret' });
  const before = auditCount('création foyer');
  const { id, already_in_households } = createHousehold({ primary_client_id: clientId, label: 'Foyer Moret' }, REQ);
  assert.ok(id);
  assert.deepEqual(already_in_households, []);
  const detail = getHouseholdDetail(id);
  assert.equal(detail.primary_client_id, clientId);
  assert.equal(detail.members.length, 1);
  assert.equal(detail.members[0].member_role, 'principal');
  assert.equal(detail.members[0].client_id, clientId);
  assert.equal(auditCount('création foyer'), before + 1);
});

test('createHousehold — refuse un client principal introuvable', () => {
  assert.throws(() => createHousehold({ primary_client_id: 999999 }, REQ), AdvisoryError);
});

test('createHousehold — signale (sans bloquer) que le principal appartient déjà à un autre foyer actif', () => {
  const clientId = insertClient({ first_name: 'Sofia', last_name: 'Ricci' });
  const h1 = createHousehold({ primary_client_id: clientId }, REQ).id;
  const { already_in_households } = createHousehold({ primary_client_id: clientId, label: 'Second foyer' }, REQ);
  assert.equal(already_in_households.length, 1);
  assert.equal(already_in_households[0].id, h1);
});

// --- Modification / archivage -------------------------------------------

test('updateHousehold — modifie le libellé et journalise « modification foyer »', () => {
  const clientId = insertClient();
  const { id } = createHousehold({ primary_client_id: clientId }, REQ);
  const before = auditCount('modification foyer');
  updateHousehold(id, { label: 'Nouveau nom' }, REQ);
  assert.equal(getHouseholdDetail(id).label, 'Nouveau nom');
  assert.equal(auditCount('modification foyer'), before + 1);
});

test('updateHousehold — archive un foyer et journalise « archivage foyer » (pas « modification foyer »)', () => {
  const clientId = insertClient();
  const { id } = createHousehold({ primary_client_id: clientId }, REQ);
  const beforeArchive = auditCount('archivage foyer');
  const beforeModif = auditCount('modification foyer');
  updateHousehold(id, { status: 'archive' }, REQ);
  assert.equal(getHouseholdDetail(id).status, 'archive');
  assert.equal(auditCount('archivage foyer'), beforeArchive + 1);
  assert.equal(auditCount('modification foyer'), beforeModif);
});

test('updateHousehold — foyer introuvable renvoie une AdvisoryError 404', () => {
  try {
    updateHousehold(999999, { label: 'x' }, REQ);
    assert.fail('devrait lever une erreur');
  } catch (err) {
    assert.ok(err instanceof AdvisoryError);
    assert.equal(err.status, 404);
  }
});

// --- Foyer archivé : toute écriture refusée (GATE LOT 2, contrôle ciblé) ---

function buildArchivedHouseholdWithMember() {
  const principalId = insertClient({ first_name: 'Archive', last_name: 'Principal' });
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const spouseId = insertClient({ first_name: 'Archive', last_name: 'Conjoint' });
  const { id: memberId } = addMember(householdId, { client_id: spouseId, member_role: 'conjoint' }, REQ);
  updateHousehold(householdId, { status: 'archive' }, REQ);
  return { householdId, memberId, spouseId };
}

test('foyer archivé — la lecture (liste et détail) reste possible', () => {
  const { householdId } = buildArchivedHouseholdWithMember();
  const detail = getHouseholdDetail(householdId);
  assert.equal(detail.status, 'archive');
  assert.equal(detail.members.length, 2);
  const rows = listHouseholds({});
  assert.ok(rows.some((r) => r.id === householdId));
});

test('foyer archivé — updateHousehold (modification et réactivation) est refusé (409)', () => {
  const { householdId } = buildArchivedHouseholdWithMember();
  assert.throws(() => updateHousehold(householdId, { label: 'x' }, REQ), (err) => err instanceof AdvisoryError && err.status === 409);
  assert.throws(() => updateHousehold(householdId, { status: 'actif' }, REQ), (err) => err instanceof AdvisoryError && err.status === 409);
  assert.equal(getHouseholdDetail(householdId).status, 'archive', 'le foyer ne doit pas avoir été réactivé');
});

test('foyer archivé — addMember est refusé (409) et rien n’est audité', () => {
  const { householdId } = buildArchivedHouseholdWithMember();
  const newId = insertClient({ first_name: 'Nouveau', last_name: 'Refuse' });
  const beforeAjout = auditCount('ajout membre foyer');
  assert.throws(
    () => addMember(householdId, { client_id: newId, member_role: 'enfant' }, REQ),
    (err) => err instanceof AdvisoryError && err.status === 409
  );
  assert.equal(auditCount('ajout membre foyer'), beforeAjout);
  assert.equal(getHouseholdDetail(householdId).members.length, 2, 'aucun membre ajouté');
});

test('foyer archivé — updateMember est refusé (409) et rien n’est audité', () => {
  const { householdId, memberId } = buildArchivedHouseholdWithMember();
  const before = auditCount('modification membre foyer');
  assert.throws(
    () => updateMember(householdId, memberId, { relationship_detail: 'x' }, REQ),
    (err) => err instanceof AdvisoryError && err.status === 409
  );
  assert.equal(auditCount('modification membre foyer'), before);
});

test('foyer archivé — removeMember est refusé (409) et rien n’est audité', () => {
  const { householdId, memberId } = buildArchivedHouseholdWithMember();
  const before = auditCount('retrait membre foyer');
  assert.throws(
    () => removeMember(householdId, memberId, {}, REQ),
    (err) => err instanceof AdvisoryError && err.status === 409
  );
  assert.equal(auditCount('retrait membre foyer'), before);
  assert.equal(getHouseholdDetail(householdId).members.find((m) => m.id === memberId).status, 'actif');
});

test('foyer archivé — setPrimaryMember (changement de principal) est refusé (409) et rien n’est audité', () => {
  const { householdId, memberId } = buildArchivedHouseholdWithMember();
  const before = auditCount('changement de membre principal');
  assert.throws(
    () => setPrimaryMember(householdId, memberId, 'conjoint', REQ),
    (err) => err instanceof AdvisoryError && err.status === 409
  );
  assert.equal(auditCount('changement de membre principal'), before);
});

// --- Ajout de membres -----------------------------------------------------

test('addMember — ajoute un membre existant', () => {
  const principalId = insertClient({ first_name: 'Marc', last_name: 'Dubois' });
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const spouseId = insertClient({ first_name: 'Claire', last_name: 'Dubois' });
  const before = auditCount('ajout membre foyer');
  const result = addMember(householdId, { client_id: spouseId, member_role: 'conjoint' }, REQ);
  assert.ok(result.id);
  assert.equal(auditCount('ajout membre foyer'), before + 1);
  const members = getHouseholdDetail(householdId).members;
  assert.ok(members.some((m) => m.client_id === spouseId && m.member_role === 'conjoint'));
});

test('addMember — refuse member_role = principal via cette route (réservé à la création/au changement de principal)', () => {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const otherId = insertClient();
  try {
    addMember(householdId, { client_id: otherId, member_role: 'principal' }, REQ);
    assert.fail('devrait lever une erreur');
  } catch (err) {
    assert.ok(err instanceof AdvisoryError);
    assert.equal(err.status, 400);
  }
});

test('addMember — refuse un doublon actif dans le même foyer (409)', () => {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const childId = insertClient({ first_name: 'Enfant', last_name: 'Un' });
  addMember(householdId, { client_id: childId, member_role: 'enfant' }, REQ);
  try {
    addMember(householdId, { client_id: childId, member_role: 'enfant' }, REQ);
    assert.fail('devrait lever une erreur');
  } catch (err) {
    assert.ok(err instanceof AdvisoryError);
    assert.equal(err.status, 409);
  }
});

test('addMember — autorise la même personne dans un autre foyer (décision GATE LOT 1, décision 1)', () => {
  const principal1 = insertClient({ first_name: 'A', last_name: 'Un' });
  const h1 = createHousehold({ primary_client_id: principal1 }, REQ).id;
  const principal2 = insertClient({ first_name: 'B', last_name: 'Deux' });
  const h2 = createHousehold({ primary_client_id: principal2 }, REQ).id;
  const sharedChild = insertClient({ first_name: 'Enfant', last_name: 'Partage' });

  addMember(h1, { client_id: sharedChild, member_role: 'enfant' }, REQ);
  const result = addMember(h2, { client_id: sharedChild, member_role: 'enfant' }, REQ);
  assert.equal(result.already_in_households.length, 1);
  assert.equal(result.already_in_households[0].id, h1);
});

test('addMember — création rapide d’une personne (new_person) sans email/téléphone/profession', () => {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const result = addMember(
    householdId,
    { new_person: { first_name: 'Petit', last_name: 'Nouveau', birth_date: '2018-01-01' }, member_role: 'enfant' },
    REQ
  );
  assert.ok(result.id);
  const child = db.prepare('SELECT * FROM clients WHERE id = ?').get(result.client_id);
  assert.equal(child.email, null);
  assert.equal(child.phone, null);
  assert.equal(child.first_name, 'Petit');
});

test('addMember — new_person journalise « création client » (distinct de « ajout membre foyer »), sans donnée sensible', () => {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const beforeCreation = auditCount('création client');
  const beforeAjout = auditCount('ajout membre foyer');

  const result = addMember(
    householdId,
    { new_person: { first_name: 'Confidentiel', last_name: 'Enfant', birth_date: '2019-03-03' }, member_role: 'enfant' },
    REQ
  );

  assert.equal(auditCount('création client'), beforeCreation + 1, 'la création de la personne doit être auditée');
  assert.equal(auditCount('ajout membre foyer'), beforeAjout + 1, 'le rattachement au foyer doit rester audité séparément');

  const creationEntry = db
    .prepare("SELECT * FROM audit_log WHERE action = 'création client' ORDER BY id DESC LIMIT 1")
    .get();
  assert.equal(creationEntry.entity, 'client');
  assert.equal(creationEntry.entity_id, result.client_id);
  assert.ok(!creationEntry.details.includes('Confidentiel'), 'le prénom ne doit jamais figurer dans les détails d’audit');
  assert.ok(!creationEntry.details.includes('Enfant'), 'le nom ne doit jamais figurer dans les détails d’audit');
  assert.ok(!creationEntry.details.includes('2019-03-03'), 'la date de naissance ne doit jamais figurer dans les détails d’audit');

  const ajoutEntry = db
    .prepare("SELECT * FROM audit_log WHERE action = 'ajout membre foyer' ORDER BY id DESC LIMIT 1")
    .get();
  assert.notEqual(creationEntry.id, ajoutEntry.id, 'les deux événements doivent être deux lignes distinctes');
});

test('addMember — une personne existante (client_id) ne produit jamais de faux audit « création client »', () => {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const existingId = insertClient({ first_name: 'Deja', last_name: 'Existant' });
  const before = auditCount('création client');
  addMember(householdId, { client_id: existingId, member_role: 'autre_charge' }, REQ);
  assert.equal(auditCount('création client'), before, 'ajouter une personne déjà existante ne crée pas de client');
});

test('addMember — un blocage pour correspondance forte (sans confirmation) n’audite aucune création client', () => {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  insertClient({ first_name: 'Bloque', last_name: 'Avant', birth_date: '1985-06-06' });
  const before = auditCount('création client');
  assert.throws(() =>
    addMember(
      householdId,
      { new_person: { first_name: 'Bloque', last_name: 'Avant', birth_date: '1985-06-06' }, member_role: 'autre_charge' },
      REQ
    )
  );
  assert.equal(auditCount('création client'), before, 'un échec avant création effective ne doit rien auditer');
});

test('addMember — new_person : un échec pendant l’ajout au foyer annule aussi la création du client et son audit (rollback)', () => {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const beforeClients = db.prepare('SELECT COUNT(*) AS n FROM clients').get().n;
  const beforeAudit = auditCount('création client');

  assert.throws(() =>
    addMember(
      householdId,
      {
        new_person: { first_name: 'Rollback', last_name: 'Test', birth_date: '2010-01-01' },
        member_role: 'enfant',
        legal_representative_client_id: 999999, // membre inexistant du foyer -> writeMember doit échouer
      },
      REQ
    )
  );

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clients').get().n, beforeClients, 'aucune ligne client résiduelle');
  assert.equal(auditCount('création client'), beforeAudit, 'aucun audit résiduel après annulation de la transaction');
});

test('addMember — bloque la création rapide en cas de correspondance forte, sauf confirmation explicite', () => {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  insertClient({ first_name: 'Isabelle', last_name: 'Charrière', birth_date: '1990-01-01' });

  let threw = false;
  try {
    addMember(
      householdId,
      { new_person: { first_name: 'Isabelle', last_name: 'Charrière', birth_date: '1990-01-01' }, member_role: 'autre_charge' },
      REQ
    );
  } catch (err) {
    threw = true;
    assert.ok(err instanceof AdvisoryError);
    assert.equal(err.status, 409);
    assert.ok(err.matches.length > 0);
    assert.equal(err.matches[0].match_level, 'exact_match');
  }
  assert.ok(threw, 'devrait avoir bloqué la création sans confirmation');

  const before = auditCount('création malgré correspondance détectée');
  const result = addMember(
    householdId,
    {
      new_person: { first_name: 'Isabelle', last_name: 'Charrière', birth_date: '1990-01-01' },
      member_role: 'autre_charge',
      confirmed_despite_match: true,
    },
    REQ
  );
  assert.ok(result.id);
  assert.equal(auditCount('création malgré correspondance détectée'), before + 1);
  // Aucune fusion : deux lignes clients distinctes existent bien.
  const count = db
    .prepare("SELECT COUNT(*) AS n FROM clients WHERE first_name = 'Isabelle' AND last_name = 'Charrière'")
    .get().n;
  assert.equal(count, 2);
});

// --- Modification / sortie de membre --------------------------------------

test('updateMember — modifie relationship_detail, refuse de modifier member_role', () => {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const memberClientId = insertClient({ first_name: 'X', last_name: 'Y' });
  const { id: memberId } = addMember(householdId, { client_id: memberClientId, member_role: 'autre_charge' }, REQ);

  updateMember(householdId, memberId, { relationship_detail: 'tante' }, REQ);
  const updated = getHouseholdDetail(householdId).members.find((m) => m.id === memberId);
  assert.equal(updated.relationship_detail, 'tante');

  assert.throws(() => updateMember(householdId, memberId, { member_role: 'principal' }, REQ));
});

test('removeMember — sortie d’un membre non principal : historisée, jamais supprimée', () => {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const memberClientId = insertClient({ first_name: 'Sortant', last_name: 'Membre' });
  const { id: memberId } = addMember(householdId, { client_id: memberClientId, member_role: 'autre_charge' }, REQ);
  // Date de sortie fixée à la date d'entrée réelle (plutôt qu'une date en
  // dur) : depuis le renforcement GATE LOT 2 (end_date >= start_date), une
  // date de sortie codée en dur devient fragile face au temps qui passe.
  const entryDate = db.prepare('SELECT start_date FROM household_members WHERE id = ?').get(memberId).start_date;

  const before = auditCount('retrait membre foyer');
  removeMember(householdId, memberId, { end_date: entryDate }, REQ);
  const row = db.prepare('SELECT * FROM household_members WHERE id = ?').get(memberId);
  assert.equal(row.status, 'archive');
  assert.equal(row.end_date, entryDate);
  assert.equal(auditCount('retrait membre foyer'), before + 1);
});

test('removeMember — refuse une date de sortie antérieure à la date d’entrée (GATE LOT 2)', () => {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const memberClientId = insertClient({ first_name: 'Trop', last_name: 'Tot' });
  const { id: memberId } = addMember(householdId, { client_id: memberClientId, member_role: 'autre_charge' }, REQ);
  const entryDate = db.prepare('SELECT start_date FROM household_members WHERE id = ?').get(memberId).start_date;

  assert.throws(() => removeMember(householdId, memberId, { end_date: '2000-01-01' }, REQ));
  const row = db.prepare('SELECT status FROM household_members WHERE id = ?').get(memberId);
  assert.equal(row.status, 'actif', 'le retrait invalide ne doit pas avoir modifié le statut');

  // Une date de sortie égale ou postérieure à l'entrée reste acceptée.
  removeMember(householdId, memberId, { end_date: entryDate }, REQ);
  assert.equal(db.prepare('SELECT status FROM household_members WHERE id = ?').get(memberId).status, 'archive');
});

test('updateMember — refuse aussi une date de sortie antérieure à la date d’entrée (GATE LOT 2)', () => {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const memberClientId = insertClient({ first_name: 'Autre', last_name: 'Cas' });
  const { id: memberId } = addMember(householdId, { client_id: memberClientId, member_role: 'autre_charge' }, REQ);

  assert.throws(() => updateMember(householdId, memberId, { end_date: '2000-01-01' }, REQ));
});

test('updateMember — journalise « modification membre foyer »', () => {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const memberClientId = insertClient({ first_name: 'Audit', last_name: 'Membre' });
  const { id: memberId } = addMember(householdId, { client_id: memberClientId, member_role: 'autre_charge' }, REQ);

  const before = auditCount('modification membre foyer');
  updateMember(householdId, memberId, { relationship_detail: 'oncle' }, REQ);
  assert.equal(auditCount('modification membre foyer'), before + 1);
});

test('removeMember — impossible de retirer le principal sans remplacement', () => {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const detail = getHouseholdDetail(householdId);
  const principalMemberId = detail.members[0].id;
  try {
    removeMember(householdId, principalMemberId, {}, REQ);
    assert.fail('devrait lever une erreur');
  } catch (err) {
    assert.ok(err instanceof AdvisoryError);
    assert.equal(err.status, 400);
  }
});

// --- Changement de principal ----------------------------------------------

test('setPrimaryMember — change atomiquement le principal, rétrograde l’ancien', () => {
  const principalId = insertClient({ first_name: 'Ancien', last_name: 'Principal' });
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const spouseId = insertClient({ first_name: 'Nouveau', last_name: 'Principal' });
  const { id: spouseMemberId } = addMember(householdId, { client_id: spouseId, member_role: 'conjoint' }, REQ);

  const before = auditCount('changement de membre principal');
  setPrimaryMember(householdId, spouseMemberId, 'conjoint', REQ);

  const detail = getHouseholdDetail(householdId);
  assert.equal(detail.primary_client_id, spouseId);
  const principals = detail.members.filter((m) => m.member_role === 'principal' && m.status === 'actif');
  assert.equal(principals.length, 1);
  assert.equal(principals[0].client_id, spouseId);
  const oldPrincipal = detail.members.find((m) => m.client_id === principalId);
  assert.equal(oldPrincipal.member_role, 'conjoint');
  assert.equal(auditCount('changement de membre principal'), before + 1);
});

test('setPrimaryMember — impossible de laisser deux principaux ou aucun (invariants respectés après l’opération)', () => {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const otherId = insertClient();
  const { id: otherMemberId } = addMember(householdId, { client_id: otherId, member_role: 'autre_charge' }, REQ);
  setPrimaryMember(householdId, otherMemberId, 'autre_charge', REQ);

  const principals = db
    .prepare("SELECT COUNT(*) AS n FROM household_members WHERE household_id = ? AND status = 'actif' AND member_role = 'principal'")
    .get(householdId).n;
  assert.equal(principals, 1);
});

test('setPrimaryMember — refuse si le membre ciblé est déjà principal', () => {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const detail = getHouseholdDetail(householdId);
  const principalMemberId = detail.members[0].id;
  try {
    setPrimaryMember(householdId, principalMemberId, 'conjoint', REQ);
    assert.fail('devrait lever une erreur');
  } catch (err) {
    assert.ok(err instanceof AdvisoryError);
    assert.equal(err.status, 409);
  }
});

// --- Détection de similarité (intégration DB) -----------------------------

test('checkSimilarity — remonte le foyer commun comme élément corroborant', () => {
  const principalId = insertClient({ first_name: 'Foyer', last_name: 'Test' });
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  insertClient({ first_name: 'Nadia', last_name: 'Keller' });
  addMember(
    householdId,
    { new_person: { first_name: 'Nadia', last_name: 'Keller' }, member_role: 'autre_charge', confirmed_despite_match: true },
    REQ
  );
  // Une nouvelle recherche « Nadia Keller » doit maintenant trouver 2 candidats.
  const matches = checkSimilarity(householdId, { first_name: 'Nadia', last_name: 'Keller' });
  assert.equal(matches.length, 2);
});

test('checkSimilarity — ne renvoie jamais no_match dans la liste (déjà filtré)', () => {
  insertClient({ first_name: 'Sans', last_name: 'Rapport' });
  const principalId = insertClient({ first_name: 'Zzz', last_name: 'Inconnu' });
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const matches = checkSimilarity(householdId, { first_name: 'Aucun', last_name: 'Correspondant' });
  assert.ok(matches.every((m) => m.match_level !== 'no_match'));
});

// --- Liste des foyers -------------------------------------------------------

test('listHouseholds — retourne le nom du principal et le nombre de membres actifs', () => {
  const principalId = insertClient({ first_name: 'Aline', last_name: 'Perrin' });
  const { id: householdId } = createHousehold({ primary_client_id: principalId, label: 'Foyer Perrin' }, REQ);
  const childId = insertClient({ first_name: 'Enfant', last_name: 'Perrin' });
  addMember(householdId, { client_id: childId, member_role: 'enfant' }, REQ);

  const rows = listHouseholds({ q: 'Perrin' });
  const row = rows.find((r) => r.id === householdId);
  assert.ok(row);
  assert.equal(row.primary_display_name, 'Aline Perrin');
  assert.equal(row.active_member_count, 2);
});
