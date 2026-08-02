import { Router } from 'express';
import { AdvisoryError } from '../advisoryHouseholds.js';
import {
  createRecommendation, getSessionRecommendationsList, getSessionRecommendationsHistory,
  getRecommendationDetail, updateRecommendationDraft, linkFinding, unlinkFinding,
  linkMember, unlinkMember, validateRecommendation, dismissRecommendation, withdrawRecommendation,
  createReplacement, findRecommendationSessionId,
} from '../advisoryRecommendations.js';

// Deux routeurs distincts, montés à deux préfixes différents dans
// server/app.js (LOT 7A §19, chemins adaptés très légèrement par rapport à
// la proposition initiale, documenté ici) :
// - `sessionScopedRecommendationsRouter`, monté sous
//   `/api/advisory/sessions` (même routeur que `advisorySessionsRouter`,
//   sous-ressources de session comme `.../answers`/`.../findings`) : liste,
//   création, historique — actions qui n'ont de sens QUE rattachées à une
//   session précise déclarée dans l'URL.
// - `recommendationsRouter`, monté sous `/api/advisory/recommendations`
//   (reprend le chemin déjà documenté par la proposition LOT 1,
//   `API_CONTRACT.md` §7) : toutes les actions adressées directement par id
//   de recommandation. Le `session_id` réel est dérivé de la recommandation
//   elle-même (`findRecommendationSessionId`) puis revérifié par le service
//   (même garantie anti-IDOR que les routes imbriquées, défense en
//   profondeur) — aucune session n'est prise pour argent comptant depuis
//   l'URL puisqu'il n'y en a pas ici.
export const sessionScopedRecommendationsRouter = Router();
export const recommendationsRouter = Router();

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

function noStore(res) {
  res.set('Cache-Control', 'no-store, private');
  res.set('Pragma', 'no-cache');
}

// Résout le `session_id` réel d'une recommandation adressée directement par
// id, ou répond 404 immédiatement si elle n'existe pas — jamais un appel au
// service avec un `sessionId` inventé.
function withRecommendationSession(req, res, fn) {
  const sessionId = findRecommendationSessionId(req.params.id);
  if (sessionId == null) return res.status(404).json({ error: 'Recommandation introuvable.' });
  handle(res, () => fn(sessionId));
}

// --- Sous-ressources de session -------------------------------------------

sessionScopedRecommendationsRouter.get('/:id/recommendations', (req, res) => {
  noStore(res);
  const { domain, status } = req.query;
  handle(res, () => res.json({ recommendations: getSessionRecommendationsList(req.params.id, { domain, status }, req) }));
});

sessionScopedRecommendationsRouter.post('/:id/recommendations', (req, res) => {
  handle(res, () => res.status(201).json(createRecommendation(req.params.id, req.body || {}, req)));
});

sessionScopedRecommendationsRouter.get('/:id/recommendations/history', (req, res) => {
  noStore(res);
  handle(res, () => res.json({ recommendations: getSessionRecommendationsHistory(req.params.id, { domain: req.query.domain }, req) }));
});

// --- Adressage direct par id -----------------------------------------------

recommendationsRouter.get('/:id', (req, res) => {
  noStore(res);
  withRecommendationSession(req, res, (sessionId) => res.json(getRecommendationDetail(sessionId, req.params.id, req)));
});

recommendationsRouter.put('/:id', (req, res) => {
  withRecommendationSession(req, res, (sessionId) => res.json(updateRecommendationDraft(sessionId, req.params.id, req.body || {}, req)));
});

recommendationsRouter.post('/:id/findings', (req, res) => {
  const { finding_id, expected_recommendation_revision } = req.body || {};
  withRecommendationSession(req, res, (sessionId) => res.status(201).json(linkFinding(sessionId, req.params.id, finding_id, expected_recommendation_revision, req)));
});

recommendationsRouter.delete('/:id/findings/:findingId', (req, res) => {
  const { expected_recommendation_revision } = req.body || {};
  withRecommendationSession(req, res, (sessionId) => res.json(unlinkFinding(sessionId, req.params.id, req.params.findingId, expected_recommendation_revision, req)));
});

recommendationsRouter.post('/:id/members', (req, res) => {
  const { household_member_id, expected_recommendation_revision } = req.body || {};
  withRecommendationSession(req, res, (sessionId) => res.status(201).json(linkMember(sessionId, req.params.id, household_member_id, expected_recommendation_revision, req)));
});

recommendationsRouter.delete('/:id/members/:memberId', (req, res) => {
  const { expected_recommendation_revision } = req.body || {};
  withRecommendationSession(req, res, (sessionId) => res.json(unlinkMember(sessionId, req.params.id, req.params.memberId, expected_recommendation_revision, req)));
});

recommendationsRouter.post('/:id/validate', (req, res) => {
  withRecommendationSession(req, res, (sessionId) => res.json(validateRecommendation(sessionId, req.params.id, req.body || {}, req)));
});

recommendationsRouter.post('/:id/dismiss', (req, res) => {
  withRecommendationSession(req, res, (sessionId) => res.json(dismissRecommendation(sessionId, req.params.id, req.body || {}, req)));
});

recommendationsRouter.post('/:id/withdraw', (req, res) => {
  withRecommendationSession(req, res, (sessionId) => res.json(withdrawRecommendation(sessionId, req.params.id, req.body || {}, req)));
});

recommendationsRouter.post('/:id/replacement', (req, res) => {
  withRecommendationSession(req, res, (sessionId) => res.status(201).json(createReplacement(sessionId, req.params.id, req.body || {}, req)));
});
