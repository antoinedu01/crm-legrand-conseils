import { Router } from 'express';
import db from '../db.js';
import { audit } from '../audit.js';
import {
  assert, isEmail, isDateStr, inEnum, checkTextFields, normEmail, normPhone,
} from '../validate.js';

export const clientsRouter = Router();

const CLIENT_STATUSES = ['prospect', 'client', 'ancien', 'anonymise'];
const CLIENT_TYPES = ['particulier', 'entreprise'];

function validateClient(data) {
  assert(inEnum(data.type, CLIENT_TYPES), 'Type de client inconnu.');
  assert(inEnum(data.status, CLIENT_STATUSES), 'Statut de client inconnu.');
  assert(data.email == null || isEmail(data.email), 'Adresse e-mail invalide.');
  assert(isDateStr(data.birth_date), 'Date de naissance invalide (AAAA-MM-JJ).');
  assert(isDateStr(data.consent_date), 'Date de consentement invalide.');
  assert(isDateStr(data.mandate_date), 'Date de mandat invalide.');
  assert(isDateStr(data.info_lsa_date), 'Date d’information LSA invalide.');
  checkTextFields(data, ['first_name', 'last_name', 'company_name', 'phone', 'address',
    'npa', 'city', 'canton', 'nationality', 'marital_status', 'profession', 'avs_number'], 200);
  checkTextFields(data, ['notes'], 5000);
}

// Détection de doublons par e-mail ou téléphone normalisés
function findDuplicates(data, excludeId = null) {
  const email = normEmail(data.email);
  const phone = normPhone(data.phone);
  if (!email && !phone) return [];
  const rows = db
    .prepare("SELECT id, type, first_name, last_name, company_name, email, phone FROM clients WHERE status != 'anonymise'")
    .all();
  return rows
    .filter((r) => r.id !== excludeId)
    .filter((r) => (email && normEmail(r.email) === email) || (phone && normPhone(r.phone) === phone))
    .map((r) => ({ id: r.id, name: displayName(r), email: r.email, phone: r.phone }));
}

const CLIENT_FIELDS = [
  'type', 'first_name', 'last_name', 'company_name', 'email', 'phone', 'birth_date',
  'address', 'npa', 'city', 'canton', 'nationality', 'marital_status', 'profession',
  'avs_number', 'notes', 'status', 'consent_data', 'consent_date',
  'mandate_signed', 'mandate_date', 'info_lsa_date',
];

function pick(body) {
  const out = {};
  for (const f of CLIENT_FIELDS) {
    if (f in (body || {})) out[f] = body[f] === '' ? null : body[f];
  }
  if ('consent_data' in out) out.consent_data = out.consent_data ? 1 : 0;
  if ('mandate_signed' in out) out.mandate_signed = out.mandate_signed ? 1 : 0;
  return out;
}

function displayName(c) {
  return c.type === 'entreprise'
    ? c.company_name || '(entreprise sans nom)'
    : [c.first_name, c.last_name].filter(Boolean).join(' ') || '(sans nom)';
}

