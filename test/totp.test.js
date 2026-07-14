// Tests de la double authentification TOTP (RFC 6238)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32Encode, totpCode, verifyTotp, generateTotpSecret } from '../server/totp.js';

// Vecteur de test officiel de la RFC 6238 (secret ASCII "12345678901234567890")
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

test('vecteur de test RFC 6238 : code correct à t=59s', () => {
  assert.equal(totpCode(RFC_SECRET, 59 * 1000), '287082');
});

test('vérification : accepte le code de la période courante et adjacente', () => {
  const now = 1111111109 * 1000; // vecteur RFC : code 081804
  assert.equal(totpCode(RFC_SECRET, now), '081804');
  assert.ok(verifyTotp(RFC_SECRET, '081804', { nowMs: now }));
  // période précédente tolérée (horloge du téléphone légèrement décalée)
  assert.ok(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now - 30_000), { nowMs: now }));
});

test('vérification : rejette un mauvais code et les entrées invalides', () => {
  const now = Date.now();
  assert.equal(verifyTotp(RFC_SECRET, '000000', { nowMs: now }) &&
    totpCode(RFC_SECRET, now) !== '000000', false);
  assert.equal(verifyTotp(RFC_SECRET, '12345', { nowMs: now }), false);
  assert.equal(verifyTotp(RFC_SECRET, 'abcdef', { nowMs: now }), false);
  assert.equal(verifyTotp(RFC_SECRET, '', { nowMs: now }), false);
});

test('les secrets générés sont uniques et en base32 valide', () => {
  const a = generateTotpSecret();
  const b = generateTotpSecret();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Z2-7]{32}$/);
});
