// Tests du service « contrôles de conservation, anonymisation et effacement
// des données de diagnostic » (Legrand Diagnostic 360, chantier préalable à
// l'activation). Base de test isolée (CRM_DATA_DIR), jamais data/**. Aucune
// donnée client réelle, foyers/sessions fictifs uniquement. La politique
// reste désactivée par défaut dans toute la base réelle -- ces tests
// l'activent explicitement, UNIQUEMENT sur la base temporaire de test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-retention-'));

const { default: db } = await import('../server/db.js');
const { createHousehold, addMember } = await import('../server/advisoryHouseholds.js');
const RET = await import('../server/advisoryRetention.js');

const REQ = { session: { userEmail: 'conseiller-retention@exemple.ch' } };
db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run('conseiller-retention@exemple.ch', 'Conseiller', 'x');
const advisorUserId = db.prepare('SELECT id FROM users WHERE email = ?').get(REQ.session.userEmail).id;

function auditCount(action) {
  return db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?').get(action).n;
}

let clientCounter = 0;
function insertClient(over = {}) {
  clientCounter += 1;
  const data = { type: 'particulier', first_name: `P${clientCounter}`, last_name: 'Test', status: 'prospect', ...over };
  return db
    .prepare('INSERT INTO clients (type, first_name, last_name, status) VALUES (?, ?, ?, ?)')
    .run(data.type, data.first_name, data.last_name, data.status).lastInsertRowid;
}

function buildHousehold() {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  return { householdId, principalClientId: principalId };
}

function insertContract(clientId) {
  const companyId = db.prepare("INSERT INTO companies (name) VALUES ('Compagnie fictive')").run().lastInsertRowid;
  return db
    .prepare("INSERT INTO contracts (client_id, company_id, branch, status) VALUES (?, ?, 'lamal', 'actif')")
    .run(clientId, companyId).lastInsertRowid;
}

// Fixture directe (raw SQL) : construit une session avec un contrôle exact
// sur last_activity_at/completed_at -- inutile de passer par le cycle de vie
// complet du service advisorySessions.js pour ces tests d'éligibilité, qui
// ne portent que sur des dates et des compteurs.
function daysAgoSql(n) {
  return db.prepare(`SELECT datetime('now', '-${n} days') AS d`).get().d;
}

// `lastActivityIso`/`completedIso` : date explicite (avec `now` figé passé en
// option aux fonctions d'éligibilité), utilisée pour les tests d'arithmétique
// CALENDAIRE exacte (catégories B/C, décision humaine du 2026-08-04) — les
// variantes `...DaysAgo` restent relatives à l'horloge réelle au moment du
// test, insuffisant pour vérifier une frontière calendaire déterministe.
function insertSessionFixture(householdId, {
  status = 'draft', lastActivityDaysAgo = null, completedDaysAgo = null, lastActivityIso = null, completedIso = null, title = 'Session fictive',
} = {}) {
  const lastActivity = lastActivityIso ?? (lastActivityDaysAgo != null ? daysAgoSql(lastActivityDaysAgo) : null);
  const completedAt = completedIso ?? (completedDaysAgo != null ? daysAgoSql(completedDaysAgo) : null);
  return db
    .prepare(
      `INSERT INTO advisory_sessions (household_id, advisor_user_id, domain, status, title, last_activity_at, completed_at)
       VALUES (?, ?, 'health', ?, ?, ?, ?)`
    )
    .run(householdId, advisorUserId, status, title, lastActivity, completedAt).lastInsertRowid;
}

function insertAnswerFixture(sessionId) {
  const qVersionId = db.prepare(`
    INSERT INTO advisory_questionnaires (stable_key, domain, name) VALUES (?, 'health', 'X')
  `).run(`quest-ret-${sessionId}-${Math.random()}`).lastInsertRowid;
  const vid = db.prepare(`INSERT INTO advisory_questionnaire_versions (questionnaire_id, version_number) VALUES (?, 1)`).run(qVersionId).lastInsertRowid;
  const sectionId = db.prepare(`INSERT INTO advisory_sections (questionnaire_version_id, stable_key, title, sort_order) VALUES (?, 's1', 'S', 1)`).run(vid).lastInsertRowid;
  const qId = db.prepare(`INSERT INTO advisory_questions (section_id, questionnaire_version_id, stable_key, advisor_text, type, sort_order) VALUES (?, ?, 'q1', 'Q ?', 'boolean', 1)`).run(sectionId, vid).lastInsertRowid;
  db.prepare(`INSERT INTO advisory_answers (session_id, question_id, status, value_boolean, revision) VALUES (?, ?, 'answered', 1, 1)`).run(sessionId, qId);
  return qId;
}

function insertRecommendationFixture(sessionId, { status = 'draft' } = {}) {
  return db
    .prepare(`INSERT INTO advisory_recommendations (session_id, domain, scope, status, title, advisor_rationale, created_by_user_id) VALUES (?, 'health', 'household', ?, 'T', 'R', ?)`)
    .run(sessionId, status, advisorUserId).lastInsertRowid;
}

