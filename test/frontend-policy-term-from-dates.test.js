import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePolicyTermYears } from '../client/src/components/contracts/policyTermFromDates.js';

test('durée exacte en années pleines (anniversaire atteint)', () => {
  assert.equal(computePolicyTermYears('2026-01-01', '2036-01-01'), 10);
});

test('échéance avant l’anniversaire -> arrondi à l’année pleine inférieure', () => {
  assert.equal(computePolicyTermYears('2026-06-15', '2036-06-01'), 9);
});

test('échéance après l’anniversaire -> année pleine atteinte comptée', () => {
  assert.equal(computePolicyTermYears('2026-06-01', '2036-06-15'), 10);
});

test('une des deux dates manquante -> null', () => {
  assert.equal(computePolicyTermYears('', '2036-01-01'), null);
  assert.equal(computePolicyTermYears('2026-01-01', ''), null);
  assert.equal(computePolicyTermYears(null, null), null);
  assert.equal(computePolicyTermYears(undefined, undefined), null);
});

test('date invalide -> null (jamais une exception)', () => {
  assert.equal(computePolicyTermYears('pas-une-date', '2036-01-01'), null);
  assert.equal(computePolicyTermYears('2026-01-01', 'pas-une-date'), null);
});

test('échéance égale ou antérieure au début -> null (pas de durée négative ou nulle)', () => {
  assert.equal(computePolicyTermYears('2026-01-01', '2026-01-01'), null);
  assert.equal(computePolicyTermYears('2026-01-01', '2020-01-01'), null);
});

test('durée inférieure à un an -> null (pas de durée à 0 an)', () => {
  assert.equal(computePolicyTermYears('2026-01-01', '2026-06-01'), null);
});
