# Contrat d'API — `/api/advisory` (proposition, non implémentée)

> Aucune route décrite ici n'existe. Aucun code serveur n'est modifié par ce
> document. Toutes les routes seraient montées avec `requireAuth` (comme
> l'ensemble des routes internes existantes) et soumises au même middleware
> anti-CSRF et de rate-limiting déjà en place dans `server/app.js`.

## Conventions communes à toutes les routes

- **Permissions** : dans cette version, un seul rôle existe (le conseiller
  authentifié) — identique à toutes les routes actuelles. Aucune route de ce
  module n'introduit de rôle « client » ou « administrateur » (cf. décision
  LOT 0, mono-utilisateur).
- **Audit** : chaque route qui crée, modifie ou supprime appelle `audit()`
  avec une action explicite, sur le modèle des routes `contracts`/`clients`
  existantes.
- **Validation** : réutilise les helpers existants de `server/validate.js`
  (`assert`, `isEmail`, `isDateStr`, `inEnum`, `checkTextFields`) plutôt que
  d'en réinventer.
- **Idempotence** : précisée route par route ; par défaut, les créations
  (`POST`) ne sont pas idempotentes (comme `POST /api/clients` aujourd'hui),
  sauf mention contraire.
- **Erreurs** : mêmes codes que l'existant — `400` validation, `401` non
  authentifié, `403` action interdite (ex. session déjà terminée), `404`
  ressource introuvable, `409` conflit (ex. tentative de modification d'une
  session figée).

---

## 1. Foyers

> **Foyer archivé = figé (implémenté et testé au Lot 2, GATE, contrôle
> ciblé « foyers archivés »)** : dès qu'un foyer est `status = 'archive'`,
> **toute écriture** le concernant est refusée avec `409` — modification du
> foyer lui-même (y compris une tentative de réactivation vers `actif`,
> non prévue à ce lot et donc interdite plutôt que non spécifiée), ajout
> d'un membre, modification d'une adhésion, retrait d'un membre, changement
> de membre principal. Seules les lectures (`GET` liste et détail) restent
> possibles. Aucune entrée d'audit n'est écrite pour une opération ainsi
> refusée (seules les opérations réellement effectuées le sont). Vérifié
> côté service (`server/advisoryHouseholds.js`, fonction
> `assertHouseholdWritable`), pas seulement côté interface.

### `GET /api/advisory/households`
- **Paramètres** : `q` (recherche texte), `status`.
- **Réponse** : liste des foyers avec noms des membres agrégés (comme
  `GET /api/clients` agrège déjà `active_contracts`).
- **Audit** : aucun (lecture de liste, comme les listes existantes).

### `GET /api/advisory/households/:id`
- **Réponse** : foyer + membres (`household_members` enrichis des champs
  `clients` correspondants) + sessions passées (résumé).
- **Audit** : `consultation dossier foyer` (même logique que la consultation
  client existante qui journalise déjà l'accès).

### `POST /api/advisory/households`
- **Corps** : `{ primary_client_id, label? }`. Le `primary_client_id` doit
  référencer un `clients.id` existant (créé au préalable via l'API `clients`
  existante — ce module ne réimplémente pas la création de personne).
- **Validation** : `primary_client_id` obligatoire et existant.
- **Appartenance à plusieurs foyers (décision GATE LOT 1, décision 1)** :
  `primary_client_id` peut déjà être `principal` (ou tout autre rôle) d'un
  ou plusieurs autres foyers actifs — **ce n'est jamais un motif de
  refus** ; la réponse liste ces foyers (`already_in_households`) à titre
  informatif.
- **Réponse** : `201` `{ id, already_in_households: [...] }`.
- **Erreurs** : `400` uniquement si `primary_client_id` est introuvable.
- **Audit** : `création foyer`.

### `PUT /api/advisory/households/:id`
- **Corps** : `{ label?, status? }`.
- **Audit** : `modification foyer` — sauf si `status` passe à `archive` (le
  foyer n'était pas déjà archivé), auquel cas l'action journalisée est
  `archivage foyer` (jamais les deux à la fois pour un même appel) —
  implémenté et testé au Lot 2 (`server/advisoryHouseholds.js`).

---

## 2. Membres du foyer

### `POST /api/advisory/households/:id/members/check-similarity`
- **Objectif** : détection souple de doublons (décision GATE LOT 1,
  décision 2) — route de confort permettant d'afficher les correspondances
  **avant** de remplir tout le formulaire de création. Le conseiller peut
  l'ignorer et appeler directement `POST .../members` : celle-ci effectue
  de toute façon la même vérification en interne avant d'écrire quoi que ce
  soit (voir ci-dessous) — la création reste toujours possible au final,
  mais jamais sans passer par la confirmation explicite si une
  correspondance forte existe.
- **Corps** : `{ first_name?, last_name?, birth_date? }` (données du
  brouillon de personne, avant toute création).
- **Comportement** : recherche des personnes existantes selon les critères
  indicatifs de `DATA_MODEL.md` §2.3 (prénom/nom normalisés, date de
  naissance, foyer, représentant légal, adresse, relation familiale) —
  implémenté au Lot 2 (`server/advisorySimilarity.js`, `server/
  advisoryHouseholds.js`).
- **Réponse** : `{ matches: [{ client_id, display_name, birth_date, match_level, reasons: [...], household_ids: [...] }] }`.
  `match_level` ∈ `{exact_match, probable_match, possible_similarity}` —
  **décision humaine explicite du Lot 2** : identifiants techniques en
  anglais, snake_case (divergence assumée avec la convention française du
  reste du CRM, sur le même principe que `advisory_sessions.domain` déjà
  documenté en §3 ; voir aussi `DATA_MODEL.md` §2.3). `no_match` existe comme
  quatrième valeur logique côté moteur (`server/advisorySimilarity.js`) mais
  n'est **jamais** renvoyé par cette route : les correspondances `no_match`
  sont filtrées avant réponse (`reasons` serait de toute façon vide) —
  jamais de champ booléen simple « doublon oui/non ». `reasons` est une
  liste structurée (`{ field, detail }`), jamais un texte libre.
- **Audit** : `présentation correspondance similarité`, uniquement si
  `matches` n'est pas vide (avec les niveaux de correspondance trouvés,
  jamais le contenu des champs comparés) — une consultation qui ne trouve
  rien n'est pas journalisée.

### `POST /api/advisory/households/:id/members`
- **Corps** : `{ client_id, member_role, relationship_detail?, legal_representative_client_id? }`
  ou, pour la création rapide d'une personne : `{ new_person: { first_name, last_name, birth_date? }, member_role, relationship_detail?, legal_representative_client_id?, confirmed_despite_match? }`.
- **Validation** :
  - `member_role` ∈ `{principal, conjoint, enfant, autre_charge}` ;
  - `member_role = 'principal'` est **refusé** sur cette route (`400`) si le
    foyer a déjà un principal actif — l'ajout initial du foyer fixe le
    principal via `primary_client_id` (§1), tout changement ultérieur passe
    exclusivement par `POST .../members/:memberId/set-primary` (voir
    ci-dessous), jamais par cette route ;
  - si `client_id` déjà membre **actif du même foyer** → `409` (§`DATA_MODEL.md`
    §2.2, règle 3) ;
  - si `legal_representative_client_id` fourni, doit être membre actif du
    même foyer (§`DATA_MODEL.md` 2.2) ;
  - `client_id` peut soit référencer un `clients.id` existant, soit (option
    de confort à valider) accepter un sous-objet de création rapide
    (`new_person: { first_name, last_name, birth_date }`) qui appelle en
    interne la même logique que `POST /api/clients` — **à trancher en
    Lot 2**, car cela évite un aller-retour d'écran pour ajouter un enfant,
    sans dupliquer la logique de création.
- **Appartenance à plusieurs foyers (décision GATE LOT 1, décision 1)** :
  aucun blocage si `client_id` appartient déjà à un ou plusieurs **autres**
  foyers actifs — **jamais un `409` dans ce cas**, uniquement informatif :
  la réponse liste ces foyers (`already_in_households`, voir ci-dessous)
  pour que le conseiller en soit conscient.
- **Détection souple de doublons (décision GATE LOT 1, décision 2)** :
  quand `new_person` est fourni et qu'un appel préalable à
  `check-similarity` (ou une vérification interne équivalente) trouve une
  correspondance `exacte` ou `probable`, la création est refusée (`409`,
  avec `matches` dans la réponse) **sauf** si `confirmed_despite_match:
  true` est explicitement transmis — dans ce cas la création procède et
  génère une entrée d'audit dédiée. Ce mécanisme **ne bloque jamais
  systématiquement** : il exige seulement une confirmation explicite avant
  de procéder, jamais un blocage définitif ni une fusion automatique.
- **Réponse** : `201` `{ id, already_in_households: [...] }` —
  `already_in_households` liste les autres foyers actifs où `client_id` est
  déjà membre (vide si aucun).
- **Audit** : `ajout membre foyer` ; si `confirmed_despite_match: true` a
  été utilisé, une entrée additionnelle `création malgré correspondance
  détectée` avec `match_level` et le `client_id` existant concerné.
- **Audit — création de personne via `new_person` (correctif de
  traçabilité)** : quand `new_person` est fourni, la création de la ligne
  `clients` est journalisée séparément, via l'action **déjà existante**
  `création client` (`server/routes/clients.js`, pas une nouvelle
  convention), avec `entity = 'client'`, `entity_id` = l'identifiant du
  nouveau client, et des détails volontairement minimaux (`particulier —
  origine module foyer — foyer #<id>`), **sans** le nom, la date de
  naissance ni aucune autre donnée personnelle du nouveau client — à la
  différence de la convention standard de `POST /api/clients` qui
  journalise le nom affiché. Cette entrée est écrite **dans la même
  transaction** que la création du client et l'ajout au foyer : un échec
  ultérieur (ex. représentant légal invalide) annule la création, son audit
  et l'ajout au foyer ensemble (testé). Une personne **existante**
  (`client_id`) ne produit jamais cette entrée. Les deux événements —
  création de la personne, puis rattachement au foyer (`ajout membre
  foyer`) — restent deux lignes d'audit strictement distinctes.

### `PUT /api/advisory/households/:id/members/:memberId`
- **Corps** : `{ relationship_detail?, legal_representative_client_id?, end_date? }`.
- **Validation** : **n'accepte jamais `member_role`** — un changement de
  rôle vers ou depuis `principal` passe uniquement par la route dédiée
  ci-dessous ; un changement entre `conjoint`/`enfant`/`autre_charge` (hors
  `principal`) n'est, dans cette première version, pas prévu comme
  nécessaire et n'est donc pas exposé — à réévaluer si un besoin réel
  apparaît. Refuse la modification si le membre est référencé par le
  `household_snapshot` figé d'une session déjà `termine` (voir
  `DATA_MODEL.md` §3.1) — dans ce cas, la modification s'applique
  uniquement à l'avenir, jamais rétroactivement.
- **Audit** : `modification membre foyer`.

### `POST /api/advisory/households/:id/members/:memberId/set-primary`
- **Objectif** : procédure contrôlée et unique pour changer le membre
  principal d'un foyer (décision GATE LOT 1, point 3.2) — jamais un simple
  `PUT`.
- **Corps** : `{ previous_primary_new_role }`, `previous_primary_new_role`
  ∈ `{conjoint, autre_charge}` — le rôle que reprend l'ancien principal une
  fois rétrogradé (obligatoire, pour éviter qu'un foyer se retrouve
  momentanément sans principal ni rôle cohérent pour l'ancien).
- **Comportement** : opération atomique unique — rétrograde l'ancien membre
  `member_role = 'principal'` vers `previous_primary_new_role`, promeut
  `:memberId` à `member_role = 'principal'`, met à jour
  `households.primary_client_id`.
- **Validation** : `:memberId` doit être un membre actif du foyer, non déjà
  `principal` ; le foyer doit avoir exactement un principal actif avant
  l'opération (invariant vérifié, pas juste supposé).
- **Réponse** : `200` `{ ok: true }`.
- **Erreurs** : `409` si le foyer n'a pas exactement un principal actif au
  moment de l'appel (incohérence à corriger avant tout changement).
- **Audit** : `changement de membre principal`, avec l'ancien et le nouveau
  `client_id` en détail.
- **Idempotence** : non — un second appel avec les mêmes paramètres
  échouerait (`:memberId` est déjà `principal`).

### `DELETE /api/advisory/households/:id/members/:memberId`
- Marque `status = archive` avec `end_date`, ne supprime jamais physiquement
  si le membre est référencé par une session existante. **Refusé (`400`)**
  si `member_role = 'principal'` — un principal doit d'abord être changé via
  `set-primary` avant de pouvoir retirer l'ancien titulaire du foyer.
- **Audit** : `retrait membre foyer`.

---

## 3. Sessions

> **Implémenté au Lot 3A** (`server/routes/advisorySessions.js`,
> `server/advisorySessions.js`). Diverge de la proposition LOT 1
> ci-dessous : identifiants anglais, pas de colonne `questionnaire_version_id`
> unique (composition modulaire via §4bis), pas de `meeting_mode`/
> `internal_notes`/`rule_set_version_id` dans ce lot.

### `GET /api/advisory/sessions`
- **Paramètres** : `household_id?`, `status?`, `domain?`, `from?`, `to?`
  (filtrent sur `scheduled_at`).
- **Réponse** : liste des sessions.
- **Audit** : aucun (lecture de liste).

### `POST /api/advisory/sessions`
- **Corps** : `{ household_id, domain, questionnaire_versions: [{ questionnaire_version_id, domain, module_role, display_order }], title?, scheduled_at? }`
  — `questionnaire_versions` remplace un unique `questionnaire_version_id`
  (composition modulaire, `DATA_MODEL.md` §3.2).
- **Validation** : `domain` ∈ `{health, life_pension, mixed}` ; le foyer doit
  exister (`400` sinon) et ne pas être `archive` (`409` sinon) ; chaque
  version rattachée doit exister et être `published` (`400`/`409`) ; son
  domaine réel doit correspondre au domaine déclaré dans le rattachement ;
  invariants de composition par domaine de session (une version `health`
  exactement pour une session `health`, une `health` **et** une
  `life_pension` pour `mixed`, `common` toujours facultative, jamais deux
  versions du même rôle de domaine) — voir `DATA_MODEL.md` §3.2.
- **Réponse** : `201` `{ id }`.
- **Audit** : `session créée`.

### `GET /api/advisory/sessions/:id`
- **Réponse** : session (y compris `household_snapshot` une fois démarrée)
  + composition (`questionnaire_versions`) + `answered_count`. Pas encore de
  réponses/findings/recommandations/consentements imbriqués (ces objets
  n'existent pas avant les lots suivants).
- **Audit** : aucun dans ce lot (accès non journalisé, à la différence du
  détail d'un foyer — à revoir si un contenu personnel plus sensible y
  apparaît en Lot 5/6).

### `PUT /api/advisory/sessions/:id`
- **Corps** : `{ title?, scheduled_at? }` uniquement — jamais `household_id`,
  `domain` ni la composition, immuables après création.
- **Audit** : `session modifiée`.

### `GET /api/advisory/sessions/:id/completion-check`
- **Objectif** : prévisualiser la validation de finalisation sans finaliser
  — route de confort pour l'interface (identique à la vérification interne
  de `POST .../complete`).
- **Réponse** : `{ valid, byLink: [{ domain, questionnaire_version_id, missing: [...] }] }`
  — `missing` distingue explicitement les éléments manquants par domaine
  rattaché (`common`/`health`/`life_pension`), jamais une liste globale
  indifférenciée pour une session mixte.

### `POST /api/advisory/sessions/:id/start`
- **Validation** : machine d'état stricte, indexée par (statut, action) —
  seule la transition `draft → in_progress` est acceptée pour cette action.
- **Comportement** : fige `household_snapshot` (copie de la composition
  actuelle du foyer), horodate `started_at`/`last_activity_at`.
- **Audit** : `session démarrée`.

### `POST /api/advisory/sessions/:id/suspend` / `/resume`
- **Validation** : `suspend` uniquement depuis `in_progress` ; `resume`
  uniquement depuis `suspended` — **jamais** interchangeables avec `start`
  bien qu'ils ciblent tous deux `in_progress` (bug détecté et corrigé
  pendant l'implémentation : une machine d'état indexée par statut cible
  seul aurait permis à tort de « reprendre » une session en `draft`).
- **Erreurs** : `409` sur toute transition hors de la machine d'état.
- **Audit** : `session suspendue` / `session reprise`.

### `POST /api/advisory/sessions/:id/complete`
- **Validation** : uniquement depuis `in_progress` ; vérifie que toutes les
  réponses obligatoires **visibles** (conditions d'affichage résolues) de
  **chaque** version rattachée sont présentes (`answered`/`unknown`/
  `not_applicable` — jamais `cleared` ni absente) ; une question masquée ne
  bloque jamais la finalisation.
- **Erreurs** : `409` avec `{ missing: [...] }` (même structure que
  `completion-check`) si des réponses obligatoires manquent.
- **Audit** : `session finalisée`.

### `POST /api/advisory/sessions/:id/cancel`
- **Validation** : depuis `draft`, `in_progress` ou `suspended` — jamais
  depuis `completed`.
- **Audit** : `session annulée`.

**Aucune transition sortante n'existe depuis `completed` ni `cancelled`** —
une session finalisée ou annulée ne peut jamais être réouverte silencieusement.

---

## 4. Questionnaires

> **Implémenté au Lot 3A** (`server/routes/advisoryQuestionnaires.js`,
> `server/advisoryQuestionnaires.js`) — **y compris** la création de
> contenu (questionnaire/version/section/question/option), explicitement
> demandée par les instructions du Lot 3A, à la différence de la
> proposition LOT 1 ci-dessous qui la classait « hors périmètre lots 2-9 ».
> Toutes ces routes restent privées, aucun éditeur public.

### `GET /api/advisory/questionnaires`
- **Paramètres** : `domain?`, `status?`. Liste des questionnaires (familles).

### `POST /api/advisory/questionnaires`
- **Corps** : `{ stable_key, domain, name, description? }`. `domain` ∈
  `{common, health, life_pension}` (jamais `mixed` à ce niveau — voir
  `DATA_MODEL.md` §3).
- **Erreurs** : `409` si `stable_key` déjà utilisée par un autre questionnaire.
- **Audit** : `questionnaire créé`.

### `POST /api/advisory/questionnaires/:id/versions`
- **Corps** : `{ notes? }`. Crée un nouveau brouillon, `version_number`
  strictement croissant par questionnaire.
- **Audit** : `version créée`.

### `GET /api/advisory/questionnaires/versions`
- **Paramètres** : `domain?`, `status?`. Liste toutes les versions (utilisée
  par l'écran de création de session pour proposer les versions publiées
  disponibles par domaine).

### `GET /api/advisory/questionnaires/versions/:versionId`
- Structure complète (sections, questions, options) d'une version précise.
- **Erreurs** : `404` si introuvable.

### `GET /api/advisory/questionnaires/versions/:versionId/validate`
- Validation de format/cohérence sans publier (référence inconnue, cycle de
  conditions, options manquantes/superflues, cohérence
  `section.applies_to`/`question.scope`) — `{ valid, errors: [...] }`.

### `POST /api/advisory/questionnaires/versions/:versionId/publish`
- **Validation** : identique à `.../validate` ; refuse (`409`, avec `errors`)
  si invalide ; refuse si la version n'est pas `draft`.
- **Comportement** : calcule un `content_hash` (SHA-256), passe `published`,
  **irréversible** (jamais de retour à `draft`).
- **Audit** : `version publiée`.

### `POST /api/advisory/questionnaires/versions/:versionId/archive`
- Passe `archived` (depuis `draft` ou `published`) — n'altère jamais les
  sessions historiques déjà rattachées. Idempotent.
- **Audit** : `version archivée` (une seule fois, pas en cas d'idempotence).

### `POST /api/advisory/questionnaires/versions/:versionId/clone`
- **Validation** : uniquement depuis une version `published`.
- **Comportement** : crée un nouveau brouillon (même questionnaire),
  copiant intégralement sections/questions/options avec les mêmes clés
  stables — la version d'origine n'est jamais modifiée.
- **Audit** : `version clonée`.

### `POST /api/advisory/questionnaires/versions/:versionId/sections`, `PUT .../sections/:sectionId`
- Créent/modifient une section brouillon. Refusés (`409`) si la version
  n'est plus `draft`.

### `POST /api/advisory/questionnaires/sections/:sectionId/questions`, `PUT .../questions/:questionId`
- Créent/modifient une question brouillon (mêmes contraintes d'immuabilité).
- **`allows_not_applicable`** (booléen, défaut `false` — correctif final
  avant premier commit du Lot 3A) : distinct de `allows_unknown`. Doit être
  un booléen strict si fourni (`true`/`false`) — toute autre valeur est
  refusée (`400`), jamais coercée silencieusement (contrairement à
  `allows_unknown`/`required`, déjà tolérants). Retourné dans le détail de
  version (`GET .../versions/:versionId`), conservé par le clonage, inclus
  dans `content_hash` (voir `QUESTIONNAIRE_ENGINE.md` §7.1), et soumis à la
  même règle d'immuabilité après publication que tout autre champ.

### `POST /api/advisory/questionnaires/questions/:questionId/options`, `PUT .../options/:optionId`
- Créent/modifient une option (choix simple/multiple uniquement).

---

## 5. Réponses

> **Implémenté au Lot 3A**, sous `/api/advisory/sessions/:id/answers*`.

### `GET /api/advisory/sessions/:id/answers`
- Réponses **actives** de la session (`superseded_by_answer_id IS NULL`).

### `GET /api/advisory/sessions/:id/answers/history`
- **Paramètres** : `question_id`, `household_member_id?`. Historique complet
  (append-only) d'une question — mode conseiller/audit uniquement.

### `PUT /api/advisory/sessions/:id/answers`
- **Corps** : `{ answers: [{ question_id, household_member_id?, status, value? }] }`
  — écriture par lot. `status` ∈ `{answered, unknown, not_applicable, cleared}`
  (remplace les deux booléens `is_unknown`/`is_not_applicable` envisagés en
  LOT 1 — voir `DATA_MODEL.md` §4.6).
- **Validation** : `household_member_id` doit appartenir au **même** foyer
  que la session (jamais un membre d'un autre foyer, invariant vérifié en
  service, revue `compliance-privacy-reviewer`) ; la question doit
  appartenir à une version rattachée à la session ; valeur conforme au
  type (`text`/`long_text`/`integer`/`decimal`/`money`/`date`/`boolean`/
  `single_choice`/`multiple_choice`, sans coercition silencieuse, aucune
  option dupliquée pour un choix multiple) ; `unknown` refusé (`400`) si la
  question ne l'autorise pas (`allows_unknown = false`) ; `not_applicable`
  refusé (`400`, correctif final avant premier commit) si la question ne
  l'autorise pas explicitement (`allows_not_applicable = false`, valeur par
  défaut) — ce contrôle est appliqué côté service sur tous les chemins
  d'écriture (`PUT .../answers`, `POST .../answers/amend`), jamais
  uniquement côté interface ; aucune valeur fournie si le statut n'est pas
  `answered`. `cleared` reste un mécanisme technique de suppression logique
  et ne satisfait jamais une question obligatoire à la finalisation, quelle
  que soit la configuration de la question.
- **Comportement** (décision GATE LOT 1, point 3.4) : chaque réponse insère
  toujours une nouvelle ligne et renseigne `superseded_by_answer_id` sur la
  précédente réponse active du même `(question_id, household_member_id)` —
  jamais de mise à jour en place. `sessions.revision` s'incrémente une fois
  par appel (pas par réponse individuelle du lot).
- **Interdiction explicite** : `409` si `session.status` n'est pas `draft`,
  `in_progress` ou `suspended` (une session `completed`/`cancelled` ne peut
  plus recevoir de réponse par cette route).
- **Audit** : `réponse enregistrée` (si au moins une nouvelle réponse) et/ou
  `réponse remplacée` (si au moins une réponse existante était remplacée) —
  jamais la valeur, jamais de donnée sensible.

### `DELETE /api/advisory/sessions/:id/answers/:questionId`
- **Corps** : `{ household_member_id? }`.
- **Comportement** : insère une nouvelle ligne `status = cleared` (jamais de
  suppression physique) — une question obligatoire ainsi effacée redevient
  manquante pour la finalisation.
- **Audit** : `réponse effacée`.

### `POST /api/advisory/sessions/:id/answers/amend`
- **Objectif** : seule route permettant de corriger une réponse d'une
  session déjà `completed` (décision GATE LOT 1, point 3.4).
- **Corps** : `{ question_id, household_member_id?, status, value?, amendment_reason }`
  — `amendment_reason` obligatoire et non vide.
- **Validation** : `409` si `session.status` n'est pas `completed` (corrigé —
  documenté à tort comme `400` avant ce correctif) ; `400` si
  `amendment_reason` est absent/vide ou si le type/statut de la réponse est
  non conforme (y compris le gating `allows_unknown`/`allows_not_applicable`
  ci-dessus, qui s'applique identiquement à cette route).
- **Comportement** : insère la nouvelle réponse avec `is_amendment = true`,
  jamais de retour en arrière du statut de la session (aucune route de ce
  lot ne rouvre une session finalisée). L'exécution automatique du moteur
  de règles n'existe pas encore (Lot 4) — à ajouter explicitement quand ce
  moteur existera, sans modifier le comportement d'amendement lui-même.
- **Audit** : `réponse amendée`.
- **Idempotence** : non — chaque appel est un nouvel amendement tracé.

---

## 6. Exécution du diagnostic

### `POST /api/advisory/sessions/:id/run-diagnostic`
- **Corps** : aucun (utilise les réponses déjà enregistrées).
- **Comportement** : exécute le moteur de règles déterministe contre le
  `rule_set` **publié** le plus récent au moment du **premier** appel pour
  cette session (figé ensuite dans `rule_set_version_id`, relectures
  suivantes utilisant la même version) ; produit des
  `advisory_rule_executions` et des `advisory_findings`. Peut être rappelée
  plusieurs fois tant que la session n'est pas `termine` (les réponses
  peuvent évoluer pendant le rendez-vous) — chaque appel ajoute de nouvelles
  exécutions, n'efface pas les précédentes (traçabilité complète du
  raisonnement au fil du rendez-vous).
- **Réponse** : `{ findings: [...], missing_data: [...], warnings: [...] }`.
- **Erreurs** : `409` si la session est `termine` ou `annule`.
- **Idempotence** : non — chaque appel est une nouvelle exécution tracée,
  intentionnellement (l'historique des recalculs fait partie de
  l'explicabilité).
- **Audit** : `exécution diagnostic` (avec le nombre de findings produits).
- **Interdiction explicite** : cette route ne produit **jamais** de
  `advisory_recommendation` à l'état `validee_conseiller` — uniquement des
  `findings` et des recommandations à l'état `envisagee`, proposées au
  conseiller pour arbitrage (voir §7).

---

## 7. Constats et recommandations

### `GET /api/advisory/sessions/:id/findings`
- Liste des constats actifs (et écartés, avec motif) de la session.

### `PUT /api/advisory/findings/:id`
- **Corps** : `{ status: 'ecarte_par_conseiller', discard_reason }`.
- **Validation** : `discard_reason` obligatoire pour écarter un constat —
  jamais d'écartement silencieux.
- **Audit** : `écartement constat`.

### `GET /api/advisory/sessions/:id/recommendations`

### `PUT /api/advisory/recommendations/:id`
- **Corps possibles** :
  - `{ status: 'ecartee', discard_reason }` ;
  - `{ status: 'validee_conseiller' }` — **la seule route qui valide une
    recommandation**, et uniquement si l'appelant est un conseiller
    authentifié (déjà garanti par `requireAuth` : il n'existe aucun autre
    type d'appelant possible dans cette version, donc aucune API séparée
    pour une validation « automatique » ou « par IA » n'existe, et aucune ne
    doit jamais être ajoutée) ; renseigne automatiquement
    `validated_by_user_id`/`validated_at` côté serveur, jamais transmis par
    le client dans le corps de la requête (pour éviter toute usurpation
    d'horodatage/identité).
  - `{ presented_to_client: true }`, `{ client_decision, client_decision_at }`.
- **Audit** : `validation recommandation` / `écartement recommandation` /
  `décision client enregistrée`.
- **Interdiction explicite** : aucune route de ce contrat ne permet à un
  processus automatique (règle, IA) d'écrire directement
  `status = 'validee_conseiller'`. Voir aussi `RULES_ENGINE.md` §5.

---

## 8. Consentements

### `GET /api/advisory/households/:id/consents`
- Liste des consentements actifs et révoqués du foyer.

### `POST /api/advisory/consents`
- **Corps** : `{ household_id, client_id?, session_id?, purpose, granted, text_version, collection_mode }`.
- **Validation** : `purpose` ∈ l'énumération définie dans `DATA_MODEL.md`
  §6.1 ; `text_version` obligatoire et non vide.
- `collected_by_user_id` renseigné automatiquement côté serveur depuis la
  session authentifiée — jamais transmis par le client.
- **Audit** : `recueil consentement` (avec `purpose`, jamais le contenu du
  texte présenté).

### `POST /api/advisory/consents/:id/revoke`
- **Corps** : `{ revoked_reason? }`.
- **Comportement** : renseigne `revoked_at` (horodatage serveur),
  `revoked_by_user_id` (depuis la session authentifiée, jamais transmis par
  le client) et `revoked_reason` sur la ligne existante — **aucun champ posé
  à la création n'est modifié** (voir `DATA_MODEL.md` §6.1). Effet
  uniquement prospectif : ne déclenche par elle-même aucun effacement de
  donnée déjà traitée.
- **Erreurs** : `409` si le consentement est déjà révoqué (`revoked_at` déjà
  renseigné) — pas de double révocation silencieuse.
- **Audit** : `révocation consentement`.
- **Interdiction explicite** : aucune route ne supprime physiquement un
  consentement, ni n'écrase les champs renseignés à sa création.

### `GET /api/advisory/households/:id/ai-assistance-status`
- **Réponse** : `{ consent_granted: boolean, activation_enabled: boolean, effective: boolean }`
  où `effective = consent_granted && activation_enabled` — expose clairement
  le double verrou plutôt que de le cacher dans une seule case à cocher.

---

## 9. Rapports

### `GET /api/advisory/sessions/:id/reports`
- Liste des versions du rapport de la session.

### `POST /api/advisory/sessions/:id/reports`
- **Corps** : `{ kind }`, `kind` ∈ `{brouillon_interne, presentation_client, rapport_final, rapport_corrige}`.
- **Validation** : `rapport_final` ne peut être généré que si la session a
  au moins une recommandation `validee_conseiller` ou une décision explicite
  du conseiller de ne rien recommander (à formaliser en Lot 9) ; `rapport_
  corrige` doit référencer la version qu'il remplace
  (`superseded_by_version_id`) et n'est proposable que si un amendement
  (`POST .../answers/amend`) a été enregistré depuis la version remplacée.
- **Comportement** : fige un `content_snapshot`, jamais recalculé après
  coup. Pour une session `domain = mixed`, le `content_snapshot` **sépare
  explicitement** deux sous-sections (« Assurance Maladie » / « Vie et
  Prévoyance »), chacune construite uniquement à partir des findings et
  recommandations de son propre domaine — jamais une section fusionnée
  (décision GATE LOT 1, point 3.3).
- **Réponse** : `201` `{ id, version_number }`.
- **Audit** : `génération rapport` (avec `kind`).
- **Interdiction explicite** : aucune génération de rapport n'implique
  d'appel à un service externe par défaut (voir `SECURITY_PRIVACY.md`).

### `GET /api/advisory/reports/:id/versions/:versionNumber`
- Contenu figé d'une version précise du rapport.

---

## 10. Mode présentation client

### `GET /api/advisory/sessions/:id/presentation`
- **Réponse** : projection filtrée de la session (composition du foyer,
  objectifs, protections existantes, lacunes, priorités, scénarios comparés,
  budget indicatif, prochaines étapes) — **sans** `internal_notes`, sans
  détail des règles techniques (`advisory_rule_executions`), sans
  `discard_reason` interne, sans référence à d'autres dossiers.
- Utilise la **même fonction de filtrage serveur** que celle qui alimentera
  un futur portail client (voir `ARCHITECTURE.md` §12) — un seul point de
  vérité pour « ce qui est montrable au client ».
- **Audit** : `affichage mode présentation` (pas de contenu, juste l'accès).

---

## 11. Ce que ce contrat exclut explicitement

- Aucune route ne permet à l'intelligence artificielle de créer, modifier ou
  valider directement une `advisory_recommendation`.
- Aucune route de suppression physique de `advisory_consents`,
  `advisory_answers` validées, `advisory_rule_executions` ou
  `advisory_report_versions`.
- Aucune route n'expose de données à un domaine autre que celui de la
  session authentifiée courante (pas de fuite inter-foyers).
- Aucune route de ce contrat ne configure ou n'appelle un serveur MCP — voir
  `MCP_STRATEGY.md` pour le futur point d'extension unique et distinct.
