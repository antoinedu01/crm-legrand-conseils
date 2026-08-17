// Tests de la migration v16 (table `appointments`, Acquisition OS).
//
// Porté depuis feature/acquisition-os (lot A2a, commit 69a6bde,
// test/appointments-migration.test.js) vers cette base d'intégration —
// PAR PORTAGE MANUEL, pas par cherry-pick (le commit d'origine touchait
// aussi docs/MIGRATIONS.md et test/migrations.test.js, qui ont évolué
// indépendamment sur cette base, module Diagnostic 360 v9-v15). Seul le
// numéro de version a changé (9 -> 16, y compris dans les noms de test) ;
// aucune assertion métier sur `appointments` n'a été modifiée.
//
// Même convention que test/migrations.test.js : base SQLite temporaire
// dédiée par scénario (CRM_DATA_DIR), jamais data/**, aucune donnée client
// réelle. server/db.js exécute ses migrations une seule fois au chargement
// du module ; pour tester plusieurs scénarios dans le même processus,
// chaque import utilise une URL de module distincte (paramètre de requête
// unique) afin d'obtenir une nouvelle instance et forcer une nouvelle
// exécution de la migration contre le répertoire temporaire visé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const dbModulePath = fileURLToPath(new URL('../server/db.js', import.meta.url));

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'crm-appointments-migration-'));
}

async function importFreshDb(dataDir) {
  process.env.CRM_DATA_DIR = dataDir;
  const url = `${pathToFileURL(dbModulePath).href}?instance=${Date.now()}-${Math.random()}`;
  const mod = await import(url);
  return mod.default;
}

