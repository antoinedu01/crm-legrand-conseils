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

// Base héritée fidèle à v10 (juste avant le moteur de règles du LOT 4A) —
// construite en faisant tourner la VRAIE chaîne de migrations jusqu'à la
// version courante, puis en retirant uniquement l'apport de la migration
// 11 (les 4 tables du moteur de règles, dans l'ordre inverse de création
// documenté dans docs/MIGRATIONS.md) et en refixant `user_version = 10`.
// Fidélité garantie (contrairement à `buildLegacyV6Database`, qui rejoue le
// DDL v1-v6 à la main) : aucune divergence possible avec le schéma v10 réel
// puisqu'il est produit par le code de migration lui-même.
async function buildLegacyV10Database(dataDir) {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-migration-v10-scratch-'));
  const scratchDb = await importFreshDb(scratchDir);
  const scratchFile = path.join(scratchDir, 'crm.sqlite');
  scratchDb.close();

  const file = path.join(dataDir, 'crm.sqlite');
  fs.copyFileSync(scratchFile, file);
  const db = new Database(file);
  db.exec(`
    DROP TABLE advisory_findings;
    DROP TABLE advisory_rule_executions;
    DROP TABLE advisory_rules;
    DROP TABLE advisory_rule_sets;
  `);
  db.pragma('user_version = 10');
  db.close();
}

