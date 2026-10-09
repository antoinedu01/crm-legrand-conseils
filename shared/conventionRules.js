// Règles des conventions de courtage — module PUR, partagé tel quel par le
// serveur (routes contrats, conventions, commissions) et par l'interface
// (formulaire de contrat, page Conventions, formulaire de reprise). Une seule
// source de vérité : aucun « miroir » à resynchroniser à la main.
//
// Ce fichier ne contient AUCUNE donnée de convention réelle. Les barèmes
// négociés avec les compagnies sont confidentiels (clauses de
// confidentialité des conventions) : ils vivent uniquement dans la base du
// CRM, jamais dans le dépôt — voir docs/CONVENTIONS.md.
//
// Toutes les dates sont des chaînes ISO AAAA-MM-JJ, calculées en UTC.

export const CONVENTION_STATUSES = ['signee', 'en_attente', 'resiliee'];

// Qui suit le client une fois le contrat conclu, selon la convention.
export const CLIENT_FOLLOWUP_VALUES = ['compagnie', 'intermediaire', 'non_precise'];

// Base de calcul de la commission d'acquisition d'une ligne de barème.
//  - fixe               : montant en CHF par contrat (`value`)
//  - mois_prime         : `value` × prime mensuelle (prime annuelle / 12)
//  - pct_prime_annuelle : `value` % de la prime annuelle, × années entières
//                         de durée si `multiply_by_years`
//  - pct_production     : `value` % de la « production » = prime annuelle ×
//                         durée de paiement (plafonnée à `max_years`) ×
//                         `valuation_pct` % — ou prime unique × valuation_pct %
//  - aucune             : la convention ne prévoit aucune commission
//                         d'acquisition pour ce produit
//  - a_confirmer        : barème connu en principe mais non chiffrable (pièce
//                         manquante) — jamais de montant inventé
export const RATE_BASES = ['fixe', 'mois_prime', 'pct_prime_annuelle', 'pct_production', 'aucune', 'a_confirmer'];

// Reprise (extourne) de commission en cas de fin anticipée du contrat.
//  - paliers : `clawback_steps` = [{ months, pct }] par durée croissante —
//              « si la couverture a duré au plus `months` mois, `pct` % de la
//              commission est repris » ; au-delà du dernier palier : 0 %
//  - prorata : reprise linéaire sur `clawback_months` mois (100 % au début,
//              0 % à l'échéance de la période)
//  - aucun   : la convention ne prévoit aucune reprise
//  - inconnu : règle non fournie — aucune estimation
export const CLAWBACK_MODES = ['paliers', 'prorata', 'aucun', 'inconnu'];

export const MAX_CLAWBACK_STEPS = 12;
export const MAX_CLAWBACK_MONTHS = 240;

// ---------------------------------------------------------------- dates --

export function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

export function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

