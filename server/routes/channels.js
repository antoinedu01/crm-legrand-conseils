import { Router } from 'express';
import db from '../db.js';
import { audit } from '../audit.js';
import { assert, isNonNegNumber, checkTextFields } from '../validate.js';

export const channelsRouter = Router();

// Vue d'ensemble des canaux avec l'entonnoir de l'année choisie :
// leads reçus → contrats signés → commissions, et coûts engagés.
channelsRouter.get('/', (req, res) => {
  const year = String(Number(req.query.year) || new Date().getFullYear());
  const rows = db
    .prepare(
      `SELECT ch.*,
        (SELECT COUNT(*) FROM lead_details ld WHERE ld.channel_id = ch.id) AS leads_total,
        (SELECT COUNT(*) FROM lead_details ld WHERE ld.channel_id = ch.id
          AND strftime('%Y', ld.created_at) = ?) AS leads_year,
        (SELECT COUNT(*) FROM contracts ct
          JOIN lead_details ld ON ld.client_id = ct.client_id
          WHERE ld.channel_id = ch.id AND ct.status = 'actif'
          AND strftime('%Y', ct.created_at) = ?) AS contracts_year,
        (SELECT COALESCE(SUM(cm.received_amount_chf), 0) FROM commissions cm
          JOIN contracts ct ON ct.id = cm.contract_id
          JOIN lead_details ld ON ld.client_id = ct.client_id
          WHERE ld.channel_id = ch.id AND cm.status != 'cancelled'
          AND strftime('%Y', COALESCE(cm.received_payment_date, cm.expected_payment_date)) = ?) AS commissions_year,
        (SELECT COALESCE(SUM(cc.amount), 0) FROM channel_costs cc
          WHERE cc.channel_id = ch.id AND cc.month LIKE ? || '-%') AS costs_year
       FROM channels ch
       ORDER BY ch.active DESC, ch.sort, ch.name COLLATE NOCASE`
    )
    .all(year, year, year, year);
  res.json(rows);
});

channelsRouter.post('/', (req, res) => {
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Le nom du canal est requis.' });
  checkTextFields({ name, description }, ['name'], 200);
  checkTextFields({ description }, ['description'], 1000);
  const info = db
    .prepare('INSERT INTO channels (name, description, sort) VALUES (?, ?, 99)')
    .run(name, description || null);
  audit(req, 'création canal d’acquisition', 'channel', info.lastInsertRowid, name);
  res.status(201).json({ id: info.lastInsertRowid });
});

channelsRouter.put('/:id', (req, res) => {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
  if (!channel) return res.status(404).json({ error: 'Canal introuvable.' });
  const { name, description, active } = req.body || {};
  checkTextFields({ name }, ['name'], 200);
  checkTextFields({ description }, ['description'], 1000);
  db.prepare(
    `UPDATE channels SET name = COALESCE(?, name), description = COALESCE(?, description),
      active = COALESCE(?, active) WHERE id = ?`
  ).run(name || null, description ?? null, active == null ? null : active ? 1 : 0, channel.id);
  audit(req, 'modification canal', 'channel', channel.id, name || channel.name);
  res.json({ ok: true });
});

// Coûts engagés par canal (saisie mensuelle)
channelsRouter.get('/:id/costs', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM channel_costs WHERE channel_id = ? ORDER BY month DESC')
    .all(req.params.id);
  res.json(rows);
});

channelsRouter.post('/:id/costs', (req, res) => {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
  if (!channel) return res.status(404).json({ error: 'Canal introuvable.' });
  const { month, amount, notes } = req.body || {};
  assert(typeof month === 'string' && /^\d{4}-\d{2}$/.test(month), 'Mois invalide (AAAA-MM).');
  assert(isNonNegNumber(amount) && amount != null, 'Le montant doit être un nombre positif.');
  checkTextFields({ notes }, ['notes'], 500);
  const info = db
    .prepare('INSERT INTO channel_costs (channel_id, month, amount, notes) VALUES (?, ?, ?, ?)')
    .run(channel.id, month, Number(amount), notes || null);
  audit(req, 'saisie coût canal', 'channel', channel.id, `${channel.name} ${month} CHF ${amount}`);
  res.status(201).json({ id: info.lastInsertRowid });
});

channelsRouter.delete('/costs/:costId', (req, res) => {
  const cost = db.prepare('SELECT * FROM channel_costs WHERE id = ?').get(req.params.costId);
  if (!cost) return res.status(404).json({ error: 'Coût introuvable.' });
  db.prepare('DELETE FROM channel_costs WHERE id = ?').run(cost.id);
  audit(req, 'suppression coût canal', 'channel', cost.channel_id);
  res.json({ ok: true });
});
