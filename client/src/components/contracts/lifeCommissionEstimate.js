import { LIFE_COMPATIBLE_BRANCHES } from './lifePayload.js';

// Miroir exact de server/commissionCalc.js — à resynchroniser manuellement
// si ce fichier backend évolue (aucune modification du backend n'est faite
// dans ce lot au-delà de sa contrepartie). Le backend reste seul décideur du
// montant réellement enregistré ; cette fonction ne sert qu'à afficher un
// aperçu et à bloquer la soumission en amont si le calcul est requis mais
// impossible, afin d'éviter un aller-retour réseau inutile.
//
// LIFE_COMMISSION_BRANCHES est intentionnellement identique à
// LIFE_COMPATIBLE_BRANCHES (lifePayload.js) plutôt qu'une liste dupliquée,
// pour ne jamais diverger.
export const LIFE_COMMISSION_BRANCHES = LIFE_COMPATIBLE_BRANCHES;

export class LifeCommissionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LifeCommissionError';
  }
}

// Retourne le montant estimé de la commission d'acquisition (arrondi une
// seule fois, au centime), ou `null` si aucune commission ne doit être
// estimée (prime ou taux nul/absent, ou branche hors périmètre Vie — dans ce
// dernier cas l'aperçu générique existant reste seul responsable). Lève
// LifeCommissionError si la durée contractuelle est requise mais absente ou
// invalide (Vie périodique avec prime et taux positifs).
export function estimateLifeAcquisitionCommission({
  branch, annual_premium, payment_frequency, acq_commission_rate, policy_term_years,
}) {
  const premium = Number(annual_premium) || 0;
  const rate = Number(acq_commission_rate) || 0;
  if (!(premium > 0) || !(rate > 0)) return null;
  if (!LIFE_COMMISSION_BRANCHES.includes(branch)) return null;

  const isPeriodic = payment_frequency !== 'unique';
  if (isPeriodic) {
    const term = Number(policy_term_years);
    if (!Number.isInteger(term) || term <= 0) {
      throw new LifeCommissionError(
        'La durée contractuelle est nécessaire pour calculer la commission d’acquisition d’un contrat Vie.'
      );
    }
    return Math.round(premium * term * rate) / 100;
  }

  return Math.round(premium * rate) / 100;
}
