import { Router } from 'express';
import db from '../db.js';
import { audit } from '../audit.js';
import { assert, isEmail, inEnum, checkTextFields } from '../validate.js';

export const partnersRouter = Router();

export const PARTNER_CATEGORIES = [
  'fiduciaire', 'agent_immobilier', 'courtier_hypothecaire', 'entreprise',
  'rh', 'club_sportif', 'association', 'autre',
];
export const PARTNER_STAGES = [
  'identifie', 'a_contacter', 'premier_echange', 'rdv_prevu',
  'proposition', 'actif', 'inactif', 'refuse',
];

function validatePartner(data) {
  assert(inEnum(data.category, PARTNER_CATEGORIES), 'Catégorie de partenaire inconnue.');
  assert(inEnum(data.stage, PARTNER_STAGES), 'Étape de partenariat inconnue.');
  assert(data.email == null || data.email === '' || isEmail(data.email), 'E-mail invalide.');
  checkTextFields(data, ['name', 'contact_name', 'phone', 'city', 'canton'], 200);
  checkTextFields(data, ['remuneration', 'notes'], 2000);
}

const FIELDS = [
  'name', 'category', 'contact_name', 'email', 'phone', 'city', 'canton',
  'stage', 'remuneration', 'agreement_signed', 'agreement_date', 'notes',
];

function pick(body) {
  const out = {};
  for (const f of FIELDS) if (f in (body || {})) out[f] = body[f] === '' ? null : body[f];
  if ('agreement_signed' in out) out.agreement_signed = out.agreement_signed ? 1 : 0;
  return out;
}

// Liste des partenaires avec leurs résultats : leads transmis, RDV, contrats, commissions
partnersRouter.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM lead_details ld WHERE ld.partner_id = p.id) AS leads_count,
        (SELECT COUNT(*) FROM lead_details ld WHERE ld.partner_id = p.id
          AND ld.pipeline_stage IN ('rdv', 'analyse', 'offre', 'signe')) AS meetings_count,
        (SELECT COUNT(*) FROM contracts ct JOIN lead_details ld ON ld.client_id = ct.client_id
          WHERE ld.partner_id = p.id AND ct.status = 'actif') AS contracts_count,
        (SELECT COALESCE(SUM(cm.amount), 0) FROM commissions cm
          JOIN contracts ct ON ct.id = cm.contract_id
          JOIN lead_details ld ON ld.client_id = ct.client_id
          WHERE ld.partner_id = p.id AND cm.status = 'payee') AS commissions_paid
       FROM partners p ORDER BY p.updated_at DESC`
    )
    .all();
  res.json(rows);
});

partnersRouter.get('/:id', (req, res) => {
  const partner = db.prepare('SELECT * FROM partners WHERE id = ?').get(req.params.id);
  if (!partner) return res.status(404).json({ error: 'Partenaire introuvable.' });
  const notes = db
    .prepare('SELECT * FROM partner_notes WHERE partner_id = ? ORDER BY created_at DESC')
    .all(partner.id);
  const leads = db
    .prepare(
      `SELECT c.id, c.type, c.first_name, c.last_name, c.company_name, c.status,
        ld.pipeline_stage
       FROM lead_details ld JOIN clients c ON c.id = ld.client_id
       WHERE ld.partner_id = ? ORDER BY ld.created_at DESC`
    )
    .all(partner.id)
    .map((r) => ({
      id: r.id, status: r.status, pipeline_stage: r.pipeline_stage,
      name: r.type === 'entreprise' ? r.company_name : [r.first_name, r.last_name].filter(Boolean).join(' '),
    }));
  res.json({ ...partner, notes, leads });
});

partnersRouter.post('/', (req, res) => {
  const data = pick(req.body);
  if (!data.name) return res.status(400).json({ error: 'Le nom du partenaire est requis.' });
  validatePartner(data);
  const fields = Object.keys(data);
  const info = db
    .prepare(`INSERT INTO partners (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`)
    .run(...fields.map((f) => data[f]));
  audit(req, 'création partenaire', 'partner', info.lastInsertRowid, data.name);
  res.status(201).json({ id: info.lastInsertRowid });
});

partnersRouter.put('/:id', (req, res) => {
  const partner = db.prepare('SELECT * FROM partners WHERE id = ?').get(req.params.id);
  if (!partner) return res.status(404).json({ error: 'Partenaire introuvable.' });
  const data = pick(req.body);
  validatePartner(data);
  if (Object.keys(data).length === 0) return res.json({ ok: true });
  const fields = Object.keys(data);
  db.prepare(
    `UPDATE partners SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`
  ).run(...fields.map((f) => data[f]), partner.id);
  audit(req, 'modification partenaire', 'partner', partner.id, data.stage || partner.name);
  res.json({ ok: true });
});

partnersRouter.delete('/:id', (req, res) => {
  const used = db.prepare('SELECT COUNT(*) AS n FROM lead_details WHERE partner_id = ?').get(req.params.id).n;
  if (used > 0) {
    return res.status(400).json({
      error: 'Des prospects sont rattachés à ce partenaire. Passez-le en « inactif » plutôt que de le supprimer.',
    });
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM partner_notes WHERE partner_id = ?').run(req.params.id);
    db.prepare('DELETE FROM partners WHERE id = ?').run(req.params.id);
  });
  tx();
  audit(req, 'suppression partenaire', 'partner', Number(req.params.id));
  res.json({ ok: true });
});

partnersRouter.post('/:id/notes', (req, res) => {
  const partner = db.prepare('SELECT id FROM partners WHERE id = ?').get(req.params.id);
  if (!partner) return res.status(404).json({ error: 'Partenaire introuvable.' });
  const { content } = req.body || {};
  if (!content) return res.status(400).json({ error: 'Le contenu est requis.' });
  checkTextFields({ content }, ['content'], 2000);
  const info = db
    .prepare('INSERT INTO partner_notes (partner_id, content) VALUES (?, ?)')
    .run(partner.id, content);
  db.prepare("UPDATE partners SET updated_at = datetime('now') WHERE id = ?").run(partner.id);
  audit(req, 'note partenaire', 'partner', partner.id);
  res.status(201).json({ id: info.lastInsertRowid });
});
