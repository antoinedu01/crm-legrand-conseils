import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.CRM_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'crm.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  finma_reg TEXT,          -- n° d'enregistrement au registre FINMA des intermédiaires (art. 42 LSA)
  cicero_reg TEXT,         -- n° Cicero (formation continue)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  finma_number TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  default_acq_rate REAL DEFAULT 0,   -- taux de commission d'acquisition par défaut (%)
  default_rec_rate REAL DEFAULT 0,   -- taux de commission de portefeuille par défaut (%)
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'particulier',      -- particulier | entreprise
  first_name TEXT,
  last_name TEXT,
  company_name TEXT,
  email TEXT,
  phone TEXT,
  birth_date TEXT,
  address TEXT,
  npa TEXT,
  city TEXT,
  canton TEXT,
  nationality TEXT,
  marital_status TEXT,
  profession TEXT,
  avs_number TEXT,                               -- donnée sensible : n° AVS, à ne saisir que si nécessaire
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'prospect',       -- prospect | client | ancien | anonymise
  consent_data INTEGER NOT NULL DEFAULT 0,       -- consentement au traitement des données (nLPD)
  consent_date TEXT,
  mandate_signed INTEGER NOT NULL DEFAULT 0,     -- mandat de courtage signé
  mandate_date TEXT,
  info_lsa_date TEXT,                            -- date de remise de l'information selon art. 45 LSA
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  company_id INTEGER NOT NULL REFERENCES companies(id),
  branch TEXT NOT NULL,                          -- vie_3a | vie_3b | lamal | lca | lpp | hypotheque | rc_menage | autre
  policy_number TEXT,
  product_name TEXT,
  annual_premium REAL NOT NULL DEFAULT 0,        -- prime annuelle en CHF
  payment_frequency TEXT NOT NULL DEFAULT 'annuelle',  -- mensuelle | trimestrielle | semestrielle | annuelle | unique
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'offre',          -- offre | actif | suspendu | resilie | echu
  acq_commission_rate REAL DEFAULT 0,            -- % de la prime annuelle, commission d'acquisition
  rec_commission_rate REAL DEFAULT 0,            -- % de la prime annuelle, commission récurrente (portefeuille)
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL REFERENCES contracts(id),
  type TEXT NOT NULL,                            -- acquisition | recurrente | ajustement
  label TEXT,
  amount REAL NOT NULL DEFAULT 0,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'attendue',       -- attendue | payee | annulee
  paid_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER REFERENCES clients(id),
  contract_id INTEGER REFERENCES contracts(id),
  title TEXT NOT NULL,
  description TEXT,
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'normale',      -- basse | normale | haute
  status TEXT NOT NULL DEFAULT 'ouverte',        -- ouverte | terminee
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  type TEXT NOT NULL DEFAULT 'note',             -- appel | email | rdv | note | document | conformite
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contracts_client ON contracts(client_id);
CREATE INDEX IF NOT EXISTS idx_contracts_company ON contracts(company_id);
CREATE INDEX IF NOT EXISTS idx_commissions_contract ON commissions(contract_id);
CREATE INDEX IF NOT EXISTS idx_activities_client ON activities(client_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
`);

// Migrations légères versionnées (PRAGMA user_version).
// Réversibilité : chaque migration est documentée dans docs/MIGRATIONS.md
// et une sauvegarde de la base est conseillée avant toute mise à jour.
const version = db.pragma('user_version', { simple: true });
if (version < 1) {
  const migrate = db.transaction(() => {
    const cols = db.prepare('PRAGMA table_info(clients)').all().map((c) => c.name);
    if (!cols.includes('owner_user_id')) {
      // Prépare l'évolution multi-conseiller : propriétaire du dossier
      db.exec('ALTER TABLE clients ADD COLUMN owner_user_id INTEGER REFERENCES users(id)');
    }
    // Index pour la détection de doublons (e-mail / téléphone)
    db.exec('CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone)');
    db.pragma('user_version = 1');
  });
  migrate();
}
if (version < 2) {
  const migrate = db.transaction(() => {
    const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
    // Double authentification TOTP (2FA)
    if (!cols.includes('totp_secret')) db.exec('ALTER TABLE users ADD COLUMN totp_secret TEXT');
    if (!cols.includes('totp_enabled')) {
      db.exec('ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0');
    }
    db.pragma('user_version = 2');
  });
  migrate();
}

if (version < 3) {
  // Bloc 1 du module « Développement du portefeuille » :
  // canaux d'acquisition, coûts par canal, origine des prospects.
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        sort INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        channel_id INTEGER REFERENCES channels(id),
        status TEXT NOT NULL DEFAULT 'brouillon',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS channel_costs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id INTEGER NOT NULL REFERENCES channels(id),
        month TEXT NOT NULL,                -- format AAAA-MM
        amount REAL NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS lead_details (
        client_id INTEGER PRIMARY KEY REFERENCES clients(id),
        channel_id INTEGER REFERENCES channels(id),
        campaign_id INTEGER REFERENCES campaigns(id),
        referrer_client_id INTEGER REFERENCES clients(id),
        pipeline_stage TEXT NOT NULL DEFAULT 'nouveau',
        main_need TEXT,
        age_range TEXT,
        work_situation TEXT,
        family_situation TEXT,
        contact_pref TEXT,
        score INTEGER NOT NULL DEFAULT 0,
        score_reasons TEXT,
        classement TEXT NOT NULL DEFAULT 'non_qualifie',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_lead_details_channel ON lead_details(channel_id);
      CREATE INDEX IF NOT EXISTS idx_channel_costs_channel ON channel_costs(channel_id, month);
    `);
    db.pragma('user_version = 3');
  });
  migrate();
}

