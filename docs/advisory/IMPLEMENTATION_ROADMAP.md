# Feuille de route d'implémentation — Lots 2 à 13

> Découpage proposé, à valider lot par lot avant démarrage de chacun (aucun
> lot n'est démarré par ce document). Chaque lot doit rester testable et
> réversible indépendamment des suivants.

## Lot 2 — Socle foyer

- **Objectif** : créer `households`/`household_members` et les routes de
  base (création, composition, consultation), sans questionnaire ni règles.
  Inclut, cette fois, l'implémentation réelle du **service de détection
  souple de doublons** (`POST .../members/check-similarity`, décision GATE
  LOT 1, décision 2) — c'est le lot désigné par cette décision pour écrire
  l'algorithme, resté volontairement non implémenté pendant le LOT 1.
- **Tables** : `households`, `household_members` (migration à numéroter au
  moment de l'implémentation, cf. `DATA_MODEL.md` §0).
- **Routes** : `API_CONTRACT.md` §1-2 (y compris `check-similarity` et
  `set-primary`).
- **Écrans** : `UX_AND_CLIENT_MODE.md` 1.2, 1.3.
- **Tests** : création foyer, ajout membre avec/sans coordonnées propres,
  délégation de contact, refus de doublon actif **dans le même foyer**,
  **acceptation** d'un même `client_id` dans plusieurs foyers actifs
  différents (décision GATE LOT 1, décision 1 — à ne pas régresser vers un
  blocage), `member_role = principal` unique par foyer actif, procédure
  `set-primary` (rétrogradation + promotion atomiques + audit), refus de
  retirer un membre `principal` sans passer par `set-primary`, les 4
  niveaux de correspondance du service de détection de doublons
  (`exact_match`/`probable_match`/`possible_similarity`/`no_match`), refus non systématique (confirmation
  possible via `confirmed_despite_match`) avec audit de la confirmation,
  absence de fusion/suppression automatique dans tous les cas.
- **Risques** : aucun point structurant non tranché ne subsiste après le
  second GATE de validation LOT 1 — les décisions 1 et 2 sont validées et
  n'ont plus à être rediscutées. Risque technique propre à ce lot :
  l'algorithme de détection de doublons doit rester simple et transparent
  (règles explicables, pas un score opaque) pour respecter le principe
  général du module (explicabilité, jamais de décision automatique
  masquée).
- **Critères d'acceptation** : `npm test`/`npm run lint`/`npm run build`
  passent ; aucune régression sur les tests existants ; un enfant peut être
  créé sans email/téléphone/adresse/profession et rattaché à un foyer ; une
  personne peut être rattachée à deux foyers actifs sans erreur.
- **Actions interdites** : ne pas modifier `clients` (schéma inchangé, cf.
  §1.1) ; ne pas toucher aux routes `contracts`/`commissions` ; le service
  de détection de doublons ne doit jamais fusionner ni supprimer
  automatiquement une fiche.
- **Dépendances** : aucune (peut démarrer dès validation de ce LOT 1).
- **Retour arrière** : `DROP TABLE household_members; DROP TABLE
  households;` — aucune autre table n'y référence de clé étrangère à ce
  stade, réversibilité totale.

## Lot 3A — Sessions et questionnaire générique (implémenté)

> **Statut : implémenté et testé.** Renommé « Lot 3A » en cours de route
> (le frontend complet du rendez-vous, initialement inclus ici, est différé
> au « Lot 3B » — voir note ci-dessous) ; migration 10, `server/
> advisorySessions.js`, `server/advisoryQuestionnaires.js`, `server/
> advisoryConditions.js`.

- **Objectif** : `advisory_sessions`, moteur de questionnaire, structure de
  questionnaire versionnée, sans moteur de règles ni contenu métier
  spécifique maladie/vie (questionnaire de test générique pour valider le
  moteur).
- **Tables (8, une de plus que prévu)** : `advisory_questionnaires`,
  `advisory_questionnaire_versions`, `advisory_sections`,
  `advisory_questions`, `advisory_question_options`, `advisory_sessions`,
  `advisory_session_questionnaires` (**ajoutée** — composition modulaire,
  voir `DATA_MODEL.md` §3.2), `advisory_answers`.
- **Routes** : `API_CONTRACT.md` §3-5 (réécrites pour refléter
  l'implémentation réelle — composition modulaire, identifiants anglais,
  route de prévisualisation `completion-check`).
- **Écrans** : frontend minimal seulement (liste des sessions, création,
  détail technique, actions démarrer/suspendre/reprendre/annuler/finaliser)
  — le rendu complet des questions et la progression visuelle sont différés
  au **Lot 3B** (implémenté depuis, voir plus bas) ; le mode présentation
  client reste différé au **Lot 8**, non démarré (`UX_AND_CLIENT_MODE.md`
  §1.1/1.4/1.5/1.6/1.13/1.14 : §1.5 implémentée au Lot 3B, §1.11 reste une
  proposition non implémentée pour le Lot 8).
- **Divergence majeure actée en cours de lot** : la composition d'une
  session mixte se fait par une table d'association
  (`advisory_session_questionnaires`, une version `health` **et** une
  version `life_pension` distinctes, jamais fusionnées) plutôt que par une
  version de questionnaire elle-même « mixed » — décision prise après que
  la revue d'architecture a signalé un risque réel de duplication de
  contenu avec la première approche.
- **Tests (176 nouveaux : migration, conditions, questionnaires, sessions,
  API)** : cycle de vie complet d'une session (draft → in_progress →
  suspended → repris → completed), machine d'état stricte action-par-action
  (bug détecté et corrigé : `resume` ne doit jamais être acceptable depuis
  `draft` même s'il cible le même statut que `start`), immuabilité après
  `completed`, conditions d'affichage (déterminisme, cycles, références
  inconnues, publication refusée si invalide), réponse `unknown`/
  `not_applicable`/`cleared`, versionnement (clonage, archivage sans
  altérer les sessions historiques), modèle append-only des réponses
  (ordre d'écriture corrigé : la ligne active doit être retirée avant
  l'insertion de la nouvelle, sinon violation transitoire de l'index unique
  partiel), refus de `PUT .../answers` sur une session `completed`, route
  `POST .../answers/amend` fonctionnelle, session `domain = mixed`
  distinguant les éléments manquants par domaine à la finalisation, membre
  d'un autre foyer refusé dans une réponse (invariant de confidentialité
  vérifié en test).
