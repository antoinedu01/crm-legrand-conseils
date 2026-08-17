// Tests de la migration v17 (A4.1 — socle DB attribution : campaigns.key
// + table lead_attribution). Même convention que test/migrations.test.js
// et test/appointments-migration.test.js : base SQLite temporaire dédiée
// (CRM_DATA_DIR), jamais data/**, aucune donnée client réelle. server/db.js
// exécute ses migrations une seule fois au chargement du module ; pour
// tester plusieurs scénarios dans le même processus, chaque import utilise
// une URL de module distincte (paramètre de requête unique) afin d'obtenir
// une nouvelle instance et forcer une nouvelle exécution des migrations
// contre le répertoire temporaire visé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const dbModulePath = fileURLToPath(new URL('../server/db.js', import.meta.url));

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'crm-lead-attribution-migration-'));
}

async function importFreshDb(dataDir) {
  process.env.CRM_DATA_DIR = dataDir;
  const url = `${pathToFileURL(dbModulePath).href}?instance=${Date.now()}-${Math.random()}`;
  const mod = await import(url);
  return mod.default;
}

// Reconstruction fidèle, mais volontairement MINIMALE, d'un état "v16" réel
// — pas la chaîne complète v1-v16 (déjà couverte par migrations.test.js et
// appointments-migration.test.js), seulement les tables réellement requises
// pour que la migration v17 s'applique correctement : `clients`/`channels`/
// `campaigns` (touchées par v17 ou référencées par lead_attribution), plus
// `companies` et `scoring_rules` (requises par les 2 seeds inconditionnels
// — compagnies et règles de scoring — qui tournent après la chaîne de
// migrations, indépendamment de la version, seule autre table dans ce cas
// avec `channels`, vérifié par recherche exhaustive dans server/db.js).
// `campaigns` est construite SANS la colonne `key` (schéma v16 exact, avant v17).
function buildMinimalV16Database(dataDir) {
  const file = path.join(dataDir, 'crm.sqlite');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE scoring_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      channel_id INTEGER REFERENCES channels(id),
      status TEXT NOT NULL DEFAULT 'brouillon',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.pragma('user_version = 16');
  db.close();
}

