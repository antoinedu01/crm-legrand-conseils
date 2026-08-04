// Service métier — contrôles de conservation, d'anonymisation et
// d'effacement des données de diagnostic (Legrand Diagnostic 360, chantier
// préalable à l'activation, cf. `docs/advisory/DATA_RETENTION.md`).
//
// TOUTE la politique reste DÉSACTIVÉE PAR DÉFAUT (migration 14,
// `advisory_retention_policies.enabled = 0` pour les 5 catégories,
// `advisory_retention_config.real_purge_enabled = 0`). Ce module implémente
// intégralement le moteur de simulation (dry-run, seul mode atteignable
// depuis une route dans cette livraison) et le moteur d'exécution RÉELLE
// (`executePurge`), gardé par un cumul de conditions explicites
// (`assertPurgeAuthorized`) -- mais `executePurge` n'est appelé PAR AUCUNE
// route HTTP de ce lot : il n'est exercé que par les tests dédiés
// (`test/advisory-retention.test.js`), sur des bases temporaires isolées
// uniquement. Aucune tâche automatique, aucun cron, aucun scheduler.
//
// Isolé de `server/routes/advisoryRetention.js` (adaptateur HTTP fin), même
// convention que les autres modules `server/advisoryXxx.js` (cf. revue
// advisory-architect, déjà actée pour advisoryHouseholds.js/advisorySessions.js).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { assert, inEnum, checkTextFields } from './validate.js';
import { audit } from './audit.js';
import { AdvisoryError } from './advisoryHouseholds.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.CRM_DATA_DIR || path.join(__dirname, '..', 'data');

export const RETENTION_CATEGORIES = ['abandoned_diagnostic', 'prospect_no_mandate', 'finalized_advice', 'audit_log', 'backups'];
// Seules ces trois catégories sont effectivement évaluées par le moteur
// d'éligibilité et candidates à une action de purge -- 'audit_log' et
// 'backups' restent des paramètres déclaratifs (durées affichées pour la
// transparence nLPD), jamais des cibles d'effacement de ce module (voir
// docs/advisory/DATA_RETENTION.md §D/§E : supprimer des lignes audit_log
// minerait la traçabilité elle-même ; les sauvegardes sont gérées hors de
// cette application, jamais touchées par du code applicatif).
export const ACTIONABLE_CATEGORIES = ['abandoned_diagnostic', 'prospect_no_mandate', 'finalized_advice'];
export const PURGE_ACTIONS = ['delete', 'anonymize', 'retain'];
export const RUN_TYPES = ['dry_run', 'purge'];

const DAY_MS = 86_400_000;

function currentUserId(req) {
  const email = req?.session?.userEmail;
  return email ? db.prepare('SELECT id FROM users WHERE email = ?').get(email)?.id || null : null;
}

function requireHousehold(householdId) {
  const row = db.prepare('SELECT * FROM households WHERE id = ?').get(householdId);
  if (!row) throw new AdvisoryError('Foyer introuvable.', 404);
  return row;
}

function requireSession(sessionId) {
  const row = db.prepare('SELECT * FROM advisory_sessions WHERE id = ?').get(sessionId);
  if (!row) throw new AdvisoryError('Session introuvable.', 404);
  return row;
}

// Granularité JOUR ENTIER (floor), jamais une fraction de jour -- une
// politique exprimée « 90 jours » ne doit jamais basculer selon le nombre
// de millisecondes écoulées PENDANT le calcul lui-même (temps de traitement
// entre la construction de la référence et l'appel effectif), seulement
// selon des journées entières réellement révolues.
function daysBetween(fromIso, toMs) {
  if (!fromIso) return null;
  const fromMs = new Date(fromIso.replace(' ', 'T') + (fromIso.endsWith('Z') ? '' : 'Z')).getTime();
  if (Number.isNaN(fromMs)) return null;
  return Math.floor((toMs - fromMs) / DAY_MS);
}

function addDaysIso(fromIso, days) {
  if (!fromIso) return null;
  const fromMs = new Date(fromIso.replace(' ', 'T') + (fromIso.endsWith('Z') ? '' : 'Z')).getTime();
  if (Number.isNaN(fromMs)) return null;
  return new Date(fromMs + days * DAY_MS).toISOString().slice(0, 10);
}

