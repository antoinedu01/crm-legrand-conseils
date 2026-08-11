// Rendez-vous (Acquisition OS, lot A2b) — routeur isolé.
//
// Ce fichier n'est PAS monté dans server/app.js à ce stade. Aucune UI,
// aucune intégration pipeline. Le schéma `appointments` (migration v9,
// server/db.js) est considéré comme figé pour ce lot — aucune colonne
// utilisée ici n'est ajoutée ni modifiée.
//
// Comme les autres routeurs privés du dépôt (companies.js, channels.js,
// campaigns.js), ce fichier ne fait aucune vérification d'authentification
// lui-même : la protection (requireAuth) serait appliquée au montage.
//
// Suppression : volontairement absente dans cette V1. Un rendez-vous
// annulé reste traçable via status = 'cancelled', jamais supprimé
// physiquement.

import { Router } from 'express';
import db from '../db.js';
import { audit } from '../audit.js';
import { assert, inEnum, checkTextFields } from '../validate.js';

export const appointmentsRouter = Router();

const STATUSES = ['booked', 'confirmed', 'completed', 'no_show', 'cancelled'];
const APPOINTMENT_TYPES = ['assurance_sante', 'prevoyance', 'client_360', 'follow_up', 'signature', 'other'];
const LOCATION_TYPES = ['in_person', 'phone', 'video'];

// Champs de contenu modifiables aussi bien à la création qu'à la
// modification. client_id est délibérément EXCLU de cette liste : il n'est
// whitelisté qu'à la création (voir CREATE_FIELDS) — après création, il
// reste immuable (aucune convention existante du dépôt n'autorise la
// réaffectation d'un objet métier à un autre client ; en l'absence de
// règle explicite, on retient l'option la plus sûre).
const CONTENT_FIELDS = [
  'starts_at', 'ends_at', 'status', 'appointment_type', 'location_type', 'location', 'meeting_url', 'notes',
];
const CREATE_FIELDS = ['client_id', ...CONTENT_FIELDS];

function isPositiveIntId(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0;
  return typeof v === 'string' && /^\d+$/.test(v) && Number(v) > 0;
}

// Format canonique unique imposé par cette API : "AAAA-MM-JJ HH:MM:SS"
// (zero-paddé, identique à ce que produit déjà `datetime('now')` ailleurs
// dans le schéma). Aucun autre format n'est accepté dans cette V1 (ni ISO
// 8601 avec "T"/fuseau, ni saisie non paddée, ni texte libre) : le
// CHECK (ends_at > starts_at) de server/db.js repose sur une comparaison
// lexicographique SQLite, fiable uniquement si ce format est strictement
// respecté par tous les appelants. Valide aussi le calendrier réel (rejette
// par exemple le 30 février) via un aller-retour Date.UTC.
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
function isCanonicalDatetime(v) {
  if (typeof v !== 'string') return false;
  const m = DATETIME_RE.exec(v);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (month < 1 || month > 12) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day &&
    check.getUTCHours() === hour &&
    check.getUTCMinutes() === minute &&
    check.getUTCSeconds() === second
  );
}

// Ne retient que les champs whitelistés présents dans le corps de la
// requête ; ne fait jamais confiance à req.body au-delà de cette liste.
function pick(body, fields) {
  const out = {};
  for (const f of fields) if (f in (body || {})) out[f] = body[f] === '' ? null : body[f];
  return out;
}

function validateContent(data) {
  if (data.starts_at != null) {
    assert(isCanonicalDatetime(data.starts_at), 'starts_at doit être au format AAAA-MM-JJ HH:MM:SS (calendrier valide).');
  }
  if (data.ends_at != null) {
    assert(isCanonicalDatetime(data.ends_at), 'ends_at doit être au format AAAA-MM-JJ HH:MM:SS (calendrier valide).');
  }
  assert(inEnum(data.status, STATUSES), 'Statut de rendez-vous inconnu.');
  assert(inEnum(data.appointment_type, APPOINTMENT_TYPES), 'Type de rendez-vous inconnu.');
  assert(inEnum(data.location_type, LOCATION_TYPES), 'Type de lieu inconnu.');
  checkTextFields(data, ['location'], 300);
  checkTextFields(data, ['meeting_url'], 500);
  checkTextFields(data, ['notes'], 5000);
}

