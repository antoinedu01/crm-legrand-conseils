import { Router } from 'express';
import db from '../db.js';
import { audit } from '../audit.js';
import { assert, isEmail, isNonNegNumber, checkTextFields } from '../validate.js';

export const companiesRouter = Router();

function validateCompany(data) {
  assert(data.contact_email == null || isEmail(data.contact_email), 'Adresse e-mail de contact invalide.');
  assert(isNonNegNumber(data.default_acq_rate), 'Le taux d’acquisition doit être un nombre positif.');
  assert(isNonNegNumber(data.default_rec_rate), 'Le taux récurrent doit être un nombre positif.');
  assert(Number(data.default_acq_rate || 0) <= 100 && Number(data.default_rec_rate || 0) <= 100,
    'Un taux de commission ne peut pas dépasser 100 %.');
  checkTextFields(data, ['name', 'finma_number', 'contact_name', 'contact_phone'], 200);
  checkTextFields(data, ['notes'], 5000);
}

const FIELDS = [
  'name', 'finma_number', 'contact_name', 'contact_email', 'contact_phone',
  'default_acq_rate', 'default_rec_rate', 'notes', 'active',
];

function pick(body) {
  const out = {};
  for (const f of FIELDS) if (f in (body || {})) out[f] = body[f] === '' ? null : body[f];
  if ('active' in out) out.active = out.active ? 1 : 0;
  return out;
}

companiesRouter.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT co.*,
        (SELECT COUNT(*) FROM contracts ct WHERE ct.company_id = co.id AND ct.status = 'actif') AS active_contracts,
        (SELECT COALESCE(SUM(cm.received_amount_chf), 0) FROM commissions cm
          JOIN contracts ct ON ct.id = cm.contract_id
          WHERE ct.company_id = co.id AND cm.status != 'cancelled') AS commissions_paid,
        (SELECT COALESCE(SUM(cm.expected_amount_chf - cm.received_amount_chf), 0) FROM commissions cm
          JOIN contracts ct ON ct.id = cm.contract_id
          WHERE ct.company_id = co.id AND cm.status != 'cancelled') AS commissions_pending
       FROM companies co ORDER BY co.active DESC, co.name COLLATE NOCASE`
    )
    .all();
  res.json(rows);
});

companiesRouter.post('/', (req, res) => {
  const data = pick(req.body);
  if (!data.name) return res.status(400).json({ error: 'Le nom de la compagnie est requis.' });
  validateCompany(data);
  const fields = Object.keys(data);
  const info = db
    .prepare(`INSERT INTO companies (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`)
    .run(...fields.map((f) => data[f]));
  audit(req, 'création compagnie', 'company', info.lastInsertRowid, data.name);
  res.status(201).json({ id: info.lastInsertRowid });
});

companiesRouter.put('/:id', (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Compagnie introuvable.' });
  const data = pick(req.body);
  if (Object.keys(data).length === 0) return res.json({ ok: true });
  validateCompany(data);
  const fields = Object.keys(data);
  db.prepare(`UPDATE companies SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(
    ...fields.map((f) => data[f]),
    company.id
  );
  audit(req, 'modification compagnie', 'company', company.id, company.name);
  res.json({ ok: true });
});

companiesRouter.delete('/:id', (req, res) => {
  const used = db
    .prepare('SELECT COUNT(*) AS n FROM contracts WHERE company_id = ?')
    .get(req.params.id).n;
  if (used > 0) {
    return res.status(400).json({
      error: 'Des contrats sont liés à cette compagnie. Désactivez-la plutôt que de la supprimer.',
    });
  }
  db.prepare('DELETE FROM companies WHERE id = ?').run(req.params.id);
  audit(req, 'suppression compagnie', 'company', Number(req.params.id));
  res.json({ ok: true });
});
