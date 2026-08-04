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
- **`members`** (ajouté Lot 7B, revue préalable `advisory-architect`) :
  périmètre figé de la session (`sessionMembersFor`, même source que
  `GET .../workspace`), surface minimale — `{id, display_name, member_role,
  historical}` par membre, jamais `client_id`/`current_status` bruts. Sert
  au sélecteur de membres du formulaire de recommandation (`scope =
  member`) sans devoir charger l'arbre complet du questionnaire. Un ancien
  membre (`historical: true`) reste présent — voir `DATA_MODEL.md` §5.5ter,
  un ancien membre du périmètre reste ciblable pour une nouvelle
  recommandation, seul un membre jamais membre de la session ne l'est pas.
  `can_answer` retiré de cette surface (GATE LOT 7B ciblé §11, revue
  compliance-privacy-reviewer) : jamais consommé par le sélecteur de
  membres qui lit cette liste (`SessionRecommendations.jsx`) — à ne pas
  confondre avec `can_answer` du périmètre de travail (`GET .../workspace`
  ci-dessous), lui bien consommé par `SessionWorkspace.jsx` et resté
  inchangé.
- **`recommendation_capabilities`** (ajouté GATE LOT 7B ciblé §2B) :
  `{ create: boolean }` — la disponibilité de la CRÉATION d'une nouvelle
  recommandation est, comme ses transitions (`allowed_actions`, voir
  ci-dessous), une décision métier que le frontend ne doit jamais
  recalculer. Réutilise EXACTEMENT le même prédicat `isSessionWritable`
  (`server/advisorySessions.js`, exporté et partagé avec
  `server/advisoryRecommendations.js` — `assertSessionWritable`,
  `computeAllowedActions` — et `server/advisoryRuleExecutions.js` —
  `actions.can_create_recommendation` sur `GET .../findings-workspace`,
  consommé par `SessionFindings.jsx`) : `session.status === 'completed' &&
  household.status !== 'archive'`, une seule définition, jamais une
  redéfinition divergente entre les trois modules.
- **Audit** : aucun dans ce lot (accès non journalisé, à la différence du
  détail d'un foyer — à revoir si un contenu personnel plus sensible y
  apparaît en Lot 5/6).

### `PUT /api/advisory/sessions/:id`
- **Corps** : `{ title?, scheduled_at?, expected_revision }` uniquement —
  jamais `household_id`, `domain` ni la composition, immuables après
  création. `expected_revision` obligatoire (entier) depuis le GATE LOT 3B,
  voir « Concurrence optimiste » ci-dessous.
- **Réponse** : `{ ok: true, revision }`.
- **Audit** : `session modifiée`.

### Concurrence optimiste (`expected_revision`) — GATE LOT 3B §2

> Le champ `sessions.revision` existait déjà depuis le Lot 3A (incrémenté à
> chaque écriture) mais n'était utilisé par aucune route en contrôle
> d'accès concurrent — un simple jeton côté client ignorait une réponse
> HTTP obsolète, sans empêcher l'écriture obsolète elle-même d'avoir déjà
> modifié la base. Corrigé au GATE LOT 3B.

Toute route d'écriture sur une session (métadonnées, transitions,
réponses, effacement, amendement) exige désormais un `expected_revision`
(entier) dans le corps de la requête :
- Le serveur compare `expected_revision` à la révision réelle courante de
  la session, **avant** toute écriture.
- En cas d'écart : `409` avec un message explicite (« Cette session a été
  modifiée ailleurs depuis votre dernière lecture… ») — **aucune ligne
  n'est écrite, aucun audit de succès n'est produit**.
- En cas de succès : la révision est incrémentée de 1 et retournée dans la
  réponse (`{ ..., revision }`), à utiliser comme `expected_revision` du
  prochain appel.
- `expected_revision` manquant ou non entier : `400`.

Le frontend (`client/src/pages/SessionWorkspace.jsx`) sérialise ses
écritures dans une file unique **par session** (jamais deux requêtes
d'écriture envoyées en parallèle depuis le même onglet) : la révision étant
un compteur global de session (et non par question), deux écritures
concurrentes sur deux questions différentes doivent être envoyées dans
l'ordre réel des intentions du conseiller pour ne jamais déclencher un
conflit de révision entre elles-mêmes. Sur un conflit détecté (autre
onglet, autre appareil), le frontend recharge automatiquement la
projection et affiche un message clair, sans jamais écraser silencieusement
une modification concurrente.

### `GET /api/advisory/sessions/:id/completion-check`
- **Objectif** : prévisualiser la validation de finalisation sans finaliser
  — route de confort pour l'interface (identique à la vérification interne
  de `POST .../complete`).
- **Réponse** : `{ valid, byLink: [{ domain, questionnaire_version_id, missing: [...] }] }`
  — `missing` distingue explicitement les éléments manquants par domaine
  rattaché (`common`/`health`/`life_pension`), jamais une liste globale
  indifférenciée pour une session mixte.

### `GET /api/advisory/sessions/:id/workspace`
> **Implémenté au Lot 3B**, pour l'espace de travail de rendez-vous
> (`client/src/pages/SessionWorkspace.jsx`).

- **Objectif** : projection unique, entièrement résolue côté serveur, prête
  à afficher — le frontend ne réévalue jamais `evaluateCondition`, ne
  détermine jamais lui-même le caractère obligatoire/visible d'une question,
  et ne recalcule jamais la validité de finalisation. Toute cette logique
  reste exclusivement dans `getSessionWorkspace`
  (`server/advisorySessions.js`), qui réutilise à 100 % `getVersionDetail`,
  `evaluateCondition`, `buildAnswerIndex`/`answerValueFor` et le résultat
  déjà calculé par `validateSessionForCompletion` (aucune logique dupliquée).
- **Réponse** :
  ```json
  {
    "session": { "id": 1, "status": "in_progress", "domain": "mixed", "title": "...",
      "scheduled_at": "...", "started_at": "...", "revision": 3, "advisor_name": "..." },
    "household": { "id": 7, "label": null, "primary_display_name": "Jean Dupont",
      "status": "actif", "members": [{ "id": 12, "client_id": 3, "member_role": "principal",
        "display_name": "Jean Dupont", "historical": false, "no_longer_active": false,
        "current_status": "actif", "can_answer": true }] },
    "progress": { "required_total": 6, "required_answered": 4, "complete": false },
    "modules": [{
      "domain": "health", "module_role": "domain", "questionnaire_version_id": 5, "display_order": 2,
      "progress": { "required_total": 4, "required_answered": 2 },
      "sections": [{
        "stable_key": "situation_actuelle", "title": "...", "applies_to": "member", "visible": true,
        "instances": [{ "household_member_id": 12,
          "member": { "id": 12, "display_name": "...", "member_role": "principal",
            "historical": false, "no_longer_active": false, "current_status": "actif", "can_answer": true },
          "questions": [{ "id": 42, "stable_key": "health_notes", "advisor_text": "...", "client_text": null,
            "help_text": "...", "type": "long_text", "scope": "member", "required": true,
            "allows_unknown": true, "allows_not_applicable": true, "sensitive": false, "options": [],
            "visible": true, "answer": { "status": "answered", "value": "..." }, "missing": false,
            "history_available": true }] }] }] }],
    "missing": [{ "domain": "health", "questionnaire_version_id": 5, "missing": [{ "question_id": 42, "stable_key": "..." }] }],
    "actions": { "can_start": false, "can_suspend": true, "can_resume": false, "can_cancel": true,
      "can_complete": true, "can_record_answers": true, "can_amend": false }
  }
  ```
