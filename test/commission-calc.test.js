import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIFE_COMMISSION_BRANCHES,
  FIXED_ONLY_BRANCHES,
  COMMISSION_MODES,
  CommissionCalcError,
  computeAcquisitionCommission,
  defaultCommissionModeForBranch,
  assertCommissionModeAllowed,
} from '../server/commissionCalc.js';

const BASE = {
  branch: 'vie_3a', annual_premium: 6000, payment_frequency: 'annuelle',
  acq_commission_rate: 4, policy_term_years: 20,
};

test('Vie 3a — prime annuelle 6000, durée 20, taux 4 -> commission 4800', () => {
  assert.equal(computeAcquisitionCommission(BASE), 4800);
});

test('Vie 3b — même formule que Vie 3a', () => {
  assert.equal(computeAcquisitionCommission({ ...BASE, branch: 'vie_3b' }), 4800);
});

test('Vie mensuelle — aucun facteur 12 supplémentaire (annual_premium reste la prime annuelle)', () => {
  assert.equal(computeAcquisitionCommission({ ...BASE, payment_frequency: 'mensuelle' }), 4800);
});

test('Vie trimestrielle — aucun facteur 4 supplémentaire', () => {
  assert.equal(computeAcquisitionCommission({ ...BASE, payment_frequency: 'trimestrielle' }), 4800);
});

test('Vie semestrielle — aucun facteur 2 supplémentaire', () => {
  assert.equal(computeAcquisitionCommission({ ...BASE, payment_frequency: 'semestrielle' }), 4800);
});

test('Vie annuelle — formule annuelle × durée', () => {
  assert.equal(computeAcquisitionCommission({ ...BASE, payment_frequency: 'annuelle' }), 4800);
});

test('Vie prime unique — prime × taux, sans durée (durée ignorée même absente ou invalide)', () => {
  assert.equal(computeAcquisitionCommission({ ...BASE, payment_frequency: 'unique', policy_term_years: null }), 240);
  assert.equal(computeAcquisitionCommission({ ...BASE, payment_frequency: 'unique', policy_term_years: undefined }), 240);
  assert.equal(computeAcquisitionCommission({ ...BASE, payment_frequency: 'unique', policy_term_years: -5 }), 240);
});

test('Vie prime unique — durée valide ET fournie simultanément reste ignorée (pas de multiplication par 20)', () => {
  assert.equal(computeAcquisitionCommission({ ...BASE, payment_frequency: 'unique', policy_term_years: 20 }), 240);
});

test('Vie périodique, taux positif, durée absente/invalide -> CommissionCalcError contrôlée', () => {
  assert.throws(() => computeAcquisitionCommission({ ...BASE, policy_term_years: null }), CommissionCalcError);
  assert.throws(() => computeAcquisitionCommission({ ...BASE, policy_term_years: undefined }), CommissionCalcError);
  assert.throws(() => computeAcquisitionCommission({ ...BASE, policy_term_years: '' }), CommissionCalcError);
  assert.throws(() => computeAcquisitionCommission({ ...BASE, policy_term_years: 0 }), CommissionCalcError);
  assert.throws(() => computeAcquisitionCommission({ ...BASE, policy_term_years: -3 }), CommissionCalcError);
  assert.throws(() => computeAcquisitionCommission({ ...BASE, policy_term_years: 5.5 }), CommissionCalcError);
});

test('CommissionCalcError — message contrôlé mentionnant la durée contractuelle', () => {
  try {
    computeAcquisitionCommission({ ...BASE, policy_term_years: null });
    assert.fail('devait lever CommissionCalcError');
  } catch (err) {
    assert.ok(err instanceof CommissionCalcError);
    assert.match(err.message, /durée contractuelle/i);
  }
});

test('Vie périodique, taux zéro, durée absente -> aucune commission, pas d’erreur', () => {
  assert.equal(computeAcquisitionCommission({ ...BASE, acq_commission_rate: 0, policy_term_years: null }), null);
});

test('Vie périodique, prime zéro, durée absente -> aucune commission, pas d’erreur', () => {
  assert.equal(computeAcquisitionCommission({ ...BASE, annual_premium: 0, policy_term_years: null }), null);
});

test('durée = 1 -> prime annuelle × taux (équivalent à une seule année)', () => {
  assert.equal(computeAcquisitionCommission({ ...BASE, policy_term_years: 1 }), 240);
});

test('montant décimal arrondi à deux décimales, une seule fois à la fin', () => {
  const input = { branch: 'vie_3a', annual_premium: 1999.999, payment_frequency: 'annuelle', acq_commission_rate: 3.333, policy_term_years: 7 };
  const amount = computeAcquisitionCommission(input);
  const expected = Math.round(1999.999 * 7 * 3.333) / 100;
  assert.equal(amount, expected);
  assert.equal(Number.isInteger(Math.round(amount * 100)), true);
});

