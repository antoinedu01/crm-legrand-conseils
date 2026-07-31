// Tests de la migration v8 (modèle métier « Assurance Suisse », Lot A).
// Chaque scénario utilise une base SQLite temporaire dédiée (CRM_DATA_DIR),
// jamais data/**. Aucune donnée client réelle n'est utilisée.
//
// server/db.js exécute ses migrations une seule fois, au chargement du
// module. Pour tester plusieurs scénarios (base neuve, base héritée en v6,
// idempotence) dans le même processus, chaque import utilise une URL de
// module distincte (paramètre de requête unique) afin d'obtenir une
// nouvelle instance du module et de forcer une nouvelle exécution de la
// migration contre le répertoire temporaire visé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const dbModulePath = fileURLToPath(new URL('../server/db.js', import.meta.url));

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'crm-migration-'));
}

async function importFreshDb(dataDir) {
  process.env.CRM_DATA_DIR = dataDir;
  const url = `${pathToFileURL(dbModulePath).href}?instance=${Date.now()}-${Math.random()}`;
  const mod = await import(url);
  return mod.default;
}

// Reconstruction fidèle du schéma pré-Lot A (base + migrations v1 à v6),
// utilisée UNIQUEMENT pour fabriquer, dans un fichier temporaire neuf, une
// base représentant un état antérieur réel — jamais à partir d'une base
// existante ni de data/**.
function buildLegacyV6Database(dataDir) {
  const file = path.join(dataDir, 'crm.sqlite');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      finma_reg TEXT,
      cicero_reg TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      totp_secret TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      finma_number TEXT,
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      default_acq_rate REAL DEFAULT 0,
      default_rec_rate REAL DEFAULT 0,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'particulier',
      first_name TEXT, last_name TEXT, company_name TEXT,
      email TEXT, phone TEXT, birth_date TEXT, address TEXT, npa TEXT,
      city TEXT, canton TEXT, nationality TEXT, marital_status TEXT,
      profession TEXT, avs_number TEXT, notes TEXT,
      status TEXT NOT NULL DEFAULT 'prospect',
      consent_data INTEGER NOT NULL DEFAULT 0, consent_date TEXT,
      mandate_signed INTEGER NOT NULL DEFAULT 0, mandate_date TEXT,
      info_lsa_date TEXT,
      owner_user_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id),
      company_id INTEGER NOT NULL REFERENCES companies(id),
      branch TEXT NOT NULL,
      policy_number TEXT, product_name TEXT,
      annual_premium REAL NOT NULL DEFAULT 0,
      payment_frequency TEXT NOT NULL DEFAULT 'annuelle',
      start_date TEXT, end_date TEXT,
      status TEXT NOT NULL DEFAULT 'offre',
      acq_commission_rate REAL DEFAULT 0, rec_commission_rate REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL REFERENCES contracts(id),
      type TEXT NOT NULL, label TEXT, amount REAL NOT NULL DEFAULT 0,
      due_date TEXT, status TEXT NOT NULL DEFAULT 'attendue', paid_date TEXT,
      notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER REFERENCES clients(id),
      contract_id INTEGER REFERENCES contracts(id),
      title TEXT NOT NULL, description TEXT, due_date TEXT,
      priority TEXT NOT NULL DEFAULT 'normale', status TEXT NOT NULL DEFAULT 'ouverte',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT
    );
    CREATE TABLE activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id),
      type TEXT NOT NULL DEFAULT 'note', content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT, action TEXT NOT NULL, entity TEXT, entity_id INTEGER,
      details TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, name TEXT NOT NULL,
      description TEXT, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      channel_id INTEGER REFERENCES channels(id), status TEXT NOT NULL DEFAULT 'brouillon',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE channel_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL REFERENCES channels(id),
      month TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE lead_details (
      client_id INTEGER PRIMARY KEY REFERENCES clients(id),
      channel_id INTEGER REFERENCES channels(id), campaign_id INTEGER REFERENCES campaigns(id),
      referrer_client_id INTEGER REFERENCES clients(id),
      pipeline_stage TEXT NOT NULL DEFAULT 'nouveau',
      main_need TEXT, age_range TEXT, work_situation TEXT, family_situation TEXT,
      contact_pref TEXT, score INTEGER NOT NULL DEFAULT 0, score_reasons TEXT,
      classement TEXT NOT NULL DEFAULT 'non_qualifie', urgent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE scoring_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE NOT NULL, label TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE action_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action_key TEXT NOT NULL, action_type TEXT,
      client_id INTEGER REFERENCES clients(id), contract_id INTEGER REFERENCES contracts(id),
      result TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE consents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL REFERENCES clients(id),
      kind TEXT NOT NULL DEFAULT 'site_form', granted INTEGER NOT NULL DEFAULT 1,
      text_version TEXT, source TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_clients_email ON clients(email);
    CREATE INDEX idx_clients_phone ON clients(phone);
    CREATE INDEX idx_contracts_client ON contracts(client_id);
    CREATE INDEX idx_contracts_company ON contracts(company_id);
    CREATE INDEX idx_commissions_contract ON commissions(contract_id);
    CREATE INDEX idx_activities_client ON activities(client_id);
    CREATE INDEX idx_tasks_due ON tasks(due_date);
    CREATE INDEX idx_audit_created ON audit_log(created_at);
    CREATE INDEX idx_lead_details_channel ON lead_details(channel_id);
    CREATE INDEX idx_channel_costs_channel ON channel_costs(channel_id, month);
    CREATE INDEX idx_action_log_key ON action_log(action_key, created_at);
    CREATE INDEX idx_consents_client ON consents(client_id);
  `);
  db.pragma('user_version = 6');
  return db;
}

function insertFixtureContract(db, branch = 'lamal') {
  const company = db.prepare('INSERT INTO companies (name) VALUES (?)').run('Compagnie de test');
  const client = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Test', 'Fixture', 'prospect')")
    .run();
  const contract = db
    .prepare('INSERT INTO contracts (client_id, company_id, branch) VALUES (?, ?, ?)')
    .run(client.lastInsertRowid, company.lastInsertRowid, branch);
  return contract.lastInsertRowid;
}

test('migration v8 — une base neuve atteint au moins user_version = 8', async () => {
  const db = await importFreshDb(tempDir());
  // Une base neuve applique désormais aussi la migration v9 (Lot 2,
  // Legrand Diagnostic 360) : on vérifie ici que la migration v8 a bien été
  // franchie (>= 8), pas le numéro final exact de la chaîne de migration,
  // qui évoluera à chaque nouveau lot.
  assert.ok(db.pragma('user_version', { simple: true }) >= 8);
});

test('migration v8 — une base héritée en v6 est migrée vers v8 sans perte de données', async () => {
  const dir = tempDir();
  const legacy = buildLegacyV6Database(dir);
  const company = legacy.prepare('INSERT INTO companies (name) VALUES (?)').run('Compagnie de test');
  const client = legacy
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', ?, ?, 'client')")
    .run('Test', 'Existant');
  const contract = legacy
    .prepare('INSERT INTO contracts (client_id, company_id, branch, annual_premium, status) VALUES (?, ?, ?, ?, ?)')
    .run(client.lastInsertRowid, company.lastInsertRowid, 'lamal', 1200, 'actif');
  legacy.close();

  const db = await importFreshDb(dir);
  // Voir commentaire du test précédent : >= 8, pas un numéro final figé.
  assert.ok(db.pragma('user_version', { simple: true }) >= 8);

  const preserved = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract.lastInsertRowid);
  assert.equal(preserved.branch, 'lamal');
  assert.equal(preserved.annual_premium, 1200);
  assert.equal(preserved.status, 'actif');
  assert.equal(preserved.review_frequency, 'annuelle');
  assert.equal(preserved.review_last_date, null);
  assert.equal(preserved.review_next_date, null);
});

test("migration v8 — idempotence : un second import de la même base n'échoue pas et reste au moins en v8", async () => {
  const dir = tempDir();
  await importFreshDb(dir);
  const db = await importFreshDb(dir);
  assert.ok(db.pragma('user_version', { simple: true }) >= 8);
});

test('migration v8 — idempotence réelle : une table déjà créée avant la fin de la migration n\'empêche pas la reprise', async () => {
  const dir = tempDir();
  const legacy = buildLegacyV6Database(dir);
  // Simule un arrêt du processus après création partielle du schéma v8
  // (une table déjà présente) mais avant l'écriture de user_version = 8.
  legacy.exec(`
    CREATE TABLE contract_lamal (
      contract_id INTEGER PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE,
      care_model TEXT NOT NULL, deductible INTEGER NOT NULL, accident_coverage INTEGER NOT NULL DEFAULT 1,
      canton TEXT, tariff_region TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  legacy.close();

  const db = await importFreshDb(dir);
  assert.ok(db.pragma('user_version', { simple: true }) >= 8);
});

