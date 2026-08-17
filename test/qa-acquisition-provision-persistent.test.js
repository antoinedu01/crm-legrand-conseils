// M0c21 — Tests du provisionneur QA Acquisition synthétique
// (scripts/qa-acquisition-provision.mjs). Bases isolées dans des
// répertoires temporaires (jamais data/**, jamais un chemin de
// production) : aucun réseau, aucun VPS, aucun service systemd.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.join(process.cwd(), 'scripts', 'qa-acquisition-provision.mjs');

function run(args = [], env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-qa-acq-provision-test-'));
  try {
    const out = execFileSync('node', [SCRIPT, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, QA_ACQUISITION_ALLOW: '1', CRM_DATA_DIR: dataDir, ...env },
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return { status: 0, stdout: out, stderr: '', dataDir };
  } catch (err) {
    return { status: err.status, stdout: err.stdout?.toString() || '', stderr: err.stderr?.toString() || '', dataDir };
  }
}

function runInDir(dataDir, args = [], env = {}) {
  try {
    const out = execFileSync('node', [SCRIPT, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, QA_ACQUISITION_ALLOW: '1', CRM_DATA_DIR: dataDir, ...env },
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return { status: 0, stdout: out, stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: err.stdout?.toString() || '', stderr: err.stderr?.toString() || '' };
  }
}

function cleanup(dataDir) {
  fs.rmSync(dataDir, { recursive: true, force: true });
}

async function openDb(dataDir) {
  const { default: Database } = await import('better-sqlite3');
  return new Database(path.join(dataDir, 'crm.sqlite'), { readonly: true });
}

test('provision sur DB vierge réussit', () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Provisioning QA Acquisition terminé/);
  cleanup(r.dataDir);
});

test('toutes les fixtures attendues sont présentes après un run', async () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  const db = await openDb(r.dataDir);
  try {
    const clients = db.prepare("SELECT COUNT(*) AS n FROM clients WHERE email LIKE 'qa-acq-%@example.test'").get().n;
    const campaigns = db.prepare("SELECT COUNT(*) AS n FROM campaigns WHERE name LIKE 'QA Campagne %'").get().n;
    const contracts = db.prepare("SELECT COUNT(*) AS n FROM contracts WHERE policy_number LIKE 'QA-ACQ-%'").get().n;
    const commissions = db.prepare("SELECT COUNT(*) AS n FROM commissions WHERE label LIKE '[QA-ACQ]%'").get().n;
    const appointments = db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE notes LIKE '[QA-ACQ]%'").get().n;
    const leadDetails = db.prepare(
      "SELECT COUNT(*) AS n FROM lead_details WHERE client_id IN (SELECT id FROM clients WHERE email LIKE 'qa-acq-%@example.test')"
    ).get().n;
    assert.equal(clients, 17);
    assert.equal(campaigns, 4);
    assert.equal(contracts, 8);
    assert.equal(commissions, 15);
    assert.equal(appointments, 5);
    assert.equal(leadDetails, 12);
  } finally {
    db.close();
    cleanup(r.dataDir);
  }
});

test('second run consécutif est idempotent (aucune duplication)', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-qa-acq-provision-test-'));
  try {
    const r1 = runInDir(dataDir);
    assert.equal(r1.status, 0, r1.stderr);
    const r2 = runInDir(dataDir);
    assert.equal(r2.status, 0, r2.stderr);
    const db = await openDb(dataDir);
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM clients WHERE email LIKE 'qa-acq-%@example.test'").get().n, 17);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM campaigns WHERE name LIKE 'QA Campagne %'").get().n, 4);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM contracts WHERE policy_number LIKE 'QA-ACQ-%'").get().n, 8);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM commissions WHERE label LIKE '[QA-ACQ]%'").get().n, 15);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE notes LIKE '[QA-ACQ]%'").get().n, 5);
    } finally {
      db.close();
    }
  } finally {
    cleanup(dataDir);
  }
});

test('les 7 stages du pipeline sont exacts, un prospect par stage', async () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  const db = await openDb(r.dataDir);
  try {
    const stages = ['nouveau', 'contacte', 'rdv', 'analyse', 'offre', 'signe', 'perdu'];
    for (const stage of stages) {
      const row = db.prepare(
        `SELECT ld.pipeline_stage FROM lead_details ld
         JOIN clients c ON c.id = ld.client_id
         WHERE c.email = ?`
      ).get(`qa-acq-prospect-${stage}@example.test`);
      assert.ok(row, `lead_details manquant pour le prospect ${stage}`);
      assert.equal(row.pipeline_stage, stage);
    }
  } finally {
    db.close();
    cleanup(r.dataDir);
  }
});