// --- Politiques / configuration --------------------------------------------

export function listPolicies() {
  return db.prepare('SELECT * FROM advisory_retention_policies ORDER BY category').all();
}

function policyByCategory() {
  const rows = listPolicies();
  return Object.fromEntries(rows.map((r) => [r.category, r]));
}

export function getConfig() {
  return db.prepare('SELECT * FROM advisory_retention_config WHERE id = 1').get();
}

// --- Legal hold --------------------------------------------------------------
// Un hold bloque INCONDITIONNELLEMENT toute action de purge pour le foyer
// concerné, quelle que soit la catégorie ou l'échéance calculée -- vérifié
// systématiquement par computeSessionEligibility/computeHouseholdEligibility
// ci-dessous, jamais seulement à l'exécution finale (défense en profondeur).

export function isHouseholdOnLegalHold(householdId) {
  return !!db.prepare('SELECT 1 FROM advisory_retention_legal_holds WHERE household_id = ? AND active = 1').get(householdId);
}

export function getActiveLegalHold(householdId) {
  return db.prepare('SELECT * FROM advisory_retention_legal_holds WHERE household_id = ? AND active = 1').get(householdId) || null;
}

export function listLegalHolds(householdId) {
  requireHousehold(householdId);
  return db.prepare('SELECT * FROM advisory_retention_legal_holds WHERE household_id = ? ORDER BY id DESC').all(householdId);
}

// Motif obligatoire (§3) -- jamais d'activation automatique : toujours un
// appel explicite d'un utilisateur authentifié (requireAuth, couche route).
export function createLegalHold(householdId, { reason } = {}, req) {
  requireHousehold(householdId);
  assert(reason && reason.trim(), 'Le motif du legal hold est obligatoire.');
  checkTextFields({ reason }, ['reason'], 2000);
  if (isHouseholdOnLegalHold(householdId)) {
    throw new AdvisoryError('Un legal hold est déjà actif pour ce foyer — levez-le explicitement avant d’en poser un nouveau.', 409);
  }
  const userId = currentUserId(req);
  const info = db
    .prepare('INSERT INTO advisory_retention_legal_holds (household_id, active, reason, created_by_user_id) VALUES (?, 1, ?, ?)')
    .run(householdId, reason.trim(), userId);
  audit(req, 'legal hold posé', 'household', householdId, `hold #${info.lastInsertRowid}`);
  return db.prepare('SELECT * FROM advisory_retention_legal_holds WHERE id = ?').get(info.lastInsertRowid);
}

// Ligne JAMAIS réécrite en place au-delà de sa levée : origine (motif/
// auteur/date) immuable, même convention que household_members/
// advisory_answers -- réactiver un hold après levée insère une NOUVELLE
// ligne (createLegalHold ci-dessus), jamais une réutilisation.
export function liftLegalHold(householdId, holdId, { ended_reason } = {}, req) {
  requireHousehold(householdId);
  assert(ended_reason && ended_reason.trim(), 'Le motif de levée est obligatoire.');
  checkTextFields({ ended_reason }, ['ended_reason'], 2000);
  const hold = db.prepare('SELECT * FROM advisory_retention_legal_holds WHERE id = ? AND household_id = ?').get(holdId, householdId);
  if (!hold) throw new AdvisoryError('Legal hold introuvable pour ce foyer.', 404);
  if (!hold.active) throw new AdvisoryError('Ce legal hold est déjà levé.', 409);
  const userId = currentUserId(req);
  db.prepare(
    "UPDATE advisory_retention_legal_holds SET active = 0, ended_by_user_id = ?, ended_at = datetime('now'), ended_reason = ? WHERE id = ?"
  ).run(userId, ended_reason.trim(), holdId);
  audit(req, 'legal hold levé', 'household', householdId, `hold #${holdId}`);
  return db.prepare('SELECT * FROM advisory_retention_legal_holds WHERE id = ?').get(holdId);
}