test('migration v8 — les trois colonnes communes existent sur contracts', async () => {
  const db = await importFreshDb(tempDir());
  const cols = db.prepare('PRAGMA table_info(contracts)').all().map((c) => c.name);
  for (const col of ['review_frequency', 'review_last_date', 'review_next_date']) {
    assert.ok(cols.includes(col), `colonne ${col} manquante`);
  }
});

test('migration v8 — les huit tables spécialisées existent', async () => {
  const db = await importFreshDb(tempDir());
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  for (const table of [
    'contract_lamal', 'contract_lca', 'contract_life', 'contract_income_protection',
    'contract_lpp_ijm', 'contract_coverages', 'contract_beneficiaries', 'contract_history',
  ]) {
    assert.ok(tables.includes(table), `table ${table} manquante`);
  }
});

test('migration v8 — les index attendus existent', async () => {
  const db = await importFreshDb(tempDir());
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((i) => i.name);
  for (const idx of [
    'idx_contracts_review_next', 'idx_contracts_branch_status',
    'idx_contract_lamal_deductible', 'idx_contract_lca_underwriting_status',
    'idx_contract_coverages_contract', 'idx_contract_coverages_type',
    'idx_contract_beneficiaries_contract', 'idx_contract_beneficiaries_client',
    'idx_contract_history_contract_created',
  ]) {
    assert.ok(indexes.includes(idx), `index ${idx} manquant`);
  }
});

