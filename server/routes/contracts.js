import { Router } from 'express';
import db from '../db.js';
import { audit } from '../audit.js';
import { assert, isDateStr, isNonNegNumber, inEnum, checkTextFields } from '../validate.js';

export const contractsRouter = Router();

export const BRANCHES = [
  'vie_3a', 'vie_3b', 'lamal', 'lca', 'lpp', 'hypotheque',
  'deces', 'incapacite', 'rc_menage', 'autre',
];
const CONTRACT_STATUSES = ['offre', 'actif', 'suspendu', 'resilie', 'echu'];
const FREQUENCIES = ['mensuelle', 'trimestrielle', 'semestrielle', 'annuelle', 'unique'];

// --- Détails LAMal (contract_lamal, migration v8) ---------------------

// Seule branche compatible avec des détails LAMal, déterminée à partir de
// BRANCHES ci-dessus (aucune liste inventée séparément).
const LAMAL_COMPATIBLE_BRANCHES = ['lamal'];

const CARE_MODELS = ['standard', 'medecin_famille', 'hmo', 'telmed', 'pharmacie', 'autre'];

// Franchises LAMal officielles (OFSP), ensemble combiné adultes + enfants :
// adultes 300/500/1000/1500/2000/2500 ; enfants 0/100/200/300/400/500/600.
// Aucune déduction automatique adulte/enfant : le modèle client actuel ne
// permet pas de déterminer la majorité de façon fiable à la saisie.
const LAMAL_DEDUCTIBLES = [0, 100, 200, 300, 400, 500, 600, 1000, 1500, 2000, 2500];

const SWISS_CANTONS = [
  'AG', 'AI', 'AR', 'BE', 'BL', 'BS', 'FR', 'GE', 'GL', 'GR', 'JU', 'LU', 'NE',
  'NW', 'OW', 'SG', 'SH', 'SO', 'SZ', 'TG', 'TI', 'UR', 'VD', 'VS', 'ZG', 'ZH',
];

// Valide le bloc `lamal` brut de la requête (avant normalisation).
function validateLamalInput(raw) {
  assert(inEnum(raw.care_model, CARE_MODELS) && raw.care_model != null, 'Modèle de soins LAMal invalide.');
  assert(raw.deductible !== undefined && raw.deductible !== null && raw.deductible !== '',
    'La franchise LAMal est requise.');
  // G1 : validation stricte, aucune coercition de type — une chaîne, un
  // booléen ou un objet ne doit jamais être accepté comme franchise.
  assert(
    typeof raw.deductible === 'number' && Number.isFinite(raw.deductible) && Number.isInteger(raw.deductible) &&
      LAMAL_DEDUCTIBLES.includes(raw.deductible),
    `Franchise LAMal invalide (valeurs autorisées : ${LAMAL_DEDUCTIBLES.join(', ')}).`
  );
  assert(
    raw.accident_coverage === undefined || typeof raw.accident_coverage === 'boolean' ||
      raw.accident_coverage === 0 || raw.accident_coverage === 1,
    'Couverture accident invalide (valeur booléenne attendue).'
  );
  assert(
    raw.canton == null || raw.canton === '' || SWISS_CANTONS.includes(String(raw.canton).trim().toUpperCase()),
    'Canton invalide.'
  );
  checkTextFields({ tariff_region: raw.tariff_region }, ['tariff_region'], 20);
}

// Normalise le bloc `lamal` validé pour l'écriture en base.
function normalizeLamal(raw) {
  return {
    care_model: raw.care_model,
    // G1 : raw.deductible est déjà un nombre entier validé, aucune coercition.
    deductible: raw.deductible,
    accident_coverage: raw.accident_coverage === false || raw.accident_coverage === 0 ? 0 : 1,
    canton: raw.canton ? String(raw.canton).trim().toUpperCase() : null,
    tariff_region: raw.tariff_region === '' || raw.tariff_region == null ? null : raw.tariff_region,
  };
}

