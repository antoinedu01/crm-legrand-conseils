import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIFE_COMMISSION_BRANCHES,
  LifeCommissionError,
  estimateLifeAcquisitionCommission,
} from '../client/src/components/contracts/lifeCommissionEstimate.js';
import { LIFE_COMPATIBLE_BRANCHES } from '../client/src/components/contracts/lifePayload.js';

const BASE = {
  branch: 'vie_3a', annual_premium: 6000, payment_frequency: 'annuelle',
  acq_commission_rate: 4, policy_term_years: 20,
};

test('LIFE_COMMISSION_BRANCHES — identique à LIFE_COMPATIBLE_BRANCHES (pas de liste dupliquée divergente)', () => {
  assert.deepEqual(LIFE_COMMISSION_BRANCHES, LIFE_COMPATIBLE_BRANCHES);
  assert.deepEqual(LIFE_COMMISSION_BRANCHES, ['vie_3a', 'vie_3b']);
});

test('estimation Vie périodique = prime annuelle × durée × taux', () => {
  assert.equal(estimateLifeAcquisitionCommission(BASE), 4800);
});

test('mensuelle, trimestrielle et semestrielle ne changent pas le volume annuel', () => {
  for (const payment_frequency of ['mensuelle', 'trimestrielle', 'semestrielle', 'annuelle']) {
    assert.equal(estimateLifeAcquisitionCommission({ ...BASE, payment_frequency }), 4800);
  }
});

test('prime unique ignore la durée', () => {
  assert.equal(estimateLifeAcquisitionCommission({ ...BASE, payment_frequency: 'unique', policy_term_years: null }), 240);
  assert.equal(estimateLifeAcquisitionCommission({ ...BASE, payment_frequency: 'unique', policy_term_years: undefined }), 240);
});

test('prime unique — durée valide ET fournie simultanément reste ignorée (pas de multiplication par 20)', () => {
  assert.equal(estimateLifeAcquisitionCommission({ ...BASE, payment_frequency: 'unique', policy_term_years: 20 }), 240);
});

test('durée absente (périodique) -> LifeCommissionError contrôlée, estimation indisponible', () => {
  assert.throws(() => estimateLifeAcquisitionCommission({ ...BASE, policy_term_years: null }), LifeCommissionError);
  assert.throws(() => estimateLifeAcquisitionCommission({ ...BASE, policy_term_years: '' }), LifeCommissionError);
  assert.throws(() => estimateLifeAcquisitionCommission({ ...BASE, policy_term_years: 0 }), LifeCommissionError);
});

test('message d’erreur mentionne explicitement la durée contractuelle', () => {
  try {
    estimateLifeAcquisitionCommission({ ...BASE, policy_term_years: null });
    assert.fail('devait lever LifeCommissionError');
  } catch (err) {
    assert.ok(err instanceof LifeCommissionError);
    assert.match(err.message, /durée contractuelle/i);
  }
});

test('taux absent ou zéro -> aucune commission inventée (pas d’erreur, résultat null)', () => {
  assert.equal(estimateLifeAcquisitionCommission({ ...BASE, acq_commission_rate: 0, policy_term_years: null }), null);
  assert.equal(estimateLifeAcquisitionCommission({ ...BASE, acq_commission_rate: undefined, policy_term_years: null }), null);
});

test('prime absente ou zéro -> aucune commission inventée', () => {
  assert.equal(estimateLifeAcquisitionCommission({ ...BASE, annual_premium: 0, policy_term_years: null }), null);
  assert.equal(estimateLifeAcquisitionCommission({ ...BASE, annual_premium: undefined, policy_term_years: null }), null);
});

test('branche incompatible -> null (l’aperçu générique existant reste seul responsable)', () => {
  assert.equal(estimateLifeAcquisitionCommission({ ...BASE, branch: 'lamal' }), null);
  assert.equal(estimateLifeAcquisitionCommission({ ...BASE, branch: 'lca' }), null);
  assert.equal(estimateLifeAcquisitionCommission({ ...BASE, branch: 'incapacite' }), null);
});

test('aucun taux codé en dur — le résultat varie strictement avec acq_commission_rate', () => {
  const a = estimateLifeAcquisitionCommission({ ...BASE, acq_commission_rate: 2 });
  const b = estimateLifeAcquisitionCommission({ ...BASE, acq_commission_rate: 7 });
  assert.notEqual(a, b);
  assert.equal(a, 2400); // 6000*20*2/100
  assert.equal(b, 8400); // 6000*20*7/100
});

test('aucun arrondi intermédiaire — un seul arrondi final à deux décimales', () => {
  const input = { branch: 'vie_3a', annual_premium: 1999.999, payment_frequency: 'annuelle', acq_commission_rate: 3.333, policy_term_years: 7 };
  const amount = estimateLifeAcquisitionCommission(input);
  const expected = Math.round(1999.999 * 7 * 3.333) / 100;
  assert.equal(amount, expected);
});

test('durée = 1 -> prime annuelle × taux', () => {
  assert.equal(estimateLifeAcquisitionCommission({ ...BASE, policy_term_years: 1 }), 240);
});

test('durée négative, décimale ou non entière (périodique) -> LifeCommissionError', () => {
  assert.throws(() => estimateLifeAcquisitionCommission({ ...BASE, policy_term_years: -1 }), LifeCommissionError);
  assert.throws(() => estimateLifeAcquisitionCommission({ ...BASE, policy_term_years: 5.5 }), LifeCommissionError);
});