test('migration v8 — un contrat sans détail spécialisé reste valide', async () => {
  const db = await importFreshDb(tempDir());
  const contractId = insertFixtureContract(db, 'autre');
  const found = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
  assert.ok(found);
  const detail = db.prepare('SELECT * FROM contract_lamal WHERE contract_id = ?').get(contractId);
  assert.equal(detail, undefined);
});

test('migration v8 — la relation 0..1:1 refuse une deuxième ligne pour le même contrat', async () => {
  const db = await importFreshDb(tempDir());
  const contractId = insertFixtureContract(db, 'lamal');
  const insert = db.prepare('INSERT INTO contract_lamal (contract_id, care_model, deductible) VALUES (?, ?, ?)');
  insert.run(contractId, 'standard', 300);
  assert.throws(() => insert.run(contractId, 'telmed', 500));
});

test('migration v8 — ON DELETE CASCADE supprime les extensions du contrat', async () => {
  const db = await importFreshDb(tempDir());
  const contractId = insertFixtureContract(db, 'lamal');
  db.prepare('INSERT INTO contract_lamal (contract_id, care_model, deductible) VALUES (?, ?, ?)')
    .run(contractId, 'standard', 300);
  db.prepare('INSERT INTO contract_coverages (contract_id, coverage_type) VALUES (?, ?)')
    .run(contractId, 'ambulatoire');

  db.prepare('DELETE FROM contracts WHERE id = ?').run(contractId);

  assert.equal(db.prepare('SELECT * FROM contract_lamal WHERE contract_id = ?').get(contractId), undefined);
  assert.equal(db.prepare('SELECT * FROM contract_coverages WHERE contract_id = ?').get(contractId), undefined);
});

test("migration v8 — la contrainte d'unicité des garanties fonctionne", async () => {
  const db = await importFreshDb(tempDir());
  const contractId = insertFixtureContract(db, 'lca');
  const insert = db.prepare('INSERT INTO contract_coverages (contract_id, coverage_type) VALUES (?, ?)');
  insert.run(contractId, 'dentaire');
  assert.throws(() => insert.run(contractId, 'dentaire'));
});

