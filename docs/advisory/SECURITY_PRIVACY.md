# Sécurité et protection des données — Legrand Diagnostic 360

> Proposition de conception (LOT 1). Aucune interprétation juridique
> présentée ici n'est définitivement validée — chaque point marqué
> « validation juridique/métier requise » doit être confirmé par un
> spécialiste avant mise en production.

## 1. Classification des données

| Catégorie | Exemples dans ce module | Traitement |
|---|---|---|
| Identité / coordonnées | déjà sur `clients`, référencé, non dupliqué | standard nLPD |
| Financière | revenus, charges, dettes, patrimoine (`advisory_answers`) | standard nLPD, accès conseiller uniquement |
| Sensible (association indirecte à la santé) | franchise, consommation médicale déclarée, statut d'affiliation (`advisory_answers`, section maladie) | traitement renforcé — **jamais de diagnostic médical ni de contenu de questionnaire de santé assurantiel**, cohérent avec la restriction déjà appliquée à `contract_lca` |
| Consentement | `advisory_consents` | traçabilité renforcée, jamais supprimée |
| Technique/traçabilité | `advisory_rule_executions`, `audit_log` | accès conseiller/audit uniquement |

Aucune donnée de santé au sens strict (diagnostic, pathologie) n'est prévue
dans le modèle — à confirmer explicitement par `compliance-privacy-reviewer`
avant toute implémentation qui s'en approcherait (ex. si un futur
questionnaire de souscription LCA détaillé était envisagé, ce serait un
changement de nature nécessitant une revue dédiée, hors périmètre actuel).

## 2. Minimisation

- Le questionnaire ne pose que ce qui sert une règle effectivement publiée
  (`required_data` d'au moins une règle `valide`) — pas de collecte
  « au cas où ».
- Les enfants et personnes à charge ne sont jamais tenus de fournir email,
  téléphone, adresse ou profession (cf. `DATA_MODEL.md` §1.1, §2.2) —
  minimisation déjà portée par le schéma `clients` existant, pas un ajout.
- **Lot 3A — invariant de confidentialité critique, vérifié en service et
  testé** : une réponse de portée `member` (`advisory_answers.
  household_member_id`) doit référencer un membre appartenant au **même**
  foyer que la session — jamais un membre d'un autre foyer, même si son
  identifiant existe réellement en base. Implémenté par
  `assertMemberBelongsToSession` (`server/advisorySessions.js`), même
  principe que `assertLegalRepresentativeValid` (Lot 2).
- **Lot 3A — flag `sensitive` préparatoire, non enforcé** : les questions
  portent un booléen `sensitive` (classification simple) qui n'est
  consulté par **aucune** route de ce lot — ni pour filtrer une réponse
  dans une API, ni pour un affichage particulier. À ne jamais présenter
  comme une protection déjà active tant qu'aucune route ne le consulte
  réellement ; une future route (mode présentation client, Lot 8, ou export,
  Lot 10) devra décider explicitement comment l'utiliser.
- **Lot 3A — contenu libre non classifié** : les types `text`/`long_text`
  permettent une saisie libre sans classification de contenu. Aucun risque
  réel dans ce lot (questionnaires fictifs uniquement), mais le risque
  redevient réel dès qu'un contenu métier réel (Lot 5/6) autorise ce type
  de champ sur une question potentiellement sensible — la protection ne
  peut venir que d'une revue humaine du contenu à la publication d'une
  version, jamais du schéma lui-même.

## 3. Consentements

- `advisory_consents` (voir `DATA_MODEL.md` §6) : granularité par finalité,
  jamais un consentement global unique masquant des usages distincts.
- Chaque consentement référence la version exacte du texte présenté
  (`text_version`) — une évolution du texte ne réinterprète jamais
  silencieusement un consentement déjà recueilli.
- Révocation possible à tout moment (décision GATE LOT 1, point 3.5) : par
  mise à jour de la ligne d'origine (`revoked_at`/`revoked_by_user_id`/
  `revoked_reason`), **jamais** suppression ni écrasement des champs
  renseignés à la création (`granted`, `text_version`, `collection_mode`,
  `collected_at`, `collected_by_user_id`, `proof_reference`) — voir
  `DATA_MODEL.md` §6.1.
- La révocation n'agit que pour les traitements futurs. Elle ne doit
  **jamais** être présentée comme entraînant automatiquement l'effacement
  de toutes les données déjà traitées lorsqu'une autre obligation de
  conservation s'applique (ex. données déjà intégrées à un rapport final) —
  **ce point reste soumis à validation juridique** (voir §20).
- **Validation juridique requise** : contenu exact des textes de
  consentement par finalité, base légale précise par finalité (nLPD, LSA le
  cas échéant).

## 4. Chiffrement

