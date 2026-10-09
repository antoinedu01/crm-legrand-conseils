// Import d'un fichier de conventions (aperçu puis application). Base de test
// isolée (CRM_DATA_DIR), jamais data/**. Fichier, compagnies et barèmes
// FICTIFS : aucun nom ni taux réel de compagnie dans ce dépôt public.
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

// Compagnie fictive créée avant l'import (elle doit être retrouvée par son
// nom, casse et accents ignorés) ; « Assureur Fictif SA » est créée par
// l'import ; les compagnies semées au premier démarrage n'ont pas de
// convention dans le fichier.
let seededIds = [];
before(async () => {
  const res = await request(app)
    .post('/api/auth/setup')
    .send({ email: 'test-import-conventions@exemple.ch', name: 'Testeur', password: PASSWORD });
  assert.equal(res.status, 200);
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  seededIds = db.prepare('SELECT id FROM companies WHERE active = 1').all().map((r) => r.id);
  assert.ok(seededIds.length > 0, 'précondition : compagnies semées au premier démarrage');
  db.prepare("INSERT INTO companies (name, default_acq_rate, default_rec_rate) VALUES ('Caisse Fictive Santé', 3, 0.5)").run();
});

const companyByName = (name) => db.prepare('SELECT * FROM companies WHERE name = ?').get(name);
const conventionOf = (companyId) => db.prepare('SELECT * FROM conventions WHERE company_id = ? ORDER BY id').all(companyId);
const ratesOf = (conventionId) => db.prepare('SELECT * FROM convention_rates WHERE convention_id = ? ORDER BY sort, id').all(conventionId);