// Même principe que `buildLegacyV10Database`, pour tester une migration
// RÉELLE v11 -> v12 (LOT 7A) : produit par le code de migration lui-même
// (fidélité garantie), puis retire les 3 tables de recommandations et
// refixe `user_version = 11`.
async function buildLegacyV11Database(dataDir) {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-migration-v11-scratch-'));
  const scratchDb = await importFreshDb(scratchDir);
  const scratchFile = path.join(scratchDir, 'crm.sqlite');
  scratchDb.close();

  const file = path.join(dataDir, 'crm.sqlite');
  fs.copyFileSync(scratchFile, file);
  const db = new Database(file);
  db.exec(`
    DROP TABLE advisory_recommendation_members;
    DROP TABLE advisory_recommendation_findings;
    DROP TABLE advisory_recommendations;
  `);
  db.pragma('user_version = 11');
  db.close();
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

// LOT 4A — moteur de règles et findings. Volontairement PAS de
// advisory_recommendations/catalogue produit/advisory_consents/
// advisory_reports à ce stade (périmètre strictement limité, décision
// humaine du GATE LOT 4A).
const ADVISORY_V11_TABLES = [
  'advisory_rule_sets', 'advisory_rules', 'advisory_rule_executions', 'advisory_findings',
];

const ADVISORY_V12_TABLES = [
  'advisory_recommendations', 'advisory_recommendation_findings', 'advisory_recommendation_members',
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

test('migration v10 — les 8 tables historiques existent (sous-ensemble, la base courante dépasse maintenant v10)', async () => {
  const db = await importFreshDb(tempDir());
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'advisory_%'").all().map((t) => t.name);
  for (const t of ADVISORY_V10_TABLES) assert.ok(tables.includes(t), `table manquante : ${t}`);
});

test('migration v11 — les 4 tables du moteur de règles existent (sous-ensemble, la base courante dépasse maintenant v11) ; consents/reports/catalogue produit toujours absents', async () => {
  const db = await importFreshDb(tempDir());
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'advisory_%'").all().map((t) => t.name);
  for (const t of ADVISORY_V11_TABLES) assert.ok(tables.includes(t), `table manquante : ${t}`);
  // advisory_recommendations existe désormais (LOT 7A, migration 12) — voir
  // les tests « migration v12 » dédiés ci-dessous. consents/reports/catalogue
  // produit restent hors périmètre de tous les lots livrés à ce jour.
  assert.ok(!tables.includes('advisory_consents'), 'advisory_consents ne doit pas encore exister');
  assert.ok(!tables.includes('advisory_reports'), 'advisory_reports ne doit pas encore exister');
});

test('migration v11 — une base neuve atteint au moins user_version = 11', async () => {
  const db = await importFreshDb(tempDir());
  assert.ok(db.pragma('user_version', { simple: true }) >= 11);
});

test('migration v11 — idempotence : un second import de la même base n’échoue pas et reste au moins en v11', async () => {
  const dir = tempDir();
  await importFreshDb(dir);
  const db = await importFreshDb(dir);
  assert.ok(db.pragma('user_version', { simple: true }) >= 11);
});

// Constat GATE LOT 4A §12 (revue advisory-architect) : les colonnes ajoutées
// PENDANT le GATE (finding_scope sur advisory_rules/advisory_findings,
// conflicts_detected_at_execution sur advisory_findings) n'étaient vérifiées
// nulle part au niveau du schéma lui-même, contrairement à allows_not_
// applicable (v10, ci-dessus) qui a un test dédié.
test('migration v11 — finding_scope existe sur advisory_rules ET advisory_findings, TEXT NOT NULL, défaut household', async () => {
  const db = await importFreshDb(tempDir());
  for (const table of ['advisory_rules', 'advisory_findings']) {
    const col = db.prepare(`PRAGMA table_info(${table})`).all().find((c) => c.name === 'finding_scope');
    assert.ok(col, `colonne finding_scope manquante sur ${table}`);
    assert.equal(col.notnull, 1, `${table}.finding_scope doit être NOT NULL`);
    assert.equal(col.dflt_value, "'household'", `${table}.finding_scope doit défauter à household`);
    assert.equal(col.type, 'TEXT');
  }
});

test('migration v11 — conflicts_detected_at_execution existe sur advisory_findings, TEXT nullable (JSON, historique et immuable)', async () => {
  const db = await importFreshDb(tempDir());
  const col = db.prepare('PRAGMA table_info(advisory_findings)').all().find((c) => c.name === 'conflicts_detected_at_execution');
  assert.ok(col, 'colonne conflicts_detected_at_execution manquante');
  assert.equal(col.notnull, 0);
  assert.equal(col.type, 'TEXT');
});

// GATE LOT 4A (correctif ciblé avant commit, décision humaine confirmée) :
// la politique « un seul advisory_rule_set publié par domaine » ne doit pas
// reposer uniquement sur l'hypothèse mono-processus de la couche applicative
// (server/advisoryRules.js assertNoOtherPublishedFamilyForDomain) — elle
// doit être garantie au niveau SQLite lui-même, INDÉPENDAMMENT de tout code
// applicatif (y compris un futur script, une migration de données, ou un
// bug contournant le service). Tous les tests ci-dessous écrivent en SQL
// BRUT, sans jamais passer par server/advisoryRules.js, pour prouver que la
// garantie tient même hors de ce chemin de code précis. Matrice complète
// exigée par le second GATE (correctif SQL, avant tout commit).

function insertRuleSet(db, { stable_key, domain, version_number = 1, status, name }) {
  return db
    .prepare('INSERT INTO advisory_rule_sets (stable_key, domain, version_number, status, name) VALUES (?, ?, ?, ?, ?)')
    .run(stable_key, domain, version_number, status, name);
}

test('migration v11 — index unique partiel : deux BROUILLONS (draft) health sont autorisés simultanément', async () => {
  const db = await importFreshDb(tempDir());
  assert.doesNotThrow(() => insertRuleSet(db, { stable_key: 'rs-draft-a', domain: 'health', status: 'draft', name: 'A' }));
  assert.doesNotThrow(() => insertRuleSet(db, { stable_key: 'rs-draft-b', domain: 'health', status: 'draft', name: 'B' }));
});

test('migration v11 — index unique partiel : plusieurs rule_sets ARCHIVÉS (archived) health sont autorisés simultanément', async () => {
  const db = await importFreshDb(tempDir());
  assert.doesNotThrow(() => insertRuleSet(db, { stable_key: 'rs-arch-a', domain: 'health', status: 'archived', name: 'A' }));
  assert.doesNotThrow(() => insertRuleSet(db, { stable_key: 'rs-arch-b', domain: 'health', status: 'archived', name: 'B' }));
  assert.doesNotThrow(() => insertRuleSet(db, { stable_key: 'rs-arch-c', domain: 'health', status: 'archived', name: 'C' }));
});

test('migration v11 — index unique partiel : un premier rule_set PUBLIÉ health est autorisé', async () => {
  const db = await importFreshDb(tempDir());
  assert.doesNotThrow(() => insertRuleSet(db, { stable_key: 'rs-pub-health-a', domain: 'health', status: 'published', name: 'A' }));
});

test('migration v11 — index unique partiel : un second rule_set PUBLIÉ health est rejeté directement par SQLite', async () => {
  const db = await importFreshDb(tempDir());
  insertRuleSet(db, { stable_key: 'rs-pub-health-a', domain: 'health', status: 'published', name: 'A' });
  assert.throws(
    () => insertRuleSet(db, { stable_key: 'rs-pub-health-b', domain: 'health', status: 'published', name: 'B' }),
    (e) => e.code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
});

test('migration v11 — index unique partiel : un second rule_set PUBLIÉ common est rejeté directement par SQLite', async () => {
  const db = await importFreshDb(tempDir());
  insertRuleSet(db, { stable_key: 'rs-pub-common-a', domain: 'common', status: 'published', name: 'A' });
  assert.throws(
    () => insertRuleSet(db, { stable_key: 'rs-pub-common-b', domain: 'common', status: 'published', name: 'B' }),
    (e) => e.code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
});

test('migration v11 — index unique partiel : un second rule_set PUBLIÉ life_pension est rejeté directement par SQLite', async () => {
  const db = await importFreshDb(tempDir());
  insertRuleSet(db, { stable_key: 'rs-pub-life-a', domain: 'life_pension', status: 'published', name: 'A' });
  assert.throws(
    () => insertRuleSet(db, { stable_key: 'rs-pub-life-b', domain: 'life_pension', status: 'published', name: 'B' }),
    (e) => e.code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
});

test('migration v11 — index unique partiel : un common, un health ET un life_pension publiés SIMULTANÉMENT sont autorisés (domaines indépendants)', async () => {
  const db = await importFreshDb(tempDir());
  assert.doesNotThrow(() => insertRuleSet(db, { stable_key: 'rs-simul-common', domain: 'common', status: 'published', name: 'C' }));
  assert.doesNotThrow(() => insertRuleSet(db, { stable_key: 'rs-simul-health', domain: 'health', status: 'published', name: 'H' }));
  assert.doesNotThrow(() => insertRuleSet(db, { stable_key: 'rs-simul-life', domain: 'life_pension', status: 'published', name: 'L' }));
  const published = db.prepare("SELECT domain FROM advisory_rule_sets WHERE status = 'published' ORDER BY domain").all().map((r) => r.domain);
  assert.deepEqual(published, ['common', 'health', 'life_pension']);
});

test('migration v11 — l\'index idx_advisory_rule_sets_one_published_per_domain EXISTE', async () => {
  const db = await importFreshDb(tempDir());
  const idx = db.prepare("SELECT * FROM sqlite_master WHERE type = 'index' AND name = 'idx_advisory_rule_sets_one_published_per_domain'").get();
  assert.ok(idx, 'index manquant');
});

test('migration v11 — l\'index idx_advisory_rule_sets_one_published_per_domain est bien UNIQUE', async () => {
  const db = await importFreshDb(tempDir());
  const info = db.prepare('PRAGMA index_list(advisory_rule_sets)').all().find((i) => i.name === 'idx_advisory_rule_sets_one_published_per_domain');
  assert.ok(info, 'index manquant dans PRAGMA index_list');
  assert.equal(info.unique, 1, 'l\'index doit être unique');
});

test('migration v11 — l\'index idx_advisory_rule_sets_one_published_per_domain est bien PARTIEL', async () => {
  const db = await importFreshDb(tempDir());
  const info = db.prepare('PRAGMA index_list(advisory_rule_sets)').all().find((i) => i.name === 'idx_advisory_rule_sets_one_published_per_domain');
  assert.ok(info, 'index manquant dans PRAGMA index_list');
  assert.equal(info.partial, 1, 'l\'index doit être partiel (avec clause WHERE)');
});

test('migration v11 — le SQL de l\'index contient bien WHERE status = \'published\'', async () => {
  const db = await importFreshDb(tempDir());
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_advisory_rule_sets_one_published_per_domain'").get();
  assert.ok(row && row.sql, 'SQL de l\'index introuvable');
  assert.match(row.sql, /WHERE\s+status\s*=\s*'published'/i);
});

test('migration v11 — index unique partiel : présent après une migration RÉELLE depuis une base héritée en v10', async () => {
  const dir = tempDir();
  await buildLegacyV10Database(dir);
  const db = await importFreshDb(dir);
  assert.ok(db.pragma('user_version', { simple: true }) >= 11);
  const idx = db.prepare("SELECT * FROM sqlite_master WHERE type = 'index' AND name = 'idx_advisory_rule_sets_one_published_per_domain'").get();
  assert.ok(idx, 'l\'index doit être créé par la migration 11 en repartant d\'une base v10 réelle');
  // La contrainte fonctionne bien sur cette base issue d'une VRAIE migration.
  insertRuleSet(db, { stable_key: 'rs-legacy-a', domain: 'health', status: 'published', name: 'A' });
  assert.throws(
    () => insertRuleSet(db, { stable_key: 'rs-legacy-b', domain: 'health', status: 'published', name: 'B' }),
    (e) => e.code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
});

test('migration v11 — index unique partiel : redémarrages répétés (3x) restent idempotents, index stable et toujours unique', async () => {
  const dir = tempDir();
  for (let i = 0; i < 3; i += 1) {
    const db = await importFreshDb(dir);
    assert.ok(db.pragma('user_version', { simple: true }) >= 11);
    const info = db.prepare('PRAGMA index_list(advisory_rule_sets)').all().filter((idx) => idx.name === 'idx_advisory_rule_sets_one_published_per_domain');
    assert.equal(info.length, 1, 'l\'index ne doit jamais être dupliqué par un redémarrage répété');
    assert.equal(info[0].unique, 1);
  }
});

// Rescopé à la migration 14 (contrôles de conservation/anonymisation/
// effacement, chantier préalable à l'activation) : la frontière « aucun bloc
// ultérieur » se déplace mécaniquement à chaque nouvelle migration ajoutée —
// même précédent que le déplacement 11→12, puis 12→13, puis 13→14 documenté
// ici.
test('migration v14 — absence de migration 15 : la dernière version de schéma reste 14, aucun bloc de migration ultérieur', async () => {
  const db = await importFreshDb(tempDir());
  assert.equal(db.pragma('user_version', { simple: true }), 14, 'la base neuve doit culminer exactement à la version 14, pas au-delà');
  const dbJsSource = fs.readFileSync(dbModulePath, 'utf8');
  assert.ok(!/version\s*<\s*15/.test(dbJsSource), 'aucun bloc "if (version < 15)" ne doit exister');
  assert.ok(!/user_version\s*=\s*15/.test(dbJsSource), 'aucun "user_version = 15" ne doit exister dans server/db.js');
});

// Correctif SQL ciblé (second GATE, avant commit) : garantie SQLite
// éprouvée avec DEUX VRAIES connexions better-sqlite3 sur le même fichier
// (jamais une simulation de système distribué -- juste le comportement réel
// de SQLite en mode WAL avec deux connexions concurrentes, exactement ce
// que produirait un second processus applicatif). La connexion A imite le
// service (`server/advisoryRules.js`, qui exécute lui aussi ses écritures
// dans une transaction) ; la connexion B imite un second processus tentant
// une écriture concurrente contradictoire.
test('migration v11 — deux connexions SQLite réelles sur le même fichier : verrouillage WAL puis violation d\'unicité, jamais deux published simultanés', async () => {
  const dir = tempDir();
  const dbA = await importFreshDb(dir);
  const file = path.join(dir, 'crm.sqlite');
  const dbB = new Database(file);
  dbB.pragma('journal_mode = WAL');
  dbB.pragma('foreign_keys = ON');
  // Délai d'attente court et déterministe (au lieu du défaut de
  // better-sqlite3, plusieurs secondes) : le comportement observé (SQLITE_
  // BUSY tant que A n'a pas validé) reste réel et inchangé, seul le temps
  // d'attente avant l'abandon est raccourci pour un test rapide.
  dbB.pragma('busy_timeout = 200');

  try {
    // Connexion A ouvre une transaction d'ÉCRITURE explicite (BEGIN
    // IMMEDIATE acquiert le verrou d'écriture immédiatement, exactement
    // comme le ferait `db.transaction()` de better-sqlite3 utilisé par
    // server/advisoryRules.js) et publie un rule_set health, SANS commit.
    dbA.prepare('BEGIN IMMEDIATE').run();
    dbA.prepare(
      "INSERT INTO advisory_rule_sets (stable_key, domain, version_number, status, name) VALUES ('rs-race-a', 'health', 1, 'published', 'A')"
    ).run();

    // Connexion B tente une insertion brute contradictoire PENDANT que A
    // détient encore le verrou d'écriture (transaction non validée) :
    // comportement RÉEL de SQLite observé ici, jamais présumé -- verrouillage
    // (SQLITE_BUSY), le second writer devant attendre son tour.
    assert.throws(
      () => dbB.prepare(
        "INSERT INTO advisory_rule_sets (stable_key, domain, version_number, status, name) VALUES ('rs-race-b', 'health', 1, 'published', 'B')"
      ).run(),
      (e) => e.code === 'SQLITE_BUSY',
      'la connexion B doit être bloquée par le verrou d\'écriture WAL tant que A n\'a pas validé sa transaction'
    );

    // A valide sa transaction : le verrou est relâché.
    dbA.prepare('COMMIT').run();

    // B retente désormais la MÊME écriture contradictoire -- cette fois le
    // verrou n'est plus en cause, c'est l'index UNIQUE PARTIEL lui-même qui
    // bloque la duplication, observé via une VRAIE seconde connexion.
    assert.throws(
      () => dbB.prepare(
        "INSERT INTO advisory_rule_sets (stable_key, domain, version_number, status, name) VALUES ('rs-race-b', 'health', 1, 'published', 'B')"
      ).run(),
      (e) => e.code === 'SQLITE_CONSTRAINT_UNIQUE',
      'après résolution du verrou, la violation d\'unicité doit être détectée par SQLite, pas seulement par le service applicatif'
    );

    // État final : EXACTEMENT un rule_set publié pour le domaine health,
    // celui de la connexion A.
    const publishedHealth = dbB.prepare("SELECT stable_key FROM advisory_rule_sets WHERE domain = 'health' AND status = 'published'").all();
    assert.deepEqual(publishedHealth.map((r) => r.stable_key), ['rs-race-a']);

    // Les TROIS domaines restent indépendants même avec deux connexions
    // actives : publier common/life_pension via B pendant que A reste ouvert
    // (sans transaction active cette fois) ne rencontre aucun conflit.
    assert.doesNotThrow(() => dbB.prepare(
      "INSERT INTO advisory_rule_sets (stable_key, domain, version_number, status, name) VALUES ('rs-race-common', 'common', 1, 'published', 'C')"
    ).run());
    assert.doesNotThrow(() => dbB.prepare(
      "INSERT INTO advisory_rule_sets (stable_key, domain, version_number, status, name) VALUES ('rs-race-life', 'life_pension', 1, 'published', 'L')"
    ).run());
    const allPublished = dbB.prepare("SELECT domain FROM advisory_rule_sets WHERE status = 'published' ORDER BY domain").all().map((r) => r.domain);
    assert.deepEqual(allPublished, ['common', 'health', 'life_pension']);

    // Aucune corruption : intégrité du fichier confirmée après la séquence
    // complète de verrouillage/résolution/écritures concurrentes.
    const integrity = dbB.pragma('integrity_check');
    assert.deepEqual(integrity, [{ integrity_check: 'ok' }]);
  } finally {
    dbB.close();
    dbA.close();
  }
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

// ============================================================================
// Migration v12 (LOT 7A) — recommandations humaines génériques
// ============================================================================

test('migration v12 — les 3 tables de recommandations existent, aucune table hors périmètre (produit/assureur/consents/reports)', async () => {
  const db = await importFreshDb(tempDir());
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'advisory_%'").all().map((t) => t.name);
  for (const t of ADVISORY_V12_TABLES) assert.ok(tables.includes(t), `table manquante : ${t}`);
  assert.ok(!tables.includes('advisory_consents'), 'advisory_consents ne doit pas exister au LOT 7A');
  assert.ok(!tables.includes('advisory_reports'), 'advisory_reports ne doit pas exister au LOT 7A');
  assert.ok(!tables.some((t) => /product|insurer|catalog/i.test(t)), 'aucune table produit/assureur/catalogue ne doit exister au LOT 7A');
});

test('migration v12 — une base neuve atteint au moins user_version = 12', async () => {
  const db = await importFreshDb(tempDir());
  assert.ok(db.pragma('user_version', { simple: true }) >= 12);
});

test('migration v13 — une base neuve atteint au moins user_version = 13', async () => {
  const db = await importFreshDb(tempDir());
  assert.ok(db.pragma('user_version', { simple: true }) >= 13);
});

test("migration v13 — idempotence : un second import de la même base n'échoue pas et reste au moins en v13", async () => {
  const dir = tempDir();
  await importFreshDb(dir);
  const db = await importFreshDb(dir);
  assert.ok(db.pragma('user_version', { simple: true }) >= 13);
});

test('migration v14 — une base neuve atteint exactement user_version = 14', async () => {
  const db = await importFreshDb(tempDir());
  assert.equal(db.pragma('user_version', { simple: true }), 14);
});

test('migration v14 — idempotence : un second import de la même base n’échoue pas et reste en v14', async () => {
  const dir = tempDir();
  await importFreshDb(dir);
  const db = await importFreshDb(dir);
  assert.equal(db.pragma('user_version', { simple: true }), 14);
});

// --- Migration 14 (contrôles de conservation) — base neuve -----------------

test('migration v14 — base neuve : les 4 tables de rétention existent, 5 politiques semées, toutes désactivées, purge globale désactivée', async () => {
  const db = await importFreshDb(tempDir());
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const t of [
    'advisory_retention_policies', 'advisory_retention_config',
    'advisory_retention_legal_holds', 'advisory_retention_purge_runs', 'advisory_retention_purge_run_items',
  ]) {
    assert.ok(tables.includes(t), `table ${t} manquante`);
  }
  const policies = db.prepare('SELECT category, enabled, duration_days FROM advisory_retention_policies ORDER BY category').all();
  assert.equal(policies.length, 5);
  assert.ok(policies.every((p) => p.enabled === 0), 'aucune catégorie ne doit être activée par défaut');
  const byCategory = Object.fromEntries(policies.map((p) => [p.category, p.duration_days]));
  assert.deepEqual(byCategory, {
    abandoned_diagnostic: 90, audit_log: 3650, backups: 90, finalized_advice: 3650, prospect_no_mandate: 365,
  });
  const config = db.prepare('SELECT real_purge_enabled FROM advisory_retention_config WHERE id = 1').get();
  assert.equal(config.real_purge_enabled, 0, 'la purge réelle doit rester désactivée par défaut');
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
});

// --- Migration 14 — base historique dérivée d'une v13 réelle ---------------

async function buildLegacyV13Database(dataDir) {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-migration-v13-scratch-'));
  const scratchDb = await importFreshDb(scratchDir);
  const scratchFile = path.join(scratchDir, 'crm.sqlite');
  scratchDb.close();

  const file = path.join(dataDir, 'crm.sqlite');
  fs.copyFileSync(scratchFile, file);
  const db = new Database(file);
  db.exec(`
    DROP TABLE advisory_retention_purge_run_items;
    DROP TABLE advisory_retention_purge_runs;
    DROP TABLE advisory_retention_legal_holds;
    DROP TABLE advisory_retention_config;
    DROP TABLE advisory_retention_policies;
  `);
  db.pragma('user_version = 13');
  db.close();
}

test('migration v14 — base historique v13 réelle : tables créées, politiques semées, aucune donnée applicative perdue', async () => {
  const dir = tempDir();
  await buildLegacyV13Database(dir);
  const legacyCheck = new Database(path.join(dir, 'crm.sqlite'));
  assert.equal(legacyCheck.pragma('user_version', { simple: true }), 13);
  const countsBefore = allTableCounts(legacyCheck);
  legacyCheck.close();

  const db = await importFreshDb(dir);
  assert.equal(db.pragma('user_version', { simple: true }), 14);
  const policies = db.prepare('SELECT COUNT(*) AS n FROM advisory_retention_policies').get();
  assert.equal(policies.n, 5);
  const config = db.prepare('SELECT real_purge_enabled FROM advisory_retention_config WHERE id = 1').get();
  assert.equal(config.real_purge_enabled, 0);

  // Aucune ligne perdue sur les tables déjà existantes en v13 (les 5 nouvelles
  // tables de ce lot n'apparaissent, elles, jamais dans countsBefore).
  const countsAfter = allTableCounts(db);
  for (const [table, count] of Object.entries(countsBefore)) {
    assert.equal(countsAfter[table], count, `perte de données détectée sur ${table}`);
  }
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('migration v14 — idempotence du seed des politiques : un second import ne duplique ni ne réinitialise une politique déjà modifiée', async () => {
  const dir = tempDir();
  const first = await importFreshDb(dir);
  // Simule une modification humaine ultérieure d'une politique (ex. durée
  // ajustée) -- un second import ne doit jamais l'écraser silencieusement
  // (INSERT OR IGNORE, jamais un UPSERT qui réécrirait une ligne existante).
  first.prepare("UPDATE advisory_retention_policies SET duration_days = 120 WHERE category = 'abandoned_diagnostic'").run();

  const second = await importFreshDb(dir);
  const policies = second.prepare('SELECT COUNT(*) AS n FROM advisory_retention_policies').get();
  assert.equal(policies.n, 5, 'aucune ligne dupliquée par le second import');
  const modified = second.prepare("SELECT duration_days FROM advisory_retention_policies WHERE category = 'abandoned_diagnostic'").get();
  assert.equal(modified.duration_days, 120, 'une politique déjà modifiée ne doit jamais être réinitialisée par un import ultérieur');
});

test('migration v12 — advisory_recommendations : colonnes attendues présentes avec les bons types/défauts', async () => {
  const db = await importFreshDb(tempDir());
  const cols = new Map(db.prepare('PRAGMA table_info(advisory_recommendations)').all().map((c) => [c.name, c]));
  assert.ok(cols.has('domain'));
  assert.ok(cols.has('scope'));
  assert.equal(cols.get('status').dflt_value, "'draft'");
  assert.equal(cols.get('revision').notnull, 1);
  assert.equal(cols.get('revision').dflt_value, '1');
  assert.equal(cols.get('no_alternatives_identified').dflt_value, '0');
  assert.equal(cols.get('no_additional_risks_identified').dflt_value, '0');
  assert.equal(cols.get('no_missing_information_known').dflt_value, '0');
  assert.ok(cols.has('supersedes_recommendation_id'));
  assert.ok(!cols.has('category'), 'category ne doit jamais exister (ambiguïté avec category_hint, décision humaine LOT 7A)');
  assert.ok(!cols.has('presented_to_client'), 'presented_to_client hors périmètre LOT 7A');
  assert.ok(!cols.has('client_decision'), 'client_decision hors périmètre LOT 7A');
});

test('migration v12 — advisory_recommendation_findings/advisory_recommendation_members : FK et UNIQUE présents', async () => {
  const db = await importFreshDb(tempDir());
  const findingsCols = new Set(db.prepare('PRAGMA table_info(advisory_recommendation_findings)').all().map((c) => c.name));
  for (const c of ['recommendation_id', 'finding_id', 'created_by_user_id', 'created_at']) assert.ok(findingsCols.has(c));
  const membersCols = new Set(db.prepare('PRAGMA table_info(advisory_recommendation_members)').all().map((c) => c.name));
  for (const c of ['recommendation_id', 'household_member_id', 'created_by_user_id', 'created_at']) assert.ok(membersCols.has(c));
});

test('migration v12 — index unique partiel du successeur : présent, UNIQUE, PARTIEL, WHERE exact', async () => {
  const db = await importFreshDb(tempDir());
  const row = db.prepare("SELECT * FROM sqlite_master WHERE type = 'index' AND name = 'idx_advisory_recommendations_one_non_dismissed_successor'").get();
  assert.ok(row, 'index manquant');
  const info = db.prepare('PRAGMA index_list(advisory_recommendations)').all().find((i) => i.name === row.name);
  assert.equal(info.unique, 1);
  assert.equal(info.partial, 1);
  assert.match(row.sql, /WHERE\s+supersedes_recommendation_id\s+IS\s+NOT\s+NULL\s+AND\s+status\s*<>\s*'dismissed'/i);
});

// Fixture minimale réelle (jamais un id inventé) : la table
// advisory_recommendations porte de vraies FK NOT NULL vers
// advisory_sessions/users, appliquées par SQLite (`foreign_keys = ON`,
// server/db.js) sur toute connexion issue de `importFreshDb`. Contrairement
// à `advisory_rule_sets` (Lot 4A, sans FK NOT NULL obligatoire vers une
// ligne devant réellement exister), ce test doit donc fabriquer un
// utilisateur/foyer/session réels avant d'insérer une recommandation brute.
function insertMinimalSessionFixture(db) {
  const userId = db.prepare("INSERT INTO users (email, name, password_hash) VALUES (?, 'T', 'x')").run(`u-${Math.random()}@exemple.ch`).lastInsertRowid;
  const clientId = db.prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'P', 'T', 'prospect')").run().lastInsertRowid;
  const householdId = db.prepare('INSERT INTO households (primary_client_id, status) VALUES (?, ?)').run(clientId, 'actif').lastInsertRowid;
  db.prepare("INSERT INTO household_members (household_id, client_id, member_role, status) VALUES (?, ?, 'principal', 'actif')").run(householdId, clientId);
  const sessionId = db.prepare("INSERT INTO advisory_sessions (household_id, advisor_user_id, domain, status, revision) VALUES (?, ?, 'health', 'completed', 1)").run(householdId, userId).lastInsertRowid;
  return { sessionId, userId };
}

function insertRecommendation(db, { session_id, user_id, domain = 'health', scope = 'household', status = 'draft', supersedes_recommendation_id = null, title = 'X' }) {
  return db.prepare(
    `INSERT INTO advisory_recommendations (session_id, domain, scope, status, revision, title, advisor_rationale, created_by_user_id, supersedes_recommendation_id)
     VALUES (?, ?, ?, ?, 1, ?, 'R', ?, ?)`
  ).run(session_id, domain, scope, status, title, user_id, supersedes_recommendation_id);
}

test('migration v12 — index unique partiel : plusieurs successeurs DISMISSED de la même source sont autorisés', async () => {
  const db = await importFreshDb(tempDir());
  const { sessionId, userId } = insertMinimalSessionFixture(db);
  const source = insertRecommendation(db, { session_id: sessionId, user_id: userId, status: 'validated', title: 'Source' }).lastInsertRowid;
  insertRecommendation(db, { session_id: sessionId, user_id: userId, status: 'dismissed', supersedes_recommendation_id: source, title: 'A' });
  assert.doesNotThrow(() => insertRecommendation(db, { session_id: sessionId, user_id: userId, status: 'dismissed', supersedes_recommendation_id: source, title: 'B' }));
});

test('migration v12 — index unique partiel : un premier successeur DRAFT est autorisé', async () => {
  const db = await importFreshDb(tempDir());
  const { sessionId, userId } = insertMinimalSessionFixture(db);
  const source = insertRecommendation(db, { session_id: sessionId, user_id: userId, status: 'validated', title: 'Source' }).lastInsertRowid;
  assert.doesNotThrow(() => insertRecommendation(db, { session_id: sessionId, user_id: userId, status: 'draft', supersedes_recommendation_id: source, title: 'A' }));
});

test('migration v12 — index unique partiel : un second successeur DRAFT de la même source est rejeté directement par SQLite', async () => {
  const db = await importFreshDb(tempDir());
  const { sessionId, userId } = insertMinimalSessionFixture(db);
  const source = insertRecommendation(db, { session_id: sessionId, user_id: userId, status: 'validated', title: 'Source' }).lastInsertRowid;
  insertRecommendation(db, { session_id: sessionId, user_id: userId, status: 'draft', supersedes_recommendation_id: source, title: 'A' });
  assert.throws(
    () => insertRecommendation(db, { session_id: sessionId, user_id: userId, status: 'draft', supersedes_recommendation_id: source, title: 'B' }),
    (e) => e.code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
});

test('migration v12 — index unique partiel : un successeur VALIDATED alors qu’un DRAFT non-dismissed existe déjà est rejeté', async () => {
  const db = await importFreshDb(tempDir());
  const { sessionId, userId } = insertMinimalSessionFixture(db);
  const source = insertRecommendation(db, { session_id: sessionId, user_id: userId, status: 'validated', title: 'Source' }).lastInsertRowid;
  insertRecommendation(db, { session_id: sessionId, user_id: userId, status: 'draft', supersedes_recommendation_id: source, title: 'A' });
  assert.throws(
    () => insertRecommendation(db, { session_id: sessionId, user_id: userId, status: 'validated', supersedes_recommendation_id: source, title: 'B' }),
    (e) => e.code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
});

test('migration v12 — index unique partiel : sources indépendantes (successeurs de sources différentes) toujours autorisées', async () => {
  const db = await importFreshDb(tempDir());
  const { sessionId, userId } = insertMinimalSessionFixture(db);
  const sourceA = insertRecommendation(db, { session_id: sessionId, user_id: userId, status: 'validated', title: 'Source A' }).lastInsertRowid;
  const sourceB = insertRecommendation(db, { session_id: sessionId, user_id: userId, status: 'validated', title: 'Source B' }).lastInsertRowid;
  assert.doesNotThrow(() => insertRecommendation(db, { session_id: sessionId, user_id: userId, status: 'draft', supersedes_recommendation_id: sourceA, title: 'A' }));
  assert.doesNotThrow(() => insertRecommendation(db, { session_id: sessionId, user_id: userId, status: 'draft', supersedes_recommendation_id: sourceB, title: 'B' }));
});

// Correctif (revue finale backend-test-auditor) : les tests ci-dessus
// couvrent tous la dimension `status <> 'dismissed'` de l'index, mais
// aucun n'isolait la dimension `supersedes_recommendation_id IS NOT NULL`
// -- ce test le fait explicitement : un nombre arbitraire de recommandations
// qui ne remplacent RIEN (`supersedes_recommendation_id = NULL`) ne sont
// jamais soumises à la contrainte d'unicité, quel que soit leur statut.
test('migration v12 — index unique partiel : supersedes_recommendation_id NULL n’est jamais soumis à la contrainte, quel que soit le nombre de lignes ou leur statut', async () => {
  const db = await importFreshDb(tempDir());
  const { sessionId, userId } = insertMinimalSessionFixture(db);
  assert.doesNotThrow(() => {
    for (let i = 0; i < 5; i += 1) {
      insertRecommendation(db, { session_id: sessionId, user_id: userId, status: i % 2 === 0 ? 'draft' : 'validated', supersedes_recommendation_id: null, title: `Indépendante ${i}` });
    }
  });
});

test('migration v12 — index unique partiel : présent après une migration RÉELLE depuis une base héritée en v11', async () => {
  const dir = tempDir();
  await buildLegacyV11Database(dir);
  const db = await importFreshDb(dir);
  assert.ok(db.pragma('user_version', { simple: true }) >= 12);
  const idx = db.prepare("SELECT * FROM sqlite_master WHERE type = 'index' AND name = 'idx_advisory_recommendations_one_non_dismissed_successor'").get();
  assert.ok(idx, 'l\'index doit être créé par la migration 12 en repartant d\'une base v11 réelle');
  const { sessionId, userId } = insertMinimalSessionFixture(db);
  const source = insertRecommendation(db, { session_id: sessionId, user_id: userId, status: 'validated', title: 'Source' }).lastInsertRowid;
  insertRecommendation(db, { session_id: sessionId, user_id: userId, status: 'draft', supersedes_recommendation_id: source, title: 'A' });
  assert.throws(
    () => insertRecommendation(db, { session_id: sessionId, user_id: userId, status: 'draft', supersedes_recommendation_id: source, title: 'B' }),
    (e) => e.code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
});

test('migration v12 — redémarrages répétés (3x) restent idempotents, index stable et toujours unique', async () => {
  const dir = tempDir();
  for (let i = 0; i < 3; i += 1) {
    const db = await importFreshDb(dir);
    assert.ok(db.pragma('user_version', { simple: true }) >= 12);
    const info = db.prepare('PRAGMA index_list(advisory_recommendations)').all().filter((idx) => idx.name === 'idx_advisory_recommendations_one_non_dismissed_successor');
    assert.equal(info.length, 1, 'l\'index ne doit jamais être dupliqué par un redémarrage répété');
    assert.equal(info[0].unique, 1);
  }
});

test('migration v12 — deux connexions SQLite réelles sur le même fichier : verrouillage WAL puis violation d\'unicité pour un second successeur non-dismissed', async () => {
  const dir = tempDir();
  const dbA = await importFreshDb(dir);
  const { sessionId, userId } = insertMinimalSessionFixture(dbA);
  const source = insertRecommendation(dbA, { session_id: sessionId, user_id: userId, status: 'validated', title: 'Source' }).lastInsertRowid;
  const file = path.join(dir, 'crm.sqlite');
  const dbB = new Database(file);
  dbB.pragma('busy_timeout = 200');
  try {
    dbA.exec('BEGIN IMMEDIATE');
    insertRecommendation(dbA, { session_id: sessionId, user_id: userId, status: 'draft', supersedes_recommendation_id: source, title: 'A' });

    assert.throws(() => {
      dbB.exec('BEGIN IMMEDIATE');
      insertRecommendation(dbB, { session_id: sessionId, user_id: userId, status: 'draft', supersedes_recommendation_id: source, title: 'B' });
    }, (e) => e.code === 'SQLITE_BUSY');
    try { dbB.exec('ROLLBACK'); } catch { /* déjà annulée par SQLITE_BUSY */ }

    dbA.exec('COMMIT');

    assert.throws(
      () => insertRecommendation(dbB, { session_id: sessionId, user_id: userId, status: 'draft', supersedes_recommendation_id: source, title: 'C' }),
      (e) => e.code === 'SQLITE_CONSTRAINT_UNIQUE'
    );
    assert.equal(dbB.pragma('integrity_check', { simple: true }), 'ok');
  } finally {
    dbA.close();
    dbB.close();
  }
});

// ===================== Migration v13 — correctif de dérive de schéma =====================
// advisory_rules.finding_scope, advisory_findings.finding_scope et
// advisory_findings.conflicts_detected_at_execution existent dans le code
// depuis la création même de ces tables (migration 11) ; les tests
// ci-dessous reconstituent fidèlement l'état RÉEL constaté (GATE de
// préactivation LOT 5/LOT 6) d'au moins une base ayant atteint
// user_version = 12 sans jamais avoir reçu ces colonnes ni l'index unique
// partiel idx_advisory_rule_sets_one_published_per_domain.

// Reconstruction fidèle d'une base v12 réelle affectée par la dérive :
// schéma complet par ailleurs (obtenu via une vraie migration fraîche), puis
// advisory_rules/advisory_findings recréées avec EXACTEMENT l'ensemble de
// colonnes constaté sur data/crm.sqlite (GATE de préactivation), et l'index
// unique partiel supprimé — jamais une base réelle ni data/** utilisée.
async function buildLegacyV12SchemaDriftDatabase(dataDir) {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-migration-v12-drift-scratch-'));
  const scratchDb = await importFreshDb(scratchDir);
  const scratchFile = path.join(scratchDir, 'crm.sqlite');
  scratchDb.close();

  const file = path.join(dataDir, 'crm.sqlite');
  fs.copyFileSync(scratchFile, file);
  const db = new Database(file);
  db.pragma('foreign_keys = OFF');
  db.exec(`
    DROP INDEX IF EXISTS idx_advisory_rule_sets_one_published_per_domain;

    DROP TABLE advisory_findings;
    CREATE TABLE advisory_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_execution_id INTEGER NOT NULL REFERENCES advisory_rule_executions(id),
      session_id INTEGER NOT NULL REFERENCES advisory_sessions(id),
      rule_id INTEGER NOT NULL REFERENCES advisory_rules(id),
      stable_key TEXT NOT NULL,
      domain TEXT NOT NULL,
      household_member_id INTEGER REFERENCES household_members(id),
      finding_type TEXT NOT NULL,
      priority TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      advisor_explanation TEXT NOT NULL,
      client_explanation TEXT,
      missing_data TEXT,
      warnings TEXT,
      contraindications TEXT,
      used_inputs_ref TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      dismiss_reason TEXT,
      dismissed_by_user_id INTEGER REFERENCES users(id),
      dismissed_at TEXT,
      needs_review INTEGER NOT NULL DEFAULT 0,
      conflicts_with TEXT,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    DROP TABLE advisory_rules;
    CREATE TABLE advisory_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_set_id INTEGER NOT NULL REFERENCES advisory_rule_sets(id),
      stable_key TEXT NOT NULL,
      domain TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      conditions TEXT NOT NULL,
      required_data TEXT NOT NULL,
      result_finding_type TEXT NOT NULL,
      result_payload TEXT,
      priority TEXT NOT NULL DEFAULT 'medium',
      advisor_explanation TEXT NOT NULL,
      client_explanation TEXT,
      warnings TEXT,
      contraindications TEXT,
      source TEXT,
      source_reference TEXT,
      effective_from TEXT,
      effective_until TEXT,
      validated_by_user_id INTEGER REFERENCES users(id),
      validated_at TEXT,
      sort_order INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(rule_set_id, stable_key)
    );
  `);
  db.pragma('foreign_keys = ON');
  db.pragma('user_version = 12');
  return db;
}

function insertLegacyRuleSetFixture(db, { domain = 'health', status = 'published' } = {}) {
  return db.prepare(
    `INSERT INTO advisory_rule_sets (stable_key, domain, version_number, status, name)
     VALUES (?, ?, 1, ?, 'Fixture historique')`
  ).run(`fixture-${domain}-${Math.random()}`, domain, status).lastInsertRowid;
}
function insertLegacyRuleFixture(db, ruleSetId, { stableKey = `regle-${Math.random()}`, domain = 'health' } = {}) {
  return db.prepare(
    `INSERT INTO advisory_rules (rule_set_id, stable_key, domain, title, conditions, required_data, result_finding_type, advisor_explanation, sort_order)
     VALUES (?, ?, ?, 'Règle fixture', '{"op":"equals","ref":{"answer":"x"},"value":"oui"}', '[]', 'warning', 'Explication fixture', 1)`
  ).run(ruleSetId, stableKey, domain).lastInsertRowid;
}
function insertLegacyExecutionFixture(db, sessionId, ruleSetId) {
  return db.prepare(
    `INSERT INTO advisory_rule_executions (session_id, session_revision, domain, rule_set_id, rule_set_version_number, content_hash, engine_version)
     VALUES (?, 1, 'health', ?, 1, 'fixturehash', 'test')`
  ).run(sessionId, ruleSetId).lastInsertRowid;
}
function insertLegacyFindingFixture(db, { executionId, sessionId, ruleId, memberId = null }) {
  return db.prepare(
    `INSERT INTO advisory_findings (rule_execution_id, session_id, rule_id, stable_key, domain, household_member_id, finding_type, priority, title, summary, advisor_explanation, sort_order)
     VALUES (?, ?, ?, 'regle-fixture', 'health', ?, 'warning', 'medium', 'Constat fixture', 'Résumé fixture', 'Explication fixture', 1)`
  ).run(executionId, sessionId, ruleId, memberId).lastInsertRowid;
}

// Comptage de TOUTES les tables applicatives (pas seulement celles touchées
// par la migration 13) — utilisé pour prouver l'absence de perte de donnée
// sur l'ensemble du schéma, pas seulement sur les 2 tables modifiées.
function allTableCounts(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
  const counts = {};
  for (const t of tables) counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
  return counts;
}

// --- Base neuve ---

test('migration v13 — base neuve : colonnes présentes, user_version 13, suite fonctionnelle intacte', async () => {
  const db = await importFreshDb(tempDir());
  assert.equal(db.pragma('user_version', { simple: true }), 14);
  assert.ok(db.prepare('PRAGMA table_info(advisory_rules)').all().some((c) => c.name === 'finding_scope'));
  assert.ok(db.prepare('PRAGMA table_info(advisory_findings)').all().some((c) => c.name === 'finding_scope'));
  assert.ok(db.prepare('PRAGMA table_info(advisory_findings)').all().some((c) => c.name === 'conflicts_detected_at_execution'));
  const idx = db.prepare("SELECT * FROM sqlite_master WHERE type = 'index' AND name = 'idx_advisory_rule_sets_one_published_per_domain'").get();
  assert.ok(idx);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
});

// --- Base historique dérivée (fixture réaliste : user_version 12, colonnes
// absentes, règles/findings fictifs déjà présents, FK et index existants) ---

test('migration v13 — base historique dérivée : colonnes ajoutées, données préservées, backfill correct, intégrité OK', async () => {
  const dir = tempDir();
  const legacy = await buildLegacyV12SchemaDriftDatabase(dir);
  assert.equal(legacy.pragma('user_version', { simple: true }), 12);
  assert.ok(!legacy.prepare('PRAGMA table_info(advisory_rules)').all().some((c) => c.name === 'finding_scope'), 'fixture invalide : la colonne ne doit pas exister avant migration');

  const { sessionId } = insertMinimalSessionFixture(legacy);
  const ruleSetId = insertLegacyRuleSetFixture(legacy, { domain: 'health', status: 'published' });
  const ruleId = insertLegacyRuleFixture(legacy, ruleSetId, { domain: 'health' });
  const executionId = insertLegacyExecutionFixture(legacy, sessionId, ruleSetId);
  const memberRow = legacy.prepare('SELECT id FROM household_members LIMIT 1').get();
  const findingId = insertLegacyFindingFixture(legacy, { executionId, sessionId, ruleId, memberId: memberRow.id });
  const countsBefore = allTableCounts(legacy);
  legacy.close();

  const db = await importFreshDb(dir);
  assert.equal(db.pragma('user_version', { simple: true }), 14);

  // Données préservées sur TOUTES les tables (aucune ligne perdue nulle part,
  // pas seulement dans les 2 tables directement modifiées par la migration).
  const countsAfter = allTableCounts(db);
  assert.deepEqual(countsAfter, countsBefore);

  // Backfill : la règle historique (créée avant toute notion de portée par
  // membre) reçoit la valeur de comportement historique réel 'household'.
  const rule = db.prepare('SELECT finding_scope FROM advisory_rules WHERE id = ?').get(ruleId);
  assert.equal(rule.finding_scope, 'household');

  // Backfill : le finding hérite de la portée de SA règle source (jamais
  // une valeur générique attribuée indépendamment).
  const finding = db.prepare('SELECT finding_scope, conflicts_detected_at_execution FROM advisory_findings WHERE id = ?').get(findingId);
  assert.equal(finding.finding_scope, 'household');
  // Historique et jamais deviné : NULL, pas une liste vide affirmant "aucun conflit constaté".
  assert.equal(finding.conflicts_detected_at_execution, null);

  // Index recréé, FK et intégrité valides.
  const idx = db.prepare("SELECT * FROM sqlite_master WHERE type = 'index' AND name = 'idx_advisory_rule_sets_one_published_per_domain'").get();
  assert.ok(idx);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('migration v13 — base historique avec plusieurs règles/findings sur deux membres : backfill cohérent pour chaque ligne', async () => {
  const dir = tempDir();
  const legacy = await buildLegacyV12SchemaDriftDatabase(dir);
  const { sessionId } = insertMinimalSessionFixture(legacy);
  const householdId = legacy.prepare('SELECT household_id FROM advisory_sessions WHERE id = ?').get(sessionId).household_id;
  const secondClientId = legacy.prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'P2', 'T2', 'prospect')").run().lastInsertRowid;
  const secondMemberId = legacy.prepare("INSERT INTO household_members (household_id, client_id, member_role, status) VALUES (?, ?, 'conjoint', 'actif')").run(householdId, secondClientId).lastInsertRowid;
  const firstMemberId = legacy.prepare("SELECT id FROM household_members WHERE household_id = ? AND member_role = 'principal'").get(householdId).id;

  const ruleSetId = insertLegacyRuleSetFixture(legacy, { domain: 'life_pension', status: 'archived' });
  const ruleId = insertLegacyRuleFixture(legacy, ruleSetId, { domain: 'life_pension' });
  const executionId = insertLegacyExecutionFixture(legacy, sessionId, ruleSetId);
  const f1 = insertLegacyFindingFixture(legacy, { executionId, sessionId, ruleId, memberId: firstMemberId });
  const f2 = insertLegacyFindingFixture(legacy, { executionId, sessionId, ruleId, memberId: secondMemberId });
  legacy.close();

  const db = await importFreshDb(dir);
  assert.equal(db.pragma('user_version', { simple: true }), 14);
  for (const fid of [f1, f2]) {
    const finding = db.prepare('SELECT finding_scope FROM advisory_findings WHERE id = ?').get(fid);
    assert.equal(finding.finding_scope, 'household');
  }
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
});

// --- Bases partiellement corrigées ---

test('migration v13 — une seule colonne manquante (finding_scope sur advisory_findings uniquement) : migration réussit sans duplication', async () => {
  const dir = tempDir();
  const legacy = await buildLegacyV12SchemaDriftDatabase(dir);
  // Recolle finding_scope sur advisory_rules pour simuler un correctif
  // partiel déjà appliqué manuellement — seule advisory_findings reste en retard.
  legacy.exec(`ALTER TABLE advisory_rules ADD COLUMN finding_scope TEXT NOT NULL DEFAULT 'household'`);
  legacy.close();

  const db = await importFreshDb(dir);
  assert.equal(db.pragma('user_version', { simple: true }), 14);
  assert.equal(db.prepare('PRAGMA table_info(advisory_rules)').all().filter((c) => c.name === 'finding_scope').length, 1, 'jamais de colonne dupliquée');
  assert.ok(db.prepare('PRAGMA table_info(advisory_findings)').all().some((c) => c.name === 'finding_scope'));
  assert.ok(db.prepare('PRAGMA table_info(advisory_findings)').all().some((c) => c.name === 'conflicts_detected_at_execution'));
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
});

test('migration v13 — deux colonnes manquantes (advisory_findings uniquement) : migration réussit', async () => {
  const dir = tempDir();
  const legacy = await buildLegacyV12SchemaDriftDatabase(dir);
  legacy.exec(`ALTER TABLE advisory_rules ADD COLUMN finding_scope TEXT NOT NULL DEFAULT 'household'`);
  legacy.close();
  const db = await importFreshDb(dir);
  assert.equal(db.pragma('user_version', { simple: true }), 14);
  assert.ok(db.prepare('PRAGMA table_info(advisory_findings)').all().some((c) => c.name === 'finding_scope'));
  assert.ok(db.prepare('PRAGMA table_info(advisory_findings)').all().some((c) => c.name === 'conflicts_detected_at_execution'));
});

test('migration v13 — aucune colonne manquante mais user_version encore 12 : migration réussit sans duplication ni erreur', async () => {
  const dir = tempDir();
  // Base v12 dont le schéma est en réalité DÉJÀ complet (toutes les colonnes
  // présentes), seul user_version n'a jamais été avancé — cas d'une base
  // corrigée manuellement dont l'avancement de version aurait été oublié.
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-migration-v13-complete-scratch-'));
  const scratchDb = await importFreshDb(scratchDir);
  scratchDb.close();
  fs.copyFileSync(path.join(scratchDir, 'crm.sqlite'), path.join(dir, 'crm.sqlite'));
  const legacy = new Database(path.join(dir, 'crm.sqlite'));
  legacy.pragma('user_version = 12');
  legacy.close();

  const db = await importFreshDb(dir);
  assert.equal(db.pragma('user_version', { simple: true }), 14);
  assert.equal(db.prepare('PRAGMA table_info(advisory_rules)').all().filter((c) => c.name === 'finding_scope').length, 1);
  assert.equal(db.prepare('PRAGMA table_info(advisory_findings)').all().filter((c) => c.name === 'finding_scope').length, 1);
  assert.equal(db.prepare('PRAGMA table_info(advisory_findings)').all().filter((c) => c.name === 'conflicts_detected_at_execution').length, 1);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
});

test('migration v13 — backfill différencié : deux règles à finding_scope RÉELLEMENT distinct (correctif partiel déjà appliqué à advisory_rules) — chaque finding hérite de SA règle, jamais de la valeur DEFAULT', async () => {
  const dir = tempDir();
  const legacy = await buildLegacyV12SchemaDriftDatabase(dir);
  // Simule un correctif partiel déjà appliqué manuellement à advisory_rules
  // AVANT cette migration, avec des valeurs déjà différenciées par ligne —
  // seule advisory_findings reste en retard. Ceci prouve que le backfill de
  // advisory_findings.finding_scope utilise réellement le SELECT corrélé sur
  // la règle source (server/db.js), pas seulement la valeur DEFAULT
  // 'household' de l'ALTER TABLE (que toutes les lignes recevraient sinon,
  // rendant le test incapable de distinguer les deux mécanismes).
  legacy.exec(`ALTER TABLE advisory_rules ADD COLUMN finding_scope TEXT NOT NULL DEFAULT 'household'`);

  const { sessionId } = insertMinimalSessionFixture(legacy);
  const ruleSetId = insertLegacyRuleSetFixture(legacy, { domain: 'life_pension', status: 'archived' });
  const memberRuleId = insertLegacyRuleFixture(legacy, ruleSetId, { domain: 'life_pension', stableKey: 'regle-member' });
  const sessionRuleId = insertLegacyRuleFixture(legacy, ruleSetId, { domain: 'life_pension', stableKey: 'regle-session' });
  legacy.prepare('UPDATE advisory_rules SET finding_scope = ? WHERE id = ?').run('member', memberRuleId);
  legacy.prepare('UPDATE advisory_rules SET finding_scope = ? WHERE id = ?').run('session', sessionRuleId);
  const executionId = insertLegacyExecutionFixture(legacy, sessionId, ruleSetId);
  const memberRow = legacy.prepare('SELECT id FROM household_members LIMIT 1').get();
  const memberFindingId = insertLegacyFindingFixture(legacy, { executionId, sessionId, ruleId: memberRuleId, memberId: memberRow.id });
  const sessionFindingId = insertLegacyFindingFixture(legacy, { executionId, sessionId, ruleId: sessionRuleId, memberId: null });
  legacy.close();

  const db = await importFreshDb(dir);
  assert.equal(db.pragma('user_version', { simple: true }), 14);
  assert.equal(db.prepare('SELECT finding_scope FROM advisory_findings WHERE id = ?').get(memberFindingId).finding_scope, 'member');
  assert.equal(db.prepare('SELECT finding_scope FROM advisory_findings WHERE id = ?').get(sessionFindingId).finding_scope, 'session');
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
});

// --- Contrainte violée par des données existantes ---
// Cas réellement atteignable sur une base héritée : dépourvue de l'index
// unique partiel depuis le départ (précisément le constat du GATE de
// préactivation), elle n'était protégée contre plusieurs rule_sets publiés
// pour un même domaine que par le contrôle applicatif
// (`assertNoOtherPublishedFamilyForDomain`), qui ne résiste pas à deux
// publications concurrentes (docs/MIGRATIONS.md, version 11).
test('migration v13 — échec contrôlé : deux rule_sets déjà "published" pour le même domaine (viole la contrainte de l\'index avant sa création) — erreur actionnable, transaction annulée, user_version inchangé', async () => {
  const dir = tempDir();
  const legacy = await buildLegacyV12SchemaDriftDatabase(dir);
  const firstId = insertLegacyRuleSetFixture(legacy, { domain: 'health', status: 'published' });
  const secondId = insertLegacyRuleSetFixture(legacy, { domain: 'health', status: 'published' });
  const countsBefore = allTableCounts(legacy);
  legacy.close();

  await assert.rejects(
    () => importFreshDb(dir),
    (err) => {
      assert.match(err.message, /Migration 13 bloquée/);
      assert.match(err.message, /"health"/);
      assert.match(err.message, new RegExp(`${firstId}`));
      assert.match(err.message, new RegExp(`${secondId}`));
      return true;
    }
  );

  const after = new Database(path.join(dir, 'crm.sqlite'));
  assert.equal(after.pragma('user_version', { simple: true }), 12);
  assert.ok(!after.prepare('PRAGMA table_info(advisory_rules)').all().some((c) => c.name === 'finding_scope'), 'aucune colonne ne doit avoir été ajoutée après un rollback');
  assert.ok(!after.prepare('PRAGMA table_info(advisory_findings)').all().some((c) => c.name === 'finding_scope'));
  assert.ok(!after.prepare('PRAGMA table_info(advisory_findings)').all().some((c) => c.name === 'conflicts_detected_at_execution'));
  assert.ok(!after.prepare("SELECT * FROM sqlite_master WHERE type = 'index' AND name = 'idx_advisory_rule_sets_one_published_per_domain'").get(), 'index non créé après un rollback');
  assert.deepEqual(allTableCounts(after), countsBefore);
  after.close();
});

// --- Échec contrôlé ---
// Cas réellement possible sous ce schéma : un finding historique dont la
// règle source (rule_id) ne résout plus à aucune ligne d'advisory_rules —
// situation qu'une contrainte FK (foreign_keys=ON, server/db.js ligne 12)
// empêche normalement, mais qui reste vérifiée explicitement plutôt que
// supposée impossible (défense en profondeur, jamais une hypothèse silencieuse).
test('migration v13 — échec contrôlé : finding historique avec rule_id orphelin (contrainte FK désactivée pour construire le cas) — transaction annulée, user_version inchangé', async () => {
  const dir = tempDir();
  const legacy = await buildLegacyV12SchemaDriftDatabase(dir);
  const { sessionId } = insertMinimalSessionFixture(legacy);
  const ruleSetId = insertLegacyRuleSetFixture(legacy, { domain: 'health', status: 'published' });
  const ruleId = insertLegacyRuleFixture(legacy, ruleSetId, { domain: 'health' });
  const executionId = insertLegacyExecutionFixture(legacy, sessionId, ruleSetId);
  const findingId = insertLegacyFindingFixture(legacy, { executionId, sessionId, ruleId, memberId: null });
  // Construit délibérément un rule_id orphelin (foreign_keys désactivé
  // uniquement pour fabriquer ce cas de fixture par ailleurs empêché) :
  // reproduit le seul scénario où le backfill ne peut PAS dériver une
  // portée depuis la règle source.
  legacy.pragma('foreign_keys = OFF');
  legacy.prepare('DELETE FROM advisory_rules WHERE id = ?').run(ruleId);
  legacy.pragma('foreign_keys = ON');
  legacy.close();

  await assert.rejects(() => importFreshDb(dir), /Migration 13 bloquée/);

  // La base reste dans son état pré-migration : version inchangée, aucune
  // colonne/index ajouté nulle part dans le bloc (transaction intégralement
  // annulée, jamais un état partiel) — vérifié sur les 4 éléments de la
  // migration, pas seulement sur la colonne dont l'ajout précède le throw.
  const after = new Database(path.join(dir, 'crm.sqlite'));
  assert.equal(after.pragma('user_version', { simple: true }), 12);
  assert.ok(!after.prepare('PRAGMA table_info(advisory_rules)').all().some((c) => c.name === 'finding_scope'), 'aucune colonne ne doit avoir été ajoutée après un rollback (advisory_rules, ajoutée avant le throw)');
  assert.ok(!after.prepare('PRAGMA table_info(advisory_findings)').all().some((c) => c.name === 'finding_scope'), 'aucune colonne ne doit avoir été ajoutée après un rollback (advisory_findings)');
  assert.ok(!after.prepare('PRAGMA table_info(advisory_findings)').all().some((c) => c.name === 'conflicts_detected_at_execution'), 'jamais ajoutée non plus, bien qu\'après le throw dans l\'ordre du code — la transaction annule tout le bloc');
  assert.ok(!after.prepare("SELECT * FROM sqlite_master WHERE type = 'index' AND name = 'idx_advisory_rule_sets_one_published_per_domain'").get(), 'index non créé après un rollback');
  assert.equal(after.prepare('SELECT id FROM advisory_findings WHERE id = ?').get(findingId).id, findingId, 'la ligne existante reste inchangée, jamais supprimée');
  after.close();
});
