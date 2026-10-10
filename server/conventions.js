// Conventions de courtage : validation, lecture, résolution d'une ligne de
// barème pour un contrat et import d'un fichier de conventions.
//
// Les barèmes réels sont confidentiels (clauses de confidentialité des
// compagnies) : ce module ne contient aucune valeur de convention, il ne fait
// que lire et écrire ce que le courtier saisit ou importe dans SA base.
import db from './db.js';
import { assert, inEnum, checkTextFields, isPositiveId, ValidationError } from './validate.js';
import { BRANCHES, BRANCH_LABELS } from './branches.js';
import {
  CONVENTION_STATUSES, CLIENT_FOLLOWUP_VALUES, RATE_BASES, CLAWBACK_MODES, MAX_CLAWBACK_MONTHS,
  normalizeClawbackSteps, parseClawbackSteps, parseIsoDate, localIsoDate,
} from '../shared/conventionRules.js';

export const CONVENTION_FIELDS = [
  'company_id', 'title', 'counterparty', 'intermediary_code', 'status', 'signed_date', 'effective_date',
  'end_date', 'scope', 'termination_notice', 'payment_terms', 'statement_objection_days', 'client_followup',
  'obligations', 'restrictions', 'missing_documents', 'document_location', 'notes',
];

export const RATE_FIELDS = [
  'branch', 'label', 'insurer_entity', 'basis', 'value', 'multiply_by_years', 'max_years', 'valuation_pct',
  'cap_chf', 'is_estimate', 'rec_rate', 'rec_conditions', 'clawback_mode', 'clawback_steps', 'clawback_months',
  'clawback_notes', 'conditions', 'source_ref', 'active', 'sort',
];

// Champs qui déterminent un montant (commission ou reprise) : figés dès
// qu'une ligne a servi à un contrat — on désactive l'ancienne ligne et on en
// crée une nouvelle, jamais de réécriture silencieuse de l'historique.
export const RATE_FINANCIAL_FIELDS = [
  'branch', 'basis', 'value', 'multiply_by_years', 'max_years', 'valuation_pct', 'cap_chf',
  'clawback_mode', 'clawback_steps', 'clawback_months',
];

const COMPUTED_BASES = ['fixe', 'mois_prime', 'pct_prime_annuelle', 'pct_production'];

// Valeur maximale admise par base de calcul (garde-fou de saisie). Pour
// « aucune » et « à confirmer », la valeur n'entre dans aucun calcul.
const VALUE_MAX = {
  fixe: 100000, mois_prime: 120, pct_prime_annuelle: 100, pct_production: 100, aucune: 100000, a_confirmer: 100000,
};

const hasOwn = (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key);
const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

function pickPresent(body, fields) {
  const out = {};
  for (const f of fields) {
    if (hasOwn(body, f)) out[f] = body[f] === '' ? null : body[f];
  }
  return out;
}

function toFlag(value, field) {
  if (value === true || value === 1) return 1;
  if (value === false || value === 0 || value == null) return 0;
  throw new ValidationError(`Le champ « ${field} » doit valoir vrai ou faux.`);
}

function optionalNumber(value, field, { min = 0, max = Infinity, integer = false } = {}) {
  if (value == null) return null;
  assert(typeof value === 'number' && Number.isFinite(value), `Le champ « ${field} » doit être un nombre.`);
  assert(!integer || Number.isInteger(value), `Le champ « ${field} » doit être un nombre entier.`);
  assert(value >= min && value <= max, `Le champ « ${field} » doit être compris entre ${min} et ${max}.`);
  return value;
}

// Date stricte AAAA-MM-JJ : le 31 février est refusé (Date.parse l'accepte).
function isStrictDate(value) {
  return value == null || parseIsoDate(value) != null;
}

function formatDateCh(iso) {
  const [y, m, d] = String(iso).split('-');
  return `${d}.${m}.${y}`;
}

// --- Conventions ----------------------------------------------------------

// Valide une convention complète (création) ou fusionnée (mise à jour).
export function validateConvention(conv, { checkCompany = true } = {}) {
  if (checkCompany) {
    assert(isPositiveId(conv.company_id), 'La compagnie est requise.');
    assert(db.prepare('SELECT id FROM companies WHERE id = ?').get(Number(conv.company_id)), 'Compagnie introuvable.');
  }
  assert(typeof conv.title === 'string' && conv.title.trim().length > 0, 'Le titre de la convention est requis.');
  assert(inEnum(conv.status, CONVENTION_STATUSES), 'Statut de convention inconnu.');
  assert(inEnum(conv.client_followup, CLIENT_FOLLOWUP_VALUES), 'Valeur « suivi du client » inconnue.');
  for (const f of ['signed_date', 'effective_date', 'end_date']) {
    assert(isStrictDate(conv[f]), `Date « ${f} » invalide (AAAA-MM-JJ).`);
  }
  assert(!(conv.effective_date && conv.end_date) || conv.end_date >= conv.effective_date,
    'La date de fin de la convention précède son entrée en vigueur.');
  optionalNumber(conv.statement_objection_days, 'statement_objection_days', { max: 365, integer: true });
  checkTextFields(conv, ['title', 'counterparty', 'intermediary_code', 'document_location'], 200);
  checkTextFields(conv, ['scope', 'termination_notice', 'payment_terms', 'obligations', 'restrictions', 'missing_documents', 'notes'], 5000);
}