test('LAMal — aucune commission automatique, quels que soient la prime, le taux ou policy_term_years (fix/fixed-health-commission-model)', () => {
  assert.equal(computeAcquisitionCommission({ branch: 'lamal', annual_premium: 3600, payment_frequency: 'mensuelle', acq_commission_rate: 5, policy_term_years: null }), null);
  assert.equal(computeAcquisitionCommission({ branch: 'lamal', annual_premium: 3600, payment_frequency: 'annuelle', acq_commission_rate: 5, policy_term_years: 99 }), null);
});

test('LCA — aucune commission automatique, quels que soient la prime ou le taux (fix/fixed-health-commission-model)', () => {
  assert.equal(computeAcquisitionCommission({ branch: 'lca', annual_premium: 900, payment_frequency: 'annuelle', acq_commission_rate: 5, policy_term_years: null }), null);
});

test('Incapacité — conserve la formule actuelle', () => {
  assert.equal(computeAcquisitionCommission({ branch: 'incapacite', annual_premium: 1500, payment_frequency: 'mensuelle', acq_commission_rate: 5, policy_term_years: null }), 75);
});

test('LPP/IJM — conserve la formule actuelle', () => {
  assert.equal(computeAcquisitionCommission({ branch: 'lpp', annual_premium: 2000, payment_frequency: 'annuelle', acq_commission_rate: 5, policy_term_years: null }), 100);
});

test('LIFE_COMMISSION_BRANCHES — exactement vie_3a et vie_3b', () => {
  assert.deepEqual(LIFE_COMMISSION_BRANCHES, ['vie_3a', 'vie_3b']);
});

test('taux ou prime absents (undefined) -> aucune commission, jamais une erreur de durée', () => {
  assert.equal(computeAcquisitionCommission({ branch: 'vie_3a', payment_frequency: 'annuelle', policy_term_years: null }), null);
  assert.equal(computeAcquisitionCommission({ branch: 'vie_3a', annual_premium: 6000, payment_frequency: 'annuelle', policy_term_years: null }), null);
});

// --- fix/fixed-health-commission-model : FIXED_ONLY_BRANCHES et modes ------

test('FIXED_ONLY_BRANCHES — exactement lamal et lca', () => {
  assert.deepEqual(FIXED_ONLY_BRANCHES, ['lamal', 'lca']);
});

test('COMMISSION_MODES — exactement fixed_amount, percentage, manual_adjustment', () => {
  assert.deepEqual(COMMISSION_MODES, ['fixed_amount', 'percentage', 'manual_adjustment']);
});

test('defaultCommissionModeForBranch — fixed_amount pour LAMal/LCA, percentage pour les autres branches', () => {
  assert.equal(defaultCommissionModeForBranch('lamal'), 'fixed_amount');
  assert.equal(defaultCommissionModeForBranch('lca'), 'fixed_amount');
  for (const branch of ['vie_3a', 'vie_3b', 'lpp', 'hypotheque', 'deces', 'incapacite', 'rc_menage', 'autre']) {
    assert.equal(defaultCommissionModeForBranch(branch), 'percentage', `branche ${branch}`);
  }
});

test('assertCommissionModeAllowed — refuse percentage pour LAMal/LCA, accepte fixed_amount/manual_adjustment', () => {
  assert.throws(() => assertCommissionModeAllowed('lamal', 'percentage'), CommissionCalcError);
  assert.throws(() => assertCommissionModeAllowed('lca', 'percentage'), CommissionCalcError);
  assert.doesNotThrow(() => assertCommissionModeAllowed('lamal', 'fixed_amount'));
  assert.doesNotThrow(() => assertCommissionModeAllowed('lamal', 'manual_adjustment'));
  assert.doesNotThrow(() => assertCommissionModeAllowed('lca', 'fixed_amount'));
});

test('assertCommissionModeAllowed — percentage reste autorisé pour toute branche hors LAMal/LCA', () => {
  for (const branch of ['vie_3a', 'vie_3b', 'lpp', 'hypotheque', 'deces', 'incapacite', 'rc_menage', 'autre']) {
    assert.doesNotThrow(() => assertCommissionModeAllowed(branch, 'percentage'), `branche ${branch}`);
  }
});

test('assertCommissionModeAllowed — message d’erreur explicite mentionnant l’absence de calcul fondé sur la prime', () => {
  try {
    assertCommissionModeAllowed('lamal', 'percentage');
    assert.fail('devait lever CommissionCalcError');
  } catch (err) {
    assert.ok(err instanceof CommissionCalcError);
    assert.match(err.message, /prime/i);
  }
});
