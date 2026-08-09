// Contenu métier réel Assurance Maladie — LOT 5 phase 1 (Legrand Diagnostic
// 360). Provisionne un questionnaire et un ensemble de règles en état
// BROUILLON via le mécanisme de contenu configuré déjà existant
// (`server/advisoryQuestionnaires.js`, `server/advisoryRules.js`) — même
// principe que `server/seed-demo.js` : un script autonome, idempotent,
// aucune nouvelle table ni migration. Rien n'est publié ici : la publication
// réelle reste une décision humaine distincte, conditionnée à une validation
// juridique et métier séparée (voir docs/advisory/HEALTH_LOT5_CONTENT.md).
import db from './db.js';
import { createQuestionnaire, createDraftVersion as createQuestionnaireDraftVersion, upsertSection, upsertQuestion, upsertOption } from './advisoryQuestionnaires.js';
import { createRuleSet, upsertRule } from './advisoryRules.js';

export const QUESTIONNAIRE_STABLE_KEY = 'diagnostic-sante-phase1';
export const RULE_SET_STABLE_KEY = 'regles-sante-phase1';

// Correction apportée lors de la validation humaine du dossier
// d'approbation : la référence initiale citait à tort l'art. 3 al. 2 LAMal
// (retirée, elle ne constitue pas la base légale de la suspension du risque
// accident) et ne portait aucune date de consultation. Base officielle
// retenue par la décision humaine : OFSP, page « Assurés pouvant suspendre
// le risque accidents » — art. 8 al. 1 LAMal (suspension sur demande) et
// art. 11 OAMal (procédure). La date de consultation est portée par
// `source_reference`, jamais par `effective_from` (qui reste la date
// d'entrée en vigueur du contenu de la règle, une notion distincte). Le
// champ `source` est plafonné à 300 caractères (`checkTextFields`,
// `server/advisoryRules.js`) — texte volontairement concis, jamais tronqué
// silencieusement.
const SOURCE_OFSP_ACCIDENT = 'Office fédéral de la santé publique (OFSP) — page « Assurés pouvant suspendre le risque accidents » : suspension de l’accident LAMal uniquement sur demande (art. 8 al. 1 LAMal), preuve d’une couverture LAA complète requise (art. 11 OAMal). Jamais automatique ; décision finale de l’assureur.';
const SOURCE_REF_OFSP_ACCIDENT = 'OFSP — page « Assurés pouvant suspendre le risque accidents » — art. 8 al. 1 LAMal (suspension sur demande) et art. 11 OAMal (procédure de suspension). Consultée le 2026-08-04.';
const SOURCE_INTERNAL = 'Référence interne — méthodologie de conseil Legrand Conseils, à valider par un spécialiste métier avant mise en production.';
const SOURCE_REF_INTERNAL = 'Note méthodologique interne — non une source légale.';
const EFFECTIVE_FROM = '2026-08-03';

function questionSpec({ stable_key, advisor_text, client_text, sensitive, sort_order, options }) {
  return {
    stable_key,
    advisor_text,
    client_text,
    type: 'single_choice',
    scope: 'member',
    // required: false — délibéré : ce noyau phase 1 est conçu pour tolérer
    // des réponses partielles par question (le mécanisme missing_information
    // du moteur signale déjà correctement, par RÈGLE, ce qui manque pour
    // conclure — imposer les 9 réponses avant toute finalisation de session
    // bloquerait inutilement un conseiller qui n'a pu couvrir qu'une partie
    // du noyau lors d'un entretien).
    required: false,
    allows_unknown: true,
    sensitive,
    sort_order,
    options,
  };
}

const OUI_NON = [
  { stable_key: 'oui', label: 'Oui', value: 'oui' },
  { stable_key: 'non', label: 'Non', value: 'non' },
];

const NIVEAU_3 = (labels) => [
  { stable_key: labels[0], label: labels[0][0].toUpperCase() + labels[0].slice(1), value: labels[0] },
  { stable_key: labels[1], label: labels[1][0].toUpperCase() + labels[1].slice(1), value: labels[1] },
  { stable_key: labels[2], label: labels[2][0].toUpperCase() + labels[2].slice(1), value: labels[2] },
];

// Les 9 questions de la matrice verrouillée. Le choix « inconnue » n'est
// délibérément PAS ajouté comme option de choix : le moteur dispose déjà
// d'un mécanisme natif pour « je ne sais pas » (allows_unknown / is_unknown,
// `docs/advisory/QUESTIONNAIRE_ENGINE.md` §2), qui produit un statut de
// réponse `unknown` — non compté comme « présent » pour `required_data`
// (`docs/advisory/RULES_ENGINE.md` §8) et déclenche donc correctement le
// comportement `missing_information` automatique du moteur. Ajouter
// « inconnue » comme option choisie produirait au contraire un statut
// `answered` (valeur = "inconnue") — compté comme présent, ce qui NE
// produirait PAS `missing_information` et contredirait l'exigence explicite
// du brief verrouillé (§3/§8 : « l'état inconnue doit déclencher le
// comportement missing_information normal du moteur »). Voir le rapport
// final, section « corrections apportées », pour la justification complète
// de cette substitution — décision assumée, pas silencieuse.
const QUESTIONS = [
  questionSpec({
    stable_key: 'couverture_accident_hors_lamal_declaree',
    advisor_text: 'La personne dispose-t-elle actuellement d’une couverture accident valable en dehors de son assurance de base LAMal ?',
    client_text: 'Êtes-vous actuellement couvert contre les accidents par votre employeur ou par une autre assurance en dehors de votre assurance-maladie de base ?',
    sensitive: false,
    sort_order: 1,
    options: OUI_NON,
  }),
  questionSpec({
    stable_key: 'accident_inclus_lamal_declare',
    advisor_text: 'L’accident est-il inclus dans la couverture LAMal actuelle de la personne ?',
    client_text: 'Votre assurance de base couvre-t-elle aussi les accidents ?',
    sensitive: false,
    sort_order: 2,
    options: OUI_NON,
  }),
  questionSpec({
    stable_key: 'franchise_actuelle_niveau_declare',
    advisor_text: 'Niveau de franchise actuelle déclaré (catégoriel, sans montant précis).',
    client_text: 'Votre franchise actuelle est-elle plutôt basse, moyenne ou élevée ?',
    sensitive: true,
    sort_order: 3,
    options: NIVEAU_3(['basse', 'moyenne', 'elevee']),
  }),
  questionSpec({
    stable_key: 'capacite_absorber_depense_annuelle',
    advisor_text: 'Capacité déclarée à absorber une dépense de santé annuelle importante.',
    client_text: 'Pourriez-vous absorber une dépense de santé imprévue importante sur une année ?',
    sensitive: true,
    sort_order: 4,
    options: NIVEAU_3(['faible', 'moyenne', 'elevee']),
  }),
  questionSpec({
    stable_key: 'tolerance_risque_financier',
    advisor_text: 'Niveau de tolérance au risque financier déclaré par la personne (échelle à trois niveaux : faible, moyenne, élevée).',
    // Correction apportée lors de la validation humaine du dossier
    // d'approbation : le texte précédent posait une alternative binaire
    // (prime stable / économiser) incohérente avec les 3 options réelles de
    // la question (faible/moyenne/élevée) — reformulé pour interroger
    // directement le niveau, cohérent avec l'échelle à trois niveaux.
    client_text: 'Quel niveau de risque financier êtes-vous prêt(e) à assumer en cas de dépenses de santé imprévues ?',
    sensitive: false,
    sort_order: 5,
    options: NIVEAU_3(['faible', 'moyenne', 'elevee']),
  }),
  questionSpec({
    stable_key: 'parcours_premier_contact_obligatoire_declare',
    advisor_text: 'Le modèle LAMal actuel impose-t-il de contacter en premier un interlocuteur désigné ?',
    client_text: 'Votre modèle d’assurance actuel vous demande-t-il de contacter d’abord un interlocuteur désigné, par exemple une télémédecine, un médecin de famille ou un réseau de soins ?',
    sensitive: false,
    sort_order: 6,
    options: OUI_NON,
  }),
  questionSpec({
    stable_key: 'refus_parcours_impose_declare',
    advisor_text: 'Le client exprime-t-il un refus ou une difficulté à respecter un parcours de soins imposé ?',
    // Aligné sur l'advisor_text (difficulté réellement vécue ou anticipée),
    // plutôt qu'une question de préférence générale (« tenez-vous à consulter
    // librement ? ») qui obtiendrait quasi systématiquement « oui » et
    // biaiserait la règle D vers un déclenchement quasi automatique — revue
    // health-insurance-domain, correction appliquée.
    client_text: 'Avez-vous déjà eu, ou anticipez-vous, une difficulté concrète à respecter ce point de passage obligé ?',
    sensitive: false,
    sort_order: 7,
    options: OUI_NON,
  }),
  questionSpec({
    stable_key: 'intention_resilier_complementaire_declare',
    advisor_text: 'Intention déclarée de résilier une complémentaire actuelle.',
    client_text: 'Envisagez-vous de résilier votre complémentaire actuelle ?',
    sensitive: true,
    sort_order: 8,
    options: OUI_NON,
  }),
  questionSpec({
    stable_key: 'acceptation_nouvelle_complementaire_confirmee',
    advisor_text: 'Acceptation définitive d’une nouvelle complémentaire déjà confirmée ?',
    client_text: 'Avez-vous déjà reçu une confirmation d’acceptation de la nouvelle complémentaire ?',
    sensitive: true,
    sort_order: 9,
    options: OUI_NON,
  }),
];

