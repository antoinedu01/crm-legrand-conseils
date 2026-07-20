import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toRequiredInteger,
  toOptionalInteger,
  toRequiredDecimal,
  toOptionalDecimal,
  NumberConversionError,
} from '../client/src/components/contracts/numberConversion.js';

test('toRequiredInteger — chaîne entière valide devient un véritable number entier', () => {
  const result = toRequiredInteger('300');
  assert.equal(typeof result, 'number');
  assert.equal(result, 300);
  assert.equal(Number.isInteger(result), true);
});

test('toRequiredInteger — rejette une chaîne vide', () => {
  assert.throws(() => toRequiredInteger(''), NumberConversionError);
});

test('toRequiredInteger — rejette un texte non numérique', () => {
  assert.throws(() => toRequiredInteger('abc'), NumberConversionError);
});

test('toRequiredInteger — rejette une décimale', () => {
  assert.throws(() => toRequiredInteger('5.5'), NumberConversionError);
});

test('toRequiredInteger — rejette Infinity / NaN', () => {
  assert.throws(() => toRequiredInteger('Infinity'), NumberConversionError);
  assert.throws(() => toRequiredInteger(NaN), NumberConversionError);
});

test('toRequiredInteger — rejette une valeur négative si nonNegative est demandé', () => {
  assert.throws(() => toRequiredInteger('-5', { nonNegative: true }), NumberConversionError);
});

test('toRequiredInteger — accepte une valeur négative si nonNegative n’est pas demandé', () => {
  assert.equal(toRequiredInteger('-5'), -5);
});

test('toRequiredInteger — rejette un booléen', () => {
  assert.throws(() => toRequiredInteger(true), NumberConversionError);
  assert.throws(() => toRequiredInteger(false), NumberConversionError);
});

test('toRequiredInteger — rejette un objet', () => {
  assert.throws(() => toRequiredInteger({}), NumberConversionError);
});

test('toRequiredInteger — rejette un tableau', () => {
  assert.throws(() => toRequiredInteger([1]), NumberConversionError);
});

test('toRequiredInteger — accepte un number entier déjà réel', () => {
  assert.equal(toRequiredInteger(42), 42);
});

test('toOptionalInteger — chaîne vide renvoie undefined (absence), jamais null implicite', () => {
  assert.equal(toOptionalInteger(''), undefined);
  assert.equal(toOptionalInteger(null), undefined);
  assert.equal(toOptionalInteger(undefined), undefined);
});

test('toOptionalInteger — chaîne entière valide devient un véritable number', () => {
  const result = toOptionalInteger('12');
  assert.equal(typeof result, 'number');
  assert.equal(result, 12);
});

test('toOptionalInteger — rejette une décimale, un texte, un booléen, un objet, un tableau', () => {
  assert.throws(() => toOptionalInteger('5.5'), NumberConversionError);
  assert.throws(() => toOptionalInteger('abc'), NumberConversionError);
  assert.throws(() => toOptionalInteger(true), NumberConversionError);
  assert.throws(() => toOptionalInteger({}), NumberConversionError);
  assert.throws(() => toOptionalInteger([1]), NumberConversionError);
});

test('toOptionalInteger — rejette une valeur négative si nonNegative est demandé', () => {
  assert.throws(() => toOptionalInteger('-1', { nonNegative: true }), NumberConversionError);
});

test('toRequiredDecimal — chaîne décimale valide devient un véritable number', () => {
  const result = toRequiredDecimal('300.5');
  assert.equal(typeof result, 'number');
  assert.equal(result, 300.5);
});

test('toRequiredDecimal — accepte aussi un entier', () => {
  assert.equal(toRequiredDecimal('300'), 300);
});

test('toRequiredDecimal — rejette une chaîne vide, un texte non numérique, une valeur non finie', () => {
  assert.throws(() => toRequiredDecimal(''), NumberConversionError);
  assert.throws(() => toRequiredDecimal('abc'), NumberConversionError);
  assert.throws(() => toRequiredDecimal('Infinity'), NumberConversionError);
  assert.throws(() => toRequiredDecimal(NaN), NumberConversionError);
});

test('toRequiredDecimal — rejette une valeur négative si nonNegative est demandé', () => {
  assert.throws(() => toRequiredDecimal('-1.5', { nonNegative: true }), NumberConversionError);
});

test('toRequiredDecimal — rejette booléens, objets, tableaux', () => {
  assert.throws(() => toRequiredDecimal(true), NumberConversionError);
  assert.throws(() => toRequiredDecimal({}), NumberConversionError);
  assert.throws(() => toRequiredDecimal([1]), NumberConversionError);
});

test('toOptionalDecimal — chaîne vide renvoie undefined (absence)', () => {
  assert.equal(toOptionalDecimal(''), undefined);
  assert.equal(toOptionalDecimal(null), undefined);
  assert.equal(toOptionalDecimal(undefined), undefined);
});

test('toOptionalDecimal — chaîne décimale valide devient un véritable number', () => {
  const result = toOptionalDecimal('12.75');
  assert.equal(typeof result, 'number');
  assert.equal(result, 12.75);
});

test('toOptionalDecimal — rejette texte, booléen, objet, tableau, valeur non finie', () => {
  assert.throws(() => toOptionalDecimal('abc'), NumberConversionError);
  assert.throws(() => toOptionalDecimal(true), NumberConversionError);
  assert.throws(() => toOptionalDecimal({}), NumberConversionError);
  assert.throws(() => toOptionalDecimal([1]), NumberConversionError);
  assert.throws(() => toOptionalDecimal(Infinity), NumberConversionError);
});

test('toOptionalDecimal — rejette une valeur négative si nonNegative est demandé', () => {
  assert.throws(() => toOptionalDecimal('-0.5', { nonNegative: true }), NumberConversionError);
});
