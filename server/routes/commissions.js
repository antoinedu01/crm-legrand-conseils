import { Router } from 'express';
import db from '../db.js';
import { audit } from '../audit.js';

export const commissionsRouter = Router();

commissionsRouter.get('/', (req, res) => {
  const { status, year, company_id } = req.query;
  let sql = `
    SELECT cm.*, ct.branch, ct.policy_number, co.name AS company_name, ct.client_id,
      cl.first_name, cl.last_name, cl.company_name AS client_company, cl.type AS client_type
    FROM commissions cm
    JOIN contracts ct ON ct.id = cm.contract_id
    JOIN companies co ON co.id = ct.company_id
    JOIN clients cl ON cl.id = ct.client_id
    WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND cm.status = ?'; params.push(status); }
  if (year) { sql += " AND strftime('%Y', cm.due_date) = ?"; params.push(String(year)); }
  if (company_id) { sql += ' AND ct.company_id = ?'; params.push(company_id); }
  sql += ' ORDER BY cm.due_date DESC, cm.id DESC';
  res.json(
    db.prepare(sql).all(...params).map((r) => ({
      ...r,
      client_name:
        r.client_type === 'entreprise'
          ? r.client_company
          : [r.first_name, r.last_name].filter(Boolean).join(' '),
    }))
  );
});

commissionsRouter.post('/', (req, res) => {
  const { contract_id, type, label, amount, due_date, notes } = req.body || {};
  if (!contract_id || !amount) {
    return res.status(400).json({ error: 'Contrat et montant sont requis.' });
  }
  const contract = db.prepare('SELECT id FROM contracts WHERE id = ?').get(contract_id);
  if (!contract) return res.status(400).json({ error: 'Contrat introuvable.' });
  const info = db
    .prepare(
      `INSERT INTO commissions (contract_id, type, label, amount, due_date, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(contract_id, type || 'ajustement', label || null, Number(amount), due_date || null, notes || null);
  audit(req, 'création commission', 'commission', info.lastInsertRowid, `CHF ${amount}`);
  res.status(201).json({ id: info.lastInsertRowid });
});

commissionsRouter.put('/:id', (req, res) => {
  const commission = db.prepare('SELECT * FROM commissions WHERE id = ?').get(req.params.id);
  if (!commission) return res.status(404).json({ error: 'Commission introuvable.' });
  const { status, paid_date, amount, due_date, label, notes } = req.body || {};
  db.prepare(
    `UPDATE commissions SET
      status = COALESCE(?, status),
      paid_date = CASE WHEN ? = 'payee' THEN COALESCE(?, date('now')) WHEN ? IS NOT NULL THEN NULL ELSE paid_date END,
      amount = COALESCE(?, amount),
      due_date = COALESCE(?, due_date),
      label = COALESCE(?, label),
      notes = COALESCE(?, notes)
     WHERE id = ?`
  ).run(
    status || null, status || null, paid_date || null,
    status && status !== 'payee' ? status : null,
    amount != null ? Number(amount) : null,
    due_date || null, label || null, notes || null,
    commission.id
  );
  audit(req, 'modification commission', 'commission', commission.id, status || '');
  res.json({ ok: true });
});

commissionsRouter.delete('/:id', (req, res) => {
  const commission = db.prepare('SELECT * FROM commissions WHERE id = ?').get(req.params.id);
  if (!commission) return res.status(404).json({ error: 'Commission introuvable.' });
  if (commission.status === 'payee') {
    return res.status(400).json({
      error: 'Une commission payée ne peut pas être supprimée (conservation comptable). Annulez-la avec une écriture d’ajustement.',
    });
  }
  db.prepare('DELETE FROM commissions WHERE id = ?').run(commission.id);
  audit(req, 'suppression commission', 'commission', commission.id);
  res.json({ ok: true });
});

// Génère les commissions récurrentes (portefeuille) de l'année demandée
// pour tous les contrats actifs qui n'en ont pas encore pour cette année.
commissionsRouter.post('/generate-recurring', (req, res) => {
  const year = Number(req.body?.year) || new Date().getFullYear();
  const contracts = db
    .prepare(
      `SELECT ct.* FROM contracts ct
       WHERE ct.status = 'actif' AND ct.rec_commission_rate > 0 AND ct.annual_premium > 0
         AND (ct.start_date IS NULL OR strftime('%Y', ct.start_date) <= ?)
         AND NOT EXISTS (
           SELECT 1 FROM commissions cm
           WHERE cm.contract_id = ct.id AND cm.type = 'recurrente'
             AND strftime('%Y', cm.due_date) = ?
         )`
    )
    .all(String(year), String(year));
  const insert = db.prepare(
    `INSERT INTO commissions (contract_id, type, label, amount, due_date, status)
     VALUES (?, 'recurrente', ?, ?, ?, 'attendue')`
  );
  const tx = db.transaction(() => {
    for (const ct of contracts) {
      const amount = Math.round(ct.annual_premium * ct.rec_commission_rate) / 100;
      insert.run(ct.id, `Commission de portefeuille ${year}`, amount, `${year}-12-31`);
    }
  });
  tx();
  audit(req, 'génération commissions récurrentes', 'commission', null, `${contracts.length} commissions pour ${year}`);
  res.json({ created: contracts.length, year });
});