function enablePolicy(category, overrides = {}) {
  const sets = ['enabled = 1'];
  const values = [];
  if ('duration_days' in overrides) { sets.push('duration_days = ?'); values.push(overrides.duration_days); }
  db.prepare(`UPDATE advisory_retention_policies SET ${sets.join(', ')} WHERE category = ?`).run(...values, category);
}

function disablePolicy(category) {
  db.prepare(`UPDATE advisory_retention_policies SET enabled = 0 WHERE category = ?`).run(category);
}

function resetPolicies() {
  db.prepare(`UPDATE advisory_retention_policies SET enabled = 0`).run();
  db.prepare(`UPDATE advisory_retention_policies SET duration_days = 90 WHERE category = 'abandoned_diagnostic'`).run();
  db.prepare(`UPDATE advisory_retention_policies SET duration_days = 365 WHERE category = 'prospect_no_mandate'`).run();
  db.prepare(`UPDATE advisory_retention_policies SET duration_days = 3650 WHERE category = 'finalized_advice'`).run();
  db.prepare(`UPDATE advisory_retention_config SET real_purge_enabled = 0`).run();
}

// ============================================================================
// Politique désactivée par défaut
// ============================================================================

test('listPolicies — les 5 catégories existent, toutes désactivées et jamais activées par ce module lui-même', () => {
  resetPolicies();
  const policies = RET.listPolicies();
  assert.equal(policies.length, 5);
  assert.ok(policies.every((p) => p.enabled === 0));
});

test('getConfig — purge réelle désactivée par défaut', () => {
  resetPolicies();
  assert.equal(RET.getConfig().real_purge_enabled, 0);
});

// ============================================================================
// Éligibilité — catégorie A (diagnostic abandonné)
// ============================================================================

test('éligibilité A — session jamais complétée à 89 jours : NON éligible', () => {
  resetPolicies();
  enablePolicy('abandoned_diagnostic', { duration_days: 90 });
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { lastActivityDaysAgo: 89 });
  assert.equal(RET.computeSessionEligibility(sessionId), null);
});

test('éligibilité A — session jamais complétée à 90 jours pile : NON éligible (strictement supérieur exigé)', () => {
  resetPolicies();
  enablePolicy('abandoned_diagnostic', { duration_days: 90 });
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { lastActivityDaysAgo: 90 });
  assert.equal(RET.computeSessionEligibility(sessionId), null, 'la durée exacte ne doit pas encore déclencher l’éligibilité, seule une durée STRICTEMENT supérieure le doit');
});

test('éligibilité A — session jamais complétée à 91 jours : éligible', () => {
  resetPolicies();
  enablePolicy('abandoned_diagnostic', { duration_days: 90 });
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { lastActivityDaysAgo: 91 });
  const result = RET.computeSessionEligibility(sessionId);
  assert.ok(result);
  assert.equal(result.category, 'abandoned_diagnostic');
  assert.equal(result.action_planned, 'delete');
});

test('éligibilité A — catégorie désactivée : jamais éligible même très ancienne', () => {
  resetPolicies();
  disablePolicy('abandoned_diagnostic');
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { lastActivityDaysAgo: 999 });
  assert.equal(RET.computeSessionEligibility(sessionId), null);
});

test('éligibilité A — session complétée (même très ancienne, sans recommandation) : jamais catégorie A', () => {
  resetPolicies();
  enablePolicy('abandoned_diagnostic', { duration_days: 90 });
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { status: 'completed', lastActivityDaysAgo: 999, completedDaysAgo: 999 });
  const result = RET.computeSessionEligibility(sessionId);
  assert.ok(!result || result.category !== 'abandoned_diagnostic', 'une session déjà complétée au moins une fois n’est jamais « abandonnée »');
});

test('éligibilité A — dossier actif (activité récente) : non éligible', () => {
  resetPolicies();
  enablePolicy('abandoned_diagnostic', { duration_days: 90 });
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { lastActivityDaysAgo: 1 });
  assert.equal(RET.computeSessionEligibility(sessionId), null);
});

test('éligibilité A — une recommandation existante (même brouillon, jamais validée) exclut l’éligibilité', () => {
  resetPolicies();
  enablePolicy('abandoned_diagnostic', { duration_days: 90 });
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { lastActivityDaysAgo: 200 });
  insertRecommendationFixture(sessionId, { status: 'draft' });
  assert.equal(RET.computeSessionEligibility(sessionId), null, 'un brouillon de recommandation représente un travail humain, jamais purgé silencieusement');
});

// ============================================================================
// Éligibilité — catégorie B (prospect sans mandat), portée foyer
// ============================================================================

