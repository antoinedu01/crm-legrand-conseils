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

// Exécution directe : node server/seed-advisory-health-content.js
if (process.argv[1] && process.argv[1].endsWith('seed-advisory-health-content.js')) {
  const result = seedAdvisoryHealthContent();
  if (!result.created) {
    console.log(result.reason);
  } else {
    console.log(`Contenu LOT 5 phase 1 provisionné en brouillon : questionnaire #${result.questionnaireId} (version #${result.versionId}, 9 questions), rule_set #${result.ruleSetId} (5 règles). Rien n'est publié — publication réelle conditionnée à une validation juridique et métier séparée.`);
  }
}
