// Calcul de la commission d'acquisition d'un contrat (Lot I4.1), corrigé
// pour la LAMal/LCA (Lot « fixed-health-commission-model ») : constat —
// le CRM supposait jusqu'ici que TOUTE commission se calcule en pourcentage
// de la prime annuelle. Faux pour la LAMal et les complémentaires LCA, dont
// le montant est fixé par la compagnie selon la convention de courtage et
// ne se déduit d'AUCUNE formule ni grille tarifaire codée en dur — il doit
// être saisi ou importé tel quel dans le CRM (server/routes/commissions.js).
//
// Règle générale (branches hors LAMal/LCA) : commission = annual_premium ×
// acq_commission_rate / 100. annual_premium reste toujours une prime
// ANNUELLE (jamais multipliée par un facteur de fréquence de paiement —
// payment_frequency n'indique que le rythme de règlement de cette prime
// annuelle, sauf 'unique').
//
// Règle spécifique Vie (vie_3a / vie_3b) à primes périodiques (toute
// fréquence sauf 'unique') : la commission porte sur le volume contractuel
// total estimé (annual_premium × policy_term_years), jamais sur la seule
// prime d'une année. Pour une prime unique, aucune notion de durée ne
// s'applique : la formule générale reste utilisée telle quelle.

export const LIFE_COMMISSION_BRANCHES = ['vie_3a', 'vie_3b'];

// Branches pour lesquelles AUCUN calcul automatique fondé sur la prime
// n'est jamais permis : la commission y est toujours un montant fixe en
// CHF, fourni par la compagnie et saisi/importé par le conseiller — jamais
// dérivé de annual_premium × un taux. Référencée à la fois par
// computeAcquisitionCommission ci-dessous (aucune génération automatique à
// la création du contrat) et par server/routes/commissions.js (mode de
// commission par défaut, et mode 'percentage' refusé pour ces branches).
export const FIXED_ONLY_BRANCHES = ['lamal', 'lca'];

export const COMMISSION_MODES = ['fixed_amount', 'percentage', 'manual_adjustment'];

export class CommissionCalcError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CommissionCalcError';
  }
}

// Mode de commission proposé par défaut pour une branche donnée : montant
// fixe pour la LAMal/LCA (aucun calcul automatique possible), pourcentage
// pour toutes les autres branches (comportement historique conservé — Lot
// I4.1 — là où ce mode reste utile).
export function defaultCommissionModeForBranch(branch) {
  return FIXED_ONLY_BRANCHES.includes(branch) ? 'fixed_amount' : 'percentage';
}

// Refuse le mode 'percentage' pour les branches LAMal/LCA : lève
// CommissionCalcError si l'appelant tente d'enregistrer une ligne de
// commission calculée en pourcentage de la prime pour l'une de ces
// branches. 'fixed_amount' et 'manual_adjustment' restent autorisés (aucun
// des deux ne calcule automatiquement un montant à partir de la prime).
export function assertCommissionModeAllowed(branch, mode) {
  if (FIXED_ONLY_BRANCHES.includes(branch) && mode === 'percentage') {
    throw new CommissionCalcError(
      'Le mode « pourcentage » n’est pas autorisé pour les branches LAMal/LCA : aucun calcul automatique fondé sur la prime n’est permis pour ces branches. Utilisez un montant fixe (CHF) fourni par la compagnie.'
    );
  }
}

// Retourne le montant de la commission d'acquisition (arrondi une seule
// fois, au centime), ou `null` si aucune commission ne doit être générée
// automatiquement — prime ou taux nul/absent, OU branche LAMal/LCA
// (FIXED_ONLY_BRANCHES : jamais de génération automatique, la commission y
// est toujours saisie manuellement en montant fixe, cf. en-tête de fichier)
// — jamais une valeur inventée. Lève CommissionCalcError si la durée
// contractuelle est requise mais absente ou invalide (Vie périodique avec
// prime et taux positifs).
export function computeAcquisitionCommission({
  branch, annual_premium, payment_frequency, acq_commission_rate, policy_term_years,
}) {
  if (FIXED_ONLY_BRANCHES.includes(branch)) return null;

  const premium = Number(annual_premium) || 0;
  const rate = Number(acq_commission_rate) || 0;
  if (!(premium > 0) || !(rate > 0)) return null;

  const isLifeBranch = LIFE_COMMISSION_BRANCHES.includes(branch);
  const isPeriodic = payment_frequency !== 'unique';

  if (isLifeBranch && isPeriodic) {
    const term = Number(policy_term_years);
    if (!Number.isInteger(term) || term <= 0) {
      throw new CommissionCalcError(
        'La durée contractuelle est nécessaire pour calculer la commission d’acquisition d’un contrat Vie.'
      );
    }
    return Math.round(premium * term * rate) / 100;
  }

  return Math.round(premium * rate) / 100;
}