function memberAny(subCondition) {
  return { op: 'any', over: 'members', condition: subCondition };
}
function eq(stableKey, value) {
  return { op: 'equals', ref: { answer: stableKey }, value };
}

// Les 5 règles verrouillées. Toutes finding_scope: member, racine `any` sur
// les membres (jamais `all` : chaque situation est individuelle, un finding
// par membre réellement concerné, jamais une attribution au foyer entier).
const RULES = [
  {
    stable_key: 'accident-coordination-doublon-01',
    title: 'Coordination accident — doublon potentiel',
    category_hint: 'accident_coordination',
    result_finding_type: 'warning',
    priority: 'medium',
    conditions: memberAny({
      op: 'and',
      conditions: [
        eq('couverture_accident_hors_lamal_declaree', 'oui'),
        eq('accident_inclus_lamal_declare', 'oui'),
      ],
    }),
    required_data: [
      { answer: 'couverture_accident_hors_lamal_declaree' },
      { answer: 'accident_inclus_lamal_declare' },
    ],
    advisor_explanation: 'Une couverture accident hors LAMal est déclarée et l’accident est également inclus dans la couverture LAMal actuelle — une coordination paraît nécessaire. Ne jamais conclure automatiquement à la suppression de l’accident de la LAMal : la couverture extérieure doit être vérifiée (demande et preuve peuvent être nécessaires auprès de l’assureur), et la décision finale appartient au conseiller et à l’assureur.',
    client_explanation: 'Votre couverture accident pourrait être doublée entre une couverture extérieure et votre assurance de base — à vérifier ensemble avant toute démarche.',
    warnings: ['Nécessite une vérification de la couverture extérieure réelle (demande et preuve éventuelles auprès de l’assureur) avant toute décision.'],
    source: SOURCE_OFSP_ACCIDENT,
    source_reference: SOURCE_REF_OFSP_ACCIDENT,
  },
  {
    stable_key: 'accident-coverage-gap-01',
    title: 'Coordination accident — absence potentielle de couverture',
    category_hint: 'accident_coverage_gap',
    result_finding_type: 'gap',
    priority: 'high',
    conditions: memberAny({
      op: 'and',
      conditions: [
        eq('couverture_accident_hors_lamal_declaree', 'non'),
        eq('accident_inclus_lamal_declare', 'non'),
      ],
    }),
    required_data: [
      { answer: 'couverture_accident_hors_lamal_declaree' },
      { answer: 'accident_inclus_lamal_declare' },
    ],
    advisor_explanation: 'Aucune couverture accident n’a été identifiée à partir des réponses (ni hors LAMal, ni incluse dans la LAMal actuelle). Une vérification rapide est nécessaire — ce constat ne constitue jamais une conclusion juridique définitive sur le régime légal applicable à ce profil.',
    client_explanation: 'Vous pourriez ne pas être couvert(e) en cas d’accident actuellement — point à clarifier rapidement avec votre conseiller.',
    warnings: ['Ne qualifie jamais l’obligation légale de couverture accident du profil concerné — signale uniquement une combinaison de réponses à vérifier.'],
    source: SOURCE_OFSP_ACCIDENT,
    source_reference: SOURCE_REF_OFSP_ACCIDENT,
  },
  {
    stable_key: 'franchise-capacite-financiere-01',
    title: 'Franchise et capacité financière',
    category_hint: 'franchise_financial_risk',
    result_finding_type: 'detected_need',
    priority: 'medium',
    conditions: memberAny({
      op: 'and',
      conditions: [
        eq('franchise_actuelle_niveau_declare', 'elevee'),
        {
          op: 'or',
          conditions: [
            eq('capacite_absorber_depense_annuelle', 'faible'),
            eq('tolerance_risque_financier', 'faible'),
          ],
        },
      ],
    }),
    required_data: [
      { answer: 'franchise_actuelle_niveau_declare' },
      { answer: 'capacite_absorber_depense_annuelle' },
      { answer: 'tolerance_risque_financier' },
    ],
    advisor_explanation: 'Franchise actuelle déclarée élevée alors que la capacité à absorber une dépense annuelle et/ou la tolérance au risque financier sont déclarées faibles — la combinaison mérite une analyse avec le conseiller. Ne jamais recommander automatiquement une franchise précise, ne jamais calculer une économie, ne jamais déclarer qu’une franchise est mauvaise, ne jamais choisir automatiquement une option.',
    client_explanation: 'Votre franchise actuelle pourrait ne plus correspondre à votre situation financière déclarée — à voir ensemble.',
    warnings: ['Jamais une économie garantie — jugement de conseil, pas un calcul certain.'],
    source: SOURCE_INTERNAL,
    source_reference: SOURCE_REF_INTERNAL,
  },
  {
    stable_key: 'modele-soins-comportement-01',
    title: 'Parcours de soins et comportement',
    category_hint: 'care_model_compatibility',
    result_finding_type: 'warning',
    priority: 'medium',
    conditions: memberAny({
      op: 'and',
      conditions: [
        eq('parcours_premier_contact_obligatoire_declare', 'oui'),
        eq('refus_parcours_impose_declare', 'oui'),
      ],
    }),
    required_data: [
      { answer: 'parcours_premier_contact_obligatoire_declare' },
      { answer: 'refus_parcours_impose_declare' },
    ],
    advisor_explanation: 'Le modèle actuel impose un point de contact obligatoire, alors qu’un refus explicite de ce type de parcours est déclaré — écart potentiel à examiner, sans jamais juger qu’un autre modèle serait objectivement meilleur.',
    client_explanation: 'Votre modèle actuel pourrait ne pas correspondre à la liberté de choix que vous recherchez — à clarifier ensemble.',
    warnings: [],
    source: SOURCE_INTERNAL,
    source_reference: SOURCE_REF_INTERNAL,
  },
  {
    stable_key: 'lca-continuite-resiliation-01',
    title: 'Continuité d’une complémentaire LCA',
    category_hint: 'lca_coverage_continuity',
    result_finding_type: 'warning',
    priority: 'high',
    conditions: memberAny({
      op: 'and',
      conditions: [
        eq('intention_resilier_complementaire_declare', 'oui'),
        eq('acceptation_nouvelle_complementaire_confirmee', 'non'),
      ],
    }),
    required_data: [
      { answer: 'intention_resilier_complementaire_declare' },
      { answer: 'acceptation_nouvelle_complementaire_confirmee' },
    ],
    advisor_explanation: 'Intention de résiliation déclarée sans acceptation définitive encore confirmée pour la nouvelle complémentaire — risque de rupture de continuité et de sélection médicale à rappeler avant toute résiliation effective. Ne jamais prédire l’issue de l’acceptation, ne jamais résilier un contrat, ne jamais choisir une complémentaire ou un assureur.',
    // Reformulé en observation neutre (« à vérifier ensemble »), plutôt
    // qu'une instruction impérative (« ne résiliez pas ») — cohérent avec le
    // ton des 4 autres textes client de ce noyau et avec le principe « jamais
    // de recommandation automatique » — revue health-insurance-domain,
    // correction appliquée.
    client_explanation: 'Un risque de rupture de couverture existe si la complémentaire actuelle est résiliée avant l’acceptation définitive de la nouvelle — point à vérifier ensemble avant toute démarche.',
    warnings: ['Ne prédit jamais l’issue d’une acceptation médicale.'],
    source: SOURCE_INTERNAL,
    source_reference: SOURCE_REF_INTERNAL,
  },
];