- **Portée membre — décision révisée au GATE LOT 3B §5** (remplace le choix
  initial du Lot 3B qui utilisait toujours les membres vivants) : une
  session encore `draft` reflète les membres actifs actuels (aucun snapshot
  encore figé). Dès `in_progress` et pour toujours ensuite (`suspended`/
  `completed`/`cancelled`), le périmètre est **figé** sur
  `household_snapshot` capturé au démarrage — jamais recalculé sur les
  membres vivants :
  - un membre ajouté au foyer après le démarrage n'apparaît jamais
    rétroactivement dans cette session ;
  - un membre retiré depuis reste visible (`historical: true`,
    `no_longer_active: true`, `can_answer: false`) — jamais supprimé
    silencieusement — et son historique de réponses reste pleinement
    lisible ;
  - `validateSessionForCompletion` utilise le **même** périmètre figé (via
    `sessionMembersFor`), pour que ce qu'affiche le workspace corresponde
    toujours exactement à ce que la finalisation validera réellement — y
    compris un manquant obligatoire jamais résolu pour un membre depuis
    retiré, qui reste compté comme manquant (aucune réduction silencieuse
    du périmètre déjà en vigueur au démarrage).
  - `current_status` reflète le statut réel actuel du membre en base
    (information seule, ne réécrit jamais l'historique de la session).
- **`actions`** : dérivées directement de la machine d'état
  (`TRANSITIONS`/`assertSessionAcceptsAnswers`) — jamais une seconde source
  de vérité que le frontend pourrait laisser diverger. `can_record_answers`
  est `false` pour une session `suspended` (voir GATE LOT 3B §4 sous
  `POST .../suspend` / `/resume` ci-dessous).
- **Champ `sensitive`** (Lot 3B) : première route à consulter ce champ
  préparatoire du Lot 3A — utilisé uniquement pour un badge visuel discret
  côté interface (« Donnée sensible »), sans effet sur la visibilité, la
  validation ou la finalisation.
- **Minimisation** : n'expose jamais de SQL, de statut/section/question
  archivée, ni de données d'un autre foyer ou d'un autre dossier.
- **Audit** : `consultation workspace session` (session, utilisateur,
  révision, statut — jamais de valeur de réponse), **dédupliqué** : au plus
  une ligne par utilisateur et par session sur une fenêtre de 15 minutes
  (`WORKSPACE_VIEW_DEDUP_MINUTES`, `server/advisorySessions.js`) — décision
  révisée au GATE LOT 3B §6 (l'absence totale d'audit décidée initialement
  au Lot 3B n'était pas validée). Les actions d'écriture réelles restent,
  elles, toutes auditées sans déduplication, comme avant.
- **Cache** : `Cache-Control: no-store, private` + `Pragma: no-cache` (GATE
  LOT 3B §7) — jamais mise en cache par le navigateur ni un intermédiaire.
- **Erreurs** : `401` sans session, `404` si la session n'existe pas.

### `POST /api/advisory/sessions/:id/start`
- **Corps** : `{ expected_revision }`.
- **Validation** : machine d'état stricte, indexée par (statut, action) —
  seule la transition `draft → in_progress` est acceptée pour cette action.
- **Comportement** : fige `household_snapshot` (copie de la composition
  actuelle du foyer), horodate `started_at`/`last_activity_at`, incrémente
  `revision`.
- **Réponse** : `{ ok: true, revision }`.
- **Audit** : `session démarrée`.

### `POST /api/advisory/sessions/:id/suspend` / `/resume`
- **Corps** : `{ expected_revision }`.
- **Validation** : `suspend` uniquement depuis `in_progress` ; `resume`
  uniquement depuis `suspended` — **jamais** interchangeables avec `start`
  bien qu'ils ciblent tous deux `in_progress` (bug détecté et corrigé
  pendant l'implémentation : une machine d'état indexée par statut cible
  seul aurait permis à tort de « reprendre » une session en `draft`).
- **Comportement (révisé au GATE LOT 3B §4, décision humaine)** : une
  session `suspended` est réellement mise en pause — elle reste lisible,
  consultable, annulable et reprenable, mais **n'accepte plus aucune
  nouvelle réponse** tant que `resume` n'a pas été appelé explicitement
  (`PUT/DELETE .../answers` refusés en `409`, `actions.can_record_answers
  = false` dans la projection workspace). Avant ce correctif, une session
  suspendue acceptait encore des réponses (comportement du Lot 3A,
  volontairement corrigé). Les réponses déjà enregistrées avant la
  suspension restent conservées et lisibles ; `resume` réactive
  immédiatement la saisie.
- **Erreurs** : `409` sur toute transition hors de la machine d'état.
- **Réponse** : `{ ok: true, revision }`.
- **Audit** : `session suspendue` / `session reprise`.

### `POST /api/advisory/sessions/:id/complete`
- **Corps** : `{ expected_revision }`.
- **Validation** : uniquement depuis `in_progress` ; vérifie que toutes les
  réponses obligatoires **visibles** (conditions d'affichage résolues) de
  **chaque** version rattachée sont présentes (`answered`/`unknown`/
  `not_applicable` — jamais `cleared` ni absente), pour le périmètre de
  membres **figé** (`sessionMembersFor`, voir plus haut) ; une question
  masquée ne bloque jamais la finalisation.
- **Erreurs** : `409` avec `{ missing: [...] }` (même structure que
  `completion-check`) si des réponses obligatoires manquent.
- **Réponse** : `{ ok: true, revision }`.
- **Audit** : `session finalisée`.

### `POST /api/advisory/sessions/:id/cancel`
- **Corps** : `{ expected_revision }`.
- **Validation** : depuis `draft`, `in_progress` ou `suspended` — jamais
  depuis `completed`.
- **Réponse** : `{ ok: true, revision }`.
- **Audit** : `session annulée`.

**Aucune transition sortante n'existe depuis `cancelled`** — une session
annulée ne peut jamais être réouverte.

**`completed` possède UNE SEULE transition sortante, `reopen -> in_progress`
(correctif d'intégrité de la complétude de session)** — jamais atteignable
par une route HTTP dédiée : exclusivement un effet de bord interne de
`POST .../answers/amend` (`amendAnswer`, voir plus bas) quand l'amendement
retire la seule réponse active à une question requise, rendant
`validateSessionForCompletion` invalide. Une session finalisée ne peut donc
toujours pas être réouverte à la demande ni silencieusement — seule une
réponse requise devenue absente déclenche ce retour automatique, toujours
journalisé (`session rouverte (amendement)`, voir `SECURITY_PRIVACY.md`).

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
- **Cache** : `Cache-Control: no-store, private` (GATE LOT 3B §7).

### `GET /api/advisory/sessions/:id/answers/history`
- **Paramètres** : `question_id`, `household_member_id?`. Historique complet
  (append-only) d'une question — mode conseiller/audit uniquement.
- **Audit** (GATE LOT 3B §6) : `consultation historique réponse` (session,
  question, membre éventuel, utilisateur — jamais la valeur), **sans**
  déduplication (ouverture ponctuelle, pas rechargée automatiquement comme
  le workspace).
- **Cache** : `Cache-Control: no-store, private`.
- **Réutilisée telle quelle par la navigation historique par `answer_id`**
  (GATE LOT 4B §2, `client/src/pages/SessionWorkspace.jsx`) — aucune
  nouvelle route créée pour ce besoin. « Voir la réponse source » (espace
  des constats) transmet désormais `{ questionId, memberId, answerId }` via
  l'état de navigation React Router (jamais dans l'URL). Le workspace
  appelle CETTE route avec `questionId`/`memberId` (jamais `answerId`, qui
  ne quitte jamais le navigateur), puis vérifie CÔTÉ CLIENT que l'`answerId`
  annoncé figure bien parmi les lignes renvoyées. La vérification anti-IDOR
  complète (l'answer_id appartient à CETTE session, à CETTE question
  annoncée, à CE membre annoncé) découle directement du filtrage SQL déjà en
  place (`WHERE session_id = ? AND question_id = ? AND household_member_id
  = ?`) : si l'`answerId` n'apparaît pas dans le résultat, c'est qu'il
  n'appartient à aucun des trois — les cas « inexistant » / « autre session
  (même foyer) » / « autre foyer » / « question incohérente » / « membre
  incohérent » sont volontairement indiscernables (aucune information n'est
  utile à distinguer côté appelant), chacun couvert par un test backend/API
  DISTINCT (MICRO-GATE LOT 4B §2, `test/advisory-rule-executions.test.js`,
  `test/advisory-sessions-api.test.js` — détail dans
  `LOT4B_MANUAL_UI_CHECKLIST.md`). Dans ce cas : aucune valeur affichée,
  message neutre exact *« La réponse historique demandée n'est pas
  disponible pour cette session. »* (`SessionWorkspace.jsx`), aucune
  navigation effectuée, aucune requête ni entrée d'audit supplémentaire par
  rapport à un appel « Historique » ordinaire (même action `consultation
  historique réponse`, jamais dupliquée pour ce même geste), et contrat
  HTTP strictement identique (`200`, même forme `{ answers: [...] }`) que
  la ligne demandée soit ou non présente — jamais un statut distinct qui
  permettrait de deviner pourquoi elle est absente.

### `PUT /api/advisory/sessions/:id/answers`
- **Corps** : `{ answers: [{ question_id, household_member_id?, status, value? }], expected_revision }`
  — écriture par lot. `status` ∈ `{answered, unknown, not_applicable, cleared}`
  (remplace les deux booléens `is_unknown`/`is_not_applicable` envisagés en
  LOT 1 — voir `DATA_MODEL.md` §4.6). `expected_revision` obligatoire
  (entier) depuis le GATE LOT 3B §2 — voir « Concurrence optimiste » en §3.
- **Validation** : `household_member_id` doit appartenir au **même** foyer
  que la session (jamais un membre d'un autre foyer, invariant vérifié en
  service, revue `compliance-privacy-reviewer`) ; la question doit
  appartenir à une version rattachée à la session ; le membre doit être
  **actuellement actif** (`409` sinon — GATE LOT 3B §5, un membre historisé
  reste lisible mais ne peut plus recevoir de nouvelle réponse) ; valeur
  conforme au type (`text`/`long_text`/`integer`/`decimal`/`money`/`date`/
  `boolean`/`single_choice`/`multiple_choice`, sans coercition silencieuse,
  aucune option dupliquée pour un choix multiple) ; `unknown` refusé (`400`)
  si la question ne l'autorise pas (`allows_unknown = false`) ;
  `not_applicable` refusé (`400`, correctif final avant premier commit) si
  la question ne l'autorise pas explicitement (`allows_not_applicable =
  false`, valeur par défaut) — ce contrôle est appliqué côté service sur
  tous les chemins d'écriture (`PUT .../answers`, `POST .../answers/amend`),
  jamais uniquement côté interface ; aucune valeur fournie si le statut
  n'est pas `answered`. `cleared` reste un mécanisme technique de
  suppression logique et ne satisfait jamais une question obligatoire à la
  finalisation, quelle que soit la configuration de la question.
- **Comportement** (décision GATE LOT 1, point 3.4) : chaque réponse insère
  toujours une nouvelle ligne et renseigne `superseded_by_answer_id` sur la
  précédente réponse active du même `(question_id, household_member_id)` —
  jamais de mise à jour en place. `sessions.revision` s'incrémente une fois
  par appel (pas par réponse individuelle du lot), après vérification de
  `expected_revision`.
- **Interdiction explicite** : `409` si `session.status` n'est pas `draft`
  ou `in_progress` (une session `suspended` — depuis le GATE LOT 3B §4 —,
  `completed` ou `cancelled` ne peut plus recevoir de réponse par cette
  route).
- **Réponse** : `{ answers: [...], revision }`.
- **Audit** : `réponse enregistrée` (si au moins une nouvelle réponse) et/ou
  `réponse remplacée` (si au moins une réponse existante était remplacée) —
  jamais la valeur, jamais de donnée sensible. Aucun audit produit en cas de
  refus de révision (`409`).

### `DELETE /api/advisory/sessions/:id/answers/:questionId`
- **Corps** : `{ household_member_id?, expected_revision }`.
- **Comportement** : insère une nouvelle ligne `status = cleared` (jamais de
  suppression physique) — une question obligatoire ainsi effacée redevient
  manquante pour la finalisation. Mêmes contraintes que `PUT .../answers`
  (statut de session, membre actif, `expected_revision`).
- **Réponse** : `{ id, revision }`.
- **Audit** : `réponse effacée`.

### `POST /api/advisory/sessions/:id/answers/amend`
- **Objectif** : seule route permettant de corriger une réponse d'une
  session déjà `completed` (décision GATE LOT 1, point 3.4).
- **Corps** : `{ question_id, household_member_id?, status, value?, amendment_reason, expected_revision }`
  — `amendment_reason` obligatoire et non vide.
- **Validation** : `409` si `session.status` n'est pas `completed` (corrigé —
  documenté à tort comme `400` avant ce correctif) ; `400` si
  `amendment_reason` est absent/vide ou si le type/statut de la réponse est
  non conforme (y compris le gating `allows_unknown`/`allows_not_applicable`
  ci-dessus, qui s'applique identiquement à cette route). **N'exige pas**
  que le membre soit actuellement actif (GATE LOT 3B §5) : corriger un
  enregistrement historique reste valide même si le membre concerné n'est
  plus actif aujourd'hui.
- **Comportement** : insère la nouvelle réponse avec `is_amendment = true`,
  jamais de retour en arrière du statut de la session (aucune route de ce
  lot ne rouvre une session finalisée). L'exécution automatique du moteur
  de règles n'existe pas encore (Lot 4) — à ajouter explicitement quand ce
  moteur existera, sans modifier le comportement d'amendement lui-même.
- **Réponse** : `{ id, revision }`.
- **Audit** : `réponse amendée`.
- **Idempotence** : non — chaque appel est un nouvel amendement tracé.
- **Interface (GATE LOT 3B §8)** : chaque question visible et répondue
  d'une session `completed` porte une action contextualisée « Corriger
  cette réponse » (ouvre directement l'amendement de cette question et ce
  membre, sans sélecteur). Le point d'entrée global du header ouvre un
  sélecteur avec recherche textuelle groupée par module/section, jamais un
  `<select>` plat (ne passerait pas à l'échelle avec un questionnaire réel
  de nombreuses questions).

---

## 6. Ensembles de règles et exécution du diagnostic

> **Implémenté au Lot 4A** (`server/routes/advisoryRules.js`, extension de
> `server/routes/advisorySessions.js`, `server/advisoryRules.js`,
> `server/advisoryRuleExecutions.js`). Diverge substantiellement de la
> proposition LOT 1 ci-dessous (route unique `POST .../run-diagnostic`) :
> pas de figeage via une colonne `rule_set_version_id` sur la session (voir
> `DATA_MODEL.md` §3), gestion complète du cycle de vie des règles
> (inexistante dans la proposition initiale, qui ne décrivait que
> l'exécution), et exécution scindée par domaine (`common`, `health` ou
> `life_pension`, jamais `mixed` — une session mixte appelle la route
> jusqu'à trois fois, une par domaine réel).
>
> **GATE LOT 4A, corrections** : domaine `common` désormais accepté partout
> ci-dessous (§2) ; `finding_scope` ajouté au corps de `POST .../rules`
> (§3) ; une exécution finale n'est possible que sur une session déjà
> `completed` — `in_progress` désormais refusé (§9) ; `used_inputs_ref`/
> `inputs_snapshot` portent désormais une classification de sensibilité
> FIGÉE, jamais réévaluée à la lecture (§4) ; `conflicts_detected_at_
> execution` (historique, immuable) distinct de `conflicts_with`/
> `needs_review` (état actif, recalculé à l'écartement, §5).

### `GET /api/advisory/rule-sets`
- **Paramètres** : `domain?`, `status?`, `stable_key?`.
- **Réponse** : liste des ensembles de règles (toutes versions confondues).
- **Audit** : aucun (lecture de liste).

### `POST /api/advisory/rule-sets`
- **Corps** : `{ stable_key, domain, name, description? }`.
- **Validation** : `domain` ∈ `{common, health, life_pension}` — **jamais**
  `mixed` (`400` sinon) ; `stable_key` déjà utilisé (`409`).
- **Réponse** : `201` `{ id, version_number: 1 }`.
- **Audit** : `rule_set créé`.

### `GET /api/advisory/rule-sets/:id`
- **Réponse** : détail de l'ensemble, règles incluses (`conditions`/
  `required_data`/`result_payload`/`warnings`/`contraindications` désérialisés).
- **Erreurs** : `404` si introuvable.

### `POST /api/advisory/rule-sets/:id/versions`
- **Corps** : `{ name?, description?, changelog? }`.
- **Comportement** : nouvelle version brouillon **vide** de la même famille
  (même `stable_key`/`domain`), `version_number` strictement croissant.
  Voir `.../clone` pour repartir du contenu d'une version existante.
- **Réponse** : `201` `{ id, version_number }`.
- **Audit** : `rule_set version créée`.

### `POST /api/advisory/rule-sets/:id/clone`
- **Comportement** : nouvelle version brouillon de la même famille, copiant
  toutes les règles de la version source (clés stables préservées,
  validation réinitialisée — un clone est un nouveau brouillon, jamais déjà
  validé).
- **Réponse** : `201` `{ id }`.
- **Audit** : `rule_set cloné`.

### `POST /api/advisory/rule-sets/:id/archive`
- **Réponse** : `{ ok: true }`. Idempotent.
- **Audit** : `rule_set archivé`.

### `GET /api/advisory/rule-sets/:id/validate`
- **Réponse** : `{ valid, errors: [...], warnings: [...] }` — fonction pure,
  ne modifie rien. `errors` bloque la publication ; `warnings` (doublons de
  conditions strictement identiques, recoupement de catégorie simulé,
  `RULES_ENGINE.md` §4-5) n'empêche jamais la publication, signale
  seulement un point à examiner humainement.
- **Cache** : `Cache-Control: no-store, private`.

### `POST /api/advisory/rule-sets/:id/publish`
- **Validation** : `409` si le rule_set n'est pas `draft` ; `409` avec
  `{ error, errors: [...] }` si `validateRuleSetForPublish` échoue (aucune
  règle active, source/référence/date d'effet/explication manquante sur une
  règle active, dépendance vers une question à texte libre, référence
  inconnue ou circulaire entre règles, profondeur de dépendance excessive,
  clé de `result_payload` hors liste blanche ou évoquant un
  assureur/produit).
- **Comportement** : calcule `content_hash` (empreinte canonique,
  indépendante de l'ordre d'insertion et des identifiants techniques) et
  **stampe** `validated_by_user_id`/`validated_at` sur le rule_set **et**
  sur chaque règle active qu'il contient — c'est l'acte même de validation
  humaine d'une règle (voir `DATA_MODEL.md` §5).
- **Réponse** : `{ ok: true, content_hash, warnings: [...] }`.
- **Audit** : `rule_set publié`.

### `POST /api/advisory/rule-sets/:id/rules`, `PUT .../rules/:ruleId`
- **Corps** : `{ stable_key, title, description?, conditions, required_data,
  result_finding_type, finding_scope?, result_payload?, priority?,
  advisor_explanation, client_explanation?, warnings?, contraindications?,
  source?, source_reference?, effective_from?, effective_until?,
  sort_order, status? }` — `domain` n'est jamais accepté en entrée, toujours
  dérivé du rule_set parent.
- **Validation** : uniquement si le rule_set est `draft` (`409` sinon —
  aucune modification en place d'une règle publiée) ; `conditions` validées
  par `server/advisoryRuleConditions.js` (16 opérateurs, 7 natures de
  référence, aucun `eval`/`new Function`) ; `result_finding_type` ∈ `fact`/
  `detected_need`/`gap`/`warning`/`missing_information`/`solution_category` ;
  `finding_scope` ∈ `session`/`household` (défaut)/`member` (GATE LOT 4A
  §3) — pour `member`, `conditions.op` racine doit être exactement `all` ou
  `any` (rejeté à la publication sinon, jamais à l'enregistrement de la
  règle elle-même) ; `result_payload` restreint à la seule clé
  `category_hint`, filtrée contre une liste noire de termes évoquant un
  assureur/produit précis ; `stable_key` déjà utilisé dans ce rule_set
  (`409`).
- **Réponse** : `201`/`200` `{ id }`.
- **Audit** : `règle créée` / `règle modifiée`.

### `POST /api/advisory/sessions/:id/rule-executions`
- **Corps** : `{ domain, expected_revision, rule_set_id? }` — `domain` ∈
  `{common, health, life_pension}` (jamais `mixed`, même pour une session
  mixte : jusqu'à trois appels distincts, un par domaine réel ; `common`
  accepté sur n'importe quel domaine de session, `health`/`life_pension`
  uniquement sur une session du même domaine réel ou `mixed`).
- **Validation** : domaine compatible avec celui de la session (`409`
  sinon) ; statut de session `completed` **exclusivement** (`409` sinon —
  GATE LOT 4A §9, décision humaine confirmée : `in_progress` — même
  activement suivie — est désormais refusé exactement comme un brouillon,
  une session suspendue ou annulée ; une exécution finale et persistante
  n'a de sens qu'une fois les réponses finalisées) ; foyer non archivé
  (`409` — une NOUVELLE exécution est refusée, mais l'historique déjà
  produit reste pleinement lisible, aucune route de lecture ne vérifiant le
  statut du foyer) ; `expected_revision` obligatoire, doit correspondre à la
  révision réelle (`409` sinon, garde-fou de fraîcheur — n'écrit jamais
  `advisory_sessions.revision`, l'exécution du moteur ne modifie pas la
  session elle-même) ; `rule_set_id` **obligatoire** à la toute première
  exécution de ce couple (session, domaine) (`400` sinon), **ignoré**
  ensuite (le premier rule_set utilisé devient la référence permanente,
  `409` si un `rule_set_id` différent est explicitement fourni par la
  suite — inchangé même si une nouvelle version du même rule_set est
  publiée depuis, GATE LOT 4A §8) ; le rule_set doit être `published`
  (première exécution) ou `published`/`archived` (ré-exécution).
- **Comportement** : évalue chaque règle active et effective à la date du
  jour, dans l'ordre de leurs dépendances (`rule_result`) ; une règle dont
  une donnée requise est absente produit un finding `missing_information`
  (jamais un résultat par défaut) ; supersède l'exécution précédente du même
  couple (session, domaine) et bascule tous ses findings à `superseded` ;
  toute erreur interne inattendue (jamais une erreur métier normale) est
  enregistrée comme une exécution `failed` distincte plutôt que silencieuse.
- **Réponse** : `201` `{ execution_id, rules_evaluated_count, findings_count, findings: [id, ...] }`.
- **Audit** : `exécution lancée` (succès) ou `exécution échouée` (erreur
  interne inattendue).

### `GET /api/advisory/sessions/:id/rule-executions`, `GET .../rule-executions/:executionId`
- **Réponse** : liste (la plus récente en premier) ou détail (exécution +
  `inputs_snapshot` — références résolvables uniquement, jamais une valeur
  de réponse dupliquée — + findings produits). Chaque référence porte
  désormais une classification de sensibilité FIGÉE au moment de
  l'exécution (`sensitivity_at_execution`, `questionnaire_version_id`,
  `read_at`, et pour une réponse l'id immuable `advisory_answers`
  réellement utilisé — GATE LOT 4A §4) : jamais réévaluée à cette lecture,
  quelle que soit la classification actuelle de la question.
- **`findings[].member`** (corrigé GATE LOT 7B ciblé §11, revue
  compliance-privacy-reviewer) : même projection MINIMALE que
  `findings[].member` de `GET .../findings-workspace` ci-dessous —
  `{id, display_name, member_role, historical}`, jamais `client_id`/
  `current_status`/`no_longer_active`/`can_answer`. Cette route reste
  réutilisée telle quelle par `HistoryModal`
  (`client/src/pages/SessionFindings.jsx`), qui rend ses findings via le
  MÊME composant `FindingCard` que l'écran principal — le même défaut de
  sur-exposition que celui déjà corrigé sur `findings-workspace` avait été
  reproduit ici (route distincte, minimisation appliquée séparément et
  jamais partagée avant ce correctif) et n'avait pas été détecté par
  l'audit initial du §6, ciblé uniquement sur `findings-workspace`.
- **Erreurs** : `404` si l'exécution n'appartient pas à cette session (même
  protection que `getQuestionForSession`, Lot 3A).
- **Cache** : `Cache-Control: no-store, private`.
- **Audit dérivé** : `consultation findings sensibles` si au moins une
  référence de la réponse porte `sensitivity_at_execution = true`
  (déduplication 15 minutes) — fondé exclusivement sur ce drapeau figé,
  jamais sur une requête en direct de la sensibilité actuelle de la
  question (correction GATE LOT 4A §7 : cette route ne transmettait
  initialement pas le contexte d'authentification au service, attribuant à
  tort l'audit à un utilisateur générique plutôt qu'au vrai appelant).

### `POST /api/advisory/sessions/:id/analyze`
> **Implémenté au Lot 4B** (`executeApplicableRuleSetsForSession`,
> `server/advisoryRuleExecutions.js`) — orchestration au-dessus de
> `POST .../rule-executions` : lance l'analyse sur **tous les domaines
> applicables** à la session (jusqu'à trois, `common`/`health`/
> `life_pension` selon `allowedExecutionDomainsForSession`) en un seul
> appel conseiller, plutôt que d'exiger un appel manuel par domaine.

- **Corps** : `{ expected_revision }` — jamais de `domain` ni de
  `rule_set_id` : chaque domaine résout lui-même son rule_set applicable
  (celui déjà pinné pour ce couple session/domaine, ou le seul publié le
  cas échéant).
- **Validation** : les préconditions communes à la SESSION (statut
  `completed` exclusivement, foyer non archivé, `expected_revision` à jour)
  sont vérifiées **une seule fois avant toute tentative de domaine** — si
  la session elle-même n'est pas exécutable, l'appel entier est rejeté
  (`400`/`409`), jamais un rejet répété domaine par domaine.
- **Comportement — AUCUNE atomicité globale entre domaines** (décision
  humaine confirmée, GATE LOT 4B §7) : chaque domaine garde sa propre
  transaction indépendante, exactement comme des appels manuels répétés à
  `POST .../rule-executions`. Un échec inattendu sur un domaine
  n'empêche jamais un autre domaine valide de se terminer normalement.
  L'absence d'ensemble de règles publié pour un domaine n'est jamais une
  erreur — c'est un état normal (`skipped_no_published_rule_set`).
- **Réponse** : `201` `{ results: [{ domain, status, execution_id?, findings_count?, error? }, ...] }`
  — `status` ∈ `completed`/`failed`/`skipped_no_published_rule_set`. Un
  `status: 'failed'` porte un `error` **générique** (jamais le détail brut
  d'une erreur interne inattendue — seules les erreurs métier volontaires,
  déjà rédigées pour être lues par un humain, sont transmises telles
  quelles ; le détail réel reste uniquement dans
  `advisory_rule_executions.error_message`, déjà tracé et audité). **Le
  frontend ne doit jamais interpréter un `201` générique comme « analyse
  complète pour tous les domaines » sans lire chaque statut
  individuellement.**
- **Audit** : dérivé de `POST .../rule-executions` pour chaque domaine
  effectivement tenté (`exécution lancée`/`exécution échouée`), aucune
  ligne d'audit distincte pour ce point d'entrée lui-même.

---

## 7. Constats et recommandations

### `GET /api/advisory/sessions/:id/findings-workspace`
> **Implémenté au Lot 4B** (`getSessionFindingsWorkspace`,
> `server/advisoryRuleExecutions.js`), pour l'espace conseiller des
> constats (`client/src/pages/SessionFindings.jsx`) — même principe que
> `GET .../workspace` (Lot 3B) : projection unique, entièrement résolue
> côté serveur, prête à afficher. Le frontend ne recalcule jamais l'état
> d'un domaine, ne re-trie jamais les findings (un filtre est une
> partition stable de l'ordre déjà fourni, jamais un nouveau tri), et ne
> résout jamais lui-même un membre concerné par un finding (toujours via
> `sessionMembersFor`, jamais une lecture directe de `household_members` —
> risque d'IDOR écarté).
- **Objectif** : regrouper STRUCTURELLEMENT les résultats par domaine réel
  (`by_domain: { common?, health?, life_pension? }`, jamais une liste
  interleaved) — rend structurellement impossible un mélange accidentel de
  domaines à l'affichage.
- **Réponse** :
  ```json
  {
    "session": { "id": 1, "status": "completed", "domain": "mixed", "title": "...",
      "revision": 5, "completed_at": "...", "advisor_name": "..." },
    "household": { "id": 7, "label": null, "primary_display_name": "Jean Dupont",
      "status": "actif", "members": [ /* même forme que GET .../workspace */ ] },
    "by_domain": {
      "health": {
        "domain": "health",
        "state": "up_to_date",
        "can_launch": true,
        "has_published_rule_set": true,
        "last_execution": { "id": 42, "ended_at": "...", "session_revision": 5,
          "rules_evaluated_count": 6, "findings_count": 3, "rule_set_id": 9,
          "rule_set_version_number": 2, "content_hash": "...", "engine_version": "4a-1" },
        "last_attempt_failed": false,
        "last_attempt_error": null,
        "findings": [{ "id": 101, "domain": "health", "finding_scope": "member",
          "household_member_id": 12, "member": { "id": 12, "display_name": "...",
            "member_role": "principal", "historical": false },
          "finding_type": "detected_need", "priority": "high", "title": "...", "summary": "...",
          "advisor_explanation": "...", "client_explanation": null, "missing_data": null,
          "warnings": [], "contraindications": [], "status": "active",
          "dismiss_reason": null, "dismissed_by_name": null, "dismissed_at": null,
          "needs_review": false, "conflicts_with": [], "conflicts_detected_at_execution": [],
          "source": "...", "source_reference": "...", "effective_from": "2020-01-01", "effective_until": null,
          "used_inputs_ref": [{ "kind": "answer", "stable_key": "...", "question_id": 42,
            "question_stable_key": "...", "questionnaire_version_id": 3, "section_id": 6,
            "advisor_text": "...", "household_member_id": 12, "answer_id": 987,
            "is_current_answer": true,
            "sensitivity_at_execution": false, "read_at": "..." }] }]
      }
    },
    "global_state": "up_to_date",
    "synthesis": { "active_findings_count": 4, "active_conflicts_count": 0,
      "domains_current": ["health", "life_pension"], "domains_excluded_stale": [] },
    "actions": { "can_launch_analysis": true, "can_dismiss_findings": true, "can_create_recommendation": true }
  }
  ```
- **`actions.can_create_recommendation`** (ajouté GATE LOT 7B ciblé §2B) :
  même prédicat `isSessionWritable` que `recommendation_capabilities.create`
  (`GET .../sessions/:id`) et `assertSessionWritable`/`computeAllowedActions`
  (`server/advisoryRecommendations.js`) — une seule définition partagée,
  consommée par `SessionFindings.jsx` pour masquer ses deux points d'entrée
  vers la création d'une recommandation (bouton par constat, bouton groupé
  de sélection multiple) sans jamais recalculer `household.status` côté
  client.
- **`findings[].member`** (revu GATE LOT 7B ciblé §6, minimisation) : projection
  MINIMALE `{id, display_name, member_role, historical}` — `client_id`
  (identifiant technique interne), `current_status`/`no_longer_active`
  (doublons stricts de `historical`) et `can_answer` (nécessaire ailleurs,
  à `GET .../workspace` pour le statut de réponse d'un membre, sans usage
  sur cet écran) ne sont plus transmis ici : aucun de ces champs n'était
  consommé par `SessionFindings.jsx` (défaut de sur-exposition détecté et
  corrigé pendant l'audit de minimisation de ce GATE).
- **États de domaine** (`by_domain[domaine].state`, TOUJOURS dérivés à la
  lecture, jamais stockés) : `no_rule_set_available` (aucune exécution
  complétée ET aucun ensemble publié — état normal, jamais une erreur) ;
  `not_yet_run` (un ensemble est publié mais aucune exécution n'a encore
  eu lieu) ; `up_to_date` (la dernière exécution complétée porte la
  révision COURANTE de la session) ; `stale` (la session a été amendée
  depuis — une relance est SUGGÉRÉE, jamais automatique, §7.5 : les
  findings affichés restent ceux de la dernière exécution réussie).
  `last_attempt_failed` signale, indépendamment de `state`, qu'un dernier
  lancement a échoué sans jamais masquer les findings de la dernière
  exécution réussie s'il y en a une ; `last_attempt_error` porte alors un
  message MINIMISÉ générique (jamais le contenu brut de
  `advisory_rule_executions.error_message`, potentiellement technique),
  identique qu'il soit lu juste après le lancement (`POST .../analyze`) ou
  relu plus tard sur un rechargement — `null` sinon (GATE LOT 4B §3).
- **`global_state`** (GATE LOT 4B §3, affiné par deux corrections humaines
  successives du MICRO-GATE, `resolveGlobalAnalysisState`) : état agrégé
  calculé sur les domaines REQUIS par le type de session (`health`→`[health]`,
  `life_pension`→`[life_pension]`, `mixed`→`[health, life_pension]`), PLUS
  `common` SI ET SEULEMENT SI un ensemble de règles `common` est
  ACTUELLEMENT publié pour cette session
  (`by_domain.common.has_published_rule_set === true`, une requête `status
  = 'published'` évaluée à la lecture — **jamais** « un ensemble a déjà été
  publié un jour », correction humaine finale explicite : un ensemble
  `common` seulement ARCHIVÉ ne rend jamais ce domaine applicable, même si
  une exécution passée via ce même ensemble reste `up_to_date`/`stale` au
  sens strict de la révision — reproductibilité oblige, une exécution déjà
  pinnée reste valide après archivage de son rule_set, mais cette validité
  historique est désormais délibérément DÉCORRÉLÉE de l'applicabilité
  actuelle). La facultativité de `common` signifie UNIQUEMENT « son absence
  (ou son indisponibilité actuelle) est acceptable » — jamais « un `common`
  ACTUELLEMENT publié peut échouer/être obsolète/rester non exécuté sans
  affecter l'état global » : dès qu'un ensemble `common` publié existe
  MAINTENANT, il pèse EXACTEMENT comme un domaine requis. Valeurs :
  `not_analyzed` (aucun domaine applicable jamais complété ni en échec) ;
  `up_to_date` (tous les domaines applicables à jour, aucune tentative
  récente en échec) ; `partial` (au moins un domaine applicable exploitable
  pendant qu'un autre a échoué, n'a jamais été équipé, n'a jamais été lancé,
  ou reste obsolète alors qu'un autre est à jour — un mélange à jour/obsolète
  n'est jamais présenté comme uniformément « obsolète ») ; `stale` (tous
  exploitables, aucun échec, mais AUCUN n'est à jour — tous obsolètes) ;
  `unavailable` (aucun domaine applicable jamais équipé d'un ensemble de
  règles) ; `error` (aucun domaine applicable exploitable ET au moins une
  tentative en échec). Priorité stricte, une seule règle s'applique à la
  fois — jamais recalculé différemment côté client.
- **`synthesis`** (GATE LOT 4B §3) : totalise les findings ACTIFS
  UNIQUEMENT des domaines EUX-MÊMES à jour (`domains_current`) — un domaine
  obsolète (`domains_excluded_stale`, seulement s'il porte au moins un
  finding) reste consultable dans son propre onglet (`by_domain[d].findings`
  n'est jamais vidé) mais n'est jamais additionné dans ce total, pour ne
  jamais mélanger silencieusement des findings issus de révisions
  différentes dans un même chiffre. Porte sur TOUS les domaines applicables
  (`common` inclus s'il est lui-même à jour) — distinct de `global_state`
  ci-dessus, qui ne regarde que les domaines requis.
- **Hydratation groupée** (jamais une requête par finding) : `source`/
  `source_reference`/`effective_from`/`effective_until` (vivent uniquement
  sur `advisory_rules`, jamais dupliqués sur le finding) ; `dismissed_by_
  name` ; et pour chaque référence `used_inputs_ref` de type `answer` :
  `advisor_text` (texte de la question, pour que le panneau de traçabilité
  affiche un intitulé lisible, jamais seulement un identifiant technique
  brut) ; `question_stable_key` (alias explicite de `stable_key`) ;
  `section_id` (retrouver la section sans requête supplémentaire) ;
  `is_current_answer` (GATE LOT 4B §2 — la ligne `answer_id` désigne-t-elle
  encore la réponse ACTIVE de `advisory_answers` pour ce couple
  question/membre ? `null` quand `answer_id` est lui-même absent). Ces
  quatre champs sont TOUS dérivés à la lecture, jamais dupliqués dans le
  JSON figé `used_inputs_ref` stocké en base (qui reste la trace immuable
  écrite à l'exécution). Jamais une valeur de réponse : la seule façon de
  consulter une valeur reste `GET .../workspace`, déjà audité et déjà
  respectueux de la classification de sensibilité figée.
- **Cache** : `Cache-Control: no-store, private`.
- **Audit** : `consultation espace constats session` (déduplication 15
  minutes, fenêtre et politique distinctes de `consultation workspace
  session` — écran différent, jamais la même ligne de traçabilité) ; audit
  dérivé `consultation findings sensibles` si au moins une référence
  retournée porte `sensitivity_at_execution = true` (même politique que
  les 4 routes de lecture du Lot 4A).

### `GET /api/advisory/sessions/:id/findings`
- **Implémenté au Lot 4A.** Liste des findings **actifs** (`status =
  'active'`) de la dernière exécution non supersédée, triés par priorité
  puis ordre d'auteur. `domain?` en paramètre optionnel. Chaque finding
  porte `finding_scope` (`session`/`household`/`member`, GATE LOT 4A §3) et
  `household_member_id` (obligatoire seulement si `finding_scope =
  member` — un finding distinct par membre réellement concerné, jamais une
  attribution arbitraire ; toujours `NULL` sinon), ainsi que
  `conflicts_with`/`needs_review` (état ACTIF courant, recalculé à chaque
  écartement d'un finding en conflit, GATE LOT 4A §5) et
  `conflicts_detected_at_execution` (constat HISTORIQUE et immuable du
  recoupement à la production de l'exécution, jamais réécrit ensuite).
- **Cache** : `Cache-Control: no-store, private`.
- **Audit dérivé** : si au moins une réponse effectivement utilisée par un
  finding retourné porte `sensitivity_at_execution = true` (classification
  FIGÉE à l'exécution, jamais réévaluée ici, GATE LOT 4A §4), journalise
  `consultation findings sensibles` (déduplication 15 minutes, même
  politique que `consultation workspace session`, GATE LOT 3B §6).

### `GET /api/advisory/sessions/:id/findings/history`
- **Implémenté au Lot 4A.** Historique complet (tous statuts, toutes
  exécutions) — toujours journalisé (`consultation historique findings`,
  sans déduplication).

### `POST /api/advisory/sessions/:id/findings/:findingId/dismiss`
- **Implémenté au Lot 4A** (remplace la proposition initiale `PUT
  /api/advisory/findings/:id`). **Corps** : `{ dismiss_reason, expected_revision }`.
- **Validation** : `dismiss_reason` obligatoire et non vide (`400` sinon) ;
  seul un finding `status = 'active'` peut être écarté (`409` sinon —
  jamais un finding déjà écarté ou déjà supersédé) ; `404` si le finding
  n'appartient pas à cette session.
- **Comportement (GATE LOT 4A §5)** : le finding passe à `status =
  'dismissed'` (jamais supprimé, reste consultable en historique) ; les
  `conflicts_with`/`needs_review` des AUTRES findings encore actifs de la
  même exécution sont recalculés pour ne plus référencer que des findings
  encore actifs — un finding restant ne garde `needs_review = true` que
  s'il conflicte encore avec un autre finding actif. `conflicts_detected_
  at_execution` (constat historique du recoupement initial) n'est, lui,
  jamais modifié.
- **Audit** : `finding écarté`.

> **Statut d'implémentation (Lot 7A, backend uniquement — aucune interface,
> voir Lot 7B).** Les routes ci-dessous remplacent intégralement la
> proposition LOT 1 (`PUT /api/advisory/recommendations/:id` unique avec
> `status`/`discard_reason`/`presented_to_client`/`client_decision`) —
> divergence substantielle documentée dans `DATA_MODEL.md` §5.5. Toutes :
> `requireAuth` hérité (montage `server/app.js`), CSRF sur écriture (middleware
> global `/api`), auditées, `Cache-Control: no-store, private` en lecture,
> protection IDOR (recommandation vérifiée appartenir à la session déduite —
> `404` sinon, jamais un `500`).
>
> **Noms d'auteur (ajouté Lot 7B, revue préalable `advisory-architect`)** :
> chaque route de lecture ET d'écriture ci-dessous ajoute désormais
> `created_by_name`/`validated_by_name`/`dismissed_by_name`/
> `withdrawn_by_name` à côté des `*_user_id` déjà présents (jamais en
> remplacement), résolus par lot via `hydrateRecommendationNames` — même
> pattern que `dismissed_by_name` pour les findings
> (`server/advisoryRuleExecutions.js`, `hydrateFindingRows`). `null` quand
> l'action correspondante n'a pas encore eu lieu.
>
> **`allowed_actions` (ajouté GATE LOT 7B ciblé)** : chaque route de lecture
> ET d'écriture ci-dessous ajoute désormais un objet `allowed_actions` —
> `{ edit, validate, dismiss, withdraw, replace, link_finding,
> unlink_finding, link_member, unlink_member }` (booléens) — calculé
> EXCLUSIVEMENT côté serveur (`computeAllowedActions`,
> `server/advisoryRecommendations.js`), reflet exact des gardes déjà
> imposés par chaque route d'écriture correspondante
> (`assertSessionWritable` + `assertDraftMutable`/`assertAction` via
> `TRANSITIONS`) — jamais une redéfinition divergente. Élimine la
> duplication frontend de ces transitions (`status === 'draft'`,
> `status === 'validated'`, `household.status === 'archive'`), jusque-là
> recalculées indépendamment dans `SessionRecommendations.jsx`. Additif et
> minimal : reflète uniquement l'éligibilité par statut, jamais une
> prédiction de succès pour un corps de requête donné — chaque route
> revalide intégralement à l'appel. Ne couvre pas la CRÉATION d'une
> nouvelle recommandation (propriété de la session/du foyer, pas d'une
> ligne recommandation existante) — cette capacité est couverte séparément
> par `recommendation_capabilities.create` (`GET .../sessions/:id`, §2B
> ci-dessus) et par `actions.can_create_recommendation` (`GET
> .../findings-workspace`), jamais recalculée côté page. `link_member`/
> `unlink_member` exigent en plus `scope === 'member'` (corrigé GATE LOT 7B
> ciblé §11, revue advisory-architect — absent jusque-là, un brouillon
> `scope = household`/`session` affichait ces deux actions comme
> disponibles alors que `linkMember`/`unlinkMember` les auraient rejetées) :
> reflet exact des gardes serveur réelles
> (`assert(rec.scope === 'member', ...)`). `replace` exige en plus
> l'absence d'un remplacement déjà actif -- non `dismissed` -- sur cette
> recommandation (correctif GATE LOT 7B correction round, revue
> `advisory-architect` -- absent jusque-là, `replace` valait `isValidated`
> seul, le bouton « Créer une nouvelle version » restait affiché même
> quand `POST .../replacement` aurait rejeté la tentative en 409) : reflet
> exact du même contrôle bloquant (`activeSuccessorOf`,
> `server/advisoryRecommendations.js`).
>
> **Codes d'erreur machine (ajouté GATE LOT 7B ciblé §3)** : la distinction
> entre différents conflits ne doit jamais dépendre du texte français de
> `error` (susceptible d'être reformulé) — chaque réponse d'erreur émise
> par ce groupe de routes porte désormais, en plus de `error`, un champ
> `code` optionnel dès que la situation correspond à l'une des suivantes
> (`server/advisoryRecommendations.js`, `ERROR_CODES`) :
>
> | `code` | Situation | Statut HTTP |
> |---|---|---|
> | `RECOMMENDATION_REVISION_CONFLICT` | `expected_recommendation_revision` ne correspond plus à la révision réelle | 409 |
> | `SESSION_REVISION_CONFLICT` | `expected_session_revision` ne correspond plus à la révision réelle (validation uniquement) | 409 |
> | `RECOMMENDATION_STATE_CONFLICT` | Transition impossible depuis le statut courant (`assertAction`/`TRANSITIONS`), ou écriture tentée sur une recommandation qui n'est plus `draft` (`assertDraftMutable`) | 409 |
> | `SESSION_NOT_WRITABLE` | La session n'est pas `completed` | 409 |
> | `HOUSEHOLD_ARCHIVED` | Le foyer est `archive` | 409 |
>
> Format de réponse :
> ```json
> { "error": "Cette recommandation a été modifiée ailleurs depuis votre dernière lecture (révision attendue 3, révision réelle 4). Rechargez avant de réessayer.",
>   "code": "RECOMMENDATION_REVISION_CONFLICT" }
> ```
> `code` est **absent** (jamais une valeur inventée) pour les situations non
> couvertes par cette liste (ex. finding non actif au moment de la
> validation, finding hors du bon domaine, remplacement déjà en cours) —
> ces cas restent, pour l'instant, distingués uniquement par `error` et par
> le statut HTTP ; aucun code n'a été inventé pour une situation non
> demandée par ce GATE, conformément à la consigne « éviter de créer
> plusieurs codes pour une même situation ». `SessionRecommendations.jsx`
> (`ValidateModal`, `save()`, `unlinkFinding()`) distingue désormais ces
> conflits sur `err.data.code`, jamais plus sur une correspondance de texte
> (`err.message`).

### `GET /api/advisory/sessions/:id/recommendations`
- Liste des recommandations de la session (filtre `domain?`/`status?`
  optionnel). Chaque élément porte `finding_ids`, `member_ids`, et
  `potentially_stale` (dérivé à la lecture, jamais stocké).
- **Filtre `domain`** : facultatif ; si transmis, accepte exclusivement
  `common` | `health` | `life_pension` (même énumération que la création,
  validation centralisée `assertValidDomainFilter`, jamais dupliquée entre
  les routes) — toute autre valeur est refusée en `400` **avant** toute
  utilisation en SQL, en projection ou en audit : aucune normalisation
  silencieuse vers « absent », aucune chaîne libre jamais inscrite dans
  `audit_log.details`.
- **Audit** : `consultation recommandations session` (déduplication 15
  minutes) ; `consultation recommandations sensibles` dérivé si au moins une
  recommandation cite un finding dont la sensibilité a été figée à
  l'exécution (`used_inputs_ref[].sensitivity_at_execution = true`),
  indépendamment du statut courant de ce finding.

### `POST /api/advisory/sessions/:id/recommendations`
- **Corps** : `{ domain, scope, title, advisor_rationale, member_ids?, finding_ids?, ...champs narratifs facultatifs }`.
- Crée un brouillon (`status = 'draft'`, `revision = 1`). Exige une session
  `completed` (même garantie structurelle qu'une exécution finale du
  moteur, Lot 4A) et un foyer non archivé.
- **Audit** : `recommandation créée`.

### `GET /api/advisory/sessions/:id/recommendations/history`
- Historique complet, tous statuts, `id DESC` — toujours journalisé, jamais
  dédupliqué (même convention que `GET .../findings/history`).
- **Filtre `domain`** : même politique stricte que la liste ci-dessus
  (`common` | `health` | `life_pension` uniquement, facultatif, `400` sinon,
  validé avant SQL/audit).
- **Audit** : `consultation historique recommandations` (sans déduplication).

### `GET /api/advisory/recommendations/:id`
- Détail d'une recommandation (`session_id` dérivé de la ligne elle-même,
  revérifié par le service — routes adressées directement par id, sans
  session dans l'URL, chemin adapté par rapport à la proposition initiale
  et documenté ici).

### `PUT /api/advisory/recommendations/:id`
- **Corps** : `{ expected_recommendation_revision, ...tout champ narratif/scope/member_ids/domain à modifier }`.
- Modifie un brouillon (`409` si non `draft`). Portée et liste de membres
  modifiables atomiquement en un seul appel (`scope`+`member_ids` toujours
  transmis ensemble — jamais un retrait implicite). Une seule
  incrémentation de `revision` même pour une mutation regroupant plusieurs
  aspects.
- **Audit** : `recommandation modifiée`.

### `POST /api/advisory/recommendations/:id/findings` / `DELETE .../findings/:findingId`
- **Corps** : `{ finding_id?, expected_recommendation_revision }`.
- Le finding doit appartenir à la même session et au même domaine que la
  recommandation ; pour `scope = member`, un finding `finding_scope =
  member` doit concerner l'un des membres explicitement ciblés (`409`
  sinon — jamais un finding concernant une autre personne que celles
  visées).
- **Audit** : `finding lié` / `finding délié`.

### `POST /api/advisory/recommendations/:id/members` / `DELETE .../members/:memberId`
- **Corps** : `{ household_member_id?, expected_recommendation_revision }`.
- Limité à `scope = member` ; le membre doit appartenir au
  `household_snapshot` figé de la session ; retrait du dernier membre ciblé
  refusé (`400`).
- **Audit** : `membre lié` / `membre délié`.

### `POST /api/advisory/recommendations/:id/validate`
- **Corps** : `{ expected_recommendation_revision, expected_session_revision }`.
- **La seule route qui valide une recommandation**, uniquement si
  l'appelant est un conseiller authentifié (aucun autre type d'appelant
  possible, aucune API séparée pour une validation automatique ou par IA).
  Vérifie dans une transaction unique : révisions (recommandation et
  session), champs narratifs obligatoires, portée valide, au moins un
  finding source, et que chaque finding lié est `active`, issu d'une
  exécution `completed` de la révision COURANTE de la session, non
  `dismissed`, non `superseded`. Tout échec → `409`, rien n'est écrit,
  aucun audit de succès. Renseigne automatiquement
  `validated_by_user_id`/`validated_at`/`validated_session_revision` côté
  serveur, jamais transmis par le client. Si la recommandation remplace une
  autre (`supersedes_recommendation_id`), bascule atomiquement l'ancienne
  vers `superseded` dans la même transaction.
- **Audit** : `recommandation validée` (+ `recommandation remplacée` si une
  supersession a eu lieu).

### `POST /api/advisory/recommendations/:id/dismiss`
- **Corps** : `{ dismiss_reason, expected_recommendation_revision }`. Brouillon
  uniquement (`409` sinon), motif obligatoire.
- **Audit** : `recommandation écartée`.

### `POST /api/advisory/recommendations/:id/withdraw`
- **Corps** : `{ withdraw_reason, expected_recommendation_revision }`.
  Recommandation `validated` uniquement, motif obligatoire. Contenu
  narratif historique jamais modifié.
- **Audit** : `recommandation retirée`.

### `POST /api/advisory/recommendations/:id/replacement`
- **Corps** : `{ expected_source_recommendation_revision, title, advisor_rationale, scope, member_ids?, finding_ids?, ...champs narratifs facultatifs }`.
- Crée un brouillon de remplacement (`supersedes_recommendation_id` fixé,
  domaine hérité de la source). Source doit être `validated`, révision
  attendue conforme, aucun autre successeur non-`dismissed` déjà actif
  (`409` sinon — garanti au niveau SQLite par un index UNIQUE PARTIEL,
  `docs/MIGRATIONS.md` version 12). Un premier brouillon de remplacement
  écarté (`dismissed`) libère la possibilité d'un nouvel essai.
- `finding_ids` (correctif GATE LOT 7B, correction round pré-commit) : mêmes
  contrôles que `POST .../sessions/:id/recommendations` (cohérence de
  domaine via un constat de la session/du domaine de la source, cohérence
  membre via `assertFindingMemberCoherence`), liés dans la même transaction
  que la création. Facultatif — un remplacement créé sans `finding_ids`
  reste un brouillon sans constat lié (même comportement historique), mais
  ne pourra pas être validé tant qu'au moins un constat n'est pas lié (voir
  `POST .../:id/findings` ci-dessous).
- **Audit** : `recommandation créée`.

**Interdiction explicite** : aucune route de ce contrat ne permet à un
processus automatique (règle, moteur, IA) d'écrire directement `status =
'validated'`, de choisir un finding source, ou de renseigner
automatiquement une justification. Voir aussi `RULES_ENGINE.md` §5, §9.
**Hors périmètre de ce lot** (Lot 7B/9/11) : décision client, présentation
client, produit, assureur, rapport, catégorie de conseil (`category`).

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

## 12. Rétention des données (Legrand Diagnostic 360)

Voir `DATA_RETENTION.md` pour le détail complet des catégories, critères
d'éligibilité et conditions d'activation. Toutes les routes ci-dessous sont
montées sous `/api/advisory/retention` et protégées par `requireAuth`.

### `GET /api/advisory/retention/policies`
- Liste des 5 politiques de conservation (catégorie, état actif/inactif,
  durée proposée, description). Réponse jamais mise en cache (`no-store`).

### `GET /api/advisory/retention/config`
- Configuration globale (`real_purge_enabled`) — désactivée par défaut.

### `GET /api/advisory/retention/households/:householdId/legal-holds`
- Historique complet des legal holds du foyer (actifs et levés).

### `POST /api/advisory/retention/households/:householdId/legal-holds`
- **Corps** : `{ reason }`, obligatoire et non vide.
- **Erreurs** : `404` si le foyer n'existe pas ; `409` si un hold est déjà
  actif pour ce foyer (un seul hold actif à la fois, en poser un second
  exige de lever explicitement le premier).
- **Audit** : `legal hold posé` (jamais le motif en clair dans l'entrée
  d'audit elle-même, uniquement l'identifiant du hold).

### `POST /api/advisory/retention/households/:householdId/legal-holds/:holdId/lift`
- **Corps** : `{ ended_reason }`, obligatoire et non vide.
- **Erreurs** : `404` si le hold n'existe pas pour ce foyer ; `409` s'il est
  déjà levé.
- **Comportement** : renseigne `ended_at`/`ended_by_user_id`/`ended_reason`
  sur la même ligne — origine (motif/auteur/date de création) jamais
  réécrite.
- **Audit** : `legal hold levé`.

### `POST /api/advisory/retention/dry-run`
- **Simulation uniquement** — calcule l'éligibilité de chaque dossier,
  écrit exclusivement dans les tables de rapport
  (`advisory_retention_purge_runs`/`_purge_run_items`), **jamais** dans le
  contenu de diagnostic. Réponse `201` avec le rapport complet.
- **Audit** : `simulation de rétention exécutée (dry-run)`.
- **Interdiction explicite** : aucune route de purge réelle n'existe dans
  ce lot — `executePurge` (`server/advisoryRetention.js`) n'est appelé par
  aucun chemin HTTP, uniquement par les tests dédiés sur base temporaire.

### `GET /api/advisory/retention/purge-runs`
- Historique des simulations, filtrable par `?run_type=dry_run` (seule
  valeur jamais produite par une route de ce lot).

### `GET /api/advisory/retention/purge-runs/:runId`
- Détail d'une simulation : identifiants technique par dossier, catégorie,
  raison d'éligibilité, échéance, statut legal hold, action envisagée,
  compteurs de lignes par table (`rows_affected_summary`) — jamais de
  valeur de réponse, donnée de santé/financière ou nom complet.
- **Erreurs** : `404` si l'exécution n'existe pas.

---

## 13. Ce que ce contrat exclut explicitement

- Aucune route ne permet à l'intelligence artificielle de créer, modifier ou
  valider directement une `advisory_recommendation`.
- Aucune route de suppression physique de `advisory_consents`,
  `advisory_answers` validées, `advisory_rule_executions` ou
  `advisory_report_versions`.
- Aucune route n'expose de données à un domaine autre que celui de la
  session authentifiée courante (pas de fuite inter-foyers).
- Aucune route de ce contrat ne configure ou n'appelle un serveur MCP — voir
  `MCP_STRATEGY.md` pour le futur point d'extension unique et distinct.
- Aucune route de purge réelle des données de diagnostic (§12) — le moteur
  existe et est testé, mais reste volontairement non exposé par ce lot.