test('le prospect "sans lead_details" n\'a réellement aucune ligne lead_details', async () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  const db = await openDb(r.dataDir);
  try {
    const client = db.prepare("SELECT id FROM clients WHERE email = 'qa-acq-prospect-sans-lead@example.test'").get();
    assert.ok(client);
    const count = db.prepare('SELECT COUNT(*) AS n FROM lead_details WHERE client_id = ?').get(client.id).n;
    assert.equal(count, 0);
  } finally {
    db.close();
    cleanup(r.dataDir);
  }
});

test('les 5 scénarios de rendez-vous sont corrects (statuts et positionnement relatif au jour actuel)', async () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  const db = await openDb(r.dataDir);
  try {
    const client = db.prepare("SELECT id FROM clients WHERE email = 'qa-acq-appointments-demo@example.test'").get();
    assert.ok(client);
    const rows = db.prepare('SELECT notes, status, starts_at FROM appointments WHERE client_id = ? ORDER BY starts_at').all(client.id);
    assert.equal(rows.length, 5);

    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const dayKeyOf = (s) => s.slice(0, 10);

    const byNotes = Object.fromEntries(rows.map((r2) => [r2.notes, r2]));
    assert.equal(byNotes["[QA-ACQ] RDV — aujourd'hui"].status, 'booked');
    assert.equal(dayKeyOf(byNotes["[QA-ACQ] RDV — aujourd'hui"].starts_at), todayKey);

    assert.equal(byNotes['[QA-ACQ] RDV — futur'].status, 'confirmed');
    assert.ok(dayKeyOf(byNotes['[QA-ACQ] RDV — futur'].starts_at) > todayKey);

    assert.equal(byNotes['[QA-ACQ] RDV — passé'].status, 'completed');
    assert.ok(dayKeyOf(byNotes['[QA-ACQ] RDV — passé'].starts_at) < todayKey);

    assert.equal(byNotes['[QA-ACQ] RDV — no_show'].status, 'no_show');
    assert.equal(byNotes['[QA-ACQ] RDV — annulé'].status, 'cancelled');
  } finally {
    db.close();
    cleanup(r.dataDir);
  }
});

test('les 5 statuts principaux de commission sont représentés (showcase)', async () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  const db = await openDb(r.dataDir);
  try {
    const client = db.prepare("SELECT id FROM clients WHERE email = 'qa-acq-commissions-showcase@example.test'").get();
    const contract = db.prepare('SELECT id FROM contracts WHERE client_id = ?').get(client.id);
    const rows = db.prepare('SELECT label, status, expected_amount_chf, received_amount_chf FROM commissions WHERE contract_id = ?').all(contract.id);
    const statuses = rows.map((r2) => r2.status).sort();
    assert.deepEqual(statuses, ['cancelled', 'disputed', 'expected', 'partially_received', 'received']);
  } finally {
    db.close();
    cleanup(r.dataDir);
  }
});

test('reversal phase A : originale reversed, reprise expected avec montant négatif', async () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  const db = await openDb(r.dataDir);
  try {
    const original = db.prepare("SELECT * FROM commissions WHERE label = '[QA-ACQ] Reversal A — original'").get();
    const reversal = db.prepare("SELECT * FROM commissions WHERE label = '[QA-ACQ] Reversal A — reprise'").get();
    assert.ok(original && reversal);
    assert.equal(original.status, 'reversed');
    assert.equal(original.expected_amount_chf, 1000, 'le montant de la ligne d’origine ne doit jamais changer');
    assert.equal(reversal.status, 'expected');
    assert.equal(reversal.expected_amount_chf, -400);
    assert.equal(reversal.reversal_of_commission_id, original.id);
    assert.equal(reversal.reversal_amount_chf, -400);
  } finally {
    db.close();
    cleanup(r.dataDir);
  }
});

test('reversal phase B : reprise elle-même received avec received_amount_chf négatif', async () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  const db = await openDb(r.dataDir);
  try {
    const original = db.prepare("SELECT * FROM commissions WHERE label = '[QA-ACQ] Reversal B — original'").get();
    const reversal = db.prepare("SELECT * FROM commissions WHERE label = '[QA-ACQ] Reversal B — reprise'").get();
    assert.ok(original && reversal);
    assert.equal(original.status, 'reversed');
    assert.equal(reversal.status, 'received');
    assert.equal(reversal.expected_amount_chf, -300);
    assert.equal(reversal.received_amount_chf, -300, 'received_amount_chf doit être négatif en phase B');
  } finally {
    db.close();
    cleanup(r.dataDir);
  }
});