export function seedAdvisoryHealthContent(req = { session: { userEmail: 'système' } }) {
  const existingQuestionnaire = db.prepare('SELECT id FROM advisory_questionnaires WHERE stable_key = ?').get(QUESTIONNAIRE_STABLE_KEY);
  const existingRuleSet = db.prepare('SELECT id FROM advisory_rule_sets WHERE stable_key = ?').get(RULE_SET_STABLE_KEY);
  if (existingQuestionnaire || existingRuleSet) {
    return { created: false, reason: 'Contenu LOT 5 déjà provisionné (stable_key existante) — script ignoré (idempotent).' };
  }

  const { id: questionnaireId } = createQuestionnaire(
    { stable_key: QUESTIONNAIRE_STABLE_KEY, domain: 'health', name: 'Diagnostic Assurance Maladie — Phase 1 (LAMal/LCA)', description: 'LOT 5 phase 1 — contenu brouillon, non publié. Publication réelle conditionnée à une validation juridique et métier séparée (voir docs/advisory/HEALTH_LOT5_CONTENT.md).' },
    req
  );
  const { id: versionId } = createQuestionnaireDraftVersion(questionnaireId, { notes: 'LOT 5 phase 1 — noyau initial de 9 questions.' }, req);
  const { id: sectionId } = upsertSection(
    versionId,
    { stable_key: 'coordination-et-besoins-declares', title: 'Coordination et besoins déclarés (phase 1)', applies_to: 'member', sort_order: 1 },
    req
  );
  const questionIds = {};
  for (const q of QUESTIONS) {
    const { id: questionId } = upsertQuestion(sectionId, {
      stable_key: q.stable_key,
      advisor_text: q.advisor_text,
      client_text: q.client_text,
      type: q.type,
      scope: q.scope,
      required: q.required,
      allows_unknown: q.allows_unknown,
      sensitive: q.sensitive,
      sort_order: q.sort_order,
    }, req);
    questionIds[q.stable_key] = questionId;
    q.options.forEach((opt, i) => {
      upsertOption(questionId, { stable_key: opt.stable_key, label: opt.label, value: opt.value, sort_order: i + 1 }, req);
    });
  }

  const { id: ruleSetId } = createRuleSet(
    { stable_key: RULE_SET_STABLE_KEY, domain: 'health', name: 'Règles déterministes — Assurance Maladie phase 1', description: 'LOT 5 phase 1 — noyau initial de 5 règles, brouillon, non publié. Publication réelle conditionnée à une validation juridique et métier séparée.' },
    req
  );
  const ruleIds = {};
  RULES.forEach((r, i) => {
    const { id: ruleId } = upsertRule(ruleSetId, {
      stable_key: r.stable_key,
      title: r.title,
      conditions: r.conditions,
      required_data: r.required_data,
      result_finding_type: r.result_finding_type,
      result_payload: { category_hint: r.category_hint },
      priority: r.priority,
      finding_scope: 'member',
      advisor_explanation: r.advisor_explanation,
      client_explanation: r.client_explanation,
      warnings: r.warnings,
      source: r.source,
      source_reference: r.source_reference,
      effective_from: EFFECTIVE_FROM,
      sort_order: i + 1,
    }, req);
    ruleIds[r.stable_key] = ruleId;
  });

  return {
    created: true,
    questionnaireId,
    versionId,
    sectionId,
    questionIds,
    ruleSetId,
    ruleIds,
  };
}

// =============================================================================
// DIAGNOSTIC SANTÉ V2 (diagnostic-sante-phase1 v2 / regles-sante-phase1 v2)
// =============================================================================
// Nommé « Diagnostic Santé v2 » et non « LOT 7A », pour éviter toute
// collision avec le label « LOT 7A »/« LOT 7B » déjà utilisé par le dépôt
// pour la fonctionnalité (distincte) de recommandations humaines
// (`server/advisoryRecommendations.js`, `docs/advisory/IMPLEMENTATION_ROADMAP.md`)
// -- décision humaine explicite, voir
// `docs/advisory/HEALTH_DIAGNOSTIC_V2_CONTENT.md`.
//
// Décision humaine (cadrage v2) : v1 reste IMMUTABLE et reproductible —
// `seedAdvisoryHealthContent` ci-dessus n'est JAMAIS modifiée par ce bloc, et
// `seedAdvisoryHealthContentV2` ci-dessous n'écrit jamais dans les lignes v1
// (nouvelle VERSION du même questionnaire — `advisory_questionnaire_versions`,
// même `questionnaire_id` — et nouvelle VERSION du même rule_set — nouvelle
// ligne `advisory_rule_sets` partageant le même `stable_key`, jamais la même
// ligne). Comme v1, rien n'est publié ici : `publishVersion`/`publishRuleSet`
// ne sont JAMAIS appelées par ce script, décision humaine distincte.
import { createDraftVersion as createRuleSetDraftVersion } from './advisoryRules.js';

function labelize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).replace(/_/g, ' ');
}
function optionsFrom(values) {
  return values.map((v) => ({ stable_key: v, label: labelize(v), value: v }));
}
// Question v2 : même moule que v1 (scope member, unknown natif — jamais une
// option "Je ne sais pas" littérale, même raisonnement que ci-dessus) mais
// `required`/`display_condition` désormais explicitement portés par
// l'appelant (v1 les figeait à `required: false`/`null` pour tout le noyau ;
// v2 introduit une distinction CORE_REQUIRED/OPTIONAL/CONDITIONAL_REQUIRED,
// décision humaine du cadrage v2).
function questionSpecV2({ stable_key, advisor_text, client_text, sensitive, sort_order, options, required, display_condition }) {
  return {
    stable_key, advisor_text, client_text, type: 'single_choice', scope: 'member',
    required: !!required, allows_unknown: true, sensitive: !!sensitive, sort_order, options,
    display_condition: display_condition || null,
  };
}

const OUI_NON_V2 = optionsFrom(['oui', 'non']);

// --- Section 1 : coordination-et-besoins-declares (10 questions) -----------
// Les 9 premières RECONDUISENT exactement les stable_keys/textes de v1 (v1
// section `coordination-et-besoins-declares`, ci-dessus) — seules les
// métadonnées `required`/`display_condition` changent en v2 (décision
// humaine explicite : v1 tolérait des réponses partielles par conception,
// v2 introduit un noyau réellement obligatoire). La 10e est nouvelle
// (Q_LAA), conditionnelle à la déclaration d'une couverture accident hors
// LAMal.
// Ordre v2 arbitré par décision humaine (correction post-revue) : Q_LAA
// (nouvelle, conditionnelle à Q1) est déplacée immédiatement après Q1 --
// jamais en fin de section comme dans la première version de v2 -- pour
// suivre le même patron que Q6->Q7 et Q8->Q9 (une question conditionnelle
// suit toujours immédiatement sa question déclenchante). Seuls les
// `sort_order` changent ; `stable_key`, `options`, `display_condition` et
// `required` sont inchangés pour toutes les 10 questions.
const SECTION1_QUESTIONS_V2 = [
  questionSpecV2({
    stable_key: 'couverture_accident_hors_lamal_declaree',
    advisor_text: 'La personne dispose-t-elle actuellement d’une couverture accident valable en dehors de son assurance de base LAMal ?',
    client_text: 'Êtes-vous actuellement couvert contre les accidents par votre employeur ou par une autre assurance en dehors de votre assurance-maladie de base ?',
    sensitive: false, sort_order: 1, options: OUI_NON_V2, required: true,
  }),
  questionSpecV2({
    stable_key: 'couverture_accident_laa_employeur_declaree',
    advisor_text: 'Êtes-vous couvert contre les accidents non professionnels par l’assurance-accidents obligatoire (LAA) de votre employeur ?',
    client_text: 'Votre employeur vous couvre-t-il contre les accidents non professionnels via l’assurance-accidents obligatoire (LAA) ?',
    sensitive: false, sort_order: 2, options: OUI_NON_V2, required: true,
    display_condition: { op: 'equals', ref: { question: 'couverture_accident_hors_lamal_declaree' }, value: 'oui' },
  }),
  questionSpecV2({
    stable_key: 'accident_inclus_lamal_declare',
    advisor_text: 'L’accident est-il inclus dans la couverture LAMal actuelle de la personne ?',
    client_text: 'Votre assurance de base couvre-t-elle aussi les accidents ?',
    sensitive: false, sort_order: 3, options: OUI_NON_V2, required: true,
  }),
  questionSpecV2({
    stable_key: 'franchise_actuelle_niveau_declare',
    advisor_text: 'Niveau de franchise actuelle déclaré (catégoriel, sans montant précis).',
    client_text: 'Votre franchise actuelle est-elle plutôt basse, moyenne ou élevée ?',
    sensitive: true, sort_order: 4, options: optionsFrom(['basse', 'moyenne', 'elevee']), required: true,
  }),
  questionSpecV2({
    stable_key: 'capacite_absorber_depense_annuelle',
    // Formulation v2 corrigée post-revue (annonce explicitement l'échelle
    // attendue, même défaut déjà corrigé pour `tolerance_risque_financier`
    // en v1) -- décision humaine explicite : le texte v1 correspondant
    // (`QUESTIONS`, ci-dessus) reste STRICTEMENT INCHANGÉ, cette
    // reformulation ne s'applique qu'à la version 2. Voir
    // `docs/advisory/HEALTH_DIAGNOSTIC_V2_CONTENT.md` §4 pour la
    // documentation explicite de cette différence volontaire v1 -> v2.
    advisor_text: 'Comment le client évalue-t-il sa capacité financière à absorber une dépense de santé annuelle importante : faible, moyenne ou élevée ?',
    client_text: 'Comment évaluez-vous votre capacité financière à absorber une dépense de santé annuelle importante : faible, moyenne ou élevée ?',
    sensitive: true, sort_order: 5, options: optionsFrom(['faible', 'moyenne', 'elevee']), required: true,
  }),
  questionSpecV2({
    stable_key: 'tolerance_risque_financier',
    advisor_text: 'Niveau de tolérance au risque financier déclaré par la personne (échelle à trois niveaux : faible, moyenne, élevée).',
    client_text: 'Quel niveau de risque financier êtes-vous prêt(e) à assumer en cas de dépenses de santé imprévues ?',
    // sensitive=true en v2 UNIQUEMENT (v1 reste inchangée, sensitive=false
    // dans `QUESTIONS` ci-dessus) -- correction non ambiguë post-revue
    // compliance-privacy-reviewer : cette question porte sur le même objet
    // qu'un scénario de dépense de santé que `capacite_absorber_depense_annuelle`
    // et `franchise_actuelle_niveau_declare` (déjà sensitive=true, § doc
    // HEALTH_DIAGNOSTIC_V2_CONTENT.md §6ter), sans raison objective de la
    // traiter différemment. N'améliore que la protection (badge + entrée
    // d'audit supplémentaire) ; ne change aucun comportement fonctionnel ni
    // la ligne v1.
    sensitive: true, sort_order: 6, options: optionsFrom(['faible', 'moyenne', 'elevee']), required: true,
  }),
  questionSpecV2({
    stable_key: 'parcours_premier_contact_obligatoire_declare',
    advisor_text: 'Le modèle LAMal actuel impose-t-il de contacter en premier un interlocuteur désigné ?',
    client_text: 'Votre modèle d’assurance actuel vous demande-t-il de contacter d’abord un interlocuteur désigné, par exemple une télémédecine, un médecin de famille ou un réseau de soins ?',
    sensitive: false, sort_order: 7, options: OUI_NON_V2, required: false,
  }),
  questionSpecV2({
    stable_key: 'refus_parcours_impose_declare',
    advisor_text: 'Le client exprime-t-il un refus ou une difficulté à respecter un parcours de soins imposé ?',
    client_text: 'Avez-vous déjà eu, ou anticipez-vous, une difficulté concrète à respecter ce point de passage obligé ?',
    sensitive: false, sort_order: 8, options: OUI_NON_V2, required: true,
    display_condition: { op: 'equals', ref: { question: 'parcours_premier_contact_obligatoire_declare' }, value: 'oui' },
  }),
  questionSpecV2({
    stable_key: 'intention_resilier_complementaire_declare',
    advisor_text: 'Intention déclarée de résilier une complémentaire actuelle.',
    client_text: 'Envisagez-vous de résilier votre complémentaire actuelle ?',
    sensitive: true, sort_order: 9, options: OUI_NON_V2, required: false,
  }),
  questionSpecV2({
    stable_key: 'acceptation_nouvelle_complementaire_confirmee',
    advisor_text: 'Acceptation définitive d’une nouvelle complémentaire déjà confirmée ?',
    client_text: 'Avez-vous déjà reçu une confirmation d’acceptation de la nouvelle complémentaire ?',
    sensitive: true, sort_order: 10, options: OUI_NON_V2, required: true,
    display_condition: { op: 'equals', ref: { question: 'intention_resilier_complementaire_declare' }, value: 'oui' },
  }),
];