- **Risques** : complexité du moteur de conditions d'affichage, maîtrisée
  par une restriction explicite (une condition ne référence jamais une
  question d'une autre version).
- **Critères d'acceptation** : reprise d'une session suspendue restitue
  exactement l'état précédent ; une session finalisée refuse toute nouvelle
  réponse par la route normale (`409`), seule la route d'amendement dédiée
  reste ouverte, avec motif obligatoire. Tous vérifiés par test.
- **Actions interdites (respectées)** : aucune logique de règles métier
  dans ce lot (aucune table `advisory_rules` créée) ; aucune question codée
  en dur côté React (aucun contenu métier réel, uniquement des
  questionnaires fictifs de démonstration).
- **Dépendances** : Lot 2.
- **Retour arrière** : `DROP TABLE` des 8 tables listées, dans l'ordre
  inverse de création (respect des clés étrangères) — aucune donnée hors de
  ce module n'est affectée.

## Lot 3B — Interface de conduite du rendez-vous (implémenté)

> **Statut : implémenté et testé.** **Divergence de périmètre corrigée par
> rapport à la formulation ci-dessous** (écrite avant le lancement réel du
> lot) : le **mode présentation client est explicitement exclu** de ce lot
> par la décision humaine qui l'a lancé — il n'a jamais fait partie de
> l'objectif réellement poursuivi, contrairement à ce que cette entrée
> laissait entendre. Restent également hors périmètre (confirmés à
> l'identique) : moteur de règles diagnostiques, findings, recommandations,
> comparaison de produits/assureurs, calculs LAMal/3a/3b, rapport PDF,
> consentements définitifs, IA, MCP, portail client.

- **Objectif réellement livré** : espace de travail React
  (`client/src/pages/SessionWorkspace.jsx`,
  `/diagnostic-360/sessions/:id/workspace`) — ouverture d'une session,
  navigation par module (commun/santé/vie-prévoyance, jamais fusionnés) puis
  par section, sélection du membre concerné pour une question de portée
  individuelle, saisie et sauvegarde des réponses (immédiate pour les
  contrôles discrets, différée de 600 ms pour le texte/numérique), usage de
  `unknown`/`not_applicable` uniquement lorsque la question l'autorise,
  progression globale/par module, suspension/reprise, vérification des
  éléments manquants et finalisation, consultation de l'historique d'une
  question, amendement après finalisation avec motif obligatoire.
- **Principe respecté** : le frontend ne réimplémente aucune règle de
  visibilité/validation/finalisation — une projection unique et
  entièrement résolue côté serveur (`getSessionWorkspace`/
  `GET /api/advisory/sessions/:id/workspace`, `API_CONTRACT.md` §3) réutilise
  à 100 % le moteur existant du Lot 3A (`evaluateCondition`,
  `getVersionDetail`, `buildAnswerIndex`, `validateSessionForCompletion`).
- **Aucune migration** : `PRAGMA user_version` reste à 10, aucune table
  ajoutée — la progression est entièrement dérivée des réponses existantes,
  jamais stockée en double.
- **GATE de validation et de correction (avant tout commit)** : une revue
  humaine dédiée a identifié plusieurs lacunes réelles dans
  l'implémentation initiale, toutes corrigées avant le premier commit du
  lot :
  - **Concurrence optimiste** (`API_CONTRACT.md` §3) : le champ `revision`,
    déjà présent mais dormant depuis le Lot 3A, protège désormais
    réellement toute écriture (`expected_revision` obligatoire, `409` sur
    conflit, aucune écriture ni audit de succès en cas de refus) — testé y
    compris avec deux onglets concurrents et des requêtes réseau
    délibérément inversées (arrivée au serveur dans l'ordre inverse de
    l'émission).
  - **File de sauvegarde réelle côté frontend** : les écritures d'une même
    session sont désormais sérialisées (une seule à la fois), remplaçant un
    simple jeton qui ne protégeait que l'affichage, jamais l'ordre réel
    d'écriture en base.
  - **Sauvegardes en attente** (`flushPendingSaves`) : une saisie encore en
    débounce est explicitement envoyée avant tout changement de
    membre/section/module, suspension, contrôle de finalisation ou sortie
    du workspace — jamais perdue silencieusement.
  - **Session suspendue réellement en pause** (décision humaine) :
    n'accepte plus aucune nouvelle réponse avant reprise explicite
    (comportement du Lot 3A corrigé).
  - **Périmètre des membres figé** (`household_snapshot`, décision
    humaine) : une session `in_progress` et au-delà fige son périmètre de
    membres au démarrage — un membre retiré depuis reste visible
    (historique, lecture seule), un membre ajouté depuis n'apparaît jamais
    rétroactivement ; la validation de finalisation utilise ce même
    périmètre figé.
  - **Audit de la lecture du workspace et de l'historique**, avec
    déduplication technique pour la première (décision initiale de
    non-audit non validée).
  - **En-têtes anti-cache** sur les routes exposant des réponses.
  - **Amendement contextualisé** : chaque question répondue d'une session
    finalisée porte une action directe « Corriger cette réponse » ; le
    sélecteur global devient une recherche groupée par module/section,
    remplaçant un `<select>` plat qui ne passerait pas à l'échelle.
  - **Accessibilité tactile** : cible portée à ~40-44px pour les contrôles
    propres au workspace.
- **Tests** : voir rapport du GATE Lot 3B pour le décompte exact (projection
  backend — domaines/mixte/module commun facultatif/visibilité dynamique/
  portée membre/statuts de réponse/statuts de session/foyer archivé/version
  archivée historique/minimisation/concurrence optimiste/snapshot des
  membres/audit dédupliqué — et vérification navigateur manuelle couvrant
  30 scénarios).
- **Dépendances** : Lot 3A.

## Lot 4A — Moteur de règles (implémenté)

> **Statut : implémenté et testé.** Renommé « Lot 4A » en cours de route,
> même convention que le découpage Lot 3A/3B : ce lot livre exclusivement le
> moteur (schéma, service, exécution, API) et un jeu de règles **fictives**
> de test — l'espace conseiller de consultation des findings (écran React,
> orchestration multi-domaines) est livré séparément par le « Lot 4B »
> ci-dessous, comme prévu dès la conception de ce lot. Migration 11,
> `server/advisoryRules.js`, `server/advisoryRuleConditions.js`, `server/
> advisoryRuleExecutions.js`, `server/canonicalJson.js`, `server/routes/
> advisoryRules.js`, extension de `server/routes/advisorySessions.js`.

- **Objectif réellement livré** : `advisory_rule_sets`/`advisory_rules`/
  `advisory_rule_executions`/`advisory_findings`, moteur d'exécution
  déterministe, sans contenu de règles métier réel — uniquement des règles
  fictives de test, chacune portant la mention « Exemple technique fictif —
  ne constitue pas un conseil d'assurance. » dans son champ `source`.
- **Tables (4, conformes au plafond fixé)** : les quatre citées ci-dessus.
  Aucune `advisory_recommendations`, aucun catalogue produit/assureur,
  aucune `advisory_consents`/`advisory_reports` — vérifié explicitement par
  test de migration (`test/migrations.test.js`).
- **Routes** : `advisory_rule_sets`/`advisory_rules` sous
  `/api/advisory/rule-sets` (nouveau routeur dédié, même convention que
  `/api/advisory/questionnaires`) ; exécutions et findings sous
  `/api/advisory/sessions/:id/rule-executions` et `.../findings`
  (rattachés au routeur de sessions existant, comme `.../answers` — ce sont
  des sous-ressources d'une session, pas une ressource indépendante).
  Voir `API_CONTRACT.md` §6-7 pour le détail. Pas encore
  `advisory_recommendations` (Lot 7).
- **Décisions d'architecture actées en cours de lot** (toutes documentées en
  commentaire dans le code et dans `RULES_ENGINE.md`/`DATA_MODEL.md`) :
  - Une ligne d'exécution par **(session, domaine)**, jamais par règle
    individuelle — divergence par rapport à la proposition initiale de
    `DATA_MODEL.md` v1 §5, resserrée après revue.
  - Le rule_set utilisé pour un couple (session, domaine) est **dérivé de
    l'historique des exécutions** (première exécution = référence
    permanente), jamais d'une colonne de figeage sur `advisory_sessions`
    (qui aurait été incompatible avec une session `mixed`, laquelle a besoin
    de deux rule_sets figés simultanément).
  - Cycle de vie d'une règle individuelle calqué sur
    `advisory_questions.status` (`active`/`archived`) plutôt qu'un second
    cycle `brouillon`/`valide` propre à la règle — la publication du
    rule_set qui la contient EST l'acte de validation humaine.
  - `server/advisoryRuleConditions.js` reste un module **séparé** de
    `server/advisoryConditions.js` (Lot 3A) — univers référençable
    réellement différent (contrats, résultat d'une autre règle), seuls les
    principes génériques (détection de cycle) sont repris à l'identique.
  - Double contrôle anti-contradiction (`RULES_ENGINE.md` §4) : simulation
    bornée à la publication (recoupement de catégories sur des profils de
    réponses synthétiques) **et** comparaison en temps réel à l'exécution
    (`needs_review`/`conflicts_with`) — les deux, ni l'un à la place de
    l'autre, confirmé par la revue `rules-engine-auditor`.
- **Tests — chiffres reconciliés (GATE LOT 4A §6)** : le rapport initial
  annonçait « baseline 589, nouveaux 139, total 731 », une addition
  manuelle incorrecte (589 + 139 = 728, écart de 3 non expliqué). Baseline
  RÉELLE vérifiée empiriquement dans un worktree isolé au commit
  `1bc3e15b96b9bc330be0783f5df258286232812f` : **589** (confirmé, inchangée).
  L'écart de 3 provient de `test/migrations.test.js` (fichier PRÉEXISTANT,
  35 → 38 tests : un test renommé/resserré en place — les 8 tables `v10`
  ne sont plus décrites comme exhaustives puisque `v11` en ajoute 4 — et 3
  tests `v11` réellement nouveaux ajoutés dans ce même fichier), omis du
  calcul initial qui ne comptait que les 5 nouveaux FICHIERS de test
  (166 tests : `advisory-rule-conditions` 61, `advisory-rule-executions`
  43, `advisory-rules` 39, `advisory-rule-executions-api` 9,
  `advisory-rules-api` 14). Net réellement ajouté à ce stade : 169 (166 + 3),
  total 758 — puis encore augmenté par les corrections du GATE lui-même
  (§2-§9, voir rapport final du GATE pour le total exact au moment de la
  validation). Aucun test supprimé, un seul renommé (voir ci-dessus).
- **Tests (contenu, inchangé dans son intention)** : les 16 opérateurs et 7 natures de référence du DSL
  (typage strict, sans coercition implicite contrairement au moteur de
  conditions de questionnaire), sémantique `all`/`any` avec vacuité
  correcte, détection de cycle/profondeur excessive entre règles,
  validation de publication (source/référence/date d'effet/explication
  obligatoires, dépendance vers une question à texte libre refusée, référence
  directe hors quantificateur à une question de portée membre refusée,
  recoupement de catégorie signalé sans bloquer), empreinte de contenu
  indépendante de l'ordre d'insertion, exécution complète (donnée
  manquante → finding `missing_information` jamais un résultat par défaut
  y compris pour une question de portée membre partiellement répondue,
  quantificateur sur les membres, résolution de branche de contrat contre
  le snapshot figé de la session (jamais la composition vivante du foyer),
  dépendance entre règles via `rule_result`, supersession après
  ré-exécution, reproductibilité bit à bit, enregistrement d'une exécution
  échouée en cas d'erreur interne inattendue jamais silencieuse — sans
  jamais figer le rule_set sur une tentative échouée —, ré-exécution
  possible même après archivage du rule_set déjà figé), protection IDOR sur
  les identifiants d'exécution/de finding, journalisation dédiée et
  dédupliquée de la consultation de findings tracés jusqu'à une question
  sensible sur les 4 routes de lecture concernées, absence de fuite de
  contenu métier dans les 12 actions d'audit (vérifiée par un test dédié à
  marqueur distinctif, pas seulement par comptage).
- **Revues post-implémentation (4 rôles) et corrections apportées avant
  GATE** : `rules-engine-auditor` a signalé un défaut bloquant (une
  référence directe, hors quantificateur `all`/`any`, à une question de
  portée membre résolvait silencieusement à « absente », rendant
  `not_exists` toujours vrai à tort) — corrigé par un refus explicite à la
  publication (`collectDirectAnswerKeys`) et par une vérification de
  présence de `required_data` désormais consciente de la portée membre
  (conservatrice : exige que tous les membres du foyer figé aient répondu).
  `advisory-architect` a signalé trois points : le figeage du rule_set
  comptait à tort une exécution `failed` comme référence — corrigé (seules
  les exécutions `completed` comptent) ; un rule_set déjà figé devenait
  inexécutable après son archivage — corrigé (une ré-exécution reste
  possible sur un rule_set publié **ou** archivé une fois déjà figé,
  jamais brouillon) ; la résolution de `contract_branch` utilisait la
  composition vivante du foyer plutôt que le snapshot figé de la session —
  corrigé pour la reproductibilité. `compliance-privacy-reviewer` a signalé
  que la lecture de la liste des exécutions (`GET .../rule-executions`)
  n'était auditée nulle part — corrigé, et harmonisé avec l'historique des
  findings, qui ne déclenchait pas non plus la vérification dérivée
  « consultation findings sensibles ». `client-meeting-ux` a signalé une
  incohérence de tri par priorité entre les routes de lecture de
  findings — corrigée (ordre `critical`/`high`/`medium`/`low` harmonisé) ;
  ses autres constats (attribution d'un finding à un membre précis,
  résolution de `client_explanation` absente en mode présentation,
  acquittement de `needs_review` après écartement d'un des deux côtés d'un
  conflit) restent des points ouverts, explicitement déférés au Lot 4B —
  voir rapport final du GATE.
