// Attribution de revenu Acquisition OS (lot A6a) — lecture seule.
//
// Ce routeur est volontairement isolé : il n'est PAS monté dans
// server/app.js à ce stade. Aucun POST/PUT/DELETE, aucune écriture,
// aucune modification de schéma.
//
// Chaîne d'attribution réelle (vérifiée dans server/db.js, aucun nom de
// colonne supposé) :
//   campaigns.id <- lead_details.campaign_id (nullable)
//   lead_details.client_id  = clé PRIMAIRE de lead_details -> relation
//     stricte 1:1 avec clients (un client a au plus une ligne lead_details)
//   clients.id <- contracts.client_id (1:N, NOT NULL)
//   contracts.id <- commissions.contract_id (1:N, NOT NULL)
//   channels.id <- campaigns.channel_id (nullable) et
//     <- lead_details.channel_id (nullable, indépendant de campaign_id)
//   channel_costs.channel_id (NOT NULL), granularité MENSUELLE PAR CANAL
//     uniquement — aucun campaign_id sur les coûts.
//
// Règle d'attribution V1 (mono-touch, volontairement simple) : un contrat
// et ses commissions héritent de la campagne/du canal d'origine porté par
// lead_details du client. Pas d'attribution multi-touch. Le contrat n'est
// jamais modifié.
//
// Anti-double-comptage : chaque métrique agrégée (COUNT/SUM) est calculée
// par une sous-requête scalaire indépendante, jamais par une jointure plate
// suivie d'un COUNT(*) — une jointure client -> contracts -> commissions
// multiplierait artificiellement les lignes si un client a plusieurs
// contrats, ou un contrat plusieurs commissions. C'est la même technique
// que server/routes/channels.js (non modifié, non dupliqué littéralement :
// il n'exporte qu'un Router, pas une fonction réutilisable).
//
// CAC / ROAS : NON calculés. channel_costs n'a pas de campaign_id (CAC par
// campagne impossible avec le schéma actuel) et aucune règle d'attribution
// temporelle entre les coûts mensuels par canal et la date des leads
// n'existe dans le projet — en inventer une produirait un chiffre
// trompeur. Les coûts bruts sont exposés séparément des leads pour que la
// donnée reste utilisable sans affirmer un ratio non fondé.
//
// Non attribué (UNATTRIBUTED) : un client/contrat est considéré comme non
// attribué à un canal (resp. une campagne) s'il n'a aucune ligne
// lead_details, ou une ligne lead_details dont channel_id (resp.
// campaign_id) est NULL. Ces éléments sont comptés à part, jamais omis des
// totaux globaux.
//
// Comme les autres routeurs privés du dépôt, ce fichier ne fait aucune
// vérification d'authentification lui-même : la protection (requireAuth)
// serait appliquée au montage, comme pour campaigns.js.

import { Router } from 'express';
import db from '../db.js';

export const acquisitionAnalyticsRouter = Router();

const CAVEATS = [
  "CAC et ROAS par campagne : non calculés — channel_costs n'a pas de campaign_id, aucune donnée de coût n'existe à ce niveau.",
  "CAC et ROAS par canal : non calculés — aucune règle d'attribution temporelle définie entre les coûts mensuels (channel_costs) et la date des leads ; les coûts bruts et les leads sont exposés séparément plutôt qu'un ratio non fondé.",
  'Attribution mono-touch (V1) : un contrat hérite uniquement du canal/campagne porté par lead_details de son client, au moment de la lecture — pas de multi-touch, pas d’historique de changement de campagne.',
];

