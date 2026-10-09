import { Router } from 'express';
import db from '../db.js';
import { audit } from '../audit.js';
import { assert } from '../validate.js';
import {
  normalizeConventionInput, normalizeRateInput, getConvention, getRate, listConventions,
  listApplicableRates, rateUsageCount, financialFieldsChanged, planImport, applyImport, describePlan,
} from '../conventions.js';

// Conventions de courtage et barèmes. Données confidentielles du courtier :
// jamais renvoyées hors de l'API authentifiée (montée derrière requireAuth).
export const conventionsRouter = Router();

conventionsRouter.get('/', (req, res) => {
  res.json(listConventions());
});

// Lignes applicables à un contrat (formulaire de contrat).
conventionsRouter.get('/rates', (req, res) => {
  const companyId = Number(req.query.company_id);
  const { branch } = req.query;
  if (!Number.isInteger(companyId) || companyId <= 0 || !branch) {
    return res.status(400).json({ error: 'Compagnie et branche sont requises.' });
  }
  res.json(listApplicableRates({ company_id: companyId, branch, includeInactive: req.query.include_inactive === '1' }));
});

// Import d'un fichier de conventions : aperçu (dry_run) puis application.
conventionsRouter.post('/import', (req, res) => {
  const { data, dry_run: dryRun, deactivate_others: deactivateOthers } = req.body || {};
  const plan = planImport(data, { deactivateOthers: typeof deactivateOthers === 'boolean' ? deactivateOthers : undefined });
  if (dryRun !== false) return res.json({ dry_run: true, ...describePlan(plan) });
  const summary = applyImport(plan);
  audit(req, 'import conventions', 'convention', null,
    `${summary.conventions_created} créée(s), ${summary.conventions_updated} mise(s) à jour, ${summary.companies_deactivated} compagnie(s) désactivée(s)`);
  res.json({ dry_run: false, ...describePlan(plan) });
});

conventionsRouter.get('/:id', (req, res) => {
  const conv = getConvention(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Convention introuvable.' });
  res.json(conv);
});

conventionsRouter.post('/', (req, res) => {
  const data = normalizeConventionInput(req.body);
  const fields = Object.keys(data);
  const info = db
    .prepare(`INSERT INTO conventions (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`)
    .run(...fields.map((f) => data[f]));
  audit(req, 'création convention', 'convention', info.lastInsertRowid, data.title);
  res.status(201).json({ id: info.lastInsertRowid });
});

conventionsRouter.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM conventions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Convention introuvable.' });
  const data = normalizeConventionInput(req.body, existing);
  if (data.company_id !== existing.company_id) {
    const used = db
      .prepare(`SELECT COUNT(*) AS n FROM contracts ct JOIN convention_rates r ON r.id = ct.convention_rate_id
                WHERE r.convention_id = ?`)
      .get(existing.id).n;
    assert(used === 0, 'Des contrats utilisent déjà cette convention : sa compagnie ne peut plus être changée.');
  }
  const fields = Object.keys(data);
  db.prepare(`UPDATE conventions SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...fields.map((f) => data[f]), existing.id);
  audit(req, 'modification convention', 'convention', existing.id, data.status);
  res.json({ ok: true });
});

conventionsRouter.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM conventions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Convention introuvable.' });
  const used = db
    .prepare(
      `SELECT COUNT(*) AS n FROM convention_rates r
       WHERE r.convention_id = ?
         AND (EXISTS (SELECT 1 FROM contracts ct WHERE ct.convention_rate_id = r.id)
              OR EXISTS (SELECT 1 FROM commissions cm WHERE cm.convention_rate_id = r.id))`
    )
    .get(existing.id).n;
  if (used > 0) {
    return res.status(400).json({
      error: 'Des contrats ou des commissions s’appuient sur cette convention : passez-la au statut « résiliée » plutôt que de la supprimer.',
    });
  }
  db.prepare('DELETE FROM conventions WHERE id = ?').run(existing.id);
  audit(req, 'suppression convention', 'convention', existing.id, existing.title);
  res.json({ ok: true });
});

conventionsRouter.post('/:id/rates', (req, res) => {
  const conv = db.prepare('SELECT id FROM conventions WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Convention introuvable.' });
  const rate = normalizeRateInput(req.body);
  const fields = Object.keys(rate);
  const info = db
    .prepare(`INSERT INTO convention_rates (convention_id, ${fields.join(', ')}) VALUES (?, ${fields.map(() => '?').join(', ')})`)
    .run(conv.id, ...fields.map((f) => rate[f]));
  audit(req, 'création ligne de barème', 'convention', conv.id, `${rate.branch} — ${rate.label}`);
  res.status(201).json({ id: info.lastInsertRowid });
});

conventionsRouter.put('/rates/:rateId', (req, res) => {
  const existing = db.prepare('SELECT * FROM convention_rates WHERE id = ?').get(req.params.rateId);
  if (!existing) return res.status(404).json({ error: 'Ligne de barème introuvable.' });
  const next = normalizeRateInput(req.body, existing);
  const changed = financialFieldsChanged(existing, next);
  if (changed.length && rateUsageCount(existing.id) > 0) {
    return res.status(400).json({
      error: 'Cette ligne a déjà servi à des contrats : sa base de calcul, ses montants et sa règle de reprise ne peuvent plus changer. Désactivez-la et créez une nouvelle ligne.',
      locked_fields: changed,
    });
  }
  const fields = Object.keys(next);
  db.prepare(`UPDATE convention_rates SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...fields.map((f) => next[f]), existing.id);
  audit(req, 'modification ligne de barème', 'convention', existing.convention_id, `${next.branch} — ${next.label}`);
  res.json({ ok: true });
});

conventionsRouter.delete('/rates/:rateId', (req, res) => {
  const existing = getRate(req.params.rateId);
  if (!existing) return res.status(404).json({ error: 'Ligne de barème introuvable.' });
  if (rateUsageCount(existing.id) > 0) {
    return res.status(400).json({
      error: 'Cette ligne a déjà servi à des contrats ou des commissions : désactivez-la plutôt que de la supprimer.',
    });
  }
  db.prepare('DELETE FROM convention_rates WHERE id = ?').run(existing.id);
  audit(req, 'suppression ligne de barème', 'convention', existing.convention_id, existing.label);
  res.json({ ok: true });
});
