# Moteur de règles — déterministe, versionné, explicable

> Proposition de conception (LOT 1). Tous les exemples de règles sont
> **fictifs et non contractuels** — aucune règle réelle d'assurance, aucun
> seuil réglementaire officiel n'est affirmé ici.

> **Statut d'implémentation (Lot 4A, GATE)** : le moteur est implémenté et
> testé (`server/advisoryRules.js`, `server/advisoryRuleConditions.js`,
> `server/advisoryRuleExecutions.js`, migration 11 — voir `DATA_MODEL.md`
> §5 pour le détail des divergences de schéma). Précisions propres à ce
> document :
> - **DSL de conditions — 16 opérateurs** : `equals`/`not_equals`/`in`/
>   `not_in`/`exists`/`not_exists`/`greater_than`/`greater_or_equal`/
>   `less_than`/`less_or_equal`/`contains`/`and`/`or`/`not`/`all`/`any`.
>   Typage strict des comparateurs numériques : contrairement au moteur de
>   conditions d'affichage de questionnaire (Lot 3A), aucune coercition
>   implicite (`Number(valeur)`) — une valeur non déjà numérique dans la
>   condition est refusée à la validation, jamais convertie à l'exécution.
> - **7 natures de référence** : `answer` (valeur, seul le statut `answered`
>   compte comme présent), `answer_status` (statut explicite, toujours
>   présent, `absent` si aucune ligne), `session_property`
>   (`domain`/`status`), `member_property` (`member_role`),
>   `household_property` (`status`), `contract_branch` (projection minimale
>   contrôlée — uniquement le statut d'un contrat existant, jamais la prime,
>   la police ou les dates), `rule_result` (référence au résultat booléen
>   d'une autre règle du même rule_set — évaluation dans l'ordre de
>   dépendance, profondeur bornée à 5, cycle détecté et refusé à la
>   publication).
> - **Sémantique `all`/`any` — précisée à l'implémentation** (le brief
>   initial les listait de façon ambiguë aux côtés de `and`/`or`/`not`) :
>   ce sont des **quantificateurs sur les membres du foyer** (`over:
>   "members"`), jamais de simples synonymes de `and`/`or`. `all` est vrai
>   si **tous** les membres satisfont la sous-condition (vacuité : vrai si
>   aucun membre) ; `any` est vrai si **au moins un** membre la satisfait
>   (vacuité : faux si aucun membre) — vacuité conforme à la convention
>   mathématique standard (`every`/`some` sur un tableau vide).
> - **`FINDING_TYPE_LABELS` et sémantique des priorités** (pour l'écran de
>   findings du Lot 4B) : voir §3bis et §2bis ci-dessous.
> - **Double contrôle anti-contradiction confirmé nécessaire** (§4) :
>   simulation bornée à la publication **et** comparaison en temps réel à
>   l'exécution — les deux sont implémentés, ni l'un à la place de l'autre.
> - **Référence directe (hors `all`/`any`) à une question de portée
>   « member » — REFUSÉE à la publication** (constat GATE LOT 4A, revue
>   `rules-engine-auditor`, initialement un défaut bloquant, corrigé) :
>   référencer une réponse de portée membre en dehors d'un quantificateur
>   résoudrait systématiquement à « absente » (aucun membre courant hors
>   quantificateur), ce qui aurait rendu `not_exists` silencieusement
>   toujours vrai, quelles que soient les réponses réelles — exactement le
>   type d'hypothèse silencieuse que ce moteur s'interdit (§1/§8). Toute
>   référence `answer`/`answer_status` à une question `scope=member` doit
>   être enveloppée dans un `all`/`any` sur les membres. De même,
>   `required_data` d'une question de portée membre exige que **tous** les
>   membres du foyer figé aient répondu pour être considérée présente
>   (jamais « au moins un membre quelconque »), pour ne jamais conclure à
>   tort qu'une donnée est complète.
> - **Domaine `common` (GATE LOT 4A §2, décision humaine confirmée)** :
>   troisième domaine de `rule_set`, à part entière et pleinement supporté,
>   pour les constats transverses au foyer indépendants du domaine santé ou
>   vie/prévoyance — **facultatif**, son absence ne bloque jamais
>   l'exécution d'un domaine réel. Une session `mixed` exécute jusqu'à
>   **trois exécutions séparées** (`common`, `health`, `life_pension`),
>   jamais fusionnées dans une exécution opaque ; une session `health`
>   accepte `common` et `health` ; une session `life_pension` accepte
>   `common` et `life_pension`. `mixed` reste refusé comme domaine de
>   `rule_set` (uniquement un domaine de *session*). Politique de
>   publication (décision d'implémentation documentée, délibérément choisie
>   parmi plusieurs possibles) : une AUTRE famille (`stable_key`) déjà
>   publiée pour le même domaine bloque une nouvelle publication (409,
>   archivage explicite requis d'abord) ; une AUTRE VERSION de la MÊME
>   famille déjà publiée est en revanche archivée automatiquement dans la
>   même transaction (archivage TOUJOURS avant republication, jamais
>   l'inverse — un rollback en cours de transaction annule les deux à la
>   fois, testé par déclencheur SQL dédié). Cette politique « un seul
>   rule_set publié par domaine, pour `common`/`health`/`life_pension`
>   indépendamment » est garantie **au niveau SQLite lui-même** (index
>   UNIQUE PARTIEL `idx_advisory_rule_sets_one_published_per_domain`,
>   correctif ciblé ajouté directement dans la migration 11 avant tout
>   commit, décision humaine confirmée après revue `advisory-architect`) —
>   cette garantie ne dépend d'aucune hypothèse sur le nombre de processus
>   applicatifs écrivant dans le fichier SQLite, vérifié avec deux VRAIES
>   connexions `better-sqlite3` concurrentes (verrouillage WAL observé,
>   puis violation d'unicité). La vérification applicative
>   (`assertNoOtherPublishedFamilyForDomain`) reste la voie normale pour un
>   message d'erreur clair ; l'index est le filet de sécurité qui tient
>   même si elle était un jour contournée ou concurrencée. Si plusieurs
>   rule_sets publiés par domaine devaient un jour être autorisés, cet
>   index devra être explicitement révisé dans une migration ultérieure.
> - **`finding_scope` — portée déclarée du finding (GATE LOT 4A §3, comblant
>   une lacune du Lot 4A initial où `household_member_id` existait sans
>   jamais être renseigné)** : chaque règle déclare explicitement
>   `session` (un seul finding agrégé, `household_member_id = NULL`),
>   `household` (idem, valeur par défaut) ou `member` (**un finding distinct
>   par membre réellement concerné**, `household_member_id` obligatoire).
>   Pour `finding_scope = member`, la condition racine de la règle doit être
>   exactement un quantificateur `all` ou `any` (validé à la publication) ;
>   `resolveQuantifierMembers` identifie alors, de façon déterministe,
>   *quels* membres correspondent — `any` : chaque membre satisfaisant le
>   prédicat ; `all` : soit tous les membres (si tous satisfont), soit
>   aucun (jamais une attribution partielle arbitraire) ; zéro membre
>   correspondant = zéro finding. Un membre retiré du foyer après le début
>   de la session reste rattaché à ses findings historiques (snapshot figé,
>   `sessionMembersFor`) ; un membre ajouté après coup n'apparaît jamais
>   rétroactivement.
> - **Classification de sensibilité FIGÉE à l'exécution (GATE LOT 4A §4)** :
>   la ré-évaluation en direct de `advisory_questions.sensitive` à la
>   lecture aurait rendu l'audit dépendant de l'état courant plutôt que de
>   l'exécution historique. Chaque référence conservée
>   (`used_inputs_ref`/`inputs_snapshot.answers_used`) fige désormais, au
>   moment même de l'exécution : `sensitivity_at_execution`,
>   `questionnaire_version_id`, `read_at`, et pour une réponse l'id
>   IMMUABLE `advisory_answers` réellement utilisé (jamais relu ni
>   recopié ensuite) ; pour un contrat, seul le champ minimal utilisé
>   (`status_at_execution`) est figé, jamais le contrat complet. L'audit
>   `consultation findings sensibles` se fonde exclusivement sur ce
>   drapeau figé — une reclassification ultérieure de la question ne
>   change jamais rétroactivement la décision d'audit d'une exécution déjà
>   produite.
> - **Conflits : constat historique vs état actif (GATE LOT 4A §5)** :
>   `conflicts_detected_at_execution` fige, une fois pour toutes, le
>   recoupement constaté à la production de l'exécution (historique,
>   jamais réécrit) ; `conflicts_with`/`needs_review` restent l'état ACTIF
>   courant, recalculés uniquement parmi les findings encore `active`
>   chaque fois qu'un finding en conflit est écarté (`dismissFinding`). Un
>   finding restant ne garde `needs_review = true` que s'il conflicte
>   encore avec un AUTRE finding actif — jamais une recommandation
>   automatique, seulement la disparition d'un recoupement qui n'a
>   effectivement plus lieu d'être signalé.
> - **Exécution finale réservée à une session `completed` (GATE LOT 4A §9,
>   décision humaine confirmée)** : contrairement à une hypothèse initiale
>   du Lot 4A, une session `in_progress` (même activement suivie, réponses
>   déjà enregistrées) **ne peut pas** déclencher d'exécution finale —
>   seule une session déjà finalisée le peut (`draft`/`in_progress`/
>   `suspended`/`cancelled` tous refusés, 409). Un foyer archivé refuse
>   toute NOUVELLE exécution (409) mais laisse l'historique déjà produit
>   pleinement lisible (aucune route de lecture ne vérifie le statut du
>   foyer, seule l'écriture le fait).
> - **Chiffres de tests (GATE LOT 4A §6, écart de 3 tests expliqué)** :
>   baseline réelle 589 (vérifiée dans un worktree isolé au commit
>   `1bc3e15b96b9bc330be0783f5df258286232812f`), total actuel 758+ (5
>   nouveaux fichiers de test + 3 tests ajoutés à `test/migrations.test.js`
>   préexistant, jusque-là omis du calcul manuel initial).

## 1. Principes non négociables

- **Déterministe** : mêmes réponses + même version de règles → toujours le
  même résultat. Aucun hasard, aucun appel à un modèle statistique ou à une
  IA dans le calcul lui-même.
- **Versionné** : toute règle appartient à un `advisory_rule_set` versionné
  par domaine (`DATA_MODEL.md` §5.1). Une session fige la version utilisée.
- **Explicable** : chaque résultat pointe vers la règle exacte qui l'a
  produit, avec une explication en langage naturel pour le conseiller et,
  séparément, une reformulation pédagogique pour le client.
- **Testable** : une règle est une donnée versionnée, testable
  indépendamment du reste de l'application (mêmes conventions que
  `test/migrations.test.js`/`test/api.test.js`).
- **Auditable** : chaque exécution est tracée (`advisory_rule_executions`),
  jamais recalculée silencieusement après coup.
- **Indépendant de l'intelligence artificielle** : le moteur ne fait aucun
  appel IA. L'IA peut, plus tard, reformuler un résultat déjà produit
  (`client_explanation`), jamais produire elle-même un constat ou une
  recommandation.

## 2. Format logique d'une règle

| Champ | Rôle |
|---|---|
| `stable_key` | identifiant stable de « cette règle logique », à travers ses versions successives |
| `domain` | `common` \| `health` \| `life_pension` — une règle n'appartient jamais à `mixed` (cette valeur ne qualifie qu'une session, jamais une règle, un finding ou une recommandation ; voir `DATA_MODEL.md` §3.1). `common` (GATE LOT 4A §2) porte les constats transverses au foyer, facultatif mais pleinement pris en charge. |
| `finding_scope` | `session` \| `household` \| `member` (GATE LOT 4A §3) — portée déclarée du finding produit ; `member` exige une condition racine `all`/`any` et produit un finding distinct par membre réellement concerné, jamais une attribution arbitraire |
| `version` | portée par le `rule_set` auquel la règle appartient |
| `status` | `brouillon` \| `valide` \| `archive` — seul `valide` peut s'exécuter sur une session réelle |
| `conditions` | expression déclarative fermée (même famille de format que les conditions d'affichage du questionnaire, §4 de `QUESTIONNAIRE_ENGINE.md`), portant sur des réponses (`stable_key`) et/ou des données de contrat existantes |
| `required_data` | liste des données nécessaires à l'évaluation (réponses et/ou champs de contrat) |
| `missing_data` (calculé à l'exécution) | sous-ensemble de `required_data` non disponible pour cette session — si non vide, la règle ne conclut pas, elle signale l'insuffisance (voir §6) |
| `result` | `finding_type` + `result_payload` structuré (catégorie de besoin/lacune, jamais un produit nommé) |
| `type de finding` | `besoin_detecte` \| `lacune` \| `avertissement` \| `contre_indication` — jamais `recommandation_validee` |
| `priority` | entier, pour l'ordonnancement de l'affichage |
| `explication conseiller` | texte technique, peut citer la condition exacte qui a déclenché |
| `explication client` | reformulation pédagogique, sans jargon, affichable en mode présentation |
| `avertissements` | liste de mises en garde associées (ex. « nécessite vérification de l'état de santé ») |
| `contre-indications` | liste de situations qui invalident la conclusion malgré des conditions par ailleurs remplies |
| `source` | référence interne ou réglementaire précise et datée — **jamais vide** pour une règle `valide` |
| `date d'effet` / `date de fin` | validité temporelle de la règle elle-même (indépendante de la version du rule_set) |
| `validateur humain` | identité + date de la validation qui a fait passer la règle de `brouillon` à `valide` |

## 2bis. Sémantique des priorités (implémenté Lot 4A)

Contrairement à l'entier libre proposé au §2, l'implémentation retient 4
niveaux nommés — un entier sans échelle documentée aurait été arbitraire,
jamais cohérent avec le reste du CRM :

| Priorité | Signification |
|---|---|
| `low` | information de contexte, aucune action attendue à court terme |
| `medium` | mérite d'être abordé pendant l'entretien, sans urgence |
| `high` | à aborder explicitement pendant l'entretien en cours |
| `critical` | situation de risque significatif à signaler clairement — **jamais** un jugement médical ou actuariel certain, uniquement un signal de priorité d'examen humain |

## 3bis. Types de finding — `FINDING_TYPE_LABELS` (implémenté Lot 4A)

Élargissement documenté des étapes 2 à 5 du §3 ci-dessous en 6 types de
finding à part entière (`server/advisoryRules.js`, `FINDING_TYPES`) :

| `finding_type` | Libellé (conseiller) | Étape du §3 |
|---|---|---|
| `fact` | Constat | 2 |
| `detected_need` | Besoin détecté | 3 |
| `gap` | Lacune | 4 |
| `warning` | Avertissement | transversal |
| `missing_information` | Information manquante | transversal (§8) |
| `solution_category` | Catégorie de solution à examiner | 5 |

`contre_indication` (proposition initiale du §2) n'est **pas** repris comme
type distinct : une contre-indication reste une propriété d'un finding
existant (son champ `contraindications`, une liste), jamais un type de
finding séparé — un finding « contre-indication » orpheline, sans
constat/besoin/lacune sous-jacent qu'elle contredirait, n'aurait pas de sens.

## 3. Les sept étapes — distinction stricte

Le moteur ne doit jamais fusionner ces étapes :

1. **Donnée collectée** — une réponse (`advisory_answers`) ou une donnée de
   contrat existante (`contracts`/`contract_*`). Fait brut, non interprété.
2. **Constat** — une observation directe dérivée d'une donnée (ex. « le
   foyer a 2 enfants », « la franchise actuelle est 300 ») — pas encore un
   jugement de besoin.
3. **Besoin détecté** (`finding_type = besoin_detecte`) — une règle a établi
   qu'une situation appelle une réponse (ex. « capacité financière compatible
   avec une franchise plus élevée »).
4. **Lacune** (`finding_type = lacune`) — un écart entre une protection
   existante (lue dans `contracts`) et un besoin détecté.
5. **Catégorie de solution** (`advisory_recommendations.category`) — un
   regroupement de besoins/lacunes en famille de réponse possible (ex.
   « révision de la franchise LAMal »), **jamais un produit ou un assureur
   nommé**.
6. **Produit potentiellement compatible** — hors périmètre de cette version
   (aucun catalogue produit n'existe, cf. Lot 11) ; quand il existera, ce
   sera une donnée **distincte**, alimentée par un catalogue validé
   séparément, jamais générée par le moteur de règles lui-même.
7. **Recommandation validée humainement**
   (`advisory_recommendations.status = validee_conseiller`) — **exclusivement**
   via une action explicite du conseiller authentifié
   (`PUT /api/advisory/recommendations/:id`), jamais une sortie directe du
   moteur.

**Une règle automatique ne doit jamais produire directement l'étape 7.** Le
moteur peut, au mieux, proposer une recommandation à l'état `envisagee` —
l'étape 7 exige toujours une action humaine distincte, horodatée, dont
l'identité est renseignée côté serveur (jamais transmise par le client de
l'API, voir `API_CONTRACT.md` §7).

## 4. Empêcher les règles contradictoires

> **Implémenté (Lot 4A)** : les deux contrôles ci-dessous sont bien
> distincts et TOUS LES DEUX implémentés (confirmé par la revue
> `rules-engine-auditor` : ni l'un ni l'autre n'est un substitut).

- Deux règles `valide` du même `rule_set` ne doivent pas produire, pour les
  mêmes conditions exactes, deux `result_payload` incompatibles pour la
  même catégorie de besoin. **Contrôle à la publication** :
  `validateRuleSetForPublish` simule un nombre borné de combinaisons de
  réponses (valeurs littéralement citées dans les conditions des règles
  actives, plafonné pour rester déterministe et rapide) et signale, en
  avertissement non bloquant, tout recoupement de catégorie — le moteur ne
  peut pas savoir si un recoupement constaté est réellement contradictoire
  ou légitimement complémentaire (voir point suivant), donc il informe sans
  jamais bloquer.
- En cas de déclenchement simultané de règles aux conclusions différentes
  sur un même sujet, les deux `findings` sont conservés (jamais l'un
  supprimé silencieusement au profit de l'autre) — c'est au conseiller de
  trancher, avec les deux explications sous les yeux. **Contrôle en temps
  réel** : à chaque exécution, deux findings déclenchés partageant la même
  `category_hint` sont marqués `needs_review = true` avec renvoi croisé
  (`conflicts_with`), en complément de la simulation de publication
  ci-dessus (qui ne peut pas prédire toutes les combinaisons réelles).

> **Historique vs état actif (GATE LOT 4A §5)** : `conflicts_detected_at_
> execution` fige, à la production de l'exécution, la liste des autres
> findings en conflit — **historique et immuable, jamais réécrit ensuite**.
> `conflicts_with`/`needs_review` sont l'état **actif** courant : quand un
> finding contradictoire est écarté (`dismissFinding`), ils sont recalculés
> pour ne plus référencer que des findings encore `active` — un finding
> restant ne garde `needs_review = true` que s'il conflicte encore avec un
> AUTRE finding actif. L'écartement ne supprime jamais rien (le finding
> écarté reste consultable, `status = dismissed`) et ne constitue jamais une
> recommandation automatique sur le finding restant.

## 5. Empêcher les doublons

> **Implémenté (Lot 4A).**

- `stable_key` unique par `rule_set` — contrainte `UNIQUE(rule_set_id,
  stable_key)` en base, jamais seulement applicative.
- La validation de publication détecte toute paire de règles actives à
  `conditions` strictement identiques (empreinte canonique comparée, même
  mécanisme que `content_hash`) — alerte non bloquante, la décision de
  fusionner ou non revient à l'humain qui publie.

## 6. Empêcher les règles sans source

> **Implémenté (Lot 4A), avec une précision** : `validated_by`/`validated_at`
> ne sont **jamais** des champs librement renseignables par l'auteur de la
> règle — ils sont stampés automatiquement par le serveur au moment où le
> `rule_set` qui contient la règle est publié (l'acte de publication EST
> l'acte de validation humaine, voir §2bis/`DATA_MODEL.md` §5). La
> validation de publication refuse toute règle active dont `source`,
> `source_reference`, `effective_from` ou `advisor_explanation` est vide.

## 7. Empêcher les règles expirées

> **Implémenté (Lot 4A).**

- À l'exécution, seules les règles dont `effective_from <= date du jour <=
  effective_until (ou null)` sont évaluées. Une règle expirée reste visible
  dans l'historique (elle a pu s'appliquer à une session passée) mais ne
  s'exécute plus sur une nouvelle session.

## 8. Empêcher les diagnostics basés sur des informations manquantes

> **Implémenté (Lot 4A), avec une précision de granularité** : l'exécution
> dans son ensemble n'a pas d'`outcome` propre (voir `DATA_MODEL.md` §5) —
> c'est **chaque règle individuellement** dont les données requises sont
> absentes qui produit un finding `finding_type = missing_information`
> (jamais un résultat par défaut, jamais une hypothèse silencieuse), listant
> précisément les références manquantes (`missing_data`, résolvables :
> `question_id`/`stable_key`/`contract_branch`).

- Si `missing_data` n'est pas vide pour une règle, celle-ci produit une
  exécution `outcome = donnees_manquantes` — **pas** un résultat par défaut,
  **pas** une hypothèse silencieuse. Le manque est lui-même visible et
  journalisé (voir aussi le principe LOT 0 : « ne jamais masquer une
  information manquante »).
- Le rapport (`REPORT_SPECIFICATION.md`) reprend explicitement la liste des
  informations manquantes ayant empêché une conclusion.

## 9. Empêcher les recommandations silencieuses

- Toute `advisory_recommendation` à l'état `envisagee` doit être visible
  dans l'interface conseiller **avant** toute génération de rapport — aucune
  route ne doit permettre de générer un `rapport_final` sans qu'au moins un
  passage explicite par l'écran de validation ait eu lieu (contrôle
  applicatif à l'implémentation, Lot 7/9).
- Écarter une recommandation ou un constat exige toujours un motif
  (`discard_reason` non vide) — jamais un écartement muet.

## 10. Empêcher la modification rétroactive d'un ancien diagnostic

> **Implémenté (Lot 4A), avec une précision** : l'amendement d'une réponse
> (`POST .../answers/amend`) ne déclenche **pas automatiquement** une
> nouvelle exécution du moteur — contrairement à la formulation « qui
> déclenche une nouvelle exécution » ci-dessous, qui suggérait un
> enchaînement automatique. Le conseiller appelle explicitement
> `POST .../rule-executions` après un amendement, comme après toute
> évolution des réponses ; l'immuabilité de l'exécution/des findings déjà
> produits (jamais réécrits, seulement supersédés par une nouvelle
> exécution) reste, elle, garantie exactement comme décrit ci-dessous.

- Dès que `advisory_sessions.status = termine`, toutes les lignes déjà
  écrites (`advisory_answers`, `advisory_rule_executions`,
  `advisory_findings`, `advisory_recommendations` déjà validées,
  `advisory_report_versions` déjà générées) deviennent **immuables — aucune
  n'est jamais mise à jour en place**. Une erreur découverte après coup ne
  réécrit rien : elle passe par le mécanisme d'amendement explicite
  (décision GATE LOT 1, point 3.4) — une nouvelle réponse
  `advisory_answers.is_amendment = true` avec motif obligatoire
  (`POST /api/advisory/sessions/:id/answers/amend`), qui déclenche une
  **nouvelle** exécution du moteur de règles et, si le résultat en est
  changé, une **nouvelle** version de rapport (`rapport_corrige`). L'ancienne
  réponse reste consultable (`superseded_by_answer_id`), l'ancienne
  exécution et l'ancien rapport restent inchangés et consultables — rien
  n'est jamais réécrit, seulement complété par une couche supplémentaire
  tracée.
- Publier une nouvelle version d'un `rule_set` ou d'un questionnaire n'altère
  jamais les sessions qui référencent une version antérieure figée — vérifié
  empiriquement (GATE LOT 4A §8) y compris quand cette nouvelle version est
  publiée APRÈS une première exécution réussie (ce qui archive
  automatiquement l'ancienne version, politique du domaine `common` ci-
  dessus) : la ré-exécution réutilise silencieusement le rule_set déjà
  pinné, jamais la nouvelle version.

> **Exécution finale réservée à une session `completed` (GATE LOT 4A §9,
> décision humaine confirmée)** : une session `in_progress` — même
> activement suivie, réponses déjà enregistrées — **ne peut pas** déclencher
> d'exécution finale ; seule une session déjà `completed` le peut
> (`draft`/`in_progress`/`suspended`/`cancelled` tous refusés, 409). Un
> foyer archivé refuse toute NOUVELLE exécution (409) mais laisse
> l'historique déjà produit pleinement lisible. Aucune exécution
> interrompue par une erreur inattendue ne laisse de finding partiel ni
> d'audit de succès : la transaction qui construit une exécution est
> intégralement annulée en cas d'erreur (`db.transaction`), seule
> l'exécution `failed` (dans sa propre transaction séparée) est alors
> écrite.

## 11. Exemple fictif de règle — Assurance Maladie

> **Corrigé au Lot 4A (GATE, revue `rules-engine-auditor`)** : la version
> antérieure de cet exemple utilisait une syntaxe qui n'a jamais existé dans
> le DSL réellement implémenté (`contract_field`/`lte`, `required_data` en
> chaînes brutes, `all` traité comme une simple liste ET plutôt que comme le
> quantificateur qu'il est réellement, §2bis) — corrigée ci-dessous pour
> refléter exactement `server/advisoryRuleConditions.js`. **Limite
> structurelle à connaître avant d'écrire une règle réelle** : `contract_branch`
> n'expose que le `status` d'un contrat (projection minimale volontaire,
> jamais un montant comme une franchise/prime) — une règle qui a besoin
> d'une VALEUR numérique de contrat doit la faire déclarer comme réponse au
> questionnaire (le conseiller la saisit), jamais la lire directement dans
> `contracts`.

*Catégorie de besoin fictive, aucun seuil ni référence réglementaire réels.*

```json
{
  "stable_key": "health-franchise-capacite-01",
  "domain": "health",
  "conditions": {
    "op": "and",
    "conditions": [
      { "op": "in", "ref": { "answer": "capacite_supporter_franchise_elevee" }, "value": ["moyenne", "élevée"] },
      { "op": "equals", "ref": { "answer": "franchise_actuelle_connue" }, "value": true },
      { "op": "equals", "ref": { "contract_branch": "lamal" }, "value": "actif" }
    ]
  },
  "required_data": [
    { "answer": "capacite_supporter_franchise_elevee" },
    { "answer": "franchise_actuelle_connue" },
    { "contract_branch": "lamal" }
  ],
  "result_finding_type": "detected_need",
  "result_payload": { "category_hint": "revision_franchise_lamal" },
  "priority": "medium",
  "advisor_explanation": "Franchise actuelle basse alors que la capacité financière déclarée permettrait d'envisager une franchise plus élevée — à confirmer avec le client avant toute proposition.",
  "client_explanation": "Votre franchise actuelle pourrait ne plus correspondre à votre situation financière actuelle.",
  "warnings": ["Nécessite de vérifier la consommation médicale réelle avant toute décision."],
  "source": "Référence interne — méthodologie de conseil Legrand Conseils, à valider par un spécialiste métier avant mise en production",
  "status": "active"
}
```

## 12. Exemple fictif de règle — Vie et Prévoyance

> **Corrigé au Lot 4A (GATE, revue `rules-engine-auditor`)**, mêmes
> précisions que §11. **Limite structurelle supplémentaire à connaître** :
> le DSL n'a **aucune notion de valeur calculée/dérivée** (pas d'arithmétique
> entre plusieurs réponses, ex. revenu − charges − prestations LPP) —
> chaque comparateur ne porte que sur une seule référence résolue contre une
> valeur littérale. Un calcul de déficit réel doit être posé comme une
> question dédiée du questionnaire (calculée en amont, par le conseiller ou
> une future aide de saisie, jamais par le moteur de règles lui-même), pas
> comme une expression `computed` inexistante.

```json
{
  "stable_key": "vie-deficit-incapacite-01",
  "domain": "life_pension",
  "conditions": {
    "op": "and",
    "conditions": [
      { "op": "exists", "ref": { "answer": "epargne_mensuelle_disponible" } },
      { "op": "greater_than", "ref": { "answer": "deficit_mensuel_incapacite_estime" }, "value": 0 }
    ]
  },
  "required_data": [
    { "answer": "epargne_mensuelle_disponible" },
    { "answer": "deficit_mensuel_incapacite_estime" }
  ],
  "result_finding_type": "gap",
  "result_payload": { "category_hint": "couverture_incapacite_gain" },
  "priority": "high",
  "advisor_explanation": "Le déficit mensuel estimé en cas d'incapacité (réponse saisie séparément, modèle configurable) est positif — à vérifier avec les prestations LPP réelles du foyer avant toute conclusion.",
  "client_explanation": "En cas d'incapacité de travail prolongée, votre revenu de remplacement pourrait ne pas couvrir vos charges actuelles.",
  "warnings": ["Le déficit est un modèle configurable saisi en amont, pas une simulation actuarielle certifiée par ce moteur."],
  "source": "Modèle de calcul interne — à valider par un spécialiste prévoyance avant mise en production",
  "status": "active"
}
```

## 13. Rapport avec `compliance-privacy-reviewer` et `rules-engine-auditor`

Aucune règle ne passe `brouillon → valide` sans revue explicite (source
présente, absence de contradiction, tests associés) — c'est le rôle du
sous-agent `rules-engine-auditor` (voir `.claude/agents/rules-engine-
auditor.md`), pas une auto-validation par le moteur lui-même.
