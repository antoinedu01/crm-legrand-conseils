export const BRANCHES = {
  vie_3a: 'Prévoyance liée 3a',
  vie_3b: 'Prévoyance libre 3b',
  lamal: 'Assurance maladie (LAMal)',
  lca: 'Complémentaire (LCA)',
  lpp: 'Prévoyance professionnelle (LPP)',
  hypotheque: 'Assurance hypothèque',
  deces: 'Risque pur décès',
  incapacite: 'Incapacité de gain',
  rc_menage: 'RC / Ménage',
  autre: 'Autre',
};

export const CONTRACT_STATUS = {
  offre: 'Offre',
  actif: 'Actif',
  suspendu: 'Suspendu',
  resilie: 'Résilié',
  echu: 'Échu',
};

export const CLIENT_STATUS = {
  prospect: 'Prospect',
  client: 'Client',
  ancien: 'Ancien client',
  anonymise: 'Anonymisé',
};

export const COMMISSION_STATUS = {
  attendue: 'Attendue',
  payee: 'Payée',
  annulee: 'Annulée',
};

export const COMMISSION_TYPES = {
  acquisition: 'Acquisition',
  recurrente: 'Récurrente',
  ajustement: 'Ajustement',
};

export const ACTIVITY_TYPES = {
  appel: 'Appel',
  email: 'E-mail',
  rdv: 'Rendez-vous',
  note: 'Note',
  document: 'Document',
  conformite: 'Conformité',
};

export const PAYMENT_FREQUENCIES = {
  mensuelle: 'Mensuelle',
  trimestrielle: 'Trimestrielle',
  semestrielle: 'Semestrielle',
  annuelle: 'Annuelle',
  unique: 'Prime unique',
};

export const CANTONS = ['AG','AI','AR','BE','BL','BS','FR','GE','GL','GR','JU','LU','NE','NW','OW','SG','SH','SO','SZ','TG','TI','UR','VD','VS','ZG','ZH'];

export const PIPELINE_STAGES = {
  nouveau: 'Nouveau',
  contacte: 'Contacté',
  rdv: 'RDV fixé',
  analyse: 'Analyse des besoins',
  offre: 'Offre envoyée',
  signe: 'Signé',
  perdu: 'Perdu',
};

export const AGE_RANGES = ['18-25', '26-35', '36-45', '46-55', '56-65', '65+'];

export const WORK_SITUATIONS = ['Salarié(e)', 'Indépendant(e)', 'Frontalier/ère', 'Sans activité', 'Retraité(e)', 'Étudiant(e)'];

export const MAIN_NEEDS = [
  'Prévoyance 3a', 'Prévoyance 3b', 'Assurance vie', 'LAMal / caisse maladie',
  'Complémentaires LCA', 'Incapacité de gain', 'Risque décès', 'Protection famille',
  'Hypothèque / amortissement', 'Bilan de prévoyance complet', 'Autre',
];

export const CONTACT_PREFS = ['Matin', 'Midi', 'Après-midi', 'Soir (17h-19h)', 'Peu importe'];

export const CLASSEMENTS = {
  non_qualifie: 'Non qualifié',
  froid: 'Froid',
  tiede: 'Tiède',
  chaud: 'Chaud',
  prioritaire: 'Prioritaire',
};

// Legrand Diagnostic 360 — socle foyer (Lot 2)
export const HOUSEHOLD_STATUS = {
  actif: 'Actif',
  archive: 'Archivé',
};

export const MEMBER_ROLES = {
  principal: 'Client principal',
  conjoint: 'Conjoint / partenaire',
  enfant: 'Enfant',
  autre_charge: 'Autre personne à charge',
};

// Rôles que peut reprendre l'ancien principal une fois rétrogradé.
export const DEMOTABLE_ROLES = ['conjoint', 'autre_charge'];

