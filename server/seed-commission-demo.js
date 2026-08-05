// Script de démonstration du modèle de commission corrigé
// (fix/fixed-health-commission-model). Ne s'exécute JAMAIS sur
// data/crm.sqlite : refuse de démarrer si CRM_DATA_DIR n'est pas défini ou
// pointe vers le répertoire de données réel — une base temporaire isolée
// est obligatoire.
//
// Usage : CRM_DATA_DIR=/tmp/demo-commissions node server/seed-commission-demo.js
//
// Toutes les entités créées sont des données FICTIVES clairement marquées
// (préfixe « DEMO », adresses @demo-fictif.invalid) : ce script ne doit
// jamais être utilisé pour saisir un dossier réel.
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_DATA_DIR = path.resolve(__dirname, '..', 'data');

const requestedDir = process.env.CRM_DATA_DIR;
if (!requestedDir) {
  console.error(
    'Refus : ce script ne peut être exécuté que sur une base temporaire isolée. ' +
    'Définissez CRM_DATA_DIR, par exemple :\n' +
    '  CRM_DATA_DIR=/tmp/demo-commissions node server/seed-commission-demo.js'
  );
  process.exit(1);
}
const resolvedDir = path.resolve(requestedDir);
if (resolvedDir === REAL_DATA_DIR) {
  console.error(
    `Refus explicite : CRM_DATA_DIR (${resolvedDir}) pointe vers le répertoire de données réel ` +
    `(${REAL_DATA_DIR}). Ce script de démonstration ne doit jamais toucher data/crm.sqlite.`
  );
  process.exit(1);
}

const { default: db } = await import('./db.js');

const DEMO_MARKER = 'DEMO';
const existing = db
  .prepare("SELECT COUNT(*) AS n FROM clients WHERE first_name = ? OR company_name LIKE ?")
  .get(DEMO_MARKER, `${DEMO_MARKER}%`);
if (existing.n > 0) {
  console.log('Des données de démonstration commission existent déjà dans cette base isolée — seed ignoré.');
  process.exit(0);
}

const companyId = (name) => db.prepare('SELECT id FROM companies WHERE name = ?').get(name)?.id
  || db.prepare('INSERT INTO companies (name) VALUES (?)').run(name).lastInsertRowid;

