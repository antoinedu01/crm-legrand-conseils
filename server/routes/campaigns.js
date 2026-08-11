// Registre des campagnes marketing (Acquisition OS, lot A1a).
//
// Ce routeur est volontairement isolé : il n'est PAS monté dans
// server/app.js à ce stade. Il suit la structure de la table `campaigns`
// telle qu'elle existe réellement dans server/db.js (migration v3) :
//   id, name, channel_id (FK channels, nullable), status (défaut 'brouillon'),
//   created_at. Aucune colonne supplémentaire n'est supposée.
//
// Comme les autres routeurs privés du dépôt (companies.js, channels.js),
// ce fichier ne fait aucune vérification d'authentification lui-même :
// la protection est appliquée au montage (`requireAuth`), pas ici.
// La suppression (DELETE) n'est volontairement pas implémentée dans ce lot.

import { Router } from 'express';
import db from '../db.js';
import { audit } from '../audit.js';
import { assert, checkTextFields } from '../validate.js';

export const campaignsRouter = Router();

const FIELDS = ['name', 'channel_id', 'status'];

function isPositiveIntId(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0;
  return typeof v === 'string' && /^\d+$/.test(v) && Number(v) > 0;
}

// Ne retient que les champs whitelistés présents dans le corps de la
// requête ; ne fait jamais confiance à req.body au-delà de cette liste.
function pick(body) {
  const out = {};
  for (const f of FIELDS) if (f in (body || {})) out[f] = body[f] === '' ? null : body[f];
  return out;
}

function validateCampaign(data, { partial = false } = {}) {
  if (!partial || 'name' in data) {
    assert(typeof data.name === 'string' && data.name.trim().length > 0, 'Le nom de la campagne est requis.');
  }
  checkTextFields(data, ['name'], 200);

  if (data.channel_id != null) {
    assert(isPositiveIntId(data.channel_id), 'Identifiant de canal invalide.');
    const channel = db.prepare('SELECT id FROM channels WHERE id = ?').get(Number(data.channel_id));
    assert(channel, 'Le canal indiqué n’existe pas.');
  }

  if (data.status != null) {
    assert(typeof data.status === 'string' && data.status.trim().length > 0, 'Le statut ne peut pas être vide.');
    checkTextFields(data, ['status'], 50);
  }
}

campaignsRouter.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT ca.*, ch.name AS channel_name
       FROM campaigns ca
       LEFT JOIN channels ch ON ch.id = ca.channel_id
       ORDER BY ca.created_at DESC, ca.name COLLATE NOCASE`
    )
    .all();
  res.json(rows);
});

campaignsRouter.get('/:id', (req, res) => {
  if (!isPositiveIntId(req.params.id)) {
    return res.status(400).json({ error: 'Identifiant de campagne invalide.' });
  }
  const campaign = db
    .prepare(
      `SELECT ca.*, ch.name AS channel_name
       FROM campaigns ca
       LEFT JOIN channels ch ON ch.id = ca.channel_id
       WHERE ca.id = ?`
    )
    .get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campagne introuvable.' });
  res.json(campaign);
});

campaignsRouter.post('/', (req, res) => {
  const data = pick(req.body);
  validateCampaign(data);
  const fields = Object.keys(data);
  const info = db
    .prepare(`INSERT INTO campaigns (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`)
    .run(...fields.map((f) => data[f]));
  audit(req, 'création campagne', 'campaign', info.lastInsertRowid, data.name);
  res.status(201).json({ id: info.lastInsertRowid });
});

campaignsRouter.put('/:id', (req, res) => {
  if (!isPositiveIntId(req.params.id)) {
    return res.status(400).json({ error: 'Identifiant de campagne invalide.' });
  }
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campagne introuvable.' });

  const data = pick(req.body);
  if (Object.keys(data).length === 0) return res.json({ ok: true });
  validateCampaign(data, { partial: true });

  const fields = Object.keys(data);
  db.prepare(`UPDATE campaigns SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(
    ...fields.map((f) => data[f]),
    campaign.id
  );
  audit(req, 'modification campagne', 'campaign', campaign.id, data.name || campaign.name);
  res.json({ ok: true });
});