// -- GET /summary -----------------------------------------------------------
acquisitionAnalyticsRouter.get('/summary', (req, res) => {
  const leadsTotal = db.prepare('SELECT COUNT(*) AS n FROM lead_details').get().n;

  const clientsConvertedTotal = db
    .prepare("SELECT COUNT(*) AS n FROM clients WHERE status = 'client'")
    .get().n;
  const clientsConvertedAttributed = db
    .prepare(
      `SELECT COUNT(*) AS n FROM clients c
       WHERE c.status = 'client'
         AND EXISTS (
           SELECT 1 FROM lead_details ld
           WHERE ld.client_id = c.id AND (ld.channel_id IS NOT NULL OR ld.campaign_id IS NOT NULL)
         )`
    )
    .get().n;

  const contractsTotal = db.prepare('SELECT COUNT(*) AS n FROM contracts').get().n;
  const contractsAttributed = db
    .prepare(
      `SELECT COUNT(*) AS n FROM contracts ct
       WHERE EXISTS (
         SELECT 1 FROM lead_details ld
         WHERE ld.client_id = ct.client_id AND (ld.channel_id IS NOT NULL OR ld.campaign_id IS NOT NULL)
       )`
    )
    .get().n;

  const commissionsTotalAmount = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM commissions')
    .get().s;
  const commissionsByStatus = db
    .prepare('SELECT status, COALESCE(SUM(amount), 0) AS amount FROM commissions GROUP BY status')
    .all()
    .reduce((acc, r) => ({ ...acc, [r.status]: r.amount }), {});

  const channelCostsTotal = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM channel_costs')
    .get().s;

  const campaignsTotal = db.prepare('SELECT COUNT(*) AS n FROM campaigns').get().n;
  const campaignsWithLeads = db
    .prepare('SELECT COUNT(DISTINCT campaign_id) AS n FROM lead_details WHERE campaign_id IS NOT NULL')
    .get().n;
  const campaignsWithContracts = db
    .prepare(
      `SELECT COUNT(DISTINCT ld.campaign_id) AS n FROM lead_details ld
       WHERE ld.campaign_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM contracts ct WHERE ct.client_id = ld.client_id)`
    )
    .get().n;
  const campaignsWithCommissions = db
    .prepare(
      `SELECT COUNT(DISTINCT ld.campaign_id) AS n FROM lead_details ld
       WHERE ld.campaign_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM contracts ct JOIN commissions cm ON cm.contract_id = ct.id
           WHERE ct.client_id = ld.client_id
         )`
    )
    .get().n;

  res.json({
    leads: { total: leadsTotal },
    clients: {
      total_converted: clientsConvertedTotal,
      attributed: clientsConvertedAttributed,
      unattributed: clientsConvertedTotal - clientsConvertedAttributed,
    },
    contracts: {
      total: contractsTotal,
      attributed: contractsAttributed,
      unattributed: contractsTotal - contractsAttributed,
    },
    commissions: {
      total_amount: commissionsTotalAmount,
      by_status: commissionsByStatus,
    },
    channel_costs: { total_amount: channelCostsTotal },
    campaigns: {
      total: campaignsTotal,
      with_leads: campaignsWithLeads,
      with_contracts: campaignsWithContracts,
      with_commissions: campaignsWithCommissions,
    },
    caveats: CAVEATS,
  });
});

// -- GET /campaigns -----------------------------------------------------------
// Une ligne par campagne. Chaque métrique est une sous-requête scalaire
// indépendante (COUNT/SUM), jamais une jointure plate : plusieurs contrats
// ou plusieurs commissions pour un même client ne peuvent donc pas doubler
// le nombre de leads ou de clients de la campagne.
acquisitionAnalyticsRouter.get('/campaigns', (req, res) => {
  const rows = db
    .prepare(
      `SELECT
         ca.id AS campaign_id,
         ca.name AS campaign_name,
         ca.status AS campaign_status,
         ch.id AS channel_id,
         ch.name AS channel_name,
         (SELECT COUNT(*) FROM lead_details ld WHERE ld.campaign_id = ca.id) AS leads,
         (SELECT COUNT(*) FROM lead_details ld JOIN clients c ON c.id = ld.client_id
            WHERE ld.campaign_id = ca.id AND c.status = 'client') AS clients_converted,
         (SELECT COUNT(*) FROM contracts ct
            WHERE ct.client_id IN (SELECT client_id FROM lead_details WHERE campaign_id = ca.id)) AS contracts,
         (SELECT COALESCE(SUM(cm.amount), 0) FROM commissions cm
            JOIN contracts ct ON ct.id = cm.contract_id
            WHERE ct.client_id IN (SELECT client_id FROM lead_details WHERE campaign_id = ca.id)) AS commissions_amount
       FROM campaigns ca
       LEFT JOIN channels ch ON ch.id = ca.channel_id
       ORDER BY ca.created_at DESC, ca.name COLLATE NOCASE`
    )
    .all();

  // Non attribué : clients (et leurs contrats/commissions) sans campaign_id
  // du tout — absents par construction de la liste ci-dessus par campagne,
  // donc exposés à part pour ne jamais disparaître silencieusement.
  const unattributedClients = db
    .prepare(
      `SELECT COUNT(*) AS n FROM clients c
       WHERE NOT EXISTS (
         SELECT 1 FROM lead_details ld WHERE ld.client_id = c.id AND ld.campaign_id IS NOT NULL
       )`
    )
    .get().n;
  const unattributedContracts = db
    .prepare(
      `SELECT COUNT(*) AS n FROM contracts ct
       WHERE NOT EXISTS (
         SELECT 1 FROM lead_details ld WHERE ld.client_id = ct.client_id AND ld.campaign_id IS NOT NULL
       )`
    )
    .get().n;
  const unattributedCommissions = db
    .prepare(
      `SELECT COALESCE(SUM(cm.amount), 0) AS s FROM commissions cm
       JOIN contracts ct ON ct.id = cm.contract_id
       WHERE NOT EXISTS (
         SELECT 1 FROM lead_details ld WHERE ld.client_id = ct.client_id AND ld.campaign_id IS NOT NULL
       )`
    )
    .get().s;

  res.json({
    campaigns: rows,
    unattributed: {
      clients_total: unattributedClients,
      contracts: unattributedContracts,
      commissions_amount: unattributedCommissions,
    },
    caveats: CAVEATS,
  });
});

