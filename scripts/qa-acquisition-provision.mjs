// M0c21 — provisionneur QA Acquisition, ENTIÈREMENT SYNTHÉTIQUE et isolé.
//
// Strictement séparé de scripts/qa-health-provision.mjs (Advisory/Diagnostic
// Santé — questionnaires, rule sets, compte conseiller) : ce script ne
// touche JAMAIS une table advisory_*/households/household_members, et
// qa-health-provision.mjs n'est ni modifié ni détourné par ce lot.
//
// Objectif : peupler une base QA isolée avec des fixtures Acquisition
// (channels réutilisés, campagnes, prospects à chaque étape du pipeline,
// rendez-vous, contrats, commissions y compris reprises) permettant de
// dérouler manuellement les checklists QA définies en M0c20. Ne provisionne
// aucun compte utilisateur (aucun login) : ce script ne gère aucun secret.
//
// Toutes les données sont fictives : noms/emails préfixés [QA-ACQ] /
// qa-acq-*@example.test (domaine réservé RFC 2606). Aucune identité réelle.
//
// Usage (provisioning, idempotent — sans danger à rejouer) :
//   QA_ACQUISITION_ALLOW=1 CRM_DATA_DIR=/tmp/xxx node scripts/qa-acquisition-provision.mjs
//
// Usage (reset — supprime UNIQUEMENT les fixtures portant la signature
// [QA-ACQ]/qa-acq-*, jamais une autre donnée) :
//   QA_ACQUISITION_ALLOW=1 QA_ACQUISITION_CONFIRM=QA_SYNTHETIC_ONLY \
//     CRM_DATA_DIR=/tmp/xxx node scripts/qa-acquisition-provision.mjs --reset
//
// N'accède à aucun réseau externe, ne se connecte à aucun serveur SSH, ne
// contient aucun hostname de production, ne lance aucun --apply de
// déploiement, ne crée aucun service systemd.

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const REAL_DATA_DIR = path.resolve(REPO_ROOT, 'data');
const PROD_DATA_DIR = '/home/crm/app/data';
const PROD_APP_DIR = '/home/crm/app';

function refuse(message) {
  console.error(`Refus : ${message}`);
  process.exit(1);
}

// --- Gardes obligatoires (aucun fallback silencieux) ------------------------
// Barrière d'intention n°1 : baseline, exigée pour toute exécution
// (provisioning ET reset) — mirroring QA_E2E_ALLOW de qa-health-provision.mjs.
if (process.env.QA_ACQUISITION_ALLOW !== '1') {
  refuse('QA_ACQUISITION_ALLOW=1 doit être explicitement défini pour exécuter ce script.');
}

const requested = process.env.CRM_DATA_DIR;
if (!requested || !requested.trim()) {
  refuse('CRM_DATA_DIR est absent ou vide — un répertoire isolé explicite est obligatoire (aucun défaut ambigu).');
}
if (!path.isAbsolute(requested)) {
  refuse(`CRM_DATA_DIR doit être un chemin absolu (reçu : « ${requested} »).`);
}
const resolvedDataDir = path.resolve(requested);

// Jamais le répertoire de données réel du dépôt, jamais un chemin de
// production connu — même liste de refus que qa-health-provision.mjs pour
// les deux premiers cas, plus le chemin de production explicite.
if (resolvedDataDir === REAL_DATA_DIR) {
  refuse(`CRM_DATA_DIR (${resolvedDataDir}) pointe vers le répertoire de données réel du dépôt (./data).`);
}
if (resolvedDataDir === PROD_DATA_DIR || resolvedDataDir === PROD_APP_DIR || resolvedDataDir.startsWith(`${PROD_APP_DIR}/`)) {
  refuse(`CRM_DATA_DIR (${resolvedDataDir}) pointe vers un chemin de production (${PROD_APP_DIR}).`);
}
if (resolvedDataDir === '/' || resolvedDataDir === REPO_ROOT) {
  refuse(`CRM_DATA_DIR (${resolvedDataDir}) est un chemin manifestement incorrect.`);
}