// --- Éligibilité (dérivée à la lecture, jamais stockée -- même principe que
// `potentially_stale`/`validateSessionForCompletion` ailleurs dans ce
// module) ------------------------------------------------------------------

// Compte, PAR TABLE, les lignes qu'une purge affecterait pour une session
// donnée -- jamais une valeur, uniquement des compteurs (structure exigée
// par le rapport dry-run, §5).
function rowsAffectedSummary(sessionId) {
  const answers = db.prepare('SELECT COUNT(*) AS n FROM advisory_answers WHERE session_id = ?').get(sessionId).n;
  const executions = db.prepare('SELECT COUNT(*) AS n FROM advisory_rule_executions WHERE session_id = ?').get(sessionId).n;
  const findings = db.prepare('SELECT COUNT(*) AS n FROM advisory_findings WHERE session_id = ?').get(sessionId).n;
  const recommendations = db.prepare('SELECT COUNT(*) AS n FROM advisory_recommendations WHERE session_id = ?').get(sessionId).n;
  return { advisory_answers: answers, advisory_rule_executions: executions, advisory_findings: findings, advisory_recommendations: recommendations };
}

function householdHasAnyContract(householdId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM contracts c
       JOIN household_members hm ON hm.client_id = c.client_id
       WHERE hm.household_id = ?`
    )
    .get(householdId);
  return row.n > 0;
}

function sessionHasAnyRecommendation(sessionId) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM advisory_recommendations WHERE session_id = ?').get(sessionId);
  return row.n > 0;
}

function sessionHasValidatedRecommendation(sessionId) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM advisory_recommendations WHERE session_id = ? AND status IN ('validated', 'superseded', 'withdrawn')").get(sessionId);
  return row.n > 0;
}

// Catégorie A -- Diagnostic abandonné (§2.A) : session jamais complétée
// (`completed_at IS NULL` -- PAS `status != 'completed'`, qui redeviendrait
// vrai après une réouverture par amendement, correctif d'intégrité de la
// complétude de session ; une session déjà complétée au moins une fois
// n'est jamais « abandonnée » au sens de cette catégorie), aucune
// recommandation (brouillon inclus -- un brouillon de conseiller en cours
// représente un travail humain, jamais silencieusement détruit par une
// purge automatisée : restriction volontairement plus stricte que le seul
// « aucune recommandation VALIDÉE » du cadrage, voir DATA_RETENTION.md),
// dernière activité au-delà de la durée configurée.
function computeAbandonedEligibility(session, policy, nowMs) {
  if (!policy || !policy.enabled) return null;
  if (session.completed_at) return null;
  if (sessionHasAnyRecommendation(session.id)) return null;
  const referenceDate = session.last_activity_at || session.created_at;
  const days = daysBetween(referenceDate, nowMs);
  if (days == null || days <= policy.duration_days) return null;
  return {
    category: 'abandoned_diagnostic',
    eligibility_reason: 'session_never_completed_inactive',
    due_date: addDaysIso(referenceDate, policy.duration_days),
    action_planned: 'delete',
  };
}

// Catégorie C -- Conseil finalisé (§2.C) : session complétée ET au moins une
// recommandation validée (au sens large : validated/superseded/withdrawn --
// toutes ont existé comme preuve d'un conseil réellement délivré, jamais
// seulement 'validated' au sens strict). Échéance calculée depuis
// `completed_at` (proxy documenté : ce schéma ne porte aujourd'hui aucune
// date dédiée de « clôture du mandat » -- limite explicitement signalée,
// voir DATA_RETENTION.md et le rapport final de ce lot). action_planned
// reste TOUJOURS 'retain' dans cette livraison, même après échéance : ce
// module calcule et affiche l'échéance pour la transparence du dry-run,
// mais n'implémente délibérément AUCUNE action d'effacement/anonymisation
// automatique sur une recommandation nécessaire à la preuve d'un conseil
// (§7, interdiction explicite) -- décision humaine distincte requise avant
// toute activation d'une action réelle sur cette catégorie.
function computeFinalizedEligibility(session, policy, nowMs) {
  if (!policy || !policy.enabled) return null;
  if (!session.completed_at) return null;
  if (!sessionHasValidatedRecommendation(session.id)) return null;
  const days = daysBetween(session.completed_at, nowMs);
  if (days == null) return null;
  return {
    category: 'finalized_advice',
    eligibility_reason: days > policy.duration_days ? 'finalized_advice_due' : 'finalized_advice_within_retention',
    due_date: addDaysIso(session.completed_at, policy.duration_days),
    action_planned: 'retain',
  };
}

// Calcule l'éligibilité d'UNE session (catégories A et C -- portée
// session). La catégorie B (portée foyer) est calculée séparément par
// `computeHouseholdEligibility` ci-dessous, appelée une fois par foyer.
export function computeSessionEligibility(sessionId, { now = Date.now() } = {}) {
  const session = requireSession(sessionId);
  const policies = policyByCategory();
  const legalHold = isHouseholdOnLegalHold(session.household_id);

  const abandoned = computeAbandonedEligibility(session, policies.abandoned_diagnostic, now);
  const finalized = !abandoned ? computeFinalizedEligibility(session, policies.finalized_advice, now) : null;
  const result = abandoned || finalized;
  if (!result) return null;
  return { ...result, session_id: sessionId, household_id: session.household_id, legal_hold_blocking: legalHold };
}

// Catégorie B -- Prospect sans mandat ni contrat (§2.B) : portée FOYER,
// jamais session -- aucun contrat pour aucun membre du foyer, aucune
// recommandation (toutes sessions confondues, brouillon inclus, même
// restriction volontairement stricte que la catégorie A), dernière
// activité (max sur toutes les sessions du foyer) au-delà de la durée
// configurée. N'émet un résultat QUE si le foyer a au moins une session
// (sans session, il n'y a aucune donnée de diagnostic à purger -- rien à
// simuler).
export function computeHouseholdEligibility(householdId, { now = Date.now() } = {}) {
  requireHousehold(householdId);
  const policy = policyByCategory().prospect_no_mandate;
  if (!policy || !policy.enabled) return null;
  if (householdHasAnyContract(householdId)) return null;

  const sessions = db.prepare('SELECT id, last_activity_at, created_at FROM advisory_sessions WHERE household_id = ?').all(householdId);
  if (sessions.length === 0) return null;
  if (sessions.some((s) => sessionHasAnyRecommendation(s.id))) return null;

  const references = sessions.map((s) => s.last_activity_at || s.created_at).filter(Boolean);
  if (references.length === 0) return null;
  const mostRecentIso = references.reduce((a, b) => (a > b ? a : b));
  const days = daysBetween(mostRecentIso, now);
  if (days == null || days <= policy.duration_days) return null;

  return {
    category: 'prospect_no_mandate',
    eligibility_reason: 'prospect_no_contract_inactive',
    due_date: addDaysIso(mostRecentIso, policy.duration_days),
    action_planned: 'anonymize',
    household_id: householdId,
    session_ids: sessions.map((s) => s.id),
    legal_hold_blocking: isHouseholdOnLegalHold(householdId),
  };
}

// --- Simulation (dry-run) ----------------------------------------------------
// Mode par défaut et SEUL mode atteignable depuis une route de ce lot.
// N'écrit jamais dans une table de contenu de diagnostic -- uniquement dans
// advisory_retention_purge_runs/_items (ses propres tables de rapport).
// Déterministe (même horodatage `now` figé une seule fois pour tout le run,
// jamais recalculé ligne par ligne) et rejouable sans effet de bord
// (idempotent au sens : deux exécutions successives sur un état inchangé
// produisent le même ensemble de résultats, chacune dans son propre
// nouveau run -- jamais une mutation de contenu).
export function runDryRunSimulation(req, { now = Date.now() } = {}) {
  const userId = currentUserId(req);
  const runInfo = db
    .prepare("INSERT INTO advisory_retention_purge_runs (run_type, status, executed_by_user_id) VALUES ('dry_run', 'running', ?)")
    .run(userId);
  const runId = runInfo.lastInsertRowid;

  const items = [];
  const householdIds = db.prepare('SELECT id FROM households').all().map((r) => r.id);
  let scanned = 0;
  for (const householdId of householdIds) {
    const sessions = db.prepare('SELECT id FROM advisory_sessions WHERE household_id = ?').all(householdId);
    scanned += sessions.length;

    const householdResult = computeHouseholdEligibility(householdId, { now });
    if (householdResult) {
      for (const sessionId of householdResult.session_ids) {
        items.push({
          household_id: householdId, session_id: sessionId, category: householdResult.category,
          eligibility_reason: householdResult.eligibility_reason, due_date: householdResult.due_date,
          legal_hold_blocking: householdResult.legal_hold_blocking, action_planned: householdResult.action_planned,
        });
      }
      continue; // catégorie B déjà tranchée pour tout le foyer -- pas de double-classement A/C sur les mêmes sessions
    }

    for (const { id: sessionId } of sessions) {
      const result = computeSessionEligibility(sessionId, { now });
      if (result) {
        items.push({
          household_id: householdId, session_id: sessionId, category: result.category,
          eligibility_reason: result.eligibility_reason, due_date: result.due_date,
          legal_hold_blocking: result.legal_hold_blocking, action_planned: result.action_planned,
        });
      }
    }
  }

  const insertItem = db.prepare(`
    INSERT INTO advisory_retention_purge_run_items
      (purge_run_id, household_id, session_id, category, eligibility_reason, due_date, legal_hold_blocking, action_planned, rows_affected_summary, executed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);
  const write = db.transaction(() => {
    for (const item of items) {
      insertItem.run(
        runId, item.household_id, item.session_id, item.category, item.eligibility_reason, item.due_date,
        item.legal_hold_blocking ? 1 : 0, item.action_planned, JSON.stringify(rowsAffectedSummary(item.session_id))
      );
    }
    const legalHoldExcluded = items.filter((i) => i.legal_hold_blocking).length;
    db.prepare(
      "UPDATE advisory_retention_purge_runs SET status = 'completed', ended_at = datetime('now'), total_dossiers_scanned = ?, total_eligible = ?, total_legal_hold_excluded = ? WHERE id = ?"
    ).run(scanned, items.length, legalHoldExcluded, runId);
  });
  write();

  audit(req, 'simulation de rétention exécutée (dry-run)', 'advisory_retention_purge_run', runId, `${items.length} dossier(s) éligible(s) sur ${scanned} scanné(s)`);
  return getPurgeRunDetail(runId);
}