test('migration v8 — les contraintes CHECK numériques essentielles fonctionnent', async () => {
  const db = await importFreshDb(tempDir());
  const contractId = insertFixtureContract(db, 'lamal');

  assert.throws(() =>
    db.prepare('INSERT INTO contract_lamal (contract_id, care_model, deductible) VALUES (?, ?, ?)')
      .run(contractId, 'standard', -100)
  );
  assert.throws(() =>
    db.prepare('INSERT INTO contract_lamal (contract_id, care_model, deductible, accident_coverage) VALUES (?, ?, ?, ?)')
      .run(contractId, 'standard', 300, 2)
  );
});

// --- Migration v9 (Legrand Diagnostic 360, Lot 2 : socle households / --
// household_members). Réutilise buildLegacyV6Database ci-dessus : depuis une
// base v6, l'exécution normale de server/db.js applique successivement les
// blocs < 8 puis < 9, exerçant ainsi le vrai chemin de migration séquentiel
// plutôt qu'un scénario v8 reconstitué à la main.

function insertFixtureClient(db, firstName = 'Test', lastName = 'Fixture') {
  const info = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', ?, ?, 'prospect')")
    .run(firstName, lastName);
  return info.lastInsertRowid;
}

test('migration v9 — une base neuve atteint au moins user_version = 9', async () => {
  // >= plutôt que === : une base neuve enchaîne désormais aussi la
  // migration v10 (Lot 3A) — même fragilité déjà rencontrée et corrigée
  // pour les tests v8 lors du Lot 2, qui se reproduit à chaque nouveau lot.
  const db = await importFreshDb(tempDir());
  assert.ok(db.pragma('user_version', { simple: true }) >= 9);
});

test('migration v9 — une base héritée en v6 est migrée vers v9 sans perte de données', async () => {
  const dir = tempDir();
  const legacy = buildLegacyV6Database(dir);
  const client = legacy
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', ?, ?, 'client')")
    .run('Test', 'Existant');
  legacy.close();

  const db = await importFreshDb(dir);
  assert.ok(db.pragma('user_version', { simple: true }) >= 9);
  const preserved = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.lastInsertRowid);
  assert.equal(preserved.first_name, 'Test');
  assert.equal(preserved.last_name, 'Existant');
});

test("migration v9 — idempotence : un second import de la même base n'échoue pas et reste au moins en v9", async () => {
  const dir = tempDir();
  await importFreshDb(dir);
  const db = await importFreshDb(dir);
  assert.ok(db.pragma('user_version', { simple: true }) >= 9);
});

test('migration v9 — les tables households et household_members existent avec les colonnes attendues', async () => {
  const db = await importFreshDb(tempDir());
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  assert.ok(tables.includes('households'));
  assert.ok(tables.includes('household_members'));

  const householdCols = db.prepare('PRAGMA table_info(households)').all().map((c) => c.name);
  for (const col of ['id', 'label', 'primary_client_id', 'status', 'notes', 'owner_user_id', 'created_at', 'updated_at']) {
    assert.ok(householdCols.includes(col), `colonne households.${col} manquante`);
  }
  const memberCols = db.prepare('PRAGMA table_info(household_members)').all().map((c) => c.name);
  for (const col of [
    'id', 'household_id', 'client_id', 'member_role', 'relationship_detail',
    'legal_representative_client_id', 'start_date', 'end_date', 'status', 'created_at', 'updated_at',
  ]) {
    assert.ok(memberCols.includes(col), `colonne household_members.${col} manquante`);
  }
});

test('migration v9 — les index attendus existent (dont les deux index uniques partiels)', async () => {
  const db = await importFreshDb(tempDir());
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((i) => i.name);
  for (const idx of [
    'idx_households_primary_client', 'idx_households_status',
    'idx_household_members_household', 'idx_household_members_client', 'idx_household_members_household_role',
    'idx_household_members_active_unique', 'idx_household_members_one_active_principal',
  ]) {
    assert.ok(indexes.includes(idx), `index ${idx} manquant`);
  }
});