// -- GET /channels -----------------------------------------------------------
// Équivalent agrégé par canal. Les leads d'un canal comptent tous les
// lead_details.channel_id = ce canal, y compris ceux sans campagne
// (campaign_id NULL) : le total par canal peut donc être supérieur à la
// somme des campagnes de ce canal dans GET /campaigns. C'est attendu, pas
// un doublon.
acquisitionAnalyticsRouter.get('/channels', (req, res) => {
  const rows = db
    .prepare(
      `SELECT
         ch.id AS channel_id,
         ch.name AS channel_name,
         ch.key AS channel_key,
         ch.active,
         (SELECT COUNT(*) FROM lead_details ld WHERE ld.channel_id = ch.id) AS leads,
         (SELECT COUNT(*) FROM lead_details ld JOIN clients c ON c.id = ld.client_id
            WHERE ld.channel_id = ch.id AND c.status = 'client') AS clients_converted,
         (SELECT COUNT(*) FROM contracts ct
            WHERE ct.client_id IN (SELECT client_id FROM lead_details WHERE channel_id = ch.id)) AS contracts,
         (SELECT COALESCE(SUM(cm.amount), 0) FROM commissions cm
            JOIN contracts ct ON ct.id = cm.contract_id
            WHERE ct.client_id IN (SELECT client_id FROM lead_details WHERE channel_id = ch.id)) AS commissions_amount,
         (SELECT COALESCE(SUM(cc.amount), 0) FROM channel_costs cc WHERE cc.channel_id = ch.id) AS costs_total
       FROM channels ch
       ORDER BY ch.active DESC, ch.sort, ch.name COLLATE NOCASE`
    )
    .all();

  const unattributedClients = db
    .prepare(
      `SELECT COUNT(*) AS n FROM clients c
       WHERE NOT EXISTS (
         SELECT 1 FROM lead_details ld WHERE ld.client_id = c.id AND ld.channel_id IS NOT NULL
       )`
    )
    .get().n;
  const unattributedContracts = db
    .prepare(
      `SELECT COUNT(*) AS n FROM contracts ct
       WHERE NOT EXISTS (
         SELECT 1 FROM lead_details ld WHERE ld.client_id = ct.client_id AND ld.channel_id IS NOT NULL
       )`
    )
    .get().n;
  const unattributedCommissions = db
    .prepare(
      `SELECT COALESCE(SUM(cm.amount), 0) AS s FROM commissions cm
       JOIN contracts ct ON ct.id = cm.contract_id
       WHERE NOT EXISTS (
         SELECT 1 FROM lead_details ld WHERE ld.client_id = ct.client_id AND ld.channel_id IS NOT NULL
       )`
    )
    .get().s;

  res.json({
    channels: rows,
    unattributed: {
      clients_total: unattributedClients,
      contracts: unattributedContracts,
      commissions_amount: unattributedCommissions,
    },
    caveats: CAVEATS,
  });
});