appointmentsRouter.get('/', (req, res) => {
  const { client_id, status, from, to } = req.query;
  let sql = `
    SELECT a.*, cl.first_name, cl.last_name, cl.company_name, cl.type AS client_type
    FROM appointments a
    JOIN clients cl ON cl.id = a.client_id
    WHERE 1=1`;
  const params = [];
  if (client_id) {
    assert(isPositiveIntId(client_id), 'Identifiant de client invalide.');
    sql += ' AND a.client_id = ?';
    params.push(client_id);
  }
  if (status) {
    assert(inEnum(status, STATUSES), 'Statut de rendez-vous inconnu.');
    sql += ' AND a.status = ?';
    params.push(status);
  }
  if (from) {
    assert(isCanonicalDatetime(from), 'from doit être au format AAAA-MM-JJ HH:MM:SS.');
    sql += ' AND a.starts_at >= ?';
    params.push(from);
  }
  if (to) {
    assert(isCanonicalDatetime(to), 'to doit être au format AAAA-MM-JJ HH:MM:SS.');
    sql += ' AND a.starts_at <= ?';
    params.push(to);
  }
  sql += ' ORDER BY a.starts_at ASC';
  const rows = db.prepare(sql).all(...params).map((r) => ({
    ...r,
    client_name: r.client_type === 'entreprise' ? r.company_name : [r.first_name, r.last_name].filter(Boolean).join(' ') || null,
  }));
  res.json(rows);
});

appointmentsRouter.get('/:id', (req, res) => {
  if (!isPositiveIntId(req.params.id)) {
    return res.status(400).json({ error: 'Identifiant de rendez-vous invalide.' });
  }
  const row = db
    .prepare(
      `SELECT a.*, cl.first_name, cl.last_name, cl.company_name, cl.type AS client_type
       FROM appointments a
       JOIN clients cl ON cl.id = a.client_id
       WHERE a.id = ?`
    )
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Rendez-vous introuvable.' });
  row.client_name = row.client_type === 'entreprise' ? row.company_name : [row.first_name, row.last_name].filter(Boolean).join(' ') || null;
  res.json(row);
});

appointmentsRouter.post('/', (req, res) => {
  const data = pick(req.body, CREATE_FIELDS);
  if (!data.client_id || !data.starts_at || !data.ends_at) {
    return res.status(400).json({ error: 'client_id, starts_at et ends_at sont requis.' });
  }
  validateContent(data);
  assert(data.ends_at > data.starts_at, 'La fin doit être postérieure au début.');

  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(data.client_id);
  if (!client) return res.status(400).json({ error: 'Client introuvable.' });

  const fields = Object.keys(data);
  const info = db
    .prepare(`INSERT INTO appointments (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`)
    .run(...fields.map((f) => data[f]));
  audit(req, 'création rendez-vous', 'appointment', info.lastInsertRowid, `client #${data.client_id} ${data.starts_at}`);
  res.status(201).json({ id: info.lastInsertRowid });
});

appointmentsRouter.put('/:id', (req, res) => {
  if (!isPositiveIntId(req.params.id)) {
    return res.status(400).json({ error: 'Identifiant de rendez-vous invalide.' });
  }
  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
  if (!appointment) return res.status(404).json({ error: 'Rendez-vous introuvable.' });

  // client_id n'est pas dans CONTENT_FIELDS : s'il est envoyé, il est
  // silencieusement ignoré (comme tout champ hors whitelist dans le reste
  // du dépôt), jamais appliqué.
  const data = pick(req.body, CONTENT_FIELDS);
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'Aucun champ modifiable fourni.' });
  }
  validateContent(data);

  // Chronologie : si l'une des deux bornes change, fusionner avec la valeur
  // actuelle avant de revalider la paire complète (ex. rendez-vous existant
  // 10:00→11:00, PUT { ends_at: '...09:30:00' } doit être refusé).
  if ('starts_at' in data || 'ends_at' in data) {
    const mergedStartsAt = 'starts_at' in data ? data.starts_at : appointment.starts_at;
    const mergedEndsAt = 'ends_at' in data ? data.ends_at : appointment.ends_at;
    assert(mergedEndsAt > mergedStartsAt, 'La fin doit être postérieure au début.');
  }

  const fields = Object.keys(data);
  db.prepare(
    `UPDATE appointments SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`
  ).run(...fields.map((f) => data[f]), appointment.id);
  audit(req, 'modification rendez-vous', 'appointment', appointment.id, data.status || '');
  res.json({ ok: true });
});