test('attribution campagne/canal/non-attribué correctement distincte', async () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  const db = await openDb(r.dataDir);
  try {
    // A. attribué campagne (via le client anti-double-count)
    const adc = db.prepare("SELECT ld.campaign_id, ld.channel_id FROM lead_details ld JOIN clients c ON c.id = ld.client_id WHERE c.email = 'qa-acq-anti-double-count@example.test'").get();
    assert.ok(adc.campaign_id != null);
    assert.ok(adc.channel_id != null);

    // B. attribué canal seul
    const channelOnly = db.prepare("SELECT ld.campaign_id, ld.channel_id FROM lead_details ld JOIN clients c ON c.id = ld.client_id WHERE c.email = 'qa-acq-channel-only@example.test'").get();
    assert.equal(channelOnly.campaign_id, null);
    assert.ok(channelOnly.channel_id != null);

    // C. non attribué (aucune ligne lead_details du tout)
    const unattributedClient = db.prepare("SELECT id FROM clients WHERE email = 'qa-acq-unattributed@example.test'").get();
    const leadCount = db.prepare('SELECT COUNT(*) AS n FROM lead_details WHERE client_id = ?').get(unattributedClient.id).n;
    assert.equal(leadCount, 0);
  } finally {
    db.close();
    cleanup(r.dataDir);
  }
});

test('scénario anti-double-count : 1 client, 2 contrats, sommes exactes non dupliquées', async () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  const db = await openDb(r.dataDir);
  try {
    const client = db.prepare("SELECT id FROM clients WHERE email = 'qa-acq-anti-double-count@example.test'").get();
    const contracts = db.prepare('SELECT id FROM contracts WHERE client_id = ?').all(client.id);
    assert.equal(contracts.length, 2);

    const sums = db.prepare(
      `SELECT COALESCE(SUM(expected_amount_chf), 0) AS expected, COALESCE(SUM(received_amount_chf), 0) AS received
       FROM commissions WHERE contract_id IN (${contracts.map(() => '?').join(',')}) AND status != 'cancelled'`
    ).get(...contracts.map((c) => c.id));
    assert.equal(sums.expected, 2500);
    assert.equal(sums.received, 1000);

    // Le décompte de clients convertis via lead_details ne doit jamais
    // doubler à cause des 2 contrats (même logique que
    // server/routes/acquisition-analytics.js : sous-requêtes scalaires).
    const leadCount = db.prepare('SELECT COUNT(*) AS n FROM lead_details WHERE client_id = ?').get(client.id).n;
    assert.equal(leadCount, 1);
  } finally {
    db.close();
    cleanup(r.dataDir);
  }
});

test('campagne "Cancelled Only" n\'a qu\'une commission cancelled (with_commissions attendu false)', async () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  const db = await openDb(r.dataDir);
  try {
    const campaign = db.prepare("SELECT id FROM campaigns WHERE name = 'QA Campagne Cancelled Only'").get();
    const leadClientIds = db.prepare('SELECT client_id FROM lead_details WHERE campaign_id = ?').all(campaign.id).map((r2) => r2.client_id);
    assert.equal(leadClientIds.length, 1);
    const nonCancelledCount = db.prepare(
      `SELECT COUNT(*) AS n FROM commissions cm
       JOIN contracts ct ON ct.id = cm.contract_id
       WHERE ct.client_id = ? AND cm.status != 'cancelled'`
    ).get(leadClientIds[0]).n;
    assert.equal(nonCancelledCount, 0);
  } finally {
    db.close();
    cleanup(r.dataDir);
  }
});

