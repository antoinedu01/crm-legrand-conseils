import { Router } from 'express';
import db from '../db.js';

export const dashboardRouter = Router();

dashboardRouter.get('/', (req, res) => {
  const year = String(new Date().getFullYear());

  const clients = db
    .prepare("SELECT COUNT(*) AS n FROM clients WHERE status IN ('client', 'prospect')")
    .get().n;
  const prospects = db.prepare("SELECT COUNT(*) AS n FROM clients WHERE status = 'prospect'").get().n;
  const activeContracts = db
    .prepare("SELECT COUNT(*) AS n FROM contracts WHERE status = 'actif'")
    .get().n;
  const totalPremiums = db
    .prepare("SELECT COALESCE(SUM(annual_premium), 0) AS s FROM contracts WHERE status = 'actif'")
    .get().s;

  const commissionsPaidYear = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS s FROM commissions
       WHERE status = 'payee' AND strftime('%Y', COALESCE(paid_date, due_date)) = ?`
    )
    .get(year).s;
  const commissionsPending = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM commissions WHERE status = 'attendue'")
    .get().s;

  // Série mensuelle des commissions (12 derniers mois, payées + attendues)
  const monthly = db
    .prepare(
      `SELECT strftime('%Y-%m', due_date) AS month,
        SUM(CASE WHEN status = 'payee' THEN amount ELSE 0 END) AS paid,
        SUM(CASE WHEN status = 'attendue' THEN amount ELSE 0 END) AS pending
       FROM commissions
       WHERE due_date >= date('now', '-12 months') AND due_date <= date('now', '+1 month')
       GROUP BY month ORDER BY month`
    )
    .all();

  const byBranch = db
    .prepare(
      `SELECT branch, COUNT(*) AS n, COALESCE(SUM(annual_premium), 0) AS premiums
       FROM contracts WHERE status = 'actif' GROUP BY branch ORDER BY n DESC`
    )
    .all();

  const upcomingTasks = db
    .prepare(
      `SELECT t.*, cl.first_name, cl.last_name, cl.company_name AS client_company, cl.type AS client_type
       FROM tasks t LEFT JOIN clients cl ON cl.id = t.client_id
       WHERE t.status = 'ouverte' ORDER BY COALESCE(t.due_date, '9999') LIMIT 8`
    )
    .all()
    .map((r) => ({
      ...r,
      client_name:
        r.client_type === 'entreprise'
          ? r.client_company
          : [r.first_name, r.last_name].filter(Boolean).join(' ') || null,
    }));

  const expiringContracts = db
    .prepare(
      `SELECT ct.*, co.name AS company_name,
        cl.first_name, cl.last_name, cl.company_name AS client_company, cl.type AS client_type
       FROM contracts ct
       JOIN companies co ON co.id = ct.company_id
       JOIN clients cl ON cl.id = ct.client_id
       WHERE ct.status = 'actif' AND ct.end_date IS NOT NULL
         AND ct.end_date <= date('now', '+90 days')
       ORDER BY ct.end_date LIMIT 8`
    )
    .all()
    .map((r) => ({
      ...r,
      client_name:
        r.client_type === 'entreprise'
          ? r.client_company
          : [r.first_name, r.last_name].filter(Boolean).join(' '),
    }));

  // Alertes de conformité : clients actifs sans consentement, mandat ou info LSA
  const complianceGaps = db
    .prepare(
      `SELECT id, type, first_name, last_name, company_name, consent_data, mandate_signed, info_lsa_date
       FROM clients
       WHERE status IN ('client', 'prospect')
         AND (consent_data = 0 OR mandate_signed = 0 OR info_lsa_date IS NULL)
       ORDER BY updated_at DESC LIMIT 10`
    )
    .all()
    .map((c) => ({
      id: c.id,
      name:
        c.type === 'entreprise'
          ? c.company_name
          : [c.first_name, c.last_name].filter(Boolean).join(' '),
      missing: [
        !c.consent_data && 'consentement nLPD',
        !c.mandate_signed && 'mandat de courtage',
        !c.info_lsa_date && 'information art. 45 LSA',
      ].filter(Boolean),
    }));

  res.json({
    kpis: {
      clients,
      prospects,
      activeContracts,
      totalPremiums,
      commissionsPaidYear,
      commissionsPending,
    },
    monthly,
    byBranch,
    upcomingTasks,
    expiringContracts,
    complianceGaps,
  });
});
