import { Router } from 'express';
import db from '../db.js';
import { audit } from '../audit.js';
import { assert, isDateStr, inEnum, checkTextFields } from '../validate.js';
import {
  CommissionCalcError, COMMISSION_MODES, FIXED_ONLY_BRANCHES,
  assertCommissionModeAllowed, defaultCommissionModeForBranch,
} from '../commissionCalc.js';

export const commissionsRouter = Router();

const COMMISSION_STATUSES = [
  'expected', 'partially_received', 'received', 'disputed', 'cancelled', 'reversed',
];
const COMMISSION_TYPES = ['acquisition', 'recurrente', 'ajustement', 'reprise'];

// Le montant reçu doit toujours avoir le même signe que le montant attendu
// (positif pour une commission normale, négatif pour une ligne de reprise —
// cf. POST /:id/reverse) et ne jamais dépasser ce dernier en valeur
// absolue : ni un paiement partiel supérieur à 100 %, ni une reprise
// supérieure au montant initialement attendu.
function assertAmountsCoherent(expected, received) {
  const e = Number(expected);
  const r = Number(received);
  assert(Number.isFinite(e), 'Le montant attendu doit être un nombre.');
  assert(Number.isFinite(r), 'Le montant reçu doit être un nombre.');
  if (e === 0) {
    assert(r === 0, 'Le montant reçu doit être nul si aucun montant n’est attendu.');
    return;
  }
  const sameSign = e > 0 ? r >= 0 : r <= 0;
  assert(sameSign, 'Le montant reçu doit avoir le même signe que le montant attendu.');
  assert(Math.abs(r) <= Math.abs(e) + 0.01, 'Le montant reçu ne peut pas dépasser le montant attendu (en valeur absolue).');
}

function validateCommission({
  type, status, commission_mode, expected_amount_chf, received_amount_chf,
  expected_payment_date, received_payment_date, ...rest
}) {
  assert(inEnum(type, COMMISSION_TYPES), 'Type de commission inconnu.');
  assert(inEnum(status, COMMISSION_STATUSES), 'Statut de commission inconnu.');
  assert(inEnum(commission_mode, COMMISSION_MODES), 'Mode de commission inconnu.');
  assert(
    expected_amount_chf == null || Number.isFinite(Number(expected_amount_chf)),
    'Le montant attendu doit être un nombre.'
  );
  assert(isDateStr(expected_payment_date), 'Date d’échéance attendue invalide (AAAA-MM-JJ).');
  assert(isDateStr(received_payment_date), 'Date de réception invalide (AAAA-MM-JJ).');
  if (expected_amount_chf != null && received_amount_chf != null) {
    assertAmountsCoherent(expected_amount_chf, received_amount_chf);
  }
  checkTextFields(rest, ['label', 'notes'], 500);
  checkTextFields(rest, ['product_name', 'insured_label', 'insurer_statement_reference'], 200);
  checkTextFields(rest, ['accounting_period'], 20);
}

// Une commission ne peut plus jamais être supprimée dès qu'un montant a
// été (partiellement) reçu, qu'elle constitue elle-même une reprise, ou
// qu'elle a déjà fait l'objet d'une reprise — l'historique doit toujours
// rester intact (§5). Utilisé par DELETE /:id ci-dessous et par le garde-
// fou équivalent de contractsRouter.delete('/:id').
function isProtectedFromDeletion(commission) {
  if (['received', 'partially_received', 'reversed'].includes(commission.status)) return true;
  if (Number(commission.received_amount_chf) !== 0) return true;
  if (commission.reversal_of_commission_id != null) return true;
  return false;
}

const SELECT_BASE = `
    SELECT cm.*, ct.branch, ct.policy_number, ct.product_name AS contract_product_name,
      co.name AS company_name, ct.client_id,
      cl.first_name, cl.last_name, cl.company_name AS client_company, cl.type AS client_type
    FROM commissions cm
    JOIN contracts ct ON ct.id = cm.contract_id
    JOIN companies co ON co.id = ct.company_id
    JOIN clients cl ON cl.id = ct.client_id
    WHERE 1=1`;

function withClientName(r) {
  return {
    ...r,
    client_name:
      r.client_type === 'entreprise'
        ? r.client_company
        : [r.first_name, r.last_name].filter(Boolean).join(' '),
  };
}