// Fusionne les champs PRÉSENTS dans `body` avec la convention existante :
// un champ absent garde sa valeur, un champ vide ('' ou null) l'efface.
export function normalizeConventionInput(body, existing = null, { checkCompany = true } = {}) {
  const data = pickPresent(body, CONVENTION_FIELDS);
  if (typeof data.title === 'string') data.title = data.title.trim();
  const merged = {
    status: 'signee',
    client_followup: 'non_precise',
    ...(existing || {}),
    ...data,
  };
  // Une valeur vide garde celle qui est enregistrée : jamais « signée » par
  // défaut pour une convention existante (une convention résiliée le reste).
  if (merged.status == null) merged.status = existing?.status ?? 'signee';
  if (merged.client_followup == null) merged.client_followup = existing?.client_followup ?? 'non_precise';
  validateConvention(merged, { checkCompany });
  if (checkCompany) merged.company_id = Number(merged.company_id);
  const out = {};
  for (const f of CONVENTION_FIELDS) out[f] = merged[f] ?? null;
  return out;
}

// --- Lignes de barème -----------------------------------------------------

// Valide et normalise une ligne (création, ou fusion des champs présents avec
// la ligne existante pour une mise à jour). Retourne l'objet prêt à écrire
// (clawback_steps sérialisé en JSON).
export function normalizeRateInput(body, existing = null) {
  const data = pickPresent(body, RATE_FIELDS);
  const merged = { ...(existing || {}), ...data };
  if (typeof merged.label === 'string') merged.label = merged.label.trim();

  assert(BRANCHES.includes(merged.branch), 'Branche inconnue pour cette ligne de barème.');
  assert(typeof merged.label === 'string' && merged.label.length > 0, 'Le libellé de la ligne de barème est requis.');
  assert(RATE_BASES.includes(merged.basis), 'Base de calcul inconnue.');
  const { basis } = merged;

  const value = optionalNumber(merged.value, 'value', { max: VALUE_MAX[basis] });
  if (COMPUTED_BASES.includes(basis)) {
    assert(value != null, 'La valeur du barème est requise pour cette base de calcul.');
  }

  // Paramètres propres à une base de calcul : remis à vide pour les autres
  // bases (ils n'y ont aucun effet), sauf demande explicite contradictoire.
  let multiply = 0;
  if (basis === 'pct_prime_annuelle') {
    multiply = toFlag(merged.multiply_by_years, 'multiply_by_years');
  } else if (hasOwn(data, 'multiply_by_years')) {
    assert(!toFlag(data.multiply_by_years, 'multiply_by_years'),
      'La multiplication par années ne s’applique qu’à un pourcentage de la prime annuelle.');
  }
  const isProduction = basis === 'pct_production';
  const maxYears = isProduction ? optionalNumber(merged.max_years, 'max_years', { min: 1, max: 100, integer: true }) : null;
  const valuation = isProduction ? optionalNumber(merged.valuation_pct, 'valuation_pct', { min: 0.01, max: 500 }) : null;
  const cap = optionalNumber(merged.cap_chf, 'cap_chf', { max: 10000000 });
  const recRate = optionalNumber(merged.rec_rate, 'rec_rate', { max: 100 });

  const mode = merged.clawback_mode == null ? 'inconnu' : merged.clawback_mode;
  assert(CLAWBACK_MODES.includes(mode), 'Mode de reprise inconnu.');
  let steps = null;
  let months = null;
  if (mode === 'paliers') {
    try {
      steps = JSON.stringify(normalizeClawbackSteps(parseStepsInput(merged.clawback_steps)));
    } catch (err) {
      throw new ValidationError(err.message);
    }
  } else if (mode === 'prorata') {
    months = optionalNumber(merged.clawback_months, 'clawback_months', { min: 1, max: MAX_CLAWBACK_MONTHS, integer: true });
    assert(months != null, 'La durée de la période de reprise (mois) est requise pour une reprise au prorata.');
  }

  // `active` vide : la ligne garde son état (jamais réactivée par défaut).
  const activeInput = merged.active == null ? existing?.active : merged.active;

  const sort = merged.sort == null ? 0 : merged.sort;
  assert(Number.isInteger(sort) && Math.abs(sort) <= 100000, 'L’ordre d’affichage doit être un entier.');

  const out = {
    branch: merged.branch,
    label: merged.label,
    insurer_entity: merged.insurer_entity ?? null,
    basis,
    value,
    multiply_by_years: multiply,
    max_years: maxYears,
    valuation_pct: valuation,
    cap_chf: cap,
    is_estimate: toFlag(merged.is_estimate, 'is_estimate'),
    rec_rate: recRate,
    rec_conditions: merged.rec_conditions ?? null,
    clawback_mode: mode,
    clawback_steps: steps,
    clawback_months: months,
    clawback_notes: merged.clawback_notes ?? null,
    conditions: merged.conditions ?? null,
    source_ref: merged.source_ref ?? null,
    active: activeInput == null ? 1 : toFlag(activeInput, 'active'),
    sort,
  };
  checkTextFields(out, ['label', 'insurer_entity', 'source_ref'], 200);
  checkTextFields(out, ['rec_conditions', 'clawback_notes', 'conditions'], 2000);
  return out;
}