- Reprend à l'identique les pratiques déjà en place pour le reste du CRM :
  base SQLite hébergée localement/en Suisse, disque chiffré recommandé
  (`README.md` existant), HTTPS via proxy TLS en production
  (`server/app.js`, `secure: 'auto'` sur le cookie de session).
- Aucun chiffrement applicatif supplémentaire au niveau colonne n'est
  proposé dans cette version pour les données `advisory_*` — à réévaluer si
  les tables venaient à contenir des catégories de données plus sensibles
  qu'aujourd'hui identifiées (point de vigilance pour
  `compliance-privacy-reviewer`, pas une décision fermée).

## 5. Contrôle d'accès

- **Constat honnête (déjà relevé en LOT 0)** : le CRM est aujourd'hui
  mono-utilisateur, sans système de rôles. Toute route `/api/advisory/*`
  hérite donc du même modèle qu'aujourd'hui : authentifié = tout accès,
  comme pour `clients`/`contracts`.
- La séparation « conseiller / client / administrateur » demandée dans les
  spécifications générales du module reste, dans cette version, une
  séparation **d'affichage** (mode conseiller vs mode présentation client
  sur le même poste authentifié), pas une séparation **d'accès réseau**. Un
  vrai contrôle d'accès par rôle (ex. plusieurs conseillers, assistant
  administratif) nécessiterait un chantier d'authentification à part,
  au-delà du périmètre du LOT 1 — à documenter comme prérequis explicite
  avant tout Lot 13 (portail client) ou tout ajout d'un second conseiller.

## 6. Journalisation

- Toute création/modification/consultation significative appelle `audit()`
  existant, avec de nouvelles valeurs `action`/`entity` (`DATA_MODEL.md`
  §1.3). Aucun nouveau mécanisme de log parallèle.
- Le détail journalisé reste, comme aujourd'hui pour les contrats
  spécialisés, limité à une valeur d'énumération ou un identifiant — jamais
  le contenu détaillé d'une réponse financière ou sensible dans le journal
  d'audit lui-même.
- **Correctif de traçabilité (post-Lot 2)** : la création rapide d'une
  personne depuis le module foyer (`addMember(..., new_person)`) produit
  **deux** entrées d'audit distinctes, jamais une seule qui masquerait
  l'autre : `création client` (réutilise l'action existante de
  `POST /api/clients`, entité `client`, détails minimaux — ni nom, ni date
  de naissance, seulement le type et l'origine « module foyer ») puis
  `ajout membre foyer` (entité `household`). L'entrée `création client`
  est écrite **dans la même transaction SQLite** que l'insertion du client
  et de son adhésion (vérifié : `audit()` utilise la même connexion
  `better-sqlite3` que le reste du module, donc participe pleinement à la
  transaction et s'annule avec elle en cas d'échec ultérieur) — jamais un
  audit affirmant une création réussie alors que la transaction a échoué.
  Une personne déjà existante ajoutée au foyer ne produit jamais cette
  entrée `création client`.
- **Lot 3A** : 22 actions d'audit distinctes, une par site d'appel
  (`questionnaire créé`, `version créée`/`publiée`/`archivée`/`clonée`,
  `section créée`/`modifiée`, `question créée`/`modifiée`, `option
  créée`/`modifiée`, `session créée`/`modifiée`/`démarrée`/`suspendue`/
  `reprise`/`finalisée`/`annulée`, `réponse
  enregistrée`/`remplacée`/`effacée`/`amendée`), toutes vérifiées par test
  pour ne **jamais** contenir la valeur d'une réponse, une date de
  naissance, un montant ou une donnée médicale — uniquement des
  identifiants, énumérations et compteurs. Le rollback transactionnel de
  ces entrées est vérifié empiriquement (une réponse annulée par une
  entrée invalide dans le même lot n'écrit aucune entrée d'audit
  résiduelle). Les six actions `section`/`question`/`option`
  `créée`/`modifiée` ont été ajoutées lors du GATE de validation : les
  fonctions `upsertSection`/`upsertQuestion`/`upsertOption`
  (`server/advisoryQuestionnaires.js`) recevaient déjà `req` mais
  n'appelaient jamais `audit()`, contrairement à la convention du Lot 2 qui
  journalise systématiquement jusqu'aux entités imbriquées (ajout/
  modification/retrait d'un membre de foyer). Corrigé pour rester cohérent
  avec cette convention ; leur `details` ne contient que la clé stable
  (`stable_key`), jamais le texte de la question ni le libellé de l'option.