// Date du jour (AAAA-MM-JJ) dans le fuseau du cabinet — et non en UTC, qui
// donnerait encore « hier » entre minuit et 1 h/2 h en Suisse.
export function localIsoDate(now = new Date(), timeZone = 'Europe/Zurich') {
  const parts = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)) {
    parts[type] = value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

// Ajoute `months` mois à une date, en ramenant le jour au dernier jour du
// mois si nécessaire (31 janvier + 1 mois = 28/29 février). Toujours calculé
// depuis la date d'origine, jamais par ajouts successifs.
export function addMonths(date, months) {
  const total = date.getUTCMonth() + months;
  const year = date.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const day = Math.min(date.getUTCDate(), daysInMonth(year, month));
  return new Date(Date.UTC(year, month, day));
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

// Nombre de mois (fractionnaire) entre `start` et `endExclusive` : mois
// entiers, plus la part du mois entamé. 0 si `endExclusive` <= `start`.
export function monthsBetween(start, endExclusive) {
  if (endExclusive <= start) return 0;
  let whole = (endExclusive.getUTCFullYear() - start.getUTCFullYear()) * 12
    + (endExclusive.getUTCMonth() - start.getUTCMonth());
  while (whole > 0 && addMonths(start, whole) > endExclusive) whole -= 1;
  while (addMonths(start, whole + 1) <= endExclusive) whole += 1;
  const from = addMonths(start, whole);
  const to = addMonths(start, whole + 1);
  return whole + (endExclusive - from) / (to - from);
}

// Années entières de couverture entre la date de début et la date
// d'échéance — dernier jour couvert INCLUS : du 01.10.2026 au 30.09.2029
// = 3 ans. null si une date manque, est invalide, ou si moins d'un an.
export function wholeYearsCovered(startIso, endIso) {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (!start || !end || end < start) return null;
  const months = Math.floor(monthsBetween(start, addDays(end, 1)) + 1e-9);
  const years = Math.floor(months / 12);
  return years > 0 ? years : null;
}

// ------------------------------------------------------------ montants --

// Arrondi au centime, robuste aux erreurs binaires (1.005 → 1.01).
export function roundChf(x) {
  return Math.round(Number((x * 100).toPrecision(15))) / 100;
}

// « CHF 1'576.00 » — formatage suisse identique côté Node et navigateur,
// sans dépendre des données de localisation (Intl) de l'environnement.
export function formatChf(x) {
  const n = roundChf(Number(x) || 0);
  const sign = n < 0 ? '-' : '';
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  return `CHF ${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, '’')}.${dec}`;
}

function formatNumber(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x);
  return String(Math.round(n * 1000) / 1000).replace('.', ',');
}

function premiumTermYears(ctx) {
  const term = Number(ctx.policy_term_years);
  if (Number.isInteger(term) && term > 0) return term;
  return wholeYearsCovered(ctx.start_date, ctx.end_date);
}

// Commission d'acquisition estimée selon une ligne de barème.
// Retourne { amount, formula, missing } :
//  - amount  : montant en CHF arrondi au centime, ou null si aucune
//              commission n'est calculable/prévue ;
//  - formula : explication lisible du calcul (affichée telle quelle) ;
//  - missing : donnée manquante qui empêche le calcul, sinon null.
// Ne lève jamais d'exception : une donnée absente n'est jamais remplacée par
// une valeur inventée.
export function computeConventionCommission(rate, ctx = {}) {
  const basis = rate?.basis;
  const value = Number(rate?.value);
  const premium = Number(ctx.annual_premium) || 0;
  const done = (amount, formula, missing = null) => ({ amount, formula, missing });

  if (basis === 'aucune') return done(null, 'Aucune commission d’acquisition prévue par la convention.');
  if (basis === 'a_confirmer' || !RATE_BASES.includes(basis)) {
    return done(null, 'Barème à confirmer : aucune estimation possible.', 'barème');
  }
  if (!Number.isFinite(value) || value < 0) return done(null, 'Valeur du barème manquante.', 'valeur du barème');

  let amount;
  let formula;
  if (basis === 'fixe') {
    amount = value;
    formula = `${formatChf(value)} par contrat`;
  } else {
    if (!(premium > 0)) return done(null, 'Prime annuelle nécessaire pour estimer la commission.', 'prime annuelle');
    // Une base exprimée en primes mensuelles ou par année de contrat n'a pas
    // de sens pour une prime unique : jamais de montant approximatif.
    const isSingle = ctx.payment_frequency === 'unique';
    if (isSingle && (basis === 'mois_prime' || (basis === 'pct_prime_annuelle' && rate.multiply_by_years))) {
      return done(null, 'Cette ligne de barème s’applique à une prime périodique, pas à une prime unique.', 'prime périodique');
    }
    if (basis === 'mois_prime') {
      amount = (premium / 12) * value;
      formula = `${formatNumber(value)} × prime mensuelle (${formatChf(premium / 12)})`;
    } else if (basis === 'pct_prime_annuelle') {
      let years = 1;
      if (rate.multiply_by_years) {
        years = premiumTermYears(ctx);
        if (!years) {
          return done(null, 'Durée du contrat (début et échéance) nécessaire : le taux s’applique par année entière.', 'durée du contrat');
        }
      }
      amount = (premium * value * years) / 100;
      formula = rate.multiply_by_years
        ? `${formatNumber(value)} % × ${years} an${years > 1 ? 's' : ''} × prime annuelle (${formatChf(premium)})`
        : `${formatNumber(value)} % × prime annuelle (${formatChf(premium)})`;
    } else {
      // pct_production
      const valuation = rate.valuation_pct == null ? 100 : Number(rate.valuation_pct);
      let production;
      let detail;
      if (ctx.payment_frequency === 'unique') {
        production = (premium * valuation) / 100;
        detail = `prime unique ${formatChf(premium)}${valuation !== 100 ? ` × ${formatNumber(valuation)} %` : ''}`;
      } else {
        const term = premiumTermYears(ctx);
        if (!term) {
          return done(null, 'Durée de paiement des primes nécessaire pour estimer la commission.', 'durée contractuelle');
        }
        const maxYears = Number(rate.max_years);
        const years = Number.isInteger(maxYears) && maxYears > 0 ? Math.min(term, maxYears) : term;
        production = (premium * years * valuation) / 100;
        detail = `${formatChf(premium)} × ${years} an${years > 1 ? 's' : ''}`
          + `${years < term ? ` (plafond ${maxYears} ans)` : ''}`
          + `${valuation !== 100 ? ` × ${formatNumber(valuation)} %` : ''}`;
      }
      amount = (production * value) / 100;
      formula = `${formatNumber(value)} % × production ${formatChf(production)} (${detail})`;
    }
  }

  const cap = rate.cap_chf == null ? null : Number(rate.cap_chf);
  if (cap != null && Number.isFinite(cap) && cap >= 0 && amount > cap) {
    amount = cap;
    formula += `, plafonnée à ${formatChf(cap)}`;
  }
  return done(roundChf(amount), formula);
}

// ------------------------------------------------------------- reprises --

// Valide et normalise des paliers de reprise ; lève une Error lisible.
export function normalizeClawbackSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('Les paliers de reprise doivent former une liste non vide.');
  }
  if (steps.length > MAX_CLAWBACK_STEPS) {
    throw new Error(`Au plus ${MAX_CLAWBACK_STEPS} paliers de reprise.`);
  }
  let previous = 0;
  return steps.map((step) => {
    const months = step?.months;
    const pct = step?.pct;
    if (!Number.isInteger(months) || months < 1 || months > MAX_CLAWBACK_MONTHS) {
      throw new Error(`Chaque palier doit indiquer une durée en mois entiers entre 1 et ${MAX_CLAWBACK_MONTHS}.`);
    }
    if (months <= previous) throw new Error('Les durées des paliers doivent être strictement croissantes.');
    if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new Error('Chaque palier doit indiquer un pourcentage repris entre 0 et 100.');
    }
    previous = months;
    return { months, pct };
  });
}