test('migration v9 — un foyer avec principal actif peut être créé', async () => {
  const db = await importFreshDb(tempDir());
  const clientId = insertFixtureClient(db);
  const household = db.prepare('INSERT INTO households (primary_client_id) VALUES (?)').run(clientId);
  db.prepare("INSERT INTO household_members (household_id, client_id, member_role) VALUES (?, ?, 'principal')")
    .run(household.lastInsertRowid, clientId);
  const member = db.prepare('SELECT * FROM household_members WHERE household_id = ?').get(household.lastInsertRowid);
  assert.equal(member.member_role, 'principal');
  assert.equal(member.status, 'actif');
});

test('migration v9 — un même client_id peut appartenir à deux foyers actifs différents (décision GATE LOT 1)', async () => {
  const db = await importFreshDb(tempDir());
  const clientId = insertFixtureClient(db);
  const h1 = db.prepare('INSERT INTO households (primary_client_id) VALUES (?)').run(clientId).lastInsertRowid;
  const otherPrincipal = insertFixtureClient(db, 'Autre', 'Principal');
  const h2 = db.prepare('INSERT INTO households (primary_client_id) VALUES (?)').run(otherPrincipal).lastInsertRowid;
  db.prepare("INSERT INTO household_members (household_id, client_id, member_role) VALUES (?, ?, 'principal')").run(h1, clientId);
  // La même personne (clientId) rejoint un second foyer comme simple membre, sans conflit.
  assert.doesNotThrow(() =>
    db.prepare("INSERT INTO household_members (household_id, client_id, member_role) VALUES (?, ?, 'autre_charge')")
      .run(h2, clientId)
  );
});

test('migration v9 — un client_id ne peut avoir deux adhésions actives dans le même foyer', async () => {
  const db = await importFreshDb(tempDir());
  const clientId = insertFixtureClient(db);
  const householdId = db.prepare('INSERT INTO households (primary_client_id) VALUES (?)').run(clientId).lastInsertRowid;
  db.prepare("INSERT INTO household_members (household_id, client_id, member_role) VALUES (?, ?, 'principal')")
    .run(householdId, clientId);
  assert.throws(() =>
    db.prepare("INSERT INTO household_members (household_id, client_id, member_role) VALUES (?, ?, 'conjoint')")
      .run(householdId, clientId)
  );
});

test('migration v9 — un foyer ne peut avoir deux principaux actifs', async () => {
  const db = await importFreshDb(tempDir());
  const clientId = insertFixtureClient(db);
  const secondClientId = insertFixtureClient(db, 'Second', 'Membre');
  const householdId = db.prepare('INSERT INTO households (primary_client_id) VALUES (?)').run(clientId).lastInsertRowid;
  db.prepare("INSERT INTO household_members (household_id, client_id, member_role) VALUES (?, ?, 'principal')")
    .run(householdId, clientId);
  assert.throws(() =>
    db.prepare("INSERT INTO household_members (household_id, client_id, member_role) VALUES (?, ?, 'principal')")
      .run(householdId, secondClientId)
  );
});

test('migration v9 — un même foyer peut ravoir un principal actif après archivage de l’ancienne adhésion (contrainte non violée)', async () => {
  const db = await importFreshDb(tempDir());
  const clientId = insertFixtureClient(db);
  const secondClientId = insertFixtureClient(db, 'Second', 'Membre');
  const householdId = db.prepare('INSERT INTO households (primary_client_id) VALUES (?)').run(clientId).lastInsertRowid;
  const oldPrincipal = db
    .prepare("INSERT INTO household_members (household_id, client_id, member_role) VALUES (?, ?, 'principal')")
    .run(householdId, clientId).lastInsertRowid;
  // Rétrogradation avant promotion (ordre exigé par la revue advisory-architect) :
  // l'index unique partiel est vérifié immédiatement, pas différé.
  db.prepare("UPDATE household_members SET member_role = 'conjoint' WHERE id = ?").run(oldPrincipal);
  assert.doesNotThrow(() =>
    db.prepare("INSERT INTO household_members (household_id, client_id, member_role) VALUES (?, ?, 'principal')")
      .run(householdId, secondClientId)
  );
});

// --- Migration v10 (Lot 3A — sessions et questionnaires génériques) --------

function insertFixtureUser(db, email = 'conseiller@exemple.ch') {
  return db
    .prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)')
    .run(email, 'Conseiller Test', 'hash-fictif').lastInsertRowid;
}

