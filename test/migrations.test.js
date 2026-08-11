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

test('chaîne de migrations — une base neuve atteint user_version = 9', async () => {
  const db = await importFreshDb(tempDir());
  assert.equal(db.pragma('user_version', { simple: true }), 9);
});

test('chaîne de migrations — une base héritée en v6 atteint v9 sans perte de données', async () => {
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
  assert.equal(db.pragma('user_version', { simple: true }), 9);

  const preserved = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract.lastInsertRowid);
  assert.equal(preserved.branch, 'lamal');
  assert.equal(preserved.annual_premium, 1200);
  assert.equal(preserved.status, 'actif');
  assert.equal(preserved.review_frequency, 'annuelle');
  assert.equal(preserved.review_last_date, null);
  assert.equal(preserved.review_next_date, null);
});

test("chaîne de migrations — idempotence après migration jusqu'en v9", async () => {
  const dir = tempDir();
  await importFreshDb(dir);
  const db = await importFreshDb(dir);
  assert.equal(db.pragma('user_version', { simple: true }), 9);
});

test('chaîne de migrations — idempotence réelle avec schéma déjà partiellement présent', async () => {
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
  assert.equal(db.pragma('user_version', { simple: true }), 9);
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
