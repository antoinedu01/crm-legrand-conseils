// Contenu métier réel Vie et Prévoyance — LOT 6 phase 1 (Legrand Diagnostic
// 360). Provisionne un questionnaire et un ensemble de règles en état
// BROUILLON via le mécanisme de contenu configuré déjà existant
// (`server/advisoryQuestionnaires.js`, `server/advisoryRules.js`) — même
// principe que `server/seed-advisory-health-content.js` (LOT 5) et
// `server/seed-demo.js` : un script autonome, idempotent, aucune nouvelle
// table ni migration. Rien n'est publié ici : la publication réelle reste
// une décision humaine distincte, conditionnée à une validation juridique et
// métier séparée (voir docs/advisory/LIFE_PENSION_LOT6_CONTENT.md).
import db from './db.js';
import { createQuestionnaire, createDraftVersion as createQuestionnaireDraftVersion, upsertSection, upsertQuestion, upsertOption } from './advisoryQuestionnaires.js';
import { createRuleSet, upsertRule } from './advisoryRules.js';

export const QUESTIONNAIRE_STABLE_KEY = 'diagnostic-vie-prevoyance-phase1';
export const RULE_SET_STABLE_KEY = 'regles-vie-prevoyance-phase1';

const SOURCE_INTERNAL = 'Référence interne — méthodologie de conseil Legrand Conseils, à valider par un spécialiste métier avant mise en production. Aucun seuil légal ni actuariel affirmé.';
const SOURCE_REF_INTERNAL = 'Note méthodologique interne — non une source légale, non une donnée actuarielle.';
const EFFECTIVE_FROM = '2026-08-04';

function questionSpec({ stable_key, advisor_text, client_text, type, options, sensitive, sort_order, required = false }) {
  return {
    stable_key,
    advisor_text,
    client_text,
    type: type || 'single_choice',
    scope: 'member',
    // required: false par défaut — même rationale que LOT 5 : ce noyau
    // tolère des réponses partielles, le mécanisme missing_information du
    // moteur signale déjà correctement, par règle, ce qui manque pour
    // conclure. Exception délibérée (correction du dossier d'approbation,
    // voir les 3 questions de couverture ci-dessous, `required: true`
    // explicite) : le mécanisme `required` du QUESTIONNAIRE (bloque la
    // finalisation de session tant qu'une réponse — y compris `unknown` —
    // n'a pas été apportée, voir `validateSessionForCompletion`,
    // `server/advisorySessions.js`) est distinct du `required_data` d'une
    // RÈGLE (gouverne uniquement si CETTE règle produit missing_information)
    // — les deux mécanismes existants sont combinés ici sans en créer un
    // nouveau : une session ne peut plus jamais atteindre `completed` avec
    // l'une de ces 3 questions jamais posée à un membre actif, ce qui
    // garantit qu'aucune exécution du moteur (réservée aux sessions
    // `completed`) ne peut avoir lieu sur un foyer où ces questions
    // n'auraient jamais été abordées.
    required,
    allows_unknown: true,
    sensitive,
    sort_order,
    options: options || OUI_NON,
  };
}

const OUI_NON = [
  { stable_key: 'oui', label: 'Oui', value: 'oui' },
  { stable_key: 'non', label: 'Non', value: 'non' },
];

const STATUT_PROFESSIONNEL = [
  { stable_key: 'salarie', label: 'Salarié', value: 'salarie' },
  { stable_key: 'independant', label: 'Indépendant', value: 'independant' },
  { stable_key: 'sans_emploi', label: 'Sans emploi', value: 'sans_emploi' },
  { stable_key: 'autre', label: 'Autre', value: 'autre' },
];