const ADVISORY_V10_TABLES = [
  'advisory_questionnaires', 'advisory_questionnaire_versions', 'advisory_sections',
  'advisory_questions', 'advisory_question_options', 'advisory_sessions',
  'advisory_session_questionnaires', 'advisory_answers',
];

test('migration v10 — une base neuve atteint au moins user_version = 10', async () => {
  const db = await importFreshDb(tempDir());
  assert.ok(db.pragma('user_version', { simple: true }) >= 10);
});

test('migration v10 — une base héritée en v6 est migrée vers v10 sans perte de données', async () => {
  const dir = tempDir();
  const legacy = buildLegacyV6Database(dir);
  const client = legacy
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', ?, ?, 'client')")
    .run('Test', 'Existant10');
  legacy.close();

  const db = await importFreshDb(dir);
  assert.ok(db.pragma('user_version', { simple: true }) >= 10);
  const preserved = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.lastInsertRowid);
  assert.equal(preserved.last_name, 'Existant10');
});

test("migration v10 — idempotence : un second import de la même base n'échoue pas et reste au moins en v10", async () => {
  const dir = tempDir();
  await importFreshDb(dir);
  const db = await importFreshDb(dir);
  assert.ok(db.pragma('user_version', { simple: true }) >= 10);
});

test('migration v10 — les 8 tables attendues existent, et aucune table hors périmètre (rule_sets/findings/etc.)', async () => {
  const db = await importFreshDb(tempDir());
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'advisory_%'").all().map((t) => t.name);
  for (const t of ADVISORY_V10_TABLES) assert.ok(tables.includes(t), `table manquante : ${t}`);
  assert.equal(tables.length, ADVISORY_V10_TABLES.length, `tables inattendues : ${tables.filter((t) => !ADVISORY_V10_TABLES.includes(t))}`);
});

test('migration v10 — colonnes attendues sur advisory_sessions et advisory_answers', async () => {
  const db = await importFreshDb(tempDir());
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  const sessionCols = cols('advisory_sessions');
  for (const c of ['household_id', 'advisor_user_id', 'domain', 'status', 'started_at', 'suspended_at',
    'completed_at', 'last_activity_at', 'revision', 'household_snapshot']) {
    assert.ok(sessionCols.includes(c), `colonne manquante sur advisory_sessions : ${c}`);
  }
  const answerCols = cols('advisory_answers');
  for (const c of ['session_id', 'question_id', 'household_member_id', 'status', 'value_text', 'value_number',
    'value_boolean', 'value_date', 'value_json', 'superseded_by_answer_id', 'is_amendment', 'amendment_reason', 'revision']) {
    assert.ok(answerCols.includes(c), `colonne manquante sur advisory_answers : ${c}`);
  }
});

// Correctif final GATE LOT 3A : allows_not_applicable ajoutée DIRECTEMENT
// dans la migration 10 existante (jamais committée/déployée à ce stade — pas
// de migration 11 pour ce seul correctif).
test('migration v10 — advisory_questions.allows_not_applicable existe, INTEGER NOT NULL, défaut 0 (désactivé)', async () => {
  const db = await importFreshDb(tempDir());
  const col = db.prepare("PRAGMA table_info(advisory_questions)").all().find((c) => c.name === 'allows_not_applicable');
  assert.ok(col, 'colonne allows_not_applicable manquante');
  assert.equal(col.notnull, 1);
  assert.equal(col.dflt_value, '0');
  assert.equal(col.type, 'INTEGER');
});

test('migration v10 — allows_not_applicable : base héritée en v6 migrée directement avec la colonne présente et désactivée par défaut', async () => {
  const dir = tempDir();
  const legacy = buildLegacyV6Database(dir);
  legacy.close();
  const db = await importFreshDb(dir);
  const col = db.prepare("PRAGMA table_info(advisory_questions)").all().find((c) => c.name === 'allows_not_applicable');
  assert.ok(col);
  assert.equal(col.dflt_value, '0');
});