// Arithmétique CALENDAIRE exacte (décision humaine du 2026-08-04) : 12 MOIS
// calendaires, jamais 365/366 jours — `now` figé exactement à l'échéance
// calendaire calculée pour rendre la frontière déterministe, indépendamment
// du nombre réel de jours dans les 12 mois concernés (28-31 jours chacun).
test('éligibilité B — 12 mois calendaires pile : NON éligible ; 1 seconde après : éligible', () => {
  resetPolicies();
  enablePolicy('prospect_no_mandate', { duration_days: 365 });
  const reference = '2024-03-15 10:00:00';
  const dueDateMs = Date.UTC(2025, 2, 15, 10, 0, 0); // +12 mois calendaires exacts

  const h1 = buildHousehold();
  insertSessionFixture(h1.householdId, { lastActivityIso: reference });
  assert.equal(RET.computeHouseholdEligibility(h1.householdId, { now: dueDateMs }), null, 'pile à l’échéance : pas encore éligible (strictement supérieur exigé)');

  const h2 = buildHousehold();
  insertSessionFixture(h2.householdId, { lastActivityIso: reference });
  const result = RET.computeHouseholdEligibility(h2.householdId, { now: dueDateMs + 1000 });
  assert.ok(result);
  assert.equal(result.category, 'prospect_no_mandate');
  assert.equal(result.action_planned, 'anonymize');
  assert.equal(result.due_date, '2025-03-15');
});

// Cas limite bissextile : 29 février (année bissextile) + 12 mois calendaires
// exacts doit se caler sur le dernier jour valide du mois cible (28 février,
// l'année suivante n'étant pas bissextile), jamais déborder sur mars.
test('éligibilité B — 29 février (bissextile) + 12 mois : échéance clampée au 28 février suivant', () => {
  resetPolicies();
  enablePolicy('prospect_no_mandate', { duration_days: 365 });
  const reference = '2024-02-29 08:00:00';
  const { householdId } = buildHousehold();
  insertSessionFixture(householdId, { lastActivityIso: reference });

  const justBefore = Date.UTC(2025, 1, 28, 8, 0, 0);
  assert.equal(RET.computeHouseholdEligibility(householdId, { now: justBefore }), null);

  const justAfter = Date.UTC(2025, 1, 28, 8, 0, 1);
  const result = RET.computeHouseholdEligibility(householdId, { now: justAfter });
  assert.ok(result, 'échéance clampée au 28 février 2025 (2025 non bissextile), jamais au 1er ou 3 mars');
  assert.equal(result.due_date, '2025-02-28');
});

test('éligibilité B — contrat actif présent : jamais éligible, même très inactif', () => {
  resetPolicies();
  enablePolicy('prospect_no_mandate', { duration_days: 365 });
  const { householdId, principalClientId } = buildHousehold();
  insertSessionFixture(householdId, { lastActivityDaysAgo: 999 });
  insertContract(principalClientId);
  assert.equal(RET.computeHouseholdEligibility(householdId), null, 'un contrat existant exclut définitivement la catégorie B');
});

test('éligibilité B — un membre du foyer (pas seulement le principal) avec contrat exclut aussi l’éligibilité', () => {
  resetPolicies();
  enablePolicy('prospect_no_mandate', { duration_days: 365 });
  const { householdId } = buildHousehold();
  insertSessionFixture(householdId, { lastActivityDaysAgo: 999 });
  const conjointClientId = insertClient();
  addMember(householdId, { member_role: 'conjoint', client_id: conjointClientId }, REQ);
  insertContract(conjointClientId);
  assert.equal(RET.computeHouseholdEligibility(householdId), null);
});

test('éligibilité B — aucune session dans le foyer : jamais de résultat (rien à purger)', () => {
  resetPolicies();
  enablePolicy('prospect_no_mandate', { duration_days: 365 });
  const { householdId } = buildHousehold();
  assert.equal(RET.computeHouseholdEligibility(householdId), null);
});

// ============================================================================
// Éligibilité — catégorie C (conseil finalisé)
// ============================================================================

test('éligibilité C — conseil finalisé à moins de 10 ans : calcul d’échéance présent, action_planned toujours "retain"', () => {
  resetPolicies();
  enablePolicy('finalized_advice', { duration_days: 3650 });
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { status: 'completed', completedDaysAgo: 100 });
  insertRecommendationFixture(sessionId, { status: 'validated' });
  const result = RET.computeSessionEligibility(sessionId);
  assert.ok(result);
  assert.equal(result.category, 'finalized_advice');
  assert.equal(result.action_planned, 'retain', 'jamais d’action d’effacement automatique sur une preuve de conseil dans cette livraison');
  assert.ok(result.due_date);
});

test('éligibilité C — conseil finalisé arrivé à échéance (> 10 ans) : reason distincte, action_planned reste "retain"', () => {
  resetPolicies();
  enablePolicy('finalized_advice', { duration_days: 3650 });
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { status: 'completed', completedDaysAgo: 3700 });
  insertRecommendationFixture(sessionId, { status: 'validated' });
  const result = RET.computeSessionEligibility(sessionId);
  assert.equal(result.eligibility_reason, 'finalized_advice_due');
  assert.equal(result.action_planned, 'retain', 'jamais purgée automatiquement même après échéance -- décision humaine distincte requise (§7)');
});

