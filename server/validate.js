// Petites briques de validation serveur : chaque route vérifie ses entrées
// avant d'écrire en base. En cas d'échec, on renvoie une erreur 400 lisible.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

export function assert(cond, message) {
  if (!cond) throw new ValidationError(message);
}

export function isEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

export function maxLen(v, n) {
  return v == null || (typeof v === 'string' && v.length <= n);
}

export function isDateStr(v) {
  return v == null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)));
}

export function isNonNegNumber(v) {
  return v == null || (Number.isFinite(Number(v)) && Number(v) >= 0);
}

export function inEnum(v, values) {
  return v == null || values.includes(v);
}

// Vérifications communes aux champs texte d'un objet (longueur raisonnable)
export function checkTextFields(data, fields, limit = 500) {
  for (const f of fields) {
    assert(maxLen(data[f], limit), `Le champ « ${f} » dépasse ${limit} caractères.`);
  }
}

// Middleware : transforme les ValidationError en réponse 400
export function validationErrors(err, req, res, next) {
  if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
  next(err);
}

// Normalisation pour la détection de doublons
export function normEmail(v) {
  return typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null;
}
export function normPhone(v) {
  if (typeof v !== 'string') return null;
  const digits = v.replace(/\D/g, '');
  if (!digits) return null;
  // format suisse : 0791234567 et +41791234567 doivent correspondre
  return digits.startsWith('0041') ? '41' + digits.slice(4) : digits.startsWith('0') ? '41' + digits.slice(1) : digits;
}