- **Correctif final avant premier commit — `allows_not_applicable`** :
  ajout d'un champ booléen distinct de `allows_unknown` sur
  `advisory_questions` (défaut `false`). Sans ce contrôle, le statut
  `not_applicable` pouvait auparavant satisfaire n'importe quelle question
  obligatoire à la finalisation sans que le concepteur du questionnaire ne
  l'ait jamais explicitement autorisé — corrigé côté service
  (`validateAnswerValue`, `server/advisorySessions.js`), sur tous les
  chemins d'écriture (`recordAnswers`, `amendAnswer`), jamais uniquement
  côté interface. Les audits `réponse enregistrée`/`remplacée`/`amendée`
  continuent de ne jamais contenir le statut ni la valeur de la réponse,
  vérifié par test y compris pour un amendement vers `not_applicable`.
- **`content_hash` : précision de nature (correctif final)** — l'empreinte
  SHA-256 des versions de questionnaire (`QUESTIONNAIRE_ENGINE.md` §7.1) est
  un simple contrôle technique d'intégrité interne, **jamais une signature
  cryptographique ni une preuve juridique** : aucune clé privée, aucun tiers
  de confiance, aucune valeur probante au sens légal ne doit lui être
  attribuée.
- **Constat de la revue de conformité (non corrigé, hors périmètre de ce
  lot)** : `createHousehold()` (Lot 2) journalise encore le nom affiché du
  principal (`displayName(client)`), contrairement au motif plus strict
  adopté depuis pour `création client`/les actions du Lot 3A. Signalé pour
  une correction future, non modifié ici pour rester dans le périmètre du
  Lot 3A.
- **`GET /api/advisory/sessions/:id/workspace` : décision initiale du Lot 3B
  (ne jamais auditer) révisée au GATE LOT 3B §6.** La décision de non-audit
  n'était pas validée par le responsable protection des données. Corrigé :
  chaque lecture produit désormais une entrée `consultation workspace
  session` (session, utilisateur, révision, statut — jamais de valeur de
  réponse, de texte de question, de montant, de date médicale, de détail de
  membre ni de condition JSON), avec une **déduplication technique** : au
  plus une entrée identique par utilisateur et par session sur une fenêtre
  de 15 minutes (`WORKSPACE_VIEW_DEDUP_MINUTES`, constante documentée et
  facilement modifiable dans `server/advisorySessions.js`) — sans quoi le
  rechargement automatique après chaque sauvegarde produirait des centaines
  de lignes quasi identiques sans valeur de traçabilité ajoutée. Vérifié par
  test (dédupliqué par utilisateur, pas globalement — deux conseillers
  consultant la même session produisent chacun leur propre entrée) et par
  exécution navigateur réelle (plusieurs dizaines de rechargements
  n'ajoutent qu'une seule ligne). **Politique à reconfirmer explicitement
  par le responsable protection des données avant toute mise en production
  avec du contenu métier réel** (santé/vie, Lot 5/6) — la fenêtre de 15
  minutes reste un choix technique, pas une validation réglementaire.
- **`GET /api/advisory/sessions/:id/answers/history` : audit ajouté au GATE
  LOT 3B §6.** Chaque ouverture de l'historique d'une réponse produit une
  entrée distincte `consultation historique réponse` (session, question,
  membre éventuel, utilisateur — jamais la valeur), **sans** déduplication
  (contrairement au workspace, cette route n'est pas rechargée
  automatiquement — chaque ouverture reflète une action ponctuelle et
  distincte du conseiller).
- **En-têtes anti-cache (GATE LOT 3B §7).** Les routes exposant des réponses
  ou leur historique (`GET .../workspace`, `.../answers`, `.../answers/
  history`, `.../completion-check`) renvoient désormais
  `Cache-Control: no-store, private` + `Pragma: no-cache` — jamais de mise
  en cache par le navigateur ni un intermédiaire (proxy partagé), y compris
  après déconnexion. Vérifié : aucune réponse dans `localStorage`/
  `sessionStorage`/l'URL/l'historique de navigation.
- **Restriction d'écriture aux membres actifs (GATE LOT 3B §5).**
  `recordAnswers`/`clearAnswer` refusent désormais (`409`) toute nouvelle
  écriture pour un membre retiré du foyer depuis le démarrage de la
  session — seul `amendAnswer` (correction d'un enregistrement historique
  déjà existant) reste autorisé indépendamment du statut actuel du membre,
  décision documentée dans `server/advisorySessions.js`
  (`assertMemberCanAnswer`).
- **Concurrence optimiste (GATE LOT 3B §2)** : voir `API_CONTRACT.md` §3.
  Aucun impact sur la confidentialité en tant que telle, mais renforce
  l'intégrité (aucune écriture concurrente ne peut silencieusement écraser
  une intention plus récente) — propriété adjacente à la sécurité des
  données au sens large (nLPD art. 8, exactitude des données).
- **Champ `sensitive` (Lot 3A, préparatoire) — première consultation
  effective au Lot 3B.** `getSessionWorkspace` le recopie tel quel dans la
  projection ; le frontend l'utilise uniquement pour un badge visuel
  discret (« Donnée sensible »), sans aucun effet sur la visibilité, la
  validation de réponse ou la finalisation — usage strictement
  informationnel, proportionné à ce stade.
