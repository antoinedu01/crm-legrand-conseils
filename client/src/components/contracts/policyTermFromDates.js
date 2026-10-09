import { wholeYearsCovered } from '../../../../shared/conventionRules.js';

// Calcule la durée contractuelle Vie (policy_term_years) en années pleines
// entre la date de début et la date d'échéance du contrat (form.start_date /
// form.end_date, format ISO AAAA-MM-JJ), pour préremplir le champ « Durée
// contractuelle » côté LifeFields sans jamais forcer une saisie manuelle
// existante — c'est à l'appelant (Contracts.jsx) de n'invoquer ce calcul que
// lorsque policy_term_years est encore vide.
//
// Même règle que tout le CRM (shared/conventionRules.js → wholeYearsCovered) :
// l'échéance est le dernier jour couvert, INCLUS — du 01.01.2026 au
// 31.12.2035 comme du 01.01.2026 au 01.01.2036, la durée est de 10 ans.
//
// Retourne un entier positif, ou null si les deux dates ne sont pas toutes
// les deux renseignées et valides, ou si la durée couverte est inférieure à
// une année pleine.
export function computePolicyTermYears(startDate, endDate) {
  if (!startDate || !endDate || endDate <= startDate) return null;
  return wholeYearsCovered(startDate, endDate);
}