test('v16 → v17 : la migration s\'applique sans erreur, campaigns/clients/channels préexistants survivent', async () => {
  const dataDir = tempDir();
  try {
    buildMinimalV16Database(dataDir);

    // Insère des données réelles AVANT la migration, avec une connexion
    // séparée, pour prouver leur survie après coup — pas seulement
    // l'absence d'erreur de la migration elle-même.
    const preDb = new Database(path.join(dataDir, 'crm.sqlite'));
    preDb.pragma('foreign_keys = ON');
    const channelId = preDb.prepare(
      "INSERT INTO channels (key, name) VALUES ('site_internet', 'Formulaires du site internet')"
    ).run().lastInsertRowid;
    const campaignId = preDb.prepare(
      "INSERT INTO campaigns (name, channel_id, status) VALUES ('Campagne préexistante v16', ?, 'active')"
    ).run(channelId).lastInsertRowid;
    const clientId = preDb.prepare(
      "INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Préexistant', 'V16', 'prospect')"
    ).run().lastInsertRowid;
    preDb.close();

    const db = await importFreshDb(dataDir);
    assert.equal(db.pragma('user_version', { simple: true }), 17);

    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    assert.equal(campaign.name, 'Campagne préexistante v16');
    assert.equal(campaign.channel_id, channelId);
    assert.equal(campaign.status, 'active');
    assert.equal(campaign.key, null, 'aucun backfill de clé dans ce lot — campagne préexistante reste key=NULL');

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
    assert.equal(client.first_name, 'Préexistant');

    const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
    assert.equal(channel.key, 'site_internet');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('DB vierge → migrations 1 à 17 : chaîne complète propre', async () => {
  const dataDir = tempDir();
  try {
    const db = await importFreshDb(dataDir);
    assert.equal(db.pragma('user_version', { simple: true }), 17);

    const campaignCols = db.prepare('PRAGMA table_info(campaigns)').all().map((c) => c.name);
    assert.ok(campaignCols.includes('key'));

    const leadAttributionCols = db.prepare('PRAGMA table_info(lead_attribution)').all().map((c) => c.name);
    for (const col of [
      'id', 'client_id', 'campaign_id', 'channel_id',
      'raw_campaign_key', 'raw_channel_key',
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'gclid', 'fbclid', 'created_at', 'updated_at',
    ]) {
      assert.ok(leadAttributionCols.includes(col), `colonne manquante : ${col}`);
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Advisory (Diagnostic 360) et appointments : schéma préservé après v17, DB vierge', async () => {
  const dataDir = tempDir();
  try {
    const db = await importFreshDb(dataDir);
    // Les tables Advisory existent, sont saines, et ne contiennent aucune
    // ligne (rien dans ce lot n'écrit de donnée santé) — preuve que la
    // migration v17 n'a ni supprimé ni corrompu le schéma Diagnostic 360.
    for (const table of ['households', 'household_members', 'advisory_sessions', 'advisory_answers', 'advisory_findings', 'advisory_recommendations']) {
      const info = db.prepare(`PRAGMA table_info(${table})`).all();
      assert.ok(info.length > 0, `table Advisory manquante ou vide de colonnes : ${table}`);
      const count = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
      assert.equal(count, 0);
    }
    const appointmentCols = db.prepare('PRAGMA table_info(appointments)').all().map((c) => c.name);
    assert.deepEqual(
      appointmentCols.sort(),
      ['id', 'client_id', 'starts_at', 'ends_at', 'status', 'appointment_type', 'location_type', 'location', 'meeting_url', 'notes', 'created_at', 'updated_at'].sort()
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('campaigns.key : unicité appliquée uniquement entre valeurs non-NULL', async () => {
  const dataDir = tempDir();
  try {
    const db = await importFreshDb(dataDir);
    const channel = db.prepare("SELECT id FROM channels WHERE key = 'site_internet'").get();

    // Deux campagnes sans clé (NULL) : jamais en collision entre elles.
    db.prepare("INSERT INTO campaigns (name, channel_id, status) VALUES ('Sans clé A', ?, 'active')").run(channel.id);
    db.prepare("INSERT INTO campaigns (name, channel_id, status) VALUES ('Sans clé B', ?, 'active')").run(channel.id);

    // Une clé non-NULL renseignée une première fois : succès.
    db.prepare("INSERT INTO campaigns (name, channel_id, status, key) VALUES ('Avec clé', ?, 'active', 'cmp_test_unique_1')").run(channel.id);

    // La même clé non-NULL une deuxième fois : refus (index UNIQUE).
    assert.throws(() => {
      db.prepare("INSERT INTO campaigns (name, channel_id, status, key) VALUES ('Avec clé dupliquée', ?, 'active', 'cmp_test_unique_1')").run(channel.id);
    }, /UNIQUE constraint failed/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('lead_attribution : relation 1:1 stricte avec clients (UNIQUE client_id)', async () => {
  const dataDir = tempDir();
  try {
    const db = await importFreshDb(dataDir);
    const clientA = db.prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'A', 'Client', 'prospect')").run().lastInsertRowid;
    const clientB = db.prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'B', 'Client', 'prospect')").run().lastInsertRowid;

    db.prepare('INSERT INTO lead_attribution (client_id) VALUES (?)').run(clientA);

    assert.throws(() => {
      db.prepare('INSERT INTO lead_attribution (client_id) VALUES (?)').run(clientA);
    }, /UNIQUE constraint failed/);

    // Un client distinct reste libre d'avoir sa propre attribution.
    db.prepare('INSERT INTO lead_attribution (client_id) VALUES (?)').run(clientB);
    const count = db.prepare('SELECT COUNT(*) AS n FROM lead_attribution').get().n;
    assert.equal(count, 2);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('lead_attribution : FK refuse un client_id inexistant', async () => {
  const dataDir = tempDir();
  try {
    const db = await importFreshDb(dataDir);
    assert.throws(() => {
      db.prepare('INSERT INTO lead_attribution (client_id) VALUES (999999)').run();
    }, /FOREIGN KEY constraint failed/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('lead_attribution : FK refuse un campaign_id inexistant', async () => {
  const dataDir = tempDir();
  try {
    const db = await importFreshDb(dataDir);
    const clientId = db.prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'X', 'Client', 'prospect')").run().lastInsertRowid;
    assert.throws(() => {
      db.prepare('INSERT INTO lead_attribution (client_id, campaign_id) VALUES (?, 999999)').run(clientId);
    }, /FOREIGN KEY constraint failed/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('lead_attribution : FK refuse un channel_id inexistant', async () => {
  const dataDir = tempDir();
  try {
    const db = await importFreshDb(dataDir);
    const clientId = db.prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Y', 'Client', 'prospect')").run().lastInsertRowid;
    assert.throws(() => {
      db.prepare('INSERT INTO lead_attribution (client_id, channel_id) VALUES (?, 999999)').run(clientId);
    }, /FOREIGN KEY constraint failed/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('lead_attribution : tracking inconnu accepté — raw_* renseignés, campaign_id/channel_id NULL', async () => {
  const dataDir = tempDir();
  try {
    const db = await importFreshDb(dataDir);
    const clientId = db.prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Z', 'Client', 'prospect')").run().lastInsertRowid;
    db.prepare(
      `INSERT INTO lead_attribution (client_id, campaign_id, channel_id, raw_campaign_key, raw_channel_key)
       VALUES (?, NULL, NULL, 'unknown-campaign', 'unknown-channel')`
    ).run(clientId);
    const row = db.prepare('SELECT * FROM lead_attribution WHERE client_id = ?').get(clientId);
    assert.equal(row.campaign_id, null);
    assert.equal(row.channel_id, null);
    assert.equal(row.raw_campaign_key, 'unknown-campaign');
    assert.equal(row.raw_channel_key, 'unknown-channel');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('lead_attribution : les 5 champs UTM acceptent du texte arbitraire, aucune énumération', async () => {
  const dataDir = tempDir();
  try {
    const db = await importFreshDb(dataDir);
    const clientId = db.prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'UTM', 'Client', 'prospect')").run().lastInsertRowid;
    db.prepare(
      `INSERT INTO lead_attribution (client_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term)
       VALUES (?, 'n-importe-quelle-source-123', 'cpc/social!!', 'Campagne Été 2026 — Édition spéciale', 'bannière-A', 'assurance maladie suisse')`
    ).run(clientId);
    const row = db.prepare('SELECT * FROM lead_attribution WHERE client_id = ?').get(clientId);
    assert.equal(row.utm_source, 'n-importe-quelle-source-123');
    assert.equal(row.utm_medium, 'cpc/social!!');
    assert.equal(row.utm_campaign, 'Campagne Été 2026 — Édition spéciale');
    assert.equal(row.utm_content, 'bannière-A');
    assert.equal(row.utm_term, 'assurance maladie suisse');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('lead_attribution : gclid/fbclid acceptent du texte arbitraire, aucune validation métier', async () => {
  const dataDir = tempDir();
  try {
    const db = await importFreshDb(dataDir);
    const clientId = db.prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'Click', 'Ids', 'prospect')").run().lastInsertRowid;
    const gclid = 'Cj0KCQjw' + 'x'.repeat(80);
    const fbclid = 'IwAR' + 'y'.repeat(60);
    db.prepare('INSERT INTO lead_attribution (client_id, gclid, fbclid) VALUES (?, ?, ?)').run(clientId, gclid, fbclid);
    const row = db.prepare('SELECT gclid, fbclid FROM lead_attribution WHERE client_id = ?').get(clientId);
    assert.equal(row.gclid, gclid);
    assert.equal(row.fbclid, fbclid);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('lead_attribution : aucune cascade inattendue (schéma sans ON DELETE CASCADE)', async () => {
  const dataDir = tempDir();
  try {
    const db = await importFreshDb(dataDir);
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'lead_attribution'").get().sql;
    assert.ok(!/CASCADE/i.test(sql), 'lead_attribution ne doit contenir aucune clause ON DELETE CASCADE');

    // Comportement observable : supprimer un client référencé par une
    // lead_attribution doit être refusé par la FK, jamais cascader
    // silencieusement la suppression de la ligne d'attribution.
    const clientId = db.prepare("INSERT INTO clients (type, first_name, last_name, status) VALUES ('particulier', 'NoCascade', 'Test', 'prospect')").run().lastInsertRowid;
    db.prepare('INSERT INTO lead_attribution (client_id) VALUES (?)').run(clientId);
    assert.throws(() => {
      db.prepare('DELETE FROM clients WHERE id = ?').run(clientId);
    }, /FOREIGN KEY constraint failed/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
