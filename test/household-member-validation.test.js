// Tests du module PUR de validation d'ajout de membre de foyer
// (FIX-MEMBER-DOB, `client/src/pages/householdMemberValidation.js`) —
// aucun framework de test frontend (confirmé absent, voir
// `test/health-synthesis-labels.test.js`), `node --test` direct. Aucune
// base de données requise : fonction pure, sans dépendance serveur.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { isValidDateStr, getAddMemberErrorMessage } = await import('../client/src/pages/householdMemberValidation.js');

test('isValidDateStr — rejette une date vide', () => {
  assert.equal(isValidDateStr(''), false);
});

test('isValidDateStr — rejette null/undefined', () => {
  assert.equal(isValidDateStr(null), false);
  assert.equal(isValidDateStr(undefined), false);
});

test('isValidDateStr — accepte une date ISO valide', () => {
  assert.equal(isValidDateStr('1985-06-15'), true);
});

test('isValidDateStr — rejette un format non ISO', () => {
  assert.equal(isValidDateStr('15/06/1985'), false);
  assert.equal(isValidDateStr('1985-6-15'), false);
});

test('isValidDateStr — rejette une date syntaxiquement correcte mais impossible', () => {
  assert.equal(isValidDateStr('2026-13-40'), false);
});

test('isValidDateStr — rejette un type non-string', () => {
  assert.equal(isValidDateStr(20260809), false);
  assert.equal(isValidDateStr({}), false);
});

// --- FIX-MEMBER-DOB-v2 : mapping erreur -> message frontend (audit §4) -----

test('getAddMemberErrorMessage — code NEW_PERSON_BIRTH_DATE_REQUIRED -> message stable', () => {
  const err = { status: 400, data: { error: 'Date de naissance obligatoire pour créer une nouvelle personne.', code: 'NEW_PERSON_BIRTH_DATE_REQUIRED' } };
  assert.equal(getAddMemberErrorMessage(err), "La date de naissance renseignée n'est pas valide.");
});

test('getAddMemberErrorMessage — code NEW_PERSON_BIRTH_DATE_INVALID -> message stable', () => {
  const err = { status: 400, data: { error: 'Date de naissance invalide (AAAA-MM-JJ).', code: 'NEW_PERSON_BIRTH_DATE_INVALID' } };
  assert.equal(getAddMemberErrorMessage(err), "La date de naissance renseignée n'est pas valide.");
});

test('getAddMemberErrorMessage — erreur inattendue (message technique brut) -> message générique, jamais le texte backend', () => {
  const err = { status: 500, message: 'SQLITE_ERROR internal: table clients has no column named foo', data: { error: 'SQLITE_ERROR internal: table clients has no column named foo' } };
  const msg = getAddMemberErrorMessage(err);
  assert.equal(msg, "Impossible d'ajouter cette personne pour le moment.");
  assert.ok(!msg.includes('SQLITE'), 'le texte technique ne doit jamais apparaître dans le message affiché');
});

test('getAddMemberErrorMessage — erreur avec détails fictifs sensibles -> ne fuient jamais dans le message', () => {
  const err = {
    status: 400,
    message: 'Conflit avec le dossier de Jean Dupont, AVS 756.1234.5678.90',
    data: { error: 'Conflit avec le dossier de Jean Dupont, AVS 756.1234.5678.90', details: 'AVS 756.1234.5678.90' },
  };
  const msg = getAddMemberErrorMessage(err);
  assert.equal(msg, "Impossible d'ajouter cette personne pour le moment.");
  assert.ok(!msg.includes('Dupont') && !msg.includes('756.1234.5678.90'), 'aucune donnée sensible ne doit apparaître dans le message affiché');
});

test('getAddMemberErrorMessage — code inconnu ou absent (statut 400 non lié à la date) -> message générique', () => {
  assert.equal(getAddMemberErrorMessage({ status: 400, data: { error: 'Un nom est requis pour créer une personne.' } }), "Impossible d'ajouter cette personne pour le moment.");
  assert.equal(getAddMemberErrorMessage({ status: 400, data: {} }), "Impossible d'ajouter cette personne pour le moment.");
  assert.equal(getAddMemberErrorMessage({}), "Impossible d'ajouter cette personne pour le moment.");
});