function parseStepsInput(raw) {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error('Les paliers de reprise doivent être une liste JSON valide.');
    }
  }
  return raw;
}

// Nombre de contrats et de commissions qui s'appuient sur une ligne.
export function rateUsageCount(rateId) {
  const contracts = db.prepare('SELECT COUNT(*) AS n FROM contracts WHERE convention_rate_id = ?').get(rateId).n;
  const commissions = db.prepare('SELECT COUNT(*) AS n FROM commissions WHERE convention_rate_id = ?').get(rateId).n;
  return contracts + commissions;
}

// Champs de `next` (ligne normalisée) qui diffèrent de la ligne `existing`.
export function changedRateFields(existing, next) {
  return Object.keys(next).filter((f) => {
    if (f === 'clawback_steps') {
      return JSON.stringify(parseClawbackSteps(existing[f])) !== JSON.stringify(parseClawbackSteps(next[f]));
    }
    return (existing[f] ?? null) !== (next[f] ?? null);
  });
}

export function financialFieldsChanged(existing, next) {
  return changedRateFields(existing, next).filter((f) => RATE_FINANCIAL_FIELDS.includes(f));
}

function serializeRate(row) {
  return {
    ...row,
    multiply_by_years: Boolean(row.multiply_by_years),
    is_estimate: Boolean(row.is_estimate),
    active: Boolean(row.active),
    clawback_steps: parseClawbackSteps(row.clawback_steps),
  };
}

// --- Lecture ------------------------------------------------------------

// Une convention est « en vigueur » tant que sa date de fin, si elle en a
// une, n'est pas dépassée (date du jour en Suisse). Paramètre : la date.
const IN_FORCE_SQL = '(cv.end_date IS NULL OR cv.end_date >= ?)';

export function getRate(rateId) {
  const row = db.prepare('SELECT * FROM convention_rates WHERE id = ?').get(rateId);
  return row ? serializeRate(row) : null;
}

function serializeConvention(conv) {
  return { ...conv, in_force: Boolean(conv.in_force), rates: listRatesOfConvention(conv.id) };
}

export function getConvention(id, today = localIsoDate()) {
  const conv = db
    .prepare(`SELECT cv.*, co.name AS company_name, co.active AS company_active, ${IN_FORCE_SQL} AS in_force
              FROM conventions cv JOIN companies co ON co.id = cv.company_id WHERE cv.id = ?`)
    .get(today, id);
  return conv ? serializeConvention(conv) : null;
}

function listRatesOfConvention(conventionId) {
  return db
    .prepare(
      `SELECT r.*,
         (SELECT COUNT(*) FROM contracts ct WHERE ct.convention_rate_id = r.id) AS contracts_count,
         (SELECT COUNT(*) FROM commissions cm WHERE cm.convention_rate_id = r.id) AS commissions_count
       FROM convention_rates r WHERE r.convention_id = ? ORDER BY r.active DESC, r.sort, r.id`
    )
    .all(conventionId)
    .map((row) => ({ ...serializeRate(row), usage_count: row.contracts_count + row.commissions_count }));
}

export function listConventions(today = localIsoDate()) {
  return db
    .prepare(
      `SELECT cv.*, co.name AS company_name, co.active AS company_active, ${IN_FORCE_SQL} AS in_force
       FROM conventions cv JOIN companies co ON co.id = cv.company_id
       ORDER BY CASE cv.status WHEN 'signee' THEN 0 WHEN 'en_attente' THEN 1 ELSE 2 END,
                co.name COLLATE NOCASE, cv.id`
    )
    .all(today)
    .map(serializeConvention);
}

// Lignes applicables à un contrat (compagnie + branche). Par défaut :
// uniquement les lignes actives des conventions signées et en vigueur.
// `includeInactive` (modification d'un contrat) renvoie toutes les lignes,
// pour pouvoir afficher celle qui est déjà liée.
export function listApplicableRates({ company_id, branch, includeInactive = false, today = localIsoDate() }) {
  const rows = db
    .prepare(
      `SELECT r.*, cv.title AS convention_title, cv.status AS convention_status, cv.end_date AS convention_end_date,
         ${IN_FORCE_SQL} AS convention_in_force,
         cv.intermediary_code, cv.obligations, cv.restrictions, cv.client_followup, cv.missing_documents
       FROM convention_rates r JOIN conventions cv ON cv.id = r.convention_id
       WHERE cv.company_id = ? AND r.branch = ?
         AND (? = 1 OR (r.active = 1 AND cv.status = 'signee' AND ${IN_FORCE_SQL}))
       ORDER BY r.active DESC, r.sort, r.id`
    )
    .all(today, company_id, branch, includeInactive ? 1 : 0, today);
  return rows.map((row) => ({ ...serializeRate(row), convention_in_force: Boolean(row.convention_in_force) }));
}

