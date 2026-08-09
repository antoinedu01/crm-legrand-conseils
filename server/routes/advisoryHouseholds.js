import { Router } from 'express';
import db from '../db.js';
import { audit } from '../audit.js';
import {
  AdvisoryError, listHouseholds, getHouseholdDetail, createHousehold, updateHousehold,
  checkSimilarity, addMember, updateMember, removeMember, setPrimaryMember,
} from '../advisoryHouseholds.js';

export const advisoryHouseholdsRouter = Router();

// Adaptateur HTTP fin : les vérifications d'existence simples restent ici
// (comme dans `clients.js`/`contracts.js`) ; la logique métier et les
// invariants (atomicité, conflits) vivent dans `advisoryHouseholds.js`.
function handle(res, fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof AdvisoryError) {
      const body = { error: err.message };
      if (err.matches) body.matches = err.matches;
      // `code` (même convention que server/routes/advisoryRecommendations.js
      // §3) : identifiant machine stable, optionnel, jamais inventé ici —
      // simplement transmis tel quel si l'erreur d'origine en porte un
      // (ex. HEALTH_SYNTHESIS_UNSUPPORTED_VERSION, SYNTH-API §3 : « laisser
      // remonter le 409 du moteur sans traduction destructive »).
      if (err.code) body.code = err.code;
      return res.status(err.status).json(body);
    }
    throw err;
  }
}

advisoryHouseholdsRouter.get('/', (req, res) => {
  const { q, status } = req.query;
  res.json(listHouseholds({ q, status }));
});

advisoryHouseholdsRouter.get('/:id', (req, res) => {
  const detail = getHouseholdDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: 'Foyer introuvable.' });
  audit(req, 'consultation dossier foyer', 'household', detail.id, detail.label || '');
  res.json(detail);
});

advisoryHouseholdsRouter.post('/', (req, res) => {
  handle(res, () => {
    const result = createHousehold(req.body || {}, req);
    res.status(201).json(result);
  });
});

advisoryHouseholdsRouter.put('/:id', (req, res) => {
  handle(res, () => {
    const result = updateHousehold(req.params.id, req.body || {}, req);
    res.json(result);
  });
});

advisoryHouseholdsRouter.post('/:id/members/check-similarity', (req, res) => {
  const household = db.prepare('SELECT id FROM households WHERE id = ?').get(req.params.id);
  if (!household) return res.status(404).json({ error: 'Foyer introuvable.' });
  const { first_name, last_name, birth_date } = req.body || {};
  const matches = checkSimilarity(req.params.id, { first_name, last_name, birth_date });
  if (matches.length > 0) {
    audit(req, 'présentation correspondance similarité', 'household', Number(req.params.id),
      matches.map((m) => m.match_level).join(', '));
  }
  res.json({ matches });
});

advisoryHouseholdsRouter.post('/:id/members', (req, res) => {
  handle(res, () => {
    const result = addMember(req.params.id, req.body || {}, req);
    res.status(201).json(result);
  });
});

advisoryHouseholdsRouter.put('/:id/members/:memberId', (req, res) => {
  handle(res, () => {
    const result = updateMember(req.params.id, req.params.memberId, req.body || {}, req);
    res.json(result);
  });
});

advisoryHouseholdsRouter.post('/:id/members/:memberId/set-primary', (req, res) => {
  handle(res, () => {
    const { previous_primary_new_role } = req.body || {};
    const result = setPrimaryMember(req.params.id, req.params.memberId, previous_primary_new_role, req);
    res.json(result);
  });
});

advisoryHouseholdsRouter.delete('/:id/members/:memberId', (req, res) => {
  handle(res, () => {
    const { end_date } = req.body || {};
    const result = removeMember(req.params.id, req.params.memberId, { end_date }, req);
    res.json(result);
  });
});