// --- Section 2 : usage-et-priorites (3 questions, toutes CORE_REQUIRED) ----
const SECTION2_QUESTIONS_V2 = [
  questionSpecV2({
    stable_key: 'recours_soins_12_mois_declare',
    advisor_text: 'Au cours des 12 derniers mois, comment qualifieriez-vous votre recours aux soins médicaux ?',
    client_text: 'Sur les 12 derniers mois, diriez-vous que vous avez eu recours aux soins médicaux de façon faible, modérée ou importante ?',
    sensitive: true, sort_order: 1, options: optionsFrom(['faible', 'modere', 'important']), required: true,
  }),
  questionSpecV2({
    stable_key: 'depenses_sante_anticipees_declare',
    advisor_text: 'Anticipez-vous des dépenses de santé régulières au cours des 12 prochains mois ?',
    client_text: 'Pour les 12 prochains mois, diriez-vous que vos dépenses de santé attendues (traitement en cours, suivi programmé, etc.) seront nulles, probablement faibles, probablement modérées ou probablement importantes ?',
    sensitive: true, sort_order: 2,
    options: optionsFrom(['aucune', 'probablement_faibles', 'probablement_moderees', 'probablement_importantes']),
    required: true,
  }),
  questionSpecV2({
    stable_key: 'priorite_prime_liberte_declaree',
    advisor_text: 'Quelle est votre priorité principale pour l’assurance de base ?',
    client_text: 'Quelle est votre priorité principale pour l’assurance de base : réduire votre prime, un équilibre entre prime et liberté de choix, ou maximiser votre liberté de choix ?',
    sensitive: false, sort_order: 3, options: optionsFrom(['reduire_prime', 'equilibre', 'maximiser_liberte']), required: true,
  }),
];

// --- Section 3 : modele-de-soins-preferences (5 questions) ------------------
const SECTION3_QUESTIONS_V2 = [
  questionSpecV2({
    stable_key: 'importance_conserver_medecin_declaree',
    advisor_text: 'Est-il important pour vous de pouvoir conserver votre médecin actuel ?',
    client_text: 'Concernant votre médecin actuel, diriez-vous qu’il est important pour vous de le conserver, que ce n’est pas important, que vous n’avez pas de médecin habituel, ou que cela vous est indifférent ?',
    sensitive: false, sort_order: 1,
    options: optionsFrom(['important', 'non_important', 'pas_de_medecin_habituel', 'indifferent']), required: true,
  }),
  questionSpecV2({
    stable_key: 'ouverture_telemedecine_declaree',
    advisor_text: 'Comment vous positionnez-vous face à un modèle nécessitant de contacter d’abord une télémédecine ?',
    client_text: 'Un modèle où vous devez d’abord contacter une télémédecine avant toute consultation — comment vous positionnez-vous ?',
    sensitive: false, sort_order: 2, options: optionsFrom(['refuse', 'accepte', 'preferee']), required: false,
  }),
  questionSpecV2({
    stable_key: 'ouverture_medecin_famille_declaree',
    advisor_text: 'Comment vous positionnez-vous face à un modèle nécessitant de contacter d’abord un médecin de famille désigné ?',
    client_text: 'Un modèle où un médecin de famille désigné est votre premier point de contact — comment vous positionnez-vous ?',
    sensitive: false, sort_order: 3, options: optionsFrom(['refuse', 'accepte', 'preferee']), required: false,
  }),
  questionSpecV2({
    stable_key: 'ouverture_hmo_reseau_declaree',
    advisor_text: 'Comment vous positionnez-vous face à un modèle nécessitant de contacter d’abord un réseau de soins (HMO) désigné ?',
    client_text: 'Un modèle où un réseau de soins (HMO) est votre premier point de contact — comment vous positionnez-vous ?',
    sensitive: false, sort_order: 4, options: optionsFrom(['refuse', 'accepte', 'preferee']), required: false,
  }),
  questionSpecV2({
    stable_key: 'priorite_libre_choix_declaree',
    advisor_text: 'Le libre choix du médecin, sans point de passage imposé, est-il une priorité pour vous ?',
    client_text: 'Pouvoir consulter librement, sans devoir passer par un interlocuteur désigné en premier, est-ce une priorité pour vous ?',
    sensitive: false, sort_order: 5, options: optionsFrom(['non_prioritaire', 'prioritaire']), required: false,
  }),
];

// --- Section 4 : complementaires-besoins-declares (6 questions) ------------
const ECHELLE_INTERET = optionsFrom(['important', 'eventuellement', 'pas_important']);
const SECTION4_QUESTIONS_V2 = [
  questionSpecV2({
    stable_key: 'interet_complementaire_hospitalisation_declare',
    advisor_text: 'Souhaitez-vous que nous examinions une couverture complémentaire pour le confort hospitalier (chambre privée/semi-privée, choix du médecin en clinique) ?',
    client_text: 'Le confort hospitalier (chambre privée/semi-privée, choix du médecin en clinique) — souhaitez-vous que nous regardions une couverture complémentaire pour cela ?',
    sensitive: false, sort_order: 1, options: ECHELLE_INTERET, required: false,
  }),
  questionSpecV2({
    stable_key: 'interet_medecines_complementaires_declare',
    advisor_text: 'Souhaitez-vous que nous examinions une couverture complémentaire pour les médecines alternatives (naturopathie, ostéopathie, etc.) ?',
    client_text: 'Les médecines alternatives (naturopathie, ostéopathie, etc.) — souhaitez-vous que nous regardions une couverture complémentaire pour cela ?',
    sensitive: false, sort_order: 2, options: ECHELLE_INTERET, required: false,
  }),
  questionSpecV2({
    stable_key: 'interet_complementaire_optique_declare',
    advisor_text: 'Souhaitez-vous que nous examinions une couverture complémentaire pour vos frais optiques ?',
    client_text: 'Vos frais optiques — souhaitez-vous que nous regardions une couverture complémentaire pour cela ?',
    sensitive: false, sort_order: 3, options: ECHELLE_INTERET, required: false,
  }),
  questionSpecV2({
    stable_key: 'interet_complementaire_dentaire_declare',
    advisor_text: 'Souhaitez-vous que nous examinions une couverture complémentaire pour les frais dentaires ?',
    client_text: 'Les frais dentaires — souhaitez-vous que nous regardions une couverture complémentaire pour cela ?',
    sensitive: false, sort_order: 4, options: ECHELLE_INTERET, required: false,
  }),
  questionSpecV2({
    stable_key: 'interet_prevention_declare',
    advisor_text: 'Souhaitez-vous que nous examinions une couverture complémentaire pour un suivi préventif renforcé ?',
    client_text: 'Un suivi préventif renforcé — souhaitez-vous que nous regardions une couverture complémentaire pour cela ?',
    sensitive: false, sort_order: 5, options: ECHELLE_INTERET, required: false,
  }),
  questionSpecV2({
    stable_key: 'interet_couverture_voyage_declare',
    advisor_text: 'Souhaitez-vous que nous examinions une couverture complémentaire pour vos déplacements/séjours à l’étranger ?',
    client_text: 'Vos déplacements/séjours à l’étranger — souhaitez-vous que nous regardions une couverture complémentaire pour cela ?',
    sensitive: false, sort_order: 6, options: ECHELLE_INTERET, required: false,
  }),
];

