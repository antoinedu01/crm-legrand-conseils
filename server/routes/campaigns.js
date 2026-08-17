// Registre des campagnes marketing (Acquisition OS, lot A1a ; clés de
// tracking stables ajoutées en A4.4).
//
// Ce routeur est volontairement isolé : il n'est PAS monté dans
// server/app.js à ce stade. Il suit la structure de la table `campaigns`
// telle qu'elle existe réellement dans server/db.js (migration v3, plus la
// colonne `key` nullable + index UNIQUE ajoutés en migration v17) :
//   id, name, channel_id (FK channels, nullable), status (défaut 'brouillon'),
//   created_at, key (TEXT, nullable, UNIQUE quand renseignée).
//
// Comme les autres routeurs privés du dépôt (companies.js, channels.js),
// ce fichier ne fait aucune vérification d'authentification lui-même :
// la protection est appliquée au montage (`requireAuth`), pas ici.
// La suppression (DELETE) n'est volontairement pas implémentée dans ce lot.
//
// campaigns.key (A4.4) : générée UNIQUEMENT côté serveur, jamais dérivée du
// nom (qui peut changer sans jamais invalider un lien de tracking déjà
// distribué — voir server/db.js, migration 17). Volontairement absente de
// FIELDS ci-dessous : `pick()` ne la retient donc jamais depuis le corps
// d'une requête, ni à la création ni à la modification — un client ne peut
// donc jamais choisir ni modifier une clé, quel que soit le payload envoyé.
// Format : `cmp_<32 caractères hexadécimaux>` (UUID v4 sans tirets),
// opaque, URL-safe, non secret (aucune valeur sensible n'y est jamais
// encodée). Les campagnes créées avant ce lot (ou par le provisionneur QA,
// scripts/qa-acquisition-provision.mjs, non modifié) gardent
// key = NULL indéfiniment tant qu'aucun appel explicite à
// POST /:id/ensure-key ne leur en attribue une — aucun backfill global,
// aucune migration v18, aucune mutation cachée sur un GET.

import crypto from 'crypto';
import { Router } from 'express';
import db from '../db.js';
import { audit } from '../audit.js';
import { assert, checkTextFields } from '../validate.js';

export const campaignsRouter = Router();

const FIELDS = ['name', 'channel_id', 'status'];

const MAX_KEY_GENERATION_ATTEMPTS = 5;

function generateCampaignKey() {
  return `cmp_${crypto.randomUUID().replace(/-/g, '')}`;
}

// Distingue une véritable collision (théorique, probabilité négligeable
// avec un UUID v4) d'une autre erreur technique DB — seule la première
// justifie une régénération silencieuse, jamais la seconde.
function isCampaignKeyCollision(err) {
  return err && err.code === 'SQLITE_CONSTRAINT_UNIQUE' && /campaigns\.key/.test(err.message || '');
}

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
  const insert = db.prepare(
    `INSERT INTO campaigns (${fields.join(', ')}, key) VALUES (${fields.map(() => '?').join(', ')}, ?)`
  );

  // Génération serveur uniquement (§4/§5) : jamais depuis req.body (key
  // n'est de toute façon jamais dans FIELDS). Collision théorique
  // (probabilité négligeable avec un UUID v4) gérée par régénération
  // bornée ; toute autre erreur DB remonte immédiatement, jamais masquée.
  let info;
  let key;
  for (let attempt = 0; attempt < MAX_KEY_GENERATION_ATTEMPTS; attempt++) {
    key = generateCampaignKey();
    try {
      info = insert.run(...fields.map((f) => data[f]), key);
      break;
    } catch (err) {
      if (!isCampaignKeyCollision(err) || attempt === MAX_KEY_GENERATION_ATTEMPTS - 1) throw err;
    }
  }

  audit(req, 'création campagne', 'campaign', info.lastInsertRowid, `${data.name} (key: ${key})`);
  res.status(201).json({ id: info.lastInsertRowid, key });
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

// Legacy (§11/A4.4) : campagnes créées avant ce lot (ou par le
// provisionneur QA), donc key = NULL. Endpoint EXPLICITE et CIBLÉ plutôt
// qu'une mutation cachée sur GET (décision actée avant écriture) : aucune
// campagne autre que celle visée par :id n'est jamais touchée, aucun
// backfill global. Idempotent : si une clé existe déjà, elle est
// simplement retournée telle quelle, sans mutation ni audit (même
// convention que PUT /:id sur un payload sans effet — voir plus haut).
campaignsRouter.post('/:id/ensure-key', (req, res) => {
  if (!isPositiveIntId(req.params.id)) {
    return res.status(400).json({ error: 'Identifiant de campagne invalide.' });
  }
  const campaign = db.prepare('SELECT id, key FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campagne introuvable.' });

  if (campaign.key != null) {
    return res.json({ id: campaign.id, key: campaign.key });
  }

  const update = db.prepare('UPDATE campaigns SET key = ? WHERE id = ? AND key IS NULL');
  let key;
  let changed = 0;
  for (let attempt = 0; attempt < MAX_KEY_GENERATION_ATTEMPTS; attempt++) {
    key = generateCampaignKey();
    try {
      changed = update.run(key, campaign.id).changes;
      break;
    } catch (err) {
      if (!isCampaignKeyCollision(err) || attempt === MAX_KEY_GENERATION_ATTEMPTS - 1) throw err;
    }
  }

  if (changed === 0) {
    // Course théorique : la clé a été attribuée entre le SELECT et l'UPDATE
    // (ex. deux appels concurrents) — jamais deux clés générées pour la
    // même campagne, on relit simplement l'état final.
    const refreshed = db.prepare('SELECT key FROM campaigns WHERE id = ?').get(campaign.id);
    return res.json({ id: campaign.id, key: refreshed.key });
  }

  audit(req, 'génération clé de campagne (legacy)', 'campaign', campaign.id, key);
  res.json({ id: campaign.id, key });
});
