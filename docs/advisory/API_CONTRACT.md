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
- **Cache** : `Cache-Control: no-store, private` (GATE LOT 3B §7).

### `GET /api/advisory/sessions/:id/answers/history`
- **Paramètres** : `question_id`, `household_member_id?`. Historique complet
  (append-only) d'une question — mode conseiller/audit uniquement.
- **Audit** (GATE LOT 3B §6) : `consultation historique réponse` (session,
  question, membre éventuel, utilisateur — jamais la valeur), **sans**
  déduplication (ouverture ponctuelle, pas rechargée automatiquement comme
  le workspace).
- **Cache** : `Cache-Control: no-store, private`.

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

---

## 7. Constats et recommandations

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