- **Corrections apportées PENDANT le GATE de validation** (avant tout
  commit, sur demande humaine explicite — non détectées par les 4 revues
  post-implémentation ci-dessus, qui portaient sur la version pré-GATE) :
  - **Domaine `common` ajouté** (§2) : troisième domaine de `rule_set`,
    facultatif, pour les constats transverses au foyer ; politique « un
    seul rule_set publié par domaine » implémentée (nouvelle famille
    bloquée si une autre est déjà publiée, nouvelle version de la même
    famille auto-archive l'ancienne).
  - **`finding_scope` et attribution membre** (§3) : `household_member_id`
    existait sans jamais être renseignée — comblé par un champ
    `finding_scope` (`session`/`household`/`member`) déclaré par règle,
    un nouveau primitif DSL `resolveQuantifierMembers` pour une
    attribution déterministe (jamais arbitraire) aux membres réellement
    concernés, et une validation de publication exigeant une condition
    racine `all`/`any` pour toute règle `member`.
  - **Classification de sensibilité FIGÉE** (§4) : l'audit `consultation
    findings sensibles` s'appuyait sur une requête en direct de
    `advisory_questions.sensitive`, rendant son verdict dépendant de
    l'état courant plutôt que de l'exécution historique — corrigé par un
    drapeau `sensitivity_at_execution` figé une fois pour toutes à
    l'exécution.
  - **Conflits : historique vs actif** (§5) : `needs_review` restait figé
    même après l'écartement du finding contradictoire qui le justifiait —
    corrigé par un recalcul (`recomputeActiveConflicts`) à chaque
    écartement, tout en conservant séparément
    (`conflicts_detected_at_execution`) le constat historique immuable.
  - **Exécution finale réservée à `completed`** (§9) : la version pré-GATE
    acceptait aussi une session `in_progress` — reconnu en contradiction
    avec la décision humaine attendue et corrigé (`in_progress` refusé
    exactement comme un brouillon/suspendu/annulé).
  - **Bug d'attribution d'audit corrigé** (§7) : `GET .../rule-executions`
    ne transmettait pas le contexte d'authentification au service,
    attribuant à tort la journalisation « consultation findings
    sensibles » à un utilisateur générique plutôt qu'au vrai conseiller.
- **Correctif ciblé, SECOND GATE, avant tout commit** (décision humaine
  explicite : l'hypothèse mono-processus jugée insuffisante pour garantir
  « un seul rule_set publié par domaine ») : ajout d'un index UNIQUE
  PARTIEL SQLite (`idx_advisory_rule_sets_one_published_per_domain`,
  intégré directement dans la migration 11, jamais une migration 12 —
  celle-ci n'étant encore ni committée ni déployée). Réordonnancement de
  `publishRuleSet` (archivage de l'ancienne version toujours avant
  publication de la nouvelle, dans la même transaction — l'index étant
  vérifié statement par statement, jamais différé en SQLite) et traduction
  de toute violation de contrainte résiduelle en `409` propre, sans fuite
  de détail SQL. Vérifié par une matrice de tests SQL bruts (les trois
  domaines, chaque combinaison de statuts, existence/unicité/caractère
  partiel de l'index, migration réelle depuis une base v10, redémarrages
  répétés), un rollback forcé par déclencheur SQL temporaire (technique
  locale au test, aucun mécanisme dangereux ajouté au code de production),
  et deux VRAIES connexions `better-sqlite3` concurrentes sur le même
  fichier (verrouillage WAL réel puis violation d'unicité). Documentation
  mise à jour dans `MIGRATIONS.md`/`DATA_MODEL.md`/`RULES_ENGINE.md`/
  `ARCHITECTURE.md` : la garantie ne dépend plus d'aucune hypothèse sur le
  nombre de processus applicatifs.
- **Risques** : format des `conditions` à figer avant d'écrire des règles
  réelles (Lot 5/6 en dépendent directement) — tout changement de format
  après coup impliquerait de réévaluer les règles déjà écrites.
- **Critères d'acceptation (vérifiés)** : le moteur ne produit jamais
  `advisory_recommendations` directement (cette table n'existe même pas
  encore à ce stade — elle arrive en Lot 7) ; chaque exécution est tracée et
  explicable ; aucune modification en place d'une règle publiée.
- **Actions interdites (respectées)** : aucun contenu de règle réel
  spécifique maladie ou vie dans ce lot — uniquement le moteur et des
  règles de démonstration fictives ; aucun appel IA, aucun MCP.
- **Dépendances** : Lot 3.
- **Retour arrière** : `DROP TABLE` des 4 tables — aucune règle réelle
  n'existant encore, aucune perte de contenu métier possible.

## Lot 4B — Espace conseiller des findings (implémenté)

> **Statut : implémenté et testé.** Livre exclusivement l'espace conseiller
> de consultation/écartement des findings déjà produits par le moteur du
> Lot 4A — jamais un éditeur de règles complet côté React (resté
> volontairement hors périmètre, lecture seule uniquement si un jour
> nécessaire), jamais une recommandation automatique, jamais de contenu de
> règle métier réel. Aucune nouvelle table, aucune nouvelle migration
> (fonctionne intégralement sur le schéma des 4 tables du Lot 4A). Extension
> de `server/advisoryRuleExecutions.js`/`server/routes/advisorySessions.js`,
> nouvelle page `client/src/pages/SessionFindings.jsx`, extension de
> `client/src/pages/SessionWorkspace.jsx`/`SessionDetail.jsx`/`App.jsx`.

- **Objectif réellement livré** : projection serveur unique et prête à
  afficher (`getSessionFindingsWorkspace`), orchestration d'un lancement
  d'analyse multi-domaines en un geste conseiller
  (`executeApplicableRuleSetsForSession`), et l'écran React qui les
  consomme — filtrage (jamais un re-tri), traçabilité, navigation
  contextualisée vers la réponse source, écartement, historique des
  analyses. Voir `API_CONTRACT.md` §6-7 pour le détail des deux nouvelles
  routes (`POST .../analyze`, `GET .../findings-workspace`) et
  `UX_AND_CLIENT_MODE.md` §5 pour l'écran.
- **Décisions d'architecture actées en cours de lot** :
  - **Aucune atomicité globale entre domaines** (§7 du brief conseiller) :
    chaque domaine garde sa propre transaction indépendante au sein de
    l'orchestration — une atomicité englobante aurait cassé la garantie
    « toujours tracer, jamais silencieux » de l'exécution `failed` du Lot
    4A. Voir `RULES_ENGINE.md` (relance après amendement).
  - **`FINDINGS_ORDER_BY` étendu côté serveur** (`needs_review DESC` en
    tête, avant la priorité) plutôt qu'un tri frontend — reste 100% source
    de vérité serveur, un filtre client est une partition stable, jamais
    un nouveau comparateur.
  - **Aucune valeur de réponse affichée dans le nouvel écran** : « Voir la
    réponse source » ouvre l'espace de rendez-vous déjà existant et déjà
    audité plutôt que de construire un second mécanisme d'affichage de
    valeur — décision de minimisation volontaire, plus stricte que le
    strict minimum demandé.
  - **Navigation contextualisée jamais dans l'URL** : identifiants de
    question/membre transmis via l'état de navigation React Router
    (`{questionId, memberId}`), résolus par une recherche linéaire dans la
    projection déjà chargée du workspace (même famille de motif que
    `resolveMissingContext`, Lot 3B) — jamais une troisième résolution
    divergente.
- **Défauts réels détectés et corrigés pendant la QA formelle** (jamais
  seulement documentés comme limitation connue, voir
  `LOT4B_MANUAL_UI_CHECKLIST.md` pour le détail complet) :
  - **Détection de conflit trop large** (`server/advisoryRuleExecutions.js`) —
    des findings produits par LA MÊME règle à portée membre (un par membre
    correspondant, comportement normal du Lot 4A) partagent nécessairement
    le même `category_hint` et se signalaient à tort comme en conflit
    ENTRE EUX. Corrigé en excluant les paires de même `rule.id` du
    regroupement par catégorie ; deux tests dédiés verrouillent le
    comportement correct.
  - **Débordement horizontal à 375px** — deux causes CSS distinctes,
    toutes deux le motif classique « conteneur flex/grille sans
    `min-width: 0`, refusant de rétrécir sous la largeur intrinsèque d'un
    descendant » : `.main` (mise en page globale de l'application, partagée
    par toutes les pages) et `.wksp-rail` (rail de sections du workspace,
    Lot 3B — jamais modifié par ce lot avant cette découverte, corrigé ici
    car directement exposé par la nouvelle navigation entrante). Les deux
    correctifs sont des ajouts `min-width: 0` strictement non-régressifs.
- **Défauts réels détectés et corrigés pendant les 4 revues finales
  post-implémentation** (mêmes rôles que les revues préalables, focus
  différent — code réel plutôt qu'une proposition) :
  - **Navigation « Répondre → » cassée pour une information manquante à
    portée membre** (`advisory-architect`) — `structuredDataRef` ne
    renseignait jamais `household_member_id` ni le `scope` de la question
    manquante ; le frontend tentait systématiquement une résolution de
    portée foyer, qui échoue toujours pour une question de portée membre
    (aucune instance foyer n'existe). Corrigé : `scope` ajouté à la
    référence structurée, le frontend n'offre plus de lien cassé pour ce
    cas mais un message explicite (« une ou plusieurs personnes du foyer
    n'ont pas encore répondu »). Voir `RULES_ENGINE.md` §8.
  - **Historique des analyses non hydraté** (`advisory-architect`) —
    `getExecutionDetail` (route Lot 4A réutilisée par la modale
    d'historique du Lot 4B) n'appliquait pas la même hydratation groupée
    que `getSessionFindingsWorkspace`, dégradant silencieusement l'auteur
    d'un écartement et le texte de question affichés dans l'historique.
    Corrigé en alignant les deux routes sur la même hydratation.
  - **Incohérence doc/code sur l'ordre partagé des findings**
    (`rules-engine-auditor`) — `RULES_ENGINE.md` affirmait `FINDINGS_ORDER_BY`
    partagé par « toutes » les routes, alors que l'historique complet
    (`GET .../findings/history`) reste délibérément trié par `id DESC`
    (vue chronologique multi-exécutions, jamais par état actif). Corrigé
    en documentant explicitement cette exception, jamais un changement de
    comportement.
  - **Lacunes de test** (`rules-engine-auditor`) — `last_attempt_failed`
    et le cas « deux règles différentes ciblant le même membre avec la
    même catégorie » n'étaient couverts par aucun test ; deux tests ajoutés.
  - **Ergonomie** (`client-meeting-ux`) — message dupliqué pour un domaine
    sans exécution (bannière + état vide identiques) ; badge « Conflit
    actif » sans référence au constat concerné. Corrigés : message unique,
    et le badge nomme désormais explicitement le(s) titre(s) en conflit.
  Les deux premiers défauts (navigation cassée, historique non hydraté)
  sont des régressions fonctionnelles réelles pour un conseiller en
  rendez-vous — jamais seulement des remarques cosmétiques. Re-vérifiés par
  un test HTTP/navigateur ciblé après correctif (base de démonstration
  temporaire dédiée, supprimée après).
- **Tests** : 813 tests après ce lot (baseline 788 à la fin du Lot 4A +
  correctif SQL, +25 nouveaux — orchestration, projection, ordre des
  findings, correctif de détection de conflit, routes API, cas limites
  identifiés en revue finale). `npm run lint`/`npm test`/`npm run build`
  exécutés avec succès après chaque correctif.
- **GATE ciblé (avant tout commit, corrections apportées au rapport initial
  ci-dessus)** :
  - **Navigation historique par `answer_id`** (GATE §2) : la navigation
    « Voir la réponse source » reposait initialement sur
    `{questionId, memberId}` uniquement — insuffisant pour garantir
    l'ouverture de la réponse HISTORIQUE exacte utilisée par le finding
    (une réponse a pu être amendée depuis). `answerId` (la ligne immuable
    déjà capturée dans `used_inputs_ref` au Lot 4A) devient la source de
    vérité : transmis en plus via l'état de navigation, vérifié par
    réutilisation de `GET .../answers/history` (aucune nouvelle route),
    positionne désormais l'historique exactement sur cette ligne avec un
    badge dédié et distingue explicitement une réponse encore active d'une
    réponse depuis remplacée. Voir `API_CONTRACT.md` et `RULES_ENGINE.md`.
  - **Cohérence multi-domaines** (GATE §3) : ajout d'un état global agrégé
    (`global_state`) calculé sur les seuls domaines REQUIS par le type de
    session (jamais `common`, toujours facultatif) et d'une « synthèse
    active » (`synthesis`) qui exclut du décompte principal tout domaine
    devenu obsolète — évite qu'un domaine non réanalysé gonfle
    silencieusement les compteurs affichés au conseiller. Voir
    `RULES_ENGINE.md` §3quater.
  - **Orchestration partielle** (GATE §4) : comportement déjà correct
    (chaque domaine indépendant, aucune atomicité globale), complété par
    deux tests dédiés manquants (échec sur le second domaine après succès
    du premier ; une réexécution en échec ne supersède jamais l'exécution
    complétée antérieure de ce domaine).
  - **Fenêtre de course dans la garde anti-double-clic** (GATE §7,
    `client/src/pages/SessionFindings.jsx`) — détectée par un test
    Playwright de double-clic réel : la garde reposait uniquement sur un
    état React, insuffisant contre deux clics quasi simultanés survenant
    avant le premier re-rendu. Corrigée par une garde synchrone (`useRef`)
    sur `launchAnalysis` et `DismissModal.submit`. Le même motif, non
    corrigé (hors périmètre de ce GATE), subsiste à trois endroits du Lot
    3B (`SessionWorkspace.jsx` — transition de session, finalisation,
    amendement).
  - **Tests** : 833 après ce GATE (813 + 20 nouveaux — projection `answer_id`/
    `is_current_answer`, état global agrégé et synthèse active, orchestration,
    sécurité des routes, audits). `npm run lint`/`npm test`/`npm run build`
    exécutés avec succès après chaque correctif. Détail complet dans
    `LOT4B_MANUAL_UI_CHECKLIST.md` (13 scénarios navigateur réel
    supplémentaires, tous réussis après le correctif de double-clic).
- **MICRO-GATE final (avant tout commit, deux corrections apportées au GATE
  ciblé ci-dessus)** :
  - **Cas `answer_id` invalides insuffisamment testés séparément** (§2) —
    le rapport du GATE précédent affirmait quatre cas « indiscernables par
    construction » sans les avoir vérifiés individuellement. Corrigé par
    cinq tests backend/API distincts (inexistant ; autre session du même
    foyer ; autre foyer ; question incohérente ; membre incohérent), chacun
    vérifiant l'absence de la ligne concernée, l'absence de fuite dans
    l'audit, et un contrat HTTP strictement identique quel que soit le cas.
    Message frontend aligné sur le texte neutre exact demandé. Voir
    `API_CONTRACT.md` et `LOT4B_MANUAL_UI_CHECKLIST.md`.
  - **Sémantique de `common` dans l'état global incomplète** (§3) — la
    facultativité de `common` (son absence n'empêche jamais `up_to_date`)
    avait été implémentée en excluant `common` du calcul de `global_state`
    dans TOUS les cas, y compris quand un ensemble de règles lui avait bien
    été publié — masquant à tort un `common` en échec, obsolète, ou jamais
    exécuté. Corrigé : `common` entre désormais dans le calcul dès qu'un
    ensemble lui a été publié, exactement comme un domaine requis. Neuf
    tests dédiés ajoutés. Occasion d'affiner aussi la distinction
    `partial`/`stale` pour tout mélange de domaines à jour/obsolètes
    (`partial` si mélange, `stale` seulement si AUCUN domaine applicable
    n'est à jour) — comportement légèrement plus précis que la première
    version du GATE ciblé, sans régression sur les cas déjà couverts (suite
    complète toujours verte). Voir `RULES_ENGINE.md` §3quater.
  - **Revues ciblées finales** (`advisory-architect`,
    `compliance-privacy-reviewer`) — verdicts « prêt pour commit » et « prêt
    avec réserves mineures ». Aucun défaut de sécurité/confidentialité
    trouvé ; un défaut de QUALITÉ DE TEST confirmé (le test annonçant une
    « réponse structurellement identique » pour les cinq cas invalides
    n'exerçait en réalité qu'un seul appel légitime avec une assertion
    trivialement vraie) — corrigé en le remplaçant par une comparaison
    réelle de forme, et en étendant la preuve HTTP explicite (jusque-là
    limitée à un seul des cinq cas) aux trois cas restants (autre foyer,
    question incohérente, membre incohérent). Corrigé au passage un
    off-by-one mineur dans la fenêtre de lecture d'audit d'un test (aucune
    conséquence sur le résultat, imprécision de nommage seulement) et une
    fragilité de test (comparaison par sous-chaîne sur du JSON sérialisé,
    remplacée par une comparaison d'identifiant précise par ligne).
  - **Applicabilité de `common` fondée sur le statut historique plutôt
    qu'actuel** (correction humaine finale, après les revues ci-dessus) —
    la correction précédente (`common` applicable dès qu'un ensemble lui
    « a été publié ») utilisait en réalité une condition dérivée de l'ÉTAT
    D'EXÉCUTION (`state !== 'no_rule_set_available'`), qui reste
    `up_to_date`/`stale` même après ARCHIVAGE du rule_set utilisé
    (reproductibilité : une exécution déjà pinnée reste valide après
    archivage de son rule_set) — un `common` publié puis archivé restait
    donc à tort « applicable ». Corrigé en dérivant l'applicabilité d'un
    nouveau champ dédié, `has_published_rule_set` (`resolveDomainAnalysisState`),
    qui reflète EXCLUSIVEMENT le statut de publication ACTUEL (`status =
    'published'`, requête évaluée à la lecture) — jamais l'historique
    d'exécution. Trois tests dédiés ajoutés (health seul avec common
    archivé ; ancien common archivé puis nouvelle version publiée ; session
    mixte avec common archivé). Voir `RULES_ENGINE.md` §3quater et
    `API_CONTRACT.md` §7.
  - **Tests — comptage exact et vérifié** (baseline LOT 4A au commit
    `44121310a48a824cd634516dc142cc2db155ac4b` : **788**, revérifiée via
    `git worktree` + `npm test` sur ce commit précis, jamais une valeur
    narrative) :
    - Total actuel (Lot 4B complet, GATE ciblé + micro-GATE + ce
      correctif) : **855**.
    - Tests nets Lot 4B (855 − 788) : **67**, répartis sur exactement trois
      fichiers de test (vérifié par comparaison ligne à ligne avec le
      commit LOT 4A, aucun autre fichier de test n'a été modifié) :
      `test/advisory-rule-executions.test.js` +49 (48→97),
      `test/advisory-rule-executions-api.test.js` +14 (13→27),
      `test/advisory-sessions-api.test.js` +4 (23→27).
    - Baseline avant le micro-GATE (fin du GATE ciblé §1-10, valeur
      directement observée via `npm test` à ce moment, avant toute
      correction de ce document) : **833**.
    - Tests nets micro-GATE + correctif final (855 − 833) : **22**, tous
      dans deux fichiers : `test/advisory-rule-executions.test.js` +18 (9
      pour la sémantique `common` v1, 6 pour les cas `answer_id` invalides,
      un test remplacé par un autre de qualité équivalente lors de la revue
      — solde net nul sur ce remplacement précis —, puis +3 pour la
      précision finale sur le statut de publication actuel) ;
      `test/advisory-sessions-api.test.js` +4 (1 initial, +3 lors du
      renforcement demandé par la revue compliance). Aucun test n'a été
      supprimé sans remplacement ; un seul a été remplacé (« réponse
      structurellement identique » → « liste de même forme », voir
      `LOT4B_MANUAL_UI_CHECKLIST.md`).
    `npm run lint`/`npm test`/`npm run build` exécutés avec succès après
    chaque correctif de cette section.
- **Risques** : aucun nouveau risque de sécurité/confidentialité identifié
  au-delà de ceux déjà couverts par le Lot 4A (voir `SECURITY_PRIVACY.md`
  §6 Lot 4B) — ce lot ne fait que LIRE et présenter des données déjà
  produites, la seule écriture nouvelle (écartement) réutilise le service
  déjà existant et déjà audité du Lot 4A.
- **Critères d'acceptation (vérifiés)** : jamais de recommandation
  automatique, de produit, d'assureur, d'IA ou de MCP introduits par ce
  lot ; jamais de score commercial/médical (uniquement des compteurs
  déterministes) ; aucune donnée réelle utilisée, y compris pendant la QA
  formelle (bases de démonstration entièrement fictives, supprimées après
  vérification).
- **Actions interdites (respectées)** : pas de nouvelle table, pas de
  nouvelle migration, pas d'éditeur de règles complet côté React, pas de
  démarrage du Lot 5.
- **Dépendances** : Lot 4A.
- **Retour arrière** : suppression des deux routes et de la page React —
  aucune donnée nouvelle en base (aucune nouvelle table), rien à migrer en
  arrière.

## Lot 5 — Parcours Assurance Maladie

> **Statut (phase 1)** : contenu brouillon provisionné, **non publié**, voir
> `HEALTH_LOT5_CONTENT.md` — questionnaire de 9 questions et 5 règles
> déterministes (coordination accident, franchise/capacité, modèle de
> soins, continuité LCA). Scindé en phase 1 (ce contenu, sans arithmétique
> de date) et phase 2 (règles à délais légaux — non conçue, non
> implémentée). Publication réelle conditionnée à une validation juridique
> et métier séparée, non faite par ce lot.

- **Objectif** : contenu réel du questionnaire maladie (`HEALTH_
  DIAGNOSTIC.md`) et premières règles réelles `valide` pour ce domaine,
  sourcées et validées humainement.
- **Tables** : aucune nouvelle — utilise les tables des Lots 3-4, remplies
  de contenu métier réel.
- **Routes** : aucune nouvelle.
- **Écrans** : questionnaire maladie opérationnel de bout en bout.
- **Tests** : chaque règle publiée testée individuellement (déclenchement,
  non-déclenchement, données manquantes) + cohérence globale du rule_set.
- **Risques** : validité et sourçage réel des seuils/franchises/montants —
  nécessite une revue métier humaine avant publication de toute règle
  (rôle de `health-insurance-domain` et `rules-engine-auditor`).
- **Critères d'acceptation** : un diagnostic maladie complet, de la création
  du foyer à la production de findings, fonctionne de bout en bout en test.
- **Actions interdites** : aucune règle liée à un assureur nommé ; aucune
  donnée médicale détaillée collectée.
- **Dépendances** : Lots 2-4.
- **Retour arrière** : dépublier le rule_set concerné (`status = archive`),
  aucune suppression de table nécessaire.

## Lot 6 — Parcours Vie et Prévoyance

- Symétrique au Lot 5 pour le domaine `life_pension`
  (`LIFE_PENSION_DIAGNOSTIC.md`).
- **Risques spécifiques** : formules de calcul (déficit incapacité, besoin
  de capital décès) doivent être clairement présentées comme des modèles
  configurables, jamais des vérités actuarielles/fiscales (cf. principe déjà
  posé dans `LIFE_PENSION_DIAGNOSTIC.md`).
- **Dépendances** : Lots 2-4.

## Lot 7 — Recommandations et validation humaine

> **Découpage acté (cadrage humain validé en 3 rapports successifs avant
> implémentation)** : ce lot est scindé en **Lot 7A** (backend générique,
> implémenté) et **Lot 7B** (interface conseiller, implémentée). Le
> découpage précède volontairement le contenu métier réel (Lots 5/6, non
> démarrés) — l'infrastructure de recommandation est indépendante du
> contenu métier et peut être conçue/testée avec les règles fictives déjà
> disponibles depuis le Lot 4A, exactement comme le Lot 4A/4B l'ont fait.
> La dépendance du Lot 7 vers les Lots 4-6 reste correcte pour une mise en
> production avec du contenu réel, pas pour son développement backend.

### Lot 7A — Backend générique (implémenté)

> **Statut : implémenté et testé.** Migration 12, `server/
> advisoryRecommendations.js`, `server/routes/advisoryRecommendations.js`,
> extension de `server/app.js`. Aucune interface conseiller (Lot 7B), aucun
> produit/assureur (Lot 11), aucune décision/présentation client ni rapport
> (Lot 9).

- **Objectif réellement livré** : modèle, service et API permettant à un
  conseiller humain de créer, modifier, valider, écarter, retirer et
  remplacer une recommandation générique fondée sur des findings
  déterministes. Le système ne produit, ne valide et ne remplit jamais
  automatiquement une recommandation — confirmé par construction (aucune
  fonction du moteur de règles n'écrit dans les nouvelles tables) et par
  test comportemental dédié.
- **Tables (3, conformes au cadrage)** : `advisory_recommendations`,
  `advisory_recommendation_findings`, `advisory_recommendation_members` —
  voir `docs/MIGRATIONS.md` version 12 et `DATA_MODEL.md` §5.5-§5.5ter.
- **Routes** : `API_CONTRACT.md` §7 — sous-ressources de session
  (liste/création/historique, `/api/advisory/sessions/:id/recommendations`)
  et adressage direct par id (`/api/advisory/recommendations/:id/...` pour
  le détail, la modification, les liens findings/membres, la validation,
  l'écartement, le retrait et le remplacement) — chemins légèrement adaptés
  par rapport à la proposition du cadrage, documenté dans `API_CONTRACT.md`.
- **Décisions d'architecture actées pendant le cadrage (4 revues préalables,
  3 rapports de correction avant tout code)** :
  - **Statuts en anglais**, cinq valeurs (`draft`/`validated`/`dismissed`/
    `superseded`/`withdrawn`) — `submitted`/`approved`/`rejected` explicitement
    exclus (absence de mécanisme humain de quatre yeux dans cette version
    mono-utilisateur).
  - **`category` délibérément absent** (ambiguïté avec
    `advisory_rules.result_payload.category_hint`) ; **`domain`/`scope`
    explicites**, `scope` jamais dérivé automatiquement des findings liés.
  - **Table de liaison N:M** vers les findings (pas un JSON) et vers les
    membres ciblés — cas réellement N:M, contrairement au 1:N finding/
    exécution du Lot 4A.
  - **Révision propre à la recommandation** (`revision`), grain de
    concurrence optimiste NOUVEAU dans ce dépôt, distinct de
    `advisory_sessions.revision` — la validation exige les deux
    simultanément (`expected_recommendation_revision` +
    `expected_session_revision`).
  - **Remplacement atomique** (`supersedes_recommendation_id`, porté par la
    nouvelle recommandation) garanti par un index UNIQUE PARTIEL SQLite
    (au plus un successeur ACTIF par recommandation validée — un
    successeur `dismissed` libère un nouvel essai), vérifié par une
    matrice de tests SQL bruts et deux vraies connexions `better-sqlite3`
    concurrentes.
  - **Session `completed` exigée dès la création** (pas seulement à la
    validation) — recommandation forte de la revue préalable
    `advisory-architect` : une session non finalisée peut encore être
    annulée, ce qui laisserait une recommandation orpheline.
  - **Trois booléens de déclaration explicite** (`no_alternatives_identified`/
    `no_additional_risks_identified`/`no_missing_information_known`)
    distinguant « non renseigné » de « examiné, rien identifié » — jamais
    renseignés automatiquement, mutuellement exclusifs avec leur champ
    texte associé.
  - **`potentially_stale`** : état d'obsolescence entièrement dérivé à la
    lecture (jamais stocké), jamais une bascule automatique de statut.
- **Tests — 113 nouveaux, répartis sur trois fichiers** (baseline au commit
  `7ba63545633518971acb211320746ac8e55fbe8c` : **855**, vérifiée par
  `npm test` avant toute modification ; total actuel : **968** — écart
  vérifié par comparaison directe des `test(` par fichier, jamais une
  addition narrative) :
  - `test/advisory-recommendations.test.js` (nouveau fichier) : **75** —
    création, portée/membres (transitions atomiques), findings (cohérence
    domaine et cohérence membre/finding pour `scope = member`, y compris
    le cas explicitement interdit « recommandation pour Alice citant un
    finding sur Bob »), révisions, validation (checklist complète),
    écartement, retrait, remplacement (concurrence à deux connexions
    réelles, brouillon abandonné puis nouvel essai autorisé, ROLLBACK
    FORCÉ par déclencheur SQL entre les deux `UPDATE` de la transaction
    atomique — ajouté lors des revues finales, le premier test ne
    couvrait qu'un échec de PRÉ-CONDITION, pas un échec réellement
    intra-transactionnel), déclarations explicites, obsolescence dérivée,
    audit (les 13 actions toutes réellement exercées avec marqueur
    distinctif et vérifiées présentes, pas seulement 8 sur 13 comme dans
    une première version).
  - `test/advisory-recommendations-api.test.js` (nouveau fichier) : **23**
    — auth/CSRF (étendu aux 7 routes d'écriture, pas seulement 2), cache
    (les 3 routes de lecture, dont l'historique), cycle de vie complet par
    HTTP, IDOR (id inexistant + recommandation existante absente d'une
    autre session), 404 neutre (6 routes), 409 concurrence, validation 400
    (3 cas), minimisation des réponses d'erreur, absence de fuite SQL sur
    un conflit de remplacement concurrent, audit.
  - `test/migrations.test.js` (fichier préexistant, 55 → 70, **+15**) :
    trois tables, colonnes (dont l'absence explicite de `category`/
    `presented_to_client`/`client_decision`), index unique partiel
    (présence/unicité/caractère partiel/SQL exact du WHERE/matrice
    complète des statuts croisant EXPLICITEMENT les deux dimensions du
    `WHERE`/migration réelle depuis v11/redémarrages répétés/deux
    connexions réelles). Six tests v11 préexistants rescopés (jamais
    supprimés) pour refléter que la base dépasse désormais v11 — même
    précédent que le rescopage v10 lors de l'ajout de la migration 11.
- **Revues** : 4 revues préalables (avant tout code) et 4 revues finales
  (après implémentation) — `advisory-architect`, `compliance-privacy-reviewer`,
  `rules-engine-auditor`, `backend-test-auditor` (rôle assuré par un agent
  general-purpose spécialisé, aucun agent dédié de ce nom n'existant dans ce
  dépôt). **Défauts réels trouvés par les revues finales, tous corrigés
  avant le rapport final** : comptage documentaire erroné (« douze » vs
  treize actions d'audit réelles, `SECURITY_PRIVACY.md`) ; test de
  « rollback forcé » ne couvrant en réalité qu'un échec de pré-condition,
  jamais un échec intra-transactionnel réel (corrigé par un déclencheur
  SQL temporaire, même technique que le Lot 4A) ; test de non-fuite d'audit
  n'exerçant réellement que 8 des 13 actions avec le marqueur (corrigé,
  les 13 sont désormais exercées et leur présence vérifiée explicitement) ;
  couverture API insuffisante sur CSRF/IDOR/404/cache/validation (étendue).
  Voir le rapport final du GATE Lot 7A pour le détail complet.
- **Critères d'acceptation** : aucune route ne permet à un appel automatisé
  (test compris) d'atteindre `status = validated` sans passer par l'action
  de validation explicite authentifiée ; aucun produit, assureur, décision
  client ou présentation client dans le schéma ou l'API de ce lot.
- **Actions interdites (respectées)** : aucune interface conseiller (Lot
  7B), aucune automatisation de la validation même partielle, aucun
  catalogue produit, aucun appel IA/MCP.
- **Dépendances** : Lot 4A (findings), Lot 3A (sessions/membres) —
  explicitement PAS les Lots 5/6 (contenu métier réel), voir note de
  découpage ci-dessus.
- **Retour arrière** : `DROP TABLE` des 3 tables dans l'ordre inverse de
  création (`advisory_recommendation_members` → `advisory_recommendation_findings`
  → `advisory_recommendations`) — findings/exécutions/règles restent
  intacts (tables indépendantes, jamais modifiées par ce lot).

### Lot 7B — Interface conseiller des recommandations (implémentée)

> **Statut : implémenté.** Nouvelle page `client/src/pages/
> SessionRecommendations.jsx`, route `/diagnostic-360/sessions/:id/
> recommendations`. Extension de `SessionFindings.jsx` (création
> contextualisée) et `SessionDetail.jsx` (point d'entrée). Cinq ajouts
> additifs backend en lecture seule (validés par `advisory-architect`
> avant implémentation ou tranchés lors d'un GATE ciblé ultérieur, aucune
> règle métier modifiée, aucune migration). Aucun produit/assureur/décision
> client/rapport/IA/MCP.

- **Objectif réellement livré** : consultation, création (contextualisée
  depuis un ou plusieurs constats, ou vierge), édition de brouillon,
  validation, écartement, retrait, remplacement et historique complet
  d'une recommandation, entièrement fondés sur les 13 routes du Lot 7A —
  aucune règle métier réimplémentée côté client (transitions, validité de
  portée/membres, cohérence finding/membre, obsolescence : toujours des
  réponses serveur affichées telles quelles).
- **Pages** : `SessionRecommendations.jsx` (nouvelle, liste/création/détail/
  historique en un seul composant à états, sur le modèle de
  `SessionFindings.jsx`) ; `SessionFindings.jsx` étendue (bouton par
  constat « Créer une recommandation à partir de ce constat », mode
  « Sélection multiple » borné à un seul domaine — changement d'onglet
  refusé tant qu'une sélection existe, jamais un mélange silencieux) ;
  `SessionDetail.jsx` étendue (bouton « Ouvrir les recommandations »).
- **Cinq ajouts additifs backend, en lecture seule** (aucune migration,
  aucune règle métier modifiée) :
  - `members` sur `GET /api/advisory/sessions/:id` (`getSessionDetail`,
    réutilise `sessionMembersFor` déjà existante) — périmètre figé pour le
    sélecteur de membres, surface minimale. Validé par `advisory-architect`
    pendant la revue préalable.
  - `hydrateRecommendationNames` (`server/advisoryRecommendations.js`) —
    résolution du nom d'auteur sur les 13 fonctions de lecture/écriture,
    même pattern que `hydrateFindingRows` (Lot 4A). Validé par
    `advisory-architect` pendant la revue préalable.
  - `allowed_actions` (`server/advisoryRecommendations.js`,
    `computeAllowedActions`) — ajouté lors d'un **GATE ciblé postérieur à
    l'implémentation initiale** (`section 2` de ce GATE) : le frontend
    recalculait les transitions autorisées (modifier/valider/écarter/
    retirer/remplacer/lier-délier un finding ou un membre) à partir de
    `rec.status`/`household.status`/`session.status`, une duplication de
    logique métier déjà entièrement encodée côté serveur
    (`assertSessionWritable`, `assertDraftMutable`, `assertAction` via
    `TRANSITIONS`). `allowed_actions` reflète très exactement ces mêmes
    gardes — booléen par action (`edit`, `validate`, `dismiss`, `withdraw`,
    `replace`, `link_finding`, `unlink_finding`, `link_member`,
    `unlink_member`) — et `SessionRecommendations.jsx` a été entièrement
    reconfiguré pour le consommer : `RecommendationDetail` n'accepte plus
    de prop `readOnly` calculée par le parent, chaque bouton d'action lit
    directement `rec.allowed_actions.<action>`.
  - `recommendation_capabilities.create` sur `GET
    /api/advisory/sessions/:id` (`getSessionDetail`) et
    `actions.can_create_recommendation` sur `GET .../findings-workspace`
    (`getSessionFindingsWorkspace`, `server/advisoryRuleExecutions.js`) —
    ajoutés lors d'une **poursuite du même GATE ciblé (§2B)** : la
    disponibilité de la CRÉATION d'une nouvelle recommandation restait
    recalculée côté frontend dans deux endroits (`SessionRecommendations.
    jsx` pour le bouton « Nouvelle recommandation » et la navigation
    entrante depuis les constats ; `SessionFindings.jsx` pour ses deux
    points d'entrée) à partir de `household.status`/`session.status` — la
    même classe de duplication que celle déjà corrigée pour
    `allowed_actions`, simplement au niveau de la SESSION plutôt que de la
    recommandation (aucune ligne recommandation n'existe encore avant sa
    création). Corrigé par un prédicat UNIQUE et PARTAGÉ,
    `isSessionWritable(session, household)`, exporté depuis
    `server/advisorySessions.js` et réutilisé tel quel par
    `server/advisoryRecommendations.js` (`assertSessionWritable`,
    `computeAllowedActions`) ET `server/advisoryRuleExecutions.js`
    (`getSessionFindingsWorkspace`) — trois modules, une seule définition
    de la règle, jamais une redéfinition divergente. Les deux pages
    frontend ont été reconfigurées pour consommer ces champs ; le
    `household.status`/`session.status` brut restant dans le code (bandeaux
    d'information distinguant « foyer archivé » de « session non
    finalisée ») ne sert plus qu'à choisir un TEXTE d'aide, jamais à
    activer/désactiver un contrôle.
- **Codes d'erreur machine** (`server/advisoryRecommendations.js`,
  `ERROR_CODES` ; `AdvisoryError` étendue d'un troisième paramètre `code`
  optionnel, `server/advisoryHouseholds.js`) — ajoutés lors d'une
  **troisième poursuite du même GATE ciblé (§3)** : la distinction entre
  les deux causes de conflit 409 (`ValidateModal`) reposait sur une
  correspondance d'expression régulière contre le texte français de
  `error`, fragile à toute reformulation future du message serveur.
  Corrigé par cinq codes stables (`RECOMMENDATION_REVISION_CONFLICT`,
  `SESSION_REVISION_CONFLICT`, `RECOMMENDATION_STATE_CONFLICT`,
  `SESSION_NOT_WRITABLE`, `HOUSEHOLD_ARCHIVED`), un par situation
  distincte, ajoutés uniquement là où chacune est réellement détectée. Le
  middleware de sérialisation des routes (`handle()`,
  `server/routes/advisoryRecommendations.js`) inclut désormais `code` dans
  le corps JSON quand il est présent. `SessionRecommendations.jsx`
  (`ValidateModal`, `save()`, `unlinkFinding()`) distingue désormais ces
  conflits sur `err.data.code` — en creusant, `save()`/`unlinkFinding()`
  supposaient à tort que TOUT 409 sur leur route était un conflit de
  révision (imprécision corrigée par la même occasion, ce n'était pas
  toujours le cas : un 409 peut aussi venir d'un changement de statut ou
  d'un foyer archivé entre-temps). Aucun code inventé pour les situations
  hors de ce périmètre (finding non actif, domaine incohérent,
  remplacement déjà en cours) — restent distinguées par `error` seul, comme
  avant. Voir `API_CONTRACT.md` pour le tableau complet.
- **Décision d'architecture confirmée pendant le cadrage du Lot 7B** : un
  ancien membre du périmètre figé (retiré du foyer depuis le démarrage de
  la session) reste ciblable pour une NOUVELLE liaison — comportement
  serveur intentionnel (`DATA_MODEL.md` §5.5ter), l'interface ne doit
  jamais le bloquer côté client.
- **Tests — 25 nouveaux à ce stade du GATE ciblé** (baseline au commit du
  Lot 7A : **1030** ; total à l'issue des §2B/§3 : **1055** ; total après le
  volet §4-§9 du même GATE ciblé, détaillé plus bas : **1089**) : 2 dans
  `test/advisory-sessions.test.js` (champ
  `members`, y compris un membre historisé) ; 4 dans `test/
  advisory-recommendations.test.js` (`hydrateRecommendationNames` : à la
  création, sur un écartement par un second utilisateur distinct du
  créateur, sur la validation, sur la liste et l'historique) ; 8 dans
  `test/advisory-recommendations.test.js` (`allowed_actions`, ajoutées
  pendant le GATE ciblé : brouillon, validée, écartée, retirée, remplacée/
  superseded, foyer archivé, session non complétée — état forcé en base
  pour vérifier la propriété défensive de la fonction indépendamment de
  l'atteignabilité par l'API publique, session `completed` étant un état
  terminal —, et exposition sur liste ET historique) ; 3 dans `test/
  advisory-sessions.test.js` (`recommendation_capabilities.create` :
  session complétée/foyer actif, session non complétée, foyer archivé) ;
  1 nouveau + 1 assertion ajoutée à un test existant dans `test/
  advisory-rule-executions.test.js` (`actions.can_create_recommendation` :
  vrai en session mixte complétée, faux sur foyer archivé — foyer dédié
  isolé pour ne pas affecter les autres tests du fichier) ; 7 dans `test/
  advisory-recommendations.test.js` (codes d'erreur machine, un test par
  code — `RECOMMENDATION_REVISION_CONFLICT`, `SESSION_REVISION_CONFLICT`,
  `RECOMMENDATION_STATE_CONFLICT` ×2 — transition impossible et
  `assertDraftMutable` —, `SESSION_NOT_WRITABLE`, `HOUSEHOLD_ARCHIVED`,
  plus un test dédié répliquant exactement la construction du corps JSON
  de `handle()` pour vérifier que `code` atteint bien la réponse HTTP, pas
  seulement l'objet d'erreur interne — revérifié en direct via `curl` sur
  un serveur réel pour deux codes, réponses JSON exactes citées dans le
  rapport final). Aucun framework de test frontend ajouté (confirmé absent
  depuis les Lots 0/2/3A/3B/4B) — couverture d'interface assurée par une
  checklist manuelle exécutée en
  direct via Playwright, voir `LOT7B_MANUAL_UI_CHECKLIST.md` (26 scénarios
  sur 42 rejoués en direct avec assertions réelles, le reste couvert par
  une combinaison de garanties structurelles, de couverture serveur déjà
  exhaustive et de revue de code, chacun justifié individuellement) ; les
  trois volets du GATE ciblé (`allowed_actions`, `recommendation_
  capabilities`/`can_create_recommendation`, codes d'erreur machine) ont
  chacun été revérifiés en direct séparément (15 puis 6 vérifications
  Playwright pour les deux premiers, aucune erreur console dans les deux
  cas ; deux appels `curl` réels contre un serveur démarré pour le
  troisième, confirmant `code` dans le corps JSON HTTP effectif — pas
  seulement dans l'objet d'erreur interne testé unitairement).
- **Défaut réel détecté et corrigé pendant la QA** : le composant de
  déclaration à trois états (`DeclarationField`) dérivait son état affiché
  du contenu du texte plutôt que d'un champ explicite — sélectionner
  « Décrit ci-dessous » sans avoir encore tapé de texte retombait
  silencieusement sur « Non renseigné ». Corrigé par un champ `mode`
  explicite. Détail complet : `LOT7B_MANUAL_UI_CHECKLIST.md`.
- **Poursuite du GATE ciblé (§4-§9) — accessibilité, garde de perte de
  saisie, minimisation, tests** :
  - **§4 — Accessibilité des modales** (`ui.jsx`, composant partagé, voir
    `UX_AND_CLIENT_MODE.md` §6.1) : `role="dialog"`/`aria-modal`/
    `aria-labelledby`/`aria-describedby`, focus initial, piège de focus
    Tab/Shift+Tab confiné aux bornes, retour du focus au déclencheur,
    `closeDisabled` pendant une mutation en cours. Nouveau composant
    `ConfirmModal` remplaçant tous les `window.confirm()` de ce lot.
    Vérifié en direct (Playwright) : focus initial, boucle Tab/Shift+Tab,
    Échap, fond inatteignable — y compris un parcours clavier complet de 8
    tabulations sur la modale de validation.
  - **§5 — Garde de perte de saisie complète** : `formIsDirty`
    (`sessionRecommendationsPure.js`) couvre désormais domaine/portée/
    membres en plus des champs narratifs et des trois déclarations —
    absent de toute comparaison jusqu'ici. Écouteur `beforeunload` ajouté
    uniquement si le formulaire est sale, retiré après succès/abandon/
    retour à l'état initial/démontage — vérifié en direct dans les quatre
    cas. **Défaut réel détecté et corrigé** : `location.state.findingIds`
    (navigation entrante contextualisée) survit à un rechargement complet
    de page alors que le garde de consommation en mémoire n'y survit pas —
    un conseiller ayant annulé une création contextualisée pouvait se
    retrouver réexposé au même écran après un simple F5. Corrigé
    (`navigate(path, {replace: true})` dès consommation). Détail complet :
    `UX_AND_CLIENT_MODE.md` §6.1, `SECURITY_PRIVACY.md` §6.
  - **§6 — Minimisation des projections backend** : audit explicite (clés
    présentes ET absentes, pas seulement présence) de `session.members`,
    des noms d'auteur, et de `findings[].member`. **Défaut réel détecté et
    corrigé** : `findings[].member` (`getSessionFindingsWorkspace`)
    transmettait `client_id`/`current_status`/`no_longer_active`/
    `can_answer`, aucun consommé par `SessionFindings.jsx` — réduit à
    `{id, display_name, member_role, historical}`. Détail :
    `API_CONTRACT.md`, `SECURITY_PRIVACY.md` §6.
  - **§7 — Séparation findings/recommandations** : audit ciblé (recherche +
    lecture de code sur `SessionRecommendations.jsx`/`SessionFindings.jsx`/
    `server/advisoryRecommendations.js`/`server/advisoryRuleExecutions.js`)
    confirmant qu'aucun champ narratif d'un finding n'est jamais copié dans
    une recommandation, qu'aucune sélection/création n'est automatique,
    qu'aucune route ne modifie `advisory_findings`, et que les libellés
    restent lexicalement distincts — aucune violation trouvée.
  - **§8 — QA Playwright complémentaire (34 vérifications en direct,
    nouvelle session)** : couvre intégralement les ajouts §4/§5/§3 (modales,
    dirty guard, `beforeunload`, codes d'erreur) plus une repasse en direct
    de la création/des trois portées/des déclarations/de la validation/de
    l'écartement/du retrait/du remplacement/de l'historique/du foyer
    archivé/du responsive tablette/du clavier complet/du stockage
    navigateur/de l'absence d'erreur console/de l'erreur réseau — voir
    `LOT7B_MANUAL_UI_CHECKLIST.md` pour le détail scénario par scénario.
  - **§9 — Tests automatisés supplémentaires (34 nouveaux : 2 de
    minimisation + 32 de fonctions pures)** : `findings[].member` (clés
    exactes) et `hydrateRecommendationNames` (aucune clé sensible,
    `*_name` toujours une chaîne simple) ; extraction de
    `client/src/pages/sessionRecommendationsPure.js` (`emptyDeclaration`,
    `emptyFields`, `fieldsAreDirty`, `memberIdsEqual`, `formIsDirty`,
    `declarationFromRecommendation`, `fieldsFromRecommendation`,
    `fieldsToBody`, `interpretRecommendationError`) — fonctions pures sans
    dépendance React/DOM, réutilisées telles quelles par
    `SessionRecommendations.jsx` (jamais une seconde implémentation),
    testées directement via `node --test`
    (`test/session-recommendations-pure.test.js`, 32 tests) sans ajout de
    framework de test frontend. Les tests de matrice `allowed_actions`
    (§2, 8 tests) et de remplacement (`createReplacement`, Lot 7A —
    successeur non-dismissed refusé, remplacement écarté puis nouveau
    remplacement autorisé) couvraient déjà les scénarios de recalcul de
    capacité/succession demandés par ce GATE ; aucune régression Lot 7A/
    Lot 4B : les 1030 tests historiques et les tests ajoutés en §2B/§3
    passent tous, inchangés.
- **§11 — Revues finales ciblées (3 rôles) et corrections (2 nouveaux
  tests, total après §11 : 1091)** : `advisory-architect`,
  `compliance-privacy-reviewer`, `client-meeting-ux` relancés sur l'état
  post-§4-§9. Chaque défaut certain identifié a été corrigé (aucun défaut
  laissé en l'état sans justification explicite) :
  - **`getExecutionDetail` non minimisé** (compliance-privacy-reviewer) :
    même défaut que celui déjà corrigé sur `getSessionFindingsWorkspace`
    au §6, reproduit séparément sur cette route distincte (source de
    données de `HistoryModal`) — corrigé avec la même projection minimale,
    verrouillée par un nouveau test à clés exactes. Détail :
    `API_CONTRACT.md`, `SECURITY_PRIVACY.md` §6.
  - **Purge de `history.state` gatée sur `data`** (compliance-privacy-
    reviewer) : cas résiduel du défaut déjà corrigé au §5 — un échec du
    premier chargement empêchait la purge de s'exécuter. Corrigé en
    séparant purge et ouverture d'écran en deux effets indépendants.
    Détail : `SECURITY_PRIVACY.md` §6.
  - **`can_answer` inutilisé dans `session.members`** (compliance-privacy-
    reviewer, signalé non bloquant) : retiré par cohérence avec la
    minimisation déjà appliquée ; test existant mis à jour en conséquence.
  - **Timing de capture du déclencheur de focus** (`ui.jsx`,
    client-meeting-ux) : `triggerRef` lu dans un `useEffect` s'exécutant
    après un `autoFocus` natif d'enfant sur 4 modales existantes, cassant
    silencieusement le retour de focus sur ces 4 cas. Corrigé via un
    initialiseur paresseux de `useState`, exécuté pendant le rendu (donc
    garanti avant tout `autoFocus` de montage). Détail :
    `UX_AND_CLIENT_MODE.md` §6.2 — non revérifié en direct dans cette
    passe (voir cette section pour la raison).
  - **`link_member`/`unlink_member` sans condition de portée**
    (advisory-architect) : `allowed_actions` les affichait disponibles
    même sur un brouillon `scope = household`/`session`, que
    `linkMember`/`unlinkMember` auraient pourtant rejetés. Corrigé en
    ajoutant `rec.scope === 'member'` ; 3 tests `allowed_actions`
    existants mis à jour (2 modifiés, 1 nouveau dédié au cas
    `scope = member`). Détail : `API_CONTRACT.md`.
  - **Gestion d'erreur non alignée sur `DismissRecommendationModal`/
    `WithdrawModal`** (advisory-architect) : ces deux modales gardaient
    `err.message` brut sans rechargement sur `409`, contrairement à
    `save()`/`unlinkFinding()`. Alignées sur
    `interpretRecommendationError` + rechargement (`onReload`) sur `409`.
  - **Texte de conflit de révision jargon-y** (`ValidateModal`,
    client-meeting-ux) : reformulé en langage clair avec scénario concret
    et action de récupération. Détail : `UX_AND_CLIENT_MODE.md` §6.2.
  - **Limites signalées et sciemment NON corrigées dans ce GATE** (hors
    périmètre, documentées comme limites connues plutôt que corrigées en
    silence) : la barre latérale persistante et le bouton de déconnexion
    (`App.jsx`) ne sont couverts par aucune garde de perte de saisie —
    limite préexistante partagée à l'identique par `SessionWorkspace.jsx`
    depuis le Lot 4B, pas une régression propre à ce lot, nécessitant une
    décision architecturale humaine (migration vers un routeur à données
    ou un registre de saisie sale transverse) hors du périmètre de ce
    GATE ; la navigation navigateur précédent/suivant (`popstate`) partage
    la même cause racine ; l'absence de `aria-hidden`/`inert` sur le
    contenu en arrière-plan pendant qu'une modale est ouverte, un défaut
    plus large du motif ARIA Dialog non introduit par ce GATE ; le
    contraste de la classe CSS `.muted` (~3.5:1 en thème clair, sous le
    seuil AA), une variable CSS globale préexistante affectant toute
    l'application ; l'absence de verrouillage du défilement derrière une
    modale ouverte, mineur.
  **Ces cinq limites ont depuis été corrigées par le correction round
  ci-dessous (§12) — plus jamais des limites acceptées à ce jour,** la
  liste ci-dessus est conservée telle quelle pour la trace historique de
  l'état à ce round précis.
- **§12 — Correction round (rapport « prêt avec réserve » explicitement
  rejeté, garde de navigation réellement complète, total après §12 :
  1103)** : le rapport du §11 ci-dessus annonçait 34 scénarios rejoués sur
  42 et laissait sciemment non corrigées les cinq limites listées
  ci-dessus (garde sidebar/déconnexion, `popstate`, `inert`/`aria-hidden`,
  contraste `.muted`, verrouillage du défilement). Toutes corrigées dans ce
  round :
  - Garde de navigation partagée unique (`client/src/navigationGuard.jsx`,
    `NavigationGuardProvider`/`useNavigationGuard`) protégeant désormais
    aussi la barre latérale et la déconnexion (`App.jsx`,
    `AuthenticatedShell`) et le bouton Précédent/Suivant du navigateur
    (technique de sentinelle d'historique, `history.pushState` + écouteur
    `popstate` — limite connue et documentée dans le code : le tout
    premier appui Précédent d'un épisode sale peut être silencieusement
    absorbé une fois ; limite distincte reproduite en direct : `pushState`
    détruit une entrée « Suivant » préexistante au moment de l'armement de
    la sentinelle, rendant le bouton Suivant sans effet plutôt que
    contourné, jamais une perte de données silencieuse).
  - `Modal` (`ui.jsx`) rendue via portail dans `document.body` (fond
    `inert`/`aria-hidden` appliqué exclusivement à `#root`, jamais un
    ancêtre de la modale), verrouillage du défilement référence-compté,
    contraste `--muted`/`--critical` corrigé (clair et sombre) au niveau
    des variables CSS globales.
  - Deux défauts produit réels détectés par la QA en direct : `createReplacement`
    ignorait `finding_ids` (un remplacement ne pouvait jamais être validé) ;
    `allowed_actions.replace` ne vérifiait pas l'absence d'un remplacement
    déjà actif. Deux défauts certains supplémentaires détectés par les
    revues finales relancées : `onOpenOther` contournait le garde de
    navigation (perte de saisie silencieuse) ; Échap fermait deux modales
    empilées simultanément (perte de saisie sur un motif déjà tapé).
    Détail complet, matrice 42/42 et preuves : `LOT7B_MANUAL_UI_CHECKLIST.md`
    « Round 4 ».
  - **Revues** : 3 revues finales relancées après le rejeu complet
    (`advisory-architect`, `compliance-privacy-reviewer`,
    `client-meeting-ux`), chaque défaut certain corrigé.
  - **Vérification** : `npm run lint`, `npm test` (1103/1103, 12 nouveaux
    tests), `npm run build`, 42/42 scénarios du brief rejoués en direct
    (zéro FAIL, zéro BLOCKED) + 7 vérifications live dédiées à la garde de
    navigation sidebar/déconnexion/Précédent/Suivant/`beforeunload`
    (7/7 réussies, 1 limite connue documentée honnêtement).
- **Revues** : 4 revues préalables (avant tout code, dont une question
  ciblée complémentaire tranchée par `advisory-architect` sur la politique
  d'ancien membre), 4 revues finales post-implémentation du round initial,
  3 revues finales relancées au correction round (§12).
- **Dépendances** : Lot 7A.
- **Retour arrière** : suppression de la route et des fichiers frontend
  nouveaux ; les cinq ajouts backend additifs sont strictement des champs
  de lecture supplémentaires, retirables sans effet sur les données ni sur
  les autres lots.

## Lot 8 — Mode présentation client

- **Objectif** : écran 1.11, fonction de projection filtrée serveur.
- **Tables** : aucune nouvelle.
- **Routes** : `API_CONTRACT.md` §10.
- **Tests** : vérification exhaustive que la projection filtrée exclut bien
  `internal_notes`, `stable_key`, scores bruts, motifs internes, données
  d'autres dossiers (test de non-fuite, pas seulement de présence des
  champs attendus).
- **Risques** : toute nouvelle donnée interne ajoutée dans un lot futur doit
  être explicitement exclue de la projection — prévoir un test qui échoue
  par défaut sur tout champ non explicitement classé (liste blanche plutôt
  que liste noire, plus sûre).
- **Dépendances** : Lots 3-7.
- **Retour arrière** : suppression de la route, aucune donnée affectée.

## Lot 9 — Rapports

- **Objectif** : `advisory_reports`/`advisory_report_versions`, génération
  structurée, choix et intégration d'une bibliothèque PDF (proposition et
  validation séparées avant tout ajout de dépendance npm).
