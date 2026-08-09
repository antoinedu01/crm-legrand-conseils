import { Router } from 'express';
import db from '../db.js';
import { audit } from '../audit.js';
import { AdvisoryError } from '../advisoryHouseholds.js';
import {
  listSessions, getSessionDetail, createSession, updateSessionMetadata,
  startSession, suspendSession, resumeSession, cancelSession, completeSession,
  validateSessionForCompletion, recordAnswers, clearAnswer, amendAnswer,
  listActiveAnswers, listAnswerHistory, getSessionWorkspace,
} from '../advisorySessions.js';
import {
  executeRuleSetForSession, executeApplicableRuleSetsForSession, listExecutions, getExecutionDetail,
  listActiveFindings, listFindingsHistory, dismissFinding, getSessionFindingsWorkspace,
  getProjectedSessionFindings, hasFrozenSensitiveRefInFindings, auditSensitiveDataAccessIfNeeded,
} from '../advisoryRuleExecutions.js';
import { buildHealthSynthesis } from '../advisoryHealthSynthesis.js';

export const advisorySessionsRouter = Router();

// Adaptateur HTTP fin — même convention que server/routes/advisoryHouseholds.js.
function handle(res, fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof AdvisoryError) {
      const body = { error: err.message };
      if (err.missing) body.missing = err.missing;
      // `code` (même convention que server/routes/advisoryRecommendations.js
      // §3) : identifiant machine stable, optionnel, jamais inventé ici —
      // simplement transmis tel quel si l'erreur d'origine en porte un
      // (ex. HEALTH_SYNTHESIS_UNSUPPORTED_VERSION, SYNTH-API §3 : « laisser
      // remonter le 409 du moteur sans traduction destructive »).
      if (err.code) body.code = err.code;
      // `details` : objet technique optionnel attaché par certaines erreurs
      // (ex. expected_questionnaire_version/actual_questionnaire_version) —
      // jamais construit ici, jamais de donnée de santé, seulement transmis
      // si présent sur l'erreur d'origine.
      if (err.details) body.details = err.details;
      return res.status(err.status).json(body);
    }
    throw err;
  }
}

// Ces routes exposent des réponses potentiellement médicales/financières
// (GATE LOT 3B §7) : jamais mises en cache par le navigateur ni un
// intermédiaire (proxy partagé), même après déconnexion de l'utilisateur.
function noStore(res) {
  res.set('Cache-Control', 'no-store, private');
  res.set('Pragma', 'no-cache');
}

advisorySessionsRouter.get('/', (req, res) => {
  const { household_id, status, domain, from, to } = req.query;
  res.json(listSessions({ household_id, status, domain, from, to }));
});

advisorySessionsRouter.post('/', (req, res) => {
  handle(res, () => res.status(201).json(createSession(req.body || {}, req)));
});

advisorySessionsRouter.get('/:id', (req, res) => {
  const detail = getSessionDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: 'Session introuvable.' });
  res.json(detail);
});

advisorySessionsRouter.put('/:id', (req, res) => {
  handle(res, () => res.json(updateSessionMetadata(req.params.id, req.body || {}, req)));
});

advisorySessionsRouter.get('/:id/completion-check', (req, res) => {
  noStore(res);
  handle(res, () => res.json(validateSessionForCompletion(req.params.id)));
});

// Projection prête à afficher pour le workspace de rendez-vous (Lot 3B) —
// lecture auditée avec déduplication (GATE LOT 3B §6, voir
// auditWorkspaceView dans advisorySessions.js) : les actions d'écriture
// (réponses/effacements/amendements/transitions) restent, elles, toutes
// auditées sans déduplication, comme avant.
advisorySessionsRouter.get('/:id/workspace', (req, res) => {
  noStore(res);
  handle(res, () => res.json(getSessionWorkspace(req.params.id, req)));
});

// Projection prête à afficher pour l'espace conseiller des findings (Lot
// 4B) — même convention que /:id/workspace ci-dessus : lecture auditée avec
// déduplication (voir auditFindingsWorkspaceView dans advisoryRuleExecutions.js),
// jamais mise en cache (réponses potentiellement médicales/financières).
advisorySessionsRouter.get('/:id/findings-workspace', (req, res) => {
  noStore(res);
  handle(res, () => res.json(getSessionFindingsWorkspace(req.params.id, req)));
});

