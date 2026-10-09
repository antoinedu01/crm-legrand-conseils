// Migration v18 — conventions de courtage. Chaque scénario utilise une base
// SQLite temporaire dédiée (CRM_DATA_DIR), jamais data/**. Aucune donnée
// client ni aucun barème réel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const dbModulePath = fileURLToPath(new URL('../server/db.js', import.meta.url));

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'crm-migration-v18-'));
}

async function importFreshDb(dataDir) {
  process.env.CRM_DATA_DIR = dataDir;
  const url = `${pathToFileURL(dbModulePath).href}?instance=${Date.now()}-${Math.random()}`;
  const mod = await import(url);
  return mod.default;
}

const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
const tableExists = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

test('migration v18 — base neuve : tables, colonnes de traçabilité et index présents', async () => {
  const db = await importFreshDb(tempDir());
  assert.equal(db.pragma('user_version', { simple: true }), 18);
  assert.ok(tableExists(db, 'conventions'));
  assert.ok(tableExists(db, 'convention_rates'));
  for (const col of ['company_id', 'title', 'status', 'intermediary_code', 'client_followup', 'obligations', 'restrictions', 'missing_documents']) {
    assert.ok(columns(db, 'conventions').includes(col), `conventions.${col}`);
  }
  for (const col of ['convention_id', 'branch', 'basis', 'value', 'multiply_by_years', 'max_years', 'valuation_pct', 'cap_chf', 'is_estimate', 'clawback_mode', 'clawback_steps', 'clawback_months', 'active']) {
    assert.ok(columns(db, 'convention_rates').includes(col), `convention_rates.${col}`);
  }
  assert.ok(columns(db, 'contracts').includes('convention_rate_id'));
  assert.ok(columns(db, 'commissions').includes('convention_rate_id'));
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
  for (const name of ['idx_conventions_company', 'idx_convention_rates_convention', 'idx_convention_rates_branch', 'idx_contracts_convention_rate', 'idx_commissions_convention_rate']) {
    assert.ok(indexes.includes(name), `index ${name}`);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM conventions').get().n, 0, 'aucune convention semée : les barèmes réels ne vivent jamais dans le code');
});

test('migration v18 — base en v17 avec données : migration additive, aucune perte, intégrité intacte', async () => {
  const dir = tempDir();
  const first = await importFreshDb(dir);
  const companyId = first.prepare("INSERT INTO companies (name) VALUES ('Compagnie v17')").run().lastInsertRowid;
  const clientId = first.prepare("INSERT INTO clients (first_name, last_name, status) VALUES ('Test', 'V17', 'client')").run().lastInsertRowid;
  const contractId = first
    .prepare("INSERT INTO contracts (client_id, company_id, branch, annual_premium, status) VALUES (?, ?, 'lamal', 3000, 'actif')")
    .run(clientId, companyId).lastInsertRowid;
  first
    .prepare("INSERT INTO commissions (contract_id, type, expected_amount_chf, status, commission_mode) VALUES (?, 'acquisition', 55, 'expected', 'fixed_amount')")
    .run(contractId);
  first.close();

  // Ramène la base à un vrai schéma v17 : ni tables de conventions, ni
  // colonnes convention_rate_id (et leurs index) dans contracts/commissions.
  const legacy = new Database(path.join(dir, 'crm.sqlite'));
  legacy.exec(`
    DROP INDEX idx_contracts_convention_rate;
    DROP INDEX idx_commissions_convention_rate;
    ALTER TABLE contracts DROP COLUMN convention_rate_id;
    ALTER TABLE commissions DROP COLUMN convention_rate_id;
    DROP TABLE convention_rates;
    DROP TABLE conventions;
  `);
  legacy.pragma('user_version = 17');
  assert.ok(!columns(legacy, 'contracts').includes('convention_rate_id'), 'précondition : schéma v17');
  legacy.close();

  const db = await importFreshDb(dir);
  assert.equal(db.pragma('user_version', { simple: true }), 18);
  assert.ok(tableExists(db, 'conventions') && tableExists(db, 'convention_rates'));
  assert.ok(columns(db, 'contracts').includes('convention_rate_id'), 'colonne ajoutée par la migration');
  assert.ok(columns(db, 'commissions').includes('convention_rate_id'), 'colonne ajoutée par la migration');
  // Clé étrangère réellement appliquée sur les colonnes ajoutées.
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.throws(
    () => db.prepare("INSERT INTO contracts (client_id, company_id, branch, convention_rate_id) VALUES (?, ?, 'lamal', 999999)").run(clientId, companyId),
    /FOREIGN KEY/
  );
  assert.throws(
    () => db.prepare("INSERT INTO commissions (contract_id, type, expected_amount_chf, status, commission_mode, convention_rate_id) VALUES (?, 'acquisition', 1, 'expected', 'fixed_amount', 999999)").run(contractId),
    /FOREIGN KEY/
  );
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
  assert.equal(contract.annual_premium, 3000);
  assert.equal(contract.convention_rate_id, null, 'aucune ligne inventée pour un contrat existant');
  const commission = db.prepare('SELECT * FROM commissions WHERE contract_id = ?').get(contractId);
  assert.equal(commission.expected_amount_chf, 55, 'aucun montant recalculé');
  assert.equal(commission.convention_rate_id, null);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('migration v18 — idempotence : plusieurs démarrages successifs sans erreur ni doublon', async () => {
  const dir = tempDir();
  await importFreshDb(dir);
  await importFreshDb(dir);
  const db = await importFreshDb(dir);
  assert.equal(db.pragma('user_version', { simple: true }), 18);
  const idx = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'idx_contracts_convention_rate'").get().n;
  assert.equal(idx, 1);
});

test('migration v18 — contraintes : suppression en cascade des lignes, ligne utilisée protégée par la clé étrangère', async () => {
  const db = await importFreshDb(tempDir());
  const companyId = db.prepare("INSERT INTO companies (name) VALUES ('Compagnie FK')").run().lastInsertRowid;
  const convId = db.prepare("INSERT INTO conventions (company_id, title) VALUES (?, 'Convention FK')").run(companyId).lastInsertRowid;
  const usedRate = db.prepare("INSERT INTO convention_rates (convention_id, branch, label, basis, value) VALUES (?, 'lamal', 'Ligne', 'fixe', 50)").run(convId).lastInsertRowid;
  const clientId = db.prepare("INSERT INTO clients (first_name, last_name) VALUES ('Test', 'FK')").run().lastInsertRowid;
  db.prepare("INSERT INTO contracts (client_id, company_id, branch, convention_rate_id) VALUES (?, ?, 'lamal', ?)").run(clientId, companyId, usedRate);
  assert.throws(() => db.prepare('DELETE FROM conventions WHERE id = ?').run(convId), /FOREIGN KEY/);
  assert.ok(db.prepare('SELECT id FROM convention_rates WHERE id = ?').get(usedRate));

  const freeConv = db.prepare("INSERT INTO conventions (company_id, title) VALUES (?, 'Convention libre')").run(companyId).lastInsertRowid;
  db.prepare("INSERT INTO convention_rates (convention_id, branch, label, basis) VALUES (?, 'lca', 'Ligne libre', 'a_confirmer')").run(freeConv);
  db.prepare('DELETE FROM conventions WHERE id = ?').run(freeConv);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM convention_rates WHERE convention_id = ?').get(freeConv).n, 0, 'lignes supprimées en cascade');

  assert.throws(
    () => db.prepare("INSERT INTO convention_rates (convention_id, branch, label, basis, active) VALUES (?, 'lca', 'X', 'fixe', 2)").run(convId),
    /CHECK/
  );
});
