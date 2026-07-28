// Tests du moteur de détection souple de doublons (Legrand Diagnostic 360,
// Lot 2). Purement fonctionnel : aucune base de données, aucune dépendance
// externe. Couvre la normalisation et les quatre niveaux de correspondance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, normalizeDate, normalizePostal, classifyMatch, MATCH_LEVELS } from '../server/advisorySimilarity.js';

test('normalizeName — minuscules, accents, espaces, apostrophes, tirets', () => {
  assert.equal(normalizeName('Éric'), 'eric');
  assert.equal(normalizeName('  Müller  '), 'muller');
  assert.equal(normalizeName('François-Xavier'), 'francois xavier');
  assert.equal(normalizeName("D'Angelo"), 'd angelo');
  assert.equal(normalizeName("D’Angelo"), 'd angelo');
  assert.equal(normalizeName('Jean   Paul'), 'jean paul');
  assert.equal(normalizeName(null), null);
  assert.equal(normalizeName(''), null);
});

test('normalizeName — casse et accents ne créent jamais de faux négatif', () => {
  assert.equal(normalizeName('MOREAU'), normalizeName('moreau'));
  assert.equal(normalizeName(' Récamier'), normalizeName('recamier'));
});

test('normalizeDate — nettoyage simple, aucune reconversion de format', () => {
  assert.equal(normalizeDate('1988-04-12'), '1988-04-12');
  assert.equal(normalizeDate('  1988-04-12  '), '1988-04-12');
  assert.equal(normalizeDate(null), null);
  assert.equal(normalizeDate(''), null);
});

test('normalizePostal — majuscules, espaces retirés', () => {
  assert.equal(normalizePostal(' 1006 '), '1006');
  assert.equal(normalizePostal('ab1 2cd'), 'AB12CD');
});

test('classifyMatch — no_match si le nom de famille diffère ou est absent', () => {
  assert.equal(
    classifyMatch({ first_name: 'Jean', last_name: 'Dupont' }, { first_name: 'Jean', last_name: 'Martin' }).level,
    'no_match'
  );
  assert.equal(
    classifyMatch({ first_name: 'Jean', last_name: null }, { first_name: 'Jean', last_name: 'Martin' }).level,
    'no_match'
  );
  assert.equal(
    classifyMatch({ first_name: 'Jean', last_name: 'Dupont' }, { first_name: 'Jean', last_name: null }).level,
    'no_match'
  );
});

test('classifyMatch — exact_match : même prénom, nom et date de naissance', () => {
  const r = classifyMatch(
    { first_name: 'Marie', last_name: 'Dubois', birth_date: '1990-05-01' },
    { first_name: 'Marie', last_name: 'Dubois', birth_date: '1990-05-01' }
  );
  assert.equal(r.level, 'exact_match');
  assert.ok(r.reasons.some((x) => x.field === 'birth_date'));
});

test('classifyMatch — exact_match résiste aux accents/casse/espaces/apostrophes/tirets', () => {
  const r = classifyMatch(
    { first_name: '  ÉLODIE ', last_name: "d'Angelo", birth_date: '1985-11-20' },
    { first_name: 'Elodie', last_name: 'D’Angelo', birth_date: '1985-11-20' }
  );
  assert.equal(r.level, 'exact_match');

  const r2 = classifyMatch(
    { first_name: 'Jean-Paul', last_name: 'Müller', birth_date: '1975-01-01' },
    { first_name: 'jean paul', last_name: 'muller', birth_date: '1975-01-01' }
  );
  assert.equal(r2.level, 'exact_match');
});

test('classifyMatch — jamais probable_match si les deux dates sont renseignées et différentes', () => {
  const r = classifyMatch(
    { first_name: 'Paul', last_name: 'Rochat', birth_date: '1990-01-01', email: 'paul@example.ch' },
    { first_name: 'Paul', last_name: 'Rochat', birth_date: '1991-02-02', email: 'paul@example.ch' }
  );
  assert.notEqual(r.level, 'probable_match');
  assert.equal(r.level, 'possible_similarity');
});

test('classifyMatch — probable_match : même prénom/nom, date absente d’un côté, élément corroborant', () => {
  const r = classifyMatch(
    { first_name: 'Sophie', last_name: 'Berger', email: 'sophie.berger@example.ch' },
    { first_name: 'Sophie', last_name: 'Berger', birth_date: '1992-03-03', email: 'sophie.berger@example.ch' }
  );
  assert.equal(r.level, 'probable_match');
});

test('classifyMatch — probable_match via foyer commun (contexte)', () => {
  const r = classifyMatch(
    { first_name: 'Nadia', last_name: 'Keller' },
    { first_name: 'Nadia', last_name: 'Keller' },
    { sameHousehold: true }
  );
  assert.equal(r.level, 'probable_match');
  assert.ok(r.reasons.some((x) => x.field === 'household'));
});

test('classifyMatch — possible_similarity : même prénom/nom sans aucun élément complémentaire (homonymes)', () => {
  const r = classifyMatch(
    { first_name: 'Marc', last_name: 'Dubois' },
    { first_name: 'Marc', last_name: 'Dubois' }
  );
  assert.equal(r.level, 'possible_similarity');
});

test('classifyMatch — possible_similarity : même nom et même date de naissance, prénom différent', () => {
  const r = classifyMatch(
    { first_name: 'Alice', last_name: 'Fontaine', birth_date: '1980-06-15' },
    { first_name: 'Sarah', last_name: 'Fontaine', birth_date: '1980-06-15' }
  );
  assert.equal(r.level, 'possible_similarity');
});

test('classifyMatch — enfant sans email ni téléphone : la comparaison reste possible sur nom/prénom/date', () => {
  const r = classifyMatch(
    { first_name: 'Lucas', last_name: 'Perret', birth_date: '2015-09-09', email: null, phone: null },
    { first_name: 'Lucas', last_name: 'Perret', birth_date: '2015-09-09', email: null, phone: null }
  );
  assert.equal(r.level, 'exact_match');
});

test('classifyMatch — no_match si aucun signal significatif', () => {
  const r = classifyMatch(
    { first_name: 'Yann', last_name: 'Vuille' },
    { first_name: 'Karim', last_name: 'Aeschbacher' }
  );
  assert.equal(r.level, 'no_match');
  assert.deepEqual(r.reasons, []);
});

test('MATCH_LEVELS expose exactement les quatre niveaux attendus', () => {
  assert.deepEqual(MATCH_LEVELS, ['exact_match', 'probable_match', 'possible_similarity', 'no_match']);
});