// Les 10 questions de la matrice verrouillée. Comme pour le LOT 5: pas
// d'option « inconnue » littérale pour les 9 questions oui/non — le
// mécanisme natif du moteur (allows_unknown / is_unknown,
// `docs/advisory/QUESTIONNAIRE_ENGINE.md` §2) est utilisé pour « je ne sais
// pas », ce qui déclenche correctement missing_information via
// required_data (`RULES_ENGINE.md` §8) pour les règles A/B/D/E. La règle C
// est l'exception délibérée : elle a spécifiquement besoin de distinguer
// « répondu oui/non » de « explicitement répondu inconnue » (pas de simple
// absence) — elle référence donc le STATUT de la réponse (`answer_status`,
// une des 7 natures de référence déjà existantes du DSL, jamais une
// extension) plutôt que sa valeur, sans déclarer ces 3 questions dans son
// propre `required_data` (voir RULES ci-dessous et le rapport final,
// section « corrections/décisions », pour la justification complète).
const QUESTIONS = [
  questionSpec({
    stable_key: 'statut_professionnel_declare',
    advisor_text: 'Statut professionnel déclaré de la personne.',
    client_text: 'Quel est votre statut professionnel actuel ?',
    type: 'single_choice',
    options: STATUT_PROFESSIONNEL,
    sensitive: false,
    sort_order: 1,
  }),
  questionSpec({
    stable_key: 'dependance_revenu_professionnel_declare',
    advisor_text: 'La personne dépend-elle principalement de son revenu professionnel pour vivre ?',
    client_text: 'Votre niveau de vie dépend-il principalement de votre revenu professionnel actuel ?',
    sensitive: false,
    sort_order: 2,
  }),
  questionSpec({
    stable_key: 'personnes_dependantes_financierement_declare',
    advisor_text: 'La personne a-t-elle des personnes financièrement dépendantes d’elle ?',
    client_text: 'Avez-vous des personnes qui dépendent financièrement de vous (enfants, conjoint, autre) ?',
    sensitive: true,
    sort_order: 3,
  }),
  // Les 3 questions ci-dessous interrogent directement le FAIT (dispose /
  // a effectué), jamais la « connaissance » du fait (« savez-vous si… ») —
  // une formulation en « savez-vous si » laissait un « non » ambigu entre
  // « non, je n'en ai pas » et « non, je ne sais pas », faisant doublon
  // avec le mécanisme natif allows_unknown/is_unknown déjà prévu pour
  // l'incertitude — revue life-pension-domain, correction appliquée.
  // Correction apportée lors de la validation humaine du dossier
  // d'approbation (règle C, §5) : ces 3 questions de couverture deviennent
  // `required: true` — sans quoi un indépendant chez qui elles ne sont
  // JAMAIS posées ne déclenchait ni la règle C ni aucun missing_information
  // (cas silencieux, voir docs/advisory/LIFE_PENSION_LOT6_CONTENT.md §3).
  // `allows_unknown: true` reste inchangé : la personne garde le droit de
  // répondre explicitement « je ne sais pas », ce qui satisfait la
  // finalisation de session tout en laissant la règle C se déclencher sur
  // ce statut `unknown`.
  questionSpec({
    stable_key: 'couverture_deces_connue_declare',
    advisor_text: 'La personne dispose-t-elle actuellement d’une couverture décès la concernant ?',
    client_text: 'Disposez-vous actuellement d’une couverture en cas de décès ?',
    sensitive: true,
    sort_order: 4,
    required: true,
  }),
  questionSpec({
    stable_key: 'couverture_incapacite_gain_connue_declare',
    advisor_text: 'La personne dispose-t-elle actuellement d’une couverture privée ou professionnelle suffisante en cas d’incapacité de gain ?',
    client_text: 'Disposez-vous actuellement d’une couverture suffisante en cas d’incapacité de travailler ?',
    sensitive: true,
    sort_order: 5,
    required: true,
  }),
  // Correction apportée lors de la validation humaine du dossier
  // d'approbation : le texte précédent portait à tort sur un « rachat
  // volontaire » (un versement ponctuel dans une prévoyance déjà existante),
  // alors que la règle C (`independant-couverture-incertaine-01`) a besoin
  // de savoir si une personne INDÉPENDANTE dispose ne serait-ce que d'une
  // AFFILIATION facultative au 2e pilier — une notion antérieure et
  // distincte du rachat (on ne peut racheter que dans une institution à
  // laquelle on est déjà affilié). Jamais confondre les deux notions dans ce
  // contenu ni dans sa documentation.
  // required: true — même correction que les 2 questions de couverture
  // ci-dessus (règle C, §5 du dossier d'approbation) : cette question fait
  // elle aussi partie des 3 couvertures dont l'incertitude explicite peut
  // déclencher la règle C ; la laisser facultative aurait permis le même cas
  // silencieux (indépendant jamais interrogé sur ce point, ni finding ni
  // missing_information).
  questionSpec({
    stable_key: 'prevoyance_professionnelle_volontaire_connue_declare',
    // « Pour la personne indépendante » retiré du texte conseiller (revue
    // life-pension-domain) : formulation trompeuse depuis que required:true
    // s'applique à CHAQUE membre actif, indépendant ou non — laissait
    // penser à tort que la question restait sautable pour un salarié.
    advisor_text: 'L’existence d’une affiliation facultative à une institution de prévoyance professionnelle est-elle connue — posée à chaque membre, particulièrement déterminante pour un statut indépendant ?',
    client_text: 'Êtes-vous actuellement affilié(e), à titre volontaire, à une caisse de pension ou à une institution de prévoyance professionnelle ?',
    sensitive: false,
    sort_order: 6,
    required: true,
  }),
  questionSpec({
    stable_key: 'epargne_retraite_volontaire_existante_declare',
    advisor_text: 'La personne constitue-t-elle actuellement une épargne volontaire pour la retraite ?',
    client_text: 'Épargnez-vous actuellement, à titre volontaire, en vue de votre retraite ?',
    sensitive: false,
    sort_order: 7,
  }),
  questionSpec({
    stable_key: 'souhait_ameliorer_preparation_retraite_declare',
    advisor_text: 'La personne exprime-t-elle le souhait d’améliorer sa préparation financière à long terme ?',
    client_text: 'Souhaiteriez-vous améliorer votre préparation financière à long terme pour la retraite ?',
    sensitive: false,
    sort_order: 8,
  }),
  questionSpec({
    stable_key: 'changement_familial_patrimonial_recent_declare',
    advisor_text: 'La personne indique-t-elle une évolution familiale ou patrimoniale importante récente ?',
    // « divorce » ajouté explicitement — déclencheur le plus fréquent et le
    // plus sensible en pratique d'une révision de bénéficiaires (clause
    // bénéficiaire non mise à jour vers un ex-conjoint) ; « séparation »
    // seul pouvait ne pas être reconnu par un client divorcé — revue
    // life-pension-domain, correction appliquée.
    client_text: 'Avez-vous connu un changement familial ou patrimonial important récemment (mariage, naissance, divorce ou séparation, héritage, autre) ?',
    sensitive: true,
    sort_order: 9,
  }),
  questionSpec({
    stable_key: 'revision_recente_beneficiaires_protections_declare',
    advisor_text: 'La personne a-t-elle revu récemment ses bénéficiaires et ses protections existantes ?',
    client_text: 'Avez-vous revu récemment vos bénéficiaires désignés et vos protections en place ?',
    sensitive: true,
    sort_order: 10,
  }),
];