- **`listAnswerHistory` (Lot 3A, inchangée) — invariant de sécurité non
  revérifié à la lecture, signalé par la revue de conformité du Lot 3B.**
  Contrairement aux routes d'écriture (`recordAnswers`/`clearAnswer`/
  `amendAnswer`, qui appellent toutes `getQuestionForSession`/
  `assertMemberBelongsToSession`), la lecture de l'historique ne revérifie
  pas explicitement qu'une ligne `advisory_answers` appartient à la session
  demandée au-delà du filtre SQL `session_id = ?`. Aucune fuite n'est
  possible aujourd'hui, car aucune ligne ne peut exister en base sans être
  passée par un chemin d'écriture déjà contrôlé — mais cette garantie
  repose sur cet invariant plutôt que sur une vérification explicite au
  moment de la lecture, point à garder en tête si un chemin d'écriture
  alternatif (import, migration) était introduit plus tard.
- **Lot 4A — moteur de règles : 12 nouvelles actions d'audit**
  (`rule_set créé`/`version créée`/`cloné`/`archivé`/`publié`, `règle
  créée`/`modifiée`, `exécution lancée`/`échouée`, `finding écarté`,
  `consultation historique findings`, `consultation findings sensibles`),
  toutes vérifiées par un test dédié qui insère un marqueur distinctif dans
  chaque champ de texte libre (titre de règle, description, explications,
  motif d'écartement) et confirme son absence de `audit_log.details` pour
  les 12 actions — jamais une valeur de réponse, un contenu de condition ou
  de contrat, uniquement des identifiants, clés stables et compteurs
  (constat GATE LOT 4A, revue compliance-privacy-reviewer : la version
  précédente de cette phrase affirmait une couverture de test qui n'existait
  pas encore, corrigé).
  - **`consultation findings sensibles` — critère DÉRIVÉ, pas une propriété
    du finding lui-même** (revue `compliance-privacy-reviewer`, GATE LOT
    4A) : un finding n'est jamais marqué sensible en base ; la lecture
    (`GET .../findings`, `GET .../rule-executions/:id`, `GET .../rule-
    executions`, `GET .../findings/history`) journalise cette action
    distincte uniquement si au moins une référence conservée porte
    `sensitivity_at_execution = true`. Même fenêtre de déduplication que
    `consultation workspace session` (15 minutes,
    `SENSITIVE_DATA_VIEW_DEDUP_MINUTES`, `server/
    advisoryRuleExecutions.js`) et **même réserve** : politique à
    reconfirmer explicitement par le responsable protection des données
    avant toute mise en production avec du contenu métier réel.
  - **Classification FIGÉE au moment de l'exécution, jamais réévaluée à la
    lecture (GATE LOT 4A §4, correction d'un défaut identifié pendant le
    GATE)** : la version initiale de ce lot ré-interrogeait en direct
    `advisory_questions.sensitive` à chaque lecture — une reclassification
    ultérieure de la question (sensible devenue non-sensible, ou
    l'inverse) changeait alors rétroactivement la décision d'audit d'une
    exécution pourtant déjà produite, rendant le comportement d'audit
    dépendant de l'état courant plutôt que de l'exécution historique.
    Corrigé : `sensitivity_at_execution` est désormais capturé une fois,
    au moment même de l'exécution, et stocké dans `used_inputs_ref`/
    `inputs_snapshot.answers_used` ; `auditSensitiveDataAccessIfNeeded` ne
    lit plus jamais `advisory_questions` en direct, uniquement ce drapeau
    figé. Testé : sensibilité modifiée après coup (dans un sens comme dans
    l'autre) sans effet sur la décision d'audit d'une exécution déjà
    produite ; seule une NOUVELLE exécution capture la classification
    alors en vigueur.
  - **Correction d'une attribution d'audit incorrecte (GATE LOT 4A §7)** :
    la route `GET /api/advisory/sessions/:id/rule-executions` ne
    transmettait pas le contexte de requête (`req`) au service
    `listExecutions`, si bien que la journalisation dérivée
    `consultation findings sensibles` déclenchée depuis cette route
    précise s'attribuait systématiquement à un utilisateur générique
    (`système`) plutôt qu'au conseiller réellement authentifié. Corrigé,
    avec un test API dédié vérifiant l'attribution au vrai utilisateur.
  - **`exécution échouée` — distincte d'une simple absence de donnée.** Une
    règle dont les données requises sont absentes produit un finding
    `missing_information` normal (pas un échec) ; `exécution échouée` ne
    journalise qu'une erreur interne réellement inattendue (bug, état
    corrompu), enregistrée dans une ligne d'exécution séparée `status =
    'failed'` — jamais confondue avec l'issue normale « données
    manquantes ».
- **Minimisation de `inputs_snapshot`/`used_inputs_ref` (décision
  d'architecture, GATE LOT 4A, §4)** : ces deux structures JSON ne
  contiennent jamais la valeur d'une réponse, uniquement des références
  résolvables — `question_id`/`stable_key`/`household_member_id`/
  `answer_id` (la ligne EXACTE et IMMUABLE de `advisory_answers`
  effectivement utilisée, jamais relue ni recopiée ensuite),
  `questionnaire_version_id`, `sensitivity_at_execution` (classification
  figée, voir §6 ci-dessus) et `read_at` (horodatage unique de lecture,
  figé pour toute l'exécution). Pour une référence de contrat (donnée
  vivante/mutable), seul le champ minimal réellement utilisé est figé
  (`status_at_execution`), jamais le contrat complet. La valeur de réponse
  elle-même reste exclusivement dans `advisory_answers`, consultée
  séparément sous les mêmes contrôles d'accès existants — dupliquer la
  valeur dans l'historique d'exécution aurait multiplié les emplacements
  où une donnée potentiellement sensible est stockée, sans bénéfice réel.
- **Protection IDOR sur les exécutions et findings (GATE LOT 4A)** :
  `getExecutionDetail`/`dismissFinding` exigent explicitement l'identifiant
  de session en paramètre et vérifient que l'exécution/le finding demandé
  lui appartient réellement (`404` sinon) — même principe que
  `getQuestionForSession` (Lot 3A) : jamais un identifiant technique
  consultable indépendamment de son rattachement réel à la session
  courante, même si la ressource existe bel et bien en base sous un autre
  identifiant de session.
- **Aucun appel IA, aucun MCP dans le moteur de règles (confirmé, Lot 4A)** :
  `server/advisoryRuleConditions.js`/`server/advisoryRules.js`/`server/
  advisoryRuleExecutions.js` ne contiennent aucun `fetch`/appel réseau
  sortant, aucun `eval`/`new Function`, aucune dépendance à un modèle
  statistique ou génératif — évaluation purement synchrone, déterministe,
  en mémoire, sur les données déjà en base.
- **Lot 4B — espace conseiller des findings** :
  - **Nouvelle action d'audit distincte** `consultation espace constats
    session` (`getSessionFindingsWorkspace`, déduplication 15 minutes,
    fenêtre et politique séparées de `consultation workspace session` —
    deux écrans différents, jamais confondus dans la traçabilité) ; l'audit
    dérivé `consultation findings sensibles` s'applique à cette nouvelle
    route selon exactement le même critère dérivé que les quatre routes de
    lecture du Lot 4A (§6 ci-dessus).
  - **`content_hash` d'un ensemble de règles/d'une exécution — même
    précision de nature que pour la version de questionnaire (Lot 3A,
    ci-dessus)** : cette empreinte SHA-256 sert exclusivement à vérifier la
    reproductibilité technique, **jamais une signature cryptographique ni
    une preuve juridique**. Affichée dans le panneau d'historique des
    analyses (`client/src/pages/SessionFindings.jsx`) accompagnée
    explicitement de ce rappel, jamais présentée seule.
  - **Résolution du membre concerné par un finding — jamais une lecture
    directe de `household_members`** : `getSessionFindingsWorkspace`
    résout systématiquement le membre via `sessionMembersFor` (Lot 3B,
    déjà auditée pour l'IDOR), la même fonction que le workspace de
    réponses — jamais une requête indépendante par identifiant de membre,
    qui aurait pu exposer un membre d'un AUTRE foyer si un
    `household_member_id` invalide ou étranger avait été présent dans un
    `used_inputs_ref` historique.
  - **Aucune valeur de réponse dans le nouvel écran** : la traçabilité
    d'un finding (panneau « Sources et traçabilité ») n'affiche que des
    références déjà minimisées au Lot 4A (texte de question, indicateur de
    sensibilité) — jamais la valeur elle-même. « Voir la réponse source »
    ouvre l'espace de rendez-vous existant (`GET .../workspace`, déjà
    audité, déjà respectueux de la classification figée) plutôt que de
    construire un second mécanisme d'affichage de valeur avec sa propre
    surface d'audit — décision volontaire pour ne jamais dupliquer ce
    risque.
  - **Navigation vers la réponse source jamais dans l'URL** : l'identifiant
    de question et de membre transitent exclusivement via l'état de
    navigation React Router (`navigate(path, { state })`), jamais en
    paramètre d'URL — non journalisable par un serveur mandataire, non
    partageable par copie de lien, disparaît à la fermeture de l'onglet.
  - **Aucun stockage navigateur** (`localStorage`/`sessionStorage`) sur
    l'écran des constats ni sur l'extension de navigation du workspace —
    vérifié par QA formelle (`LOT4B_MANUAL_UI_CHECKLIST.md`).
  - **Aucun appel IA, aucun MCP** dans `executeApplicableRuleSetsForSession`
    ni dans la projection `getSessionFindingsWorkspace` — mêmes garanties
    que le moteur d'exécution du Lot 4A, jamais étendues à ce nouveau code.
  - **Navigation historique par `answer_id` (GATE LOT 4B §2, ajouté après le
    premier commit)** : `answerId` (en plus de `questionId`/`memberId`)
    transite lui aussi exclusivement via l'état de navigation, jamais dans
    l'URL — mêmes garanties que ci-dessus. Aucune nouvelle route créée :
    réutilise `GET .../answers/history`, déjà auditée
    (`consultation historique réponse`, Lot 3B), sans déduplication. La
    vérification anti-IDOR (l'`answer_id` annoncé appartient bien à cette
    session, cette question et ce membre) découle directement du filtrage
    SQL déjà en place sur cette route — aucun nouvel identifiant technique
    transmis, aucune nouvelle entrée d'audit distincte pour ce geste. Un
    `answer_id` inexistant, appartenant à une autre session du même foyer, à
    une session d'un autre foyer, rattaché à une autre question, ou à un
    autre membre que ceux annoncés produit EXACTEMENT la même réponse
    (aucune valeur affichée, message neutre exact *« La réponse historique
    demandée n'est pas disponible pour cette session. »*, aucune
    navigation) : les cinq cas sont volontairement indiscernables, aucun ne
    révèle à l'appelant lequel s'applique — chacun vérifié par un test
    backend/API DISTINCT (MICRO-GATE LOT 4B §2, corrige un rapport
    antérieur qui n'en avait vérifié qu'un seul représentatif), avec
    confirmation explicite qu'aucun n'introduit de fuite dans
    `audit_log.details` ni de différence de statut HTTP permettant de les
    distinguer.
    La projection `getSessionFindingsWorkspace`/`getExecutionDetail` expose
    en complément un indicateur dérivé `is_current_answer` par référence de
    réponse — jamais une valeur, seulement un booléen calculé à la lecture
    contre `advisory_answers.superseded_by_answer_id`.
  - **Sémantique de `common` corrigée dans l'état global (MICRO-GATE LOT 4B
    §1 et §3)** : un ensemble `common` ACTUELLEMENT publié (`status =
    'published'` au moment de la lecture, jamais « déjà publié un jour »)
    pèse désormais dans `global_state` exactement comme un domaine requis
    (son échec/obsolescence/non-exécution n'est plus masqué) — un ensemble
    seulement ARCHIVÉ, même s'il porte encore une exécution passée
    `up_to_date`/`stale`, ne rend jamais ce domaine applicable. Aucune
    incidence sur la confidentialité (aucune nouvelle donnée exposée, seule
    la LOGIQUE d'agrégation d'états déjà publics change), mais corrige un
    risque d'information trompeuse pour le conseiller (un badge « à jour »
    alors qu'un domaine réellement en échec restait invisible, ou
    inversement un domaine archivé et révolu affectant à tort l'état
    global).
  - **État global agrégé et synthèse active (GATE LOT 4B §3)** : `global_state`
    et `synthesis` (`getSessionFindingsWorkspace`) sont tous deux
    entièrement DÉRIVÉS à la lecture à partir des mêmes données déjà
    exposées par domaine — aucune nouvelle donnée personnelle/sensible
    introduite, aucun nouveau champ de configuration stocké.
  - **Garde anti-double-clic renforcée (GATE LOT 4B §7)** : `launchAnalysis`
    et `DismissModal.submit` (`client/src/pages/SessionFindings.jsx`)
    utilisent désormais une garde synchrone (`useRef`) en complément de
    l'état React existant, après détection d'une fenêtre de course réelle
    en QA (deux clics quasi simultanés pouvaient déclencher deux requêtes
    d'écriture identiques) — sans incidence sur la confidentialité, mais
    réduit un risque de double écriture involontaire (deux findings
    écartés en double, ou une analyse relancée deux fois inutilement).

## 7. Verrouillage de session

- Reprend le mécanisme existant (`express-session`, 8h, cookie httpOnly,
  verrouillage anti force-brute, 2FA TOTP optionnelle) — aucune modification
  proposée. Point de vigilance pour Lot 8 : si le mode présentation reste
  affiché sans interaction prolongée pendant un rendez-vous, un verrouillage
  d'écran dédié (distinct de l'expiration de session serveur) pourrait être
  utile — à évaluer, pas décidé ici.

## 8. Anonymisation et suppression

- Suit le mécanisme existant de `clients.anonymize` pour les personnes.
- Extension nécessaire (Lot 10) : quand un membre de foyer est anonymisé,
  les `advisory_answers`/`advisory_findings` qui le concernent doivent être
  traités cohérence avec l'anonymisation (contenu personnel supprimé,
  structure/traçabilité d'audit conservée) — à concevoir précisément en Lot
  10, pas dans ce document (dépend du modèle définitif validé en Lot 2/3).
  Point d'attention ajouté par la décision d'appartenance à plusieurs foyers
  (GATE LOT 1, décision 1) : `clients.anonymize` s'applique à la personne
  (une seule ligne `clients`), donc son effet touche **automatiquement
  toutes** les lignes `household_members` de tous les foyers où elle
  apparaît — à vérifier explicitement en Lot 10 pour éviter qu'un foyer
  actif ne conserve une référence à une personne déjà anonymisée sans le
  signaler.
- `advisory_consents` et `advisory_report_versions` ne sont jamais supprimés
  physiquement (valeur probante), seulement révoqués/remplacés par une
  version plus récente.

## 9. Rétention

- **Validation juridique requise** : durée de conservation propre aux
  données de diagnostic. Distincte des 10 ans comptables déjà appliqués aux
  contrats/commissions (art. 958f CO) — un diagnostic qui ne débouche sur
  aucun contrat n'a pas la même justification de rétention longue. Point à
  trancher avant Lot 10.

## 10. Export

- Doit s'aligner avec le mécanisme existant `GET /api/clients/:id/export`
  (droit d'accès nLPD) : une extension naturelle inclurait les données
  `advisory_*` liées au client dans cet export existant, plutôt que de créer
  un second mécanisme d'export parallèle — proposition à confirmer en Lot 10.

## 11. Sauvegardes

- Aucune sauvegarde séparée : les nouvelles tables vivent dans la même base
  SQLite (`data/crm.sqlite`), couverte par le mécanisme de sauvegarde
  existant (`GET /api/backup`, sauvegardes nocturnes serveur, Swiss Backup).
  Aucun nouveau composant de sauvegarde à créer.

## 12. Séparation développement / test / production ; fixtures fictives

- Reprend à l'identique la convention existante :
  `CRM_DATA_DIR` isolé par test (`test/api.test.js`, `test/migrations.test.js`),
  aucune donnée réelle dans les fixtures, noms/emails fictifs (`@example.ch`,
  cf. `server/seed-demo.js`).
- Toute donnée de démonstration future pour ce module (foyers, sessions
  fictives) suit strictement la même convention.

## 13. Protection des secrets

- Aucun secret nouveau n'est introduit par ce module dans cette version
  (pas de clé API tierce active). Si une future intégration IA/MCP nécessite
  une clé, elle suit la convention déjà en place dans `.env.example`
  (jamais en dur dans le code, jamais committée) — voir `MCP_STRATEGY.md`.

## 14. Assistance IA désactivée par défaut

- Double verrou obligatoire (voir `DATA_MODEL.md` §6.1 et
  `API_CONTRACT.md` §8) : consentement `purpose = 'assistance_ia'`
  **et** activation opérationnelle explicite, tous deux à `false` par
  défaut.
- Aucune donnée n'est envoyée à un service IA externe sans que les deux
  conditions soient réunies **et** journalisées (voir §16).
- L'IA n'intervient jamais dans le calcul du moteur de règles (principe
  déjà posé dans `RULES_ENGINE.md` §1) — uniquement en aval, sur du contenu
  déjà produit par le moteur déterministe (résumé, reformulation, brouillon
  de compte rendu, brouillon d'email de suivi).

## 15. Pseudonymisation

- Pour toute future assistance IA externe (Lot 12 au plus tôt), le contenu
  transmis devrait être pseudonymisé autant que possible (ex. remplacer les
  noms propres par des rôles — « le conjoint », « l'enfant aîné ») avant tout
  envoi, plutôt que transmettre l'identité complète du foyer. Mécanisme à
  concevoir précisément le moment venu, pas implémenté ici.

## 16. Limitation des données envoyées / journalisation des appels externes

- Tout futur appel à un service externe (IA ou MCP) doit être journalisé
  dans `audit_log` avec la finalité, la nature des données transmises (pas
  leur contenu), et le résultat — avant toute activation réelle en Lot 12.
- Par défaut, aucun appel externe n'est possible : pas de dépendance réseau
  sortante ajoutée par ce module dans les lots 2 à 10.

## 17. Révocation du consentement

- Voir §3 et `DATA_MODEL.md` §6.1 — révocation possible à tout moment,
  effet immédiat sur toute fonctionnalité conditionnée par ce consentement
  (ex. révoquer `assistance_ia` désactive immédiatement toute assistance IA
  pour ce foyer, sans attendre une action supplémentaire).

## 18. Gestion des incidents

- Aucun mécanisme dédié n'existe aujourd'hui dans le CRM au-delà du journal
  d'audit et des sauvegardes. Ce module ne crée pas de procédure d'incident
  séparée — il alimente le même journal d'audit consultable en cas
  d'investigation. Une procédure formelle de notification d'incident (nLPD)
  reste **hors périmètre technique** de ce document — point de validation
  organisationnelle/juridique, pas un livrable de code.

## 19. Qualité des données et détection de doublons entre personnes

**Décision humaine validée (point 2 du GATE de validation)** : aucune
contrainte d'unicité automatique reposant uniquement sur le nom, l'email ou
le téléphone n'est créée — les enfants et certaines personnes à charge
peuvent n'avoir ni l'un ni l'autre. Une **détection souple**, destinée à
assister le conseiller, est prévue à la place (principe documenté ici et
dans `DATA_MODEL.md` §2.3, `API_CONTRACT.md` §2 ; **algorithme non
implémenté avant le Lot 2**, voir `IMPLEMENTATION_ROADMAP.md`).

- Le système **peut signaler** qu'une personne similaire existe déjà ; il ne
  doit **jamais** : fusionner automatiquement deux personnes, supprimer
  automatiquement une fiche, empêcher systématiquement la création, ou
  conclure à une identité sur la seule base d'un nom identique.
- Quatre niveaux de correspondance sont distingués (détail dans
  `DATA_MODEL.md` §2.3) : **correspondance exacte**, **correspondance
  probable**, **simple similarité**, **absence de correspondance** — jamais
  binaire « doublon / pas doublon ».
- Toute confirmation de création malgré une correspondance **exacte** ou
  **probable** doit être auditée (`audit_log`), avec le niveau de
  correspondance et la personne existante concernée — jamais une création
  silencieuse dans ce cas.
- Cette détection est un enjeu de **qualité des données** (exactitude,
  rectification) autant que de protection des données : rapprocher à tort
  deux personnes différentes serait aussi problématique que ne pas détecter
  un vrai doublon — d'où l'absence de fusion/suppression automatique dans
  les deux sens.

## 20. Récapitulatif des points nécessitant une validation juridique, réglementaire ou métier

1. Contenu exact et base légale précise de chaque texte de consentement par
   finalité (§3).
2. Durée de conservation propre aux données de diagnostic (§9).
3. Modalités exactes d'une éventuelle notification d'incident (§18).
4. Statut juridique/probant exact du rapport final et de ses versions
   corrigées (voir aussi `REPORT_SPECIFICATION.md`).
5. Cadre précis autorisant un futur envoi de données à un service IA externe,
   y compris pseudonymisées (§14-16).
6. Confirmation que les catégories de données prévues (§1) restent hors du
   périmètre « données de santé » au sens strict de la nLPD, ou révision du
   niveau de protection si un futur lot s'en approchait.
7. Portée exacte de l'effet d'une révocation de consentement lorsqu'une
   autre obligation de conservation s'applique (ex. données déjà intégrées
   à un rapport final déjà généré) — la révocation reste prospective par
   conception (§3, `DATA_MODEL.md` §6.1), mais l'articulation précise avec
   les obligations de conservation reste à valider juridiquement.
8. **Ajouté suite à la revue de conformité du Lot 2** : proportionnalité
   d'exposer la date de naissance complète d'un candidat (plutôt qu'une
   information moins précise, ex. année seule ou simple indicateur de
   concordance) dans la réponse de détection de doublons
   (`POST /api/advisory/households/:id/members/check-similarity`,
   `DATA_MODEL.md` §2.3). L'exposition sert directement l'objectif
   fonctionnel (permettre au conseiller de distinguer deux personnes de même
   nom) et reste, dans le modèle mono-conseiller actuel, visible uniquement
   par la même personne ayant déjà accès aux fiches complètes — mais la
   question de proportionnalité au sens nLPD, en particulier dans la
   perspective d'une future évolution multi-conseiller (§5, colonne
   `owner_user_id` présente mais non encore exploitée), mérite une
   confirmation par un spécialiste de la protection des données avant toute
   généralisation.

Ces 8 points ont été examinés lors du GATE de validation LOT 1 et de la
revue de conformité du Lot 2, et restent **non tranchés par ce document**.
Ils ne bloquent ni le commit documentaire du LOT 1 ni l'implémentation
technique du Lot 2, mais constituent des **conditions obligatoires devant
être validées avant** :
- toute mise en production réelle ;
- toute collecte de données client réelles ;
- tout usage effectif d'une intelligence artificielle externe ;
- toute génération de rapport juridiquement utilisé ;
- toute activation définitive des consentements (au-delà d'un usage de
  test/démonstration) ;
- toute politique définitive de conservation ou d'effacement.
