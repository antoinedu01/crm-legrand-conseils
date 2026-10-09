// Import d'un fichier de conventions (aperçu puis application). Base de test
// isolée (CRM_DATA_DIR), jamais data/**. Fichier et barèmes FICTIFS.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-conventions-import-'));
process.env.NODE_ENV = 'test';
process.env.SITE_ORIGINS = 'https://site-de-test.ch';
process.env.PUBLIC_RATE_LIMIT = '1000';

const { default: app } = await import('../server/app.js');
const { default: db } = await import('../server/db.js');

const PASSWORD = 'MotDePasseDeTest!42';
let cookie = '';
const auth = (req) => req.set('Cookie', cookie);

before(async () => {
  const res = await request(app)
    .post('/api/auth/setup')
    .send({ email: 'test-import-conventions@exemple.ch', name: 'Testeur', password: PASSWORD });
  assert.equal(res.status, 200);
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
});

// « Concordia » fait partie des compagnies semées au premier démarrage ;
// « Assureur Fictif SA » n'existe pas encore et doit être créé.
function sampleFile(overrides = {}) {
  return {
    format: 'crm-legrand-conventions',
    version: 1,
    deactivate_companies_without_convention: true,
    conventions: [
      {
        company: { name: 'concordia', aliases: ['Concordia Assurance'], contact_name: 'Service courtiers', default_acq_rate: 0, default_rec_rate: 0 },
        title: 'Convention fictive Santé',
        status: 'signee',
        intermediary_code: 'TEST-1',
        effective_date: '2026-07-01',
        client_followup: 'compagnie',
        obligations: 'Procès-verbal de conseil signé.',
        rates: [
          { branch: 'lamal', label: 'Base fictive', basis: 'fixe', value: 50, clawback_mode: 'paliers', clawback_steps: [{ months: 12, pct: 100 }] },
          { branch: 'lca', label: 'Complémentaire fictive', basis: 'mois_prime', value: 8, clawback_mode: 'paliers', clawback_steps: [{ months: 12, pct: 100 }] },
        ],
      },
      {
        company: { name: 'Assureur Fictif SA', contact_email: 'courtiers@assureur-fictif.example' },
        title: 'Convention fictive Vie',
        status: 'signee',
        missing_documents: 'Tabelle de rémunération',
        rates: [
          { branch: 'vie_3a', label: 'Vie fictive', basis: 'pct_production', value: 3, max_years: 30, is_estimate: true, clawback_mode: 'prorata', clawback_months: 24 },
          { branch: 'lca', label: 'Santé fictive', basis: 'a_confirmer' },
        ],
      },
    ],
    ...overrides,
  };
}

const post = (body) => auth(request(app).post('/api/conventions/import')).send(body);
const counts = () => ({
  companies: db.prepare('SELECT COUNT(*) AS n FROM companies').get().n,
  active: db.prepare('SELECT COUNT(*) AS n FROM companies WHERE active = 1').get().n,
  conventions: db.prepare('SELECT COUNT(*) AS n FROM conventions').get().n,
  rates: db.prepare('SELECT COUNT(*) AS n FROM convention_rates').get().n,
});

test('aperçu (dry run) : plan détaillé, aucune écriture', async () => {
  const before = counts();
  const res = await post({ data: sampleFile(), dry_run: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.dry_run, true);
  assert.equal(res.body.summary.conventions_created, 2);
  assert.equal(res.body.summary.companies_created, 1);
  assert.equal(res.body.summary.rates_created, 4);
  assert.ok(res.body.deactivate.includes('Swiss Life'), 'compagnie semée sans convention : à désactiver');
  assert.ok(!res.body.deactivate.includes('Concordia'));
  assert.deepEqual(counts(), before, 'un aperçu ne doit rien écrire');
});

test('un fichier invalide est refusé en entier avec un message localisé', async () => {
  const before = counts();
  const bad = sampleFile();
  bad.conventions[1].rates[0].clawback_months = null;
  const res = await post({ data: bad, dry_run: false });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Convention n° 2 \(Assureur Fictif SA\) — ligne 1 \(Vie fictive\)/);
  assert.deepEqual(counts(), before, 'aucune écriture partielle');

  assert.equal((await post({ data: { format: 'autre', version: 1, conventions: [] } })).status, 400);
  const duplicate = sampleFile();
  duplicate.conventions[0].rates.push({ ...duplicate.conventions[0].rates[0] });
  assert.equal((await post({ data: duplicate })).status, 400, 'ligne en double');
});

