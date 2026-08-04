import { Router } from 'express';
import { AdvisoryError } from '../advisoryHouseholds.js';
import {
  listPolicies, getConfig, listLegalHolds, createLegalHold, liftLegalHold,
  runDryRunSimulation, listPurgeRuns, getPurgeRunDetail,
} from '../advisoryRetention.js';

export const advisoryRetentionRouter = Router();

// Adaptateur HTTP fin, même convention que server/routes/advisoryHouseholds.js
// et server/routes/advisorySessions.js. UNIQUEMENT de la consultation et de
// la simulation (dry-run) + gestion des legal holds -- AUCUNE route
// n'atteint jamais `executePurge` (server/advisoryRetention.js) dans cette
// livraison : la purge réelle reste désactivée et non exposée (§6, §13).
function handle(res, fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof AdvisoryError) {
      return res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
}

// Réponses potentiellement liées à des dossiers sensibles (LOT 3B, même
// politique que server/routes/advisorySessions.js) : jamais mises en cache.
function noStore(res) {
  res.set('Cache-Control', 'no-store, private');
  res.set('Pragma', 'no-cache');
}

advisoryRetentionRouter.get('/policies', (req, res) => {
  noStore(res);
  res.json({ policies: listPolicies() });
});

advisoryRetentionRouter.get('/config', (req, res) => {
  noStore(res);
  res.json(getConfig());
});

advisoryRetentionRouter.get('/households/:householdId/legal-holds', (req, res) => {
  noStore(res);
  handle(res, () => res.json({ legal_holds: listLegalHolds(req.params.householdId) }));
});

advisoryRetentionRouter.post('/households/:householdId/legal-holds', (req, res) => {
  handle(res, () => res.status(201).json(createLegalHold(req.params.householdId, req.body || {}, req)));
});

advisoryRetentionRouter.post('/households/:householdId/legal-holds/:holdId/lift', (req, res) => {
  handle(res, () => res.json(liftLegalHold(req.params.householdId, req.params.holdId, req.body || {}, req)));
});

// Simulation uniquement (dry-run) -- écrit exclusivement dans les tables de
// rapport advisory_retention_purge_runs/_items, jamais dans le contenu de
// diagnostic (advisory_sessions/advisory_answers/...).
advisoryRetentionRouter.post('/dry-run', (req, res) => {
  handle(res, () => res.status(201).json(runDryRunSimulation(req)));
});

advisoryRetentionRouter.get('/purge-runs', (req, res) => {
  noStore(res);
  handle(res, () => res.json({ runs: listPurgeRuns({ run_type: req.query.run_type }) }));
});

advisoryRetentionRouter.get('/purge-runs/:runId', (req, res) => {
  noStore(res);
  handle(res, () => res.json(getPurgeRunDetail(req.params.runId)));
});