// Audit — frontière HTTP uniquement (SYNTH-API §5, décision d'architecture
// définitive) : `buildHealthSynthesis`/`getProjectedSessionFindings`
// restent, eux, strictement sans audit (utilisables tels quels par un futur
// appelant interne — ex. un générateur de brouillon de recommandation —
// sans jamais produire cette action). Seule LA CONSULTATION HTTP réelle par
// un humain est journalisée ici, avec le même patron de déduplication
// temporelle (fenêtre 15 minutes) que `auditWorkspaceView`
// (server/advisorySessions.js) et `auditFindingsWorkspaceView`
// (server/advisoryRuleExecutions.js) — jamais le mécanisme générique
// `audit()`, qui n'a pas de déduplication intégrée. Détails STRICTEMENT
// minimisés (jamais une réponse de santé, une valeur franchise/care model,
// un besoin complémentaire, un texte de finding ni le DTO complet) :
// uniquement domaine, version de synthèse, état d'analyse et besoin de
// réanalyse — l'identifiant de session est déjà porté par `entity_id`,
// jamais dupliqué dans `details`.
const HEALTH_SYNTHESIS_VIEW_DEDUP_MINUTES = 15;
function auditHealthSynthesisView(req, sessionId, dto) {
  const email = req?.session?.userEmail || 'système';
  const recent = db
    .prepare(
      `SELECT id FROM audit_log WHERE user_email = ? AND action = 'consultation synthèse santé session'
       AND entity = 'advisory_session' AND entity_id = ? AND created_at >= datetime('now', ?) ORDER BY id DESC LIMIT 1`
    )
    .get(email, sessionId, `-${HEALTH_SYNTHESIS_VIEW_DEDUP_MINUTES} minutes`);
  if (recent) return;
  audit(
    req, 'consultation synthèse santé session', 'advisory_session', sessionId,
    `domaine ${dto.domain} — synthesis_version ${dto.synthesis_version} — analysis_status ${dto.analysis_status} — requires_reanalysis ${dto.requires_reanalysis}`
  );
}

// Synthèse Santé déterministe (SYNTH-API), calculée à la volée à chaque
// appel — jamais persistée, jamais mise en cache (réponses potentiellement
// médicales). `buildHealthSynthesis` porte déjà seule toute la logique de
// contrôle d'accès en lecture (session/foyer introuvable → 404/400,
// domaine non applicable → 400, version non supportée → 409
// HEALTH_SYNTHESIS_UNSUPPORTED_VERSION) : cette route ne duplique RIEN de
// cette logique, elle se contente de l'appeler et de transmettre le DTO
// exactement tel quel (`res.json(dto)`, jamais de transformation) — même
// politique d'accès en lecture que `/:id/findings-workspace` ci-dessus,
// aucun droit plus permissif ni restriction supplémentaire. `req` n'est
// JAMAIS passé à `buildHealthSynthesis` (signature `{ sessionId }`
// uniquement) : le moteur reste utilisable indépendamment d'HTTP.
//
// Audit dérivé « consultation findings sensibles » (correction post-revue
// compliance-privacy-reviewer, SYNTH-API) : la synthèse expose un contenu
// DÉRIVÉ des mêmes findings Santé que `/findings-workspace`/`listActiveFindings`
// ci-dessus, sans jamais réexposer `used_inputs_ref` elle-même — même
// précédent que les Lots 4A/4B/7A (`docs/advisory/SECURITY_PRIVACY.md`) :
// toute route de lecture exposant un tel contenu applique le MÊME critère
// dérivé (`hasFrozenSensitiveRefInFindings`) et le MÊME audit
// (`auditSensitiveDataAccessIfNeeded`, action `consultation findings
// sensibles`, déduplication 15 minutes), jamais un second mécanisme
// redéfini ici. `getProjectedSessionFindings` est rappelée une seconde
// fois (après le succès de `buildHealthSynthesis`, jamais avant : aucun
// audit tant que la synthèse n'a pas réellement été construite) pour
// obtenir les findings bruts nécessaires à ce seul calcul — redondance de
// lecture déjà assumée ailleurs dans ce même moteur (voir le commentaire
// de `getProjectedSessionFindings`, server/advisoryRuleExecutions.js),
// jamais une seconde logique de projection.
advisorySessionsRouter.get('/:id/health-synthesis', (req, res) => {
  noStore(res);
  handle(res, () => {
    const dto = buildHealthSynthesis({ sessionId: req.params.id });
    auditHealthSynthesisView(req, req.params.id, dto);
    const { raw } = getProjectedSessionFindings(req.params.id, { domain: 'health' });
    auditSensitiveDataAccessIfNeeded(req, req.params.id, 'health', hasFrozenSensitiveRefInFindings(raw));
    res.json(dto);
  });
});

advisorySessionsRouter.post('/:id/start', (req, res) => {
  handle(res, () => res.json(startSession(req.params.id, (req.body || {}).expected_revision, req)));
});

advisorySessionsRouter.post('/:id/suspend', (req, res) => {
  handle(res, () => res.json(suspendSession(req.params.id, (req.body || {}).expected_revision, req)));
});

advisorySessionsRouter.post('/:id/resume', (req, res) => {
  handle(res, () => res.json(resumeSession(req.params.id, (req.body || {}).expected_revision, req)));
});

advisorySessionsRouter.post('/:id/complete', (req, res) => {
  handle(res, () => res.json(completeSession(req.params.id, (req.body || {}).expected_revision, req)));
});

advisorySessionsRouter.post('/:id/cancel', (req, res) => {
  handle(res, () => res.json(cancelSession(req.params.id, (req.body || {}).expected_revision, req)));
});

