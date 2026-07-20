export class NumberConversionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NumberConversionError';
  }
}

function isPlainFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseStrict(value) {
  if (typeof value === 'boolean' || value === null || Array.isArray(value) || (typeof value === 'object')) {
    throw new NumberConversionError('La valeur doit être un nombre, jamais un booléen, un objet ou un tableau.');
  }
  if (isPlainFiniteNumber(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new NumberConversionError('La valeur doit être un nombre non vide.');
  }
  if (!/^-?\d+(\.\d+)?$/.test(value.trim())) {
    throw new NumberConversionError('La valeur doit être un nombre valide (chiffres uniquement).');
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new NumberConversionError('La valeur doit être un nombre fini.');
  }
  return parsed;
}

function checkNonNegative(n, { nonNegative }) {
  if (nonNegative && n < 0) {
    throw new NumberConversionError('La valeur ne peut pas être négative.');
  }
}

function isEmptyOptional(value) {
  return value === '' || value === null || value === undefined;
}

export function toRequiredInteger(value, { nonNegative = false } = {}) {
  const n = parseStrict(value);
  if (!Number.isInteger(n)) {
    throw new NumberConversionError('La valeur doit être un nombre entier, sans décimale.');
  }
  checkNonNegative(n, { nonNegative });
  return n;
}

// Renvoie `undefined` pour '', null ou undefined — c'est-à-dire « aucune
// valeur numérique fournie ». Ceci n'indique PAS s'il faut omettre le champ
// (préserver l'existant) ou envoyer explicitement `null` (effacer le champ,
// §4 de docs/CONTRATS_ASSURANCE_SUISSE.md) : cette décision appartient à
// l'appelant (futurs sous-formulaires), qui doit distinguer explicitement
// « champ jamais touché » de « champ vidé par l'utilisateur » avant de
// construire le payload — ne jamais déduire l'un de l'autre à partir de ce
// seul retour `undefined`.
export function toOptionalInteger(value, { nonNegative = false } = {}) {
  if (isEmptyOptional(value)) return undefined;
  return toRequiredInteger(value, { nonNegative });
}

export function toRequiredDecimal(value, { nonNegative = false } = {}) {
  const n = parseStrict(value);
  checkNonNegative(n, { nonNegative });
  return n;
}

// Même contrat que toOptionalInteger ci-dessus : `undefined` signifie
// « aucune valeur fournie », pas « effacer ». Voir la note ci-dessus.
export function toOptionalDecimal(value, { nonNegative = false } = {}) {
  if (isEmptyOptional(value)) return undefined;
  return toRequiredDecimal(value, { nonNegative });
}
