// Tests ciblés du durcissement QA_PERSISTENT de `scripts/qa-health-provision.mjs`
// (QA-INFRA1-HARDEN §6). Bases isolées dans des répertoires temporaires
// (jamais data/**). Aucun réseau, aucun VPS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';

const SCRIPT = path.join(process.cwd(), 'scripts', 'qa-health-provision.mjs');

function run(env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-qa-provision-test-'));
  try {
    const out = execFileSync('node', [SCRIPT], {
      cwd: process.cwd(),
      env: { ...process.env, QA_E2E_ALLOW: '1', CRM_DATA_DIR: dataDir, QA_MODE: 'main', ...env },
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return { status: 0, stdout: out, stderr: '', dataDir };
  } catch (err) {
    return { status: err.status, stdout: err.stdout?.toString() || '', stderr: err.stderr?.toString() || '', dataDir };
  }
}

function cleanup(dataDir) {
  fs.rmSync(dataDir, { recursive: true, force: true });
}

test('qa-health-provision.mjs — QA_PERSISTENT=1 sans QA_ADVISER_PASSWORD refuse, aucune base créée avec un compte', () => {
  const r = run({ QA_PERSISTENT: '1' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_PERSISTENT=1 exige QA_ADVISER_PASSWORD/);
  cleanup(r.dataDir);
});

test('qa-health-provision.mjs — QA_PERSISTENT=1 avec QA_ADVISER_PASSWORD réussit, mot de passe jamais affiché, jamais dans le manifeste', async () => {
  const password = 'Un-Mot-De-Passe-Fictif-De-Test-2026!';
  const r = run({ QA_PERSISTENT: '1', QA_ADVISER_PASSWORD: password });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes(password), 'le mot de passe ne doit jamais apparaître sur stdout');

  const manifestPath = path.join(r.dataDir, 'qa-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.adviser.password, null, 'le manifeste ne doit jamais contenir le mot de passe en mode persistant');

  const { default: Database } = await import('better-sqlite3');
  const db = new Database(path.join(r.dataDir, 'crm.sqlite'), { readonly: true });
  try {
    const user = db.prepare('SELECT password_hash FROM users WHERE email = ?').get('conseiller.qa@example.invalid');
    assert.ok(user, 'le compte conseiller doit exister');
    assert.ok(bcrypt.compareSync(password, user.password_hash), 'le hash stocké doit correspondre au mot de passe fourni via QA_ADVISER_PASSWORD');
  } finally {
    db.close();
  }
  cleanup(r.dataDir);
});

test('qa-health-provision.mjs — sans QA_PERSISTENT (usage éphémère existant), le provisioning continue de fonctionner comme avant', () => {
  const r = run({});
  assert.equal(r.status, 0, r.stderr);
  const manifestPath = path.join(r.dataDir, 'qa-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.adviser.email, 'conseiller.qa@example.invalid');
  assert.equal(typeof manifest.adviser.password, 'string', 'le mode éphémère existant garde son mot de passe fixe dans le manifeste, comportement inchangé');
  cleanup(r.dataDir);
});

test('qa-health-provision.mjs — sans QA_PERSISTENT, un CRM_DATA_DIR hors du répertoire temporaire du système est refusé (garde-fou anti-erreur-opérateur)', () => {
  // Chemin délibérément hors de /tmp (os.tmpdir()) et jamais créé : le
  // refus doit survenir avant tout mkdirSync -- constat revue conformité
  // QA-INFRA1-HARDEN §3 (éviter qu'une simple omission de QA_PERSISTENT=1
  // sur le futur VPS QA crée silencieusement un compte au mot de passe fixe).
  const nonTempDir = path.join(process.cwd(), '.qa-provision-non-temp-test-should-never-exist');
  try {
    const out = execFileSync('node', [SCRIPT], {
      cwd: process.cwd(),
      env: { ...process.env, QA_E2E_ALLOW: '1', CRM_DATA_DIR: nonTempDir, QA_MODE: 'main' },
      stdio: 'pipe',
      encoding: 'utf8',
    });
    assert.fail(`devait refuser, a réussi : ${out}`);
  } catch (err) {
    assert.equal(err.status, 1);
    assert.match(err.stderr.toString(), /n'est pas sous le répertoire temporaire du système/);
  }
  assert.equal(fs.existsSync(nonTempDir), false, 'le dossier ne doit jamais avoir été créé (refus avant mkdirSync)');
});
