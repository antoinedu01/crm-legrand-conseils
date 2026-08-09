// Libellés PURS de la Synthèse Santé (SYNTH-UI1, Legrand Diagnostic 360) --
// AUCUNE dépendance React/DOM, AUCUN import depuis `server/**` (ce module est
// embarqué tel quel dans le bundle navigateur par Vite -- un import serveur
// romprait le build ou embarquerait du code Node inutile/dangereux dans le
// client). Testable directement via `node --test`
// (test/health-synthesis-labels.test.js), même convention que
// `sessionRecommendationsPure.js` (Lot 7B).
//
// Table exhaustive validée pendant le cadrage SYNTH-UI0, transcrite ici sans
// aucune modification de libellé -- toute valeur normalisée réellement émise
// par `server/advisoryHealthSynthesis.js` doit y figurer.

// -----------------------------------------------------------------------
// Valeurs normalisées de champ -- table PLATE (une valeur, un libellé) :
// aucune valeur normalisée ne porte un sens différent selon le champ qui la
// produit (vérifié à l'implémentation par lecture directe du moteur), donc
// jamais besoin d'une table par champ.
export const NORMALIZED_VALUE_LABELS = {
  // Accident
  maintien_potentiellement_adapte: 'Maintien de la couverture actuelle potentiellement adapté',
  retrait_potentiellement_examinable: 'Retrait de la couverture accident LAMal potentiellement examinable',
  not_applicable_accident_not_included: 'Accident non couvert par la LAMal (déclaré)',
  // Franchise
  elevee_potentiellement_adaptee: 'Franchise élevée potentiellement adaptée',
  prudente_a_examiner: 'Orientation prudente à examiner',
  indeterminee: 'Orientation indéterminée',
  alignee: 'Semble alignée avec la situation actuelle',
  ecart_a_examiner: 'Écart à examiner',
  a_contextualiser: 'À contextualiser',
  comparaison_impossible: 'Comparaison impossible',
  // Priorité coût / liberté
  reduire_prime: 'Priorité à la réduction de prime',
  equilibre: 'Équilibre coût / liberté',
  maximiser_liberte: 'Priorité à la liberté de choix',
  // Médecin actuel
  important_a_conserver: 'Important à conserver',
  // `non_prioritaire` sert à la fois pour "médecin actuel", "libre choix" et
  // les complémentaires -- une seule entrée, même sens partout (vérifié à
  // l'implémentation).
  non_prioritaire: 'Non prioritaire',
  pas_de_medecin_habituel: 'Pas de médecin habituel déclaré',
  indifferent: 'Indifférent',
  // Modèles de soins (télémédecine / médecin de famille / HMO)
  compatible: 'Compatible',
  preferee: 'Préféré',
  refusee: 'Refusé',
  prioritaire: 'Prioritaire',
  // Complémentaires
  a_examiner: 'À examiner',
};

// -----------------------------------------------------------------------
// Codes de warning (accident.warnings / care_model.warnings /
// complementary_needs.warnings) -- jamais le mot technique `code` affiché
// directement.
export const WARNING_CODE_LABELS = {
  doublon_potentiel: 'Doublon de couverture potentiel',
  lacune_couverture: 'Lacune de couverture à vérifier',
  parcours_impose_vs_refus: 'Parcours de soins imposé malgré un refus déclaré',
  risque_rupture_couverture: 'Risque de rupture de couverture à vérifier',
};

// -----------------------------------------------------------------------
// `dimension` porté par `member.warnings[*]` (rollup, voir
// `server/advisoryHealthSynthesis.js`) -- utilisé pour l'indicateur visuel
// par bloc ET pour le texte "— <bloc>" dans la section Points de vigilance.
export const WARNING_DIMENSION_LABELS = {
  accident: 'Accident',
  care_model: 'Modèle de soins',
  complementary_needs: 'Complémentaires',
};

