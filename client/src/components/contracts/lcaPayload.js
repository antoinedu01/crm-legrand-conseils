import { toOptionalInteger, NumberConversionError } from './numberConversion.js';
import { applySpecializedBlockState } from './contractPayload.js';

// Copies exactes des règles métier de server/routes/contracts.js — à
// resynchroniser manuellement si ce fichier backend évolue (aucune
// modification du backend n'est faite dans ce lot).
export const UNDERWRITING_STATUSES = [
  'non_requis', 'questionnaire_transmis', 'decision_attendue',
  'acceptee', 'acceptee_avec_reserve', 'refusee',
];
export const RESERVATION_STATUSES = ['aucune', 'en_cours', 'active', 'levee'];
export const EXCLUSION_STATUSES = ['aucune', 'presentes'];

const NOTES_MAX_LENGTH = 200;

// Valeurs neutres pour l'initialisation d'un nouveau bloc LCA (création,
// ajout à un contrat existant sans bloc) : statuts de base réellement
// prévus par le backend (DEFAULT SQL), jamais un statut favorable ou
// défavorable présélectionné — celui-ci doit toujours résulter d'une action
// explicite de l'utilisateur.
export const LCA_NEUTRAL_FIELDS = {
  underwriting_status: 'non_requis',
  waiting_period_days: '',
  administrative_reservation_status: 'aucune',
  reservation_notes: '',
  exclusions_status: 'aucune',
  exclusions_notes: '',
};

export class LcaPayloadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LcaPayloadError';
  }
}

function cleanNote(value, fieldLabel) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throw new LcaPayloadError(`Le champ "${fieldLabel}" doit être une chaîne de texte.`);
  }
  if (value.length > NOTES_MAX_LENGTH) {
    throw new LcaPayloadError(`Le champ "${fieldLabel}" dépasse ${NOTES_MAX_LENGTH} caractères.`);
  }
  return value;
}

// Construit un objet lca complet, toujours avec exactement les six clés
// attendues par le contrat produit du Lot I3 (même si le backend accepte
// techniquement un objet partiel) : les trois statuts doivent toujours être
// une valeur valide de leur enum ; les trois champs facultatifs sont
// toujours présents, avec `null` pour absent/vide. Lève LcaPayloadError en
// cas de valeur non conforme.
export function buildLcaBlock(fields) {
  const {
    underwriting_status, waiting_period_days, administrative_reservation_status,
    reservation_notes, exclusions_status, exclusions_notes,
  } = fields || {};

  if (!UNDERWRITING_STATUSES.includes(underwriting_status)) {
    throw new LcaPayloadError(`Statut de souscription LCA invalide (valeurs autorisées : ${UNDERWRITING_STATUSES.join(', ')}).`);
  }
  if (!RESERVATION_STATUSES.includes(administrative_reservation_status)) {
    throw new LcaPayloadError(`Statut de réserve administrative invalide (valeurs autorisées : ${RESERVATION_STATUSES.join(', ')}).`);
  }
  if (!EXCLUSION_STATUSES.includes(exclusions_status)) {
    throw new LcaPayloadError(`Statut d'exclusion invalide (valeurs autorisées : ${EXCLUSION_STATUSES.join(', ')}).`);
  }

  let waitingPeriodValue;
  try {
    waitingPeriodValue = toOptionalInteger(waiting_period_days, { nonNegative: true }) ?? null;
  } catch (err) {
    if (err instanceof NumberConversionError) {
      throw new LcaPayloadError(`Délai d'attente LCA invalide : ${err.message}`);
    }
    throw err;
  }

  return {
    underwriting_status,
    waiting_period_days: waitingPeriodValue,
    administrative_reservation_status,
    reservation_notes: cleanNote(reservation_notes, 'reservation_notes'),
    exclusions_status,
    exclusions_notes: cleanNote(exclusions_notes, 'exclusions_notes'),
  };
}

// Composition pure du payload final pour le bloc lca, symétrique à
// composeLamalPayload : 'unchanged' est toujours résolu en 'absent' avant
// applySpecializedBlockState ; branch !== 'lca' force toujours 'absent'
// (protection anti stale state). N'affecte jamais une autre clé du payload
// (ex. un bloc `lamal` déjà composé reste intact, applySpecializedBlockState
// ne touchant que la clé `lca`).
export function composeLcaPayload(payload, { mode, branch, block }) {
  if (branch !== 'lca') {
    return applySpecializedBlockState(payload, 'lca', 'absent');
  }
  if (mode === 'unchanged' || mode === 'absent') {
    return applySpecializedBlockState(payload, 'lca', 'absent');
  }
  if (mode === 'removed') {
    return applySpecializedBlockState(payload, 'lca', 'removed');
  }
  if (mode === 'value') {
    return applySpecializedBlockState(payload, 'lca', 'value', block);
  }
  throw new LcaPayloadError(`État LCA inconnu : "${mode}".`);
}