// --- Règles v2 : helpers de conditions --------------------------------------
function andC(...conditions) { return { op: 'and', conditions }; }
function orC(...conditions) { return { op: 'or', conditions }; }
function notC(condition) { return { op: 'not', condition }; }
function inC(stableKey, values) { return { op: 'in', ref: { answer: stableKey }, value: values }; }

// --- D/E. Franchise — clés et conditions partagées --------------------------
// `rule_result` (référence au résultat d'une autre règle, RULES_ENGINE.md §2)
// N'EST PAS utilisé ici, alors que le cadrage l'envisageait « si cela permet
// d'éviter de dupliquer proprement ». Raison technique vérifiée dans le code
// du moteur (`server/advisoryRuleExecutions.js`, `ruleResults`) : le résultat
// d'une règle `finding_scope: member` y est stocké comme UN SEUL booléen par
// exécution (`anyTriggered`, vrai dès qu'AU MOINS UN membre du foyer a
// déclenché la règle) — jamais un résultat PAR MEMBRE. Utiliser `rule_result`
// pour « indéterminée » ou pour la comparaison contaminerait donc les membres
// entre eux dans un foyer à plusieurs personnes : un membre A à profil
// « élevée » ferait taire à tort la règle « indéterminée » pour un membre B
// au profil réellement indéterminé. Ce risque est exactement celui que ce
// moteur s'interdit par ailleurs (isolation stricte entre membres, GATE LOT
// 4A §3). Ces conditions sont donc dupliquées EXPLICITEMENT (jamais un
// deuxième moteur : mêmes fonctions `andC`/`orC`/`eq`/`inC` que partout
// ailleurs dans ce fichier), conformément à la clause de repli du cadrage
// (« sinon dupliquer les conditions explicitement »).
const FR = {
  capacite: 'capacite_absorber_depense_annuelle',
  tolerance: 'tolerance_risque_financier',
  recours: 'recours_soins_12_mois_declare',
  depenses: 'depenses_sante_anticipees_declare',
  actuelle: 'franchise_actuelle_niveau_declare',
};
const FRANCHISE_REQUIRED_4 = [{ answer: FR.capacite }, { answer: FR.tolerance }, { answer: FR.recours }, { answer: FR.depenses }];
const FRANCHISE_REQUIRED_5 = [...FRANCHISE_REQUIRED_4, { answer: FR.actuelle }];

function franchiseEleveeCondition() {
  return andC(eq(FR.capacite, 'elevee'), eq(FR.tolerance, 'elevee'), eq(FR.recours, 'faible'), inC(FR.depenses, ['aucune', 'probablement_faibles']));
}
function franchisePrudenteCondition() {
  const signalFort = orC(eq(FR.capacite, 'faible'), eq(FR.depenses, 'probablement_importantes'));
  const A = eq(FR.tolerance, 'faible');
  const B = eq(FR.recours, 'important');
  const C = eq(FR.depenses, 'probablement_moderees');
  return orC(signalFort, andC(A, B), andC(A, C), andC(B, C));
}
function franchiseIndetermineeCondition() {
  return notC(orC(franchiseEleveeCondition(), franchisePrudenteCondition()));
}

function ruleSpecV2({ stable_key, title, category_hint, result_finding_type, priority, conditions, required_data, advisor_explanation, client_explanation, warnings, source, source_reference }) {
  return { stable_key, title, category_hint, result_finding_type, priority, conditions, required_data, advisor_explanation, client_explanation, warnings: warnings || [], source, source_reference };
}

// --- C. Accident (2 règles) --------------------------------------------------
// Chevauchement connu et assumé avec `accident-coordination-doublon-01`
// (règle v1 reconduite ci-dessus, RECONDUCTED_V1_RULES_V2) : cette dernière
// se déclenche dès `couverture_accident_hors_lamal_declaree=oui ET
// accident_inclus_lamal_declare=oui` (2 variables), un sur-ensemble strict
// des 2 règles ci-dessous (qui ajoutent la 3e variable `couverture_accident_laa_employeur_declaree`).
// Dès que Q10 est répondue (systématique dès que Q1=oui, CONDITIONAL_REQUIRED),
// `accident-coordination-doublon-01` et l'une des 2 règles ci-dessous se
// déclenchent donc ensemble pour le même fait déclaré. Volontairement non
// « corrigé » en modifiant `accident-coordination-doublon-01` : le cadrage
// humain demande explicitement de la reconduire INCHANGÉE (§B). Les 2
// niveaux d'information restent complémentaires (l'une signale un doublon
// général à vérifier, les 2 autres qualifient plus précisément si un retrait
// est potentiellement examinable) et aucun des 3 textes n'est contradictoire
// -- mais le conseiller verra les 2 findings ensemble dans le cas le plus
// fréquent (salarié couvert par la LAA de son employeur). Relevé par
// rules-engine-auditor et health-insurance-domain ; accepté et documenté par
// décision humaine (le premier décrit une situation de coordination/doublon
// potentiel, les seconds décrivent l'orientation à examiner) -- signalé ici
// et dans `docs/advisory/HEALTH_DIAGNOSTIC_V2_CONTENT.md` pour qu'un futur
// LOT de synthèse les présente ensemble intelligemment, sans qu'aucune règle
// actuelle ne soit fusionnée ni modifiée silencieusement.
const ACCIDENT_RULES_V2 = [
  ruleSpecV2({
    stable_key: 'accident-lamal-maintien-01',
    title: 'Accident LAMal — maintien potentiellement adapté',
    category_hint: 'accident_lamal_maintien',
    result_finding_type: 'solution_category',
    priority: 'low',
    conditions: memberAny(andC(eq('accident_inclus_lamal_declare', 'oui'), orC(eq('couverture_accident_hors_lamal_declaree', 'non'), eq('couverture_accident_laa_employeur_declaree', 'non')))),
    required_data: [{ answer: 'accident_inclus_lamal_declare' }, { answer: 'couverture_accident_hors_lamal_declaree' }, { answer: 'couverture_accident_laa_employeur_declaree' }],
    advisor_explanation: 'Aucune couverture LAA employeur suffisante n’est confirmée pour justifier un retrait de l’accident de la LAMal actuelle — le maintien en l’état paraît la voie la plus prudente à ce stade. Ne jamais déduire qu’une couverture privée quelconque, non précisément qualifiée, autoriserait automatiquement un retrait.',
    client_explanation: 'Sur la base de vos réponses, votre couverture accident LAMal actuelle semble à maintenir en l’état — à confirmer ensemble.',
    warnings: ['Ne constitue jamais une confirmation de conformité légale de la couverture accident du profil concerné.'],
    source: SOURCE_OFSP_ACCIDENT, source_reference: SOURCE_REF_OFSP_ACCIDENT,
  }),
  ruleSpecV2({
    stable_key: 'accident-lamal-retrait-examinable-01',
    title: 'Accident LAMal — retrait potentiellement examinable',
    category_hint: 'accident_lamal_retrait_examinable',
    result_finding_type: 'solution_category',
    priority: 'medium',
    conditions: memberAny(andC(eq('accident_inclus_lamal_declare', 'oui'), eq('couverture_accident_hors_lamal_declaree', 'oui'), eq('couverture_accident_laa_employeur_declaree', 'oui'))),
    required_data: [{ answer: 'accident_inclus_lamal_declare' }, { answer: 'couverture_accident_hors_lamal_declaree' }, { answer: 'couverture_accident_laa_employeur_declaree' }],
    advisor_explanation: 'Une couverture LAA employeur est déclarée en plus de l’inclusion de l’accident dans la LAMal actuelle — un retrait de l’accident de la LAMal est potentiellement examinable (art. 8 al. 1 LAMal, demande et preuve à l’assureur, art. 11 OAMal). Jamais automatique : décision finale de l’assureur, jamais garantie ni promise ici.',
    client_explanation: 'Votre couverture accident via votre employeur pourrait rendre un retrait de l’accident de votre LAMal potentiellement examinable — point à approfondir ensemble, sans certitude à ce stade.',
    warnings: ['Potentiellement examinable seulement — jamais une suspension automatique ni garantie.'],
    source: SOURCE_OFSP_ACCIDENT, source_reference: SOURCE_REF_OFSP_ACCIDENT,
  }),
];

