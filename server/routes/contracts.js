import { Router } from 'express';
import db from '../db.js';
import { audit } from '../audit.js';

export const contractsRouter = Router();

export const BRANCHES = [
  'vie_3a', 'vie_3b', 'lamal', 'lca', 'lpp', 'hypotheque', 'rc_menage', 'autre',
];

const FIELDS = [
  'client_id', 'company_id', 'branch', 'policy_number', 'product_name', 'annual_premium',
  'payment_frequency', 'start_date', 'end_date', 'status',
  'acq_commission_rate', 'rec_commission_rate', 'notes',
];

function pick(body) {
  const out = {};
  for (const f of FIELDS) if (f in (body || {})) out[f] = body[f] === '' ? null : body[f];
  return out;
}

contractsRouter.get('/', (req, res) => {
  const { client_id, company_id, status, branch, q } = req.query;
  let sql = `
    SELECT ct.*, co.name AS company_name,
      cl.first_name, cl.last_name, cl.company_name AS client_company, cl.type AS client_type,
      (SELECT COALESCE(SUM(amount), 0) FROM commissions WHERE contract_id = ct.id AND status = 'payee') AS commissions_paid,
      (SELECT COALESCE(SUM(amount), 0) FROM commissions WHERE contract_id = ct.id AND status = 'attendue') AS commissions_pending
    FROM contracts ct
    JOIN companies co ON co.id = ct.company_id
    JOIN clients cl ON cl.id = ct.client_id
    WHERE 1=1`;
  const params = [];
  if (client_id) { sql += ' AND ct.client_id = ?'; params.push(client_id); }
  if (company_id) { sql += ' AND ct.company_id = ?'; params.push(company_id); }
  if (status) { sql += ' AND ct.status = ?'; params.push(status); }
  if (branch) { sql += ' AND ct.branch = ?'; params.push(branch); }
  if (q) {
    sql += ` AND (ct.policy_number LIKE ? OR ct.product_name LIKE ? OR co.name LIKE ?
             OR cl.first_name LIKE ? OR cl.last_name LIKE ? OR cl.company_name LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like);
  }
  sql += ' ORDER BY ct.created_at DESC';
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

// Création d'un contrat : les commissions attendues sont générées automatiquement
contractsRouter.post('/', (req, res) => {
  const data = pick(req.body);
  if (!data.client_id || !data.company_id || !data.branch) {
    return res.status(400).json({ error: 'Client, compagnie et branche sont requis.' });
  }
  if (!BRANCHES.includes(data.branch)) {
    return res.status(400).json({ error: 'Branche inconnue.' });
  }
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(data.client_id);
  if (!client) return res.status(400).json({ error: 'Client introuvable.' });

  // Garde-fou conformité : pas de contrat actif sans mandat ni information LSA
  const warnings = [];
  if (!client.mandate_signed) warnings.push('Le mandat de courtage n’est pas signé.');
  if (!client.info_lsa_date) warnings.push('L’information selon l’art. 45 LSA n’a pas été remise.');
  if (!client.consent_data) warnings.push('Le consentement nLPD au traitement des données n’est pas enregistré.');

  const premium = Number(data.annual_premium) || 0;
  const acqRate = Number(data.acq_commission_rate) || 0;

  const tx = db.transaction(() => {
    const fields = Object.keys(data);
    const info = db
      .prepare(`INSERT INTO contracts (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`)
      .run(...fields.map((f) => data[f]));
    const contractId = info.lastInsertRowid;
    // Commission d'acquisition générée automatiquement
    if (premium > 0 && acqRate > 0) {
      db.prepare(
        `INSERT INTO commissions (contract_id, type, label, amount, due_date, status)
         VALUES (?, 'acquisition', 'Commission d''acquisition', ?, ?, 'attendue')`
      ).run(contractId, Math.round(premium * acqRate) / 100, data.start_date || null);
    }
    return contractId;
  });
  const contractId = tx();
  audit(req, 'création contrat', 'contract', contractId, `${data.branch} — client #${data.client_id}`);
  res.status(201).json({ id: contractId, warnings });
});

contractsRouter.put('/:id', (req, res) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contrat introuvable.' });
  const data = pick(req.body);
  if ('branch' in data && !BRANCHES.includes(data.branch)) {
    return res.status(400).json({ error: 'Branche inconnue.' });
  }
  if (Object.keys(data).length === 0) return res.json({ ok: true });
  const fields = Object.keys(data);
  db.prepare(
    `UPDATE contracts SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`
  ).run(...fields.map((f) => data[f]), contract.id);
  audit(req, 'modification contrat', 'contract', contract.id, fields.join(', '));
  res.json({ ok: true });
});

contractsRouter.delete('/:id', (req, res) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contrat introuvable.' });
  const paid = db
    .prepare("SELECT COUNT(*) AS n FROM commissions WHERE contract_id = ? AND status = 'payee'")
    .get(contract.id).n;
  if (paid > 0) {
    return res.status(400).json({
      error: 'Des commissions payées sont liées à ce contrat (conservation comptable 10 ans, art. 958f CO). Passez-le en « résilié » plutôt que de le supprimer.',
    });
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM commissions WHERE contract_id = ?').run(contract.id);
    db.prepare('DELETE FROM tasks WHERE contract_id = ?').run(contract.id);
    db.prepare('DELETE FROM contracts WHERE id = ?').run(contract.id);
  });
  tx();
  audit(req, 'suppression contrat', 'contract', contract.id, contract.policy_number || '');
  res.json({ ok: true });
});
