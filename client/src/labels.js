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
