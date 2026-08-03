import { Router } from 'express';
import { AdvisoryError } from '../advisoryHouseholds.js';
import {
  listRuleSets, getRuleSetDetail, createRuleSet, createDraftVersion, cloneRuleSetToNewDraft,
  archiveRuleSet, upsertRule, validateRuleSetForPublish, publishRuleSet,
} from '../advisoryRules.js';

export const advisoryRulesRouter = Router();

// Adaptateur HTTP fin — même convention que server/routes/advisoryQuestionnaires.js.
function handle(res, fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof AdvisoryError) {
      const body = { error: err.message };
      if (err.errors) body.errors = err.errors;
      if (err.warnings) body.warnings = err.warnings;
      return res.status(err.status).json(body);
    }
    throw err;
  }
}

// Ces routes exposent le contenu de règles (conditions, explications) —
// jamais des données personnelles en tant que telles, mais restent privées
// (même politique que les questionnaires, aucune n'est publique).
function noStore(res) {
  res.set('Cache-Control', 'no-store, private');
  res.set('Pragma', 'no-cache');
}

advisoryRulesRouter.get('/', (req, res) => {
  const { domain, status, stable_key } = req.query;
  res.json(listRuleSets({ domain, status, stable_key }));
});

advisoryRulesRouter.post('/', (req, res) => {
  handle(res, () => res.status(201).json(createRuleSet(req.body || {}, req)));
});

advisoryRulesRouter.get('/:id', (req, res) => {
  const detail = getRuleSetDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: 'Ensemble de règles introuvable.' });
  res.json(detail);
});

advisoryRulesRouter.post('/:id/versions', (req, res) => {
  handle(res, () => res.status(201).json(createDraftVersion(req.params.id, req.body || {}, req)));
});

advisoryRulesRouter.post('/:id/clone', (req, res) => {
  handle(res, () => res.status(201).json(cloneRuleSetToNewDraft(req.params.id, req)));
});

advisoryRulesRouter.post('/:id/archive', (req, res) => {
  handle(res, () => res.json(archiveRuleSet(req.params.id, req)));
});

advisoryRulesRouter.get('/:id/validate', (req, res) => {
  noStore(res);
  handle(res, () => res.json(validateRuleSetForPublish(req.params.id)));
});

advisoryRulesRouter.post('/:id/publish', (req, res) => {
  handle(res, () => res.json(publishRuleSet(req.params.id, req)));
});

advisoryRulesRouter.post('/:id/rules', (req, res) => {
  handle(res, () => res.status(201).json(upsertRule(req.params.id, req.body || {}, req)));
});

advisoryRulesRouter.put('/:id/rules/:ruleId', (req, res) => {
  handle(res, () => res.json(upsertRule(req.params.id, { ...req.body, id: Number(req.params.ruleId) }, req)));
});