- **Tables** : les deux citées.
- **Routes** : `API_CONTRACT.md` §9.
- **Tests** : immuabilité des versions, `rapport_corrige` référence bien la
  version remplacée, conditions de génération respectées
  (`REPORT_SPECIFICATION.md` §3), séparation stricte des sous-sections
  Maladie/Vie et Prévoyance dans un rapport de session `domain = mixed`
  (aucune fusion des deux analyses), `rapport_corrige` générable après un
  amendement (`POST .../answers/amend`) qui change le résultat.
- **Risques** : premier lot introduisant potentiellement une dépendance npm
  — à isoler et justifier séparément, avec revue de licence/sécurité avant
  ajout (`npm audit`).
- **Dépendances** : Lots 3-8.
- **Retour arrière** : `DROP TABLE` des deux tables, retrait de la
  dépendance PDF si ajoutée et non conservée.

## Lot 10 — Sécurité renforcée et rétention

- **Objectif** : extension de l'anonymisation/export existants aux données
  `advisory_*` (`SECURITY_PRIVACY.md` §8, §10), politique de rétention
  effective (après validation juridique du §9 de `SECURITY_PRIVACY.md`).
- **Tables** : modifications d'usage, pas nécessairement de nouvelles
  tables.
- **Tests** : anonymisation d'un foyer entraîne bien l'effacement des
  données personnelles `advisory_*` correspondantes sans casser
  l'intégrité référentielle des sessions déjà terminées.
