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

## Lot 4 — Moteur de règles

- **Objectif** : `advisory_rule_sets`/`advisory_rules`/
  `advisory_rule_executions`/`advisory_findings`, moteur d'exécution
  déterministe, sans contenu de règles métier réel (règles fictives de test
  pour valider le moteur, comme les fixtures de `test/migrations.test.js`).
- **Tables** : les quatre citées ci-dessus.
- **Routes** : `API_CONTRACT.md` §6-7 (findings uniquement, pas encore
  `advisory_recommendations`).
- **Tests** : conditions simples/combinées, `missing_data` correctement
  détecté, non-régression après rejet, absence de contradiction non
  détectée sur un jeu de règles de test, refus de publication d'une règle
  sans source.
- **Risques** : format des `conditions` à figer avant d'écrire des règles
  réelles (Lot 5/6 en dépendent directement) — tout changement de format
  après coup impliquerait de réévaluer les règles déjà écrites.
- **Critères d'acceptation** : le moteur ne produit jamais
  `advisory_recommendations` directement (cette table n'existe même pas
  encore à ce stade — elle arrive en Lot 7) ; chaque exécution est tracée et
  explicable.
- **Actions interdites** : aucun contenu de règle réel spécifique maladie ou
  vie dans ce lot — uniquement le moteur et des règles de démonstration
  fictives.
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
