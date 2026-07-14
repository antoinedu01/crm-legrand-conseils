import { Router } from 'express';
import db from '../db.js';

export const complianceRouter = Router();

// Journal d'audit (traçabilité nLPD / ISO 27001 A.8.15)
complianceRouter.get('/audit-log', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const { q } = req.query;
  let sql = 'SELECT * FROM audit_log WHERE 1=1';
  const params = [];
  if (q) {
    sql += ' AND (action LIKE ? OR entity LIKE ? OR details LIKE ? OR user_email LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(limit);
  res.json(db.prepare(sql).all(...params));
});

// Vue d'ensemble de la conformité
complianceRouter.get('/overview', (req, res) => {
  const activeClients = db
    .prepare("SELECT COUNT(*) AS n FROM clients WHERE status IN ('client', 'prospect')")
    .get().n;
  const withConsent = db
    .prepare("SELECT COUNT(*) AS n FROM clients WHERE status IN ('client', 'prospect') AND consent_data = 1")
    .get().n;
  const withMandate = db
    .prepare("SELECT COUNT(*) AS n FROM clients WHERE status IN ('client', 'prospect') AND mandate_signed = 1")
    .get().n;
  const withInfoLsa = db
    .prepare("SELECT COUNT(*) AS n FROM clients WHERE status IN ('client', 'prospect') AND info_lsa_date IS NOT NULL")
    .get().n;
  const anonymized = db.prepare("SELECT COUNT(*) AS n FROM clients WHERE status = 'anonymise'").get().n;

  const gaps = db
    .prepare(
      `SELECT id, type, first_name, last_name, company_name, consent_data, mandate_signed, info_lsa_date, status
       FROM clients
       WHERE status IN ('client', 'prospect')
         AND (consent_data = 0 OR mandate_signed = 0 OR info_lsa_date IS NULL)
       ORDER BY last_name COLLATE NOCASE, company_name COLLATE NOCASE`
    )
    .all()
    .map((c) => ({
      id: c.id,
      status: c.status,
      name:
        c.type === 'entreprise'
          ? c.company_name
          : [c.first_name, c.last_name].filter(Boolean).join(' '),
      consent_data: Boolean(c.consent_data),
      mandate_signed: Boolean(c.mandate_signed),
      info_lsa: Boolean(c.info_lsa_date),
    }));

  res.json({ activeClients, withConsent, withMandate, withInfoLsa, anonymized, gaps });
});

// Registre des activités de traitement (art. 12 nLPD)
complianceRouter.get('/processing-register', (req, res) => {
  res.json([
    {
      activite: 'Gestion des clients et prospects',
      finalite: 'Conseil en assurance, gestion de la relation client, exécution du mandat de courtage',
      base_legale: 'Exécution du contrat (mandat de courtage), consentement',
      categories_donnees:
        'Identité, coordonnées, date de naissance, état civil, profession, n° AVS (si nécessaire), situation d’assurance',
      destinataires: 'Compagnies d’assurance partenaires (dans le cadre des offres et contrats)',
      duree_conservation:
        'Durée de la relation d’affaires + 10 ans (art. 958f CO), puis anonymisation',
      mesures_securite:
        'Authentification, mots de passe hachés (bcrypt), journal d’audit, sauvegardes, données hébergées localement/en Suisse',
    },
    {
      activite: 'Gestion des contrats d’assurance',
      finalite: 'Suivi des polices (vie 3a/3b, LAMal, LCA, LPP, hypothèque), échéances et renouvellements',
      base_legale: 'Exécution du contrat, obligations légales (LSA)',
      categories_donnees: 'N° de police, branche, primes, dates, compagnie',
      destinataires: 'Compagnies d’assurance concernées',
      duree_conservation: '10 ans après la fin du contrat (art. 958f CO)',
      mesures_securite: 'Identiques à la gestion des clients',
    },
    {
      activite: 'Suivi des commissions',
      finalite: 'Facturation et suivi des rémunérations de courtage, transparence selon art. 45b LSA',
      base_legale: 'Obligation légale (comptabilité), intérêt légitime',
      categories_donnees: 'Montants, dates, compagnie, contrat lié',
      destinataires: 'Fiduciaire / autorités fiscales (sur demande légale)',
      duree_conservation: '10 ans (art. 958f CO)',
      mesures_securite: 'Identiques à la gestion des clients',
    },
    {
      activite: 'Journal d’audit',
      finalite: 'Traçabilité des accès et modifications (sécurité des données, art. 8 nLPD)',
      base_legale: 'Obligation légale (sécurité des données)',
      categories_donnees: 'Utilisateur, action, date/heure, entité concernée',
      destinataires: 'Aucun (usage interne, PFPDT sur demande légale)',
      duree_conservation: '2 ans',
      mesures_securite: 'Accès restreint au courtier authentifié',
    },
  ]);
});
