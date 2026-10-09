// Conventions de courtage : validation, lecture, résolution d'une ligne de
// barème pour un contrat et import d'un fichier de conventions.
//
// Les barèmes réels sont confidentiels (clauses de confidentialité des
// compagnies) : ce module ne contient aucune valeur de convention, il ne fait
// que lire et écrire ce que le courtier saisit ou importe dans SA base.
import db from './db.js';
import { assert, isDateStr, inEnum, checkTextFields, ValidationError } from './validate.js';
import { BRANCHES, BRANCH_LABELS } from './branches.js';
import {
  CONVENTION_STATUSES, CLIENT_FOLLOWUP_VALUES, RATE_BASES, CLAWBACK_MODES, MAX_CLAWBACK_MONTHS,
  normalizeClawbackSteps, parseClawbackSteps,
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

function pickPresent(body, fields) {
  const out = {};
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(body || {}, f)) out[f] = body[f] === '' ? null : body[f];
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

// --- Conventions ----------------------------------------------------------

// Valide une convention complète (création) ou fusionnée (mise à jour).
export function validateConvention(conv, { checkCompany = true } = {}) {
  if (checkCompany) {
    assert(Number.isInteger(Number(conv.company_id)) && Number(conv.company_id) > 0, 'La compagnie est requise.');
    assert(db.prepare('SELECT id FROM companies WHERE id = ?').get(conv.company_id), 'Compagnie introuvable.');
  }
  assert(typeof conv.title === 'string' && conv.title.trim().length > 0, 'Le titre de la convention est requis.');
  assert(inEnum(conv.status, CONVENTION_STATUSES), 'Statut de convention inconnu.');
  assert(inEnum(conv.client_followup, CLIENT_FOLLOWUP_VALUES), 'Valeur « suivi du client » inconnue.');
  for (const f of ['signed_date', 'effective_date', 'end_date']) {
    assert(isDateStr(conv[f]), `Date « ${f} » invalide (AAAA-MM-JJ).`);
  }
  optionalNumber(conv.statement_objection_days, 'statement_objection_days', { max: 365, integer: true });
  checkTextFields(conv, ['title', 'counterparty', 'intermediary_code', 'document_location'], 200);
  checkTextFields(conv, ['scope', 'termination_notice', 'payment_terms', 'obligations', 'restrictions', 'missing_documents', 'notes'], 5000);
}

export function normalizeConventionInput(body, existing = null, { checkCompany = true } = {}) {
  const data = pickPresent(body, CONVENTION_FIELDS);
  if (typeof data.title === 'string') data.title = data.title.trim();
  const merged = {
    status: 'signee',
    client_followup: 'non_precise',
    ...(existing || {}),
    ...data,
  };
  if (merged.status == null) merged.status = 'signee';
  if (merged.client_followup == null) merged.client_followup = 'non_precise';
  if (merged.company_id != null && merged.company_id !== '') merged.company_id = Number(merged.company_id);
  validateConvention(merged, { checkCompany });
  const out = {};
  for (const f of CONVENTION_FIELDS) out[f] = merged[f] ?? null;
  return out;
}

// --- Lignes de barème -----------------------------------------------------

// Valide et normalise une ligne (création, ou fusion avec la ligne existante
// pour une mise à jour). Retourne l'objet prêt à écrire (clawback_steps
// sérialisé en JSON).
export function normalizeRateInput(body, existing = null) {
  const data = pickPresent(body, RATE_FIELDS);
  const merged = { ...(existing || {}), ...data };
  if (typeof merged.label === 'string') merged.label = merged.label.trim();

  assert(BRANCHES.includes(merged.branch), 'Branche inconnue pour cette ligne de barème.');
  assert(typeof merged.label === 'string' && merged.label.length > 0, 'Le libellé de la ligne de barème est requis.');
  assert(RATE_BASES.includes(merged.basis), 'Base de calcul inconnue.');

  const value = optionalNumber(merged.value, 'value', { max: merged.basis === 'fixe' ? 100000 : merged.basis === 'mois_prime' ? 120 : 100 });
  if (COMPUTED_BASES.includes(merged.basis)) {
    assert(value != null, 'La valeur du barème est requise pour cette base de calcul.');
  }
  const multiply = toFlag(merged.multiply_by_years, 'multiply_by_years');
  assert(!multiply || merged.basis === 'pct_prime_annuelle', 'La multiplication par années ne s’applique qu’à un pourcentage de la prime annuelle.');
  const maxYears = optionalNumber(merged.max_years, 'max_years', { min: 1, max: 100, integer: true });
  const valuation = optionalNumber(merged.valuation_pct, 'valuation_pct', { min: 0.01, max: 500 });
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

  const sort = merged.sort == null ? 0 : merged.sort;
  assert(Number.isInteger(sort), 'L’ordre d’affichage doit être un entier.');

  const out = {
    branch: merged.branch,
    label: merged.label,
    insurer_entity: merged.insurer_entity ?? null,
    basis: merged.basis,
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
    active: merged.active == null ? 1 : toFlag(merged.active, 'active'),
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

export function rateUsageCount(rateId) {
  const contracts = db.prepare('SELECT COUNT(*) AS n FROM contracts WHERE convention_rate_id = ?').get(rateId).n;
  const commissions = db.prepare('SELECT COUNT(*) AS n FROM commissions WHERE convention_rate_id = ?').get(rateId).n;
  return contracts + commissions;
}

export function financialFieldsChanged(existing, next) {
  return RATE_FINANCIAL_FIELDS.filter((f) => {
    const a = existing[f] ?? null;
    const b = next[f] ?? null;
    if (f === 'clawback_steps') {
      return JSON.stringify(parseClawbackSteps(a)) !== JSON.stringify(parseClawbackSteps(b));
    }
    return a !== b;
  });
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

export function getRate(rateId) {
  const row = db.prepare('SELECT * FROM convention_rates WHERE id = ?').get(rateId);
  return row ? serializeRate(row) : null;
}

export function getConvention(id) {
  const conv = db
    .prepare(`SELECT cv.*, co.name AS company_name, co.active AS company_active
              FROM conventions cv JOIN companies co ON co.id = cv.company_id WHERE cv.id = ?`)
    .get(id);
  if (!conv) return null;
  return { ...conv, rates: listRatesOfConvention(conv.id) };
}

function listRatesOfConvention(conventionId) {
  return db
    .prepare(
      `SELECT r.*,
         (SELECT COUNT(*) FROM contracts ct WHERE ct.convention_rate_id = r.id) AS contracts_count
       FROM convention_rates r WHERE r.convention_id = ? ORDER BY r.active DESC, r.sort, r.id`
    )
    .all(conventionId)
    .map(serializeRate);
}

export function listConventions() {
  return db
    .prepare(
      `SELECT cv.*, co.name AS company_name, co.active AS company_active
       FROM conventions cv JOIN companies co ON co.id = cv.company_id
       ORDER BY CASE cv.status WHEN 'signee' THEN 0 WHEN 'en_attente' THEN 1 ELSE 2 END,
                co.name COLLATE NOCASE, cv.id`
    )
    .all()
    .map((conv) => ({ ...conv, rates: listRatesOfConvention(conv.id) }));
}

// Lignes applicables à un contrat (compagnie + branche). Par défaut :
// uniquement les lignes actives des conventions signées.
export function listApplicableRates({ company_id, branch, includeInactive = false }) {
  const rows = db
    .prepare(
      `SELECT r.*, cv.title AS convention_title, cv.status AS convention_status,
         cv.intermediary_code, cv.obligations, cv.restrictions, cv.client_followup, cv.missing_documents
       FROM convention_rates r JOIN conventions cv ON cv.id = r.convention_id
       WHERE cv.company_id = ? AND r.branch = ?
         AND (? = 1 OR (r.active = 1 AND cv.status = 'signee'))
       ORDER BY r.active DESC, r.sort, r.id`
    )
    .all(company_id, branch, includeInactive ? 1 : 0);
  return rows.map(serializeRate);
}

// Situation conventionnelle d'une compagnie pour une branche. `inUse` est
// faux tant qu'aucune convention n'a jamais été saisie dans le CRM : aucun
// avertissement n'est alors émis (rien ne permet de conclure à une absence).
export function conventionCoverage(company_id, branch) {
  const inUse = db.prepare('SELECT COUNT(*) AS n FROM conventions').get().n > 0;
  const signed = db
    .prepare("SELECT COUNT(*) AS n FROM conventions WHERE company_id = ? AND status = 'signee'")
    .get(company_id).n > 0;
  const covered = db
    .prepare(
      `SELECT COUNT(*) AS n FROM convention_rates r JOIN conventions cv ON cv.id = r.convention_id
       WHERE cv.company_id = ? AND cv.status = 'signee' AND r.branch = ? AND r.active = 1`
    )
    .get(company_id, branch).n > 0;
  return { inUse, signed, covered };
}

export function coverageWarning(company, branch) {
  const cov = conventionCoverage(company.id, branch);
  if (!cov.inUse || cov.covered) return null;
  const label = BRANCH_LABELS[branch] || branch;
  return cov.signed
    ? `La convention avec ${company.name} ne prévoit aucune ligne pour la branche « ${label} » : vérifiez que vous pouvez transmettre cette affaire.`
    : `Aucune convention de courtage signée avec ${company.name} : vérifiez votre droit de transmettre cette proposition.`;
}

// Vérifie qu'une ligne de barème peut être rattachée à un contrat de cette
// compagnie et de cette branche. `forCreation` impose en plus une ligne
// active d'une convention signée (à la modification, une ligne déjà liée et
// devenue inactive reste acceptée).
export function resolveRateForContract({ rateId, company_id, branch, forCreation = true }) {
  assert(Number.isInteger(Number(rateId)) && Number(rateId) > 0, 'Ligne de barème invalide.');
  const row = db
    .prepare(
      `SELECT r.*, cv.company_id, cv.status AS convention_status, cv.title AS convention_title
       FROM convention_rates r JOIN conventions cv ON cv.id = r.convention_id WHERE r.id = ?`
    )
    .get(rateId);
  assert(row, 'Ligne de barème introuvable.');
  assert(Number(row.company_id) === Number(company_id), 'Cette ligne de barème appartient à la convention d’une autre compagnie.');
  assert(row.branch === branch, 'Cette ligne de barème concerne une autre branche que celle du contrat.');
  if (forCreation) {
    assert(row.convention_status === 'signee', 'La convention de cette ligne n’est pas signée : choisissez une autre ligne.');
    assert(row.active === 1, 'Cette ligne de barème est désactivée : choisissez une ligne active.');
  }
  return serializeRate(row);
}

// --- Import -------------------------------------------------------------

export const IMPORT_FORMAT = 'crm-legrand-conventions';

function normName(value) {
  return String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

function findCompany(companies, spec) {
  const names = [spec.name, ...(Array.isArray(spec.aliases) ? spec.aliases : [])].map(normName).filter(Boolean);
  return companies.find((co) => names.includes(normName(co.name))) || null;
}

const COMPANY_IMPORT_FIELDS = ['contact_name', 'contact_email', 'contact_phone', 'finma_number', 'default_acq_rate', 'default_rec_rate'];

// Construit le plan d'import sans rien écrire. Lève une ValidationError
// (message préfixé par la convention et la ligne concernées) au premier
// problème : un fichier invalide n'est jamais appliqué partiellement.
export function planImport(data, { deactivateOthers } = {}) {
  assert(data && typeof data === 'object', 'Fichier d’import invalide.');
  assert(data.format === IMPORT_FORMAT, `Format de fichier inconnu (attendu : « ${IMPORT_FORMAT} »).`);
  assert(data.version === 1, 'Version de fichier non prise en charge (attendu : 1).');
  assert(Array.isArray(data.conventions) && data.conventions.length > 0 && data.conventions.length <= 50,
    'Le fichier doit contenir entre 1 et 50 conventions.');

  const companies = db.prepare('SELECT * FROM companies').all();
  const deactivate = deactivateOthers ?? Boolean(data.deactivate_companies_without_convention);
  const plan = { companies: [], conventions: [], deactivate: [], summary: {} };
  const companyKeyByName = new Map(); // nom normalisé → clé dans plan.companies
  const companyKeyById = new Map(); // id existant → clé dans plan.companies
  const seenConventions = new Set();

  data.conventions.forEach((item, index) => {
    const where = `Convention n° ${index + 1}${item?.company?.name ? ` (${item.company.name})` : ''}`;
    try {
      assert(item && typeof item === 'object', 'entrée invalide.');
      assert(item.company && typeof item.company.name === 'string' && item.company.name.trim(), 'nom de compagnie requis.');
      const spec = item.company;
      const companyChanges = {};
      for (const f of COMPANY_IMPORT_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(spec, f)) companyChanges[f] = spec[f] === '' ? null : spec[f];
      }
      for (const f of ['default_acq_rate', 'default_rec_rate']) {
        if (f in companyChanges) optionalNumber(companyChanges[f], f, { max: 100 });
      }
      assert(companyChanges.contact_email == null || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(companyChanges.contact_email),
        'adresse e-mail de contact invalide.');
      checkTextFields(companyChanges, ['contact_name', 'contact_phone', 'finma_number'], 200);

      // Une même compagnie peut porter plusieurs conventions dans le fichier :
      // elle n'apparaît qu'une fois dans le plan.
      const existing = findCompany(companies, spec);
      let companyKey = existing ? companyKeyById.get(existing.id) : companyKeyByName.get(normName(spec.name));
      if (companyKey == null) {
        companyKey = plan.companies.length;
        if (existing) {
          const changed = Object.keys(companyChanges).filter((f) => (existing[f] ?? null) !== companyChanges[f]);
          plan.companies.push({
            key: companyKey, id: existing.id, name: existing.name,
            action: changed.length || !existing.active ? 'update' : 'unchanged',
            reactivate: !existing.active, changes: companyChanges,
          });
          companyKeyById.set(existing.id, companyKey);
        } else {
          plan.companies.push({ key: companyKey, id: null, name: spec.name.trim(), action: 'create', changes: companyChanges });
          companyKeyByName.set(normName(spec.name), companyKey);
        }
      }
      const companyPlan = plan.companies[companyKey];

      const convBody = { ...item, company_id: companyPlan.id };
      delete convBody.company;
      delete convBody.rates;
      const conv = normalizeConventionInput(convBody, null, { checkCompany: false });
      const convKey = `${companyKey}|${conv.title}`;
      assert(!seenConventions.has(convKey), `la convention « ${conv.title} » figure deux fois pour cette compagnie.`);
      seenConventions.add(convKey);
      const existingConv = companyPlan.id
        ? db.prepare('SELECT * FROM conventions WHERE company_id = ? AND title = ?').get(companyPlan.id, conv.title)
        : null;

      const rates = Array.isArray(item.rates) ? item.rates : [];
      assert(rates.length <= 100, 'au plus 100 lignes de barème par convention.');
      const seenRates = new Set();
      const ratePlans = rates.map((rateBody, rIndex) => {
        let rate;
        try {
          rate = normalizeRateInput(rateBody);
        } catch (err) {
          throw new ValidationError(`ligne ${rIndex + 1}${rateBody?.label ? ` (${rateBody.label})` : ''} : ${err.message}`);
        }
        if (rateBody.sort == null) rate.sort = rIndex;
        const rateKey = `${rate.branch}|${rate.label}`;
        assert(!seenRates.has(rateKey), `la ligne « ${rate.label} » figure deux fois pour la même branche.`);
        seenRates.add(rateKey);
        if (!existingConv) return { action: 'create', rate };
        const current = db
          .prepare('SELECT * FROM convention_rates WHERE convention_id = ? AND branch = ? AND label = ? ORDER BY active DESC, id DESC LIMIT 1')
          .get(existingConv.id, rate.branch, rate.label);
        if (!current) return { action: 'create', rate };
        const changedFinancial = financialFieldsChanged(current, rate);
        if (changedFinancial.length && rateUsageCount(current.id) > 0) {
          return { action: 'replace', id: current.id, rate, changed: changedFinancial };
        }
        return { action: 'update', id: current.id, rate };
      });
      const keptIds = new Set(ratePlans.filter((p) => p.action === 'update').map((p) => p.id));
      const retired = existingConv
        ? db.prepare('SELECT id, label FROM convention_rates WHERE convention_id = ? AND active = 1').all(existingConv.id)
          .filter((r) => !keptIds.has(r.id) && !ratePlans.some((p) => p.action === 'replace' && p.id === r.id))
        : [];

      plan.conventions.push({
        companyKey,
        company_name: companyPlan.name,
        id: existingConv?.id ?? null,
        action: existingConv ? 'update' : 'create',
        data: conv,
        rates: ratePlans,
        retire: retired,
      });
    } catch (err) {
      if (err instanceof ValidationError) throw new ValidationError(`${where} — ${err.message}`);
      throw err;
    }
  });

  if (deactivate) {
    const kept = new Set(plan.companies.filter((c) => c.id != null).map((c) => c.id));
    plan.deactivate = companies
      .filter((co) => co.active && !kept.has(co.id))
      .map((co) => ({ id: co.id, name: co.name }));
  }

  const all = plan.conventions.flatMap((c) => c.rates);
  plan.summary = {
    companies_created: plan.companies.filter((c) => c.action === 'create').length,
    companies_updated: plan.companies.filter((c) => c.action === 'update').length,
    companies_deactivated: plan.deactivate.length,
    conventions_created: plan.conventions.filter((c) => c.action === 'create').length,
    conventions_updated: plan.conventions.filter((c) => c.action === 'update').length,
    rates_created: all.filter((r) => r.action === 'create').length,
    rates_updated: all.filter((r) => r.action === 'update').length,
    rates_replaced: all.filter((r) => r.action === 'replace').length,
    rates_retired: plan.conventions.reduce((n, c) => n + c.retire.length, 0),
  };
  return plan;
}

function insertRate(conventionId, rate) {
  const fields = Object.keys(rate);
  return db
    .prepare(`INSERT INTO convention_rates (convention_id, ${fields.join(', ')}) VALUES (?, ${fields.map(() => '?').join(', ')})`)
    .run(conventionId, ...fields.map((f) => rate[f])).lastInsertRowid;
}

function updateRate(rateId, rate) {
  const fields = Object.keys(rate);
  db.prepare(`UPDATE convention_rates SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...fields.map((f) => rate[f]), rateId);
}

// Applique un plan construit par planImport, dans une seule transaction.
export function applyImport(plan) {
  return db.transaction(() => {
    const companyIds = new Map();
    for (const c of plan.companies) {
      if (c.action === 'create') {
        const fields = ['name', ...Object.keys(c.changes)];
        const values = [c.name, ...Object.values(c.changes)];
        const id = db
          .prepare(`INSERT INTO companies (${fields.join(', ')}, active) VALUES (${fields.map(() => '?').join(', ')}, 1)`)
          .run(...values).lastInsertRowid;
        companyIds.set(c.key, id);
      } else {
        const sets = Object.keys(c.changes);
        if (sets.length) {
          db.prepare(`UPDATE companies SET ${sets.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`)
            .run(...Object.values(c.changes), c.id);
        }
        db.prepare('UPDATE companies SET active = 1 WHERE id = ?').run(c.id);
        companyIds.set(c.key, c.id);
      }
    }
    for (const conv of plan.conventions) {
      const companyId = companyIds.get(conv.companyKey);
      const data = { ...conv.data, company_id: companyId };
      let convId = conv.id;
      if (conv.action === 'create') {
        const fields = Object.keys(data);
        convId = db
          .prepare(`INSERT INTO conventions (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`)
          .run(...fields.map((f) => data[f])).lastInsertRowid;
      } else {
        const fields = Object.keys(data);
        db.prepare(`UPDATE conventions SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
          .run(...fields.map((f) => data[f]), convId);
      }
      for (const r of conv.rates) {
        if (r.action === 'create') insertRate(convId, r.rate);
        else if (r.action === 'update') updateRate(r.id, r.rate);
        else if (r.action === 'replace') {
          db.prepare("UPDATE convention_rates SET active = 0, updated_at = datetime('now') WHERE id = ?").run(r.id);
          insertRate(convId, r.rate);
        }
      }
      for (const old of conv.retire) {
        db.prepare("UPDATE convention_rates SET active = 0, updated_at = datetime('now') WHERE id = ?").run(old.id);
      }
    }
    for (const co of plan.deactivate) {
      db.prepare('UPDATE companies SET active = 0 WHERE id = ?').run(co.id);
    }
    return plan.summary;
  })();
}

// Résumé lisible d'un plan (renvoyé tel quel par l'API en mode aperçu).
export function describePlan(plan) {
  return {
    summary: plan.summary,
    companies: plan.companies.map((c) => ({ name: c.name, action: c.action, reactivate: Boolean(c.reactivate) })),
    conventions: plan.conventions.map((c) => ({
      company: c.company_name,
      title: c.data.title,
      status: c.data.status,
      action: c.action,
      rates: c.rates.map((r) => ({ label: r.rate.label, branch: r.rate.branch, action: r.action })),
      retired: c.retire.map((r) => r.label),
    })),
    deactivate: plan.deactivate.map((c) => c.name),
  };
}