// Crée, met à jour ou supprime la ligne contract_lamal selon lamalBody :
// null → suppression ; objet → upsert. Doit être appelée après validation
// et à l'intérieur d'une transaction (relation stricte 1:1 par contract_id).
function writeLamal(contractId, lamalBody) {
  const existing = db.prepare('SELECT contract_id FROM contract_lamal WHERE contract_id = ?').get(contractId);
  if (lamalBody === null) {
    if (!existing) return null;
    db.prepare('DELETE FROM contract_lamal WHERE contract_id = ?').run(contractId);
    return { action: 'deleted' };
  }
  const norm = normalizeLamal(lamalBody);
  if (existing) {
    db.prepare(
      `UPDATE contract_lamal SET care_model = ?, deductible = ?, accident_coverage = ?, canton = ?,
        tariff_region = ?, updated_at = datetime('now') WHERE contract_id = ?`
    ).run(norm.care_model, norm.deductible, norm.accident_coverage, norm.canton, norm.tariff_region, contractId);
    return { action: 'updated', data: norm };
  }
  db.prepare(
    `INSERT INTO contract_lamal (contract_id, care_model, deductible, accident_coverage, canton, tariff_region)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(contractId, norm.care_model, norm.deductible, norm.accident_coverage, norm.canton, norm.tariff_region);
  return { action: 'created', data: norm };
}

function serializeLamal(row) {
  if (row.lamal_care_model == null) return null;
  return {
    care_model: row.lamal_care_model,
    deductible: row.lamal_deductible,
    accident_coverage: Boolean(row.lamal_accident_coverage),
    canton: row.lamal_canton,
    tariff_region: row.lamal_tariff_region,
  };
}

// --- Détails LCA (contract_lca, migration v8) --------------------------

// Seule branche compatible avec des détails LCA. Disjointe de
// LAMAL_COMPATIBLE_BRANCHES : aucune branche n'est jamais compatible avec
// les deux à la fois, ce qui rejette naturellement (via l'un ou l'autre des
// contrôles ci-dessous) toute requête combinant lamal et lca sur une
// branche qui ne peut satisfaire les deux.
const LCA_COMPATIBLE_BRANCHES = ['lca'];

const UNDERWRITING_STATUSES = [
  'non_requis', 'questionnaire_transmis', 'decision_attendue',
  'acceptee', 'acceptee_avec_reserve', 'refusee',
];
const RESERVATION_STATUSES = ['aucune', 'en_cours', 'active', 'levee'];
const EXCLUSION_STATUSES = ['aucune', 'presentes'];

// Valide le bloc `lca` brut de la requête (avant normalisation). Les champs
// texte (*_notes) sont volontairement courts et ne doivent contenir qu'un
// statut administratif — jamais de diagnostic, de pathologie, de résultat
// médical ni de contenu de questionnaire de santé.
function validateLcaInput(raw) {
  // G1 : les trois enums ci-dessous sont NOT NULL avec DEFAULT SQL — un
  // champ absent conserve la valeur existante/par défaut (COALESCE dans
  // writeLca), mais un `null` explicite ne doit jamais être silencieusement
  // ignoré : il doit être rejeté, comme pour les champs `component_type`/
  // `benefit_type`/`product_type` des autres blocs (`inEnum` seul ne suffit
  // pas ici car il traite `v == null` comme valide).
  assert(
    raw.underwriting_status === undefined ||
      (raw.underwriting_status !== null && inEnum(raw.underwriting_status, UNDERWRITING_STATUSES)),
    'Statut de souscription LCA invalide.'
  );
  // G1 : validation stricte, aucune coercition de type.
  assert(
    raw.waiting_period_days === undefined || raw.waiting_period_days === null ||
      (typeof raw.waiting_period_days === 'number' && Number.isFinite(raw.waiting_period_days) &&
        Number.isInteger(raw.waiting_period_days) && raw.waiting_period_days >= 0),
    'Délai d’attente invalide (entier non négatif attendu).'
  );
  assert(
    raw.administrative_reservation_status === undefined ||
      (raw.administrative_reservation_status !== null &&
        inEnum(raw.administrative_reservation_status, RESERVATION_STATUSES)),
    'Statut de réserve administrative invalide.'
  );
  assert(
    raw.exclusions_status === undefined ||
      (raw.exclusions_status !== null && inEnum(raw.exclusions_status, EXCLUSION_STATUSES)),
    'Statut d’exclusion invalide.'
  );
  checkTextFields(
    { reservation_notes: raw.reservation_notes, exclusions_notes: raw.exclusions_notes },
    ['reservation_notes', 'exclusions_notes'],
    200
  );
}

// Normalise le bloc `lca` validé pour l'écriture en base. Les champs absents
// du payload conservent leur valeur par défaut SQL (création) ou existante
// (mise à jour), gérées via COALESCE dans writeLca.
function normalizeLca(raw) {
  return {
    underwriting_status: raw.underwriting_status ?? null,
    // G1 : raw.waiting_period_days est déjà un nombre entier validé (ou
    // null/undefined), aucune coercition ; la branche `=== ''` n'est plus
    // atteignable après la validation stricte ci-dessus.
    waiting_period_days: raw.waiting_period_days ?? null,
    administrative_reservation_status: raw.administrative_reservation_status ?? null,
    reservation_notes: raw.reservation_notes === '' ? null : (raw.reservation_notes ?? null),
    exclusions_status: raw.exclusions_status ?? null,
    exclusions_notes: raw.exclusions_notes === '' ? null : (raw.exclusions_notes ?? null),
  };
}

// Crée, met à jour ou supprime la ligne contract_lca selon lcaBody : null →
// suppression ; objet → upsert (COALESCE conserve les valeurs par défaut
// SQL/existantes pour les champs non fournis). Doit être appelée après
// validation et à l'intérieur d'une transaction (relation stricte 1:1).
function writeLca(contractId, lcaBody) {
  const existing = db.prepare('SELECT * FROM contract_lca WHERE contract_id = ?').get(contractId);
  if (lcaBody === null) {
    if (!existing) return null;
    db.prepare('DELETE FROM contract_lca WHERE contract_id = ?').run(contractId);
    return { action: 'deleted' };
  }
  const norm = normalizeLca(lcaBody);
  if (existing) {
    db.prepare(
      `UPDATE contract_lca SET
        underwriting_status = COALESCE(?, underwriting_status),
        waiting_period_days = CASE WHEN ? THEN ? ELSE waiting_period_days END,
        administrative_reservation_status = COALESCE(?, administrative_reservation_status),
        reservation_notes = CASE WHEN ? THEN ? ELSE reservation_notes END,
        exclusions_status = COALESCE(?, exclusions_status),
        exclusions_notes = CASE WHEN ? THEN ? ELSE exclusions_notes END,
        updated_at = datetime('now')
       WHERE contract_id = ?`
    ).run(
      norm.underwriting_status,
      'waiting_period_days' in lcaBody ? 1 : 0, norm.waiting_period_days,
      norm.administrative_reservation_status,
      'reservation_notes' in lcaBody ? 1 : 0, norm.reservation_notes,
      norm.exclusions_status,
      'exclusions_notes' in lcaBody ? 1 : 0, norm.exclusions_notes,
      contractId
    );
    // Relecture de la ligne réellement persistée : `norm` contient des
    // marqueurs `null` pour les champs absents (utilisés par CASE WHEN pour
    // ne pas les modifier), qui ne représentent pas les vraies valeurs
    // conservées en base — { ...existing, ...norm } les écraserait à tort.
    const updated = db.prepare('SELECT * FROM contract_lca WHERE contract_id = ?').get(contractId);
    return { action: 'updated', data: updated };
  }
  db.prepare(
    `INSERT INTO contract_lca (
      contract_id, underwriting_status, waiting_period_days,
      administrative_reservation_status, reservation_notes, exclusions_status, exclusions_notes
    ) VALUES (?, COALESCE(?, 'non_requis'), ?, COALESCE(?, 'aucune'), ?, COALESCE(?, 'aucune'), ?)`
  ).run(
    contractId, norm.underwriting_status, norm.waiting_period_days,
    norm.administrative_reservation_status, norm.reservation_notes,
    norm.exclusions_status, norm.exclusions_notes
  );
  const created = db.prepare('SELECT * FROM contract_lca WHERE contract_id = ?').get(contractId);
  return { action: 'created', data: created };
}

function serializeLca(row) {
  if (row.lca_underwriting_status == null) return null;
  return {
    underwriting_status: row.lca_underwriting_status,
    waiting_period_days: row.lca_waiting_period_days,
    administrative_reservation_status: row.lca_administrative_reservation_status,
    reservation_notes: row.lca_reservation_notes,
    exclusions_status: row.lca_exclusions_status,
    exclusions_notes: row.lca_exclusions_notes,
  };
}

// --- Détails vie (contract_life, migration v8) --------------------------

// Seules branches compatibles avec des détails vie, déterminées à partir de
// BRANCHES ci-dessus. Disjointes de LAMAL_COMPATIBLE_BRANCHES et
// LCA_COMPATIBLE_BRANCHES, ce qui rejette naturellement toute combinaison
// de blocs spécialisés incompatible avec la branche finale.
const LIFE_COMPATIBLE_BRANCHES = ['vie_3a', 'vie_3b'];

const COMPONENT_TYPES = ['mixte', 'risque_pur', 'capital_differe', 'rente', 'unit_linked', 'autre'];
const INDEXATION_TYPES = ['aucune', 'fixe', 'indice_prix_conso', 'autre'];

// Un champ financier optionnel (capital, rente, valeur de rachat) doit être
// un nombre fini non négatif : pas de chaîne numérique acceptée en silence,
// pas de NaN ni d'Infinity, et un null explicite est autorisé (le champ est
// nullable en base) mais une chaîne vide ou un type incorrect est rejeté.
function isOptionalNonNegAmount(v) {
  if (v === undefined || v === null) return true;
  if (typeof v !== 'number') return false;
  return Number.isFinite(v) && v >= 0;
}

// Valide le bloc `life` brut de la requête (avant normalisation). Aucune
// donnée médicale, aucun bénéficiaire nominatif : ce bloc ne porte que des
// montants assurés, un type de composante et des paramètres contractuels.
//
// `component_type` est NOT NULL sans valeur par défaut SQL (contrairement
// aux enums LCA, qui ont tous un DEFAULT) : il est donc obligatoire lors
// d'une création (aucune ligne contract_life existante), mais peut être omis
// lors d'une mise à jour partielle d'une ligne déjà existante — auquel cas
// COALESCE conserve la valeur déjà enregistrée. `componentTypeRequired` doit
// être positionné par l'appelant selon l'existence préalable de la ligne.
function validateLifeInput(raw, { componentTypeRequired = true } = {}) {
  assert(raw.component_type !== null, 'Le type de composante vie ne peut pas être explicitement vide.');
  if (raw.component_type === undefined) {
    assert(!componentTypeRequired, 'Le type de composante vie est requis.');
  } else {
    assert(inEnum(raw.component_type, COMPONENT_TYPES), 'Type de composante vie invalide.');
  }
  assert(isOptionalNonNegAmount(raw.insured_death_capital), 'Capital décès invalide (nombre positif attendu).');
  assert(isOptionalNonNegAmount(raw.insured_disability_capital), 'Capital invalidité invalide (nombre positif attendu).');
  assert(isOptionalNonNegAmount(raw.insured_rent), 'Rente assurée invalide (nombre positif attendu).');
  assert(isOptionalNonNegAmount(raw.surrender_value), 'Valeur de rachat invalide (nombre positif attendu).');
  assert(
    raw.premium_waiver === undefined || typeof raw.premium_waiver === 'boolean' ||
      raw.premium_waiver === 0 || raw.premium_waiver === 1,
    'Libération du paiement des primes invalide (valeur booléenne attendue).'
  );
  assert(
    raw.indexation_type === undefined || (raw.indexation_type !== null && inEnum(raw.indexation_type, INDEXATION_TYPES)),
    'Type d’indexation invalide.'
  );
  assert(
    raw.policy_term_years === undefined || raw.policy_term_years === null ||
      (Number.isInteger(raw.policy_term_years) && raw.policy_term_years > 0),
    'Durée de la police invalide (entier strictement positif attendu).'
  );
}

// Normalise le bloc `life` validé pour l'écriture en base.
function normalizeLife(raw) {
  return {
    component_type: raw.component_type ?? null,
    insured_death_capital: raw.insured_death_capital === undefined ? null : raw.insured_death_capital,
    insured_disability_capital: raw.insured_disability_capital === undefined ? null : raw.insured_disability_capital,
    insured_rent: raw.insured_rent === undefined ? null : raw.insured_rent,
    surrender_value: raw.surrender_value === undefined ? null : raw.surrender_value,
    premium_waiver: raw.premium_waiver === true || raw.premium_waiver === 1 ? 1 : 0,
    indexation_type: raw.indexation_type ?? null,
    policy_term_years: raw.policy_term_years === undefined ? null : raw.policy_term_years,
  };
}

// Crée, met à jour ou supprime la ligne contract_life selon lifeBody : null →
// suppression ; objet → upsert (COALESCE/CASE WHEN conservent les valeurs par
// défaut SQL ou existantes pour les champs non fournis, permettant une mise à
// jour partielle). Doit être appelée après validation et à l'intérieur d'une
// transaction (relation stricte 1:1 par contract_id).
function writeLife(contractId, lifeBody) {
  const existing = db.prepare('SELECT * FROM contract_life WHERE contract_id = ?').get(contractId);
  if (lifeBody === null) {
    if (!existing) return null;
    db.prepare('DELETE FROM contract_life WHERE contract_id = ?').run(contractId);
    return { action: 'deleted' };
  }
  const norm = normalizeLife(lifeBody);
  if (existing) {
    db.prepare(
      `UPDATE contract_life SET
        component_type = COALESCE(?, component_type),
        insured_death_capital = CASE WHEN ? THEN ? ELSE insured_death_capital END,
        insured_disability_capital = CASE WHEN ? THEN ? ELSE insured_disability_capital END,
        insured_rent = CASE WHEN ? THEN ? ELSE insured_rent END,
        surrender_value = CASE WHEN ? THEN ? ELSE surrender_value END,
        premium_waiver = CASE WHEN ? THEN ? ELSE premium_waiver END,
        indexation_type = COALESCE(?, indexation_type),
        policy_term_years = CASE WHEN ? THEN ? ELSE policy_term_years END,
        updated_at = datetime('now')
       WHERE contract_id = ?`
    ).run(
      norm.component_type,
      'insured_death_capital' in lifeBody ? 1 : 0, norm.insured_death_capital,
      'insured_disability_capital' in lifeBody ? 1 : 0, norm.insured_disability_capital,
      'insured_rent' in lifeBody ? 1 : 0, norm.insured_rent,
      'surrender_value' in lifeBody ? 1 : 0, norm.surrender_value,
      'premium_waiver' in lifeBody ? 1 : 0, norm.premium_waiver,
      norm.indexation_type,
      'policy_term_years' in lifeBody ? 1 : 0, norm.policy_term_years,
      contractId
    );
    // Relecture de la ligne réellement persistée : `norm` contient des
    // marqueurs `null` pour les champs absents (utilisés par CASE WHEN pour
    // ne pas les modifier), qui ne représentent pas les vraies valeurs
    // conservées en base — { ...existing, ...norm } les écraserait à tort.
    const updated = db.prepare('SELECT * FROM contract_life WHERE contract_id = ?').get(contractId);
    return { action: 'updated', data: updated };
  }
  db.prepare(
    `INSERT INTO contract_life (
      contract_id, component_type, insured_death_capital, insured_disability_capital,
      insured_rent, surrender_value, premium_waiver, indexation_type, policy_term_years
    ) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'aucune'), ?)`
  ).run(
    contractId, norm.component_type, norm.insured_death_capital, norm.insured_disability_capital,
    norm.insured_rent, norm.surrender_value, norm.premium_waiver, norm.indexation_type, norm.policy_term_years
  );
  const created = db.prepare('SELECT * FROM contract_life WHERE contract_id = ?').get(contractId);
  return { action: 'created', data: created };
}

function serializeLife(row) {
  if (row.life_component_type == null) return null;
  return {
    component_type: row.life_component_type,
    insured_death_capital: row.life_insured_death_capital,
    insured_disability_capital: row.life_insured_disability_capital,
    insured_rent: row.life_insured_rent,
    surrender_value: row.life_surrender_value,
    premium_waiver: Boolean(row.life_premium_waiver),
    indexation_type: row.life_indexation_type,
    policy_term_years: row.life_policy_term_years,
  };
}

// --- Détails incapacité de gain (contract_income_protection, migration v8) ---

// Seule branche compatible avec des détails incapacité de gain, déterminée à
// partir de BRANCHES ci-dessus. Disjointe de LAMAL_COMPATIBLE_BRANCHES,
// LCA_COMPATIBLE_BRANCHES et LIFE_COMPATIBLE_BRANCHES, ce qui rejette
// naturellement toute combinaison de blocs spécialisés incompatible avec la
// branche finale.
const INCOME_PROTECTION_COMPATIBLE_BRANCHES = ['incapacite'];

// `indemnite_journaliere` désigne ici uniquement une prestation privée
// relevant du contrat d'incapacité de gain individuel : aucune logique IJM
// collective, employeur ou LPP n'est portée par cette énumération —
// contract_lpp_ijm reste entièrement hors périmètre de ce bloc.
const BENEFIT_TYPES = ['rente', 'indemnite_journaliere', 'capital', 'autre'];

// Valide le bloc `income_protection` brut de la requête (avant
// normalisation). Aucune donnée médicale, aucun diagnostic, aucune
// pathologie, aucun contenu de questionnaire de santé : ce bloc ne porte que
// des paramètres contractuels et un texte administratif court.
//
// `benefit_type` est NOT NULL sans valeur par défaut SQL, comme
// `component_type` pour la vie : obligatoire à la création (aucune ligne
// contract_income_protection existante), optionnel lors d'une mise à jour
// partielle d'une ligne déjà existante (COALESCE conserve la valeur
// existante). `benefitTypeRequired` doit être positionné par l'appelant
// selon l'existence préalable de la ligne.
function validateIncomeProtectionInput(raw, { benefitTypeRequired = true } = {}) {
  assert(raw.benefit_type !== null, 'Le type de prestation ne peut pas être explicitement vide.');
  if (raw.benefit_type === undefined) {
    assert(!benefitTypeRequired, 'Le type de prestation est requis.');
  } else {
    assert(inEnum(raw.benefit_type, BENEFIT_TYPES), 'Type de prestation invalide.');
  }
  assert(isOptionalNonNegAmount(raw.insured_amount), 'Montant assuré invalide (nombre positif attendu).');
  assert(
    raw.waiting_period_days === undefined || raw.waiting_period_days === null ||
      (Number.isInteger(raw.waiting_period_days) && raw.waiting_period_days >= 0),
    'Délai d’attente invalide (entier non négatif attendu).'
  );
  assert(
    raw.benefit_duration_months === undefined || raw.benefit_duration_months === null ||
      (Number.isInteger(raw.benefit_duration_months) && raw.benefit_duration_months > 0),
    'Durée de prestation invalide (entier strictement positif attendu).'
  );
  assert(
    raw.disability_trigger_rate === undefined || raw.disability_trigger_rate === null ||
      (Number.isInteger(raw.disability_trigger_rate) &&
        raw.disability_trigger_rate >= 0 && raw.disability_trigger_rate <= 100),
    'Taux de déclenchement d’invalidité invalide (entier entre 0 et 100 attendu).'
  );
  assert(
    raw.coordination_ai_lpp === undefined || typeof raw.coordination_ai_lpp === 'boolean' ||
      raw.coordination_ai_lpp === 0 || raw.coordination_ai_lpp === 1,
    'Coordination AI/LPP invalide (valeur booléenne attendue).'
  );
  assert(
    raw.premium_waiver === undefined || typeof raw.premium_waiver === 'boolean' ||
      raw.premium_waiver === 0 || raw.premium_waiver === 1,
    'Libération du paiement des primes invalide (valeur booléenne attendue).'
  );
  checkTextFields({ exclusions_notes: raw.exclusions_notes }, ['exclusions_notes'], 200);
}

// Normalise le bloc `income_protection` validé pour l'écriture en base.
function normalizeIncomeProtection(raw) {
  return {
    benefit_type: raw.benefit_type ?? null,
    insured_amount: raw.insured_amount === undefined ? null : raw.insured_amount,
    waiting_period_days: raw.waiting_period_days === undefined ? null : raw.waiting_period_days,
    benefit_duration_months: raw.benefit_duration_months === undefined ? null : raw.benefit_duration_months,
    disability_trigger_rate: raw.disability_trigger_rate === undefined ? null : raw.disability_trigger_rate,
    coordination_ai_lpp: raw.coordination_ai_lpp === true || raw.coordination_ai_lpp === 1 ? 1 : 0,
    premium_waiver: raw.premium_waiver === true || raw.premium_waiver === 1 ? 1 : 0,
    exclusions_notes: raw.exclusions_notes === '' ? null : (raw.exclusions_notes ?? null),
  };
}

// Crée, met à jour ou supprime la ligne contract_income_protection selon
// incomeProtectionBody : null → suppression ; objet → upsert (COALESCE/CASE
// WHEN conservent les valeurs par défaut SQL ou existantes pour les champs
// non fournis, permettant une mise à jour partielle). Doit être appelée
// après validation et à l'intérieur d'une transaction (relation stricte 1:1
// par contract_id).
function writeIncomeProtection(contractId, incomeProtectionBody) {
  const existing = db.prepare('SELECT * FROM contract_income_protection WHERE contract_id = ?').get(contractId);
  if (incomeProtectionBody === null) {
    if (!existing) return null;
    db.prepare('DELETE FROM contract_income_protection WHERE contract_id = ?').run(contractId);
    return { action: 'deleted' };
  }
  const norm = normalizeIncomeProtection(incomeProtectionBody);
  if (existing) {
    db.prepare(
      `UPDATE contract_income_protection SET
        benefit_type = COALESCE(?, benefit_type),
        insured_amount = CASE WHEN ? THEN ? ELSE insured_amount END,
        waiting_period_days = CASE WHEN ? THEN ? ELSE waiting_period_days END,
        benefit_duration_months = CASE WHEN ? THEN ? ELSE benefit_duration_months END,
        disability_trigger_rate = CASE WHEN ? THEN ? ELSE disability_trigger_rate END,
        coordination_ai_lpp = CASE WHEN ? THEN ? ELSE coordination_ai_lpp END,
        premium_waiver = CASE WHEN ? THEN ? ELSE premium_waiver END,
        exclusions_notes = CASE WHEN ? THEN ? ELSE exclusions_notes END,
        updated_at = datetime('now')
       WHERE contract_id = ?`
    ).run(
      norm.benefit_type,
      'insured_amount' in incomeProtectionBody ? 1 : 0, norm.insured_amount,
      'waiting_period_days' in incomeProtectionBody ? 1 : 0, norm.waiting_period_days,
      'benefit_duration_months' in incomeProtectionBody ? 1 : 0, norm.benefit_duration_months,
      'disability_trigger_rate' in incomeProtectionBody ? 1 : 0, norm.disability_trigger_rate,
      'coordination_ai_lpp' in incomeProtectionBody ? 1 : 0, norm.coordination_ai_lpp,
      'premium_waiver' in incomeProtectionBody ? 1 : 0, norm.premium_waiver,
      'exclusions_notes' in incomeProtectionBody ? 1 : 0, norm.exclusions_notes,
      contractId
    );
    // Relecture de la ligne réellement persistée : `norm` contient des
    // marqueurs `null` pour les champs absents (utilisés par CASE WHEN pour
    // ne pas les modifier), qui ne représentent pas les vraies valeurs
    // conservées en base — { ...existing, ...norm } les écraserait à tort.
    const updated = db.prepare('SELECT * FROM contract_income_protection WHERE contract_id = ?').get(contractId);
    return { action: 'updated', data: updated };
  }
  db.prepare(
    `INSERT INTO contract_income_protection (
      contract_id, benefit_type, insured_amount, waiting_period_days, benefit_duration_months,
      disability_trigger_rate, coordination_ai_lpp, premium_waiver, exclusions_notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    contractId, norm.benefit_type, norm.insured_amount, norm.waiting_period_days, norm.benefit_duration_months,
    norm.disability_trigger_rate, norm.coordination_ai_lpp, norm.premium_waiver, norm.exclusions_notes
  );
  const created = db.prepare('SELECT * FROM contract_income_protection WHERE contract_id = ?').get(contractId);
  return { action: 'created', data: created };
}