commissionsRouter.get('/', (req, res) => {
  const { status, year, company_id, contract_id, branch, product, accounting_period } = req.query;
  let sql = SELECT_BASE;
  const params = [];
  if (status) { sql += ' AND cm.status = ?'; params.push(status); }
  if (year) { sql += " AND strftime('%Y', cm.expected_payment_date) = ?"; params.push(String(year)); }
  if (company_id) { sql += ' AND ct.company_id = ?'; params.push(company_id); }
  if (contract_id) { sql += ' AND cm.contract_id = ?'; params.push(contract_id); }
  if (branch) { sql += ' AND ct.branch = ?'; params.push(branch); }
  if (accounting_period) { sql += ' AND cm.accounting_period = ?'; params.push(accounting_period); }
  if (product) {
    sql += ' AND (cm.product_name LIKE ? OR ct.product_name LIKE ?)';
    const like = `%${product}%`;
    params.push(like, like);
  }
  sql += ' ORDER BY cm.expected_payment_date DESC, cm.id DESC';
  res.json(db.prepare(sql).all(...params).map(withClientName));
});

commissionsRouter.post('/', (req, res) => {
  const {
    contract_id, type, label, commission_mode, expected_amount_chf, received_amount_chf,
    expected_payment_date, received_payment_date, status, product_name, insured_label,
    insurer_statement_reference, accounting_period, notes,
  } = req.body || {};
  if (!contract_id || expected_amount_chf == null) {
    return res.status(400).json({ error: 'Contrat et montant attendu sont requis.' });
  }
  const contract = db.prepare('SELECT id, branch FROM contracts WHERE id = ?').get(contract_id);
  if (!contract) return res.status(400).json({ error: 'Contrat introuvable.' });
  assert(Number(expected_amount_chf) >= 0, 'Le montant attendu d’une commission créée ici ne peut pas être négatif (utilisez une reprise, POST /:id/reverse, pour un montant négatif).');

  const mode = commission_mode || defaultCommissionModeForBranch(contract.branch);
  try {
    assertCommissionModeAllowed(contract.branch, mode);
  } catch (err) {
    if (err instanceof CommissionCalcError) return res.status(400).json({ error: err.message });
    throw err;
  }

  const data = {
    type: type || 'ajustement',
    status: status || 'expected',
    commission_mode: mode,
    expected_amount_chf: Number(expected_amount_chf),
    received_amount_chf: received_amount_chf != null ? Number(received_amount_chf) : 0,
    expected_payment_date, received_payment_date, label, product_name, insured_label,
    insurer_statement_reference, accounting_period, notes,
  };
  validateCommission(data);

  const info = db
    .prepare(
      `INSERT INTO commissions (
        contract_id, type, label, expected_amount_chf, received_amount_chf, expected_payment_date,
        received_payment_date, status, commission_mode, product_name, insured_label,
        insurer_statement_reference, accounting_period, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      contract_id, data.type, data.label || null, data.expected_amount_chf, data.received_amount_chf,
      data.expected_payment_date || null, data.received_payment_date || null, data.status, data.commission_mode,
      data.product_name || null, data.insured_label || null, data.insurer_statement_reference || null,
      data.accounting_period || null, data.notes || null
    );
  audit(req, 'création commission', 'commission', info.lastInsertRowid, `${data.commission_mode} CHF ${data.expected_amount_chf}`);
  res.status(201).json({ id: info.lastInsertRowid });
});

commissionsRouter.put('/:id', (req, res) => {
  const commission = db.prepare('SELECT * FROM commissions WHERE id = ?').get(req.params.id);
  if (!commission) return res.status(404).json({ error: 'Commission introuvable.' });
  const contract = db.prepare('SELECT branch FROM contracts WHERE id = ?').get(commission.contract_id);
  const {
    status, received_amount_chf, expected_amount_chf, commission_mode, expected_payment_date,
    received_payment_date, label, product_name, insured_label, insurer_statement_reference,
    accounting_period, notes, type,
  } = req.body || {};

  // Une fois qu'un montant a été (partiellement) reçu, que la ligne est
  // une reprise, ou qu'elle a déjà été reprise, son montant attendu, son
  // mode et son type deviennent immuables — toute correction financière
  // passe désormais par une reprise (POST /:id/reverse), jamais par une
  // modification silencieuse de la ligne d'origine (§5).
  const financialsLocked =
    ['received', 'partially_received', 'reversed'].includes(commission.status) ||
    commission.reversal_of_commission_id != null;
  if (financialsLocked && (expected_amount_chf != null || commission_mode != null || type != null)) {
    return res.status(400).json({
      error: 'Le montant attendu, le mode ou le type d’une commission déjà (partiellement) reçue, reprise, ou constituant elle-même une reprise ne peut plus être modifié. Utilisez une reprise pour corriger un montant déjà reçu.',
    });
  }

  const nextMode = commission_mode ?? commission.commission_mode;
  if (commission_mode != null && contract) {
    try {
      assertCommissionModeAllowed(contract.branch, nextMode);
    } catch (err) {
      if (err instanceof CommissionCalcError) return res.status(400).json({ error: err.message });
      throw err;
    }
  }

  const nextStatus = status || commission.status;
  const nextExpected = expected_amount_chf != null ? Number(expected_amount_chf) : commission.expected_amount_chf;
  // Marquer une commission « reçue » sans préciser de montant reprend, par
  // défaut, le montant attendu en totalité — préserve le geste « Payée ✓ »
  // en un clic du modèle précédent ; un paiement partiel reste possible en
  // fournissant explicitement received_amount_chf avec le statut
  // 'partially_received'.
  const nextReceived = received_amount_chf != null
    ? Number(received_amount_chf)
    : (status === 'received' && commission.received_amount_chf === 0 ? nextExpected : commission.received_amount_chf);

  if (nextStatus === 'cancelled') {
    assert(nextReceived === 0, 'Une commission ayant déjà reçu un montant ne peut pas être annulée — utilisez une reprise.');
  }

  validateCommission({
    type: type ?? commission.type,
    status: nextStatus,
    commission_mode: nextMode,
    expected_amount_chf: nextExpected,
    received_amount_chf: nextReceived,
    expected_payment_date, received_payment_date, label, product_name, insured_label,
    insurer_statement_reference, accounting_period, notes,
  });

  // received_payment_date : une date explicitement fournie prévaut toujours ;
  // sinon, un statut (résolu) 'received'/'partially_received' la remplit
  // par défaut à aujourd'hui si elle est encore vide ; sinon, si `status`
  // a été explicitement fourni dans la requête et ne correspond plus à un
  // état reçu, elle est effacée (plus rien n'est réputé reçu) ; sinon,
  // elle est conservée telle quelle.
  db.prepare(
    `UPDATE commissions SET
      status = ?,
      received_payment_date = CASE
        WHEN ? IS NOT NULL THEN ?
        WHEN ? IN ('received', 'partially_received') THEN COALESCE(received_payment_date, date('now'))
        WHEN ? THEN NULL
        ELSE received_payment_date
      END,
      expected_amount_chf = ?,
      received_amount_chf = ?,
      commission_mode = ?,
      type = COALESCE(?, type),
      expected_payment_date = COALESCE(?, expected_payment_date),
      label = COALESCE(?, label),
      product_name = COALESCE(?, product_name),
      insured_label = COALESCE(?, insured_label),
      insurer_statement_reference = COALESCE(?, insurer_statement_reference),
      accounting_period = COALESCE(?, accounting_period),
      notes = COALESCE(?, notes)
     WHERE id = ?`
  ).run(
    nextStatus,
    received_payment_date || null, received_payment_date || null,
    nextStatus,
    status != null ? 1 : 0,
    nextExpected, nextReceived, nextMode,
    type || null,
    expected_payment_date || null, label || null, product_name || null, insured_label || null,
    insurer_statement_reference || null, accounting_period || null, notes || null,
    commission.id
  );
  audit(req, 'modification commission', 'commission', commission.id, nextStatus);
  res.json({ ok: true });
});

commissionsRouter.delete('/:id', (req, res) => {
  const commission = db.prepare('SELECT * FROM commissions WHERE id = ?').get(req.params.id);
  if (!commission) return res.status(404).json({ error: 'Commission introuvable.' });
  const reversedByCount = db
    .prepare('SELECT COUNT(*) AS n FROM commissions WHERE reversal_of_commission_id = ?')
    .get(commission.id).n;
  if (isProtectedFromDeletion(commission) || reversedByCount > 0) {
    return res.status(400).json({
      error: 'Une commission (partiellement) reçue, une reprise, ou une commission ayant fait l’objet d’une reprise ne peut pas être supprimée (conservation comptable). Annulez-la ou créez une reprise plutôt.',
    });
  }
  db.prepare('DELETE FROM commissions WHERE id = ?').run(commission.id);
  audit(req, 'suppression commission', 'commission', commission.id);
  res.json({ ok: true });
});

// Reprise/annulation d'une commission déjà émise : ne modifie ni ne
// supprime jamais la ligne d'origine (seul son statut passe à 'reversed')
// — une NOUVELLE ligne négative, liée par reversal_of_commission_id, porte
// le montant repris. Le net attendu/reçu du contrat se recalcule alors
// correctement par simple somme (§5), sans aucun cas particulier côté
// lecture : la reprise contribue négativement aux mêmes colonnes
// expected_amount_chf/received_amount_chf que n'importe quelle autre ligne.
commissionsRouter.post('/:id/reverse', (req, res) => {
  const original = db.prepare('SELECT * FROM commissions WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Commission introuvable.' });
  if (original.status === 'cancelled') {
    return res.status(400).json({ error: 'Une commission annulée ne peut pas faire l’objet d’une reprise (aucun montant n’a jamais été attendu ni reçu).' });
  }
  const { reversal_amount_chf, notes, expected_payment_date } = req.body || {};
  assert(
    reversal_amount_chf != null && Number.isFinite(Number(reversal_amount_chf)) && Number(reversal_amount_chf) < 0,
    'Le montant de la reprise est requis et doit être un nombre négatif (montant repris, en CHF).'
  );
  const amount = Number(reversal_amount_chf);
  assert(
    Math.abs(amount) <= Math.abs(original.expected_amount_chf) + 0.01,
    'Le montant de la reprise ne peut pas dépasser (en valeur absolue) le montant initialement attendu de la commission d’origine.'
  );
  assert(isDateStr(expected_payment_date), 'Date d’échéance de la reprise invalide (AAAA-MM-JJ).');
  checkTextFields({ notes }, ['notes'], 500);

  const reversalId = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO commissions (
          contract_id, type, label, expected_amount_chf, received_amount_chf, expected_payment_date,
          status, commission_mode, product_name, insured_label, reversal_of_commission_id,
          reversal_amount_chf, notes
        ) VALUES (?, 'reprise', ?, ?, 0, ?, 'expected', 'manual_adjustment', ?, ?, ?, ?, ?)`
      )
      .run(
        original.contract_id, `Reprise de la commission #${original.id}`, amount,
        expected_payment_date || null, original.product_name, original.insured_label,
        original.id, amount, notes || null
      );
    db.prepare(`UPDATE commissions SET status = 'reversed' WHERE id = ?`).run(original.id);
    return info.lastInsertRowid;
  })();
  audit(req, 'reprise de commission', 'commission', reversalId, `reprise de #${original.id}, CHF ${amount}`);
  audit(req, 'commission marquée reprise', 'commission', original.id, `reprise #${reversalId}`);
  res.status(201).json({ id: reversalId, reversed_commission_id: original.id });
});