export const MATCH_LEVELS = {
  exact_match: 'Correspondance exacte',
  probable_match: 'Correspondance probable',
  possible_similarity: 'Similarité possible',
  no_match: 'Aucune correspondance',
};

// Legrand Diagnostic 360 — sessions et questionnaires génériques (Lot 3A).
// Identifiants techniques en anglais (décision humaine explicite du Lot 3A,
// même divergence assumée qu'au Lot 2 pour MATCH_LEVELS).
export const SESSION_DOMAINS = {
  health: 'Assurance Maladie',
  life_pension: 'Vie et Prévoyance',
  mixed: 'Mixte (Maladie + Vie/Prévoyance)',
};

export const SESSION_STATUSES = {
  draft: 'Brouillon',
  in_progress: 'En cours',
  suspended: 'Suspendue',
  completed: 'Finalisée',
  cancelled: 'Annulée',
};

export const LINK_DOMAIN_LABELS = {
  common: 'Commun',
  health: 'Assurance Maladie',
  life_pension: 'Vie et Prévoyance',
};

export const ANSWER_STATUSES = {
  answered: 'Répondu',
  unknown: 'Inconnu',
  not_applicable: 'Non applicable',
  cleared: 'Effacé',
};

// Legrand Diagnostic 360 — espace conseiller des findings (Lot 4B). Jamais
// un score, jamais une recommandation : uniquement le vocabulaire des
// constats produits par le moteur déterministe (Lot 4A).
export const FINDING_TYPES = {
  fact: 'Fait constaté',
  detected_need: 'Besoin détecté',
  gap: 'Lacune identifiée',
  warning: 'Avertissement',
  missing_information: 'Information manquante',
  solution_category: 'Catégorie générale',
};

export const PRIORITIES = {
  critical: 'Critique',
  high: 'Élevée',
  medium: 'Moyenne',
  low: 'Faible',
};

export const FINDING_SCOPES = {
  session: 'Transverse au foyer',
  household: 'Foyer',
  member: 'Membre',
};

export const FINDING_STATUSES = {
  active: 'Actif',
  dismissed: 'Écarté',
  superseded: 'Analyse remplacée',
};

export const EXECUTION_STATUSES = {
  running: 'En cours',
  completed: 'Terminée',
  failed: 'Échouée',
};

// Legrand Diagnostic 360 — recommandations humaines (Lot 7B). `RECOMMENDATION_
// SCOPES` n'existe pas séparément : la portée d'une recommandation utilise
// exactement les mêmes valeurs et le même sens que `FINDING_SCOPES`
// ci-dessus (session/household/member), réutilisé tel quel (décision
// UX_AND_CLIENT_MODE.md — aucun nouveau dictionnaire pour une valeur
// identique).
export const RECOMMENDATION_STATUSES = {
  draft: 'Brouillon',
  validated: 'Validée',
  dismissed: 'Écartée',
  superseded: 'Remplacée',
  withdrawn: 'Retirée',
};

// État global agrégé de l'analyse (Lot 4B, GATE §3) -- ne porte QUE sur les
// domaines REQUIS par le type de la session (`common` en est toujours
// exclu, voir server/advisoryRuleExecutions.js, resolveGlobalAnalysisState).
export const GLOBAL_ANALYSIS_STATES = {
  not_analyzed: 'Non analysée',
  up_to_date: 'À jour',
  partial: 'Partielle',
  stale: 'Obsolète',
  unavailable: 'Indisponible',
  error: 'En erreur',
};

const chf = new Intl.NumberFormat('fr-CH', {
  style: 'currency',
  currency: 'CHF',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
export function fmtCHF(n) {
  return chf.format(Number(n) || 0);
}

export function fmtDate(d) {
  if (!d) return '—';
  const date = new Date(d + (d.length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleDateString('fr-CH');
}

export function fmtDateTime(d) {
  if (!d) return '—';
  const date = new Date(d.replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleString('fr-CH', { dateStyle: 'short', timeStyle: 'short' });
}
