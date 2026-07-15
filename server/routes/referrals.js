import { Router } from 'express';
import db from '../db.js';

export const referralsRouter = Router();

// Vue « Recommandations » : construite à partir des liens parrain → filleul
// (lead_details.referrer_client_id). Aucun envoi automatique : le CRM montre
// qui remercier et où en sont les filleuls, c'est vous qui agissez.
referralsRouter.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT
        ref.id AS parrain_id, ref.type AS parrain_type, ref.first_name AS parrain_first,
        ref.last_name AS parrain_last, ref.company_name AS parrain_company,
        c.id AS filleul_id, c.type AS filleul_type, c.first_name AS filleul_first,
        c.last_name AS filleul_last, c.company_name AS filleul_company,
        c.status AS filleul_status, c.consent_data AS filleul_consent,
        ld.pipeline_stage, ld.created_at AS referred_at,
        (SELECT COUNT(*) FROM contracts ct WHERE ct.client_id = c.id AND ct.status = 'actif') AS contracts_won,
        (SELECT COALESCE(SUM(cm.amount), 0) FROM commissions cm
          JOIN contracts ct ON ct.id = cm.contract_id
          WHERE ct.client_id = c.id AND cm.status = 'payee') AS commissions_paid
       FROM lead_details ld
       JOIN clients c ON c.id = ld.client_id
       JOIN clients ref ON ref.id = ld.referrer_client_id
       WHERE ld.referrer_client_id IS NOT NULL
       ORDER BY ld.created_at DESC`
    )
    .all();

  const name = (type, first, last, company) =>
    type === 'entreprise' ? company : [first, last].filter(Boolean).join(' ');

  const byParrain = new Map();
  for (const r of rows) {
    if (!byParrain.has(r.parrain_id)) {
      byParrain.set(r.parrain_id, {
        parrain_id: r.parrain_id,
        parrain_name: name(r.parrain_type, r.parrain_first, r.parrain_last, r.parrain_company),
        filleuls: [],
        total_contracts: 0,
        total_commissions: 0,
      });
    }
    const group = byParrain.get(r.parrain_id);
    group.filleuls.push({
      id: r.filleul_id,
      name: name(r.filleul_type, r.filleul_first, r.filleul_last, r.filleul_company),
      status: r.filleul_status,
      consent: Boolean(r.filleul_consent),
      pipeline_stage: r.pipeline_stage,
      referred_at: r.referred_at,
      contracts_won: r.contracts_won,
    });
    group.total_contracts += r.contracts_won;
    group.total_commissions += r.commissions_paid;
  }

  const parrains = [...byParrain.values()].sort((a, b) => b.filleuls.length - a.filleuls.length);
  const totals = {
    referrals: rows.length,
    meetings: rows.filter((r) => ['rdv', 'analyse', 'offre', 'signe'].includes(r.pipeline_stage)).length,
    contracts: rows.reduce((s, r) => s + r.contracts_won, 0),
    commissions: rows.reduce((s, r) => s + r.commissions_paid, 0),
  };
  res.json({ parrains, totals });
});
