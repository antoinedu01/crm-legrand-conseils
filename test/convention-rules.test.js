// Règles pures des conventions de courtage (shared/conventionRules.js),
// partagées par le serveur et l'interface. Valeurs de barème FICTIVES : aucun
// taux réel de compagnie dans le dépôt (barèmes confidentiels).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RATE_BASES, CLAWBACK_MODES, computeConventionCommission, clawbackPercent, clawbackPeriodEnd,
  normalizeClawbackSteps, wholeYearsCovered, monthsBetween, addMonths, parseIsoDate, roundChf, formatChf,
  describeRate, describeClawback,
} from '../shared/conventionRules.js';

const d = parseIsoDate;

test('dates — addMonths ramène au dernier jour du mois, sans dérive', () => {
  assert.equal(addMonths(d('2026-01-31'), 1).toISOString().slice(0, 10), '2026-02-28');
  assert.equal(addMonths(d('2026-01-31'), 2).toISOString().slice(0, 10), '2026-03-31');
  assert.equal(addMonths(d('2028-01-31'), 1).toISOString().slice(0, 10), '2028-02-29');
  assert.equal(addMonths(d('2026-11-15'), 3).toISOString().slice(0, 10), '2027-02-15');
});

test('dates — parseIsoDate refuse les dates impossibles', () => {
  assert.equal(parseIsoDate('2026-02-30'), null);
  assert.equal(parseIsoDate('26-01-01'), null);
  assert.equal(parseIsoDate(null), null);
});

test('dates — monthsBetween compte les mois entiers et la part entamée', () => {
  assert.equal(monthsBetween(d('2026-01-01'), d('2027-01-01')), 12);
  assert.equal(monthsBetween(d('2026-01-01'), d('2025-12-01')), 0);
  const half = monthsBetween(d('2026-04-01'), d('2026-04-16'));
  assert.ok(half > 0.49 && half < 0.51);
});

test('dates — années entières de couverture, échéance incluse', () => {
  assert.equal(wholeYearsCovered('2026-10-01', '2029-09-30'), 3);
  assert.equal(wholeYearsCovered('2026-10-01', '2029-09-29'), 2);
  assert.equal(wholeYearsCovered('2026-10-01', '2027-09-29'), null);
  assert.equal(wholeYearsCovered('2026-10-01', null), null);
  assert.equal(wholeYearsCovered('2027-01-01', '2026-01-01'), null);
});

test('montants — arrondi au centime robuste et format suisse', () => {
  assert.equal(roundChf(1.005), 1.01);
  assert.equal(roundChf(131.3333333), 131.33);
  assert.equal(formatChf(1576), 'CHF 1’576.00');
  assert.equal(formatChf(1234567.891), 'CHF 1’234’567.89');
});

test('bases — liste fermée et attendue', () => {
  assert.deepEqual(RATE_BASES, ['fixe', 'mois_prime', 'pct_prime_annuelle', 'pct_production', 'aucune', 'a_confirmer']);
  assert.deepEqual(CLAWBACK_MODES, ['paliers', 'prorata', 'aucun', 'inconnu']);
});

test('commission — montant fixe par contrat, sans prime nécessaire', () => {
  const r = computeConventionCommission({ basis: 'fixe', value: 55 }, {});
  assert.equal(r.amount, 55);
  assert.equal(r.missing, null);
});

test('commission — N primes mensuelles', () => {
  const r = computeConventionCommission({ basis: 'mois_prime', value: 10 }, { annual_premium: 1200 });
  assert.equal(r.amount, 1000);
  assert.match(r.formula, /10 × prime mensuelle/);
});

test('commission — pourcentage de la prime annuelle, simple et × années entières', () => {
  assert.equal(computeConventionCommission({ basis: 'pct_prime_annuelle', value: 25 }, { annual_premium: 400 }).amount, 100);
  const multi = computeConventionCommission(
    { basis: 'pct_prime_annuelle', value: 8, multiply_by_years: true },
    { annual_premium: 500, start_date: '2026-10-01', end_date: '2029-09-30' }
  );
  assert.equal(multi.amount, 120);
  const missing = computeConventionCommission({ basis: 'pct_prime_annuelle', value: 8, multiply_by_years: true }, { annual_premium: 500 });
  assert.equal(missing.amount, null);
  assert.equal(missing.missing, 'durée du contrat');
});

test('commission — production : prime × durée plafonnée × valorisation', () => {
  const r = computeConventionCommission(
    { basis: 'pct_production', value: 3, max_years: 25, valuation_pct: 90 },
    { annual_premium: 2000, policy_term_years: 30 }
  );
  // 2000 × 25 × 90 % = 45'000 ; 3 % = 1'350
  assert.equal(r.amount, 1350);
  assert.match(r.formula, /plafond 25 ans/);
});

test('commission — production : durée déduite des dates si non fournie, prime unique sans durée', () => {
  const fromDates = computeConventionCommission(
    { basis: 'pct_production', value: 2 },
    { annual_premium: 1000, start_date: '2026-01-01', end_date: '2035-12-31' }
  );
  assert.equal(fromDates.amount, 200); // 1000 × 10 ans × 2 %
  const single = computeConventionCommission(
    { basis: 'pct_production', value: 2, valuation_pct: 50 },
    { annual_premium: 40000, payment_frequency: 'unique' }
  );
  assert.equal(single.amount, 400); // 40'000 × 50 % × 2 %
  const none = computeConventionCommission({ basis: 'pct_production', value: 2 }, { annual_premium: 1000 });
  assert.equal(none.amount, null);
  assert.equal(none.missing, 'durée contractuelle');
});