function serializeIncomeProtection(row) {
  if (row.income_protection_benefit_type == null) return null;
  return {
    benefit_type: row.income_protection_benefit_type,
    insured_amount: row.income_protection_insured_amount,
    waiting_period_days: row.income_protection_waiting_period_days,
    benefit_duration_months: row.income_protection_benefit_duration_months,
    disability_trigger_rate: row.income_protection_disability_trigger_rate,
    coordination_ai_lpp: Boolean(row.income_protection_coordination_ai_lpp),
    premium_waiver: Boolean(row.income_protection_premium_waiver),
    exclusions_notes: row.income_protection_exclusions_notes,
  };
}

// --- Détails LPP/IJM (contract_lpp_ijm, migration v8) --------------------

// Seule branche compatible avec des détails LPP/IJM, déterminée à partir de
// BRANCHES ci-dessus. Disjointe de LAMAL_COMPATIBLE_BRANCHES,
// LCA_COMPATIBLE_BRANCHES, LIFE_COMPATIBLE_BRANCHES et
// INCOME_PROTECTION_COMPATIBLE_BRANCHES : cette disjonction structurelle
// avec 'incapacite' garantit qu'un contrat ne peut jamais porter à la fois
// ce bloc et le bloc incapacité de gain privée (contract_income_protection),
// qui restent des modules entièrement distincts.
const LPP_IJM_COMPATIBLE_BRANCHES = ['lpp'];

