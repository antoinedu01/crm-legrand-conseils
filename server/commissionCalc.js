// Calcul de la commission d'acquisition d'un contrat (Lot I4.1).
//
// Règle générale (toutes branches) : commission = annual_premium × acq_commission_rate / 100.
// annual_premium reste toujours une prime ANNUELLE (jamais multipliée par un
// facteur de fréquence de paiement — payment_frequency n'indique que le
// rythme de règlement de cette prime annuelle, sauf 'unique').
//
// Règle spécifique Vie (vie_3a / vie_3b) à primes périodiques (toute
// fréquence sauf 'unique') : la commission porte sur le volume contractuel
// total estimé (annual_premium × policy_term_years), jamais sur la seule
// prime d'une année. Pour une prime unique, aucune notion de durée ne
// s'applique : la formule générale reste utilisée telle quelle.

export const LIFE_COMMISSION_BRANCHES = ['vie_3a', 'vie_3b'];

export class CommissionCalcError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CommissionCalcError';
  }
}

// Retourne le montant de la commission d'acquisition (arrondi une seule
// fois, au centime), ou `null` si aucune commission ne doit être générée
// (prime ou taux nul/absent — jamais une valeur inventée). Lève
// CommissionCalcError si la durée contractuelle est requise mais absente ou
// invalide (Vie périodique avec prime et taux positifs).
export function computeAcquisitionCommission({
  branch, annual_premium, payment_frequency, acq_commission_rate, policy_term_years,
}) {
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