export function getPurgeRunDetail(runId) {
  const run = db.prepare('SELECT * FROM advisory_retention_purge_runs WHERE id = ?').get(runId);
  if (!run) throw new AdvisoryError('Exécution introuvable.', 404);
  const items = db.prepare('SELECT * FROM advisory_retention_purge_run_items WHERE purge_run_id = ? ORDER BY id').all(runId).map((i) => ({
    ...i, rows_affected_summary: i.rows_affected_summary ? JSON.parse(i.rows_affected_summary) : null,
  }));
  return { ...run, items };
}

export function listPurgeRuns({ run_type } = {}) {
  if (run_type) assert(inEnum(run_type, RUN_TYPES), 'Type d’exécution inconnu.');
  return db
    .prepare('SELECT * FROM advisory_retention_purge_runs WHERE (? IS NULL OR run_type = ?) ORDER BY id DESC')
    .all(run_type || null, run_type || null);
}

// --- Purge réelle (gardée, jamais atteignable par une route de ce lot) -----
// Cumul de conditions explicites (§6) -- refuse dès la première condition
// non remplie, jamais une exécution partielle. Utilisée EXCLUSIVEMENT par
// les tests dédiés (test/advisory-retention.test.js), toujours sur une base
// temporaire isolée (CRM_DATA_DIR).