// --- D. Franchise — orientation (3 règles) ----------------------------------
const FRANCHISE_ORIENTATION_RULES_V2 = [
  ruleSpecV2({
    stable_key: 'franchise-orientation-elevee-01',
    title: 'Franchise — orientation élevée',
    category_hint: 'franchise_orientation_elevee',
    result_finding_type: 'solution_category',
    priority: 'medium',
    conditions: memberAny(franchiseEleveeCondition()),
    required_data: FRANCHISE_REQUIRED_4,
    advisor_explanation: 'Capacité financière élevée, tolérance au risque élevée, recours aux soins faible et dépenses anticipées faibles ou nulles : une franchise élevée est potentiellement adaptée au profil déclaré. Jamais une conclusion optimale, ni un calcul d’économie garanti — un jugement de conseil à confirmer ensemble.',
    client_explanation: 'Votre profil déclaré pourrait rendre une franchise élevée potentiellement adaptée — à voir ensemble, jamais une économie garantie.',
    warnings: ['Jamais « optimale », jamais « meilleure », jamais une économie garantie.'],
    source: SOURCE_INTERNAL, source_reference: SOURCE_REF_INTERNAL,
  }),
  ruleSpecV2({
    stable_key: 'franchise-orientation-prudente-01',
    title: 'Franchise — orientation prudente',
    category_hint: 'franchise_orientation_prudente',
    result_finding_type: 'solution_category',
    priority: 'medium',
    conditions: memberAny(franchisePrudenteCondition()),
    required_data: FRANCHISE_REQUIRED_4,
    advisor_explanation: 'Un signal financier fort isolé (capacité faible ou dépenses anticipées importantes), ou la convergence d’au moins deux signaux contributifs (tolérance faible, recours important, dépenses modérées), oriente vers une franchise prudente. Jamais une conclusion automatique — un jugement de conseil à confirmer ensemble.',
    client_explanation: 'Votre profil déclaré pourrait orienter vers une franchise prudente — à voir ensemble.',
    warnings: ['Jamais « optimale », jamais « meilleure », jamais une économie garantie.'],
    source: SOURCE_INTERNAL, source_reference: SOURCE_REF_INTERNAL,
  }),
  // Condition strictement identique à `franchise-comparaison-impossible-indeterminee-01`
  // (§E ci-dessous) -- signalé par `validateRuleSetForPublish` (« conditions
  // strictement identiques ») et par la revue rules-engine-auditor. Fusion
  // délibérément écartée : les 2 règles répondent à 2 questions différentes
  // du conseiller (« quelle est l'orientation ? » vs « peut-on comparer à la
  // franchise actuelle ? »), chacune correspondant à une dimension distincte
  // du cadrage humain (§D orientation / §E comparaison) et à un
  // `category_hint`/`finding_type` distinct (`solution_category` ici,
  // `fact` en §E). Décision assumée, pas un doublon non examiné.
  ruleSpecV2({
    stable_key: 'franchise-orientation-indeterminee-01',
    title: 'Franchise — orientation indéterminée',
    category_hint: 'franchise_orientation_indeterminee',
    result_finding_type: 'solution_category',
    priority: 'low',
    conditions: memberAny(franchiseIndetermineeCondition()),
    required_data: FRANCHISE_REQUIRED_4,
    advisor_explanation: 'Les 4 données sont connues mais ne convergent ni vers une orientation élevée, ni vers une orientation prudente (profil mixte, sans signal dominant) — l’orientation reste indéterminée à ce stade et mérite un échange direct avec le conseiller plutôt qu’une conclusion automatique.',
    client_explanation: 'Votre profil déclaré ne se rattache pas clairement à une orientation de franchise type — à approfondir ensemble.',
    warnings: [],
    source: SOURCE_INTERNAL, source_reference: SOURCE_REF_INTERNAL,
  }),
];

// --- E. Franchise — comparaison à l'actuelle (7 règles) ---------------------
const FRANCHISE_COMPARISON_RULES_V2 = [
  ruleSpecV2({
    stable_key: 'franchise-comparaison-alignee-elevee-01', title: 'Franchise actuelle alignée — orientation élevée',
    category_hint: 'franchise_comparaison_alignee', result_finding_type: 'fact', priority: 'low',
    conditions: memberAny(andC(franchiseEleveeCondition(), eq(FR.actuelle, 'elevee'))), required_data: FRANCHISE_REQUIRED_5,
    advisor_explanation: 'La franchise actuellement déclarée (élevée) semble alignée avec l’orientation élevée déduite du profil déclaré — aucun écart identifié à ce stade.',
    client_explanation: 'Votre franchise actuelle semble alignée avec le profil que vous avez déclaré.',
    source: SOURCE_INTERNAL, source_reference: SOURCE_REF_INTERNAL,
  }),
  ruleSpecV2({
    stable_key: 'franchise-comparaison-ecart-elevee-basse-01', title: 'Écart franchise actuelle/orientation — élevée vs basse',
    category_hint: 'franchise_comparaison_ecart', result_finding_type: 'detected_need', priority: 'medium',
    conditions: memberAny(andC(franchiseEleveeCondition(), eq(FR.actuelle, 'basse'))), required_data: FRANCHISE_REQUIRED_5,
    advisor_explanation: 'La franchise actuellement déclarée (basse) diverge de l’orientation élevée déduite du profil déclaré — un écart à examiner ensemble, jamais une instruction de changer de franchise.',
    client_explanation: 'Un écart entre votre franchise actuelle et le profil que vous avez déclaré pourrait mériter d’être examiné ensemble.',
    warnings: ['Ne jamais écrire ou suggérer « changez votre franchise ».'],
    source: SOURCE_INTERNAL, source_reference: SOURCE_REF_INTERNAL,
  }),
  ruleSpecV2({
    stable_key: 'franchise-comparaison-contextuelle-elevee-moyenne-01', title: 'Franchise actuelle à contextualiser — élevée vs moyenne',
    category_hint: 'franchise_comparaison_contextuelle', result_finding_type: 'fact', priority: 'low',
    conditions: memberAny(andC(franchiseEleveeCondition(), eq(FR.actuelle, 'moyenne'))), required_data: FRANCHISE_REQUIRED_5,
    advisor_explanation: 'Aucun écart manifeste entre la franchise actuellement déclarée (moyenne) et l’orientation élevée déduite du profil déclaré — situation à contextualiser ensemble plutôt qu’à qualifier d’alignée ou d’écart.',
    client_explanation: 'Aucun écart manifeste identifié entre votre franchise actuelle et votre profil déclaré — situation à contextualiser ensemble.',
    source: SOURCE_INTERNAL, source_reference: SOURCE_REF_INTERNAL,
  }),
  ruleSpecV2({
    stable_key: 'franchise-comparaison-alignee-prudente-01', title: 'Franchise actuelle alignée — orientation prudente',
    category_hint: 'franchise_comparaison_alignee', result_finding_type: 'fact', priority: 'low',
    conditions: memberAny(andC(franchisePrudenteCondition(), eq(FR.actuelle, 'basse'))), required_data: FRANCHISE_REQUIRED_5,
    advisor_explanation: 'La franchise actuellement déclarée (basse) semble alignée avec l’orientation prudente déduite du profil déclaré — aucun écart identifié à ce stade.',
    client_explanation: 'Votre franchise actuelle semble alignée avec le profil que vous avez déclaré.',
    source: SOURCE_INTERNAL, source_reference: SOURCE_REF_INTERNAL,
  }),
  ruleSpecV2({
    stable_key: 'franchise-comparaison-ecart-prudente-elevee-01', title: 'Écart franchise actuelle/orientation — prudente vs élevée',
    category_hint: 'franchise_comparaison_ecart', result_finding_type: 'detected_need', priority: 'medium',
    conditions: memberAny(andC(franchisePrudenteCondition(), eq(FR.actuelle, 'elevee'))), required_data: FRANCHISE_REQUIRED_5,
    advisor_explanation: 'La franchise actuellement déclarée (élevée) diverge de l’orientation prudente déduite du profil déclaré — un écart à examiner ensemble, jamais une instruction de changer de franchise.',
    client_explanation: 'Un écart entre votre franchise actuelle et le profil que vous avez déclaré pourrait mériter d’être examiné ensemble.',
    warnings: ['Ne jamais écrire ou suggérer « changez votre franchise ».'],
    source: SOURCE_INTERNAL, source_reference: SOURCE_REF_INTERNAL,
  }),
  ruleSpecV2({
    stable_key: 'franchise-comparaison-contextuelle-prudente-moyenne-01', title: 'Franchise actuelle à contextualiser — prudente vs moyenne',
    category_hint: 'franchise_comparaison_contextuelle', result_finding_type: 'fact', priority: 'low',
    conditions: memberAny(andC(franchisePrudenteCondition(), eq(FR.actuelle, 'moyenne'))), required_data: FRANCHISE_REQUIRED_5,
    advisor_explanation: 'Aucun écart manifeste entre la franchise actuellement déclarée (moyenne) et l’orientation prudente déduite du profil déclaré — situation à contextualiser ensemble plutôt qu’à qualifier d’alignée ou d’écart.',
    client_explanation: 'Aucun écart manifeste identifié entre votre franchise actuelle et votre profil déclaré — situation à contextualiser ensemble.',
    source: SOURCE_INTERNAL, source_reference: SOURCE_REF_INTERNAL,
  }),
  // Condition strictement identique à `franchise-orientation-indeterminee-01`
  // (§D ci-dessus) -- voir le commentaire à cet endroit pour la justification
  // de la non-fusion (2 dimensions distinctes du cadrage, §D/§E).
  ruleSpecV2({
    stable_key: 'franchise-comparaison-impossible-indeterminee-01', title: 'Comparaison franchise impossible — orientation indéterminée',
    category_hint: 'franchise_comparaison_impossible', result_finding_type: 'fact', priority: 'low',
    // required_data volontairement limité aux 4 données d'orientation (pas
    // FRANCHISE_REQUIRED_5) : contrairement aux 6 autres règles de
    // comparaison (E), cette règle ne lit jamais `franchise_actuelle_niveau_declare`
    // dans sa condition (`franchiseIndetermineeCondition()`, § D) -- le
    // constat « comparaison impossible » est déjà acquis dès que
    // l'orientation est indéterminée, indépendamment de la valeur (connue ou
    // non) de la franchise actuelle. Revue rules-engine-auditor : un
    // required_data plus large que la condition réelle produit un
    // `missing_information` à tort si `franchise_actuelle_niveau_declare`
    // seule reste sans réponse alors que l'orientation est déjà déterminable.
    conditions: memberAny(franchiseIndetermineeCondition()), required_data: FRANCHISE_REQUIRED_4,
    advisor_explanation: 'L’orientation de franchise déduite du profil déclaré est insuffisamment claire (ni élevée, ni prudente) pour permettre d’interpréter utilement la franchise actuellement déclarée par comparaison.',
    client_explanation: 'Votre profil déclaré ne permet pas, à ce stade, de comparer utilement votre franchise actuelle à une orientation claire.',
    source: SOURCE_INTERNAL, source_reference: SOURCE_REF_INTERNAL,
  }),
];