const RESET = process.argv.includes('--reset');
// Barrière d'intention n°2 (reset, destructif) : --reset seul ne suffit
// jamais — exige en plus une confirmation distincte, jamais requise pour un
// provisioning simple (purement additif/idempotent, sans danger par
// construction — voir §ISOLATION ci-dessous).
if (RESET && process.env.QA_ACQUISITION_CONFIRM !== 'QA_SYNTHETIC_ONLY') {
  refuse('QA_ACQUISITION_CONFIRM=QA_SYNTHETIC_ONLY doit être explicitement défini pour --reset.');
}

process.env.CRM_DATA_DIR = resolvedDataDir;
console.log(`CRM_DATA_DIR vérifié et isolé : ${resolvedDataDir}`);
console.log(`Mode : ${RESET ? 'RESET (fixtures QA Acquisition uniquement)' : 'PROVISIONING (idempotent)'}`);

// db.js honore process.env.CRM_DATA_DIR (jamais réécrit ici au-delà de la
// normalisation ci-dessus) et exécute ses migrations automatiquement à
// l'import — aucun mécanisme de migration séparé requis.
const { default: db } = await import(path.join(REPO_ROOT, 'server', 'db.js'));

// --- Signature des fixtures (M0c21 §19) -------------------------------------
// Aucune colonne de schéma ajoutée pour porter cette signature : elle vit
// entièrement dans des valeurs de colonnes texte déjà existantes
// (email/label/policy_number/notes/name), choisies pour être à la fois
// lisibles par un humain en QA et strictement filtrables par le reset.
const EMAIL_DOMAIN = '@example.test';
const EMAIL_PREFIX = 'qa-acq-';
const LABEL_PREFIX = '[QA-ACQ]';
const POLICY_PREFIX = 'QA-ACQ-';
const CAMPAIGN_PREFIX = 'QA Campagne ';
const email = (slug) => `${EMAIL_PREFIX}${slug}${EMAIL_DOMAIN}`;

// --- Helpers find-or-create (idempotence stricte, jamais de duplication) ---

function findOrCreateChannel(key) {
  const row = db.prepare('SELECT id, key, name FROM channels WHERE key = ?').get(key);
  if (!row) {
    // Jamais de création silencieuse d'un nouveau canal (M0c20/M0c21 §7) :
    // les canaux attendus sont auto-seedés par server/db.js dès l'import
    // ci-dessus (14 canaux par défaut) — leur absence indique un état de
    // base inattendu, à signaler plutôt qu'à contourner.
    refuse(`Canal attendu introuvable (key = « ${key} ») — devrait être auto-seedé par server/db.js.`);
  }
  return row;
}

function findFirstCompany() {
  // Réutilise une compagnie déjà présente (auto-seedée par server/db.js,
  // comme les canaux) plutôt que d'en créer une nouvelle : ce script ne
  // provisionne que des entités propres à Acquisition (clients, campagnes,
  // contrats, commissions, rendez-vous), jamais de compagnie d'assurance —
  // aucune signature [QA-ACQ] à porter ni à nettoyer pour cette table.
  const row = db.prepare('SELECT id, name FROM companies ORDER BY id LIMIT 1').get();
  if (!row) refuse('Aucune compagnie en base — devrait être auto-seedée par server/db.js.');
  return row;
}

function findOrCreateClient({ slug, firstName, lastName, status }) {
  const clientEmail = email(slug);
  const existing = db.prepare('SELECT id FROM clients WHERE email = ?').get(clientEmail);
  if (existing) return { id: existing.id, email: clientEmail, created: false };
  const info = db
    .prepare(
      `INSERT INTO clients (type, first_name, last_name, email, status, consent_data, consent_date)
       VALUES ('particulier', ?, ?, ?, ?, 1, date('now'))`
    )
    .run(firstName, lastName, clientEmail, status);
  return { id: info.lastInsertRowid, email: clientEmail, created: true };
}

