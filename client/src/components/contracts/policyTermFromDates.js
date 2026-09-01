// Calcule la durée contractuelle Vie (policy_term_years) en années pleines
// entre la date de début et la date d'échéance du contrat (form.start_date /
// form.end_date, format ISO AAAA-MM-JJ), pour préremplir le champ « Durée
// contractuelle » côté LifeFields sans jamais forcer une saisie manuelle
// existante — c'est à l'appelant (Contracts.jsx) de n'invoquer ce calcul que
// lorsque policy_term_years est encore vide.
//
// Retourne un entier positif (années pleines écoulées entre les deux dates,
// à la manière d'un calcul d'âge), ou null si les deux dates ne sont pas
// toutes les deux renseignées et valides, ou si l'échéance ne suit pas
// strictement le début.
export function computePolicyTermYears(startDate, endDate) {
  if (!startDate || !endDate) return null;

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (end <= start) return null;

  let years = end.getUTCFullYear() - start.getUTCFullYear();
  const endMonthDay = end.getUTCMonth() * 100 + end.getUTCDate();
  const startMonthDay = start.getUTCMonth() * 100 + start.getUTCDate();
  if (endMonthDay < startMonthDay) years -= 1;

  return years > 0 ? years : null;
}