// --- F. Modèles de soins (12 règles) ----------------------------------------
function careModelTriplet(questionKey, familyKey, familyLabel) {
  return [
    ruleSpecV2({
      stable_key: `modele-${familyKey}-compatible-01`, title: `Modèle ${familyLabel} — compatible`,
      category_hint: `care_model_${familyKey}_compatible`, result_finding_type: 'solution_category', priority: 'low',
      conditions: memberAny(eq(questionKey, 'accepte')), required_data: [{ answer: questionKey }],
      advisor_explanation: `Une acceptation (ni refus ni préférence marquée) est déclarée pour le modèle ${familyLabel} — compatible avec le profil déclaré, sans préférence exclusive identifiée.`,
      client_explanation: `Ce modèle (${familyLabel}) semble compatible avec ce que vous avez déclaré.`,
      source: SOURCE_INTERNAL, source_reference: SOURCE_REF_INTERNAL,
    }),
    ruleSpecV2({
      stable_key: `modele-${familyKey}-preferee-01`, title: `Modèle ${familyLabel} — préférée`,
      category_hint: `care_model_${familyKey}_preferee`, result_finding_type: 'solution_category', priority: 'medium',
      conditions: memberAny(eq(questionKey, 'preferee')), required_data: [{ answer: questionKey }],
      advisor_explanation: `Une préférence explicite est déclarée pour le modèle ${familyLabel} — signal de préférence marqué, jamais un choix imposé.`,
      client_explanation: `Vous avez exprimé une préférence pour ce modèle (${familyLabel}).`,
      source: SOURCE_INTERNAL, source_reference: SOURCE_REF_INTERNAL,
    }),
    ruleSpecV2({
      stable_key: `modele-${familyKey}-refusee-01`, title: `Modèle ${familyLabel} — refusée`,
      category_hint: `care_model_${familyKey}_refusee`, result_finding_type: 'solution_category', priority: 'low',
      conditions: memberAny(eq(questionKey, 'refuse')), required_data: [{ answer: questionKey }],
      advisor_explanation: `Un refus est déclaré pour le modèle ${familyLabel} — à écarter des options envisagées pour ce membre, sans jugement sur la validité de ce choix.`,
      client_explanation: `Vous avez indiqué ne pas souhaiter ce modèle (${familyLabel}).`,
      source: SOURCE_INTERNAL, source_reference: SOURCE_REF_INTERNAL,
    }),
  ];
}
const CARE_MODEL_RULES_V2 = [
  ...careModelTriplet('ouverture_telemedecine_declaree', 'telemedecine', 'télémédecine'),
  ...careModelTriplet('ouverture_medecin_famille_declaree', 'medecin-famille', 'médecin de famille'),
  ...careModelTriplet('ouverture_hmo_reseau_declaree', 'hmo', 'réseau de soins (HMO)'),
  ruleSpecV2({
    stable_key: 'libre-choix-prioritaire-01', title: 'Libre choix — prioritaire',
    category_hint: 'care_model_libre_choix_prioritaire', result_finding_type: 'solution_category', priority: 'medium',
    conditions: memberAny(eq('priorite_libre_choix_declaree', 'prioritaire')), required_data: [{ answer: 'priorite_libre_choix_declaree' }],
    advisor_explanation: 'Le libre choix du médecin, sans point de passage imposé, est déclaré prioritaire — à privilégier dans les options envisagées, sans exclure d’autres critères.',
    client_explanation: 'Vous avez indiqué que le libre choix du médecin est une priorité pour vous.',
    source: SOURCE_INTERNAL, source_reference: SOURCE_REF_INTERNAL,
  }),
  ruleSpecV2({
    stable_key: 'libre-choix-non-prioritaire-01', title: 'Libre choix — non prioritaire',
    category_hint: 'care_model_libre_choix_non_prioritaire', result_finding_type: 'solution_category', priority: 'low',
    conditions: memberAny(eq('priorite_libre_choix_declaree', 'non_prioritaire')), required_data: [{ answer: 'priorite_libre_choix_declaree' }],
    advisor_explanation: 'Le libre choix du médecin n’est pas déclaré prioritaire — un modèle avec point de passage désigné reste envisageable sans réserve particulière sur ce critère.',
    client_explanation: 'Vous avez indiqué que le libre choix du médecin n’est pas une priorité pour vous.',
    source: SOURCE_INTERNAL, source_reference: SOURCE_REF_INTERNAL,
  }),
  ruleSpecV2({
    stable_key: 'importance-medecin-actuel-01', title: 'Conservation du médecin actuel — besoin déclaré',
    category_hint: 'care_model_preserve_current_doctor', result_finding_type: 'detected_need', priority: 'medium',
    conditions: memberAny(eq('importance_conserver_medecin_declaree', 'important')), required_data: [{ answer: 'importance_conserver_medecin_declaree' }],
    advisor_explanation: 'La conservation du médecin actuel est déclarée importante — un besoin réel à intégrer dans l’examen des modèles de soins envisageables, jamais un simple avertissement secondaire.',
    client_explanation: 'Vous avez indiqué qu’il est important pour vous de conserver votre médecin actuel — nous en tiendrons compte.',
    source: SOURCE_INTERNAL, source_reference: SOURCE_REF_INTERNAL,
  }),
];

// --- G. Priorité coût/liberté (3 règles) ------------------------------------
const PRIORITY_RULES_V2 = [
  ruleSpecV2({
    stable_key: 'priorite-cout-eleve-01', title: 'Priorité — réduction de prime',
    category_hint: 'priorite_cout_eleve', result_finding_type: 'solution_category', priority: 'low',
    conditions: memberAny(eq('priorite_prime_liberte_declaree', 'reduire_prime')), required_data: [{ answer: 'priorite_prime_liberte_declaree' }],
    advisor_explanation: 'La réduction de la prime est déclarée comme priorité principale pour l’assurance de base — à privilégier dans les options examinées.',
    client_explanation: 'Vous avez indiqué que réduire votre prime est votre priorité principale.',
    source: SOURCE_INTERNAL, source_reference: SOURCE_REF_INTERNAL,
  }),
  ruleSpecV2({
    stable_key: 'priorite-equilibre-cout-liberte-01', title: 'Priorité — équilibre coût/liberté',
    category_hint: 'priorite_equilibre_cout_liberte', result_finding_type: 'solution_category', priority: 'low',
    conditions: memberAny(eq('priorite_prime_liberte_declaree', 'equilibre')), required_data: [{ answer: 'priorite_prime_liberte_declaree' }],
    advisor_explanation: 'Un équilibre entre réduction de prime et liberté de choix est déclaré comme priorité — à refléter dans les options examinées, sans privilégier un extrême.',
    client_explanation: 'Vous avez indiqué rechercher un équilibre entre prime et liberté de choix.',
    source: SOURCE_INTERNAL, source_reference: SOURCE_REF_INTERNAL,
  }),
  ruleSpecV2({
    stable_key: 'priorite-liberte-elevee-01', title: 'Priorité — liberté de choix',
    category_hint: 'priorite_liberte_elevee', result_finding_type: 'solution_category', priority: 'low',
    conditions: memberAny(eq('priorite_prime_liberte_declaree', 'maximiser_liberte')), required_data: [{ answer: 'priorite_prime_liberte_declaree' }],
    advisor_explanation: 'Maximiser la liberté de choix est déclaré comme priorité principale pour l’assurance de base — à privilégier dans les options examinées.',
    client_explanation: 'Vous avez indiqué que maximiser votre liberté de choix est votre priorité principale.',
    source: SOURCE_INTERNAL, source_reference: SOURCE_REF_INTERNAL,
  }),
];