test('éligibilité C — session complétée sans recommandation validée : jamais catégorie C', () => {
  resetPolicies();
  enablePolicy('finalized_advice', { duration_days: 3650 });
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { status: 'completed', completedDaysAgo: 100 });
  assert.equal(RET.computeSessionEligibility(sessionId), null);
});

// Arithmétique CALENDAIRE exacte (décision humaine du 2026-08-04) : 10 ANNÉES
// calendaires, jamais 3650 jours — `now` figé exactement à l'échéance
// calendaire pour rendre la frontière déterministe.
test('éligibilité C — 10 années calendaires pile : "within_retention" ; 1 seconde après : "due"', () => {
  resetPolicies();
  enablePolicy('finalized_advice', { duration_days: 3650 });
  const reference = '2015-06-10 09:00:00';
  const dueDateMs = Date.UTC(2025, 5, 10, 9, 0, 0); // +10 années calendaires exactes

  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { status: 'completed', completedIso: reference });
  insertRecommendationFixture(sessionId, { status: 'validated' });

  const atBoundary = RET.computeSessionEligibility(sessionId, { now: dueDateMs });
  assert.equal(atBoundary.eligibility_reason, 'finalized_advice_within_retention', 'pile à l’échéance : pas encore "due" (strictement supérieur exigé)');
  assert.equal(atBoundary.due_date, '2025-06-10');

  const afterBoundary = RET.computeSessionEligibility(sessionId, { now: dueDateMs + 1000 });
  assert.equal(afterBoundary.eligibility_reason, 'finalized_advice_due');
  assert.equal(afterBoundary.action_planned, 'retain', 'jamais purgée automatiquement même après échéance -- décision humaine du 2026-08-04');
});

// Cas limite bissextile : 29 février (année bissextile) + 10 années civiles
// exactes doit se caler sur le 28 février (2030 n'est pas bissextile).
test('éligibilité C — 29 février (bissextile) + 10 ans : échéance clampée au 28 février suivant', () => {
  resetPolicies();
  enablePolicy('finalized_advice', { duration_days: 3650 });
  const reference = '2020-02-29 12:00:00';
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { status: 'completed', completedIso: reference });
  insertRecommendationFixture(sessionId, { status: 'validated' });

  const result = RET.computeSessionEligibility(sessionId, { now: Date.UTC(2030, 0, 1) });
  assert.equal(result.due_date, '2030-02-28', 'échéance clampée au 28 février 2030 (non bissextile), jamais au 1er ou 2 mars');
});

// ============================================================================
// Legal hold
// ============================================================================

test('legal hold — actif : bloque l’éligibilité calculée (legal_hold_blocking=true), motif obligatoire à la création', () => {
  resetPolicies();
  enablePolicy('abandoned_diagnostic', { duration_days: 90 });
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { lastActivityDaysAgo: 200 });

  assert.throws(() => RET.createLegalHold(householdId, {}, REQ), /motif/i);

  const before = auditCount('legal hold posé');
  const hold = RET.createLegalHold(householdId, { reason: 'Litige en cours avec le client.' }, REQ);
  assert.equal(auditCount('legal hold posé'), before + 1);
  assert.equal(hold.active, 1);

  const result = RET.computeSessionEligibility(sessionId);
  assert.ok(result, 'reste éligible du point de vue du calcul...');
  assert.equal(result.legal_hold_blocking, true, '...mais explicitement marqué bloqué par le hold');
});

test('legal hold — un second hold actif est refusé tant que le premier n’est pas levé', () => {
  const { householdId } = buildHousehold();
  RET.createLegalHold(householdId, { reason: 'Premier motif.' }, REQ);
  assert.throws(() => RET.createLegalHold(householdId, { reason: 'Second motif.' }, REQ), (e) => e.status === 409);
});

test('legal hold — levé : n’exclut plus l’éligibilité, motif de levée obligatoire, historique conservé (les deux lignes restent lisibles)', () => {
  resetPolicies();
  enablePolicy('abandoned_diagnostic', { duration_days: 90 });
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { lastActivityDaysAgo: 200 });
  const hold = RET.createLegalHold(householdId, { reason: 'Motif initial.' }, REQ);

  assert.throws(() => RET.liftLegalHold(householdId, hold.id, {}, REQ), /motif/i);

  const before = auditCount('legal hold levé');
  RET.liftLegalHold(householdId, hold.id, { ended_reason: 'Litige résolu.' }, REQ);
  assert.equal(auditCount('legal hold levé'), before + 1);

  assert.equal(RET.isHouseholdOnLegalHold(householdId), false);
  const result = RET.computeSessionEligibility(sessionId);
  assert.equal(result.legal_hold_blocking, false);

  const history = RET.listLegalHolds(householdId);
  assert.equal(history.length, 1, 'la ligne levée reste dans l’historique, jamais supprimée');
  assert.equal(history[0].active, 0);
  assert.equal(history[0].reason, 'Motif initial.', 'le motif d’origine reste immuable après levée');
});