export function parseClawbackSteps(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clawbackHorizonMonths(rate) {
  if (rate?.clawback_mode === 'paliers') {
    const steps = parseClawbackSteps(rate.clawback_steps);
    return steps.length ? steps[steps.length - 1].months : null;
  }
  if (rate?.clawback_mode === 'prorata') {
    const n = Number(rate.clawback_months);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

// Dernier jour de couverture qui déclenche encore une reprise (inclus), ou
// null si la règle est inconnue / sans reprise. Ex. paliers jusqu'à 24 mois
// pour un début au 01.01.2026 → 31.12.2027.
export function clawbackPeriodEnd(rate, startIso) {
  const start = parseIsoDate(startIso);
  const months = clawbackHorizonMonths(rate);
  if (!start || !months) return null;
  return toIsoDate(addDays(addMonths(start, months), -1));
}

// Part de la commission reprise si la couverture prend fin le
// `coverage_end` (dernier jour couvert, inclus).
// Retourne { pct, months, period_end, known, reason }.
export function clawbackPercent(rate, { start_date, coverage_end } = {}) {
  const mode = rate?.clawback_mode;
  if (mode === 'aucun') return { pct: 0, months: null, period_end: null, known: true, reason: null };
  if (!['paliers', 'prorata'].includes(mode)) {
    return { pct: null, months: null, period_end: null, known: false, reason: 'Règle de reprise non précisée par la convention.' };
  }
  const start = parseIsoDate(start_date);
  const end = parseIsoDate(coverage_end);
  if (!start) return { pct: null, months: null, period_end: null, known: false, reason: 'Date de début du contrat manquante.' };
  if (!end) return { pct: null, months: null, period_end: null, known: false, reason: 'Date de fin de couverture manquante.' };
  const terminationExclusive = addDays(end, 1);
  const months = Math.round(monthsBetween(start, terminationExclusive) * 100) / 100;
  const period_end = clawbackPeriodEnd(rate, start_date);

  if (mode === 'paliers') {
    const steps = parseClawbackSteps(rate.clawback_steps);
    if (!steps.length) return { pct: null, months, period_end, known: false, reason: 'Paliers de reprise manquants.' };
    for (const step of steps) {
      if (terminationExclusive <= addMonths(start, step.months)) {
        return { pct: step.pct, months, period_end, known: true, reason: null };
      }
    }
    return { pct: 0, months, period_end, known: true, reason: null };
  }

  const horizon = clawbackHorizonMonths(rate);
  if (!horizon) return { pct: null, months, period_end, known: false, reason: 'Durée de la période de reprise manquante.' };
  const remaining = Math.max(0, horizon - monthsBetween(start, terminationExclusive));
  return { pct: Math.round((remaining / horizon) * 10000) / 100, months, period_end, known: true, reason: null };
}

// ----------------------------------------------------------- libellés --

export function describeRate(rate) {
  const v = rate?.value;
  switch (rate?.basis) {
    case 'fixe': return `${formatChf(v)} par contrat`;
    case 'mois_prime': return `${formatNumber(v)} × prime mensuelle`;
    case 'pct_prime_annuelle':
      return `${formatNumber(v)} % de la prime annuelle${rate.multiply_by_years ? ' × années entières de durée' : ''}`;
    case 'pct_production': {
      const parts = [];
      if (rate.max_years) parts.push(`durée max. ${rate.max_years} ans`);
      if (rate.valuation_pct != null && Number(rate.valuation_pct) !== 100) parts.push(`valorisée à ${formatNumber(rate.valuation_pct)} %`);
      return `${formatNumber(v)} % de la production (prime × durée${parts.length ? `, ${parts.join(', ')}` : ''})`;
    }
    case 'aucune': return 'Aucune commission d’acquisition';
    case 'a_confirmer': return 'À confirmer';
    default: return '—';
  }
}

export function describeClawback(rate) {
  switch (rate?.clawback_mode) {
    case 'aucun': return 'Aucune reprise';
    case 'prorata': return `Au prorata sur ${rate.clawback_months} mois`;
    case 'paliers': {
      const steps = parseClawbackSteps(rate.clawback_steps);
      if (!steps.length) return 'Paliers non renseignés';
      return `${steps.map((s) => `${formatNumber(s.pct)} % jusqu’à ${s.months} mois`).join(', ')}, ensuite 0 %`;
    }
    default: return 'Non précisée';
  }
}