function memberAny(subCondition) {
  return { op: 'any', over: 'members', condition: subCondition };
}
function eq(stableKey, value) {
  return { op: 'equals', ref: { answer: stableKey }, value };
}
function statusUnknown(stableKey) {
  return { op: 'equals', ref: { answer_status: stableKey }, value: 'unknown' };
}

// Les 5 règles verrouillées. Toutes finding_scope: member, racine `any` sur
// les membres — chaque situation est individuelle, un finding par membre
// réellement concerné, jamais une attribution au foyer entier.
const RULES = [
  {
    stable_key: 'deces-couverture-absente-01',
    title: 'Absence de couverture décès identifiée',
    category_hint: 'deces_coverage_gap',
    result_finding_type: 'gap',
    priority: 'high',
    conditions: memberAny({
      op: 'and',
      conditions: [
        eq('personnes_dependantes_financierement_declare', 'oui'),
        eq('couverture_deces_connue_declare', 'non'),
      ],
    }),
    required_data: [
      { answer: 'personnes_dependantes_financierement_declare' },
      { answer: 'couverture_deces_connue_declare' },
    ],
    advisor_explanation: 'Des personnes financièrement dépendantes sont déclarées, sans couverture décès connue — un besoin d’analyse est signalé, jamais un capital déterminé automatiquement. Ne jamais calculer ou proposer un montant de capital, ne jamais choisir un produit ou un assureur.',
    client_explanation: 'Des personnes dépendent financièrement de vous, sans qu’une couverture décès connue n’ait été identifiée — point à analyser ensemble.',
    warnings: ['Ne détermine jamais automatiquement un capital ni une durée de couverture.'],
    source: SOURCE_INTERNAL,
    source_reference: SOURCE_REF_INTERNAL,
  },
  {
    stable_key: 'incapacite-gain-couverture-absente-01',
    title: 'Absence de couverture incapacité de gain identifiée',
    category_hint: 'incapacite_gain_coverage_gap',
    result_finding_type: 'gap',
    priority: 'high',
    conditions: memberAny({
      op: 'and',
      conditions: [
        eq('dependance_revenu_professionnel_declare', 'oui'),
        eq('couverture_incapacite_gain_connue_declare', 'non'),
      ],
    }),
    required_data: [
      { answer: 'dependance_revenu_professionnel_declare' },
      { answer: 'couverture_incapacite_gain_connue_declare' },
    ],
    advisor_explanation: 'Dépendance principale au revenu professionnel déclarée, sans couverture incapacité de gain connue — point à analyser. Ne jamais calculer automatiquement un montant de rente ou de capital, ne jamais choisir un produit ou un assureur.',
    client_explanation: 'Votre niveau de vie dépend principalement de votre revenu professionnel, sans qu’une couverture connue en cas d’incapacité de travailler n’ait été identifiée — point à analyser ensemble.',
    warnings: ['Ne détermine jamais automatiquement un montant de rente ou de capital.'],
    source: SOURCE_INTERNAL,
    source_reference: SOURCE_REF_INTERNAL,
  },
  {
    stable_key: 'independant-couverture-incertaine-01',
    title: 'Indépendant sans protection clairement documentée',
    category_hint: 'independant_couverture_incertaine',
    result_finding_type: 'warning',
    priority: 'medium',
    conditions: memberAny({
      op: 'and',
      conditions: [
        eq('statut_professionnel_declare', 'independant'),
        {
          op: 'or',
          conditions: [
            statusUnknown('couverture_deces_connue_declare'),
            statusUnknown('couverture_incapacite_gain_connue_declare'),
            statusUnknown('prevoyance_professionnelle_volontaire_connue_declare'),
          ],
        },
      ],
    }),
    // Ne référence QUE le statut professionnel — jamais les 3 questions de
    // couverture elles-mêmes (voir en-tête du fichier) : le déclencheur de
    // cette règle EST l'incertitude explicite (statut « unknown »), pas
    // l'absence de réponse — inclure ces 3 refs dans required_data ferait
    // basculer toute réponse « inconnue » vers missing_information avant
    // même l'évaluation de la condition, ce qui empêcherait cette règle de
    // jamais se déclencher (contradiction avec son objet même).
    required_data: [
      { answer: 'statut_professionnel_declare' },
    ],
    advisor_explanation: 'Statut indépendant déclaré, avec une incertitude explicite (réponse « inconnue ») sur au moins une des trois couvertures (décès, incapacité de gain, prévoyance professionnelle volontaire) — ne jamais conclure automatiquement à une absence de couverture, uniquement signaler l’incertitude à clarifier.',
    client_explanation: 'En tant qu’indépendant, une incertitude a été identifiée sur au moins une de vos couvertures (décès, incapacité de gain, ou prévoyance professionnelle) — point à clarifier ensemble.',
    warnings: ['Une réponse « inconnue » ne signifie jamais une absence de couverture confirmée — seulement une incertitude à lever.'],
    source: SOURCE_INTERNAL,
    source_reference: SOURCE_REF_INTERNAL,
  },
  {
    stable_key: 'retraite-epargne-absente-01',
    title: 'Épargne retraite déclarée absente',
    category_hint: 'retraite_epargne_besoin',
    result_finding_type: 'detected_need',
    priority: 'medium',
    conditions: memberAny({
      op: 'and',
      conditions: [
        eq('epargne_retraite_volontaire_existante_declare', 'non'),
        eq('souhait_ameliorer_preparation_retraite_declare', 'oui'),
      ],
    }),
    required_data: [
      { answer: 'epargne_retraite_volontaire_existante_declare' },
      { answer: 'souhait_ameliorer_preparation_retraite_declare' },
    ],
    advisor_explanation: 'Aucune épargne retraite volontaire actuelle déclarée, alors qu’un souhait d’amélioration de la préparation financière à long terme est exprimé — sujet de discussion à ouvrir. Ne jamais recommander automatiquement un 3a, un 3b, une assurance ou une solution bancaire précise.',
    client_explanation: 'Vous souhaitez améliorer votre préparation financière pour la retraite, sans épargne volontaire actuelle déclarée — sujet à approfondir ensemble.',
    warnings: ['Ne recommande jamais automatiquement un produit ou une solution précise (3a, 3b, bancaire ou assurance).'],
    source: SOURCE_INTERNAL,
    source_reference: SOURCE_REF_INTERNAL,
  },
  {
    stable_key: 'beneficiaires-situation-a-revoir-01',
    title: 'Bénéficiaires ou situation familiale non revus',
    category_hint: 'beneficiaires_situation_a_revoir',
    result_finding_type: 'warning',
    priority: 'medium',
    conditions: memberAny({
      op: 'and',
      conditions: [
        eq('changement_familial_patrimonial_recent_declare', 'oui'),
        eq('revision_recente_beneficiaires_protections_declare', 'non'),
      ],
    }),
    required_data: [
      { answer: 'changement_familial_patrimonial_recent_declare' },
      { answer: 'revision_recente_beneficiaires_protections_declare' },
    ],
    advisor_explanation: 'Un changement familial ou patrimonial récent est déclaré, sans révision récente des bénéficiaires ou protections — point à examiner. Ne jamais produire de conseil successoral ou fiscal automatique.',
    client_explanation: 'Un changement récent dans votre situation n’a peut-être pas encore été répercuté sur vos bénéficiaires ou vos protections — point à vérifier ensemble.',
    warnings: ['Ne produit jamais de conseil successoral ou fiscal — signale uniquement un point à vérifier.'],
    source: SOURCE_INTERNAL,
    source_reference: SOURCE_REF_INTERNAL,
  },
];