test('reset supprime uniquement les fixtures [QA-ACQ], jamais une donnée non signée', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-qa-acq-provision-test-'));
  try {
    const r1 = runInDir(dataDir);
    assert.equal(r1.status, 0, r1.stderr);

    // Insère une donnée non-QA-ACQ manuellement, pour prouver que le reset
    // ne la touche jamais.
    const { default: Database } = await import('better-sqlite3');
    const dbw = new Database(path.join(dataDir, 'crm.sqlite'));
    const foreignId = dbw.prepare(
      `INSERT INTO clients (type, first_name, last_name, email, status) VALUES ('particulier', 'Non', 'QA', 'quelqu-un-d-autre@example.test', 'prospect')`
    ).run().lastInsertRowid;
    const foreignCampaignId = dbw.prepare(`INSERT INTO campaigns (name, status) VALUES ('Campagne réelle non QA', 'active')`).run().lastInsertRowid;
    dbw.close();

    const r2 = runInDir(dataDir, ['--reset'], { QA_ACQUISITION_CONFIRM: 'QA_SYNTHETIC_ONLY' });
    assert.equal(r2.status, 0, r2.stderr);

    const db = await openDb(dataDir);
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM clients WHERE email LIKE 'qa-acq-%@example.test'").get().n, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM campaigns WHERE name LIKE 'QA Campagne %'").get().n, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM commissions WHERE label LIKE '[QA-ACQ]%'").get().n, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM contracts WHERE policy_number LIKE 'QA-ACQ-%'").get().n, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE notes LIKE '[QA-ACQ]%'").get().n, 0);
      // La donnée étrangère survit intacte.
      const foreignClient = db.prepare('SELECT id FROM clients WHERE id = ?').get(foreignId);
      assert.ok(foreignClient, 'le client non-QA-ACQ ne doit jamais être supprimé par le reset');
      const foreignCampaign = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(foreignCampaignId);
      assert.ok(foreignCampaign, 'la campagne non-QA-ACQ ne doit jamais être supprimée par le reset');
    } finally {
      db.close();
    }
  } finally {
    cleanup(dataDir);
  }
});

test('reset est idempotent (deuxième reset consécutif ne supprime rien de plus, ne plante pas)', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-qa-acq-provision-test-'));
  try {
    const r1 = runInDir(dataDir);
    assert.equal(r1.status, 0, r1.stderr);
    const r2 = runInDir(dataDir, ['--reset'], { QA_ACQUISITION_CONFIRM: 'QA_SYNTHETIC_ONLY' });
    assert.equal(r2.status, 0, r2.stderr);
    const r3 = runInDir(dataDir, ['--reset'], { QA_ACQUISITION_CONFIRM: 'QA_SYNTHETIC_ONLY' });
    assert.equal(r3.status, 0, r3.stderr);
    const parsed = JSON.parse(r3.stdout.slice(r3.stdout.indexOf('{')));
    assert.deepEqual(parsed, {
      commissionsDeleted: 0, contractsDeleted: 0, appointmentsDeleted: 0,
      leadDetailsDeleted: 0, clientsDeleted: 0, campaignsDeleted: 0,
    });
  } finally {
    cleanup(dataDir);
  }
});

test('protection : refuse un CRM_DATA_DIR pointant vers la production connue', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-qa-acq-provision-test-'));
  cleanup(dataDir); // on ne s'en sert pas comme cible réelle, juste pour réserver un handle temporaire cohérent avec run()
  try {
    execFileSync('node', [SCRIPT], {
      cwd: process.cwd(),
      env: { ...process.env, QA_ACQUISITION_ALLOW: '1', CRM_DATA_DIR: '/home/crm/app/data' },
      stdio: 'pipe',
      encoding: 'utf8',
    });
    assert.fail('devait refuser un chemin de production');
  } catch (err) {
    assert.equal(err.status, 1);
    assert.match(err.stderr.toString(), /chemin de production/);
  }
});

test('protection : refuse --reset sans QA_ACQUISITION_CONFIRM (ou avec une valeur invalide)', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-qa-acq-provision-test-'));
  try {
    const r1 = runInDir(dataDir);
    assert.equal(r1.status, 0, r1.stderr);

    const before = fs.statSync(path.join(dataDir, 'crm.sqlite')).size;

    const r2 = runInDir(dataDir, ['--reset']); // pas de QA_ACQUISITION_CONFIRM
    assert.equal(r2.status, 1);
    assert.match(r2.stderr, /QA_ACQUISITION_CONFIRM=QA_SYNTHETIC_ONLY/);

    const r3 = runInDir(dataDir, ['--reset'], { QA_ACQUISITION_CONFIRM: 'valeur-invalide' });
    assert.equal(r3.status, 1);
    assert.match(r3.stderr, /QA_ACQUISITION_CONFIRM=QA_SYNTHETIC_ONLY/);

    const after = fs.statSync(path.join(dataDir, 'crm.sqlite')).size;
    assert.ok(after >= before, 'aucune suppression ne doit avoir eu lieu sans confirmation valide');
  } finally {
    cleanup(dataDir);
  }
});

test('aucune table Advisory/Diagnostic 360 n\'est jamais touchée par le provisioning', async () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  const db = await openDb(r.dataDir);
  try {
    for (const table of ['households', 'household_members', 'advisory_sessions', 'advisory_answers', 'advisory_findings', 'advisory_recommendations']) {
      const n = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
      assert.equal(n, 0, `la table ${table} devrait rester vide, jamais touchée par le provisionneur Acquisition`);
    }
  } finally {
    db.close();
    cleanup(r.dataDir);
  }
});
