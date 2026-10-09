// Branches de contrat reconnues par le CRM (`contracts.branch`), partagées
// par les routes contrats et le module conventions — une seule liste.
export const BRANCHES = [
  'vie_3a', 'vie_3b', 'lamal', 'lca', 'lpp', 'hypotheque',
  'deces', 'incapacite', 'rc_menage', 'autre',
];

// Libellés utilisés dans les messages renvoyés par l'API (mêmes textes que
// client/src/labels.js → BRANCHES).
export const BRANCH_LABELS = {
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