advisorySessionsRouter.get('/:id/answers', (req, res) => {
  noStore(res);
  handle(res, () => res.json({ answers: listActiveAnswers(req.params.id) }));
});

advisorySessionsRouter.get('/:id/answers/history', (req, res) => {
  noStore(res);
  const { question_id, household_member_id } = req.query;
  handle(res, () => res.json({
    answers: listAnswerHistory(req.params.id, question_id, household_member_id ? Number(household_member_id) : null, req),
  }));
});

advisorySessionsRouter.put('/:id/answers', (req, res) => {
  handle(res, () => res.json(recordAnswers(req.params.id, (req.body || {}).answers || [], (req.body || {}).expected_revision, req)));
});

advisorySessionsRouter.delete('/:id/answers/:questionId', (req, res) => {
  const { household_member_id, expected_revision } = req.body || {};
  handle(res, () => res.json(clearAnswer(req.params.id, req.params.questionId, household_member_id ? Number(household_member_id) : null, expected_revision, req)));
});

// Correctif d'intégrité de la complétude de session (§4/§5) : un amendement
// qui laisse la session `completed` (réponse remplacée par une autre valeur
// présente, ou par `unknown` quand la question l'autorise) NE déclenche
// PAS de ré-exécution automatique ici -- décision humaine confirmée et déjà
// testée (GATE LOT 4B §7.5, RULES_ENGINE.md §10 : « amender une réponse ne
// déclenche toujours pas de relance automatique -- le conseiller reste seul
// décisionnaire du moment où relancer »). Ce correctif ne modifie donc PAS
// cette politique : le mécanisme de péremption déjà existant
// (`resolveDomainAnalysisState`, comparaison de révision) marque déjà
// automatiquement le domaine concerné `stale` dès que `amendAnswer` fait
// avancer la révision de session (inchangé par ce correctif) -- le
// conseiller relance ensuite explicitement via `POST .../analyze`, qui
// supersède correctement l'ancienne exécution et ses findings (mécanisme
// déjà existant, inchangé). Seul le cas où l'amendement REND la session
// incomplète (réponse requise devenue absente) a un traitement propre à ce
// correctif : voir `amendAnswer` (server/advisorySessions.js), qui rouvre
// alors la session (`completed` -> `in_progress`, transition `reopen`).
advisorySessionsRouter.post('/:id/answers/amend', (req, res) => {
  handle(res, () => res.status(201).json(amendAnswer(req.params.id, req.body || {}, req)));
});

// Lance l'analyse déterministe sur TOUS les domaines applicables à cette
// session en un seul geste conseiller (Lot 4B) — même convention de verbe
// d'action que /:id/start, /:id/complete, etc. ci-dessus. Retourne un
// résultat STRUCTURÉ par domaine (`completed`/`failed`/
// `skipped_no_published_rule_set`) ; le front ne doit JAMAIS interpréter un
// 201 générique comme « analyse complète pour tous les domaines » sans lire
// chaque statut individuellement (voir executeApplicableRuleSetsForSession,
// server/advisoryRuleExecutions.js — aucune atomicité globale entre
// domaines, décision GATE LOT 4B §7).
advisorySessionsRouter.post('/:id/analyze', (req, res) => {
  const { expected_revision } = req.body || {};
  handle(res, () => res.status(201).json({ results: executeApplicableRuleSetsForSession(req.params.id, expected_revision, req) }));
});

// --- Moteur de règles (Lot 4A) : exécutions et findings, rattachés à la
// session comme tout autre sous-ensemble de données de session (même
// convention que /:id/answers ci-dessus).

advisorySessionsRouter.post('/:id/rule-executions', (req, res) => {
  const { domain, expected_revision, rule_set_id } = req.body || {};
  handle(res, () => res.status(201).json(executeRuleSetForSession(req.params.id, domain, expected_revision, req, { rule_set_id })));
});

advisorySessionsRouter.get('/:id/rule-executions', (req, res) => {
  noStore(res);
  handle(res, () => res.json({ executions: listExecutions(req.params.id, { domain: req.query.domain }, req) }));
});

advisorySessionsRouter.get('/:id/rule-executions/:executionId', (req, res) => {
  noStore(res);
  handle(res, () => {
    const detail = getExecutionDetail(req.params.id, req.params.executionId, req);
    if (!detail) return res.status(404).json({ error: 'Exécution introuvable pour cette session.' });
    res.json(detail);
  });
});

advisorySessionsRouter.get('/:id/findings', (req, res) => {
  noStore(res);
  handle(res, () => res.json({ findings: listActiveFindings(req.params.id, { domain: req.query.domain }, req) }));
});

advisorySessionsRouter.get('/:id/findings/history', (req, res) => {
  noStore(res);
  handle(res, () => res.json({ findings: listFindingsHistory(req.params.id, { domain: req.query.domain }, req) }));
});

advisorySessionsRouter.post('/:id/findings/:findingId/dismiss', (req, res) => {
  handle(res, () => res.json(dismissFinding(req.params.id, req.params.findingId, req.body || {}, req)));
});
