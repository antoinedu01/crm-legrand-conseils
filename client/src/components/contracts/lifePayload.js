import { toOptionalDecimal, toOptionalInteger, NumberConversionError } from './numberConversion.js';
import { applySpecializedBlockState } from './contractPayload.js';

// Copies exactes des règles métier de server/routes/contracts.js (bloc
// contract_life) — à resynchroniser manuellement si ce fichier backend
// évolue (aucune modification du backend n'est faite dans ce lot).
export const COMPONENT_TYPES = [
  'mixte', 'risque_pur', 'capital_differe', 'rente', 'unit_linked', 'autre',
];
export const INDEXATION_TYPES = ['aucune', 'fixe', 'indice_prix_conso', 'autre'];

// Les deux seules branches génériques pour lesquelles le backend accepte un
// bloc contract_life (validées par lecture directe de server/routes/contracts.js).
export const LIFE_COMPATIBLE_BRANCHES = ['vie_3a', 'vie_3b'];

// Valeurs initiales de formulaire, PAS des valeurs backend : component_type
// vide n'est qu'un état d'interface signalant qu'aucun choix n'a encore été
// fait par l'utilisateur et ne doit jamais être envoyé tel quel au backend
// (buildLifeBlock le rejette). indexation_type: 'aucune' et
// premium_waiver: false sont en revanche les véritables défauts neutres du
// backend (colonnes SQL DEFAULT).
export const LIFE_INITIAL_FIELDS = {
  component_type: '',
  insured_death_capital: '',
  insured_disability_capital: '',
  insured_rent: '',
  surrender_value: '',
  premium_waiver: false,
  indexation_type: 'aucune',
  policy_term_years: '',
};

export class LifePayloadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LifePayloadError';
  }
}

function convertOptionalAmount(value, fieldLabel) {
  try {
    return toOptionalDecimal(value, { nonNegative: true }) ?? null;
  } catch (err) {
    if (err instanceof NumberConversionError) {
      throw new LifePayloadError(`Le champ "${fieldLabel}" est invalide : ${err.message}`);
    }
    throw err;
  }
}

// Construit un objet life complet contenant toujours exactement les huit
// clés attendues par le contrat produit du Lot I4 (même si le backend
// accepte techniquement un objet partiel en PUT) : component_type doit
// toujours être choisi explicitement (aucune valeur neutre n'existe pour
// cette énumération) ; les quatre montants et policy_term_years acceptent
// vide/null/absent → null ; premium_waiver doit être un booléen strict.
// Lève LifePayloadError en cas de valeur non conforme.
export function buildLifeBlock(fields) {
  const {
    component_type, insured_death_capital, insured_disability_capital, insured_rent,
    surrender_value, premium_waiver, indexation_type, policy_term_years,
  } = fields || {};

  if (!COMPONENT_TYPES.includes(component_type)) {
    throw new LifePayloadError(`Type de composante Vie invalide (valeurs autorisées : ${COMPONENT_TYPES.join(', ')}).`);
  }
  if (!INDEXATION_TYPES.includes(indexation_type)) {
    throw new LifePayloadError(`Type d'indexation invalide (valeurs autorisées : ${INDEXATION_TYPES.join(', ')}).`);
  }
  if (typeof premium_waiver !== 'boolean') {
    throw new LifePayloadError('Le champ "premium_waiver" doit être un booléen (true ou false).');
  }

  let policyTermValue;
  try {
    policyTermValue = toOptionalInteger(policy_term_years) ?? null;
  } catch (err) {
    if (err instanceof NumberConversionError) {
      throw new LifePayloadError(`Durée contractuelle invalide : ${err.message}`);
    }
    throw err;
  }
  if (policyTermValue !== null && policyTermValue <= 0) {
    throw new LifePayloadError('La durée contractuelle doit être strictement supérieure à 0.');
  }

  return {
    component_type,
    insured_death_capital: convertOptionalAmount(insured_death_capital, 'insured_death_capital'),
    insured_disability_capital: convertOptionalAmount(insured_disability_capital, 'insured_disability_capital'),
    insured_rent: convertOptionalAmount(insured_rent, 'insured_rent'),
    surrender_value: convertOptionalAmount(surrender_value, 'surrender_value'),
    premium_waiver,
    indexation_type,
    policy_term_years: policyTermValue,
  };
}

// Composition pure du payload final pour le bloc life, symétrique à
// composeLamalPayload/composeLcaPayload : 'unchanged' est toujours résolu en
// 'absent' avant applySpecializedBlockState ; une branche hors
// LIFE_COMPATIBLE_BRANCHES force toujours 'absent' (protection anti stale
// state), quel que soit l'état résiduel côté React. N'affecte jamais une
// autre clé du payload (ex. des blocs `lamal`/`lca` déjà composés restent
// intacts, applySpecializedBlockState ne touchant que la clé `life`).
export function composeLifePayload(payload, { mode, branch, block }) {
  if (!LIFE_COMPATIBLE_BRANCHES.includes(branch)) {
    return applySpecializedBlockState(payload, 'life', 'absent');
  }
  if (mode === 'unchanged' || mode === 'absent') {
    return applySpecializedBlockState(payload, 'life', 'absent');
  }
  if (mode === 'removed') {
    return applySpecializedBlockState(payload, 'life', 'removed');
  }
  if (mode === 'value') {
    return applySpecializedBlockState(payload, 'life', 'value', block);
  }
  throw new LifePayloadError(`État Vie inconnu : "${mode}".`);
}