test('legal hold — après levée, un nouveau hold peut être posé (nouvelle ligne, historique complet à 2 lignes)', () => {
  const { householdId } = buildHousehold();
  const first = RET.createLegalHold(householdId, { reason: 'Motif 1.' }, REQ);
  RET.liftLegalHold(householdId, first.id, { ended_reason: 'Résolu.' }, REQ);
  RET.createLegalHold(householdId, { reason: 'Motif 2.' }, REQ);
  const history = RET.listLegalHolds(householdId);
  assert.equal(history.length, 2);
  assert.equal(RET.isHouseholdOnLegalHold(householdId), true);
});

// ============================================================================
// Simulation (dry-run)
// ============================================================================

test('dry-run — n’écrit jamais dans une table de contenu de diagnostic', () => {
  resetPolicies();
  enablePolicy('abandoned_diagnostic', { duration_days: 90 });
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { lastActivityDaysAgo: 200 });
  insertAnswerFixture(sessionId);
  const answersBefore = db.prepare('SELECT COUNT(*) AS n FROM advisory_answers WHERE session_id = ?').get(sessionId).n;
  const sessionBefore = db.prepare('SELECT title FROM advisory_sessions WHERE id = ?').get(sessionId);

  RET.runDryRunSimulation(REQ);

  const answersAfter = db.prepare('SELECT COUNT(*) AS n FROM advisory_answers WHERE session_id = ?').get(sessionId).n;
  const sessionAfter = db.prepare('SELECT title FROM advisory_sessions WHERE id = ?').get(sessionId);
  assert.equal(answersAfter, answersBefore, 'aucune réponse ne doit être modifiée par une simulation');
  assert.deepEqual(sessionAfter, sessionBefore, 'aucune session ne doit être modifiée par une simulation');
});

// Base de test partagée sur tout le fichier (même convention que les autres
// suites `test/advisory-*.test.js`) : les totaux GLOBAUX d'un run
// s'accumulent avec les fixtures des tests précédents -- comparaison en
// DELTA (avant/après), jamais une valeur absolue, même principe que
// `auditCount` utilisé partout ailleurs dans ce dépôt.
test('dry-run — comptages corrects (total scanné, total éligible, total exclu par legal hold)', () => {
  resetPolicies();
  enablePolicy('abandoned_diagnostic', { duration_days: 90 });
  const baseline = RET.runDryRunSimulation(REQ);

  const h1 = buildHousehold();
  insertSessionFixture(h1.householdId, { lastActivityDaysAgo: 200 }); // éligible
  const h2 = buildHousehold();
  insertSessionFixture(h2.householdId, { lastActivityDaysAgo: 200 }); // éligible mais hold
  RET.createLegalHold(h2.householdId, { reason: 'Motif.' }, REQ);
  const h3 = buildHousehold();
  insertSessionFixture(h3.householdId, { lastActivityDaysAgo: 1 }); // non éligible

  const run = RET.runDryRunSimulation(REQ);
  assert.equal(run.total_dossiers_scanned - baseline.total_dossiers_scanned, 3);
  assert.equal(run.total_eligible - baseline.total_eligible, 2, 'le hold ne retire pas le dossier du compte "éligible", seulement de l’exécution');
  assert.equal(run.total_legal_hold_excluded - baseline.total_legal_hold_excluded, 1);
});

test('dry-run — aucune valeur sensible dans le rapport (ni valeur de réponse, ni titre de session, ni nom complet)', () => {
  resetPolicies();
  enablePolicy('abandoned_diagnostic', { duration_days: 90 });
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { lastActivityDaysAgo: 200, title: 'Rendez-vous confidentiel Dupont diabète' });
  insertAnswerFixture(sessionId);

  const run = RET.runDryRunSimulation(REQ);
  const serialized = JSON.stringify(run);
  assert.ok(!serialized.includes('confidentiel'), 'jamais le titre de la session dans le rapport');
  assert.ok(!serialized.includes('Dupont'), 'jamais un nom dans le rapport');
  assert.ok(!serialized.includes('diabète'), 'jamais un terme médical dans le rapport');
  for (const item of run.items) {
    assert.deepEqual(Object.keys(item).sort(), [
      'action_planned', 'category', 'created_at', 'due_date', 'eligibility_reason', 'executed',
      'household_id', 'id', 'legal_hold_blocking', 'purge_run_id', 'rows_affected_summary', 'session_id',
    ].sort(), 'surface strictement limitée à des identifiants/compteurs/énumérations');
    assert.equal(typeof item.rows_affected_summary, 'object');
    for (const v of Object.values(item.rows_affected_summary)) assert.equal(typeof v, 'number', 'uniquement des compteurs, jamais une valeur');
  }
});

