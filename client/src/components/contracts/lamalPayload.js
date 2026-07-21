import { toRequiredInteger, NumberConversionError } from './numberConversion.js';
import { applySpecializedBlockState } from './contractPayload.js';

// Copies exactes des règles métier de server/routes/contracts.js — à
// resynchroniser manuellement si ce fichier backend évolue (aucune
// modification du backend n'est faite dans ce lot).
export const LAMAL_CARE_MODELS = ['standard', 'medecin_famille', 'hmo', 'telmed', 'pharmacie', 'autre'];
export const LAMAL_DEDUCTIBLES = [0, 100, 200, 300, 400, 500, 600, 1000, 1500, 2000, 2500];
export const SWISS_CANTONS = [
  'AG', 'AI', 'AR', 'BE', 'BL', 'BS', 'FR', 'GE', 'GL', 'GR', 'JU', 'LU', 'NE',
  'NW', 'OW', 'SG', 'SH', 'SO', 'SZ', 'TG', 'TI', 'UR', 'VD', 'VS', 'ZG', 'ZH',
];

const TARIFF_REGION_MAX_LENGTH = 20;

export class LamalPayloadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LamalPayloadError';
  }
}

function cleanOptionalString(value) {
  if (value == null || value === '') return null;
  return value;
}

// Construit un objet lamal complet et strictement conforme au backend, ou
// lève LamalPayloadError. Les 5 propriétés sont toujours présentes en
// sortie, comme l'exige le backend (aucune mise à jour partielle LAMal).
export function buildLamalBlock(fields) {
  const { care_model, deductible, accident_coverage, canton, tariff_region } = fields || {};

  if (!LAMAL_CARE_MODELS.includes(care_model)) {
    throw new LamalPayloadError(`Modèle de soins LAMal invalide (valeurs autorisées : ${LAMAL_CARE_MODELS.join(', ')}).`);
  }

  let deductibleNumber;
  try {
    deductibleNumber = toRequiredInteger(deductible, { nonNegative: true });
  } catch (err) {
    if (err instanceof NumberConversionError) {
      throw new LamalPayloadError(`Franchise LAMal invalide : ${err.message}`);
    }
    throw err;
  }
  if (!LAMAL_DEDUCTIBLES.includes(deductibleNumber)) {
    throw new LamalPayloadError(`Franchise LAMal invalide (valeurs autorisées : ${LAMAL_DEDUCTIBLES.join(', ')}).`);
  }

  // Comparaison stricte : jamais de `value || true`, qui transformerait
  // `false` en `true`. `accident_coverage` doit être un booléen réel.
  if (typeof accident_coverage !== 'boolean') {
    throw new LamalPayloadError('Couverture accident invalide (valeur booléenne attendue).');
  }

  const cantonValue = cleanOptionalString(canton);
  const normalizedCanton = cantonValue === null ? null : String(cantonValue).trim().toUpperCase();
  if (normalizedCanton !== null && !SWISS_CANTONS.includes(normalizedCanton)) {
    throw new LamalPayloadError(`Canton invalide (valeurs autorisées : ${SWISS_CANTONS.join(', ')}).`);
  }

  const tariffRegionValue = cleanOptionalString(tariff_region);
  if (tariffRegionValue !== null && tariffRegionValue.length > TARIFF_REGION_MAX_LENGTH) {
    throw new LamalPayloadError(`La région tarifaire dépasse ${TARIFF_REGION_MAX_LENGTH} caractères.`);
  }

  return {
    care_model,
    deductible: deductibleNumber,
    accident_coverage,
    canton: normalizedCanton,
    tariff_region: tariffRegionValue,
  };
}

// Composition pure du payload final pour le bloc lamal, à partir de l'état
// interne à 4 valeurs du sous-formulaire ('unchanged' | 'absent' | 'value' |
// 'removed') et de la branche finale du contrat. Ne prend jamais 'unchanged'
// tel quel : il est toujours résolu en 'absent' avant d'appeler
// applySpecializedBlockState. Si la branche finale n'est plus 'lamal', l'état
// est toujours forcé à 'absent', quelle que soit la valeur locale résiduelle
// du sous-formulaire (protection contre le stale state inter-branches).
export function composeLamalPayload(payload, { mode, branch, block }) {
  if (branch !== 'lamal') {
    return applySpecializedBlockState(payload, 'lamal', 'absent');
  }
  if (mode === 'unchanged' || mode === 'absent') {
    return applySpecializedBlockState(payload, 'lamal', 'absent');
  }
  if (mode === 'removed') {
    return applySpecializedBlockState(payload, 'lamal', 'removed');
  }
  if (mode === 'value') {
    return applySpecializedBlockState(payload, 'lamal', 'value', block);
  }
  throw new LamalPayloadError(`État LAMal inconnu : "${mode}".`);
}