function assertPurgeAuthorized(req, { confirmed, recentDryRunMaxAgeHours = 24, backupVerifiedAt, confirmProductionTarget } = {}) {
  const config = getConfig();
  assert(config.real_purge_enabled, 'Purge réelle refusée : configuration globale désactivée (advisory_retention_config.real_purge_enabled = 0).');

  const userId = currentUserId(req);
  assert(userId, 'Purge réelle refusée : utilisateur non authentifié ou introuvable.');

  assert(confirmed === true, 'Purge réelle refusée : confirmation explicite absente.');

  const recentDryRun = db
    .prepare("SELECT * FROM advisory_retention_purge_runs WHERE run_type = 'dry_run' AND status = 'completed' ORDER BY id DESC LIMIT 1")
    .get();
  assert(recentDryRun, 'Purge réelle refusée : aucun rapport dry-run existant.');
  const dryRunAgeHours = (Date.now() - new Date(recentDryRun.ended_at.replace(' ', 'T') + 'Z').getTime()) / 3_600_000;
  assert(dryRunAgeHours <= recentDryRunMaxAgeHours, `Purge réelle refusée : le dernier rapport dry-run date de plus de ${recentDryRunMaxAgeHours}h.`);

  assert(backupVerifiedAt, 'Purge réelle refusée : aucune sauvegarde vérifiée fournie.');
  const backupAgeHours = (Date.now() - new Date(backupVerifiedAt).getTime()) / 3_600_000;
  assert(backupAgeHours <= 24, 'Purge réelle refusée : la sauvegarde vérifiée date de plus de 24h.');

  // Tripwire d'intention explicite : une cible sans CRM_DATA_DIR isolé (donc
  // potentiellement data/crm.sqlite réelle) exige un indicateur d'intention
  // supplémentaire, jamais positionnable par accident (aucune route de ce
  // lot ne le transmet -- seul un futur appel direct, hors de ce lot,
  // pourrait le fournir). Empêche qu'un environnement mal configuré (« test
  // involontaire ») déclenche une purge réelle croyant agir sur une base
  // isolée.
  if (!process.env.CRM_DATA_DIR) {
    assert(confirmProductionTarget === true, 'Purge réelle refusée : cible de production non confirmée explicitement.');
  }

  return { userId, recentDryRun };
}