if (version < 4) {
  // Bloc 2 : scoring configurable des prospects
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS scoring_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        label TEXT NOT NULL,
        points INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        sort INTEGER NOT NULL DEFAULT 0
      );
    `);
    const cols = db.prepare('PRAGMA table_info(lead_details)').all().map((c) => c.name);
    if (!cols.includes('urgent')) {
      db.exec('ALTER TABLE lead_details ADD COLUMN urgent INTEGER NOT NULL DEFAULT 0');
    }
    db.pragma('user_version = 4');
  });
  migrate();
}

if (version < 5) {
  // Bloc 3 : journal des actions commerciales (plan d'action quotidien)
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS action_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action_key TEXT NOT NULL,
        action_type TEXT,
        client_id INTEGER REFERENCES clients(id),
        contract_id INTEGER REFERENCES contracts(id),
        result TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_action_log_key ON action_log(action_key, created_at);
    `);
    db.pragma('user_version = 5');
  });
  migrate();
}

// Règles de scoring par défaut (points modifiables dans l'interface)
const ruleCount = db.prepare('SELECT COUNT(*) AS n FROM scoring_rules').get().n;
if (ruleCount === 0) {
  const insert = db.prepare(
    'INSERT INTO scoring_rules (key, label, points, sort) VALUES (?, ?, ?, ?)'
  );
  const seed = db.transaction((rows) => rows.forEach((r, i) => insert.run(...r, i)));
  seed([
    ['recommande', 'Recommandé par un client ou un partenaire', 20],
    ['besoin_identifie', 'Besoin principal clairement identifié', 15],
    ['urgent', 'Besoin urgent ou échéance proche', 20],
    ['rdv_fixe', 'Rendez-vous fixé', 20],
    ['offre_en_cours', 'Offre envoyée (en attente de décision)', 15],
    ['coordonnees_completes', 'E-mail et téléphone renseignés', 10],
    ['profil_complet', 'Profil complété (âge et situation professionnelle)', 10],
    ['plage_contact', 'Disponibilité de contact connue', 5],
    ['echange_recent', 'Échange dans les 14 derniers jours', 10],
    ['sans_suivi_30j', 'Aucun échange depuis plus de 30 jours', -15],
  ]);
}

// Les 14 canaux d'acquisition du plan de développement
const channelCount = db.prepare('SELECT COUNT(*) AS n FROM channels').get().n;
if (channelCount === 0) {
  const insert = db.prepare(
    'INSERT INTO channels (key, name, description, sort) VALUES (?, ?, ?, ?)'
  );
  const seed = db.transaction((rows) => rows.forEach((r, i) => insert.run(...r, i)));
  seed([
    ['recommandations', 'Recommandations de clients', 'Parrainage par vos clients satisfaits — le canal le plus rentable.'],
    ['fiduciaires', 'Partenariats fiduciaires', 'Comptables et fiduciaires qui recommandent vos services.'],
    ['courtiers_immobiliers', 'Partenariats courtiers immobiliers', 'Courtiers en immobilier apporteurs d’affaires.'],
    ['agences_immobilieres', 'Partenariats agences immobilières', 'Agences qui orientent leurs acheteurs vers vous.'],
    ['specialistes_hypothecaires', 'Partenariats spécialistes hypothécaires', 'Conseillers hypothécaires — synergie assurance/amortissement.'],
    ['salles_sport', 'Partenariats salles de sport & clubs', 'Présence et offres auprès des clubs sportifs.'],
    ['entreprises_independants', 'Partenariats entreprises & indépendants', 'Employeurs et indépendants (LPP, perte de gain).'],
    ['site_internet', 'Formulaires du site internet', 'Demandes entrantes via legrandconseils.ch.'],
    ['reseaux_sociaux', 'Réseaux sociaux', 'LinkedIn, Instagram, Facebook — publications et messages.'],
    ['contenus', 'Contenus pédagogiques', 'Articles, guides, vidéos explicatives.'],
    ['webinaires_evenements', 'Webinaires & événements', 'Présentations publiques, soirées d’information.'],
    ['campagnes_pub', 'Campagnes publicitaires', 'Publicité payante avec formulaire de consentement.'],
    ['reactivation', 'Réactivation d’anciens prospects', 'Reprise de contact avec les dossiers restés sans suite.'],
    ['vente_complementaire', 'Vente complémentaire (clients existants)', 'Besoins non couverts de votre portefeuille actuel.'],
  ]);
}

// Compagnies suisses proposées par défaut au premier démarrage
const companyCount = db.prepare('SELECT COUNT(*) AS n FROM companies').get().n;
if (companyCount === 0) {
  const insert = db.prepare(
    'INSERT INTO companies (name, default_acq_rate, default_rec_rate) VALUES (?, ?, ?)'
  );
  const seed = db.transaction((rows) => rows.forEach((r) => insert.run(...r)));
  seed([
    ['Swiss Life', 4, 1],
    ['AXA', 4, 1],
    ['Helvetia', 4, 1],
    ['Zurich', 4, 1],
    ['Bâloise', 4, 1],
    ['Allianz Suisse', 4, 1],
    ['Groupe Mutuel', 3, 0.5],
    ['CSS', 3, 0.5],
    ['Visana', 3, 0.5],
    ['Sanitas', 3, 0.5],
    ['Concordia', 3, 0.5],
    ['Generali', 4, 1],
  ]);
}

export default db;