// Situation conventionnelle d'une compagnie pour une branche. `inUse` est
// faux tant qu'aucune convention n'a jamais été saisie dans le CRM : aucun
// avertissement n'est alors émis (rien ne permet de conclure à une absence).
export function conventionCoverage(company_id, branch, today = localIsoDate()) {
  const inUse = db.prepare('SELECT COUNT(*) AS n FROM conventions').get().n > 0;
  const signedEver = db
    .prepare("SELECT COUNT(*) AS n FROM conventions WHERE company_id = ? AND status = 'signee'")
    .get(company_id).n > 0;
  const signed = db
    .prepare(`SELECT COUNT(*) AS n FROM conventions cv WHERE cv.company_id = ? AND cv.status = 'signee' AND ${IN_FORCE_SQL}`)
    .get(company_id, today).n > 0;
  const covered = db
    .prepare(
      `SELECT COUNT(*) AS n FROM convention_rates r JOIN conventions cv ON cv.id = r.convention_id
       WHERE cv.company_id = ? AND cv.status = 'signee' AND ${IN_FORCE_SQL} AND r.branch = ? AND r.active = 1`
    )
    .get(company_id, today, branch).n > 0;
  return { inUse, signedEver, signed, covered };
}

export function coverageWarning(company, branch, today = localIsoDate()) {
  const cov = conventionCoverage(company.id, branch, today);
  if (!cov.inUse || cov.covered) return null;
  if (cov.signed) {
    const label = BRANCH_LABELS[branch] || branch;
    return `La convention avec ${company.name} ne prévoit aucune ligne pour la branche « ${label} » : vérifiez que vous pouvez transmettre cette affaire.`;
  }
  if (cov.signedEver) {
    return `La convention de courtage avec ${company.name} n’est plus en vigueur : vérifiez votre droit de transmettre cette proposition.`;
  }
  return `Aucune convention de courtage signée avec ${company.name} : vérifiez votre droit de transmettre cette proposition.`;
}

// Vérifie qu'une ligne de barème peut être rattachée à un contrat de cette
// compagnie et de cette branche. `forCreation` impose en plus une ligne
// active d'une convention signée et en vigueur (à la modification, une
// ligne déjà liée et devenue inactive reste acceptée).
export function resolveRateForContract({ rateId, company_id, branch, forCreation = true, today = localIsoDate() }) {
  assert(isPositiveId(rateId), 'Ligne de barème invalide.');
  const row = db
    .prepare(
      `SELECT r.*, cv.company_id, cv.status AS convention_status, cv.title AS convention_title,
         cv.end_date AS convention_end_date
       FROM convention_rates r JOIN conventions cv ON cv.id = r.convention_id WHERE r.id = ?`
    )
    .get(Number(rateId));
  assert(row, 'Ligne de barème introuvable.');
  assert(Number(row.company_id) === Number(company_id), 'Cette ligne de barème appartient à la convention d’une autre compagnie.');
  assert(row.branch === branch, 'Cette ligne de barème concerne une autre branche que celle du contrat.');
  if (forCreation) {
    assert(row.convention_status === 'signee', 'La convention de cette ligne n’est pas signée : choisissez une autre ligne.');
    assert(!row.convention_end_date || row.convention_end_date >= today,
      `La convention de cette ligne a pris fin le ${formatDateCh(row.convention_end_date || '')} : choisissez une autre ligne.`);
    assert(row.active === 1, 'Cette ligne de barème est désactivée : choisissez une ligne active.');
  }
  return serializeRate(row);
}

// --- Import -------------------------------------------------------------
//
// Import NON DESTRUCTIF :
//  - seuls les champs présents dans le fichier sont écrits ; ce que le
//    conseiller a complété dans le CRM et qui n'y figure pas est conservé
//    (un champ explicitement vide, "" ou null, efface la valeur) ;
//  - sans clé « rates », les lignes de barème de la convention ne sont pas
//    touchées ; une ligne existante absente du fichier reste en place, sauf
//    option `retire_missing` (elle est alors désactivée, jamais supprimée) ;
//  - une ligne utilisée dont un montant change est REMPLACÉE (l'ancienne est
//    désactivée, jamais réécrite) ;
//  - une ligne ou une compagnie désactivée dans le CRM n'est jamais
//    réactivée en silence : une ligne seulement si le fichier indique
//    "active": true, une compagnie seulement si sa convention est signée ;
//  - un champ inconnu (faute de frappe) fait refuser le fichier ; une clé
//    commençant par « _ » est un commentaire, ignoré.
// Tout le fichier est validé avant la moindre écriture.

export const IMPORT_FORMAT = 'crm-legrand-conventions';