// Signification neutre, strictement dérivée du nom de la table : `lpp`
// couvre les détails contractuels relevant de la prévoyance professionnelle,
// `ijm` ceux relevant de l'indemnité journalière maladie, `autre` sert de
// catégorie de repli. Aucune logique employeur, collective, AI ou de
// coordination détaillée n'est développée ici : le module reste volontaire-
// ment minimal, conformément au commentaire du schéma SQL.
const PRODUCT_TYPES = ['lpp', 'ijm', 'autre'];

// Valide le bloc `lpp_ijm` brut de la requête (avant normalisation). Aucune
// donnée médicale, aucun diagnostic, aucune pathologie, aucun contenu de
// questionnaire de santé : ce bloc ne porte que des paramètres contractuels.
//
// `product_type` est NOT NULL sans valeur par défaut SQL, comme
// `component_type`/`benefit_type` : obligatoire à la création (aucune ligne
// contract_lpp_ijm existante), optionnel lors d'une mise à jour partielle
// d'une ligne déjà existante (COALESCE conserve la valeur existante).
// `productTypeRequired` doit être positionné par l'appelant selon
// l'existence préalable de la ligne.
function validateLppIjmInput(raw, { productTypeRequired = true } = {}) {
  assert(raw.product_type !== null, 'Le type de produit ne peut pas être explicitement vide.');
  if (raw.product_type === undefined) {
    assert(!productTypeRequired, 'Le type de produit est requis.');
  } else {
    assert(inEnum(raw.product_type, PRODUCT_TYPES), 'Type de produit invalide.');
  }
  checkTextFields({ institution_name: raw.institution_name }, ['institution_name'], 200);
  assert(isOptionalNonNegAmount(raw.retirement_capital), 'Capital retraite invalide (nombre positif attendu).');
  assert(isOptionalNonNegAmount(raw.disability_pension), 'Rente d’invalidité invalide (nombre positif attendu).');
  assert(isOptionalNonNegAmount(raw.daily_allowance), 'Indemnité journalière invalide (nombre positif attendu).');
  assert(
    raw.waiting_period_days === undefined || raw.waiting_period_days === null ||
      (Number.isInteger(raw.waiting_period_days) && raw.waiting_period_days >= 0),
    'Délai d’attente invalide (entier non négatif attendu).'
  );
  assert(
    raw.benefit_duration_days === undefined || raw.benefit_duration_days === null ||
      (Number.isInteger(raw.benefit_duration_days) && raw.benefit_duration_days > 0),
    'Durée de prestation invalide (entier strictement positif attendu).'
  );
}