clientsRouter.get('/', (req, res) => {
  const { q, status } = req.query;
  let sql = `
    SELECT c.*,
      (SELECT COUNT(*) FROM contracts ct WHERE ct.client_id = c.id AND ct.status = 'actif') AS active_contracts,
      (SELECT COUNT(*) FROM contracts ct WHERE ct.client_id = c.id) AS total_contracts
    FROM clients c WHERE 1=1`;
  const params = [];
  if (status) {
    sql += ' AND c.status = ?';
    params.push(status);
  }
  if (q) {
    sql += ` AND (c.first_name LIKE ? OR c.last_name LIKE ? OR c.company_name LIKE ?
             OR c.email LIKE ? OR c.city LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  sql += ' ORDER BY c.last_name COLLATE NOCASE, c.company_name COLLATE NOCASE';
  res.json(db.prepare(sql).all(...params).map((c) => ({ ...c, display_name: displayName(c) })));
});

clientsRouter.get('/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });
  const contracts = db
    .prepare(
      `SELECT ct.*, co.name AS company_name FROM contracts ct
       JOIN companies co ON co.id = ct.company_id WHERE ct.client_id = ? ORDER BY ct.start_date DESC`
    )
    .all(client.id);
  const commissions = db
    .prepare(
      `SELECT cm.* FROM commissions cm JOIN contracts ct ON ct.id = cm.contract_id
       WHERE ct.client_id = ? ORDER BY cm.due_date DESC`
    )
    .all(client.id);
  const activities = db
    .prepare('SELECT * FROM activities WHERE client_id = ? ORDER BY created_at DESC')
    .all(client.id);
  const tasks = db
    .prepare("SELECT * FROM tasks WHERE client_id = ? ORDER BY status, due_date")
    .all(client.id);
  const lead = db
    .prepare(
      `SELECT ld.*, ch.name AS channel_name, ca.name AS campaign_name,
        ref.first_name AS ref_first_name, ref.last_name AS ref_last_name,
        ref.company_name AS ref_company_name, ref.type AS ref_type
       FROM lead_details ld
       LEFT JOIN channels ch ON ch.id = ld.channel_id
       LEFT JOIN campaigns ca ON ca.id = ld.campaign_id
       LEFT JOIN clients ref ON ref.id = ld.referrer_client_id
       WHERE ld.client_id = ?`
    )
    .get(client.id);
  if (lead && lead.referrer_client_id) {
    lead.referrer_name = displayName({
      type: lead.ref_type, first_name: lead.ref_first_name,
      last_name: lead.ref_last_name, company_name: lead.ref_company_name,
    });
  }
  audit(req, 'consultation du dossier client', 'client', client.id, displayName(client));
  res.json({
    ...client, display_name: displayName(client),
    contracts, commissions, activities, tasks, lead: lead || null,
  });
});

export const PIPELINE_STAGES = ['nouveau', 'contacte', 'rdv', 'analyse', 'offre', 'signe', 'perdu'];
const LEAD_FIELDS = [
  'channel_id', 'campaign_id', 'referrer_client_id', 'pipeline_stage',
  'main_need', 'age_range', 'work_situation', 'family_situation', 'contact_pref',
];

// Origine & prospection : d'où vient ce prospect, où en est-on avec lui
clientsRouter.put('/:id/lead', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });
  if (client.status === 'anonymise') {
    return res.status(403).json({ error: 'Ce dossier a été anonymisé.' });
  }
  const data = {};
  for (const f of LEAD_FIELDS) if (f in (req.body || {})) data[f] = req.body[f] === '' ? null : req.body[f];
  if ('pipeline_stage' in data && !PIPELINE_STAGES.includes(data.pipeline_stage)) {
    return res.status(400).json({ error: 'Étape de pipeline inconnue.' });
  }
  if (data.referrer_client_id && Number(data.referrer_client_id) === client.id) {
    return res.status(400).json({ error: 'Un client ne peut pas être son propre parrain.' });
  }
  for (const f of ['main_need', 'age_range', 'work_situation', 'family_situation', 'contact_pref']) {
    if (data[f] != null && String(data[f]).length > 300) {
      return res.status(400).json({ error: `Le champ « ${f} » est trop long.` });
    }
  }
  const existing = db.prepare('SELECT client_id FROM lead_details WHERE client_id = ?').get(client.id);
  if (existing) {
    const fields = Object.keys(data);
    if (fields.length > 0) {
      db.prepare(
        `UPDATE lead_details SET ${fields.map((f) => `${f} = ?`).join(', ')},
          updated_at = datetime('now') WHERE client_id = ?`
      ).run(...fields.map((f) => data[f]), client.id);
    }
  } else {
    const fields = Object.keys(data);
    db.prepare(
      `INSERT INTO lead_details (client_id${fields.length ? ', ' + fields.join(', ') : ''})
       VALUES (?${fields.map(() => ', ?').join('')})`
    ).run(client.id, ...fields.map((f) => data[f]));
  }
  audit(req, 'mise à jour origine/prospection', 'client', client.id, data.pipeline_stage || '');
  res.json({ ok: true });
});

clientsRouter.post('/', (req, res) => {
  const data = pick(req.body);
  if (!data.first_name && !data.last_name && !data.company_name) {
    return res.status(400).json({ error: 'Un nom (ou une raison sociale) est requis.' });
  }
  validateClient(data);
  if (!req.body?.force) {
    const duplicates = findDuplicates(data);
    if (duplicates.length > 0) {
      return res.status(409).json({
        error: 'Un dossier existe déjà avec cet e-mail ou ce téléphone.',
        duplicates,
      });
    }
  }
  const fields = Object.keys(data);
  const info = db
    .prepare(
      `INSERT INTO clients (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`
    )
    .run(...fields.map((f) => data[f]));
  audit(req, 'création client', 'client', info.lastInsertRowid, displayName(data));
  res.status(201).json({ id: info.lastInsertRowid });
});

clientsRouter.put('/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });
  if (client.status === 'anonymise') {
    return res.status(403).json({ error: 'Ce dossier a été anonymisé et ne peut plus être modifié.' });
  }
  const data = pick(req.body);
  if (Object.keys(data).length === 0) return res.json({ ok: true });
  validateClient(data);
  const fields = Object.keys(data);
  db.prepare(
    `UPDATE clients SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`
  ).run(...fields.map((f) => data[f]), client.id);
  audit(req, 'modification client', 'client', client.id, fields.join(', '));
  res.json({ ok: true });
});

// Droit d'accès (art. 25 nLPD) : export complet des données du client
clientsRouter.get('/:id/export', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });
  const data = {
    exporte_le: new Date().toISOString(),
    base_legale: "Droit d'accès selon l'art. 25 de la loi fédérale sur la protection des données (nLPD)",
    client,
    contrats: db
      .prepare(
        `SELECT ct.*, co.name AS compagnie FROM contracts ct
         JOIN companies co ON co.id = ct.company_id WHERE ct.client_id = ?`
      )
      .all(client.id),
    commissions: db
      .prepare(
        `SELECT cm.* FROM commissions cm JOIN contracts ct ON ct.id = cm.contract_id WHERE ct.client_id = ?`
      )
      .all(client.id),
    activites: db.prepare('SELECT * FROM activities WHERE client_id = ?').all(client.id),
    taches: db.prepare('SELECT * FROM tasks WHERE client_id = ?').all(client.id),
  };
  audit(req, "export des données (droit d'accès nLPD)", 'client', client.id, displayName(client));
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="export-donnees-client-${client.id}.json"`
  );
  res.json(data);
});

// Droit à l'effacement (art. 32 nLPD) : anonymisation.
// Les données contractuelles/financières sont conservées (obligation légale de
// conservation 10 ans, art. 958f CO), mais toutes les données personnelles sont effacées.
clientsRouter.post('/:id/anonymize', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });
  const name = displayName(client);
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE clients SET
        first_name = NULL, last_name = 'ANONYMISÉ', company_name = CASE WHEN type='entreprise' THEN 'ANONYMISÉ' ELSE NULL END,
        email = NULL, phone = NULL, birth_date = NULL, address = NULL, npa = NULL, city = NULL,
        canton = NULL, nationality = NULL, marital_status = NULL, profession = NULL,
        avs_number = NULL, notes = NULL, status = 'anonymise',
        consent_data = 0, consent_date = NULL, updated_at = datetime('now')
       WHERE id = ?`
    ).run(client.id);
    db.prepare('DELETE FROM activities WHERE client_id = ?').run(client.id);
    db.prepare("DELETE FROM tasks WHERE client_id = ? AND status = 'ouverte'").run(client.id);
  });
  tx();
  audit(req, "anonymisation (droit à l'effacement nLPD)", 'client', client.id, name);
  res.json({ ok: true });
});

// Journal d'activités (suivi client)
clientsRouter.post('/:id/activities', (req, res) => {
  const client = db.prepare('SELECT id, status FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });
  const { type, content } = req.body || {};
  if (!content) return res.status(400).json({ error: 'Le contenu est requis.' });
  const info = db
    .prepare('INSERT INTO activities (client_id, type, content) VALUES (?, ?, ?)')
    .run(client.id, type || 'note', content);
  audit(req, 'ajout activité', 'client', client.id, type || 'note');
  res.status(201).json({ id: info.lastInsertRowid });
});

clientsRouter.delete('/:id/activities/:activityId', (req, res) => {
  db.prepare('DELETE FROM activities WHERE id = ? AND client_id = ?').run(
    req.params.activityId,
    req.params.id
  );
  audit(req, 'suppression activité', 'client', Number(req.params.id));
  res.json({ ok: true });
});