const TOP_LEVEL_KEYS = [
  'format', 'version', 'generated_at', 'note', 'deactivate_companies_without_convention', 'retire_missing_rates',
  'conventions',
];
const CONVENTION_IMPORT_KEYS = ['company', 'rates', ...CONVENTION_FIELDS.filter((f) => f !== 'company_id')];
const COMPANY_IMPORT_FIELDS = ['contact_name', 'contact_email', 'contact_phone', 'finma_number', 'default_acq_rate', 'default_rec_rate'];
const COMPANY_IMPORT_KEYS = ['name', 'aliases', ...COMPANY_IMPORT_FIELDS];
const MAX_IMPORT_CONVENTIONS = 50;
const MAX_IMPORT_RATES = 100;
const MAX_ALIASES = 20;

function assertKnownKeys(obj, allowed, what) {
  const unknown = Object.keys(obj).filter((k) => !k.startsWith('_') && !allowed.includes(k));
  assert(unknown.length === 0,
    `${what} : ${unknown.length > 1 ? 'champs inconnus' : 'champ inconnu'} ${unknown.map((k) => `« ${k} »`).join(', ')}`
    + ' (vérifiez l’orthographe ; un commentaire commence par « _ »).');
}

function normName(value) {
  return String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

// Noms normalisés d'une compagnie du fichier : nom principal d'abord, puis
// alias dans l'ordre.
function companySpecNames(spec) {
  assert(typeof spec.name === 'string' && spec.name.trim(), 'nom de compagnie requis.');
  assert(spec.name.trim().length <= 200, 'nom de compagnie trop long (200 caractères au plus).');
  const aliases = spec.aliases == null ? [] : spec.aliases;
  assert(Array.isArray(aliases) && aliases.length <= MAX_ALIASES, `« aliases » doit être une liste d’au plus ${MAX_ALIASES} noms.`);
  for (const alias of aliases) {
    assert(typeof alias === 'string' && alias.trim() && alias.trim().length <= 200,
      'chaque alias doit être un nom non vide de 200 caractères au plus.');
  }
  const names = [];
  for (const n of [spec.name, ...aliases].map(normName)) if (n && !names.includes(n)) names.push(n);
  return names;
}

function companyChangesFrom(spec) {
  const changes = pickPresent(spec, COMPANY_IMPORT_FIELDS);
  for (const f of ['default_acq_rate', 'default_rec_rate']) {
    if (f in changes) optionalNumber(changes[f], f, { max: 100 });
  }
  assert(changes.contact_email == null || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(changes.contact_email),
    'adresse e-mail de contact invalide.');
  checkTextFields(changes, ['contact_name', 'contact_email', 'contact_phone', 'finma_number'], 200);
  return changes;
}

function optionalBoolean(value, field) {
  assert(value == null || typeof value === 'boolean', `« ${field} » doit valoir true ou false.`);
  return value == null ? undefined : value;
}

// Construit le plan d'import sans rien écrire. Lève une ValidationError
// (message préfixé par la convention et la ligne concernées) au premier
// problème : un fichier invalide n'est jamais appliqué partiellement.
export function planImport(data, { deactivateOthers, retireMissing, today = localIsoDate() } = {}) {
  assert(isPlainObject(data), 'Fichier d’import invalide.');
  assert(data.format === IMPORT_FORMAT, `Format de fichier inconnu (attendu : « ${IMPORT_FORMAT} »).`);
  assert(data.version === 1, 'Version de fichier non prise en charge (attendu : 1).');
  assertKnownKeys(data, TOP_LEVEL_KEYS, 'Fichier');
  assert(Array.isArray(data.conventions) && data.conventions.length > 0 && data.conventions.length <= MAX_IMPORT_CONVENTIONS,
    `Le fichier doit contenir entre 1 et ${MAX_IMPORT_CONVENTIONS} conventions.`);
  const deactivate = deactivateOthers ?? optionalBoolean(data.deactivate_companies_without_convention, 'deactivate_companies_without_convention') ?? false;
  const retire = retireMissing ?? optionalBoolean(data.retire_missing_rates, 'retire_missing_rates') ?? false;

  // Pour un même nom, une compagnie active prime sur un doublon désactivé.
  const companies = db.prepare('SELECT * FROM companies ORDER BY active DESC, id').all();
  const existingByName = new Map(); // nom normalisé → compagnie en base
  for (const co of companies) {
    const n = normName(co.name);
    if (!existingByName.has(n)) existingByName.set(n, co);
  }
  const plan = {
    options: { deactivate_others: deactivate, retire_missing: retire },
    companies: [], conventions: [], deactivate: [], deactivate_skipped: [], summary: {},
  };
  const seenConventions = new Set();

  // 1re passe : structure de chaque entrée et noms de sa compagnie.
  const entries = data.conventions.map((item, index) => {
    const companyLabel = typeof item?.company?.name === 'string' ? item.company.name.trim() : '';
    const where = `Convention n° ${index + 1}${companyLabel ? ` (${companyLabel})` : ''}`;
    try {
      assert(isPlainObject(item), 'entrée invalide.');
      assertKnownKeys(item, CONVENTION_IMPORT_KEYS, 'champs de la convention');
      assert(isPlainObject(item.company), 'compagnie requise (objet « company »).');
      assertKnownKeys(item.company, COMPANY_IMPORT_KEYS, 'champs de la compagnie');
      return { item, where, names: companySpecNames(item.company), changes: companyChangesFrom(item.company) };
    } catch (err) {
      if (err instanceof ValidationError) throw new ValidationError(`${where} — ${err.message}`);
      throw err;
    }
  });

  // Les entrées qui partagent un nom ou un alias désignent la même
  // compagnie, quel que soit leur ordre dans le fichier.
  const parent = entries.map((_, i) => i);
  const find = (i) => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    return root;
  };
  const firstEntryByName = new Map();
  entries.forEach((entry, i) => {
    for (const n of entry.names) {
      if (!firstEntryByName.has(n)) {
        firstEntryByName.set(n, i);
        continue;
      }
      const a = find(firstEntryByName.get(n));
      const b = find(i);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  });

  // Chaque groupe est rattaché à une compagnie en base — noms principaux
  // d'abord, puis alias, dans l'ordre du fichier — sinon créé. Les autres
  // fiches du CRM qui portent l'un de ces noms sont signalées (homonymes).
  const keyByGroup = new Map();
  entries.forEach((entry, i) => {
    const root = find(i);
    if (!keyByGroup.has(root)) {
      const members = entries.filter((_, j) => find(j) === root);
      const candidates = [];
      for (const m of members) if (!candidates.includes(m.names[0])) candidates.push(m.names[0]);
      for (const m of members) for (const n of m.names.slice(1)) if (!candidates.includes(n)) candidates.push(n);
      const matches = candidates.map((n) => existingByName.get(n)).filter(Boolean);
      const existing = matches[0] || null;
      const homonyms = [...new Set(matches.filter((co) => co.id !== existing?.id).map((co) => co.name))];
      const key = plan.companies.length;
      plan.companies.push(existing
        ? { key, id: existing.id, name: existing.name, existing, action: 'unchanged', changes: {}, changed: [], homonyms }
        : { key, id: null, name: entry.item.company.name.trim(), action: 'create', changes: {}, changed: [], homonyms });
      keyByGroup.set(root, key);
    }
    entry.companyKey = keyByGroup.get(root);
    Object.assign(plan.companies[entry.companyKey].changes, entry.changes);
  });

  entries.forEach((entry) => {
    const { item, where } = entry;
    try {
      const companyPlan = plan.companies[entry.companyKey];

      assert(typeof item.title === 'string' && item.title.trim(), 'titre de la convention requis.');
      const title = item.title.trim();
      const convKey = `${companyPlan.key}|${title}`;
      assert(!seenConventions.has(convKey), `la convention « ${title} » figure deux fois pour cette compagnie.`);
      seenConventions.add(convKey);
      const existingConv = companyPlan.id
        ? db.prepare('SELECT * FROM conventions WHERE company_id = ? AND title = ? ORDER BY id DESC LIMIT 1').get(companyPlan.id, title)
        : null;
      const conv = normalizeConventionInput({ ...item, title }, existingConv, { checkCompany: false });
      const convChanged = existingConv
        ? CONVENTION_FIELDS.filter((f) => f !== 'company_id' && (existingConv[f] ?? null) !== (conv[f] ?? null))
        : [];

      const ratesProvided = hasOwn(item, 'rates');
      const ratePlans = [];
      const absent = [];
      if (ratesProvided) {
        assert(Array.isArray(item.rates) && item.rates.length <= MAX_IMPORT_RATES,
          `« rates » doit être une liste d’au plus ${MAX_IMPORT_RATES} lignes de barème.`);
        const seenRates = new Set();
        const matched = new Set();
        item.rates.forEach((rateBody, rIndex) => {
          const rateLabel = typeof rateBody?.label === 'string' ? rateBody.label.trim() : '';
          try {
            assert(isPlainObject(rateBody), 'ligne invalide.');
            assertKnownKeys(rateBody, RATE_FIELDS, 'champs de la ligne');
            // Une ligne est identifiée par sa branche et son libellé.
            const current = existingConv && BRANCHES.includes(rateBody.branch) && rateLabel
              ? db.prepare(
                `SELECT * FROM convention_rates WHERE convention_id = ? AND branch = ? AND label = ?
                 ORDER BY active DESC, id DESC LIMIT 1`
              ).get(existingConv.id, rateBody.branch, rateLabel)
              : null;
            const rate = normalizeRateInput(rateBody, current);
            const rateKey = `${rate.branch}|${rate.label}`;
            assert(!seenRates.has(rateKey), `la ligne « ${rate.label} » figure deux fois pour la même branche.`);
            seenRates.add(rateKey);
            if (!current) {
              if (!hasOwn(rateBody, 'sort')) rate.sort = rIndex;
              ratePlans.push({ action: 'create', rate, changed: [] });
              return;
            }
            matched.add(current.id);
            const changed = changedRateFields(current, rate);
            const flags = {
              reactivated: !current.active && rate.active === 1,
              inactive_kept: !current.active && rate.active === 0,
            };
            if (!changed.length) {
              ratePlans.push({ action: 'unchanged', id: current.id, rate, changed, ...flags });
            } else if (changed.some((f) => RATE_FINANCIAL_FIELDS.includes(f)) && rateUsageCount(current.id) > 0) {
              ratePlans.push({ action: 'replace', id: current.id, rate, changed, ...flags });
            } else {
              ratePlans.push({ action: 'update', id: current.id, rate, changed, ...flags });
            }
          } catch (err) {
            if (err instanceof ValidationError) {
              throw new ValidationError(`ligne ${rIndex + 1}${rateLabel ? ` (${rateLabel})` : ''} : ${err.message}`);
            }
            throw err;
          }
        });
        if (existingConv) {
          absent.push(...db
            .prepare('SELECT id, branch, label FROM convention_rates WHERE convention_id = ? AND active = 1 ORDER BY sort, id')
            .all(existingConv.id)
            .filter((r) => !matched.has(r.id)));
        }
      }

      plan.conventions.push({
        companyKey: companyPlan.key,
        company_name: companyPlan.name,
        id: existingConv?.id ?? null,
        action: !existingConv ? 'create' : convChanged.length ? 'update' : 'unchanged',
        changed: convChanged,
        data: conv,
        rates_provided: ratesProvided,
        rates: ratePlans,
        retire: retire ? absent : [],
        kept: retire ? [] : absent,
      });
    } catch (err) {
      if (err instanceof ValidationError) throw new ValidationError(`${where} — ${err.message}`);
      throw err;
    }
  });

  // Compagnies existantes : seuls les champs fournis qui changent sont
  // écrits ; une compagnie inactive n'est réactivée que si l'une de ses
  // conventions du fichier est signée et en vigueur. Une compagnie créée
  // n'est active qu'à la même condition.
  const signedKeys = new Set(plan.conventions
    .filter((c) => c.data.status === 'signee' && (!c.data.end_date || c.data.end_date >= today))
    .map((c) => c.companyKey));
  for (const entry of plan.companies) {
    if (entry.id == null) {
      entry.create_active = signedKeys.has(entry.key);
      continue;
    }
    entry.changed = Object.keys(entry.changes).filter((f) => (entry.existing[f] ?? null) !== entry.changes[f]);
    entry.reactivate = !entry.existing.active && signedKeys.has(entry.key);
    entry.inactive_kept = !entry.existing.active && !entry.reactivate;
    entry.action = entry.changed.length || entry.reactivate ? 'update' : 'unchanged';
  }

  // Désactivation des compagnies sans convention dans le fichier — jamais
  // celle d'une compagnie qui a une convention signée et en vigueur dans le
  // CRM (saisie à la main, par exemple).
  if (deactivate) {
    const inFile = new Set(plan.companies.filter((c) => c.id != null).map((c) => c.id));
    const withSignedConvention = new Set(
      db.prepare(`SELECT DISTINCT cv.company_id AS id FROM conventions cv WHERE cv.status = 'signee' AND ${IN_FORCE_SQL}`)
        .all(today).map((r) => r.id)
    );
    for (const co of companies) {
      if (!co.active || inFile.has(co.id)) continue;
      if (withSignedConvention.has(co.id)) plan.deactivate_skipped.push({ id: co.id, name: co.name });
      else plan.deactivate.push({ id: co.id, name: co.name });
    }
  }

  const allRates = plan.conventions.flatMap((c) => c.rates);
  const count = (list, predicate) => list.filter(predicate).length;
  plan.summary = {
    companies_created: count(plan.companies, (c) => c.action === 'create'),
    companies_updated: count(plan.companies, (c) => c.id != null && c.changed.length > 0),
    companies_reactivated: count(plan.companies, (c) => c.reactivate),
    companies_deactivated: plan.deactivate.length,
    conventions_created: count(plan.conventions, (c) => c.action === 'create'),
    conventions_updated: count(plan.conventions, (c) => c.action === 'update'),
    conventions_unchanged: count(plan.conventions, (c) => c.action === 'unchanged'),
    rates_created: count(allRates, (r) => r.action === 'create'),
    rates_updated: count(allRates, (r) => r.action === 'update'),
    rates_unchanged: count(allRates, (r) => r.action === 'unchanged'),
    rates_replaced: count(allRates, (r) => r.action === 'replace'),
    rates_reactivated: count(allRates, (r) => r.reactivated),
    rates_retired: plan.conventions.reduce((n, c) => n + c.retire.length, 0),
    rates_kept: plan.conventions.reduce((n, c) => n + c.kept.length, 0),
  };
  return plan;
}

function insertRate(conventionId, rate) {
  const fields = Object.keys(rate);
  return db
    .prepare(`INSERT INTO convention_rates (convention_id, ${fields.join(', ')}) VALUES (?, ${fields.map(() => '?').join(', ')})`)
    .run(conventionId, ...fields.map((f) => rate[f])).lastInsertRowid;
}

function updateRate(rateId, rate, fields) {
  if (!fields.length) return;
  db.prepare(`UPDATE convention_rates SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...fields.map((f) => rate[f]), rateId);
}

function deactivateRate(rateId) {
  db.prepare("UPDATE convention_rates SET active = 0, updated_at = datetime('now') WHERE id = ?").run(rateId);
}

// Applique un plan construit par planImport, dans une seule transaction.
// Retourne { summary, events } : `events` alimente le journal d'audit, une
// entrée par compagnie ou convention touchée — sans aucun montant.
export function applyImport(plan) {
  return db.transaction(() => {
    const events = [];
    const companyIds = new Map();
    for (const c of plan.companies) {
      if (c.action === 'create') {
        const fields = ['name', ...Object.keys(c.changes)];
        const values = [c.name, ...Object.keys(c.changes).map((f) => c.changes[f])];
        const id = db
          .prepare(`INSERT INTO companies (${fields.join(', ')}, active) VALUES (${fields.map(() => '?').join(', ')}, ?)`)
          .run(...values, c.create_active ? 1 : 0).lastInsertRowid;
        companyIds.set(c.key, id);
        events.push({ action: 'import — création compagnie', entity: 'company', id, details: `${c.name}${c.create_active ? '' : ' (inactive)'}` });
        continue;
      }
      companyIds.set(c.key, c.id);
      if (c.changed.length) {
        db.prepare(`UPDATE companies SET ${c.changed.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`)
          .run(...c.changed.map((f) => c.changes[f]), c.id);
      }
      if (c.reactivate) db.prepare('UPDATE companies SET active = 1 WHERE id = ?').run(c.id);
      if (c.changed.length || c.reactivate) {
        const details = [c.changed.length ? `champs : ${c.changed.join(', ')}` : null, c.reactivate ? 'réactivée' : null];
        events.push({ action: 'import — mise à jour compagnie', entity: 'company', id: c.id, details: details.filter(Boolean).join(' ; ') });
      }
    }

    for (const conv of plan.conventions) {
      const data = { ...conv.data, company_id: companyIds.get(conv.companyKey) };
      let convId = conv.id;
      if (conv.action === 'create') {
        const fields = Object.keys(data);
        convId = db
          .prepare(`INSERT INTO conventions (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`)
          .run(...fields.map((f) => data[f])).lastInsertRowid;
      } else if (conv.action === 'update') {
        db.prepare(`UPDATE conventions SET ${conv.changed.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
          .run(...conv.changed.map((f) => data[f]), convId);
      }
      const tally = { create: 0, update: 0, replace: 0 };
      for (const r of conv.rates) {
        if (r.action === 'create') insertRate(convId, r.rate);
        else if (r.action === 'update') updateRate(r.id, r.rate, r.changed);
        else if (r.action === 'replace') {
          deactivateRate(r.id);
          insertRate(convId, r.rate);
        }
        if (r.action in tally) tally[r.action] += 1;
      }
      for (const old of conv.retire) deactivateRate(old.id);

      const parts = [];
      if (conv.action === 'create') parts.push('créée');
      if (conv.action === 'update') parts.push(`champs : ${conv.changed.join(', ')}`);
      if (tally.create) parts.push(`${tally.create} ligne(s) créée(s)`);
      if (tally.update) parts.push(`${tally.update} ligne(s) mise(s) à jour`);
      if (tally.replace) parts.push(`${tally.replace} ligne(s) remplacée(s)`);
      if (conv.retire.length) parts.push(`${conv.retire.length} ligne(s) désactivée(s)`);
      if (parts.length) {
        events.push({
          action: conv.action === 'create' ? 'import — création convention' : 'import — mise à jour convention',
          entity: 'convention',
          id: convId,
          details: `${data.title} — ${parts.join(', ')}`,
        });
      }
    }

    for (const co of plan.deactivate) {
      db.prepare('UPDATE companies SET active = 0 WHERE id = ?').run(co.id);
      events.push({ action: 'import — désactivation compagnie', entity: 'company', id: co.id, details: co.name });
    }
    return { summary: plan.summary, events };
  })();
}

// Résumé lisible d'un plan (renvoyé tel quel par l'API, aperçu ou résultat).
// Noms de champs seulement : jamais de montant.
export function describePlan(plan) {
  return {
    summary: plan.summary,
    options: plan.options,
    companies: plan.companies.map((c) => ({
      name: c.name,
      action: c.action,
      changed: c.changed,
      reactivate: Boolean(c.reactivate),
      created_inactive: c.id == null && !c.create_active,
      homonyms: c.homonyms,
      inactive_kept: Boolean(c.inactive_kept),
    })),
    conventions: plan.conventions.map((c) => ({
      company: c.company_name,
      title: c.data.title,
      status: c.data.status,
      action: c.action,
      changed: c.changed,
      rates_provided: c.rates_provided,
      rates: c.rates.map((r) => ({
        label: r.rate.label,
        branch: r.rate.branch,
        action: r.action,
        changed: r.changed,
        reactivated: Boolean(r.reactivated),
        inactive_kept: Boolean(r.inactive_kept),
      })),
      retired: c.retire.map((r) => r.label),
      kept: c.kept.map((r) => r.label),
    })),
    deactivate: plan.deactivate.map((c) => c.name),
    deactivate_skipped: plan.deactivate_skipped.map((c) => c.name),
  };
}