// Normalise le bloc `lpp_ijm` validé pour l'écriture en base.
function normalizeLppIjm(raw) {
  return {
    product_type: raw.product_type ?? null,
    institution_name: raw.institution_name === '' ? null : (raw.institution_name ?? null),
    retirement_capital: raw.retirement_capital === undefined ? null : raw.retirement_capital,
    disability_pension: raw.disability_pension === undefined ? null : raw.disability_pension,
    daily_allowance: raw.daily_allowance === undefined ? null : raw.daily_allowance,
    waiting_period_days: raw.waiting_period_days === undefined ? null : raw.waiting_period_days,
    benefit_duration_days: raw.benefit_duration_days === undefined ? null : raw.benefit_duration_days,
  };
}

// Crée, met à jour ou supprime la ligne contract_lpp_ijm selon lppIjmBody :
// null → suppression ; objet → upsert (COALESCE/CASE WHEN conservent les
// valeurs existantes pour les champs non fournis, permettant une mise à jour
// partielle). Doit être appelée après validation et à l'intérieur d'une
// transaction (relation stricte 1:1 par contract_id). La branche UPDATE
// relit systématiquement la ligne persistée : `norm` contient des marqueurs
// `null` pour les champs absents (utilisés par CASE WHEN pour ne pas les
// modifier), qui ne représentent pas les vraies valeurs conservées en base.
function writeLppIjm(contractId, lppIjmBody) {
  const existing = db.prepare('SELECT * FROM contract_lpp_ijm WHERE contract_id = ?').get(contractId);
  if (lppIjmBody === null) {
    if (!existing) return null;
    db.prepare('DELETE FROM contract_lpp_ijm WHERE contract_id = ?').run(contractId);
    return { action: 'deleted' };
  }
  const norm = normalizeLppIjm(lppIjmBody);
  if (existing) {
    db.prepare(
      `UPDATE contract_lpp_ijm SET
        product_type = COALESCE(?, product_type),
        institution_name = CASE WHEN ? THEN ? ELSE institution_name END,
        retirement_capital = CASE WHEN ? THEN ? ELSE retirement_capital END,
        disability_pension = CASE WHEN ? THEN ? ELSE disability_pension END,
        daily_allowance = CASE WHEN ? THEN ? ELSE daily_allowance END,
        waiting_period_days = CASE WHEN ? THEN ? ELSE waiting_period_days END,
        benefit_duration_days = CASE WHEN ? THEN ? ELSE benefit_duration_days END,
        updated_at = datetime('now')
       WHERE contract_id = ?`
    ).run(
      norm.product_type,
      'institution_name' in lppIjmBody ? 1 : 0, norm.institution_name,
      'retirement_capital' in lppIjmBody ? 1 : 0, norm.retirement_capital,
      'disability_pension' in lppIjmBody ? 1 : 0, norm.disability_pension,
      'daily_allowance' in lppIjmBody ? 1 : 0, norm.daily_allowance,
      'waiting_period_days' in lppIjmBody ? 1 : 0, norm.waiting_period_days,
      'benefit_duration_days' in lppIjmBody ? 1 : 0, norm.benefit_duration_days,
      contractId
    );
    const updated = db.prepare('SELECT * FROM contract_lpp_ijm WHERE contract_id = ?').get(contractId);
    return { action: 'updated', data: updated };
  }
  db.prepare(
    `INSERT INTO contract_lpp_ijm (
      contract_id, product_type, institution_name, retirement_capital,
      disability_pension, daily_allowance, waiting_period_days, benefit_duration_days
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    contractId, norm.product_type, norm.institution_name, norm.retirement_capital,
    norm.disability_pension, norm.daily_allowance, norm.waiting_period_days, norm.benefit_duration_days
  );
  const created = db.prepare('SELECT * FROM contract_lpp_ijm WHERE contract_id = ?').get(contractId);
  return { action: 'created', data: created };
}

function serializeLppIjm(row) {
  if (row.lpp_ijm_product_type == null) return null;
  return {
    product_type: row.lpp_ijm_product_type,
    institution_name: row.lpp_ijm_institution_name,
    retirement_capital: row.lpp_ijm_retirement_capital,
    disability_pension: row.lpp_ijm_disability_pension,
    daily_allowance: row.lpp_ijm_daily_allowance,
    waiting_period_days: row.lpp_ijm_waiting_period_days,
    benefit_duration_days: row.lpp_ijm_benefit_duration_days,
  };
}

function validateContract(data) {
  assert(inEnum(data.status, CONTRACT_STATUSES), 'Statut de contrat inconnu.');
  assert(inEnum(data.payment_frequency, FREQUENCIES), 'Fréquence de paiement inconnue.');
  assert(isNonNegNumber(data.annual_premium), 'La prime annuelle doit être un nombre positif.');
  assert(isNonNegNumber(data.acq_commission_rate), 'Le taux d’acquisition doit être un nombre positif.');
  assert(isNonNegNumber(data.rec_commission_rate), 'Le taux récurrent doit être un nombre positif.');
  assert(Number(data.acq_commission_rate || 0) <= 100 && Number(data.rec_commission_rate || 0) <= 100,
    'Un taux de commission ne peut pas dépasser 100 %.');
  assert(isDateStr(data.start_date), 'Date de début invalide (AAAA-MM-JJ).');
  assert(isDateStr(data.end_date), 'Date d’échéance invalide (AAAA-MM-JJ).');
  checkTextFields(data, ['policy_number', 'product_name'], 200);
  checkTextFields(data, ['notes'], 5000);
}

const FIELDS = [
  'client_id', 'company_id', 'branch', 'policy_number', 'product_name', 'annual_premium',
  'payment_frequency', 'start_date', 'end_date', 'status',
  'acq_commission_rate', 'rec_commission_rate', 'notes',
];

function pick(body) {
  const out = {};
  for (const f of FIELDS) if (f in (body || {})) out[f] = body[f] === '' ? null : body[f];
  return out;
}

// Colonnes SQL aplaties (alias lamal_*/lca_*/life_*/income_protection_*/
// lpp_ijm_*, cf. SELECT ci-dessous) à retirer de la copie brute de la ligne
// avant de la spreader dans la réponse : les valeurs exposées au client
// proviennent exclusivement des serializeX(r) ci-dessous, jamais de ces
// colonnes aplaties elles-mêmes.
const SPECIALIZED_FLAT_COLUMNS = [
  'lamal_care_model', 'lamal_deductible', 'lamal_accident_coverage', 'lamal_canton', 'lamal_tariff_region',
  'lca_underwriting_status', 'lca_waiting_period_days', 'lca_administrative_reservation_status',
  'lca_reservation_notes', 'lca_exclusions_status', 'lca_exclusions_notes',
  'life_component_type', 'life_insured_death_capital', 'life_insured_disability_capital', 'life_insured_rent',
  'life_surrender_value', 'life_premium_waiver', 'life_indexation_type', 'life_policy_term_years',
  'income_protection_benefit_type', 'income_protection_insured_amount', 'income_protection_waiting_period_days',
  'income_protection_benefit_duration_months', 'income_protection_disability_trigger_rate',
  'income_protection_coordination_ai_lpp', 'income_protection_premium_waiver', 'income_protection_exclusions_notes',
  'lpp_ijm_product_type', 'lpp_ijm_institution_name', 'lpp_ijm_retirement_capital', 'lpp_ijm_disability_pension',
  'lpp_ijm_daily_allowance', 'lpp_ijm_waiting_period_days', 'lpp_ijm_benefit_duration_days',
];

contractsRouter.get('/', (req, res) => {
  const { client_id, company_id, status, branch, q } = req.query;
  let sql = `
    SELECT ct.*, co.name AS company_name,
      cl.first_name, cl.last_name, cl.company_name AS client_company, cl.type AS client_type,
      (SELECT COALESCE(SUM(amount), 0) FROM commissions WHERE contract_id = ct.id AND status = 'payee') AS commissions_paid,
      (SELECT COALESCE(SUM(amount), 0) FROM commissions WHERE contract_id = ct.id AND status = 'attendue') AS commissions_pending,
      lam.care_model AS lamal_care_model, lam.deductible AS lamal_deductible,
      lam.accident_coverage AS lamal_accident_coverage, lam.canton AS lamal_canton,
      lam.tariff_region AS lamal_tariff_region,
      lca.underwriting_status AS lca_underwriting_status, lca.waiting_period_days AS lca_waiting_period_days,
      lca.administrative_reservation_status AS lca_administrative_reservation_status,
      lca.reservation_notes AS lca_reservation_notes, lca.exclusions_status AS lca_exclusions_status,
      lca.exclusions_notes AS lca_exclusions_notes,
      life.component_type AS life_component_type, life.insured_death_capital AS life_insured_death_capital,
      life.insured_disability_capital AS life_insured_disability_capital, life.insured_rent AS life_insured_rent,
      life.surrender_value AS life_surrender_value, life.premium_waiver AS life_premium_waiver,
      life.indexation_type AS life_indexation_type, life.policy_term_years AS life_policy_term_years,
      ip.benefit_type AS income_protection_benefit_type, ip.insured_amount AS income_protection_insured_amount,
      ip.waiting_period_days AS income_protection_waiting_period_days,
      ip.benefit_duration_months AS income_protection_benefit_duration_months,
      ip.disability_trigger_rate AS income_protection_disability_trigger_rate,
      ip.coordination_ai_lpp AS income_protection_coordination_ai_lpp,
      ip.premium_waiver AS income_protection_premium_waiver,
      ip.exclusions_notes AS income_protection_exclusions_notes,
      lppi.product_type AS lpp_ijm_product_type, lppi.institution_name AS lpp_ijm_institution_name,
      lppi.retirement_capital AS lpp_ijm_retirement_capital, lppi.disability_pension AS lpp_ijm_disability_pension,
      lppi.daily_allowance AS lpp_ijm_daily_allowance, lppi.waiting_period_days AS lpp_ijm_waiting_period_days,
      lppi.benefit_duration_days AS lpp_ijm_benefit_duration_days
    FROM contracts ct
    JOIN companies co ON co.id = ct.company_id
    JOIN clients cl ON cl.id = ct.client_id
    LEFT JOIN contract_lamal lam ON lam.contract_id = ct.id
    LEFT JOIN contract_lca lca ON lca.contract_id = ct.id
    LEFT JOIN contract_life life ON life.contract_id = ct.id
    LEFT JOIN contract_income_protection ip ON ip.contract_id = ct.id
    LEFT JOIN contract_lpp_ijm lppi ON lppi.contract_id = ct.id
    WHERE 1=1`;
  const params = [];
  if (client_id) { sql += ' AND ct.client_id = ?'; params.push(client_id); }
  if (company_id) { sql += ' AND ct.company_id = ?'; params.push(company_id); }
  if (status) { sql += ' AND ct.status = ?'; params.push(status); }
  if (branch) { sql += ' AND ct.branch = ?'; params.push(branch); }
  if (q) {
    sql += ` AND (ct.policy_number LIKE ? OR ct.product_name LIKE ? OR co.name LIKE ?
             OR cl.first_name LIKE ? OR cl.last_name LIKE ? OR cl.company_name LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like);
  }
  sql += ' ORDER BY ct.created_at DESC';
  res.json(
    db.prepare(sql).all(...params).map((r) => {
      const rest = { ...r };
      for (const key of SPECIALIZED_FLAT_COLUMNS) delete rest[key];
      return {
        ...rest,
        client_name:
          r.client_type === 'entreprise'
            ? r.client_company
            : [r.first_name, r.last_name].filter(Boolean).join(' '),
        lamal: serializeLamal(r),
        lca: serializeLca(r),
        life: serializeLife(r),
        income_protection: serializeIncomeProtection(r),
        lpp_ijm: serializeLppIjm(r),
      };
    })
  );
});