test('dry-run — déterminisme : deux simulations sur un état inchangé produisent le même ensemble de dossiers éligibles', () => {
  resetPolicies();
  enablePolicy('abandoned_diagnostic', { duration_days: 90 });
  const { householdId } = buildHousehold();
  insertSessionFixture(householdId, { lastActivityDaysAgo: 200 });

  const fixedNow = Date.now();
  const run1 = RET.runDryRunSimulation(REQ, { now: fixedNow });
  const run2 = RET.runDryRunSimulation(REQ, { now: fixedNow });
  const project = (run) => run.items.map((i) => ({ session_id: i.session_id, category: i.category, action_planned: i.action_planned }));
  assert.deepEqual(project(run1), project(run2));
});

test('dry-run — idempotence opérationnelle : relancer plusieurs fois ne corrompt rien et reste rejouable sans effet de bord sur le contenu', () => {
  resetPolicies();
  enablePolicy('abandoned_diagnostic', { duration_days: 90 });
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { lastActivityDaysAgo: 200 });
  const before = RET.listPurgeRuns({ run_type: 'dry_run' }).length;
  for (let i = 0; i < 3; i += 1) RET.runDryRunSimulation(REQ);
  const runs = RET.listPurgeRuns({ run_type: 'dry_run' });
  assert.equal(runs.length, before + 3, 'chaque appel produit son propre run, jamais fusionné ni écrasé');
  const session = db.prepare('SELECT * FROM advisory_sessions WHERE id = ?').get(sessionId);
  assert.ok(session, 'la session existe toujours, inchangée par 3 simulations successives');
});

// ============================================================================
// Purge réelle (base temporaire UNIQUEMENT, mode explicitement autorisé)
// ============================================================================

function authorizeForTest() {
  db.prepare('UPDATE advisory_retention_config SET real_purge_enabled = 1 WHERE id = 1').run();
  RET.runDryRunSimulation(REQ);
  return { confirmed: true, backupVerifiedAt: new Date().toISOString() };
}

test('executePurge — refusé si configuration globale désactivée', () => {
  resetPolicies();
  assert.throws(() => RET.executePurge(REQ, { confirmed: true, backupVerifiedAt: new Date().toISOString() }), /désactivée/i);
});

test('executePurge — refusé sans confirmation explicite', () => {
  resetPolicies();
  db.prepare('UPDATE advisory_retention_config SET real_purge_enabled = 1 WHERE id = 1').run();
  RET.runDryRunSimulation(REQ);
  assert.throws(() => RET.executePurge(REQ, { backupVerifiedAt: new Date().toISOString() }), /confirmation/i);
});

test('executePurge — refusé sans rapport dry-run existant', () => {
  resetPolicies();
  db.prepare('UPDATE advisory_retention_config SET real_purge_enabled = 1 WHERE id = 1').run();
  // Vide l'historique des runs précédents pour ce test précis.
  db.prepare('DELETE FROM advisory_retention_purge_run_items').run();
  db.prepare('DELETE FROM advisory_retention_purge_runs').run();
  assert.throws(() => RET.executePurge(REQ, { confirmed: true, backupVerifiedAt: new Date().toISOString() }), /dry-run/i);
});

test('executePurge — refusé sans sauvegarde vérifiée', () => {
  resetPolicies();
  db.prepare('UPDATE advisory_retention_config SET real_purge_enabled = 1 WHERE id = 1').run();
  RET.runDryRunSimulation(REQ);
  assert.throws(() => RET.executePurge(REQ, { confirmed: true }), /sauvegarde/i);
});

test('executePurge — catégorie A : réponses/findings/exécutions supprimées, session conservée mais anonymisée (titre/snapshot vidés), audit créé', () => {
  resetPolicies();
  enablePolicy('abandoned_diagnostic', { duration_days: 90 });
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { lastActivityDaysAgo: 200, title: 'Rendez-vous confidentiel' });
  db.prepare(`UPDATE advisory_sessions SET household_snapshot = '{"members":[]}' WHERE id = ?`).run(sessionId);
  insertAnswerFixture(sessionId);

  const opts = authorizeForTest();
  const before = auditCount('diagnostic purgé (rétention)');
  const result = RET.executePurge(REQ, opts);
  assert.ok(auditCount('diagnostic purgé (rétention)') > before, 'au moins un audit de purge doit avoir été émis');
  const ownItem = result.items.find((i) => i.session_id === sessionId);
  assert.ok(ownItem, 'la session de ce test doit apparaître dans le run');
  assert.equal(ownItem.executed, 1);

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM advisory_answers WHERE session_id = ?').get(sessionId).n, 0, 'les réponses sensibles doivent être supprimées');
  const session = db.prepare('SELECT title, household_snapshot FROM advisory_sessions WHERE id = ?').get(sessionId);
  assert.equal(session.title, null, 'le titre (potentiellement identifiant) doit être vidé');
  assert.equal(session.household_snapshot, null);
  assert.ok(db.prepare('SELECT 1 FROM advisory_sessions WHERE id = ?').get(sessionId), 'la ligne session elle-même reste (trace technique minimale), jamais supprimée');
});