const insertClient = db.prepare(`
  INSERT INTO clients (type, first_name, last_name, company_name, email, status, consent_data, mandate_signed)
  VALUES (@type, @first_name, @last_name, @company_name, @email, @status, 1, 1)
`);
const insertContract = db.prepare(`
  INSERT INTO contracts (client_id, company_id, branch, policy_number, product_name, annual_premium,
    payment_frequency, status, acq_commission_rate, rec_commission_rate)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertLca = db.prepare(`
  INSERT INTO contract_lca (contract_id, underwriting_status) VALUES (?, ?)
`);
const insertCommission = db.prepare(`
  INSERT INTO commissions (
    contract_id, type, label, commission_mode, expected_amount_chf, received_amount_chf,
    expected_payment_date, received_payment_date, status, product_name, insured_label,
    insurer_statement_reference, accounting_period, notes,
    reversal_of_commission_id, reversal_amount_chf
  ) VALUES (@contract_id, @type, @label, @commission_mode, @expected_amount_chf, @received_amount_chf,
    @expected_payment_date, @received_payment_date, @status, @product_name, @insured_label,
    @insurer_statement_reference, @accounting_period, @notes,
    @reversal_of_commission_id, @reversal_amount_chf)
`);

function commission(overrides) {
  return insertCommission.run({
    type: 'acquisition', label: null, commission_mode: 'fixed_amount',
    expected_amount_chf: 0, received_amount_chf: 0,
    expected_payment_date: null, received_payment_date: null, status: 'expected',
    product_name: null, insured_label: null, insurer_statement_reference: null,
    accounting_period: null, notes: null,
    reversal_of_commission_id: null, reversal_amount_chf: null,
    ...overrides,
  }).lastInsertRowid;
}

// --- Scénario 1 : client LAMal seul, commission fixe attendue -------------
const clientLamalSeul = insertClient.run({
  type: 'particulier', first_name: DEMO_MARKER, last_name: 'Client LAMal seul', company_name: null,
  email: 'demo.lamal.seul@demo-fictif.invalid', status: 'client',
}).lastInsertRowid;
const contractLamalSeul = insertContract.run(
  clientLamalSeul, companyId('Groupe Mutuel'), 'lamal', 'DEMO-LAMAL-001',
  'LAMal assurance de base', 4620, 'mensuelle', 'actif', 0, 0
).lastInsertRowid;
commission({
  contract_id: contractLamalSeul, expected_amount_chf: 90, status: 'expected',
  expected_payment_date: '2026-09-30', accounting_period: '2026-Q3',
  insurer_statement_reference: 'GM-DECOMPTE-DEMO-001',
  notes: 'Démo : commission LAMal fixe attendue, montant fourni par la compagnie.',
});

// --- Scénario 2 : client LAMal + complémentaires, PLUSIEURS commissions
// sur le même dossier LCA (Global Smart, Mundo, hospitalisation) ----------
const clientLamalComp = insertClient.run({
  type: 'particulier', first_name: DEMO_MARKER, last_name: 'Client LAMal et complémentaires', company_name: null,
  email: 'demo.lamal.complementaires@demo-fictif.invalid', status: 'client',
}).lastInsertRowid;
const contractLamalComp = insertContract.run(
  clientLamalComp, companyId('Groupe Mutuel'), 'lamal', 'DEMO-LAMAL-002',
  'LAMal assurance de base', 4200, 'mensuelle', 'actif', 0, 0
).lastInsertRowid;
commission({
  contract_id: contractLamalComp, expected_amount_chf: 84, received_amount_chf: 84, status: 'received',
  expected_payment_date: '2026-02-01', received_payment_date: '2026-02-10', accounting_period: '2026-Q1',
  notes: 'Démo : commission LAMal fixe entièrement reçue.',
});
const contractLca = insertContract.run(
  clientLamalComp, companyId('Groupe Mutuel'), 'lca', 'DEMO-LCA-002',
  'Complémentaires groupées', 1800, 'annuelle', 'actif', 0, 0
).lastInsertRowid;
insertLca.run(contractLca, 'acceptee');
const globalSmartId = commission({
  contract_id: contractLca, expected_amount_chf: 60, received_amount_chf: 60, status: 'received',
  product_name: 'Global Smart', expected_payment_date: '2026-01-15', received_payment_date: '2026-01-20',
  accounting_period: '2026-Q1', notes: 'Démo : ligne 1/3 du même dossier LCA — entièrement reçue.',
});
commission({
  contract_id: contractLca, expected_amount_chf: 40, received_amount_chf: 25, status: 'partially_received',
  product_name: 'Mundo', expected_payment_date: '2026-03-01', received_payment_date: '2026-03-05',
  accounting_period: '2026-Q1', notes: 'Démo : ligne 2/3 du même dossier LCA — paiement partiel (25/40 CHF).',
});
commission({
  contract_id: contractLca, expected_amount_chf: 35, status: 'expected',
  product_name: 'Hospitalisation', expected_payment_date: '2026-06-30', accounting_period: '2026-Q2',
  notes: 'Démo : ligne 3/3 du même dossier LCA — attendue.',
});

// --- Scénario 3 : foyer multi-membre — un contact, plusieurs assurés,
// une commission par contrat/assuré -----------------------------------------
const clientFoyer = insertClient.run({
  type: 'particulier', first_name: DEMO_MARKER, last_name: 'Foyer multi-membre (contact)', company_name: null,
  email: 'demo.foyer.multimembre@demo-fictif.invalid', status: 'client',
}).lastInsertRowid;
const foyerMembers = [
  { label: 'Parent (titulaire)', policy: 'DEMO-LAMAL-003A', amount: 90 },
  { label: 'Enfant 1', policy: 'DEMO-LAMAL-003B', amount: 20 },
  { label: 'Enfant 2', policy: 'DEMO-LAMAL-003C', amount: 20 },
];
for (const member of foyerMembers) {
  const contractId = insertContract.run(
    clientFoyer, companyId('CSS'), 'lamal', member.policy, 'LAMal assurance de base',
    member.label === 'Parent (titulaire)' ? 4500 : 1500, 'mensuelle', 'actif', 0, 0
  ).lastInsertRowid;
  commission({
    contract_id: contractId, expected_amount_chf: member.amount, status: 'expected',
    insured_label: member.label, expected_payment_date: '2026-10-31', accounting_period: '2026-Q4',
    notes: `Démo : foyer multi-membre — assuré concerné : ${member.label}.`,
  });
}

// --- Scénario 4 : offre refusée — aucune commission ------------------------
const clientRefuse = insertClient.run({
  type: 'particulier', first_name: DEMO_MARKER, last_name: 'Offre refusée', company_name: null,
  email: 'demo.offre.refusee@demo-fictif.invalid', status: 'prospect',
}).lastInsertRowid;
const contractRefuse = insertContract.run(
  clientRefuse, companyId('Sanitas'), 'lca', 'DEMO-LCA-004', 'Complémentaire hospitalisation',
  1200, 'annuelle', 'offre', 0, 0
).lastInsertRowid;
insertLca.run(contractRefuse, 'refusee');
// Aucune commission insérée : une offre refusée ne génère jamais de commission.

// --- Scénario 5 : produit vie utilisant le mode pourcentage ---------------
const clientVie = insertClient.run({
  type: 'particulier', first_name: DEMO_MARKER, last_name: 'Contrat vie pourcentage', company_name: null,
  email: 'demo.vie.pourcentage@demo-fictif.invalid', status: 'client',
}).lastInsertRowid;
const contractVie = insertContract.run(
  clientVie, companyId('Swiss Life'), 'vie_3a', 'DEMO-VIE-005', 'Prévoyance liée 3a',
  6000, 'annuelle', 'actif', 4, 1
).lastInsertRowid;
commission({
  contract_id: contractVie, commission_mode: 'percentage', expected_amount_chf: 240, status: 'expected',
  type: 'acquisition', expected_payment_date: '2026-01-01', accounting_period: '2026-Q1',
  notes: 'Démo : mode pourcentage conservé pour la branche vie (6000 CHF × 4 %).',
});

// --- Scénario 6 : reprise de commission ------------------------------------
// Reprise partielle sur la ligne « Global Smart » (scénario 2, entièrement
// reçue) : ne modifie ni ne supprime jamais la ligne d'origine — crée une
// nouvelle ligne négative liée, puis marque l'originale 'reversed'.
const reversalTx = db.transaction(() => {
  commission({
    contract_id: contractLca, type: 'reprise', commission_mode: 'manual_adjustment',
    expected_amount_chf: -20, status: 'expected', product_name: 'Global Smart',
    expected_payment_date: '2026-07-01',
    reversal_of_commission_id: globalSmartId, reversal_amount_chf: -20,
    notes: `Démo : reprise partielle de la commission #${globalSmartId} (résiliation rétroactive partielle).`,
  });
  db.prepare(`UPDATE commissions SET status = 'reversed' WHERE id = ?`).run(globalSmartId);
});
reversalTx();

console.log(
  'Environnement de démonstration commission créé (base isolée uniquement) : ' +
  '6 scénarios — LAMal seul, LAMal + complémentaires (3 lignes sur un même dossier LCA), ' +
  'foyer multi-membre (3 assurés), offre refusée (aucune commission), vie en mode pourcentage, ' +
  'reprise de commission.'
);
