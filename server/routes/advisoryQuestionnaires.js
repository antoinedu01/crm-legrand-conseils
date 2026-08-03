import { Router } from 'express';
import { AdvisoryError } from '../advisoryHouseholds.js';
import {
  listQuestionnaires, listVersions, getVersionDetail, createQuestionnaire, createDraftVersion,
  upsertSection, upsertQuestion, upsertOption, validateVersionForPublish, publishVersion,
  archiveVersion, cloneVersionToNewDraft,
} from '../advisoryQuestionnaires.js';

export const advisoryQuestionnairesRouter = Router();

// Adaptateur HTTP fin — même convention que server/routes/advisoryHouseholds.js.
function handle(res, fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof AdvisoryError) {
      const body = { error: err.message };
      if (err.errors) body.errors = err.errors;
      return res.status(err.status).json(body);
    }
    throw err;
  }
}

advisoryQuestionnairesRouter.get('/', (req, res) => {
  const { domain, status } = req.query;
  res.json(listQuestionnaires({ domain, status }));
});

advisoryQuestionnairesRouter.post('/', (req, res) => {
  handle(res, () => res.status(201).json(createQuestionnaire(req.body || {}, req)));
});

advisoryQuestionnairesRouter.post('/:id/versions', (req, res) => {
  handle(res, () => res.status(201).json(createDraftVersion(req.params.id, req.body || {}, req)));
});

advisoryQuestionnairesRouter.get('/versions', (req, res) => {
  const { domain, status } = req.query;
  res.json(listVersions({ domain, status }));
});

advisoryQuestionnairesRouter.get('/versions/:versionId', (req, res) => {
  const detail = getVersionDetail(req.params.versionId);
  if (!detail) return res.status(404).json({ error: 'Version de questionnaire introuvable.' });
  res.json(detail);
});

advisoryQuestionnairesRouter.get('/versions/:versionId/validate', (req, res) => {
  handle(res, () => res.json(validateVersionForPublish(req.params.versionId)));
});

advisoryQuestionnairesRouter.post('/versions/:versionId/publish', (req, res) => {
  handle(res, () => res.json(publishVersion(req.params.versionId, req)));
});

advisoryQuestionnairesRouter.post('/versions/:versionId/archive', (req, res) => {
  handle(res, () => res.json(archiveVersion(req.params.versionId, req)));
});

advisoryQuestionnairesRouter.post('/versions/:versionId/clone', (req, res) => {
  handle(res, () => res.status(201).json(cloneVersionToNewDraft(req.params.versionId, req)));
});

advisoryQuestionnairesRouter.post('/versions/:versionId/sections', (req, res) => {
  handle(res, () => res.status(201).json(upsertSection(req.params.versionId, req.body || {}, req)));
});

advisoryQuestionnairesRouter.put('/versions/:versionId/sections/:sectionId', (req, res) => {
  handle(res, () => res.json(upsertSection(req.params.versionId, { ...req.body, id: Number(req.params.sectionId) }, req)));
});

advisoryQuestionnairesRouter.post('/sections/:sectionId/questions', (req, res) => {
  handle(res, () => res.status(201).json(upsertQuestion(req.params.sectionId, req.body || {}, req)));
});

advisoryQuestionnairesRouter.put('/sections/:sectionId/questions/:questionId', (req, res) => {
  handle(res, () => res.json(upsertQuestion(req.params.sectionId, { ...req.body, id: Number(req.params.questionId) }, req)));
});

advisoryQuestionnairesRouter.post('/questions/:questionId/options', (req, res) => {
  handle(res, () => res.status(201).json(upsertOption(req.params.questionId, req.body || {}, req)));
});

advisoryQuestionnairesRouter.put('/questions/:questionId/options/:optionId', (req, res) => {
  handle(res, () => res.json(upsertOption(req.params.questionId, { ...req.body, id: Number(req.params.optionId) }, req)));
});