// Reconstruction fidèle du schéma pré-migration-9 (base + migrations v1 à
// v8), utilisée UNIQUEMENT pour fabriquer, dans un fichier temporaire neuf,
// une base représentant un état antérieur réel — jamais à partir d'une base
// existante ni de data/**. Reprend le corps de buildLegacyV6Database de
// test/migrations.test.js (tables v1-v6, non dupliquées ici par choix
// éditorial mais reconstruites à l'identique) et y ajoute le delta v8
// (colonnes review_* sur contracts + 8 tables satellites), exactement comme
// server/db.js. NÉCESSAIRE : une base artificiellement mise à
// `user_version = 8` sans que les tables intermédiaires (scoring_rules,
// action_log, consents, channels, campaigns, lead_details, contract_*)
// existent réellement fait échouer le module au chargement — le seed de
// scoring_rules (server/db.js, juste après le bloc `version < 5`) n'est PAS
// protégé par un `if (version < N)` et suppose donc que scoring_rules
// existe déjà, quelle que soit la version de départ. Sur CETTE base
// d'intégration, une base ainsi figée à v8 traverse ensuite, au réimport
// par le vrai server/db.js, la totalité de la chaîne v9 (Diagnostic 360) à
// v16 (appointments) en une seule passe (toutes les migrations comparent à
// la même valeur `version` lue une fois au chargement du module) — ce
// fichier n'a donc besoin d'aucune adaptation supplémentaire pour rester
// valide sur cette base.
function buildLegacyV8Database(dataDir) {
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

    -- Delta v8 : colonnes communes de revue de portefeuille sur contracts,
    -- puis les 8 tables satellites par branche d'assurance.
    ALTER TABLE contracts ADD COLUMN review_frequency TEXT DEFAULT 'annuelle';
    ALTER TABLE contracts ADD COLUMN review_last_date TEXT;
    ALTER TABLE contracts ADD COLUMN review_next_date TEXT;
    CREATE INDEX idx_contracts_review_next ON contracts(review_next_date);
    CREATE INDEX idx_contracts_branch_status ON contracts(branch, status);

    CREATE TABLE contract_lamal (
      contract_id INTEGER PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE,
      care_model TEXT NOT NULL,
      deductible INTEGER NOT NULL CHECK (deductible >= 0),
      accident_coverage INTEGER NOT NULL DEFAULT 1 CHECK (accident_coverage IN (0, 1)),
      canton TEXT, tariff_region TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_contract_lamal_deductible ON contract_lamal(deductible);

    CREATE TABLE contract_lca (
      contract_id INTEGER PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE,
      underwriting_status TEXT NOT NULL DEFAULT 'non_requis',
      waiting_period_days INTEGER CHECK (waiting_period_days IS NULL OR waiting_period_days >= 0),
      administrative_reservation_status TEXT NOT NULL DEFAULT 'aucune',
      reservation_notes TEXT,
      exclusions_status TEXT NOT NULL DEFAULT 'aucune',
      exclusions_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_contract_lca_underwriting_status ON contract_lca(underwriting_status);

    CREATE TABLE contract_life (
      contract_id INTEGER PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE,
      component_type TEXT NOT NULL,
      insured_death_capital REAL CHECK (insured_death_capital IS NULL OR insured_death_capital >= 0),
      insured_disability_capital REAL CHECK (insured_disability_capital IS NULL OR insured_disability_capital >= 0),
      insured_rent REAL CHECK (insured_rent IS NULL OR insured_rent >= 0),
      surrender_value REAL CHECK (surrender_value IS NULL OR surrender_value >= 0),
      premium_waiver INTEGER NOT NULL DEFAULT 0 CHECK (premium_waiver IN (0, 1)),
      indexation_type TEXT NOT NULL DEFAULT 'aucune',
      policy_term_years INTEGER CHECK (policy_term_years IS NULL OR policy_term_years > 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE contract_income_protection (
      contract_id INTEGER PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE,
      benefit_type TEXT NOT NULL,
      insured_amount REAL CHECK (insured_amount IS NULL OR insured_amount >= 0),
      waiting_period_days INTEGER CHECK (waiting_period_days IS NULL OR waiting_period_days >= 0),
      benefit_duration_months INTEGER CHECK (benefit_duration_months IS NULL OR benefit_duration_months > 0),
      disability_trigger_rate INTEGER CHECK (
        disability_trigger_rate IS NULL OR (disability_trigger_rate >= 0 AND disability_trigger_rate <= 100)
      ),
      coordination_ai_lpp INTEGER NOT NULL DEFAULT 0 CHECK (coordination_ai_lpp IN (0, 1)),
      premium_waiver INTEGER NOT NULL DEFAULT 0 CHECK (premium_waiver IN (0, 1)),
      exclusions_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE contract_lpp_ijm (
      contract_id INTEGER PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE,
      product_type TEXT NOT NULL,
      institution_name TEXT,
      retirement_capital REAL CHECK (retirement_capital IS NULL OR retirement_capital >= 0),
      disability_pension REAL CHECK (disability_pension IS NULL OR disability_pension >= 0),
      daily_allowance REAL CHECK (daily_allowance IS NULL OR daily_allowance >= 0),
      waiting_period_days INTEGER CHECK (waiting_period_days IS NULL OR waiting_period_days >= 0),
      benefit_duration_days INTEGER CHECK (benefit_duration_days IS NULL OR benefit_duration_days > 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE contract_coverages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      coverage_type TEXT NOT NULL,
      coverage_level TEXT,
      insured_amount REAL CHECK (insured_amount IS NULL OR insured_amount >= 0),
      annual_limit REAL CHECK (annual_limit IS NULL OR annual_limit >= 0),
      reimbursement_rate INTEGER CHECK (
        reimbursement_rate IS NULL OR (reimbursement_rate >= 0 AND reimbursement_rate <= 100)
      ),
      waiting_period_days INTEGER CHECK (waiting_period_days IS NULL OR waiting_period_days >= 0),
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (contract_id, coverage_type)
    );
    CREATE INDEX idx_contract_coverages_contract ON contract_coverages(contract_id);
    CREATE INDEX idx_contract_coverages_type ON contract_coverages(coverage_type);

    CREATE TABLE contract_beneficiaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      beneficiary_client_id INTEGER REFERENCES clients(id),
      beneficiary_type TEXT NOT NULL,
      designation TEXT,
      percentage REAL CHECK (percentage IS NULL OR (percentage >= 0 AND percentage <= 100)),
      priority_order INTEGER CHECK (priority_order IS NULL OR priority_order >= 0),
      revocable INTEGER NOT NULL DEFAULT 1 CHECK (revocable IN (0, 1)),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_contract_beneficiaries_contract ON contract_beneficiaries(contract_id);
    CREATE INDEX idx_contract_beneficiaries_client ON contract_beneficiaries(beneficiary_client_id);

    CREATE TABLE contract_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      effective_date TEXT, field_name TEXT, old_value TEXT, new_value TEXT,
      description TEXT, created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_contract_history_contract_created ON contract_history(contract_id, created_at);
  `);
  db.pragma('user_version = 8');
  return db;
}

// -- 1, 2 — migration depuis une base pré-v9 -----------------------------
test('migration v16 — une base neuve atteint directement user_version = 16', async () => {
  const db = await importFreshDb(tempDir());
  assert.equal(db.pragma('user_version', { simple: true }), 17, 'une base neuve traverse v16 puis, dans la même passe, v17 (A4.1)');
});

test('migration v16 — une base héritée en v8 est migrée vers v16 sans perte de données (scénarios 1, 2, 13)', async () => {
  const dir = tempDir();
  const legacy = buildLegacyV8Database(dir);
  const company = legacy.prepare('INSERT INTO companies (name) VALUES (?)').run('Compagnie de test');
  const client = legacy
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', ?, ?, 'client')")
    .run('Test', 'Existant');
  const contract = legacy
    .prepare('INSERT INTO contracts (client_id, company_id, branch, annual_premium, status) VALUES (?, ?, ?, ?, ?)')
    .run(client.lastInsertRowid, company.lastInsertRowid, 'lamal', 1200, 'actif');
  legacy.close();

  const db = await importFreshDb(dir);
  assert.equal(db.pragma('user_version', { simple: true }), 17, 'une base héritée traverse v16 puis, dans la même passe, v17 (A4.1)');

  // Aucune donnée existante supprimée ou modifiée par la migration.
  const preservedClient = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.lastInsertRowid);
  assert.equal(preservedClient.first_name, 'Test');
  assert.equal(preservedClient.status, 'client');
  const preservedContract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract.lastInsertRowid);
  assert.equal(preservedContract.branch, 'lamal');
  assert.equal(preservedContract.annual_premium, 1200);
});

// -- 3, 4 — table et colonnes -------------------------------------------
test('migration v16 — la table appointments existe avec les colonnes attendues (scénarios 3, 4)', async () => {
  const db = await importFreshDb(tempDir());
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'appointments'")
    .get();
  assert.ok(exists, 'la table appointments doit exister');

  const cols = db.prepare('PRAGMA table_info(appointments)').all().map((c) => c.name);
  const expected = [
    'id', 'client_id', 'starts_at', 'ends_at', 'status', 'appointment_type',
    'location_type', 'location', 'meeting_url', 'notes', 'created_at', 'updated_at',
  ];
  assert.deepEqual(cols.sort(), expected.sort());
});

// -- 5, 6, 7 — FK vers clients, création, plusieurs RDV par client -------
test('migration v16 — création d’un rendez-vous valide, plusieurs rendez-vous pour un même client (scénarios 5, 6, 7)', async () => {
  const db = await importFreshDb(tempDir());
  const client = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Jean', 'Dupont', 'prospect')")
    .run();

  const a1 = db
    .prepare('INSERT INTO appointments (client_id, starts_at, ends_at) VALUES (?, ?, ?)')
    .run(client.lastInsertRowid, '2026-09-01 09:00:00', '2026-09-01 09:30:00');
  const a2 = db
    .prepare('INSERT INTO appointments (client_id, starts_at, ends_at) VALUES (?, ?, ?)')
    .run(client.lastInsertRowid, '2026-09-15 14:00:00', '2026-09-15 15:00:00');

  assert.notEqual(a1.lastInsertRowid, a2.lastInsertRowid);
  const rows = db.prepare('SELECT * FROM appointments WHERE client_id = ? ORDER BY starts_at').all(client.lastInsertRowid);
  assert.equal(rows.length, 2, 'les deux rendez-vous doivent être rattachés au même client');
  assert.equal(rows[0].starts_at, '2026-09-01 09:00:00');
  assert.equal(rows[1].starts_at, '2026-09-15 14:00:00');
});

// -- 8 — comportement FK sur client_id invalide --------------------------
test('migration v16 — un client_id inexistant est rejeté par la contrainte FK (scénario 8)', async () => {
  const db = await importFreshDb(tempDir());
  assert.throws(
    () => db.prepare('INSERT INTO appointments (client_id, starts_at, ends_at) VALUES (?, ?, ?)')
      .run(999999, '2026-09-01 09:00:00', '2026-09-01 09:30:00'),
    /FOREIGN KEY constraint failed/
  );
});

// -- 9 — valeur par défaut du status --------------------------------------
test('migration v16 — status vaut « booked » par défaut si non renseigné (scénario 9)', async () => {
  const db = await importFreshDb(tempDir());
  const client = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'A', 'B', 'prospect')")
    .run();
  db.prepare('INSERT INTO appointments (client_id, starts_at, ends_at) VALUES (?, ?, ?)')
    .run(client.lastInsertRowid, '2026-09-01 09:00:00', '2026-09-01 09:30:00');
  const row = db.prepare('SELECT * FROM appointments WHERE client_id = ?').get(client.lastInsertRowid);
  assert.equal(row.status, 'booked');
  assert.equal(row.appointment_type, 'other');
  assert.equal(row.location_type, 'in_person');
});

// -- 10 — indexes attendus -------------------------------------------------
test('migration v16 — les index attendus existent (scénario 10)', async () => {
  const db = await importFreshDb(tempDir());
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'appointments'")
    .all()
    .map((r) => r.name);
  for (const name of ['idx_appointments_client', 'idx_appointments_starts_at', 'idx_appointments_status']) {
    assert.ok(indexes.includes(name), `index ${name} manquant`);
  }
});

// -- 11 — idempotence -------------------------------------------------------
test("migration v16 — idempotence : un second import de la même base n'échoue pas et reste en v16 (scénario 11)", async () => {
  const dir = tempDir();
  await importFreshDb(dir);
  const db = await importFreshDb(dir);
  assert.equal(db.pragma('user_version', { simple: true }), 17, 'un second import reste en v17 (16 puis 17 dans la même passe), jamais dupliqué');
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'appointments'")
    .get();
  assert.ok(exists);
});

// -- 12 — tables existantes toujours présentes ------------------------------
test('migration v16 — les tables existantes (v1 à v8) restent toutes présentes (scénario 12)', async () => {
  const db = await importFreshDb(tempDir());
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => r.name);
  const expected = [
    'users', 'companies', 'clients', 'contracts', 'commissions', 'tasks',
    'channels', 'campaigns', 'channel_costs', 'lead_details', 'scoring_rules',
    'action_log', 'consents', 'contract_lamal', 'contract_lca', 'contract_life',
    'contract_income_protection', 'contract_lpp_ijm', 'contract_coverages',
    'contract_beneficiaries', 'contract_history', 'appointments',
  ];
  for (const name of expected) {
    assert.ok(tables.includes(name), `table ${name} manquante après migration v16`);
  }
});

// -- Contrainte CHECK réellement ajoutée (ends_at > starts_at) --------------
test('migration v16 — la contrainte CHECK ends_at > starts_at fonctionne', async () => {
  const db = await importFreshDb(tempDir());
  const client = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'C', 'D', 'prospect')")
    .run();

  assert.throws(
    () => db.prepare('INSERT INTO appointments (client_id, starts_at, ends_at) VALUES (?, ?, ?)')
      .run(client.lastInsertRowid, '2026-09-01 10:00:00', '2026-09-01 09:00:00'),
    /CHECK constraint failed/,
    'ends_at antérieur à starts_at doit être rejeté'
  );
  assert.throws(
    () => db.prepare('INSERT INTO appointments (client_id, starts_at, ends_at) VALUES (?, ?, ?)')
      .run(client.lastInsertRowid, '2026-09-01 10:00:00', '2026-09-01 10:00:00'),
    /CHECK constraint failed/,
    'ends_at égal à starts_at doit être rejeté (pas de rendez-vous de durée nulle)'
  );

  db.prepare('INSERT INTO appointments (client_id, starts_at, ends_at) VALUES (?, ?, ?)')
    .run(client.lastInsertRowid, '2026-09-01 10:00:00', '2026-09-01 10:30:00');
  const row = db.prepare('SELECT * FROM appointments WHERE client_id = ?').get(client.lastInsertRowid);
  assert.ok(row, 'un intervalle valide doit être accepté');
});

// -- Pas de CHECK sur status/appointment_type/location_type (convention du
// projet : les enums texte sont validés côté API, jamais en base — voir
// clients.status, contracts.status, campaigns.status, etc., aucun n'a de
// CHECK). Ce test documente que ce choix est effectif, pas accidentel.
test('migration v16 — aucun CHECK SQL sur status/appointment_type/location_type (validation déléguée à l’API, comme le reste du schéma)', async () => {
  const db = await importFreshDb(tempDir());
  const client = db
    .prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'E', 'F', 'prospect')")
    .run();
  db.prepare(
    'INSERT INTO appointments (client_id, starts_at, ends_at, status, appointment_type, location_type) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(client.lastInsertRowid, '2026-09-01 09:00:00', '2026-09-01 09:30:00', 'valeur_arbitraire', 'autre_valeur', 'encore_une_autre');
  const row = db.prepare('SELECT * FROM appointments WHERE client_id = ?').get(client.lastInsertRowid);
  assert.equal(row.status, 'valeur_arbitraire');
});