function findOrCreateLeadDetails(clientId, { channelId = null, campaignId = null, pipelineStage = 'nouveau' }) {
  const existing = db.prepare('SELECT client_id FROM lead_details WHERE client_id = ?').get(clientId);
  if (existing) return { created: false };
  db.prepare(
    `INSERT INTO lead_details (client_id, channel_id, campaign_id, pipeline_stage) VALUES (?, ?, ?, ?)`
  ).run(clientId, channelId, campaignId, pipelineStage);
  return { created: true };
}

function findOrCreateCampaign(name, channelId, status) {
  const existing = db.prepare('SELECT id, status FROM campaigns WHERE name = ?').get(name);
  if (existing) return { id: existing.id, created: false };
  const info = db
    .prepare('INSERT INTO campaigns (name, channel_id, status) VALUES (?, ?, ?)')
    .run(name, channelId, status);
  return { id: info.lastInsertRowid, created: true };
}

function findOrCreateContract(policyNumber, { clientId, companyId, branch = 'lamal', annualPremium = 1200, status = 'actif' }) {
  const existing = db.prepare('SELECT id FROM contracts WHERE policy_number = ?').get(policyNumber);
  if (existing) return { id: existing.id, created: false };
  const info = db
    .prepare(
      `INSERT INTO contracts (client_id, company_id, branch, policy_number, annual_premium, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(clientId, companyId, branch, policyNumber, annualPremium, status);
  return { id: info.lastInsertRowid, created: true };
}

function findOrCreateCommission(label, { contractId, type = 'acquisition', expected, received = 0, status }) {
  const existing = db.prepare('SELECT id FROM commissions WHERE label = ?').get(label);
  if (existing) return { id: existing.id, created: false };
  const info = db
    .prepare(
      `INSERT INTO commissions (contract_id, type, label, expected_amount_chf, received_amount_chf, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(contractId, type, label, expected, received, status);
  return { id: info.lastInsertRowid, created: true };
}

// Reproduit fidèlement le mécanisme documenté de POST /:id/reverse
// (server/routes/commissions.js) : la ligne d'origine garde son montant et
// passe seulement au statut 'reversed' ; une NOUVELLE ligne négative liée
// par reversal_of_commission_id porte le montant repris — jamais une ligne
// bricolée directement à un statut incohérent. Choisi ici plutôt qu'un
// appel HTTP réel (le provisionneur écrit directement en base, §22 de la
// mission) car c'est la méthode la plus stable et déjà documentée.
function provisionReversalPair(labelPrefix, { contractId, originalExpected, reversalAmount, markReversalReceived = false }) {
  const originalLabel = `${labelPrefix} — original`;
  const reversalLabel = `${labelPrefix} — reprise`;

  let original = db.prepare('SELECT id, status FROM commissions WHERE label = ?').get(originalLabel);
  if (!original) {
    const info = db
      .prepare(
        `INSERT INTO commissions (contract_id, type, label, expected_amount_chf, received_amount_chf, status)
         VALUES (?, 'acquisition', ?, ?, ?, 'received')`
      )
      .run(contractId, originalLabel, originalExpected, originalExpected);
    original = { id: info.lastInsertRowid, status: 'received' };
  }

  let reversal = db.prepare('SELECT id, status FROM commissions WHERE label = ?').get(reversalLabel);
  let reversalJustCreated = false;
  if (!reversal) {
    const info = db
      .prepare(
        `INSERT INTO commissions (
           contract_id, type, label, expected_amount_chf, received_amount_chf, status,
           reversal_of_commission_id, reversal_amount_chf
         ) VALUES (?, 'reprise', ?, ?, 0, 'expected', ?, ?)`
      )
      .run(contractId, reversalLabel, reversalAmount, original.id, reversalAmount);
    reversal = { id: info.lastInsertRowid, status: 'expected' };
    reversalJustCreated = true;
    // La ligne d'origine ne passe à 'reversed' qu'au moment où sa reprise
    // est effectivement créée — jamais avant, jamais deux fois.
    db.prepare(`UPDATE commissions SET status = 'reversed' WHERE id = ?`).run(original.id);
  }

  if (markReversalReceived && reversal.status !== 'received') {
    // Phase B : la ligne compensatoire elle-même transitionne vers
    // 'received', avec un received_amount_chf négatif identique à son
    // montant attendu — reproduit le geste normal de encaissement d'une
    // ligne de commission, appliqué ici à une ligne de reprise.
    db.prepare(`UPDATE commissions SET status = 'received', received_amount_chf = ? WHERE id = ?`).run(
      reversalAmount, reversal.id
    );
  }

  return { originalId: original.id, reversalId: reversal.id, reversalJustCreated };
}

function fmtLocalDateTime(date) {
  const p2 = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())} ` +
    `${p2(date.getHours())}:${p2(date.getMinutes())}:${p2(date.getSeconds())}`
  );
}

function atLocalDayOffset(days, hour, minute) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

// Trouve un rendez-vous par sa signature [QA-ACQ] portée dans `notes` ; s'il
// existe déjà, RAFRAÎCHIT ses horaires (les scénarios sont relatifs à
// "aujourd'hui", recalculés à chaque exécution — §11 de la mission) plutôt
// que d'en créer un doublon.
function upsertAppointment(notesSignature, { clientId, startsAt, endsAt, status = 'booked', appointmentType = 'other', locationType = 'in_person' }) {
  const existing = db.prepare('SELECT id FROM appointments WHERE client_id = ? AND notes = ?').get(clientId, notesSignature);
  if (existing) {
    db.prepare(
      `UPDATE appointments SET starts_at = ?, ends_at = ?, status = ?, appointment_type = ?, location_type = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(startsAt, endsAt, status, appointmentType, locationType, existing.id);
    return { id: existing.id, created: false };
  }
  const info = db
    .prepare(
      `INSERT INTO appointments (client_id, starts_at, ends_at, status, appointment_type, location_type, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(clientId, startsAt, endsAt, status, appointmentType, locationType, notesSignature);
  return { id: info.lastInsertRowid, created: true };
}

// --- RESET -------------------------------------------------------------------
// Ordre dérivé des FK réelles du schéma (server/db.js, foreign_keys=ON) :
// commissions -> contracts -> appointments/lead_details -> clients -> campaigns.
// Aucune ligne tasks/activities/consents/audit_log n'est jamais créée par ce
// script (fixtures écrites directement en base, §22 de la mission) : rien à
// nettoyer dans ces tables. Chaque DELETE est filtré strictement par la
// signature [QA-ACQ] — jamais un DELETE non filtré sur clients/campaigns.
function resetFixtures() {
  const run = (sql, ...params) => db.prepare(sql).run(...params).changes;
  const emailPattern = `${EMAIL_PREFIX}%${EMAIL_DOMAIN}`;

  const commissionsDeleted = run(`DELETE FROM commissions WHERE label LIKE ?`, `${LABEL_PREFIX}%`);
  const contractsDeleted = run(`DELETE FROM contracts WHERE policy_number LIKE ?`, `${POLICY_PREFIX}%`);
  const appointmentsDeleted = run(`DELETE FROM appointments WHERE notes LIKE ?`, `${LABEL_PREFIX}%`);
  const leadDetailsDeleted = run(
    `DELETE FROM lead_details WHERE client_id IN (SELECT id FROM clients WHERE email LIKE ?)`,
    emailPattern
  );
  const clientsDeleted = run(`DELETE FROM clients WHERE email LIKE ?`, emailPattern);
  const campaignsDeleted = run(`DELETE FROM campaigns WHERE name LIKE ?`, `${CAMPAIGN_PREFIX}%`);

  return { commissionsDeleted, contractsDeleted, appointmentsDeleted, leadDetailsDeleted, clientsDeleted, campaignsDeleted };
}

if (RESET) {
  const result = db.transaction(resetFixtures)();
  console.log('--- RESET terminé (fixtures [QA-ACQ] uniquement) ---');
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

// --- PROVISIONING --------------------------------------------------------

const summary = db.transaction(() => {
  const channelSiteInternet = findOrCreateChannel('site_internet');
  const channelCampagnesPub = findOrCreateChannel('campagnes_pub');
  const company = findFirstCompany();

  // --- Campaigns (§8) --------------------------------------------------
  const campaignActive = findOrCreateCampaign(`${CAMPAIGN_PREFIX}Active`, channelSiteInternet.id, 'active');
  const campaignSansLeads = findOrCreateCampaign(`${CAMPAIGN_PREFIX}Sans Leads`, channelCampagnesPub.id, 'active');
  const campaignAvecCommissions = findOrCreateCampaign(`${CAMPAIGN_PREFIX}Avec Commissions`, channelCampagnesPub.id, 'active');
  const campaignCancelledOnly = findOrCreateCampaign(`${CAMPAIGN_PREFIX}Cancelled Only`, channelSiteInternet.id, 'active');

  // --- Prospects pipeline (§9) -------------------------------------------
  const PIPELINE_STAGES = ['nouveau', 'contacte', 'rdv', 'analyse', 'offre', 'signe', 'perdu'];
  const prospectsByStage = {};
  for (const stage of PIPELINE_STAGES) {
    const c = findOrCreateClient({
      slug: `prospect-${stage}`,
      firstName: 'QA-ACQ',
      lastName: `Prospect ${stage}`,
      status: 'prospect',
    });
    findOrCreateLeadDetails(c.id, { pipelineStage: stage });
    prospectsByStage[stage] = c;
  }

  const prospectNoLead = findOrCreateClient({
    slug: 'prospect-sans-lead',
    firstName: 'QA-ACQ',
    lastName: 'Prospect Sans Lead',
    status: 'prospect',
  });
  // Volontairement AUCUN appel à findOrCreateLeadDetails ici : ce prospect
  // doit rester réellement sans ligne lead_details (§9).

  // --- Non-prospect (§10) -------------------------------------------------
  const nonProspectClient = findOrCreateClient({
    slug: 'client-non-prospect',
    firstName: 'QA-ACQ',
    lastName: 'Client Non Prospect',
    status: 'client',
  });

  // --- Anti-double-count (§16), attribué à la campagne Active -------------
  const anticDoubleCount = findOrCreateClient({
    slug: 'anti-double-count',
    firstName: 'QA-ACQ',
    lastName: 'Anti Double Count',
    status: 'client',
  });
  findOrCreateLeadDetails(anticDoubleCount.id, {
    channelId: channelSiteInternet.id,
    campaignId: campaignActive.id,
    pipelineStage: 'signe',
  });
  const adcContract1 = findOrCreateContract(`${POLICY_PREFIX}ADC-1`, {
    clientId: anticDoubleCount.id, companyId: company.id, branch: 'lamal', annualPremium: 1800,
  });
  const adcContract2 = findOrCreateContract(`${POLICY_PREFIX}ADC-2`, {
    clientId: anticDoubleCount.id, companyId: company.id, branch: 'vie_3a', annualPremium: 2400,
  });
  findOrCreateCommission(`${LABEL_PREFIX} ADC — contrat 1 expected`, {
    contractId: adcContract1.id, expected: 1200, received: 0, status: 'expected',
  });
  findOrCreateCommission(`${LABEL_PREFIX} ADC — contrat 2 received`, {
    contractId: adcContract2.id, expected: 800, received: 800, status: 'received',
  });
  findOrCreateCommission(`${LABEL_PREFIX} ADC — contrat 2 partially_received`, {
    contractId: adcContract2.id, type: 'recurrente', expected: 500, received: 200, status: 'partially_received',
  });
  // Total attendu déterministe (statuts non-cancelled) : 1200 + 800 + 500 = 2500
  // Total reçu déterministe : 0 + 800 + 200 = 1000

  // --- Showcase 5 statuts (§13), attribué à Avec Commissions --------------
  const showcase = findOrCreateClient({
    slug: 'commissions-showcase',
    firstName: 'QA-ACQ',
    lastName: 'Commissions Showcase',
    status: 'client',
  });
  findOrCreateLeadDetails(showcase.id, {
    channelId: channelCampagnesPub.id,
    campaignId: campaignAvecCommissions.id,
    pipelineStage: 'signe',
  });
  const showcaseContract = findOrCreateContract(`${POLICY_PREFIX}SHOWCASE-1`, {
    clientId: showcase.id, companyId: company.id, branch: 'lamal', annualPremium: 1500,
  });
  findOrCreateCommission(`${LABEL_PREFIX} Showcase — expected`, { contractId: showcaseContract.id, expected: 1000, received: 0, status: 'expected' });
  findOrCreateCommission(`${LABEL_PREFIX} Showcase — partially_received`, { contractId: showcaseContract.id, expected: 1000, received: 400, status: 'partially_received' });
  findOrCreateCommission(`${LABEL_PREFIX} Showcase — received`, { contractId: showcaseContract.id, expected: 900, received: 900, status: 'received' });
  findOrCreateCommission(`${LABEL_PREFIX} Showcase — disputed`, { contractId: showcaseContract.id, expected: 600, received: 0, status: 'disputed' });
  findOrCreateCommission(`${LABEL_PREFIX} Showcase — cancelled`, { contractId: showcaseContract.id, expected: 700, received: 0, status: 'cancelled' });

  // --- Campagne Cancelled Only (§15), with_commissions doit être false ----
  const cancelledOnlyClient = findOrCreateClient({
    slug: 'cancelled-only',
    firstName: 'QA-ACQ',
    lastName: 'Cancelled Only',
    status: 'client',
  });
  findOrCreateLeadDetails(cancelledOnlyClient.id, {
    channelId: channelSiteInternet.id,
    campaignId: campaignCancelledOnly.id,
    pipelineStage: 'signe',
  });
  const cancelledOnlyContract = findOrCreateContract(`${POLICY_PREFIX}CANCELLED-1`, {
    clientId: cancelledOnlyClient.id, companyId: company.id, branch: 'lamal', annualPremium: 900,
  });
  findOrCreateCommission(`${LABEL_PREFIX} Cancelled Only — unique commission`, {
    contractId: cancelledOnlyContract.id, expected: 500, received: 0, status: 'cancelled',
  });

  // --- Attribution canal seul (§14.B) --------------------------------------
  const channelOnlyClient = findOrCreateClient({
    slug: 'channel-only',
    firstName: 'QA-ACQ',
    lastName: 'Channel Only',
    status: 'client',
  });
  findOrCreateLeadDetails(channelOnlyClient.id, {
    channelId: channelCampagnesPub.id,
    campaignId: null,
    pipelineStage: 'signe',
  });
  const channelOnlyContract = findOrCreateContract(`${POLICY_PREFIX}CHANNEL-1`, {
    clientId: channelOnlyClient.id, companyId: company.id, branch: 'lamal', annualPremium: 1100,
  });
  findOrCreateCommission(`${LABEL_PREFIX} Channel Only — received`, {
    contractId: channelOnlyContract.id, expected: 650, received: 650, status: 'received',
  });

  // --- Non attribué (§14.C) -------------------------------------------------
  const unattributedClient = findOrCreateClient({
    slug: 'unattributed',
    firstName: 'QA-ACQ',
    lastName: 'Unattributed',
    status: 'client',
  });
  // Volontairement AUCUNE ligne lead_details : client entièrement non
  // attribué (ni canal, ni campagne) — pas seulement des champs NULL.
  const unattributedContract = findOrCreateContract(`${POLICY_PREFIX}UNATTR-1`, {
    clientId: unattributedClient.id, companyId: company.id, branch: 'lamal', annualPremium: 1000,
  });
  findOrCreateCommission(`${LABEL_PREFIX} Unattributed — received`, {
    contractId: unattributedContract.id, expected: 450, received: 450, status: 'received',
  });

  // --- Reversal phase A (§13) ------------------------------------------
  const reversalAClient = findOrCreateClient({
    slug: 'reversal-phase-a',
    firstName: 'QA-ACQ',
    lastName: 'Reversal Phase A',
    status: 'client',
  });
  const reversalAContract = findOrCreateContract(`${POLICY_PREFIX}REV-A-1`, {
    clientId: reversalAClient.id, companyId: company.id, branch: 'lamal', annualPremium: 1400,
  });
  const reversalA = provisionReversalPair(`${LABEL_PREFIX} Reversal A`, {
    contractId: reversalAContract.id, originalExpected: 1000, reversalAmount: -400, markReversalReceived: false,
  });

  // --- Reversal phase B (§13) ------------------------------------------
  const reversalBClient = findOrCreateClient({
    slug: 'reversal-phase-b',
    firstName: 'QA-ACQ',
    lastName: 'Reversal Phase B',
    status: 'client',
  });
  const reversalBContract = findOrCreateContract(`${POLICY_PREFIX}REV-B-1`, {
    clientId: reversalBClient.id, companyId: company.id, branch: 'lamal', annualPremium: 1300,
  });
  const reversalB = provisionReversalPair(`${LABEL_PREFIX} Reversal B`, {
    contractId: reversalBContract.id, originalExpected: 800, reversalAmount: -300, markReversalReceived: true,
  });

  // --- Appointments (§11), horaires relatifs à "aujourd'hui" ---------------
  const appointmentsDemo = findOrCreateClient({
    slug: 'appointments-demo',
    firstName: 'QA-ACQ',
    lastName: 'Appointments Demo',
    status: 'prospect',
  });
  findOrCreateLeadDetails(appointmentsDemo.id, { pipelineStage: 'contacte' });

  const todayAppt = atLocalDayOffset(0, 9, 0);
  const todayApptEnd = atLocalDayOffset(0, 9, 30);
  const futureAppt = atLocalDayOffset(7, 10, 0);
  const futureApptEnd = atLocalDayOffset(7, 10, 30);
  const pastAppt = atLocalDayOffset(-7, 10, 0);
  const pastApptEnd = atLocalDayOffset(-7, 10, 30);
  const noShowAppt = atLocalDayOffset(-3, 11, 0);
  const noShowApptEnd = atLocalDayOffset(-3, 11, 30);
  const cancelledAppt = atLocalDayOffset(5, 15, 0);
  const cancelledApptEnd = atLocalDayOffset(5, 15, 30);

  const appointments = {
    aujourdhui: upsertAppointment(`${LABEL_PREFIX} RDV — aujourd'hui`, {
      clientId: appointmentsDemo.id, startsAt: fmtLocalDateTime(todayAppt), endsAt: fmtLocalDateTime(todayApptEnd),
      status: 'booked', appointmentType: 'assurance_sante', locationType: 'in_person',
    }),
    futur: upsertAppointment(`${LABEL_PREFIX} RDV — futur`, {
      clientId: appointmentsDemo.id, startsAt: fmtLocalDateTime(futureAppt), endsAt: fmtLocalDateTime(futureApptEnd),
      status: 'confirmed', appointmentType: 'client_360', locationType: 'video',
    }),
    passe: upsertAppointment(`${LABEL_PREFIX} RDV — passé`, {
      clientId: appointmentsDemo.id, startsAt: fmtLocalDateTime(pastAppt), endsAt: fmtLocalDateTime(pastApptEnd),
      status: 'completed', appointmentType: 'prevoyance', locationType: 'phone',
    }),
    noShow: upsertAppointment(`${LABEL_PREFIX} RDV — no_show`, {
      clientId: appointmentsDemo.id, startsAt: fmtLocalDateTime(noShowAppt), endsAt: fmtLocalDateTime(noShowApptEnd),
      status: 'no_show', appointmentType: 'follow_up', locationType: 'in_person',
    }),
    annule: upsertAppointment(`${LABEL_PREFIX} RDV — annulé`, {
      clientId: appointmentsDemo.id, startsAt: fmtLocalDateTime(cancelledAppt), endsAt: fmtLocalDateTime(cancelledApptEnd),
      status: 'cancelled', appointmentType: 'other', locationType: 'in_person',
    }),
  };

  return {
    channels: { site_internet: channelSiteInternet, campagnes_pub: channelCampagnesPub },
    company,
    campaigns: {
      active: campaignActive, sansLeads: campaignSansLeads,
      avecCommissions: campaignAvecCommissions, cancelledOnly: campaignCancelledOnly,
    },
    prospectsByStage,
    prospectNoLead,
    nonProspectClient,
    anticDoubleCount: { client: anticDoubleCount, contract1: adcContract1, contract2: adcContract2 },
    showcase: { client: showcase, contract: showcaseContract },
    cancelledOnlyClient: { client: cancelledOnlyClient, contract: cancelledOnlyContract },
    channelOnlyClient: { client: channelOnlyClient, contract: channelOnlyContract },
    unattributedClient: { client: unattributedClient, contract: unattributedContract },
    reversalA: { client: reversalAClient, ...reversalA },
    reversalB: { client: reversalBClient, ...reversalB },
    appointmentsDemo: { client: appointmentsDemo, appointments },
  };
})();

