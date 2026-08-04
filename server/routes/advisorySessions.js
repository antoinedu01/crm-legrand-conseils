import { Router } from 'express';
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
} from '../advisoryRuleExecutions.js';

export const advisorySessionsRouter = Router();

// Adaptateur HTTP fin — même convention que server/routes/advisoryHouseholds.js.
function handle(res, fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof AdvisoryError) {
      const body = { error: err.message };
      if (err.missing) body.missing = err.missing;
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