- **Dépendances** : validation juridique préalable obligatoire (ne pas
  démarrer sans elle).

## Lot 11 — Catalogue produits

- **Objectif** : introduire, pour la première fois, une notion de « produit
  potentiellement compatible » (étape 6 de `RULES_ENGINE.md` §3),
  alimentée par un catalogue interne validé — jamais par le moteur de
  règles lui-même.
- **Risques** : à ne démarrer qu'après consultation métier explicite sur le
  contenu du catalogue (quelles compagnies, quelles catégories) — hors
  périmètre technique de ce document.
- **Dépendances** : Lots 5-7.

## Lot 12 — MCP contrôlé

- **Objectif** : première activation réelle, limitée à un MCP documentaire
  en lecture seule (`MCP_STRATEGY.md`), avec liste blanche, journalisation,
  coupure d'urgence.
- **Actions interdites** : tout accès en écriture, toute activation par
  défaut, tout usage hors liste blanche.
- **Dépendances** : Lot 11, `SECURITY_PRIVACY.md` §14-16 opérationnels.

## Lot 13 — Portail client éventuel (conditionnel)

- **Objectif** : uniquement si décidé explicitement par vous après usage
  réel des lots précédents — introduction d'une authentification client
  distincte, et de la fonction de projection filtrée déjà existante
  (Lot 8) plutôt que d'en construire une seconde. **Point corrigé (Lot 3A,
  GATE)** : `advisory_answers` n'a pas de distinction `conseiller`/
  `client_direct` implémentée (seul `answered_by_user_id` existe,
  référençant toujours le conseiller) — ce lot devra donc concevoir
  explicitement comment distinguer une réponse saisie par le client,
  plutôt que de réutiliser une valeur qui n'existe pas.
- **Risques** : chantier d'authentification à part entière, hors du modèle
  mono-utilisateur actuel — nécessite une conception dédiée, pas une
  extension mineure.
- **Dépendances** : tous les lots précédents, et une décision humaine
  explicite de démarrage (ce lot n'est pas acquis par défaut).

## Rappel transversal

Chaque lot, au démarrage, revérifie : branche courante, `HEAD`, `git status
--short` vide, numéro de migration réellement disponible (`PRAGMA
user_version`), et l'absence de fusion entre-temps d'un autre travail sur le
dépôt — même discipline qu'au LOT 0.