// Création d'un contrat : les commissions attendues sont générées automatiquement
contractsRouter.post('/', (req, res) => {
  const data = pick(req.body);
  if (!data.client_id || !data.company_id || !data.branch) {
    return res.status(400).json({ error: 'Client, compagnie et branche sont requis.' });
  }
  if (!BRANCHES.includes(data.branch)) {
    return res.status(400).json({ error: 'Branche inconnue.' });
  }
  validateContract(data);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(data.client_id);
  if (!client) return res.status(400).json({ error: 'Client introuvable.' });

  // Détails LAMal optionnels : `lamal` absent du corps → aucune écriture ;
  // `lamal: null` n'a pas de sens à la création (rien n'existe encore) et
  // est traité comme une absence ; `lamal: {...}` → création après
  // validation stricte, uniquement si la branche est compatible.
  const lamalProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'lamal');
  const lamalBody = lamalProvided ? req.body.lamal : undefined;
  if (lamalProvided && lamalBody !== null) {
    assert(LAMAL_COMPATIBLE_BRANCHES.includes(data.branch),
      'Les détails LAMal ne peuvent être associés qu’à une branche LAMal.');
    validateLamalInput(lamalBody);
  }

  // Détails LCA optionnels : mêmes règles de présence/validation que LAMal.
  const lcaProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'lca');
  const lcaBody = lcaProvided ? req.body.lca : undefined;
  if (lcaProvided && lcaBody !== null) {
    assert(LCA_COMPATIBLE_BRANCHES.includes(data.branch),
      'Les détails LCA ne peuvent être associés qu’à une branche LCA.');
    validateLcaInput(lcaBody);
  }

  // Détails vie optionnels : mêmes règles de présence/validation que LAMal/LCA.
  const lifeProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'life');
  const lifeBody = lifeProvided ? req.body.life : undefined;
  if (lifeProvided && lifeBody !== null) {
    assert(LIFE_COMPATIBLE_BRANCHES.includes(data.branch),
      'Les détails vie ne peuvent être associés qu’à une branche vie (3a/3b).');
    validateLifeInput(lifeBody);
  }

  // Détails incapacité de gain optionnels : mêmes règles de présence/validation.
  const incomeProtectionProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'income_protection');
  const incomeProtectionBody = incomeProtectionProvided ? req.body.income_protection : undefined;
  if (incomeProtectionProvided && incomeProtectionBody !== null) {
    assert(INCOME_PROTECTION_COMPATIBLE_BRANCHES.includes(data.branch),
      'Les détails incapacité de gain ne peuvent être associés qu’à une branche incapacité.');
    validateIncomeProtectionInput(incomeProtectionBody);
  }

  // Détails LPP/IJM optionnels : mêmes règles de présence/validation.
  const lppIjmProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'lpp_ijm');
  const lppIjmBody = lppIjmProvided ? req.body.lpp_ijm : undefined;
  if (lppIjmProvided && lppIjmBody !== null) {
    assert(LPP_IJM_COMPATIBLE_BRANCHES.includes(data.branch),
      'Les détails LPP/IJM ne peuvent être associés qu’à une branche LPP.');
    validateLppIjmInput(lppIjmBody);
  }

  // Garde-fou conformité : pas de contrat actif sans mandat ni information LSA
  const warnings = [];
  if (!client.mandate_signed) warnings.push('Le mandat de courtage n’est pas signé.');
  if (!client.info_lsa_date) warnings.push('L’information selon l’art. 45 LSA n’a pas été remise.');
  if (!client.consent_data) warnings.push('Le consentement nLPD au traitement des données n’est pas enregistré.');

  const premium = Number(data.annual_premium) || 0;
  const acqRate = Number(data.acq_commission_rate) || 0;

  const { contractId, lamalResult, lcaResult, lifeResult, incomeProtectionResult, lppIjmResult } = db.transaction(() => {
    const fields = Object.keys(data);
    const info = db
      .prepare(`INSERT INTO contracts (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`)
      .run(...fields.map((f) => data[f]));
    const id = info.lastInsertRowid;
    // Commission d'acquisition générée automatiquement
    if (premium > 0 && acqRate > 0) {
      db.prepare(
        `INSERT INTO commissions (contract_id, type, label, amount, due_date, status)
         VALUES (?, 'acquisition', 'Commission d''acquisition', ?, ?, 'attendue')`
      ).run(id, Math.round(premium * acqRate) / 100, data.start_date || null);
    }
    const lamal = lamalProvided && lamalBody !== null ? writeLamal(id, lamalBody) : null;
    const lca = lcaProvided && lcaBody !== null ? writeLca(id, lcaBody) : null;
    const life = lifeProvided && lifeBody !== null ? writeLife(id, lifeBody) : null;
    const incomeProtection = incomeProtectionProvided && incomeProtectionBody !== null
      ? writeIncomeProtection(id, incomeProtectionBody) : null;
    const lppIjm = lppIjmProvided && lppIjmBody !== null ? writeLppIjm(id, lppIjmBody) : null;
    return {
      contractId: id, lamalResult: lamal, lcaResult: lca, lifeResult: life,
      incomeProtectionResult: incomeProtection, lppIjmResult: lppIjm,
    };
  })();
  audit(req, 'création contrat', 'contract', contractId, `${data.branch} — client #${data.client_id}`);
  if (lamalResult?.action === 'created') {
    audit(req, 'création détails LAMal', 'contract', contractId, `franchise ${lamalResult.data.deductible}`);
  }
  if (lcaResult?.action === 'created') {
    audit(req, 'création détails LCA', 'contract', contractId, `statut ${lcaResult.data.underwriting_status}`);
  }
  if (lifeResult?.action === 'created') {
    audit(req, 'création détails vie', 'contract', contractId, `composante ${lifeResult.data.component_type}`);
  }
  if (incomeProtectionResult?.action === 'created') {
    audit(req, 'création détails incapacité de gain', 'contract', contractId,
      `type ${incomeProtectionResult.data.benefit_type}`);
  }
  if (lppIjmResult?.action === 'created') {
    audit(req, 'création détails LPP/IJM', 'contract', contractId, `type ${lppIjmResult.data.product_type}`);
  }
  res.status(201).json({ id: contractId, warnings });
});