// --- H. Complémentaires (6 règles) ------------------------------------------
function complementaireRule({ stable_key, title, questionKey, category_hint, label }) {
  return ruleSpecV2({
    stable_key, title, category_hint, result_finding_type: 'solution_category', priority: 'medium',
    conditions: memberAny(inC(questionKey, ['important', 'eventuellement'])), required_data: [{ answer: questionKey }],
    advisor_explanation: `Un intérêt (important ou à examiner selon les circonstances) est déclaré pour une complémentaire ${label} — à approfondir ensemble. Ne jamais présenter une acceptation médicale comme garantie : toute complémentaire LCA reste soumise à l’examen de risque de l’assureur.`,
    client_explanation: `Vous avez exprimé un intérêt pour une couverture complémentaire ${label} — nous pourrons l’examiner ensemble.`,
    warnings: ['Ne jamais présenter une acceptation médicale comme garantie.'],
    source: SOURCE_INTERNAL, source_reference: SOURCE_REF_INTERNAL,
  });
}
const COMPLEMENTAIRE_RULES_V2 = [
  complementaireRule({ stable_key: 'complementaire-hospitalisation-a-examiner-01', title: 'Complémentaire hospitalisation — à examiner', questionKey: 'interet_complementaire_hospitalisation_declare', category_hint: 'complementaire_hospitalisation_a_examiner', label: 'hospitalisation (confort hospitalier)' }),
  complementaireRule({ stable_key: 'complementaire-medecines-alternatives-a-examiner-01', title: 'Complémentaire médecines alternatives — à examiner', questionKey: 'interet_medecines_complementaires_declare', category_hint: 'complementaire_medecines_alternatives_a_examiner', label: 'médecines alternatives' }),
  complementaireRule({ stable_key: 'complementaire-optique-a-examiner-01', title: 'Complémentaire optique — à examiner', questionKey: 'interet_complementaire_optique_declare', category_hint: 'complementaire_optique_a_examiner', label: 'optique' }),
  complementaireRule({ stable_key: 'complementaire-dentaire-a-examiner-01', title: 'Complémentaire dentaire — à examiner', questionKey: 'interet_complementaire_dentaire_declare', category_hint: 'complementaire_dentaire_a_examiner', label: 'dentaire' }),
  complementaireRule({ stable_key: 'complementaire-prevention-a-examiner-01', title: 'Complémentaire prévention — à examiner', questionKey: 'interet_prevention_declare', category_hint: 'complementaire_prevention_a_examiner', label: 'de suivi préventif renforcé' }),
  complementaireRule({ stable_key: 'complementaire-voyage-a-examiner-01', title: 'Complémentaire voyage — à examiner', questionKey: 'interet_couverture_voyage_declare', category_hint: 'complementaire_voyage_a_examiner', label: 'voyage/séjours à l’étranger' }),
];

// --- Règles v1 reconduites inchangées (4 sur 5 — franchise-capacite-financiere-01
// n'est délibérément PAS reconduite en v2, décision humaine explicite : la
// nouvelle logique d'orientation/comparaison de franchise (sections D/E
// ci-dessus) la remplace fonctionnellement en v2 uniquement. La règle reste
// intacte et immuable dans regles-sante-phase1 v1 -- jamais supprimée ni
// modifiée là où elle existe déjà.) ------------------------------------------
const RECONDUCTED_V1_RULES_V2 = RULES.filter((r) => r.stable_key !== 'franchise-capacite-financiere-01');

const RULES_V2 = [...RECONDUCTED_V1_RULES_V2, ...ACCIDENT_RULES_V2, ...FRANCHISE_ORIENTATION_RULES_V2, ...FRANCHISE_COMPARISON_RULES_V2, ...CARE_MODEL_RULES_V2, ...PRIORITY_RULES_V2, ...COMPLEMENTAIRE_RULES_V2];

export function seedAdvisoryHealthContentV2(req = { session: { userEmail: 'système' } }) {
  const questionnaire = db.prepare('SELECT id FROM advisory_questionnaires WHERE stable_key = ?').get(QUESTIONNAIRE_STABLE_KEY);
  const ruleSetV1 = db.prepare('SELECT id FROM advisory_rule_sets WHERE stable_key = ? ORDER BY version_number ASC LIMIT 1').get(RULE_SET_STABLE_KEY);
  if (!questionnaire || !ruleSetV1) {
    return { created: false, reason: 'Le contenu v1 (seedAdvisoryHealthContent) doit être provisionné avant v2 — questionnaire ou rule_set v1 introuvable.' };
  }
  const existingV2Version = db.prepare('SELECT id FROM advisory_questionnaire_versions WHERE questionnaire_id = ? AND version_number = 2').get(questionnaire.id);
  const existingV2RuleSet = db.prepare('SELECT id FROM advisory_rule_sets WHERE stable_key = ? AND version_number = 2').get(RULE_SET_STABLE_KEY);
  if (existingV2Version || existingV2RuleSet) {
    return { created: false, reason: 'Contenu Diagnostic Santé v2 déjà provisionné (version 2 existante) — script ignoré (idempotent).' };
  }

  const { id: versionId } = createQuestionnaireDraftVersion(questionnaire.id, { notes: 'Diagnostic Santé v2 — 24 questions (4 sections). Jamais publié par ce script.' }, req);
  const sectionSpecs = [
    { stable_key: 'coordination-et-besoins-declares', title: 'Coordination et besoins déclarés', sort_order: 1, questions: SECTION1_QUESTIONS_V2 },
    { stable_key: 'usage-et-priorites', title: 'Usage et priorités', sort_order: 2, questions: SECTION2_QUESTIONS_V2 },
    { stable_key: 'modele-de-soins-preferences', title: 'Modèle de soins — préférences', sort_order: 3, questions: SECTION3_QUESTIONS_V2 },
    { stable_key: 'complementaires-besoins-declares', title: 'Complémentaires — besoins déclarés', sort_order: 4, questions: SECTION4_QUESTIONS_V2 },
  ];
  const questionIds = {};
  for (const spec of sectionSpecs) {
    const { id: sectionId } = upsertSection(versionId, { stable_key: spec.stable_key, title: spec.title, applies_to: 'member', sort_order: spec.sort_order }, req);
    for (const q of spec.questions) {
      const { id: questionId } = upsertQuestion(sectionId, {
        stable_key: q.stable_key, advisor_text: q.advisor_text, client_text: q.client_text, type: q.type, scope: q.scope,
        required: q.required, allows_unknown: q.allows_unknown, sensitive: q.sensitive, sort_order: q.sort_order,
        display_condition: q.display_condition,
      }, req);
      questionIds[q.stable_key] = questionId;
      q.options.forEach((opt, i) => {
        upsertOption(questionId, { stable_key: opt.stable_key, label: opt.label, value: opt.value, sort_order: i + 1 }, req);
      });
    }
  }

  const { id: ruleSetId } = createRuleSetDraftVersion(ruleSetV1.id, {
    name: 'Règles déterministes — Assurance Maladie phase 1 (v2)',
    description: 'Diagnostic Santé v2 — accident, orientation et comparaison de franchise, modèles de soins honnêtement déclarés, priorités, complémentaires. Brouillon, non publié.',
    changelog: 'v2 : ajout accident/franchise-orientation/franchise-comparaison/modèles de soins honnêtes/priorité/complémentaires ; franchise-capacite-financiere-01 non reconduite (remplacée fonctionnellement par les règles de franchise ci-dessus, en v2 uniquement).',
  }, req);
  const ruleIds = {};
  RULES_V2.forEach((r, i) => {
    const { id: ruleId } = upsertRule(ruleSetId, {
      stable_key: r.stable_key,
      title: r.title,
      conditions: r.conditions,
      required_data: r.required_data,
      result_finding_type: r.result_finding_type,
      result_payload: { category_hint: r.category_hint },
      priority: r.priority,
      finding_scope: 'member',
      advisor_explanation: r.advisor_explanation,
      client_explanation: r.client_explanation,
      warnings: r.warnings,
      source: r.source,
      source_reference: r.source_reference,
      effective_from: EFFECTIVE_FROM,
      sort_order: i + 1,
    }, req);
    ruleIds[r.stable_key] = ruleId;
  });

  return {
    created: true,
    questionnaireId: questionnaire.id,
    versionId,
    questionIds,
    ruleSetId,
    ruleIds,
    questionCount: Object.keys(questionIds).length,
    ruleCount: RULES_V2.length,
  };
}

// Exécution directe : node server/seed-advisory-health-content.js
if (process.argv[1] && process.argv[1].endsWith('seed-advisory-health-content.js')) {
  const result = seedAdvisoryHealthContent();
  if (!result.created) {
    console.log(result.reason);
  } else {
    console.log(`Contenu LOT 5 phase 1 provisionné en brouillon : questionnaire #${result.questionnaireId} (version #${result.versionId}, 9 questions), rule_set #${result.ruleSetId} (5 règles). Rien n'est publié — publication réelle conditionnée à une validation juridique et métier séparée.`);
  }
}
