// Miroir exact de FIXED_ONLY_BRANCHES dans server/commissionCalc.js — à
// resynchroniser manuellement si la liste évolue côté backend (même
// convention que lifeCommissionEstimate.js pour LIFE_COMMISSION_BRANCHES).
//
// Branches pour lesquelles AUCUN calcul automatique fondé sur la prime
// n'est jamais permis : la commission y est toujours un montant fixe en
// CHF, fourni par la compagnie et saisi/importé par le conseiller depuis
// la page Commissions — jamais générée automatiquement à la création du
// contrat, jamais dérivée d'un taux de commission.
export const FIXED_ONLY_BRANCHES = ['lamal', 'lca'];