function sampleFile(overrides = {}) {
  return {
    format: 'crm-legrand-conventions',
    version: 1,
    generated_at: '2026-10-01',
    note: 'Fichier de test',
    deactivate_companies_without_convention: true,
    conventions: [
      {
        company: { name: 'CAISSE FICTIVE SANTE', aliases: ['Caisse Fictive'], contact_name: 'Service courtiers', default_acq_rate: 0, default_rec_rate: 0 },
        title: 'Convention fictive Santé',
        status: 'signee',
        intermediary_code: 'TEST-1',
        effective_date: '2026-07-01',
        client_followup: 'compagnie',
        obligations: 'Procès-verbal de conseil signé.',
        _commentaire: 'clé de commentaire, ignorée',
        rates: [
          { branch: 'lamal', label: 'Base fictive', basis: 'fixe', value: 50, clawback_mode: 'paliers', clawback_steps: [{ months: 12, pct: 100 }] },
          { branch: 'lca', label: 'Complémentaire fictive', basis: 'mois_prime', value: 8, clawback_mode: 'paliers', clawback_steps: [{ months: 12, pct: 100 }] },
        ],
      },
      {
        company: { name: 'Assureur Fictif SA', aliases: ['Fictif Vie'], contact_email: 'courtiers@assureur-fictif.example' },
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
  activeRates: db.prepare('SELECT COUNT(*) AS n FROM convention_rates WHERE active = 1').get().n,
});

test('aperçu (dry run) : plan détaillé, aucune écriture', async () => {
  const before = counts();
  const res = await post({ data: sampleFile() });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.dry_run, true, 'aperçu par défaut');
  assert.equal(res.body.summary.conventions_created, 2);
  assert.equal(res.body.summary.companies_created, 1);
  assert.equal(res.body.summary.rates_created, 4);
  assert.deepEqual(res.body.options, { deactivate_others: true, retire_missing: false });
  const seededName = db.prepare('SELECT name FROM companies WHERE id = ?').get(seededIds[0]).name;
  assert.ok(res.body.deactivate.includes(seededName), 'compagnie semée sans convention : à désactiver');
  assert.ok(!res.body.deactivate.includes('Caisse Fictive Santé'), 'compagnie du fichier retrouvée par son nom');
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
  const badDate = sampleFile();
  badDate.conventions[0].effective_date = '2026-02-31';
  assert.equal((await post({ data: badDate })).status, 400, 'date impossible refusée');
  const longAlias = sampleFile();
  longAlias.conventions[0].company.aliases = ['x'.repeat(201)];
  assert.equal((await post({ data: longAlias })).status, 400, 'alias trop long');
});

test('champs inconnus refusés (faute de frappe), commentaires « _ » acceptés', async () => {
  const cases = [
    ['fichier', (f) => { f.deactivate_companies = true; }, /Fichier : champ inconnu « deactivate_companies »/],
    ['convention', (f) => { f.conventions[0].intermediaire = 'X'; }, /Convention n° 1 .* champ inconnu « intermediaire »/],
    ['compagnie', (f) => { f.conventions[0].company.alias = ['X']; }, /champs de la compagnie : champ inconnu « alias »/],
    ['ligne', (f) => { f.conventions[0].rates[0].clawback_step = []; }, /ligne 1 \(Base fictive\) : champs de la ligne : champ inconnu « clawback_step »/],
  ];
  for (const [what, mutate, pattern] of cases) {
    const file = sampleFile();
    mutate(file);
    const res = await post({ data: file });
    assert.equal(res.status, 400, what);
    assert.match(res.body.error, pattern, `${what} : ${res.body.error}`);
  }
  const commented = sampleFile({ _origine: 'export manuel' });
  commented.conventions[1].rates[0]._note = 'vérifier';
  assert.equal((await post({ data: commented })).status, 200);
});

test('application : compagnie retrouvée ou créée, conventions et lignes écrites, autres compagnies désactivées', async () => {
  const res = await post({ data: sampleFile(), dry_run: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const caisse = companyByName('Caisse Fictive Santé');
  assert.equal(caisse.active, 1);
  assert.equal(caisse.contact_name, 'Service courtiers');
  assert.equal(caisse.default_acq_rate, 0);
  const fictif = companyByName('Assureur Fictif SA');
  assert.ok(fictif, 'compagnie créée');
  assert.equal(fictif.contact_email, 'courtiers@assureur-fictif.example');
  for (const id of seededIds) {
    assert.equal(db.prepare('SELECT active FROM companies WHERE id = ?').get(id).active, 0, 'compagnie sans convention désactivée');
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM companies WHERE active = 1').get().n, 2);

  const [conv] = conventionOf(caisse.id);
  assert.equal(conv.intermediary_code, 'TEST-1');
  assert.equal(conv.client_followup, 'compagnie');
  const rates = ratesOf(conv.id);
  assert.deepEqual(rates.map((r) => r.label), ['Base fictive', 'Complémentaire fictive']);
  assert.deepEqual(JSON.parse(rates[0].clawback_steps), [{ months: 12, pct: 100 }]);

  const audit = db.prepare("SELECT * FROM audit_log WHERE action = 'import conventions'").all();
  assert.equal(audit.length, 1);
  const perEntity = db.prepare("SELECT action, entity, entity_id, details FROM audit_log WHERE action LIKE 'import — %'").all();
  assert.ok(perEntity.some((e) => e.action === 'import — création compagnie' && e.entity_id === fictif.id));
  assert.equal(perEntity.filter((e) => e.action === 'import — création convention').length, 2);
  assert.equal(perEntity.filter((e) => e.action === 'import — désactivation compagnie').length, seededIds.length);
  for (const e of perEntity) assert.doesNotMatch(e.details || '', /\d+(\.\d+)? ?(%|CHF)/, 'aucun montant dans le journal');
});

test('ré-import identique : idempotent, rien n’est réécrit', async () => {
  const before = counts();
  const res = await post({ data: sampleFile(), dry_run: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.summary.conventions_created, 0);
  assert.equal(res.body.summary.conventions_updated, 0);
  assert.equal(res.body.summary.conventions_unchanged, 2);
  assert.equal(res.body.summary.rates_created, 0);
  assert.equal(res.body.summary.rates_updated, 0);
  assert.equal(res.body.summary.rates_unchanged, 4);
  assert.deepEqual(counts(), before);
});

test('non destructif : ce qui a été complété dans le CRM et absent du fichier est conservé', async () => {
  const caisse = companyByName('Caisse Fictive Santé');
  const [conv] = conventionOf(caisse.id);
  const [lamal] = ratesOf(conv.id);
  // Compléments saisis à la main dans l'interface.
  assert.equal((await auth(request(app).put(`/api/conventions/${conv.id}`)).send({ notes: 'Note du conseiller', document_location: 'kDrive/Conventions' })).status, 200);
  assert.equal((await auth(request(app).put(`/api/conventions/rates/${lamal.id}`)).send({ conditions: 'Condition saisie à la main' })).status, 200);
  db.prepare("UPDATE companies SET contact_phone = '000 000 00 00' WHERE id = ?").run(caisse.id);

  const changed = sampleFile();
  changed.conventions[0].obligations = 'Procès-verbal de conseil signé et copie de la police précédente.';
  const res = await post({ data: changed, dry_run: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const preview = res.body.conventions.find((c) => c.title === 'Convention fictive Santé');
  assert.equal(preview.action, 'update');
  assert.deepEqual(preview.changed, ['obligations']);

  const after = db.prepare('SELECT * FROM conventions WHERE id = ?').get(conv.id);
  assert.equal(after.obligations, 'Procès-verbal de conseil signé et copie de la police précédente.');
  assert.equal(after.notes, 'Note du conseiller', 'champ absent du fichier : conservé');
  assert.equal(after.document_location, 'kDrive/Conventions');
  assert.equal(db.prepare('SELECT conditions FROM convention_rates WHERE id = ?').get(lamal.id).conditions, 'Condition saisie à la main');
  assert.equal(companyByName('Caisse Fictive Santé').contact_phone, '000 000 00 00');

  // Un champ explicitement vidé dans le fichier efface la valeur.
  const cleared = sampleFile();
  cleared.conventions[0].notes = null;
  assert.equal((await post({ data: cleared, dry_run: false })).status, 200);
  assert.equal(db.prepare('SELECT notes FROM conventions WHERE id = ?').get(conv.id).notes, null);
});

test('sans clé « rates » : barème intact ; lignes absentes conservées par défaut, désactivées avec retire_missing', async () => {
  const caisse = companyByName('Caisse Fictive Santé');
  const [conv] = conventionOf(caisse.id);
  const activeBefore = ratesOf(conv.id).filter((r) => r.active).length;

  const noRates = sampleFile();
  delete noRates.conventions[0].rates;
  const res = await post({ data: noRates, dry_run: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const preview = res.body.conventions.find((c) => c.title === 'Convention fictive Santé');
  assert.equal(preview.rates_provided, false);
  assert.equal(ratesOf(conv.id).filter((r) => r.active).length, activeBefore, 'aucune ligne désactivée');

  const partial = sampleFile();
  partial.conventions[0].rates.splice(1, 1); // ligne LCA absente du fichier
  const kept = await post({ data: partial, dry_run: false });
  assert.equal(kept.status, 200, JSON.stringify(kept.body));
  assert.equal(kept.body.summary.rates_retired, 0);
  assert.equal(kept.body.summary.rates_kept, 1);
  assert.deepEqual(kept.body.conventions.find((c) => c.title === 'Convention fictive Santé').kept, ['Complémentaire fictive']);
  assert.equal(db.prepare("SELECT active FROM convention_rates WHERE convention_id = ? AND branch = 'lca'").get(conv.id).active, 1);

  const preview2 = await post({ data: partial, retire_missing: true });
  assert.equal(preview2.body.summary.rates_retired, 1, 'option visible dans l’aperçu');
  assert.equal(db.prepare("SELECT active FROM convention_rates WHERE convention_id = ? AND branch = 'lca'").get(conv.id).active, 1, 'aperçu sans écriture');
  const retired = await post({ data: partial, dry_run: false, retire_missing: true });
  assert.equal(retired.status, 200, JSON.stringify(retired.body));
  assert.equal(retired.body.summary.rates_retired, 1);
  const lca = db.prepare("SELECT * FROM convention_rates WHERE convention_id = ? AND branch = 'lca'").get(conv.id);
  assert.equal(lca.active, 0, 'désactivée, jamais supprimée');
});

test('ligne désactivée dans le CRM : jamais réactivée en silence, seulement sur "active": true', async () => {
  const caisse = companyByName('Caisse Fictive Santé');
  const [conv] = conventionOf(caisse.id);
  const lca = db.prepare("SELECT * FROM convention_rates WHERE convention_id = ? AND branch = 'lca'").get(conv.id);
  assert.equal(lca.active, 0, 'précondition : ligne désactivée');

  const again = await post({ data: sampleFile(), dry_run: false });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  const line = again.body.conventions.find((c) => c.title === 'Convention fictive Santé').rates.find((r) => r.branch === 'lca');
  assert.equal(line.inactive_kept, true);
  assert.equal(db.prepare('SELECT active FROM convention_rates WHERE id = ?').get(lca.id).active, 0);

  const explicit = sampleFile();
  explicit.conventions[0].rates[1].active = true;
  const res = await post({ data: explicit, dry_run: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.summary.rates_reactivated, 1);
  assert.equal(db.prepare('SELECT active FROM convention_rates WHERE id = ?').get(lca.id).active, 1);
});

test('ré-import modifié : ligne utilisée remplacée (ancienne conservée), ligne inutilisée mise à jour', async () => {
  const caisse = companyByName('Caisse Fictive Santé');
  const [conv] = conventionOf(caisse.id);
  const lamalRate = db.prepare("SELECT * FROM convention_rates WHERE convention_id = ? AND branch = 'lamal' AND active = 1").get(conv.id);
  const client = await auth(request(app).post('/api/clients')).send({ first_name: 'Test', last_name: 'Import', status: 'client' });
  const contract = await auth(request(app).post('/api/contracts')).send({
    client_id: client.body.id, company_id: caisse.id, branch: 'lamal', annual_premium: 3000, status: 'actif', convention_rate_id: lamalRate.id,
  });
  assert.equal(contract.status, 201, JSON.stringify(contract.body));

  const changed = sampleFile();
  changed.conventions[0].rates[0].value = 60; // ligne utilisée → remplacée
  changed.conventions[0].rates[1].value = 9; // ligne inutilisée → mise à jour sur place
  const res = await post({ data: changed, dry_run: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.summary.rates_replaced, 1);
  assert.equal(res.body.summary.rates_updated, 1);

  const old = db.prepare('SELECT * FROM convention_rates WHERE id = ?').get(lamalRate.id);
  assert.equal(old.active, 0, 'ancienne ligne désactivée, jamais réécrite');
  assert.equal(old.value, 50);
  const replacement = db
    .prepare("SELECT * FROM convention_rates WHERE convention_id = ? AND branch = 'lamal' AND active = 1")
    .get(old.convention_id);
  assert.equal(replacement.value, 60);
  assert.equal(replacement.conditions, 'Condition saisie à la main', 'la nouvelle ligne reprend les compléments de l’ancienne');
  assert.equal(db.prepare('SELECT convention_rate_id FROM contracts WHERE id = ?').get(contract.body.id).convention_rate_id, lamalRate.id,
    'le contrat existant garde sa ligne d’origine');
  assert.equal(db.prepare("SELECT value FROM convention_rates WHERE convention_id = ? AND branch = 'lca'").get(conv.id).value, 9);
});

test('compagnies : alias dans le même fichier, nom principal prioritaire, réactivation seulement si la convention est signée', async () => {
  db.prepare("INSERT INTO companies (name, active) VALUES ('Assurances Omega', 0)").run();
  db.prepare("INSERT INTO companies (name, active) VALUES ('Omega Vie', 1)").run();
  const file = {
    format: 'crm-legrand-conventions',
    version: 1,
    conventions: [
      // Nom principal « Omega Vie » prioritaire sur l'alias « Assurances Omega ».
      { company: { name: 'Omega Vie', aliases: ['Assurances Omega'] }, title: 'Convention Omega Vie', status: 'signee' },
      // Compagnie nouvelle, désignée une seconde fois par son alias.
      { company: { name: 'Sigma Assurances SA', aliases: ['Sigma'] }, title: 'Convention Sigma Santé', status: 'signee' },
      { company: { name: 'Sigma' }, title: 'Convention Sigma Vie', status: 'en_attente' },
    ],
  };
  const res = await post({ data: file, dry_run: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.summary.companies_created, 1, 'une seule compagnie créée pour le nom et son alias');
  const sigma = companyByName('Sigma Assurances SA');
  assert.equal(conventionOf(sigma.id).length, 2);
  assert.equal(companyByName('Sigma'), undefined);
  const omegaVie = companyByName('Omega Vie');
  assert.equal(conventionOf(omegaVie.id).length, 1, 'convention rattachée au nom principal');
  assert.equal(conventionOf(companyByName('Assurances Omega').id).length, 0);

  // Réactivation : convention en attente → la compagnie inactive le reste.
  db.prepare("INSERT INTO companies (name, active) VALUES ('Tau Assurances', 0)").run();
  const pending = await post({
    data: { format: 'crm-legrand-conventions', version: 1, conventions: [{ company: { name: 'Tau Assurances' }, title: 'Convention Tau', status: 'en_attente' }] },
    dry_run: false,
  });
  assert.equal(pending.status, 200, JSON.stringify(pending.body));
  assert.equal(pending.body.companies[0].inactive_kept, true);
  assert.equal(companyByName('Tau Assurances').active, 0);
  const signed = await post({
    data: { format: 'crm-legrand-conventions', version: 1, conventions: [{ company: { name: 'Tau Assurances' }, title: 'Convention Tau', status: 'signee' }] },
    dry_run: false,
  });
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  assert.equal(signed.body.summary.companies_reactivated, 1);
  assert.equal(companyByName('Tau Assurances').active, 1);
});

test('désactivation des autres compagnies : refusable, et jamais pour une compagnie qui a une convention signée dans le CRM', async () => {
  db.prepare('UPDATE companies SET active = 1 WHERE id = ?').run(seededIds[0]);
  const refused = await post({ data: sampleFile(), dry_run: false, deactivate_others: false });
  assert.equal(refused.status, 200, JSON.stringify(refused.body));
  assert.equal(refused.body.deactivate.length, 0);
  assert.equal(db.prepare('SELECT active FROM companies WHERE id = ?').get(seededIds[0]).active, 1);

  // « Tau Assurances » a une convention signée (test précédent) mais n'est
  // pas dans ce fichier : elle reste active.
  const res = await post({ data: sampleFile(), dry_run: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.deactivate_skipped.includes('Tau Assurances'), JSON.stringify(res.body.deactivate_skipped));
  assert.equal(companyByName('Tau Assurances').active, 1);
  assert.equal(db.prepare('SELECT active FROM companies WHERE id = ?').get(seededIds[0]).active, 0);
});
