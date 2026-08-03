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

if (version < 6) {
  // Formulaires publics du site : preuves de consentement horodatées (nLPD)
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS consents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL REFERENCES clients(id),
        kind TEXT NOT NULL DEFAULT 'site_form',   -- origine du consentement
        granted INTEGER NOT NULL DEFAULT 1,
        text_version TEXT,                        -- version du texte affiché au moment du consentement
        source TEXT,                              -- page/outil d'origine
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_consents_client ON consents(client_id);
    `);
    db.pragma('user_version = 6');
  });
  migrate();
}

// Note : il n'existe pas de bloc « version < 7 » dans cette branche. La
// version 7 reste conceptuellement réservée au Bloc 4 (partenaires,
// branche feature/lead-generation-engine, non fusionnée) — voir
// PROJECT_HANDOFF.md §10. Cette migration passe donc directement de 6 à 8,
// sans collision, conformément à la décision humaine validée.
if (version < 8) {
  // Modèle métier « Assurance Suisse » (Lot A) : schéma relationnel
  // uniquement — aucune route ni interface n'est encore branchée dessus.
  const migrate = db.transaction(() => {
    // Champs communs de pilotage de la revue de portefeuille, valables
    // pour toutes les branches (évite toute duplication par famille).
    const contractCols = db.prepare('PRAGMA table_info(contracts)').all().map((c) => c.name);
    if (!contractCols.includes('review_frequency')) {
      db.exec("ALTER TABLE contracts ADD COLUMN review_frequency TEXT DEFAULT 'annuelle'");
    }
    if (!contractCols.includes('review_last_date')) {
      db.exec('ALTER TABLE contracts ADD COLUMN review_last_date TEXT');
    }
    if (!contractCols.includes('review_next_date')) {
      db.exec('ALTER TABLE contracts ADD COLUMN review_next_date TEXT');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_contracts_review_next ON contracts(review_next_date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_contracts_branch_status ON contracts(branch, status)');

    // LAMal — uniquement les données propres à la LAMal ; ni prime, ni
    // date contractuelle (déjà portées par contracts).
    db.exec(`
      CREATE TABLE IF NOT EXISTS contract_lamal (
        contract_id INTEGER PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE,
        care_model TEXT NOT NULL,
        deductible INTEGER NOT NULL CHECK (deductible >= 0),
        accident_coverage INTEGER NOT NULL DEFAULT 1 CHECK (accident_coverage IN (0, 1)),
        canton TEXT,
        tariff_region TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_contract_lamal_deductible ON contract_lamal(deductible);
    `);

    // LCA — uniquement le processus de souscription/décision ; les
    // garanties elles-mêmes vivent dans contract_coverages. Aucun
    // diagnostic, pathologie ni contenu de questionnaire médical : les
    // champs *_notes sont de courts statuts administratifs uniquement.
    db.exec(`
      CREATE TABLE IF NOT EXISTS contract_lca (
        contract_id INTEGER PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE,
        underwriting_status TEXT NOT NULL DEFAULT 'non_requis',
        waiting_period_days INTEGER CHECK (waiting_period_days IS NULL OR waiting_period_days >= 0),
        administrative_reservation_status TEXT NOT NULL DEFAULT 'aucune',
        reservation_notes TEXT,
        exclusions_status TEXT NOT NULL DEFAULT 'aucune',
        exclusions_notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_contract_lca_underwriting_status ON contract_lca(underwriting_status);
    `);

    // Vie 3a/3b — le type 3a/3b n'est pas dupliqué ici : il est déjà
    // porté par contracts.branch. Les bénéficiaires vivent dans
    // contract_beneficiaries, pas dans un champ texte de cette table.
    db.exec(`
      CREATE TABLE IF NOT EXISTS contract_life (
        contract_id INTEGER PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE,
        component_type TEXT NOT NULL,
        insured_death_capital REAL CHECK (insured_death_capital IS NULL OR insured_death_capital >= 0),
        insured_disability_capital REAL CHECK (insured_disability_capital IS NULL OR insured_disability_capital >= 0),
        insured_rent REAL CHECK (insured_rent IS NULL OR insured_rent >= 0),
        surrender_value REAL CHECK (surrender_value IS NULL OR surrender_value >= 0),
        premium_waiver INTEGER NOT NULL DEFAULT 0 CHECK (premium_waiver IN (0, 1)),
        indexation_type TEXT NOT NULL DEFAULT 'aucune',
        policy_term_years INTEGER CHECK (policy_term_years IS NULL OR policy_term_years > 0),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Risque pur / incapacité / invalidité.
    db.exec(`
      CREATE TABLE IF NOT EXISTS contract_income_protection (
        contract_id INTEGER PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE,
        benefit_type TEXT NOT NULL,
        insured_amount REAL CHECK (insured_amount IS NULL OR insured_amount >= 0),
        waiting_period_days INTEGER CHECK (waiting_period_days IS NULL OR waiting_period_days >= 0),
        benefit_duration_months INTEGER CHECK (benefit_duration_months IS NULL OR benefit_duration_months > 0),
        disability_trigger_rate INTEGER CHECK (
          disability_trigger_rate IS NULL OR (disability_trigger_rate >= 0 AND disability_trigger_rate <= 100)
        ),
        coordination_ai_lpp INTEGER NOT NULL DEFAULT 0 CHECK (coordination_ai_lpp IN (0, 1)),
        premium_waiver INTEGER NOT NULL DEFAULT 0 CHECK (premium_waiver IN (0, 1)),
        exclusions_notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // LPP / IJM — volontairement minimal, usage particulier uniquement,
    // pas un module entreprise.
    db.exec(`
      CREATE TABLE IF NOT EXISTS contract_lpp_ijm (
        contract_id INTEGER PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE,
        product_type TEXT NOT NULL,
        institution_name TEXT,
        retirement_capital REAL CHECK (retirement_capital IS NULL OR retirement_capital >= 0),
        disability_pension REAL CHECK (disability_pension IS NULL OR disability_pension >= 0),
        daily_allowance REAL CHECK (daily_allowance IS NULL OR daily_allowance >= 0),
        waiting_period_days INTEGER CHECK (waiting_period_days IS NULL OR waiting_period_days >= 0),
        benefit_duration_days INTEGER CHECK (benefit_duration_days IS NULL OR benefit_duration_days > 0),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Garanties combinables (principalement LCA) — évite une colonne par
    // garantie dans contract_lca.
    db.exec(`
      CREATE TABLE IF NOT EXISTS contract_coverages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        coverage_type TEXT NOT NULL,
        coverage_level TEXT,
        insured_amount REAL CHECK (insured_amount IS NULL OR insured_amount >= 0),
        annual_limit REAL CHECK (annual_limit IS NULL OR annual_limit >= 0),
        reimbursement_rate INTEGER CHECK (
          reimbursement_rate IS NULL OR (reimbursement_rate >= 0 AND reimbursement_rate <= 100)
        ),
        waiting_period_days INTEGER CHECK (waiting_period_days IS NULL OR waiting_period_days >= 0),
        status TEXT NOT NULL DEFAULT 'active',
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (contract_id, coverage_type)
      );
      CREATE INDEX IF NOT EXISTS idx_contract_coverages_contract ON contract_coverages(contract_id);
      CREATE INDEX IF NOT EXISTS idx_contract_coverages_type ON contract_coverages(coverage_type);
    `);

    // Bénéficiaires — désignation juridique courte uniquement ; pas
    // d'identité complète obligatoire de tiers non consentants au CRM.
    // beneficiary_client_id permet un lien optionnel si le bénéficiaire
    // est déjà client du CRM, sans dupliquer son identité.
    db.exec(`
      CREATE TABLE IF NOT EXISTS contract_beneficiaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        beneficiary_client_id INTEGER REFERENCES clients(id),
        beneficiary_type TEXT NOT NULL,
        designation TEXT,
        percentage REAL CHECK (percentage IS NULL OR (percentage >= 0 AND percentage <= 100)),
        priority_order INTEGER CHECK (priority_order IS NULL OR priority_order >= 0),
        revocable INTEGER NOT NULL DEFAULT 1 CHECK (revocable IN (0, 1)),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_contract_beneficiaries_contract ON contract_beneficiaries(contract_id);
      CREATE INDEX IF NOT EXISTS idx_contract_beneficiaries_client ON contract_beneficiaries(beneficiary_client_id);
    `);

    // Historique métier du contrat — distinct du journal d'audit
    // technique (audit_log) : événements de cycle de vie, immuables,
    // valeurs simples en texte (pas de JSON libre), jamais de contenu
    // médical détaillé. Aucun événement n'est généré ici pour les
    // contrats existants.
    db.exec(`
      CREATE TABLE IF NOT EXISTS contract_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        effective_date TEXT,
        field_name TEXT,
        old_value TEXT,
        new_value TEXT,
        description TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_contract_history_contract_created ON contract_history(contract_id, created_at);
    `);

    db.pragma('user_version = 8');
  });
  migrate();
}

// Aucun bloc « version < 9 » n'existait avant ce lot (dernier bloc : < 8,
// ci-dessus). Vérifié à nouveau juste avant l'écriture de cette migration :
// aucune autre branche fusionnée depuis n'introduit de version 9 (LOT 2,
// Legrand Diagnostic 360 — audit préalable documenté dans le rapport du lot).
if (version < 9) {
  // LOT 2 — Legrand Diagnostic 360 (Lot 2) : socle foyer, tables entièrement
  // nouvelles et isolées (préfixe hors `advisory_` par décision LOT 1, ce
  // sont les deux seules tables transverses du module). Migration purement
  // additive : aucune table existante n'est modifiée, aucune donnée réécrite.
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS households (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT,                                    -- nom d'usage interne du dossier, jamais affiché tel quel au client
        primary_client_id INTEGER NOT NULL REFERENCES clients(id),
        status TEXT NOT NULL DEFAULT 'actif',          -- actif | archive (statut du FOYER)
        notes TEXT,                                    -- notes internes conseiller uniquement
        owner_user_id INTEGER REFERENCES users(id),    -- prépare le multi-conseiller, même logique que clients.owner_user_id
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_households_primary_client ON households(primary_client_id);
      CREATE INDEX IF NOT EXISTS idx_households_status ON households(status);

      CREATE TABLE IF NOT EXISTS household_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        household_id INTEGER NOT NULL REFERENCES households(id),
        client_id INTEGER NOT NULL REFERENCES clients(id),
        member_role TEXT NOT NULL,                     -- principal | conjoint | enfant | autre_charge (rôle DANS ce foyer, aucun lien avec un rôle d'accès applicatif)
        relationship_detail TEXT,                      -- nuance libre courte, jamais une donnée médicale
        legal_representative_client_id INTEGER REFERENCES clients(id),  -- délégation de contact (ex. enfant sans coordonnées propres)
        start_date TEXT,                               -- date d'entrée dans le foyer
        end_date TEXT,                                 -- date de sortie éventuelle
        status TEXT NOT NULL DEFAULT 'actif',          -- actif | archive (statut de l'ADHÉSION, distinct de households.status qui est le statut du foyer)
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_household_members_household ON household_members(household_id);
      CREATE INDEX IF NOT EXISTS idx_household_members_client ON household_members(client_id);
      CREATE INDEX IF NOT EXISTS idx_household_members_household_role ON household_members(household_id, member_role);
      -- Une personne ne peut avoir qu'une seule adhésion active par foyer,
      -- mais peut appartenir à plusieurs foyers actifs différents (décision
      -- humaine validée, GATE LOT 1, décision 1) : household_id fait partie
      -- de la clé de cet index, il n'interdit donc jamais deux lignes
      -- actives pour le même client_id dans deux foyers distincts.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_household_members_active_unique
        ON household_members(household_id, client_id) WHERE status = 'actif';
      -- Au maximum un membre principal actif par foyer (garantie SQL).
      -- L'invariant complémentaire « au moins un principal actif » ne peut
      -- pas s'exprimer proprement en SQLite (pas de contrainte inter-lignes
      -- portant sur un agrégat) : il est garanti par le service métier et
      -- ses transactions (création atomique foyer+principal, procédure
      -- set-primary, refus de retirer le principal sans remplacement).
      CREATE UNIQUE INDEX IF NOT EXISTS idx_household_members_one_active_principal
        ON household_members(household_id) WHERE status = 'actif' AND member_role = 'principal';
    `);

    db.pragma('user_version = 9');
  });
  migrate();
}

// Aucun bloc « version < 10 » n'existait avant ce lot (dernier bloc : < 9,
// ci-dessus). Vérifié à nouveau juste avant l'écriture de cette migration :
// aucune autre branche distante ne dépasse la version 9 (LOT 3A, Legrand
// Diagnostic 360 — audit préalable documenté dans le rapport du lot).
if (version < 10) {
  // LOT 3A — Legrand Diagnostic 360 (Lot 3A) : sessions de rendez-vous et
  // moteur générique de questionnaires versionnés. Migration purement
  // additive, aucune table existante modifiée. Identifiants techniques en
  // anglais snake_case (statuts, types, opérateurs), décision humaine
  // explicite reconduisant la divergence déjà actée et documentée au Lot 2
  // (`exact_match`/`probable_match`/etc.) — assumée vis-à-vis du reste du
  // CRM en français. Aucun `CHECK` déclaratif sur les colonnes-énumération
  // (statuts, types, domaines) : convention déjà en vigueur pour
  // `clients.status`/`contracts.status`/`households.status` (validation en
  // applicatif uniquement, cf. `server/validate.js`), reconduite ici à
  // l'identique pour rester cohérent avec le reste du schéma.
  const migrate = db.transaction(() => {
    db.exec(`
      -- Une famille fonctionnelle de questionnaires (ex. « Questionnaire
      -- Assurance Maladie »). domain ne contient PLUS 'mixed' depuis la
      -- décision de composition modulaire (voir advisory_session_questionnaires
      -- ci-dessous) : 'mixed' est désormais un concept exclusivement de
      -- SESSION (assemblage de plusieurs versions), jamais d'un questionnaire
      -- ou d'une version pris isolément — ceci évite toute duplication du
      -- contenu santé/vie-prévoyance dans une version « mixte » artificielle.
      CREATE TABLE IF NOT EXISTS advisory_questionnaires (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stable_key TEXT NOT NULL UNIQUE,        -- jamais réutilisée pour 2 questionnaires différents
        domain TEXT NOT NULL,                   -- common | health | life_pension
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',  -- active | archived (statut grossier de la famille)
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_advisory_questionnaires_domain ON advisory_questionnaires(domain);
      CREATE INDEX IF NOT EXISTS idx_advisory_questionnaires_status ON advisory_questionnaires(status);

      -- Une version figée et publiable indépendamment des suivantes. Une
      -- session référence toujours une (ou plusieurs, voir
      -- advisory_session_questionnaires) version PRÉCISE, jamais « la
      -- dernière » de façon implicite.
      CREATE TABLE IF NOT EXISTS advisory_questionnaire_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        questionnaire_id INTEGER NOT NULL REFERENCES advisory_questionnaires(id),
        version_number INTEGER NOT NULL,        -- strictement croissant par questionnaire_id (garanti par le service, pas par SQL)
        status TEXT NOT NULL DEFAULT 'draft',   -- draft | published | archived
        notes TEXT,
        content_hash TEXT,                      -- empreinte SHA-256 (module crypto de Node, déjà utilisé par server/app.js et server/totp.js — aucune dépendance ajoutée), calculée à la publication sur une sérialisation stable de la structure (sections+questions+options), pour détecter toute altération d'une version déjà publiée
        published_by_user_id INTEGER REFERENCES users(id),
        published_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(questionnaire_id, version_number)
      );
      CREATE INDEX IF NOT EXISTS idx_advisory_questionnaire_versions_questionnaire
        ON advisory_questionnaire_versions(questionnaire_id);
      CREATE INDEX IF NOT EXISTS idx_advisory_questionnaire_versions_status
        ON advisory_questionnaire_versions(status);

      -- Une section, ordonnée, au sein d'une version. Plus de colonne
      -- « domain » ici (contrairement à une conception antérieure envisagée) :
      -- puisqu'une version entière appartient déjà à un seul domaine
      -- (common|health|life_pension, jamais mixed), une section hérite
      -- simplement du domaine de sa version, sans champ redondant.
      CREATE TABLE IF NOT EXISTS advisory_sections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        questionnaire_version_id INTEGER NOT NULL REFERENCES advisory_questionnaire_versions(id),
        stable_key TEXT NOT NULL,               -- stable au sein de la version
        title TEXT NOT NULL,
        description TEXT,
        sort_order INTEGER NOT NULL,
        applies_to TEXT NOT NULL DEFAULT 'household', -- household (une fois) | member (répétée par personne concernée)
        display_condition TEXT,                 -- JSON déclaratif (server/advisoryConditions.js), jamais de code exécutable
        status TEXT NOT NULL DEFAULT 'active',   -- active | archived
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(questionnaire_version_id, stable_key)
      );
      CREATE INDEX IF NOT EXISTS idx_advisory_sections_version ON advisory_sections(questionnaire_version_id);

      -- Une question. questionnaire_version_id est dupliqué depuis la section
      -- parente (même principe que advisory_rules.domain dupliqué depuis son
      -- rule_set, documenté dans DATA_MODEL.md §5.2 — jamais divergent,
      -- contrainte applicative) afin de pouvoir exprimer directement en SQL
      -- l'unicité de stable_key AU NIVEAU DE LA VERSION (pas seulement de la
      -- section), tel qu'exigé par le LOT 3A.
      CREATE TABLE IF NOT EXISTS advisory_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section_id INTEGER NOT NULL REFERENCES advisory_sections(id),
        questionnaire_version_id INTEGER NOT NULL REFERENCES advisory_questionnaire_versions(id),
        stable_key TEXT NOT NULL,
        advisor_text TEXT NOT NULL,
        client_text TEXT,
        type TEXT NOT NULL,                     -- single_choice|multiple_choice|text|long_text|integer|decimal|money|date|boolean
        scope TEXT NOT NULL DEFAULT 'household', -- household|member|session
        required INTEGER NOT NULL DEFAULT 0,
        allows_unknown INTEGER NOT NULL DEFAULT 1,
        allows_not_applicable INTEGER NOT NULL DEFAULT 0, -- distinct de allows_unknown : « ne s'applique pas à ce foyer » n'est pas « je ne sais pas ». Désactivé par défaut (contrairement à allows_unknown) : autoriser « non applicable » est un choix explicite du concepteur de questionnaire, pas une facilité par défaut, pour éviter qu'elle ne devienne un moyen détourné de satisfaire une question obligatoire sans y répondre.
        sort_order INTEGER NOT NULL,
        help_text TEXT,
        display_condition TEXT,                 -- JSON déclaratif, jamais de code exécutable
        validation_rule TEXT,                    -- JSON déclaratif (bornes/longueur selon le type), jamais de code
        sensitive INTEGER NOT NULL DEFAULT 0,    -- classification simple ; PRÉPARATOIRE : non encore consultée par aucune route de ce lot (voir SECURITY_PRIVACY.md)
        status TEXT NOT NULL DEFAULT 'active',   -- active | archived
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(questionnaire_version_id, stable_key)
      );
      CREATE INDEX IF NOT EXISTS idx_advisory_questions_section ON advisory_questions(section_id);
      CREATE INDEX IF NOT EXISTS idx_advisory_questions_version ON advisory_questions(questionnaire_version_id);

      -- Options pour single_choice/multiple_choice. Immuables dès que la
      -- version parente est publiée (garanti par le service, pas par SQL).
      CREATE TABLE IF NOT EXISTS advisory_question_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_id INTEGER NOT NULL REFERENCES advisory_questions(id),
        stable_key TEXT NOT NULL,
        label TEXT NOT NULL,
        value TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',   -- active | archived
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(question_id, stable_key)
      );
      CREATE INDEX IF NOT EXISTS idx_advisory_question_options_question ON advisory_question_options(question_id);

      -- Un rendez-vous de conseil. Ne porte plus directement de
      -- questionnaire_version_id (remplacé par la table d'association
      -- advisory_session_questionnaires ci-dessous, composition modulaire).
      -- household_snapshot : copie figée de la composition du foyer au
      -- moment du démarrage (DATA_MODEL.md §2.2 point 10 / §3.1) — garantit
      -- qu'une modification ultérieure des membres du foyer ne réécrit
      -- jamais silencieusement le contexte d'une session déjà démarrée ou
      -- terminée. Ajoutée par décision d'ingénierie documentée dans le
      -- rapport du lot (absente de la liste explicite du LOT 3A, mais
      -- invariant central déjà documenté au LOT 1, coût d'ajout minime).
      CREATE TABLE IF NOT EXISTS advisory_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        household_id INTEGER NOT NULL REFERENCES households(id),
        advisor_user_id INTEGER NOT NULL REFERENCES users(id), -- jamais transmis par le client, dérivé de la session authentifiée
        domain TEXT NOT NULL,                    -- health | life_pension | mixed
        status TEXT NOT NULL DEFAULT 'draft',     -- draft|in_progress|suspended|completed|cancelled
        title TEXT,
        scheduled_at TEXT,
        started_at TEXT,
        suspended_at TEXT,
        completed_at TEXT,
        last_activity_at TEXT,
        revision INTEGER NOT NULL DEFAULT 0,      -- incrémenté à chaque écriture de réponse (par appel, pas par réponse individuelle d'un lot) ou amendement
        household_snapshot TEXT,                  -- JSON, figé au démarrage (in_progress), jamais réécrit ensuite
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_advisory_sessions_household ON advisory_sessions(household_id);
      CREATE INDEX IF NOT EXISTS idx_advisory_sessions_status ON advisory_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_advisory_sessions_household_status ON advisory_sessions(household_id, status);

      -- Table d'association « composition modulaire » (décision explicite
      -- remplaçant une première proposition de version « mixed » dupliquant
      -- le contenu santé/vie-prévoyance, et remplaçant aussi l'idée de deux
      -- colonnes fixes questionnaire_version_id/_secondary sur la session).
      -- Une session santé/vie-prévoyance rattache une version « domain »
      -- (health ou life_pension) et, facultativement, une version « common »
      -- partagée (composition du foyer, situation professionnelle,
      -- coordonnées, objectifs globaux). Une session mixte rattache
      -- exactement une version health ET une version life_pension, plus
      -- éventuellement une version common.
      CREATE TABLE IF NOT EXISTS advisory_session_questionnaires (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES advisory_sessions(id),
        questionnaire_version_id INTEGER NOT NULL REFERENCES advisory_questionnaire_versions(id),
        domain TEXT NOT NULL,                    -- common | health | life_pension (rôle joué par cette version DANS cette session)
        module_role TEXT NOT NULL,               -- core (= common) | domain (= health/life_pension)
        display_order INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(session_id, questionnaire_version_id), -- une même version ne peut être rattachée qu'une fois à la même session
        UNIQUE(session_id, display_order),            -- ordre d'affichage déterministe, jamais ambigu
        UNIQUE(session_id, domain)                    -- au plus une version par rôle de domaine (common/health/life_pension) dans une session — empêche nativement deux versions actives du même domaine spécialisé
      );
      CREATE INDEX IF NOT EXISTS idx_advisory_session_questionnaires_session
        ON advisory_session_questionnaires(session_id);
      CREATE INDEX IF NOT EXISTS idx_advisory_session_questionnaires_version
        ON advisory_session_questionnaires(questionnaire_version_id);

      -- Réponses, modèle strictement append-only : une correction n'écrase
      -- jamais une ligne, elle insère une nouvelle ligne et renseigne
      -- superseded_by_answer_id sur l'ancienne. Aucune colonne de domaine
      -- ici : le domaine se déduit toujours de
      -- answer → question → section → questionnaire_version → questionnaire
      -- → domain (jamais stocké en double).
      CREATE TABLE IF NOT EXISTS advisory_answers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES advisory_sessions(id),
        question_id INTEGER NOT NULL REFERENCES advisory_questions(id),
        household_member_id INTEGER REFERENCES household_members(id), -- rempli si question.scope = 'member' ; le service vérifie qu'il appartient bien au foyer de la session
        status TEXT NOT NULL,                    -- answered|unknown|not_applicable|cleared
        value_text TEXT,
        value_number REAL,
        value_boolean INTEGER,
        value_date TEXT,
        value_json TEXT,
        superseded_by_answer_id INTEGER REFERENCES advisory_answers(id),
        is_amendment INTEGER NOT NULL DEFAULT 0,
        amendment_reason TEXT,                   -- obligatoire si is_amendment = 1 (validé côté service)
        revision INTEGER NOT NULL,               -- valeur de sessions.revision après incrémentation, au moment de cette écriture
        answered_by_user_id INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_advisory_answers_session ON advisory_answers(session_id);
      CREATE INDEX IF NOT EXISTS idx_advisory_answers_question ON advisory_answers(question_id);
      CREATE INDEX IF NOT EXISTS idx_advisory_answers_member ON advisory_answers(household_member_id);
      -- Une réponse active (superseded_by_answer_id IS NULL) par (session,
      -- question) pour les portées household/session (household_member_id
      -- absent — cardinalité techniquement identique entre les deux
      -- portées ; la distinction household/session est purement sémantique,
      -- jamais technique, cf. rapport du lot).
      CREATE UNIQUE INDEX IF NOT EXISTS idx_advisory_answers_active_household_or_session
        ON advisory_answers(session_id, question_id)
        WHERE superseded_by_answer_id IS NULL AND household_member_id IS NULL;
      -- Une réponse active par (session, question, membre) pour la portée member.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_advisory_answers_active_member
        ON advisory_answers(session_id, question_id, household_member_id)
        WHERE superseded_by_answer_id IS NULL AND household_member_id IS NOT NULL;
    `);

    db.pragma('user_version = 10');
  });
  migrate();
}

// LOT 4A — Legrand Diagnostic 360 : moteur déterministe de règles et
// findings. Vérifié avant écriture (rapport du GATE LOT 4A) : aucune branche
// distante ne dépasse la version 10 ; migration purement additive, aucune
// table existante modifiée. Périmètre strictement limité à 4 tables (décision
// humaine explicite) : PAS de advisory_recommendations, PAS de catalogue
// produit/assureur, PAS de advisory_consents/advisory_reports à ce stade.
if (version < 11) {
  const migrate = db.transaction(() => {
    db.exec(`
      -- Un rule set = une version cohérente de règles pour UN domaine
      -- (jamais 'mixed' — une session mixte exécute séparément les rule sets
      -- common/health/life_pension applicables, exactement comme pour les
      -- questionnaires). Fusionne « famille » et « version » en une seule
      -- table (contrairement à advisory_questionnaires/_versions) : un rule
      -- set n'a pas de sous-structure interne qui bénéficierait d'être
      -- décorrélée d'une famille distincte — décision documentée, revue
      -- advisory-architect, GATE LOT 4A.
      CREATE TABLE IF NOT EXISTS advisory_rule_sets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stable_key TEXT NOT NULL,                 -- identité de la famille à travers ses versions
        domain TEXT NOT NULL,                     -- common | health | life_pension -- JAMAIS mixed (une règle n'appartient qu'à un domaine réel ; common = constats transverses au foyer, facultatif mais pleinement pris en charge)
        version_number INTEGER NOT NULL,          -- strictement croissant par stable_key (garanti par le service)
        status TEXT NOT NULL DEFAULT 'draft',     -- draft | published | archived
        name TEXT NOT NULL,
        description TEXT,
        changelog TEXT,                           -- notes de version
        content_hash TEXT,                        -- empreinte SHA-256, calculée à la publication (server/canonicalJson.js)
        effective_from TEXT,                      -- réservées, jamais renseignées par server/advisoryRules.js à ce lot (l'effectivité temporelle est vérifiée par RÈGLE, isEffectiveToday, pas par rule_set entier)
        effective_until TEXT,
        created_by_user_id INTEGER REFERENCES users(id),
        validated_by_user_id INTEGER REFERENCES users(id), -- validation humaine du RULE SET (distincte de la validation par règle, ci-dessous)
        validated_at TEXT,
        published_at TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(stable_key, version_number)
      );
      CREATE INDEX IF NOT EXISTS idx_advisory_rule_sets_stable_key ON advisory_rule_sets(stable_key);
      CREATE INDEX IF NOT EXISTS idx_advisory_rule_sets_domain ON advisory_rule_sets(domain);
      CREATE INDEX IF NOT EXISTS idx_advisory_rule_sets_status ON advisory_rule_sets(status);
      -- Politique « un seul rule_set publié par domaine » (GATE LOT 4A §2,
      -- décision humaine confirmée) : garantie désormais au niveau SQLite
      -- lui-même, jamais seulement applicative (server/advisoryRules.js
      -- assertNoOtherPublishedFamilyForDomain n'aurait pas résisté à deux
      -- publications concurrentes sous plusieurs processus partageant le
      -- même fichier — constat GATE, correctif ciblé avant commit). Index
      -- UNIQUE PARTIEL (portant uniquement sur les lignes status='published')
      -- : plusieurs lignes 'draft'/'archived' du même domaine restent
      -- possibles, seule la coexistence de DEUX lignes 'published' du même
      -- domaine est rendue impossible, y compris pour deux VERSIONS de la
      -- MÊME famille (l'archivage de l'ancienne version doit donc précéder
      -- la publication de la nouvelle dans la même transaction, jamais
      -- l'inverse -- voir publishRuleSet).
      CREATE UNIQUE INDEX IF NOT EXISTS idx_advisory_rule_sets_one_published_per_domain
        ON advisory_rule_sets(domain) WHERE status = 'published';

      -- Une règle, rattachée à un rule_set précis. stable_key trace « cette
      -- règle logique » à travers les rule sets successifs (même principe
      -- que advisory_questions.stable_key à travers les versions de
      -- questionnaire). Pas de cycle de statut brouillon/valide séparé du
      -- rule_set parent (contrairement à une première lecture possible de
      -- RULES_ENGINE.md §2) : une règle est status=active|archived, comme
      -- advisory_questions — toute l'exigence « source/validateur/date
      -- d'effet/explication obligatoires avant publication » est vérifiée en
      -- une seule fois, au moment de PUBLIER le rule_set entier (voir
      -- validateRuleSetForPublish), jamais via une transition indépendante
      -- par règle. Décision documentée, alignée sur le pattern déjà
      -- implémenté et testé pour les questions de questionnaire plutôt que
      -- d'inventer une seconde machine d'état sans précédent dans ce dépôt.
      CREATE TABLE IF NOT EXISTS advisory_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_set_id INTEGER NOT NULL REFERENCES advisory_rule_sets(id),
        stable_key TEXT NOT NULL,
        domain TEXT NOT NULL,                     -- dupliqué depuis rule_set (jamais divergent, contrainte applicative)
        title TEXT NOT NULL,
        description TEXT,
        conditions TEXT NOT NULL,                 -- JSON déclaratif (server/advisoryRuleConditions.js), jamais de code exécutable
        required_data TEXT NOT NULL,               -- JSON (liste de références nécessaires à l'évaluation)
        result_finding_type TEXT NOT NULL,        -- fact | detected_need | gap | warning | missing_information | solution_category -- JAMAIS recommendation|product|insurer|contract|sale
        result_payload TEXT,                      -- JSON structuré, clés strictement limitées (jamais de produit/assureur nommé, contrôlé en applicatif)
        priority TEXT NOT NULL DEFAULT 'medium',  -- low | medium | high | critical
        finding_scope TEXT NOT NULL DEFAULT 'household', -- session | household | member -- portée déclarée du finding produit (jamais déduite après coup) ; member exige household_member_id sur chaque finding produit (server/advisoryRules.js §validateRuleSetForPublish, server/advisoryRuleExecutions.js)
        advisor_explanation TEXT NOT NULL,
        client_explanation TEXT,
        warnings TEXT,                             -- JSON (liste)
        contraindications TEXT,                    -- JSON (liste)
        source TEXT,                                -- obligatoire pour toute règle active dans un rule_set publié (vérifié à la publication, pas ici)
        source_reference TEXT,
        effective_from TEXT,
        effective_until TEXT,
        validated_by_user_id INTEGER REFERENCES users(id), -- revue individuelle de CETTE règle (distincte de la validation du rule_set entier)
        validated_at TEXT,
        sort_order INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',    -- active | archived
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(rule_set_id, stable_key)
      );
      CREATE INDEX IF NOT EXISTS idx_advisory_rules_rule_set ON advisory_rules(rule_set_id);
      CREATE INDEX IF NOT EXISTS idx_advisory_rules_domain ON advisory_rules(domain);

      -- Trace d'exécution : une ligne par (session, domaine) à chaque lancement
      -- du moteur — jamais une ligne par règle individuelle (divergence
      -- assumée par rapport à la proposition LOT 1, DATA_MODEL.md §5.3, qui
      -- envisageait rule_id ; ce lot retient un résultat de LOT agrégé par
      -- rule_set avec un compteur de règles évaluées, décision humaine
      -- explicite du GATE LOT 4A). session_revision fige la révision de
      -- session au moment de l'exécution (garde de fraîcheur, pas un verrou
      -- d'écriture au sens du LOT 3B puisque l'exécution ne modifie jamais
      -- advisory_sessions elle-même). Le rule_set utilisé pour un (session,
      -- domain) donné, une fois choisi par la PREMIÈRE exécution, est
      -- réutilisé pour toujours pour cette session (reproductibilité
      -- historique) — jamais de colonne de pin séparée sur advisory_sessions
      -- (éviterait une 5e table hors périmètre ; le pin est dérivé de cette
      -- table elle-même, décision revue advisory-architect).
      CREATE TABLE IF NOT EXISTS advisory_rule_executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES advisory_sessions(id),
        session_revision INTEGER NOT NULL,
        domain TEXT NOT NULL,                      -- common | health | life_pension -- jamais mixed (une session mixte exécute jusqu'à trois fois, une par domaine réel)
        rule_set_id INTEGER NOT NULL REFERENCES advisory_rule_sets(id),
        rule_set_version_number INTEGER NOT NULL,  -- dupliqué pour lisibilité historique, jamais divergent
        content_hash TEXT NOT NULL,                -- dupliqué depuis le rule_set au moment de l'exécution
        status TEXT NOT NULL DEFAULT 'completed',  -- running | completed | failed | superseded
        mode TEXT NOT NULL DEFAULT 'final',        -- final | preview (preview jamais persisté comme finding actif durable, voir server/advisoryRules.js)
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT,
        executed_by_user_id INTEGER REFERENCES users(id),
        rules_evaluated_count INTEGER NOT NULL DEFAULT 0,
        findings_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,                        -- minimisé, jamais de détail sensible ni de trace technique complète
        inputs_snapshot TEXT,                      -- JSON, instantané minimal des entrées effectivement utilisées par les règles évaluées
        engine_version TEXT NOT NULL,               -- version du CODE du moteur, distincte de la version des règles
        superseded_by_execution_id INTEGER REFERENCES advisory_rule_executions(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_advisory_rule_executions_session ON advisory_rule_executions(session_id);
      CREATE INDEX IF NOT EXISTS idx_advisory_rule_executions_rule_set ON advisory_rule_executions(rule_set_id);
      CREATE INDEX IF NOT EXISTS idx_advisory_rule_executions_session_domain ON advisory_rule_executions(session_id, domain);

      -- Un constat produit par une règle déclenchée. Jamais une
      -- recommandation : aucun champ produit, aucun champ assureur. status
      -- superseded est une dénormalisation dérivée de l'exécution parente
      -- (jamais togglée indépendamment) ; dismissed est la seule action
      -- autonome du conseiller (motif obligatoire, comme pour
      -- advisory_sessions/answers). needs_review/conflicts_with : extension
      -- au-delà du champ minimal listé par le commanditaire, justifiée par
      -- l'exigence explicite (§18 du brief GATE LOT 4A) de signaler les
      -- findings contradictoires sans les masquer.
      CREATE TABLE IF NOT EXISTS advisory_findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_execution_id INTEGER NOT NULL REFERENCES advisory_rule_executions(id),
        session_id INTEGER NOT NULL REFERENCES advisory_sessions(id), -- dupliqué pour requêtes directes, jamais divergent
        rule_id INTEGER NOT NULL REFERENCES advisory_rules(id),
        stable_key TEXT NOT NULL,                  -- dupliqué depuis la règle, traçabilité même si la règle évolue dans une future version
        domain TEXT NOT NULL,                      -- common | health | life_pension -- dupliqué depuis la règle qui a produit ce finding
        finding_scope TEXT NOT NULL DEFAULT 'household', -- session | household | member -- dupliqué depuis la règle, pour affichage sans jointure supplémentaire
        household_member_id INTEGER REFERENCES household_members(id), -- NOT NULL seulement si finding_scope = member (un finding par membre correspondant réellement à la condition, jamais une attribution arbitraire) ; toujours NULL pour session/household
        finding_type TEXT NOT NULL,                -- fact | detected_need | gap | warning | missing_information | solution_category
        priority TEXT NOT NULL,                    -- low | medium | high | critical
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        advisor_explanation TEXT NOT NULL,
        client_explanation TEXT,
        missing_data TEXT,                         -- JSON (liste de références), pour finding_type = missing_information notamment
        warnings TEXT,
        contraindications TEXT,
        used_inputs_ref TEXT,                      -- JSON, références structurées (jamais les valeurs) vers les entrées utilisées, avec sensibilité FIGÉE au moment de l'exécution (sensitivity_at_execution, answer_id immuable, questionnaire_version_id, read_at -- jamais réévaluée à la lecture, GATE LOT 4A §4)
        status TEXT NOT NULL DEFAULT 'active',     -- active | superseded | dismissed
        dismiss_reason TEXT,
        dismissed_by_user_id INTEGER REFERENCES users(id),
        dismissed_at TEXT,
        needs_review INTEGER NOT NULL DEFAULT 0,   -- ÉTAT ACTIF courant : recalculé quand un finding en conflit est écarté (server/advisoryRuleExecutions.js, dismissFinding) -- jamais un historique figé, voir conflicts_detected_at_execution
        conflicts_with TEXT,                       -- JSON (liste d'ids d'autres findings ACTIFS actuellement en conflit) -- recalculé à chaque écartement, jamais figé
        conflicts_detected_at_execution TEXT,      -- JSON (liste d'ids d'autres findings), HISTORIQUE et IMMUABLE : le recoupement constaté au moment même de cette exécution, jamais réécrit ensuite même si conflicts_with change par la suite (constat GATE LOT 4A §5, distinction historique/actif)
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_advisory_findings_execution ON advisory_findings(rule_execution_id);
      CREATE INDEX IF NOT EXISTS idx_advisory_findings_session ON advisory_findings(session_id);
      CREATE INDEX IF NOT EXISTS idx_advisory_findings_rule ON advisory_findings(rule_id);
      CREATE INDEX IF NOT EXISTS idx_advisory_findings_status ON advisory_findings(status);
    `);

    db.pragma('user_version = 11');
  });
  migrate();
}

if (version < 12) {
  // LOT 7A — Legrand Diagnostic 360 : backend générique des recommandations
  // humaines. Trois tables entièrement nouvelles. Une recommandation est
  // TOUJOURS créée par un conseiller humain authentifié (server/
  // advisoryRecommendations.js) — le moteur de règles (server/advisoryRules.js,
  // server/advisoryRuleExecutions.js) n'écrit jamais dans ces tables, ne les
  // référence jamais, et ne peut ni créer ni valider une recommandation, ni
  // choisir un produit ou un assureur, ni renseigner automatiquement une
  // justification (aucune table produit/assureur n'existe, LOT 11 hors
  // périmètre). Numéro vérifié disponible au moment de l'implémentation :
  // aucun bloc `< 12` n'existait, la version 11 restait la dernière ; aucune
  // branche locale ou distante connue ne dépasse la version 11.
  const migrate = db.transaction(() => {
    db.exec(`
      -- Une recommandation : proposition de conseil rédigée par un humain,
      -- justifiée par un ou plusieurs findings déterministes (jamais
      -- l'inverse). Cycle de vie strict : draft (mutable) -> validated
      -- (immuable, action humaine explicite) ou dismissed (brouillon
      -- abandonné) ; validated -> withdrawn (retirée sans remplacement) ou
      -- superseded (dérivé, jamais togglé directement -- uniquement en
      -- conséquence de la validation atomique d'un remplacement, voir
      -- supersedes_recommendation_id ci-dessous). Aucun champ 'category' :
      -- délibérément exclu (décision humaine, cadrage LOT 7A) pour éviter
      -- toute confusion avec advisory_rules.result_payload.category_hint,
      -- déjà utilisé par le moteur pour le regroupement technique des
      -- conflits (needs_review/conflicts_with) -- une notion strictement
      -- différente d'une taxonomie humaine de conseil. Aucun champ produit,
      -- assureur, contrat, prime, comparaison, decision client ou
      -- présentation client : hors périmètre de ce lot (LOT 7B/9/11).
      CREATE TABLE IF NOT EXISTS advisory_recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES advisory_sessions(id),
        domain TEXT NOT NULL,                      -- common | health | life_pension -- JAMAIS mixed ; tous les findings liés doivent appartenir au MÊME domaine (contrôle applicatif, jamais de mélange health/life_pension, y compris common)
        scope TEXT NOT NULL,                        -- session | household | member -- choisi explicitement par le conseiller, jamais dérivé automatiquement des findings liés
        status TEXT NOT NULL DEFAULT 'draft',       -- draft | validated | dismissed | superseded | withdrawn
        revision INTEGER NOT NULL DEFAULT 1,        -- verrou de concurrence optimiste PROPRE à cette ligne (grain nouveau dans ce dépôt, distinct de advisory_sessions.revision) -- incrémenté après CHAQUE écriture réussie, y compris les transitions terminales
        title TEXT NOT NULL,
        summary TEXT,                                -- obligatoire uniquement pour atteindre validated (contrôlé en service, jamais en CHECK)
        advisor_rationale TEXT NOT NULL,
        expected_benefits TEXT,
        limitations TEXT,
        risks TEXT,
        no_additional_risks_identified INTEGER NOT NULL DEFAULT 0,   -- distingue « non renseigné » de « examiné, rien identifié » -- jamais renseigné automatiquement
        alternatives_considered TEXT,
        alternative_rejection_reason TEXT,
        no_alternatives_identified INTEGER NOT NULL DEFAULT 0,
        missing_information TEXT,
        no_missing_information_known INTEGER NOT NULL DEFAULT 0,
        warnings TEXT,
        reservations TEXT,
        created_by_user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        validated_by_user_id INTEGER REFERENCES users(id),          -- stampé serveur uniquement, jamais transmis par le client (auto-validation autorisée en v1 : peut coïncider avec created_by_user_id, CRM mono-utilisateur, aucun contrôle à quatre yeux prétendu)
        validated_at TEXT,
        validated_session_revision INTEGER,          -- révision de advisory_sessions.revision figée AU MOMENT de la validation -- jamais recalculée après coup, sert de base au calcul dérivé d'obsolescence (potentially_stale, jamais stocké)
        dismiss_reason TEXT,                         -- obligatoire si status = dismissed (contrôlé en service)
        dismissed_by_user_id INTEGER REFERENCES users(id),
        dismissed_at TEXT,
        withdraw_reason TEXT,                        -- obligatoire si status = withdrawn
        withdrawn_by_user_id INTEGER REFERENCES users(id),
        withdrawn_at TEXT,
        supersedes_recommendation_id INTEGER REFERENCES advisory_recommendations(id) -- portée par la NOUVELLE recommandation (une seule direction explicite, décision humaine) -- doit référencer une recommandation validated de la même session ET du même domaine (contrôle applicatif) ; bascule atomique à la validation : l'ancienne passe à superseded, jamais avant
      );
      CREATE INDEX IF NOT EXISTS idx_advisory_recommendations_session ON advisory_recommendations(session_id);
      CREATE INDEX IF NOT EXISTS idx_advisory_recommendations_session_status ON advisory_recommendations(session_id, status);
      CREATE INDEX IF NOT EXISTS idx_advisory_recommendations_session_domain ON advisory_recommendations(session_id, domain);
      CREATE INDEX IF NOT EXISTS idx_advisory_recommendations_status ON advisory_recommendations(status);
      -- Empêche au niveau SQLite lui-même qu'une recommandation validated ait
      -- plus d'un successeur ACTIF (draft ou validated) à la fois -- ignore
      -- délibérément les successeurs dismissed (un premier brouillon de
      -- remplacement abandonné ne bloque jamais un nouvel essai). Syntaxe
      -- vérifiée empiriquement compatible SQLite/better-sqlite3 pendant le
      -- cadrage (deux successeurs dismissed acceptés, un deuxième successeur
      -- draft/validated refusé).
      CREATE UNIQUE INDEX IF NOT EXISTS idx_advisory_recommendations_one_non_dismissed_successor
        ON advisory_recommendations(supersedes_recommendation_id)
        WHERE supersedes_recommendation_id IS NOT NULL
          AND status <> 'dismissed';

      -- Relation N:M vers les findings sources (jamais un JSON -- décision
      -- humaine, cadrage LOT 7A : cas réellement N:M, contrairement au 1:N
      -- finding<->exécution du Lot 4A). Un finding peut justifier plusieurs
      -- recommandations/alternatives concurrentes ; une recommandation peut
      -- citer plusieurs findings, TOUJOURS du même domaine et de la même
      -- session que la recommandation (contrôle applicatif). Les findings
      -- restent strictement en lecture depuis ce module -- aucune écriture
      -- n'est jamais déclenchée sur advisory_findings par ce lot.
      CREATE TABLE IF NOT EXISTS advisory_recommendation_findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recommendation_id INTEGER NOT NULL REFERENCES advisory_recommendations(id) ON DELETE CASCADE,
        finding_id INTEGER NOT NULL REFERENCES advisory_findings(id),
        created_by_user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(recommendation_id, finding_id)
      );
      CREATE INDEX IF NOT EXISTS idx_advisory_recommendation_findings_recommendation ON advisory_recommendation_findings(recommendation_id);
      CREATE INDEX IF NOT EXISTS idx_advisory_recommendation_findings_finding ON advisory_recommendation_findings(finding_id);

      -- Relation N:M vers les membres du foyer explicitement ciblés (portée
      -- choisie par le conseiller, jamais dérivée automatiquement des
      -- findings liés -- décision humaine, cadrage LOT 7A). Un membre
      -- référencé doit appartenir au household_snapshot figé de la session
      -- (server/advisorySessions.js, sessionMembersFor) -- jamais une
      -- lecture directe et vivante de household_members (même invariant
      -- anti-IDOR que assertMemberBelongsToSession, Lot 3A).
      CREATE TABLE IF NOT EXISTS advisory_recommendation_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recommendation_id INTEGER NOT NULL REFERENCES advisory_recommendations(id) ON DELETE CASCADE,
        household_member_id INTEGER NOT NULL REFERENCES household_members(id),
        created_by_user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(recommendation_id, household_member_id)
      );
      CREATE INDEX IF NOT EXISTS idx_advisory_recommendation_members_recommendation ON advisory_recommendation_members(recommendation_id);
      CREATE INDEX IF NOT EXISTS idx_advisory_recommendation_members_member ON advisory_recommendation_members(household_member_id);
    `);

    db.pragma('user_version = 12');
  });
  migrate();
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