// N'agit QUE sur les catégories 'abandoned_diagnostic' et
// 'prospect_no_mandate' (action_planned 'delete'/'anonymize') -- 'finalized_advice'
// reste TOUJOURS 'retain' (voir computeFinalizedEligibility), jamais purgée
// par cette fonction, quelle que soit son échéance. Respecte
// systématiquement le legal hold (déjà vérifié par computeSessionEligibility/
// computeHouseholdEligibility, revérifié ici en défense en profondeur juste
// avant l'écriture).
export function executePurge(req, opts = {}) {
  const { userId } = assertPurgeAuthorized(req, opts);
  const now = opts.now ?? Date.now();

  const runInfo = db
    .prepare("INSERT INTO advisory_retention_purge_runs (run_type, status, executed_by_user_id) VALUES ('purge', 'running', ?)")
    .run(userId);
  const runId = runInfo.lastInsertRowid;

  try {
    const result = db.transaction(() => {
      let scanned = 0;
      let executedCount = 0;
      let legalHoldExcluded = 0;
      const householdIds = db.prepare('SELECT id FROM households').all().map((r) => r.id);

      for (const householdId of householdIds) {
        const sessions = db.prepare('SELECT id FROM advisory_sessions WHERE household_id = ?').all(householdId);
        scanned += sessions.length;

        const householdResult = computeHouseholdEligibility(householdId, { now });
        const targets = householdResult
          ? householdResult.session_ids.map((sessionId) => ({ sessionId, category: householdResult.category, reason: householdResult.eligibility_reason, due: householdResult.due_date, action: householdResult.action_planned }))
          : sessions
              .map(({ id: sessionId }) => {
                const r = computeSessionEligibility(sessionId, { now });
                return r && r.action_planned !== 'retain'
                  ? { sessionId, category: r.category, reason: r.eligibility_reason, due: r.due_date, action: r.action_planned }
                  : null;
              })
              .filter(Boolean);

        // Le legal hold bloque INCONDITIONNELLEMENT toute action pour ce
        // foyer, même une fois l'éligibilité par ailleurs confirmée --
        // comptabilisé distinctement (jamais silencieusement fusionné avec
        // « non éligible »), mais aucune ligne de contenu n'est jamais
        // effacée pour ces cibles.
        if (isHouseholdOnLegalHold(householdId)) {
          legalHoldExcluded += targets.length;
          continue;
        }

        for (const t of targets) {
          const summary = rowsAffectedSummary(t.sessionId);
          eraseSessionDiagnosticContent(t.sessionId);
          db.prepare(`
            INSERT INTO advisory_retention_purge_run_items
              (purge_run_id, household_id, session_id, category, eligibility_reason, due_date, legal_hold_blocking, action_planned, rows_affected_summary, executed)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 1)
          `).run(runId, householdId, t.sessionId, t.category, t.reason, t.due, t.action, JSON.stringify(summary));
          audit(req, 'diagnostic purgé (rétention)', 'advisory_session', t.sessionId, `catégorie=${t.category}`);
          executedCount += 1;
        }
      }

      db.prepare(
        "UPDATE advisory_retention_purge_runs SET status = 'completed', ended_at = datetime('now'), total_dossiers_scanned = ?, total_eligible = ?, total_legal_hold_excluded = ? WHERE id = ?"
      ).run(scanned, executedCount, legalHoldExcluded, runId);
      return { runId, executedCount, scanned };
    })();
    audit(req, 'purge de rétention exécutée', 'advisory_retention_purge_run', runId, `${result.executedCount} dossier(s) purgé(s)`);
    return getPurgeRunDetail(runId);
  } catch (err) {
    db.prepare("UPDATE advisory_retention_purge_runs SET status = 'failed', ended_at = datetime('now'), error_message = ? WHERE id = ?")
      .run(String(err.message || err).slice(0, 500), runId);
    throw err;
  }
}

