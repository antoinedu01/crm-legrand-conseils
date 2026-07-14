// TOTP (RFC 6238) implémenté avec la crypto native de Node — aucun service externe.
// Compatible avec Google Authenticator, Microsoft Authenticator, Authy, etc.
import crypto from 'crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secretBytes, counter, digits = 6) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secretBytes).update(buf).digest();
  const offset = h[h.length - 1] & 0xf;
  const code =
    ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}

export function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

// Code attendu à un instant donné (exporté pour les tests)
export function totpCode(secretBase32, nowMs = Date.now(), step = 30) {
  return hotp(base32Decode(secretBase32), Math.floor(nowMs / 1000 / step));
}

// Vérification avec tolérance d'une période (horloges légèrement décalées)
export function verifyTotp(secretBase32, code, { window = 1, step = 30, nowMs = Date.now() } = {}) {
  const input = String(code || '').trim();
  if (!/^\d{6}$/.test(input)) return false;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(nowMs / 1000 / step);
  for (let i = -window; i <= window; i++) {
    const expected = hotp(secret, counter + i);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(input))) return true;
  }
  return false;
}

export function otpauthUrl(secretBase32, email) {
  const issuer = encodeURIComponent('CRM Legrand Conseils');
  return `otpauth://totp/${issuer}:${encodeURIComponent(email)}?secret=${secretBase32}&issuer=${issuer}&digits=6&period=30`;
}
