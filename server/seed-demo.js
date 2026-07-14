// Données de démonstration (optionnel) : node server/seed-demo.js
import db from './db.js';

const clientCount = db.prepare('SELECT COUNT(*) AS n FROM clients').get().n;
if (clientCount > 0) {
  console.log('Des clients existent déjà — seed de démonstration ignoré.');
  process.exit(0);
}

const insertClient = db.prepare(`
  INSERT INTO clients (type, first_name, last_name, company_name, email, phone, birth_date,
    address, npa, city, canton, marital_status, profession, status,
    consent_data, consent_date, mandate_signed, mandate_date, info_lsa_date)
  VALUES (@type, @first_name, @last_name, @company_name, @email, @phone, @birth_date,
    @address, @npa, @city, @canton, @marital_status, @profession, @status,
    @consent_data, @consent_date, @mandate_signed, @mandate_date, @info_lsa_date)
`);

const clients = [
  {
    type: 'particulier', first_name: 'Julien', last_name: 'Moret', company_name: null,
    email: 'julien.moret@example.ch', phone: '+41 79 000 00 01', birth_date: '1988-04-12',
    address: 'Rue du Lac 12', npa: '1006', city: 'Lausanne', canton: 'VD',
    marital_status: 'marié', profession: 'Ingénieur', status: 'client',
    consent_data: 1, consent_date: '2026-01-15', mandate_signed: 1, mandate_date: '2026-01-15',
    info_lsa_date: '2026-01-15',
  },
  {
    type: 'particulier', first_name: 'Sofia', last_name: 'Ricci', company_name: null,
    email: 'sofia.ricci@example.ch', phone: '+41 78 000 00 02', birth_date: '1993-09-30',
    address: 'Avenue de la Gare 5', npa: '1950', city: 'Sion', canton: 'VS',
    marital_status: 'célibataire', profession: 'Infirmière', status: 'client',
    consent_data: 1, consent_date: '2026-03-02', mandate_signed: 1, mandate_date: '2026-03-02',
    info_lsa_date: '2026-03-02',
  },
  {
    type: 'particulier', first_name: 'Marc', last_name: 'Dubois', company_name: null,
    email: 'marc.dubois@example.ch', phone: '+41 76 000 00 03', birth_date: '1975-01-22',
    address: 'Chemin des Vignes 3', npa: '1227', city: 'Carouge', canton: 'GE',
    marital_status: 'divorcé', profession: 'Indépendant', status: 'prospect',
    consent_data: 0, consent_date: null, mandate_signed: 0, mandate_date: null, info_lsa_date: null,
  },
  {
    type: 'entreprise', first_name: null, last_name: null, company_name: 'Boulangerie du Bourg Sàrl',
    email: 'contact@boulangeriedubourg.ch', phone: '+41 21 000 00 04', birth_date: null,
    address: 'Grand-Rue 8', npa: '1110', city: 'Morges', canton: 'VD',
    marital_status: null, profession: null, status: 'client',
    consent_data: 1, consent_date: '2025-11-20', mandate_signed: 1, mandate_date: '2025-11-20',
    info_lsa_date: '2025-11-20',
  },
];
const ids = clients.map((c) => insertClient.run(c).lastInsertRowid);

const companyId = (name) => db.prepare('SELECT id FROM companies WHERE name = ?').get(name).id;

const insertContract = db.prepare(`
  INSERT INTO contracts (client_id, company_id, branch, policy_number, product_name,
    annual_premium, payment_frequency, start_date, end_date, status,
    acq_commission_rate, rec_commission_rate)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertCommission = db.prepare(`
  INSERT INTO commissions (contract_id, type, label, amount, due_date, status, paid_date)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const year = new Date().getFullYear();

let id = insertContract.run(ids[0], companyId('Swiss Life'), 'vie_3a', 'SL-3A-482291',
  'Prévoyance liée 3a', 6883, 'annuelle', `${year - 1}-01-01`, `${year + 24}-01-01`, 'actif', 4, 1).lastInsertRowid;
insertCommission.run(id, 'acquisition', "Commission d'acquisition", 275.3, `${year - 1}-01-01`, 'payee', `${year - 1}-02-10`);
insertCommission.run(id, 'recurrente', `Commission de portefeuille ${year}`, 68.85, `${year}-12-31`, 'attendue', null);

id = insertContract.run(ids[0], companyId('CSS'), 'lca', 'CSS-LCA-118822',
  'Complémentaire hospitalisation', 2160, 'mensuelle', `${year}-01-01`, null, 'actif', 3, 0.5).lastInsertRowid;
insertCommission.run(id, 'acquisition', "Commission d'acquisition", 64.8, `${year}-01-01`, 'payee', `${year}-02-05`);

id = insertContract.run(ids[1], companyId('AXA'), 'vie_3b', 'AXA-3B-90332',
  'Assurance vie 3b mixte', 4800, 'annuelle', `${year}-04-01`, `${year + 19}-04-01`, 'actif', 4, 1).lastInsertRowid;
insertCommission.run(id, 'acquisition', "Commission d'acquisition", 192, `${year}-04-01`, 'attendue', null);

id = insertContract.run(ids[1], companyId('Groupe Mutuel'), 'lamal',
  'GM-AOS-77120', 'LAMal assurance de base', 4620, 'mensuelle', `${year}-01-01`, null, 'actif', 3, 0.5).lastInsertRowid;
insertCommission.run(id, 'acquisition', "Commission d'acquisition", 138.6, `${year}-01-01`, 'payee', `${year}-03-01`);

id = insertContract.run(ids[3], companyId('Helvetia'), 'hypotheque', 'HEL-HYP-55010',
  'Assurance amortissement hypothèque', 9200, 'annuelle', `${year - 1}-07-01`, `${year + 14}-07-01`, 'actif', 4, 1).lastInsertRowid;
insertCommission.run(id, 'acquisition', "Commission d'acquisition", 368, `${year - 1}-07-01`, 'payee', `${year - 1}-08-15`);
insertCommission.run(id, 'recurrente', `Commission de portefeuille ${year}`, 92, `${year}-12-31`, 'attendue', null);

id = insertContract.run(ids[2], companyId('Zurich'), 'vie_3a', null,
  'Offre prévoyance 3a', 7056, 'annuelle', null, null, 'offre', 4, 1).lastInsertRowid;

const insertTask = db.prepare(`
  INSERT INTO tasks (title, description, due_date, priority, client_id) VALUES (?, ?, ?, ?, ?)
`);
insertTask.run('Relancer Marc Dubois — offre 3a Zurich', 'Faire signer le mandat de courtage et remettre l’information LSA.',
  new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), 'haute', ids[2]);
insertTask.run('Comparatif LAMal pour Sofia Ricci', 'Vérifier les primes 2027 dès publication.',
  new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10), 'normale', ids[1]);

const insertActivity = db.prepare(
  'INSERT INTO activities (client_id, type, content) VALUES (?, ?, ?)'
);
insertActivity.run(ids[0], 'rdv', 'Rendez-vous annuel de revue du portefeuille. Situation stable.');
insertActivity.run(ids[2], 'appel', 'Premier contact téléphonique — intéressé par un pilier 3a.');

console.log('Données de démonstration insérées : 4 clients, 6 contrats, commissions, tâches.');
