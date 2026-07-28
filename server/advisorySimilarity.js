// Détection souple de doublons entre personnes — Legrand Diagnostic 360, Lot 2.
//
// Moteur déterministe, sans dépendance externe, sans IA. Sert uniquement
// d'aide au conseiller : ne fusionne jamais, ne supprime jamais, ne bloque
// jamais systématiquement une création, et ne conclut jamais à une identité
// sur la seule base d'un nom identique (docs/advisory/DATA_MODEL.md §2.3).
//
// Note de convention : les niveaux de résultat utilisent les identifiants
// `exact_match`/`probable_match`/`possible_similarity`/`no_match` (anglais,
// snake_case), conformément à la décision humaine explicite du LOT 2 — même
// divergence assumée que `advisory_sessions.domain` (anglais) vis-à-vis du
// reste du CRM (français). docs/advisory/DATA_MODEL.md §2.3 et
// docs/advisory/API_CONTRACT.md §2 utilisent ces mêmes identifiants.

import { normEmail, normPhone } from './validate.js';

export const MATCH_LEVELS = ['exact_match', 'probable_match', 'possible_similarity', 'no_match'];

// Minuscules, accents retirés, tirets/apostrophes traités comme des espaces,
// espaces multiples réduits. Sert uniquement à la comparaison : n'altère
// jamais la valeur enregistrée dans `clients`.
export function normalizeName(v) {
  if (v == null) return null;
  const s = String(v)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s || null;
}

// Les dates de naissance sont déjà stockées au format AAAA-MM-JJ
// (`isDateStr`, server/validate.js) : seul un nettoyage des espaces est
// nécessaire, aucune reconversion de format.
export function normalizeDate(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  return s || null;
}

// Code postal : majuscules, espaces retirés (couvre les formats à espace de
// certains pays voisins sans supposer un format suisse strict).
export function normalizePostal(v) {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase().replace(/\s+/g, '');
  return s || null;
}

// Adresse : normalisation la plus simple possible (mêmes règles que les
// noms) — une correspondance d'adresse n'est retenue que si les deux
// chaînes normalisées sont strictement égales, jamais une proximité floue.
export function normalizeAddress(v) {
  return normalizeName(v);
}

// Compare deux valeurs normalisées : concordance seulement si les deux sont
// connues et strictement égales (aucune inférence sur une valeur absente).
function sameKnown(a, b) {
  return a != null && b != null && a === b;
}

/**
 * Classe la correspondance entre une personne à créer (`draft`) et une
 * personne déjà existante (`candidate`), selon les critères disponibles.
 *
 * `draft`/`candidate` : { first_name, last_name, birth_date, email, phone, npa, address }
 * `context` (calculé par l'appelant, ce module ne fait aucune requête DB) :
 *   { sameHousehold: bool, sameRepresentative: bool }
 *
 * Retourne { level, reasons } — `reasons` est une liste structurée
 * (jamais un texte libre) explicitant chaque critère ayant contribué,
 * pour rester explicable (cf. `rules-engine-auditor`).
 *
 * Logique volontairement conservatrice : le nom de famille normalisé doit
 * concorder pour envisager toute correspondance ; à défaut, `no_match`
 * immédiat (un nom de famille partagé ne suffit jamais à lui seul).
 */
export function classifyMatch(draft, candidate, context = {}) {
  const lastDraft = normalizeName(draft?.last_name);
  const lastCand = normalizeName(candidate?.last_name);
  if (!sameKnown(lastDraft, lastCand)) {
    return { level: 'no_match', reasons: [] };
  }
  const reasons = [{ field: 'last_name', detail: 'nom normalisé identique' }];

  const firstDraft = normalizeName(draft?.first_name);
  const firstCand = normalizeName(candidate?.first_name);
  const sameFirst = sameKnown(firstDraft, firstCand);

  const dobDraft = normalizeDate(draft?.birth_date);
  const dobCand = normalizeDate(candidate?.birth_date);
  const bothDobKnown = dobDraft != null && dobCand != null;
  const sameDob = bothDobKnown && dobDraft === dobCand;
  const dobDiffers = bothDobKnown && dobDraft !== dobCand;

  // Éléments corroborants secondaires — jamais suffisants seuls, seulement
  // à l'appui d'une concordance prénom+nom déjà établie.
  const corroborating = [];
  const emailDraft = normEmail(draft?.email);
  const emailCand = normEmail(candidate?.email);
  if (sameKnown(emailDraft, emailCand)) corroborating.push({ field: 'email', detail: 'e-mail identique' });
  const phoneDraft = normPhone(draft?.phone);
  const phoneCand = normPhone(candidate?.phone);
  if (sameKnown(phoneDraft, phoneCand)) corroborating.push({ field: 'phone', detail: 'téléphone identique' });
  const npaDraft = normalizePostal(draft?.npa);
  const npaCand = normalizePostal(candidate?.npa);
  if (sameKnown(npaDraft, npaCand)) corroborating.push({ field: 'npa', detail: 'code postal identique' });
  const addressDraft = normalizeAddress(draft?.address);
  const addressCand = normalizeAddress(candidate?.address);
  if (sameKnown(addressDraft, addressCand)) corroborating.push({ field: 'address', detail: 'adresse identique' });
  if (context.sameHousehold) corroborating.push({ field: 'household', detail: 'foyer commun' });
  if (context.sameRepresentative) {
    corroborating.push({ field: 'legal_representative', detail: 'représentant légal commun' });
  }

  if (sameFirst && sameDob) {
    return {
      level: 'exact_match',
      reasons: [
        ...reasons,
        { field: 'first_name', detail: 'prénom normalisé identique' },
        { field: 'birth_date', detail: 'date de naissance identique' },
      ],
    };
  }

  if (sameFirst && dobDiffers) {
    // Règle explicite : jamais probable_match si les deux dates sont
    // renseignées et différentes — au mieux une similarité à vérifier.
    return {
      level: 'possible_similarity',
      reasons: [
        ...reasons,
        { field: 'first_name', detail: 'prénom normalisé identique' },
        { field: 'birth_date', detail: 'dates de naissance renseignées mais différentes' },
      ],
    };
  }

  if (sameFirst && !bothDobKnown) {
    if (corroborating.length > 0) {
      return {
        level: 'probable_match',
        reasons: [...reasons, { field: 'first_name', detail: 'prénom normalisé identique' }, ...corroborating],
      };
    }
    return {
      level: 'possible_similarity',
      reasons: [...reasons, { field: 'first_name', detail: 'prénom normalisé identique' }],
    };
  }

  if (!sameFirst && sameDob) {
    return {
      level: 'possible_similarity',
      reasons: [...reasons, { field: 'birth_date', detail: 'date de naissance identique, prénom différent' }],
    };
  }

  return { level: 'no_match', reasons: [] };
}

// Ordonne par sévérité décroissante (exact_match d'abord) — comparateur pur,
// utilisé par le service métier pour trier les correspondances à afficher.
const SEVERITY = { exact_match: 0, probable_match: 1, possible_similarity: 2, no_match: 3 };
export function compareMatchSeverity(a, b) {
  return SEVERITY[a.level] - SEVERITY[b.level];
}