// Efface le contenu de diagnostic d'UNE session, jamais la ligne
// session elle-même (préserve le contexte référentiel/l'intégrité FK,
// laisse une trace technique minimale non identifiable -- §2.A/§7).
// Ordre imposé par les clés étrangères : findings référence rule_executions
// et rules (jamais supprimées ici, rules appartient au CATALOGUE de règles,
// hors périmètre) ; recommendation_findings/_members sont déjà vides à ce
// stade (l'éligibilité l'exige, voir sessionHasAnyRecommendation) donc
// aucune ligne advisory_recommendations à supprimer ici.
function eraseSessionDiagnosticContent(sessionId) {
  db.prepare('DELETE FROM advisory_findings WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM advisory_rule_executions WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM advisory_answers WHERE session_id = ?').run(sessionId);
  db.prepare("UPDATE advisory_sessions SET title = NULL, household_snapshot = NULL, updated_at = datetime('now') WHERE id = ?").run(sessionId);
}

// --- Vérification de sauvegarde ---------------------------------------------
// Simple vérification de PRÉSENCE/FRAÎCHEUR d'une sauvegarde -- jamais une
// restauration, jamais une modification d'une sauvegarde existante (§2.E :
// aucune sauvegarde n'est jamais touchée par ce module). Cherche les
// fichiers produits par le mécanisme de sauvegarde déjà existant
// (`GET /api/backup`, server/app.js, motif `sauvegarde-*.sqlite` dans
// DATA_DIR) -- aucun nouveau composant de sauvegarde créé par ce lot,
// conformément à SECURITY_PRIVACY.md §11.
export function verifyRecentBackupExists({ dir = DATA_DIR, maxAgeHours = 24 } = {}) {
  if (!fs.existsSync(dir)) return { verified: false, reason: 'directory_missing' };
  const files = fs.readdirSync(dir).filter((f) => /^sauvegarde-.*\.sqlite$/.test(f));
  if (files.length === 0) return { verified: false, reason: 'no_backup_found' };
  const newest = files
    .map((f) => ({ f, mtimeMs: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  const ageHours = (Date.now() - newest.mtimeMs) / 3_600_000;
  if (ageHours > maxAgeHours) return { verified: false, reason: 'backup_too_old', file: newest.f, ageHours };
  return { verified: true, file: newest.f, ageHours };
}
