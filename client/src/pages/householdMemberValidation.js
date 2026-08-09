// Validation frontend pure pour l'ajout d'un membre de foyer (FIX-MEMBER-DOB).
// Isolée de HouseholdDetail.jsx (qui contient du JSX, non testable directement
// par `node --test`) sur le même principe que healthSynthesisLabels.js à côté
// de SessionHealthSynthesis.jsx : juste assez pour bloquer une soumission
// manifestement vide ou mal formée avant l'appel réseau — le serveur reste
// l'autorité finale (`isDateStr`, server/validate.js), jamais dupliqué ici.
export function isValidDateStr(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

// Codes métier stables renvoyés par `advisoryHouseholds.js` (server) pour le
// rejet d'une création de nouvelle personne sans date de naissance valide.
const NEW_PERSON_BIRTH_DATE_ERROR_CODES = ['NEW_PERSON_BIRTH_DATE_REQUIRED', 'NEW_PERSON_BIRTH_DATE_INVALID'];

const GENERIC_ADD_MEMBER_ERROR = "Impossible d'ajouter cette personne pour le moment.";

// Traduit une erreur réseau (forme `client/src/api.js` : `err.status` +
// `err.data`) en un texte fixe destiné au conseiller — jamais `err.message` /
// `err.data.message` / `err.data.details`, qui peuvent porter un détail
// technique ou sensible. Seul `err.data.code`, quand il correspond à un code
// métier connu, débranche vers un message plus précis (audit FIX-MEMBER-DOB
// §4). Tout le reste (erreur inattendue, code inconnu) tombe sur le même
// texte générique, quel que soit son contenu réel.
export function getAddMemberErrorMessage(err) {
  if (err && err.status === 400 && NEW_PERSON_BIRTH_DATE_ERROR_CODES.includes(err.data?.code)) {
    return "La date de naissance renseignée n'est pas valide.";
  }
  return GENERIC_ADD_MEMBER_ERROR;
}