test('executePurge — respecte le legal hold : aucune ligne effacée pour un foyer sous hold, même explicitement éligible', () => {
  resetPolicies();
  enablePolicy('abandoned_diagnostic', { duration_days: 90 });
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { lastActivityDaysAgo: 200 });
  insertAnswerFixture(sessionId);
  RET.createLegalHold(householdId, { reason: 'Motif.' }, REQ);

  const opts = authorizeForTest();
  const result = RET.executePurge(REQ, opts);
  const ownItem = result.items.find((i) => i.session_id === sessionId);
  assert.ok(!ownItem, 'un dossier bloqué par un legal hold ne doit jamais apparaître comme "executed" -- aucune ligne d’exécution le concernant');
  assert.ok(result.total_legal_hold_excluded >= 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM advisory_answers WHERE session_id = ?').get(sessionId).n, 1, 'les réponses doivent rester intactes tant que le hold est actif');
});

test('executePurge — jamais de suppression sur un contrat ou une commission', () => {
  resetPolicies();
  enablePolicy('prospect_no_mandate', { duration_days: 365 });
  const { householdId, principalClientId } = buildHousehold();
  insertSessionFixture(householdId, { lastActivityDaysAgo: 999 });
  // Un contrat existe -> exclut la catégorie B, mais on vérifie ici surtout
  // qu'AUCUN code de purge ne touche jamais contracts/commissions, y compris
  // indirectement -- au cas où l'éligibilité changerait de logique un jour.
  const contractId = insertContract(principalClientId);
  db.prepare("INSERT INTO commissions (contract_id, type, expected_amount_chf, status) VALUES (?, 'acquisition', 500, 'expected')").run(contractId);
  const contractsBefore = db.prepare('SELECT COUNT(*) AS n FROM contracts').get().n;
  const commissionsBefore = db.prepare('SELECT COUNT(*) AS n FROM commissions').get().n;

  const opts = authorizeForTest();
  RET.executePurge(REQ, opts);

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contracts').get().n, contractsBefore);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commissions').get().n, commissionsBefore);
});

test('executePurge — une recommandation nécessaire à la preuve d’un conseil (catégorie C) n’est jamais supprimée ni modifiée, même après échéance', () => {
  resetPolicies();
  enablePolicy('finalized_advice', { duration_days: 3650 });
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { status: 'completed', completedDaysAgo: 4000 });
  const recId = insertRecommendationFixture(sessionId, { status: 'validated' });
  const recBefore = db.prepare('SELECT * FROM advisory_recommendations WHERE id = ?').get(recId);

  const opts = authorizeForTest();
  const result = RET.executePurge(REQ, opts);
  assert.equal(result.items.filter((i) => i.category === 'finalized_advice' && i.executed === 1).length, 0, 'catégorie finalized_advice jamais exécutée par ce moteur');

  const recAfter = db.prepare('SELECT * FROM advisory_recommendations WHERE id = ?').get(recId);
  assert.deepEqual(recAfter, recBefore, 'ligne intégralement inchangée');
});