// -----------------------------------------------------------------------
// `missing_stable_keys` (completeness.by_dimension[*]) -- 20 clés stables
// réellement utilisées par le moteur pour Diagnostic Santé v2 (accident : 3,
// franchise : 5 -- 4 orientation + 1 actuelle --, modèle de soins : 6, 6
// complémentaires). Table statique acceptée pour ce sous-lot (SYNTH-UI1 §4C)
// car la Synthèse Santé ne supporte QUE Diagnostic Santé v2 -- jamais un
// second appel API questionnaire pour ces textes. Voir
// test/health-synthesis-labels.test.js pour la garde de couverture (vérifie
// que chacune de ces clés existe réellement dans le questionnaire v2 publié).
export const MISSING_STABLE_KEY_LABELS = {
  couverture_accident_hors_lamal_declaree: 'Couverture accident hors LAMal',
  couverture_accident_laa_employeur_declaree: "Couverture accident LAA par l'employeur",
  accident_inclus_lamal_declare: 'Couverture accident incluse dans la LAMal',
  franchise_actuelle_niveau_declare: 'Franchise actuelle',
  capacite_absorber_depense_annuelle: 'Capacité financière à absorber une dépense annuelle importante',
  tolerance_risque_financier: 'Tolérance au risque financier',
  recours_soins_12_mois_declare: 'Recours aux soins sur les 12 derniers mois',
  depenses_sante_anticipees_declare: 'Dépenses de santé anticipées',
  priorite_prime_liberte_declaree: 'Priorité entre prime et liberté de choix',
  importance_conserver_medecin_declaree: 'Importance de conserver le médecin actuel',
  ouverture_telemedecine_declaree: 'Préférence pour la télémédecine',
  ouverture_medecin_famille_declaree: 'Préférence pour le modèle médecin de famille',
  ouverture_hmo_reseau_declaree: 'Préférence pour un réseau HMO',
  priorite_libre_choix_declaree: 'Importance du libre choix',
  interet_complementaire_hospitalisation_declare: 'Intérêt pour une complémentaire hospitalisation',
  interet_medecines_complementaires_declare: 'Intérêt pour les médecines complémentaires',
  interet_complementaire_optique_declare: 'Intérêt pour une complémentaire optique',
  interet_complementaire_dentaire_declare: 'Intérêt pour une complémentaire dentaire',
  interet_prevention_declare: 'Intérêt pour la prévention',
  interet_couverture_voyage_declare: 'Intérêt pour une couverture voyage',
};

// -----------------------------------------------------------------------
// analysis_status (§7 SYNTH-UI1) -- libellé + classe de tonalité CSS
// (réutilise directement les classes `.badge good/warn/info` déjà définies
// dans styles.css, jamais une modification de la table `TONES` partagée de
// `components/ui.jsx`, hors périmètre autorisé de ce sous-lot).
export const ANALYSIS_STATUS_LABELS = {
  current: 'Analyse à jour',
  stale: 'Analyse à relancer',
  not_run: 'Analyse non exécutée',
};
export const ANALYSIS_STATUS_TONES = {
  current: 'good',
  stale: 'warn',
  not_run: 'info',
};

// -----------------------------------------------------------------------
// completeness.overall / by_dimension[*].state (§8) -- `blocked_by_missing_
// information` reste en tonalité `warn` (pas `critical`) : un manque
// d'information n'est jamais présenté comme une erreur (cohérent avec le
// vocabulaire imposé, §6 SYNTH-UI0).
export const COMPLETENESS_LABELS = {
  complete: 'Informations complètes',
  partial: 'Informations partielles',
  blocked_by_missing_information: 'Informations incomplètes',
};
export const COMPLETENESS_TONES = {
  complete: 'good',
  partial: 'warn',
  blocked_by_missing_information: 'warn',
};

// -----------------------------------------------------------------------
// Résolution SANS repli technique -- un identifiant inconnu ne doit jamais
// s'afficher tel quel (décision explicite SYNTH-UI1 §4) : `console.error`
// rend le problème détectable en développement/test sans jamais faire
// planter l'écran d'un conseiller en plein rendez-vous. S'applique à TOUTE
// résolution d'identifiant technique de ce module, sans exception -- un
// premier passage (correction post-revue compliance-privacy-reviewer)
// laissait `analysis_status`/`completeness.overall` en dehors de cette
// garantie (`map[clé] || clé` directement dans le composant) ; désormais
// unifié via les deux fonctions ci-dessous, seul point d'accès à ces deux
// tables depuis la page.
function safeLookup(map, key, kind) {
  const label = map[key];
  if (label == null) {
    console.error(`[healthSynthesisLabels] ${kind} inconnu(e) : "${key}" -- aucun libellé français défini.`);
    return null;
  }
  return label;
}

export function labelForAnalysisStatus(status) {
  return safeLookup(ANALYSIS_STATUS_LABELS, status, 'analysis_status') ?? 'État d\'analyse inconnu';
}
export function toneForAnalysisStatus(status) {
  return ANALYSIS_STATUS_TONES[status] ?? '';
}
export function labelForCompleteness(state) {
  return safeLookup(COMPLETENESS_LABELS, state, 'état de complétude') ?? 'État de complétude inconnu';
}
export function toneForCompleteness(state) {
  return COMPLETENESS_TONES[state] ?? '';
}

export function labelForValue(value) {
  return safeLookup(NORMALIZED_VALUE_LABELS, value, 'valeur normalisée') ?? 'Valeur non reconnue';
}

export function labelForWarningCode(code) {
  return safeLookup(WARNING_CODE_LABELS, code, 'code de warning') ?? 'Point de vigilance';
}

export function labelForMissingKey(stableKey) {
  return safeLookup(MISSING_STABLE_KEY_LABELS, stableKey, 'stable_key manquante') ?? 'Information nécessaire';
}

export function labelForDimension(dimension) {
  return safeLookup(WARNING_DIMENSION_LABELS, dimension, 'dimension de warning') ?? 'Autre';
}