// --- Sortie récapitulative (§24) — aucun secret à révéler (aucun compte
// utilisateur, aucun mot de passe n'est jamais provisionné par ce script) --
console.log('\n--- Résumé du provisioning QA Acquisition ---');
console.log('Channels réutilisés :', {
  site_internet: summary.channels.site_internet.id,
  campagnes_pub: summary.channels.campagnes_pub.id,
});
console.log('Compagnie réutilisée :', summary.company);
console.log('Campaigns :', Object.fromEntries(
  Object.entries(summary.campaigns).map(([k, v]) => [k, v.id])
));
console.log('Prospects par stage :', Object.fromEntries(
  Object.entries(summary.prospectsByStage).map(([stage, c]) => [stage, { id: c.id, email: c.email }])
));
console.log('Prospect sans lead_details :', { id: summary.prospectNoLead.id, email: summary.prospectNoLead.email });
console.log('Client non-prospect :', { id: summary.nonProspectClient.id, email: summary.nonProspectClient.email });
console.log('Anti-double-count :', {
  client: summary.anticDoubleCount.client.id,
  contracts: [summary.anticDoubleCount.contract1.id, summary.anticDoubleCount.contract2.id],
  totalExpectedAttendu: 2500, totalReceivedAttendu: 1000,
});
console.log('Showcase 5 statuts :', { client: summary.showcase.client.id, contract: summary.showcase.contract.id });
console.log('Campagne Cancelled Only :', { client: summary.cancelledOnlyClient.client.id, contract: summary.cancelledOnlyClient.contract.id });
console.log('Attribution canal seul :', { client: summary.channelOnlyClient.client.id, contract: summary.channelOnlyClient.contract.id });
console.log('Attribution non attribué :', { client: summary.unattributedClient.client.id, contract: summary.unattributedClient.contract.id });
console.log('Reversal phase A :', { client: summary.reversalA.client.id, originalId: summary.reversalA.originalId, reversalId: summary.reversalA.reversalId });
console.log('Reversal phase B :', { client: summary.reversalB.client.id, originalId: summary.reversalB.originalId, reversalId: summary.reversalB.reversalId });
console.log('Appointments demo :', {
  client: summary.appointmentsDemo.client.id,
  ids: Object.fromEntries(Object.entries(summary.appointmentsDemo.appointments).map(([k, v]) => [k, v.id])),
});
console.log('\nProvisioning QA Acquisition terminé (idempotent — relançable sans danger).');