// Génère les commissions récurrentes (portefeuille) de l'année demandée
// pour tous les contrats actifs qui n'en ont pas encore pour cette année.
// Exclut structurellement les branches LAMal/LCA (FIXED_ONLY_BRANCHES) :
// aucune commission récurrente n'y est jamais calculée automatiquement à
// partir d'un taux — cf. server/commissionCalc.js.
commissionsRouter.post('/generate-recurring', (req, res) => {
  const year = Number(req.body?.year) || new Date().getFullYear();
  const branchPlaceholders = FIXED_ONLY_BRANCHES.map(() => '?').join(', ');
  const contracts = db
    .prepare(
      `SELECT ct.* FROM contracts ct
       WHERE ct.status = 'actif' AND ct.rec_commission_rate > 0 AND ct.annual_premium > 0
         AND ct.branch NOT IN (${branchPlaceholders})
         AND (ct.start_date IS NULL OR strftime('%Y', ct.start_date) <= ?)
         AND NOT EXISTS (
           SELECT 1 FROM commissions cm
           WHERE cm.contract_id = ct.id AND cm.type = 'recurrente'
             AND strftime('%Y', cm.expected_payment_date) = ?
         )`
    )
    .all(...FIXED_ONLY_BRANCHES, String(year), String(year));
  const insert = db.prepare(
    `INSERT INTO commissions (contract_id, type, label, expected_amount_chf, expected_payment_date, status, commission_mode)
     VALUES (?, 'recurrente', ?, ?, ?, 'expected', 'percentage')`
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