test('application : compagnie créée, conventions et lignes écrites, autres compagnies désactivées', async () => {
  const res = await post({ data: sampleFile(), dry_run: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const concordia = db.prepare("SELECT * FROM companies WHERE name = 'Concordia'").get();
  assert.equal(concordia.active, 1);
  assert.equal(concordia.contact_name, 'Service courtiers');
  assert.equal(concordia.default_acq_rate, 0);
  const fictif = db.prepare("SELECT * FROM companies WHERE name = 'Assureur Fictif SA'").get();
  assert.ok(fictif, 'compagnie créée');
  assert.equal(fictif.contact_email, 'courtiers@assureur-fictif.example');
  assert.equal(db.prepare("SELECT active FROM companies WHERE name = 'Swiss Life'").get().active, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM companies WHERE active = 1').get().n, 2);

  const conv = db.prepare('SELECT * FROM conventions WHERE company_id = ?').get(concordia.id);
  assert.equal(conv.intermediary_code, 'TEST-1');
  assert.equal(conv.client_followup, 'compagnie');
  const rates = db.prepare('SELECT * FROM convention_rates WHERE convention_id = ? ORDER BY sort').all(conv.id);
  assert.deepEqual(rates.map((r) => r.label), ['Base fictive', 'Complémentaire fictive']);
  assert.deepEqual(JSON.parse(rates[0].clawback_steps), [{ months: 12, pct: 100 }]);

  const audit = db.prepare("SELECT * FROM audit_log WHERE action = 'import conventions'").all();
  assert.equal(audit.length, 1);
});

test('ré-import identique : idempotent, aucun doublon', async () => {
  const before = counts();
  const res = await post({ data: sampleFile(), dry_run: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.summary.conventions_created, 0);
  assert.equal(res.body.summary.conventions_updated, 2);
  assert.equal(res.body.summary.rates_created, 0);
  assert.deepEqual(counts(), before);
});

test('ré-import modifié : ligne utilisée remplacée (ancienne conservée), ligne absente désactivée', async () => {
  const concordia = db.prepare("SELECT * FROM companies WHERE name = 'Concordia'").get();
  const lamalRate = db.prepare("SELECT r.* FROM convention_rates r JOIN conventions c ON c.id = r.convention_id WHERE c.company_id = ? AND r.branch = 'lamal'").get(concordia.id);
  const client = await auth(request(app).post('/api/clients')).send({ first_name: 'Test', last_name: 'Import', status: 'client' });
  const contract = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: concordia.id, branch: 'lamal', annual_premium: 3000, status: 'actif', convention_rate_id: lamalRate.id,
  });
  assert.equal(contract.status, 201, JSON.stringify(contract.body));

  const changed = sampleFile();
  changed.conventions[0].rates[0].value = 60; // ligne utilisée → remplacée
  changed.conventions[0].rates.splice(1, 1); // ligne LCA retirée du fichier → désactivée
  const res = await post({ data: changed, dry_run: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.summary.rates_replaced, 1);
  assert.equal(res.body.summary.rates_retired, 1);

  const old = db.prepare('SELECT * FROM convention_rates WHERE id = ?').get(lamalRate.id);
  assert.equal(old.active, 0, 'ancienne ligne désactivée, jamais réécrite');
  assert.equal(old.value, 50);
  const replacement = db
    .prepare("SELECT * FROM convention_rates WHERE convention_id = ? AND branch = 'lamal' AND active = 1")
    .get(old.convention_id);
  assert.equal(replacement.value, 60);
  assert.equal(db.prepare('SELECT convention_rate_id FROM contracts WHERE id = ?').get(contract.body.id).convention_rate_id, lamalRate.id,
    'le contrat existant garde sa ligne d’origine');
  const lca = db.prepare("SELECT active FROM convention_rates WHERE convention_id = ? AND branch = 'lca'").get(old.convention_id);
  assert.equal(lca.active, 0);
});

test('désactivation des autres compagnies : option refusable au moment de l’import', async () => {
  db.prepare("UPDATE companies SET active = 1 WHERE name = 'Swiss Life'").run();
  const res = await post({ data: sampleFile(), dry_run: false, deactivate_others: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.deactivate.length, 0);
  assert.equal(db.prepare("SELECT active FROM companies WHERE name = 'Swiss Life'").get().active, 1);
});
