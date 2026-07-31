import { Router } from 'express';
import { AdvisoryError } from '../advisoryHouseholds.js';
import {
  listSessions, getSessionDetail, createSession, updateSessionMetadata,
  startSession, suspendSession, resumeSession, cancelSession, completeSession,
  validateSessionForCompletion, recordAnswers, clearAnswer, amendAnswer,
  listActiveAnswers, listAnswerHistory,
} from '../advisorySessions.js';

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
  handle(res, () => res.json(validateSessionForCompletion(req.params.id)));
});

advisorySessionsRouter.post('/:id/start', (req, res) => {
  handle(res, () => res.json(startSession(req.params.id, req)));
});

advisorySessionsRouter.post('/:id/suspend', (req, res) => {
  handle(res, () => res.json(suspendSession(req.params.id, req)));
});

advisorySessionsRouter.post('/:id/resume', (req, res) => {
  handle(res, () => res.json(resumeSession(req.params.id, req)));
});

advisorySessionsRouter.post('/:id/complete', (req, res) => {
  handle(res, () => res.json(completeSession(req.params.id, req)));
});

advisorySessionsRouter.post('/:id/cancel', (req, res) => {
  handle(res, () => res.json(cancelSession(req.params.id, req)));
});

advisorySessionsRouter.get('/:id/answers', (req, res) => {
  handle(res, () => res.json({ answers: listActiveAnswers(req.params.id) }));
});

advisorySessionsRouter.get('/:id/answers/history', (req, res) => {
  const { question_id, household_member_id } = req.query;
  handle(res, () => res.json({
    answers: listAnswerHistory(req.params.id, question_id, household_member_id ? Number(household_member_id) : null),
  }));
});

advisorySessionsRouter.put('/:id/answers', (req, res) => {
  handle(res, () => res.json(recordAnswers(req.params.id, (req.body || {}).answers || [], req)));
});

advisorySessionsRouter.delete('/:id/answers/:questionId', (req, res) => {
  const { household_member_id } = req.body || {};
  handle(res, () => res.json(clearAnswer(req.params.id, req.params.questionId, household_member_id ? Number(household_member_id) : null, req)));
});

advisorySessionsRouter.post('/:id/answers/amend', (req, res) => {
  handle(res, () => res.status(201).json(amendAnswer(req.params.id, req.body || {}, req)));
});