export function seedAdvisoryLifePensionContent(req = { session: { userEmail: 'système' } }) {
  const existingQuestionnaire = db.prepare('SELECT id FROM advisory_questionnaires WHERE stable_key = ?').get(QUESTIONNAIRE_STABLE_KEY);
  const existingRuleSet = db.prepare('SELECT id FROM advisory_rule_sets WHERE stable_key = ?').get(RULE_SET_STABLE_KEY);
  if (existingQuestionnaire || existingRuleSet) {
    return { created: false, reason: 'Contenu LOT 6 déjà provisionné (stable_key existante) — script ignoré (idempotent).' };
  }

  const { id: questionnaireId } = createQuestionnaire(
    { stable_key: QUESTIONNAIRE_STABLE_KEY, domain: 'life_pension', name: 'Diagnostic Vie et Prévoyance — Phase 1', description: 'LOT 6 phase 1 — contenu brouillon, non publié. Publication réelle conditionnée à une validation juridique et métier séparée (voir docs/advisory/LIFE_PENSION_LOT6_CONTENT.md).' },
    req
  );
  const { id: versionId } = createQuestionnaireDraftVersion(questionnaireId, { notes: 'LOT 6 phase 1 — noyau initial de 10 questions.' }, req);
  const { id: sectionId } = upsertSection(
    versionId,
    { stable_key: 'protection-et-prevoyance-declarees', title: 'Protection et prévoyance déclarées (phase 1)', applies_to: 'member', sort_order: 1 },
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
    { stable_key: RULE_SET_STABLE_KEY, domain: 'life_pension', name: 'Règles déterministes — Vie et Prévoyance phase 1', description: 'LOT 6 phase 1 — noyau initial de 5 règles, brouillon, non publié. Publication réelle conditionnée à une validation juridique et métier séparée.' },
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

// Exécution directe : node server/seed-advisory-life-pension-content.js
if (process.argv[1] && process.argv[1].endsWith('seed-advisory-life-pension-content.js')) {
  const result = seedAdvisoryLifePensionContent();
  if (!result.created) {
    console.log(result.reason);
  } else {
    console.log(`Contenu LOT 6 phase 1 provisionné en brouillon : questionnaire #${result.questionnaireId} (version #${result.versionId}, 10 questions), rule_set #${result.ruleSetId} (5 règles). Rien n'est publié — publication réelle conditionnée à une validation juridique et métier séparée.`);
  }
}