test('commission — plafond appliqué une seule fois', () => {
  const r = computeConventionCommission({ basis: 'mois_prime', value: 12, cap_chf: 500 }, { annual_premium: 1200 });
  assert.equal(r.amount, 500);
  assert.match(r.formula, /plafonnée/);
});

test('commission — jamais de montant inventé : barème à confirmer, aucune, prime absente', () => {
  assert.equal(computeConventionCommission({ basis: 'a_confirmer', value: 4 }, { annual_premium: 1000 }).amount, null);
  assert.equal(computeConventionCommission({ basis: 'a_confirmer' }, {}).missing, 'barème');
  const aucune = computeConventionCommission({ basis: 'aucune' }, { annual_premium: 1000 });
  assert.equal(aucune.amount, null);
  assert.equal(aucune.missing, null);
  assert.equal(computeConventionCommission({ basis: 'mois_prime', value: 12 }, {}).missing, 'prime annuelle');
  assert.equal(computeConventionCommission({ basis: 'inconnue', value: 1 }, {}).amount, null);
});

const PALIERS = { clawback_mode: 'paliers', clawback_steps: JSON.stringify([{ months: 12, pct: 100 }, { months: 24, pct: 50 }]) };

test('reprise — paliers : durée de couverture ≤ N mois, fin incluse', () => {
  const at = (coverage_end) => clawbackPercent(PALIERS, { start_date: '2026-01-01', coverage_end }).pct;
  assert.equal(at('2025-12-31'), 100, 'annulation avant le début');
  assert.equal(at('2026-12-31'), 100, '12 mois tout juste');
  assert.equal(at('2027-01-01'), 50, '12 mois et un jour');
  assert.equal(at('2027-12-31'), 50, '24 mois tout juste');
  assert.equal(at('2028-01-01'), 0, 'au-delà du dernier palier');
  assert.equal(clawbackPeriodEnd(PALIERS, '2026-01-01'), '2027-12-31');
});

test('reprise — paliers mensuels (primes mensuelles payées d’avance)', () => {
  const rate = { clawback_mode: 'paliers', clawback_steps: [{ months: 5, pct: 100 }, { months: 11, pct: 80 }] };
  const at = (coverage_end) => clawbackPercent(rate, { start_date: '2026-01-01', coverage_end }).pct;
  assert.equal(at('2026-05-31'), 100);
  assert.equal(at('2026-06-30'), 80);
  assert.equal(at('2026-06-15'), 80, 'un mois entamé compte comme une prime payée');
  assert.equal(at('2026-12-31'), 0);
});

test('reprise — prorata linéaire', () => {
  const rate = { clawback_mode: 'prorata', clawback_months: 36 };
  const at = (coverage_end) => clawbackPercent(rate, { start_date: '2026-01-01', coverage_end }).pct;
  assert.equal(at('2025-12-31'), 100);
  assert.equal(at('2026-12-31'), 66.67);
  assert.equal(at('2028-12-31'), 0);
  assert.equal(clawbackPeriodEnd(rate, '2026-01-01'), '2028-12-31');
});

test('reprise — aucune, inconnue, dates manquantes', () => {
  assert.equal(clawbackPercent({ clawback_mode: 'aucun' }, {}).pct, 0);
  const unknown = clawbackPercent({ clawback_mode: 'inconnu' }, { start_date: '2026-01-01', coverage_end: '2026-06-30' });
  assert.equal(unknown.pct, null);
  assert.equal(unknown.known, false);
  assert.equal(clawbackPercent(PALIERS, { coverage_end: '2026-06-30' }).pct, null);
  assert.equal(clawbackPercent(PALIERS, { start_date: '2026-01-01' }).pct, null);
  assert.equal(clawbackPeriodEnd({ clawback_mode: 'inconnu' }, '2026-01-01'), null);
});

test('reprise — validation des paliers', () => {
  assert.deepEqual(normalizeClawbackSteps([{ months: 12, pct: 100 }, { months: 24, pct: 50 }]), [{ months: 12, pct: 100 }, { months: 24, pct: 50 }]);
  assert.throws(() => normalizeClawbackSteps([]), /non vide/);
  assert.throws(() => normalizeClawbackSteps([{ months: 24, pct: 50 }, { months: 12, pct: 100 }]), /croissantes/);
  assert.throws(() => normalizeClawbackSteps([{ months: 12, pct: 120 }]), /entre 0 et 100/);
  assert.throws(() => normalizeClawbackSteps([{ months: 0, pct: 50 }]), /mois entiers/);
  assert.throws(() => normalizeClawbackSteps([{ months: 12.5, pct: 50 }]), /mois entiers/);
});

test('libellés — descriptions lisibles des barèmes et reprises', () => {
  assert.equal(describeRate({ basis: 'mois_prime', value: 12 }), '12 × prime mensuelle');
  assert.equal(describeRate({ basis: 'pct_prime_annuelle', value: 8, multiply_by_years: true }), '8 % de la prime annuelle × années entières de durée');
  assert.equal(describeRate({ basis: 'a_confirmer' }), 'À confirmer');
  assert.equal(describeClawback(PALIERS), '100 % jusqu’à 12 mois, 50 % jusqu’à 24 mois, ensuite 0 %');
  assert.equal(describeClawback({ clawback_mode: 'prorata', clawback_months: 36 }), 'Au prorata sur 36 mois');
  assert.equal(describeClawback({}), 'Non précisée');
});
