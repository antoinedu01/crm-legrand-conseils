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
> de test — un éventuel « Lot 4B » (éditeur de règles complet côté React,
> écran de findings à l'usage du conseiller) reste explicitement différé,
> non démarré, comme prévu dès la conception de ce lot. Migration 11,
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

## Lot 5 — Parcours Assurance Maladie

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

- **Objectif** : `advisory_recommendations`, écran de validation conseiller
  (`UX_AND_CLIENT_MODE.md` 1.8, 1.10).
- **Tables** : `advisory_recommendations`.
- **Routes** : `API_CONTRACT.md` §7 (recommandations).
- **Tests** : impossibilité de valider automatiquement une recommandation
  sans action humaine explicite ; `validated_by_user_id` toujours renseigné
  côté serveur ; écartement toujours motivé.
- **Critères d'acceptation** : aucune route ne permet à un appel automatisé
  (test compris) d'atteindre `status = validee_conseiller` sans passer par
  l'action de validation explicite authentifiée.
- **Actions interdites** : aucune automatisation de la validation, même
  partielle.
- **Dépendances** : Lots 4-6.
- **Retour arrière** : `DROP TABLE advisory_recommendations` — findings
  restent intacts (table indépendante).

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