test('migration v10 — allows_not_applicable : redémarrages répétés (3x) restent idempotents, colonne stable', async () => {
  const dir = tempDir();
  for (let i = 0; i < 3; i++) {
    const db = await importFreshDb(dir);
    assert.ok(db.pragma('user_version', { simple: true }) >= 10);
    const col = db.prepare("PRAGMA table_info(advisory_questions)").all().find((c) => c.name === 'allows_not_applicable');
    assert.ok(col, `colonne absente au redémarrage #${i + 1}`);
  }
});

test('migration v10 — index attendus existent (dont les contraintes uniques de composition et les index partiels de réponses)', async () => {
  const db = await importFreshDb(tempDir());
  const idx = (t) => db.prepare("SELECT name, \"unique\", partial FROM pragma_index_list(?)").all(t);
  const sessionQuestionnaireIdx = idx('advisory_session_questionnaires');
  assert.equal(sessionQuestionnaireIdx.filter((i) => i.unique).length, 3, 'les 3 contraintes uniques de composition sont attendues');
  const answerIdx = idx('advisory_answers');
  const partials = answerIdx.filter((i) => i.partial);
  assert.equal(partials.length, 2, 'les 2 index uniques partiels d’activité de réponse sont attendus');
});

test('migration v10 — hiérarchie questionnaire/version/section/question/option insérable via les FK réelles', async () => {
  const db = await importFreshDb(tempDir());
  const qid = db.prepare("INSERT INTO advisory_questionnaires (stable_key, domain, name) VALUES ('demo', 'common', 'Démo')").run().lastInsertRowid;
  const vid = db.prepare('INSERT INTO advisory_questionnaire_versions (questionnaire_id, version_number) VALUES (?, 1)').run(qid).lastInsertRowid;
  const sid = db.prepare("INSERT INTO advisory_sections (questionnaire_version_id, stable_key, title, sort_order) VALUES (?, 's1', 'Section', 1)").run(vid).lastInsertRowid;
  const qsid = db.prepare(
    "INSERT INTO advisory_questions (section_id, questionnaire_version_id, stable_key, advisor_text, type, sort_order) VALUES (?, ?, 'q1', 'Texte ?', 'boolean', 1)"
  ).run(sid, vid).lastInsertRowid;
  assert.doesNotThrow(() =>
    db.prepare("INSERT INTO advisory_question_options (question_id, stable_key, label, value, sort_order) VALUES (?, 'o1', 'Oui', 'oui', 1)").run(qsid)
  );
});

test('migration v10 — advisory_session_questionnaires refuse deux versions du même domaine dans la même session', async () => {
  const db = await importFreshDb(tempDir());
  const userId = insertFixtureUser(db);
  const clientId = insertFixtureClient(db);
  const householdId = db.prepare('INSERT INTO households (primary_client_id) VALUES (?)').run(clientId).lastInsertRowid;
  const qid = db.prepare("INSERT INTO advisory_questionnaires (stable_key, domain, name) VALUES ('h1', 'health', 'Santé 1')").run().lastInsertRowid;
  const v1 = db.prepare("INSERT INTO advisory_questionnaire_versions (questionnaire_id, version_number, status) VALUES (?, 1, 'published')").run(qid).lastInsertRowid;
  const qid2 = db.prepare("INSERT INTO advisory_questionnaires (stable_key, domain, name) VALUES ('h2', 'health', 'Santé 2')").run().lastInsertRowid;
  const v2 = db.prepare("INSERT INTO advisory_questionnaire_versions (questionnaire_id, version_number, status) VALUES (?, 1, 'published')").run(qid2).lastInsertRowid;
  const sessionId = db.prepare("INSERT INTO advisory_sessions (household_id, advisor_user_id, domain) VALUES (?, ?, 'health')").run(householdId, userId).lastInsertRowid;
  db.prepare(
    "INSERT INTO advisory_session_questionnaires (session_id, questionnaire_version_id, domain, module_role, display_order) VALUES (?, ?, 'health', 'domain', 1)"
  ).run(sessionId, v1);
  assert.throws(() =>
    db.prepare(
      "INSERT INTO advisory_session_questionnaires (session_id, questionnaire_version_id, domain, module_role, display_order) VALUES (?, ?, 'health', 'domain', 2)"
    ).run(sessionId, v2)
  );
});