// -----------------------------------------------------------------------
// Correction UX critique (SYNTH-UI1 §2) : NULL != MISSING. Un champ dérivé
// à `value: null` ne signifie jamais automatiquement "information
// insuffisante" -- distingue explicitement une conclusion dérivée VOLONTAIREMENT
// absente parce que l'analyse n'est pas `current` (stale/not_run) d'une
// vraie donnée manquante. Fonction PURE, sans accès DOM, prend le champ du
// DTO `{value, provenance}` et l'`analysis_status` global de la synthèse.
//
// Limite assumée (disclosed) : quand `analysis_status !== 'current'` et
// qu'un champ est `null`/`unknown` PARCE QUE la réponse déclarante
// elle-même n'a jamais été saisie (cas rare -- la plupart des champs ont un
// repli déclaratif toujours disponible, seuls `franchise.orientation` et
// `franchise.current_comparison` n'en ont aucun par construction), le texte
// "Disponible après relance/exécution de l'analyse" reste affiché même si
// relancer l'analyse ne suffira pas à faire apparaître une conclusion tant
// que la réponse sous-jacente manque -- ce cas reste correctement signalé
// par ailleurs dans la section "Informations manquantes" (§11), qui ne
// dépend jamais de cette fonction.
export function describeSynthesisField(field, analysisStatus) {
  const { value, provenance } = field;
  if (value != null) {
    return { text: labelForValue(value), isDeclaredPreference: provenance === 'declared_answer' };
  }
  if (provenance === 'not_applicable') {
    return { text: 'Non applicable', isDeclaredPreference: false };
  }
  // provenance === 'unknown' (ou tout défaut défensif) -- jamais confondu
  // avec une valeur manquante tant que l'analyse n'est pas `current`.
  if (analysisStatus === 'stale') {
    return { text: "Disponible après relance de l'analyse", isDeclaredPreference: false };
  }
  if (analysisStatus === 'not_run') {
    return { text: "Disponible après exécution de l'analyse", isDeclaredPreference: false };
  }
  return { text: 'Information insuffisante', isDeclaredPreference: false };
}

// -----------------------------------------------------------------------
// "Informations manquantes" (§11) -- déduplique et trie de façon
// déterministe l'union des `missing_stable_keys` de toutes les dimensions,
// puis résout chaque clé vers son libellé français.
export function collectMissingInfoLabels(byDimension) {
  const keys = new Set();
  for (const dim of Object.values(byDimension || {})) {
    for (const key of dim.missing_stable_keys || []) keys.add(key);
  }
  return [...keys].sort().map((key) => ({ key, label: labelForMissingKey(key) }));
}

// -----------------------------------------------------------------------
// "Points de vigilance" (§12) -- source UNIQUE `member.warnings` (rollup déjà
// dédupliqué/trié par le moteur), jamais les trois tableaux dimensionnels
// séparément (éviterait un doublon de texte, contrainte explicite SYNTH-UI1
// §B/§12).
export function formatVigilanceItems(memberWarnings) {
  return (memberWarnings || []).map((w) => ({
    key: `${w.code}-${(w.source_finding_ids || []).join(',')}`,
    text: labelForWarningCode(w.code),
    dimensionLabel: labelForDimension(w.dimension),
  }));
}

// -----------------------------------------------------------------------
// Indicateur visuel discret par bloc (§12) -- un bloc porte l'indicateur dès
// que le tableau dimensionnel correspondant contient au moins un warning ;
// ne sert JAMAIS à afficher le texte lui-même (uniquement dans
// formatVigilanceItems ci-dessus, source member.warnings).
export function hasVigilance(dimensionWarnings) {
  return !!(dimensionWarnings && dimensionWarnings.length > 0);
}

// -----------------------------------------------------------------------
// Résolution du message d'erreur affiché au conseiller (correction
// post-validation humaine SYNTH-UI1, sous-lot corrections §2) -- SEUL point
// de résolution, centralisé ici plutôt que dans la page, pour ne jamais
// dépendre d'un oubli local. Pour les 3 cas explicitement connus (session
// introuvable, domaine non Santé, version non supportée), un texte fixe.
// Pour TOUT AUTRE statut/code -- y compris l'absence de statut (échec réseau
// avant réponse serveur) -- un texte générique fixe, qui ne dérive JAMAIS de
// `error.message`/`error.data.message`/`error.data.details` ni d'aucun autre
// champ de l'erreur d'origine : ces champs peuvent porter un message serveur
// interne (ex. une erreur SQL) ou, pour `details`, des informations
// techniques (numéros de version) jamais destinées à un texte utilisateur
// générique. Aucune information technique n'est journalisée ici (aucune
// convention existante de `console.error` sur une erreur réseau affichée
// ailleurs dans l'application -- toutes les pages sœurs affichent
// `error.message` directement sans jamais le journaliser en plus).
export function resolveSynthesisErrorMessage(error) {
  if (error?.status === 404) return 'Session introuvable.';
  if (error?.status === 400) return "La synthèse Santé n'est pas disponible pour cette session.";
  if (error?.status === 409 && error?.data?.code === 'HEALTH_SYNTHESIS_UNSUPPORTED_VERSION') {
    return 'Cette session utilise une ancienne version du Diagnostic Santé. La synthèse reste disponible uniquement pour les sessions Santé v2.';
  }
  return 'Impossible de charger la synthèse Santé pour le moment.';
}