contractsRouter.put('/:id', (req, res) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contrat introuvable.' });
  const data = pick(req.body);
  if ('branch' in data && !BRANCHES.includes(data.branch)) {
    return res.status(400).json({ error: 'Branche inconnue.' });
  }
  validateContract(data);

  // Détails LAMal optionnels : `lamal` absent du corps → aucune écriture
  // (règle 7) ; `lamal: null` → suppression explicite (règle 8) ;
  // `lamal: {...}` → création ou mise à jour après validation stricte.
  const lamalProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'lamal');
  const lamalBody = lamalProvided ? req.body.lamal : undefined;
  const lcaProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'lca');
  const lcaBody = lcaProvided ? req.body.lca : undefined;
  const lifeProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'life');
  const lifeBody = lifeProvided ? req.body.life : undefined;
  const incomeProtectionProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'income_protection');
  const incomeProtectionBody = incomeProtectionProvided ? req.body.income_protection : undefined;
  const lppIjmProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'lpp_ijm');
  const lppIjmBody = lppIjmProvided ? req.body.lpp_ijm : undefined;

  if (
    Object.keys(data).length === 0 && !lamalProvided && !lcaProvided && !lifeProvided &&
      !incomeProtectionProvided && !lppIjmProvided
  ) {
    return res.json({ ok: true });
  }

  const finalBranch = 'branch' in data ? data.branch : contract.branch;

  if (lamalProvided && lamalBody !== null) {
    assert(LAMAL_COMPATIBLE_BRANCHES.includes(finalBranch),
      'Les détails LAMal ne peuvent être associés qu’à une branche LAMal.');
    validateLamalInput(lamalBody);
  }
  if (lcaProvided && lcaBody !== null) {
    assert(LCA_COMPATIBLE_BRANCHES.includes(finalBranch),
      'Les détails LCA ne peuvent être associés qu’à une branche LCA.');
    validateLcaInput(lcaBody);
  }
  if (lifeProvided && lifeBody !== null) {
    assert(LIFE_COMPATIBLE_BRANCHES.includes(finalBranch),
      'Les détails vie ne peuvent être associés qu’à une branche vie (3a/3b).');
    const existingLifeRow = db.prepare('SELECT contract_id FROM contract_life WHERE contract_id = ?').get(contract.id);
    validateLifeInput(lifeBody, { componentTypeRequired: !existingLifeRow });
  }
  if (incomeProtectionProvided && incomeProtectionBody !== null) {
    assert(INCOME_PROTECTION_COMPATIBLE_BRANCHES.includes(finalBranch),
      'Les détails incapacité de gain ne peuvent être associés qu’à une branche incapacité.');
    const existingIncomeProtectionRow = db
      .prepare('SELECT contract_id FROM contract_income_protection WHERE contract_id = ?').get(contract.id);
    validateIncomeProtectionInput(incomeProtectionBody, { benefitTypeRequired: !existingIncomeProtectionRow });
  }
  if (lppIjmProvided && lppIjmBody !== null) {
    assert(LPP_IJM_COMPATIBLE_BRANCHES.includes(finalBranch),
      'Les détails LPP/IJM ne peuvent être associés qu’à une branche LPP.');
    const existingLppIjmRow = db.prepare('SELECT contract_id FROM contract_lpp_ijm WHERE contract_id = ?').get(contract.id);
    validateLppIjmInput(lppIjmBody, { productTypeRequired: !existingLppIjmRow });
  }

  // Changement de branche vers une branche incompatible alors qu'une ligne
  // contract_lamal, contract_lca, contract_life, contract_income_protection
  // ou contract_lpp_ijm existe déjà : refusé, sauf suppression explicite du
  // bloc concerné dans la même requête (…: null).
  if ('branch' in data && !LAMAL_COMPATIBLE_BRANCHES.includes(finalBranch)) {
    const existingLamal = db.prepare('SELECT contract_id FROM contract_lamal WHERE contract_id = ?').get(contract.id);
    const explicitlyCleared = lamalProvided && lamalBody === null;
    if (existingLamal && !explicitlyCleared) {
      return res.status(400).json({
        error: 'Ce contrat a des détails LAMal enregistrés ; supprimez-les explicitement (lamal: null) avant de changer de branche.',
      });
    }
  }
  if ('branch' in data && !LCA_COMPATIBLE_BRANCHES.includes(finalBranch)) {
    const existingLca = db.prepare('SELECT contract_id FROM contract_lca WHERE contract_id = ?').get(contract.id);
    const explicitlyCleared = lcaProvided && lcaBody === null;
    if (existingLca && !explicitlyCleared) {
      return res.status(400).json({
        error: 'Ce contrat a des détails LCA enregistrés ; supprimez-les explicitement (lca: null) avant de changer de branche.',
      });
    }
  }
  if ('branch' in data && !LIFE_COMPATIBLE_BRANCHES.includes(finalBranch)) {
    const existingLife = db.prepare('SELECT contract_id FROM contract_life WHERE contract_id = ?').get(contract.id);
    const explicitlyCleared = lifeProvided && lifeBody === null;
    if (existingLife && !explicitlyCleared) {
      return res.status(400).json({
        error: 'Ce contrat a des détails vie enregistrés ; supprimez-les explicitement (life: null) avant de changer de branche.',
      });
    }
  }
  if ('branch' in data && !INCOME_PROTECTION_COMPATIBLE_BRANCHES.includes(finalBranch)) {
    const existingIncomeProtection = db
      .prepare('SELECT contract_id FROM contract_income_protection WHERE contract_id = ?').get(contract.id);
    const explicitlyCleared = incomeProtectionProvided && incomeProtectionBody === null;
    if (existingIncomeProtection && !explicitlyCleared) {
      return res.status(400).json({
        error: 'Ce contrat a des détails incapacité de gain enregistrés ; supprimez-les explicitement (income_protection: null) avant de changer de branche.',
      });
    }
  }
  if ('branch' in data && !LPP_IJM_COMPATIBLE_BRANCHES.includes(finalBranch)) {
    const existingLppIjm = db.prepare('SELECT contract_id FROM contract_lpp_ijm WHERE contract_id = ?').get(contract.id);
    const explicitlyCleared = lppIjmProvided && lppIjmBody === null;
    if (existingLppIjm && !explicitlyCleared) {
      return res.status(400).json({
        error: 'Ce contrat a des détails LPP/IJM enregistrés ; supprimez-les explicitement (lpp_ijm: null) avant de changer de branche.',
      });
    }
  }

  const fields = Object.keys(data);
  const { lamalResult, lcaResult, lifeResult, incomeProtectionResult, lppIjmResult } = db.transaction(() => {
    if (fields.length > 0) {
      db.prepare(
        `UPDATE contracts SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`
      ).run(...fields.map((f) => data[f]), contract.id);
    }
    return {
      lamalResult: lamalProvided ? writeLamal(contract.id, lamalBody) : null,
      lcaResult: lcaProvided ? writeLca(contract.id, lcaBody) : null,
      lifeResult: lifeProvided ? writeLife(contract.id, lifeBody) : null,
      incomeProtectionResult: incomeProtectionProvided
        ? writeIncomeProtection(contract.id, incomeProtectionBody) : null,
      lppIjmResult: lppIjmProvided ? writeLppIjm(contract.id, lppIjmBody) : null,
    };
  })();

  if (fields.length > 0) audit(req, 'modification contrat', 'contract', contract.id, fields.join(', '));
  if (lamalResult?.action === 'created') {
    audit(req, 'création détails LAMal', 'contract', contract.id, `franchise ${lamalResult.data.deductible}`);
  } else if (lamalResult?.action === 'updated') {
    audit(req, 'modification détails LAMal', 'contract', contract.id, `franchise ${lamalResult.data.deductible}`);
  } else if (lamalResult?.action === 'deleted') {
    audit(req, 'suppression détails LAMal', 'contract', contract.id);
  }
  if (lcaResult?.action === 'created') {
    audit(req, 'création détails LCA', 'contract', contract.id, `statut ${lcaResult.data.underwriting_status}`);
  } else if (lcaResult?.action === 'updated') {
    audit(req, 'modification détails LCA', 'contract', contract.id, `statut ${lcaResult.data.underwriting_status}`);
  } else if (lcaResult?.action === 'deleted') {
    audit(req, 'suppression détails LCA', 'contract', contract.id);
  }
  if (lifeResult?.action === 'created') {
    audit(req, 'création détails vie', 'contract', contract.id, `composante ${lifeResult.data.component_type}`);
  } else if (lifeResult?.action === 'updated') {
    audit(req, 'modification détails vie', 'contract', contract.id, `composante ${lifeResult.data.component_type}`);
  } else if (lifeResult?.action === 'deleted') {
    audit(req, 'suppression détails vie', 'contract', contract.id);
  }
  if (incomeProtectionResult?.action === 'created') {
    audit(req, 'création détails incapacité de gain', 'contract', contract.id,
      `type ${incomeProtectionResult.data.benefit_type}`);
  } else if (incomeProtectionResult?.action === 'updated') {
    audit(req, 'modification détails incapacité de gain', 'contract', contract.id,
      `type ${incomeProtectionResult.data.benefit_type}`);
  } else if (incomeProtectionResult?.action === 'deleted') {
    audit(req, 'suppression détails incapacité de gain', 'contract', contract.id);
  }
  if (lppIjmResult?.action === 'created') {
    audit(req, 'création détails LPP/IJM', 'contract', contract.id, `type ${lppIjmResult.data.product_type}`);
  } else if (lppIjmResult?.action === 'updated') {
    audit(req, 'modification détails LPP/IJM', 'contract', contract.id, `type ${lppIjmResult.data.product_type}`);
  } else if (lppIjmResult?.action === 'deleted') {
    audit(req, 'suppression détails LPP/IJM', 'contract', contract.id);
  }
  res.json({ ok: true });
});

contractsRouter.delete('/:id', (req, res) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contrat introuvable.' });
  const paid = db
    .prepare("SELECT COUNT(*) AS n FROM commissions WHERE contract_id = ? AND status = 'payee'")
    .get(contract.id).n;
  if (paid > 0) {
    return res.status(400).json({
      error: 'Des commissions payées sont liées à ce contrat (conservation comptable 10 ans, art. 958f CO). Passez-le en « résilié » plutôt que de le supprimer.',
    });
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM commissions WHERE contract_id = ?').run(contract.id);
    db.prepare('DELETE FROM tasks WHERE contract_id = ?').run(contract.id);
    db.prepare('DELETE FROM contracts WHERE id = ?').run(contract.id);
  });
  tx();
  audit(req, 'suppression contrat', 'contract', contract.id, contract.policy_number || '');
  res.json({ ok: true });
});