test('migration v10 — advisory_answers : une seule réponse active par (session, question) en portée foyer/session', async () => {
  const db = await importFreshDb(tempDir());
  const userId = insertFixtureUser(db);
  const clientId = insertFixtureClient(db);
  const householdId = db.prepare('INSERT INTO households (primary_client_id) VALUES (?)').run(clientId).lastInsertRowid;
  const sessionId = db.prepare("INSERT INTO advisory_sessions (household_id, advisor_user_id, domain) VALUES (?, ?, 'health')").run(householdId, userId).lastInsertRowid;
  const qid = db.prepare("INSERT INTO advisory_questionnaires (stable_key, domain, name) VALUES ('h3', 'health', 'Santé 3')").run().lastInsertRowid;
  const vid = db.prepare('INSERT INTO advisory_questionnaire_versions (questionnaire_id, version_number) VALUES (?, 1)').run(qid).lastInsertRowid;
  const sid = db.prepare("INSERT INTO advisory_sections (questionnaire_version_id, stable_key, title, sort_order) VALUES (?, 's1', 'S', 1)").run(vid).lastInsertRowid;
  const questionId = db.prepare(
    "INSERT INTO advisory_questions (section_id, questionnaire_version_id, stable_key, advisor_text, type, sort_order) VALUES (?, ?, 'q1', 'T', 'boolean', 1)"
  ).run(sid, vid).lastInsertRowid;
  db.prepare("INSERT INTO advisory_answers (session_id, question_id, status, value_boolean, revision) VALUES (?, ?, 'answered', 1, 1)").run(sessionId, questionId);
  assert.throws(() =>
    db.prepare("INSERT INTO advisory_answers (session_id, question_id, status, value_boolean, revision) VALUES (?, ?, 'answered', 0, 2)").run(sessionId, questionId)
  );
});

test('migration v10 — advisory_answers : deux membres différents peuvent chacun avoir une réponse active à la même question', async () => {
  const db = await importFreshDb(tempDir());
  const userId = insertFixtureUser(db);
  const clientId = insertFixtureClient(db);
  const householdId = db.prepare('INSERT INTO households (primary_client_id) VALUES (?)').run(clientId).lastInsertRowid;
  const member1 = db.prepare("INSERT INTO household_members (household_id, client_id, member_role) VALUES (?, ?, 'principal')").run(householdId, clientId).lastInsertRowid;
  const secondClientId = insertFixtureClient(db, 'Enfant', 'Test');
  const member2 = db.prepare("INSERT INTO household_members (household_id, client_id, member_role) VALUES (?, ?, 'enfant')").run(householdId, secondClientId).lastInsertRowid;
  const sessionId = db.prepare("INSERT INTO advisory_sessions (household_id, advisor_user_id, domain) VALUES (?, ?, 'health')").run(householdId, userId).lastInsertRowid;
  const qid = db.prepare("INSERT INTO advisory_questionnaires (stable_key, domain, name) VALUES ('h4', 'health', 'Santé 4')").run().lastInsertRowid;
  const vid = db.prepare('INSERT INTO advisory_questionnaire_versions (questionnaire_id, version_number) VALUES (?, 1)').run(qid).lastInsertRowid;
  const sid = db.prepare("INSERT INTO advisory_sections (questionnaire_version_id, stable_key, title, sort_order, applies_to) VALUES (?, 's1', 'S', 1, 'member')").run(vid).lastInsertRowid;
  const questionId = db.prepare(
    "INSERT INTO advisory_questions (section_id, questionnaire_version_id, stable_key, advisor_text, type, scope, sort_order) VALUES (?, ?, 'q1', 'T', 'boolean', 'member', 1)"
  ).run(sid, vid).lastInsertRowid;
  assert.doesNotThrow(() => {
    db.prepare("INSERT INTO advisory_answers (session_id, question_id, household_member_id, status, value_boolean, revision) VALUES (?, ?, ?, 'answered', 1, 1)").run(sessionId, questionId, member1);
    db.prepare("INSERT INTO advisory_answers (session_id, question_id, household_member_id, status, value_boolean, revision) VALUES (?, ?, ?, 'answered', 0, 1)").run(sessionId, questionId, member2);
  });
});
