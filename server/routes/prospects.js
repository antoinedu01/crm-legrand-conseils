import { Router } from 'express';
import db from '../db.js';
import { audit } from '../audit.js';
import { assert } from '../validate.js';
import { loadRules, computeScore } from '../scoring.js';

export const prospectsRouter = Router();

// Pipeline des prospects : tous les clients au statut « prospect »,
// enrichis de leur origine et de leur score (calculé à la volée, avec raisons).
prospectsRouter.get('/', (req, res) => {
  const { channel_id } = req.query;
  let sql = `
    SELECT c.id, c.type, c.first_name, c.last_name, c.company_name, c.email, c.phone,
      c.canton, c.created_at,
      ld.channel_id, ld.campaign_id, ld.referrer_client_id, ld.pipeline_stage,
      ld.main_need, ld.age_range, ld.work_situation, ld.contact_pref, ld.urgent,
      ch.name AS channel_name, ch.key AS channel_key,
      (SELECT MAX(a.created_at) FROM activities a WHERE a.client_id = c.id) AS last_activity_at
    FROM clients c
    LEFT JOIN lead_details ld ON ld.client_id = c.id
    LEFT JOIN channels ch ON ch.id = ld.channel_id
    WHERE c.status = 'prospect'`;
  const params = [];
  if (channel_id) {
    sql += ' AND ld.channel_id = ?';
    params.push(channel_id);
  }
  const rules = loadRules();
  const rows = db.prepare(sql).all(...params).map((r) => {
    const lead = {
      channel_id: r.channel_id, referrer_client_id: r.referrer_client_id,
      pipeline_stage: r.pipeline_stage || 'nouveau', main_need: r.main_need,
      age_range: r.age_range, work_situation: r.work_situation,
      contact_pref: r.contact_pref, urgent: r.urgent, channel_key: r.channel_key,
    };
    const { score, classement, reasons } = computeScore(
      { lead, email: r.email, phone: r.phone, last_activity_at: r.last_activity_at },
      rules
    );
    return {
      id: r.id,
      name: r.type === 'entreprise' ? r.company_name : [r.first_name, r.last_name].filter(Boolean).join(' '),
      canton: r.canton,
      channel_name: r.channel_name,
      pipeline_stage: r.pipeline_stage || 'nouveau',
      main_need: r.main_need,
      contact_pref: r.contact_pref,
      urgent: Boolean(r.urgent),
      created_at: r.created_at,
      last_activity_at: r.last_activity_at,
      score, classement, reasons,
    };
  });
  rows.sort((a, b) => b.score - a.score);
  res.json(rows);
});

// Règles de scoring : consultables et ajustables (points, actif/inactif)
prospectsRouter.get('/scoring-rules', (req, res) => {
  res.json(loadRules());
});

prospectsRouter.put('/scoring-rules/:id', (req, res) => {
  const rule = db.prepare('SELECT * FROM scoring_rules WHERE id = ?').get(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Règle introuvable.' });
  const { points, active } = req.body || {};
  assert(points == null || (Number.isInteger(Number(points)) && Math.abs(Number(points)) <= 100),
    'Les points doivent être un entier entre -100 et 100.');
  db.prepare('UPDATE scoring_rules SET points = COALESCE(?, points), active = COALESCE(?, active) WHERE id = ?')
    .run(points == null ? null : Number(points), active == null ? null : active ? 1 : 0, rule.id);
  audit(req, 'modification règle de scoring', 'scoring_rule', rule.id, rule.key);
  res.json({ ok: true });
});