test('executePurge — transaction complète : en cas d’erreur au milieu (contrainte FK violée par un état incohérent), aucune ligne n’est effacée et le run est marqué "failed"', () => {
  resetPolicies();
  enablePolicy('abandoned_diagnostic', { duration_days: 90 });
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { lastActivityDaysAgo: 200 });
  insertAnswerFixture(sessionId);

  // Construit un finding rattaché à la session éligible, puis simule un état
  // incohérent (normalement inatteignable via le service, l'éligibilité
  // exigeant zéro recommandation) : une ligne advisory_recommendation_findings
  // pointant encore vers ce finding, SANS colonne ON DELETE CASCADE côté
  // finding_id. Supprimer advisory_findings pour cette session doit alors
  // échouer avec une violation de contrainte FK réelle -- preuve empirique
  // du rollback complet, jamais un échec simulé artificiellement.
  const ruleSetId = db.prepare("INSERT INTO advisory_rule_sets (stable_key, domain, version_number, status, name) VALUES ('rs-ret-fk', 'health', 1, 'published', 'X')").run().lastInsertRowid;
  const ruleId = db.prepare(`
    INSERT INTO advisory_rules (rule_set_id, stable_key, domain, title, conditions, required_data, result_finding_type, advisor_explanation, sort_order)
    VALUES (?, 'regle-ret-fk', 'health', 'T', '{}', '[]', 'warning', 'E', 1)
  `).run(ruleSetId).lastInsertRowid;
  const executionId = db.prepare(`
    INSERT INTO advisory_rule_executions (session_id, session_revision, domain, rule_set_id, rule_set_version_number, content_hash, engine_version)
    VALUES (?, 1, 'health', ?, 1, 'h', '1')
  `).run(sessionId, ruleSetId).lastInsertRowid;
  const findingId = db.prepare(`
    INSERT INTO advisory_findings (rule_execution_id, session_id, rule_id, stable_key, domain, finding_type, priority, title, summary, advisor_explanation, sort_order)
    VALUES (?, ?, ?, 'regle-ret-fk', 'health', 'warning', 'medium', 'T', 'S', 'E', 1)
  `).run(executionId, sessionId, ruleId).lastInsertRowid;
  // Recommandation ORPHELINE créée hors du service (bypass volontaire de
  // l'invariant applicatif) pour fabriquer précisément l'état incohérent
  // décrit ci-dessus, sans jamais passer par sessionHasAnyRecommendation.
  const otherSessionId = insertSessionFixture(buildHousehold().householdId, { status: 'completed', completedDaysAgo: 1 });
  const orphanRecId = db.prepare(`
    INSERT INTO advisory_recommendations (session_id, domain, scope, status, title, advisor_rationale, created_by_user_id)
    VALUES (?, 'health', 'household', 'draft', 'T', 'R', ?)
  `).run(otherSessionId, advisorUserId).lastInsertRowid;
  db.prepare('INSERT INTO advisory_recommendation_findings (recommendation_id, finding_id, created_by_user_id) VALUES (?, ?, ?)').run(orphanRecId, findingId, advisorUserId);

  const opts = authorizeForTest();
  assert.throws(() => RET.executePurge(REQ, opts), /FOREIGN KEY|CONSTRAINT/i);

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM advisory_answers WHERE session_id = ?').get(sessionId).n, 1, 'rollback complet : la réponse légitime doit rester intacte après un échec');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM advisory_findings WHERE id = ?').get(findingId).n, 1, 'le finding doit lui aussi rester intact');
  const failedRun = db.prepare("SELECT * FROM advisory_retention_purge_runs WHERE status = 'failed' ORDER BY id DESC LIMIT 1").get();
  assert.ok(failedRun, 'un run "failed" doit être journalisé après l’échec');
  assert.ok(failedRun.error_message);

  // Nettoyage délibéré : l'état incohérent construit ci-dessus (FK bloquante)
  // doit rester permanent pour NE PLUS JAMAIS être retenté par un test
  // ultérieur du même fichier (base partagée) -- un legal hold, jamais levé,
  // exclut ce foyer de tout calcul d'éligibilité pour le reste de la suite.
  RET.createLegalHold(householdId, { reason: 'Test technique — état volontairement incohérent, jamais à retraiter.' }, REQ);
});

test('executePurge — clés étrangères valides après purge (PRAGMA foreign_key_check)', () => {
  resetPolicies();
  enablePolicy('abandoned_diagnostic', { duration_days: 90 });
  const { householdId } = buildHousehold();
  const sessionId = insertSessionFixture(householdId, { lastActivityDaysAgo: 200 });
  insertAnswerFixture(sessionId);
  const opts = authorizeForTest();
  RET.executePurge(REQ, opts);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
});

// ============================================================================
// Sauvegardes
// ============================================================================

test('sauvegardes — aucune ligne .gitignore concernée par ce lot n’est requise ici (vérifié au niveau contrôles finaux du dépôt), verifyRecentBackupExists n’écrit jamais de fichier', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-retention-backup-check-'));
  const before = fs.readdirSync(dir);
  const result = RET.verifyRecentBackupExists({ dir });
  assert.equal(result.verified, false);
  assert.equal(result.reason, 'no_backup_found');
  assert.deepEqual(fs.readdirSync(dir), before, 'la vérification ne doit jamais créer ni modifier de fichier');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sauvegardes — une sauvegarde récente est détectée comme vérifiée, une trop ancienne est refusée', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-retention-backup-check-'));
  fs.writeFileSync(path.join(dir, 'sauvegarde-2020-01-01-123.sqlite'), 'x');
  const oldTime = new Date(Date.now() - 48 * 3_600_000);
  fs.utimesSync(path.join(dir, 'sauvegarde-2020-01-01-123.sqlite'), oldTime, oldTime);
  const resultOld = RET.verifyRecentBackupExists({ dir, maxAgeHours: 24 });
  assert.equal(resultOld.verified, false);
  assert.equal(resultOld.reason, 'backup_too_old');

  fs.writeFileSync(path.join(dir, 'sauvegarde-2026-01-01-456.sqlite'), 'x');
  const resultFresh = RET.verifyRecentBackupExists({ dir, maxAgeHours: 24 });
  assert.equal(resultFresh.verified, true);
  fs.rmSync(dir, { recursive: true, force: true });
});
