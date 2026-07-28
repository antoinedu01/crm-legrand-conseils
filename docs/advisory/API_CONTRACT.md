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

### `GET /api/advisory/sessions`
- **Paramètres** : `household_id?`, `status?`, `domain?`.
- **Réponse** : liste des sessions (tableau de bord des diagnostics).

### `POST /api/advisory/sessions`
- **Corps** : `{ household_id, domain, scheduled_at? }`.
- **Validation** : `domain` ∈ `{health, life_pension, mixed}` ; le foyer
  doit exister et être `actif`.
- **Comportement** : fige immédiatement `household_snapshot` (copie de la
  composition actuelle du foyer) et sélectionne la dernière
  `advisory_questionnaire_version` **publiée** pour le(s) domaine(s)
  demandé(s) comme `questionnaire_version_id` par défaut (modifiable tant
  que `status = brouillon`).
- **Réponse** : `201` `{ id }`.
- **Audit** : `création session de diagnostic`.

### `GET /api/advisory/sessions/:id`
- **Réponse** : session + réponses + findings + recommandations +
  consentements liés — la vue complète du mode conseiller.
- **Audit** : `consultation session de diagnostic`.

### `PUT /api/advisory/sessions/:id`
- **Corps** : `{ status?, internal_notes?, meeting_mode?, started_at?, ended_at? }`.
- **Validation** : transitions de statut contrôlées (`brouillon → en_cours →
  termine`, `en_cours ↔ suspendu`, `* → annule`) ; refuse toute
  modification de `household_snapshot`, `questionnaire_version_id` ou
  `rule_set_version_id` une fois `status != brouillon`.
- **Audit** : `modification session de diagnostic` (avec la transition de
  statut en détail, comme le fait déjà `audit()` pour les contrats).

### `POST /api/advisory/sessions/:id/suspend` / `/resume`
- Raccourcis explicites pour la reprise d'une session interrompue, plutôt
  que de passer par un `PUT` générique — plus lisible pour l'audit
  (« rendez-vous interrompu puis repris » demandé dans les spécifications).
- **Idempotence** : `suspend` sur une session déjà `suspendu` ne fait rien
  (`200`, pas d'erreur) ; même logique pour `resume`.
- **Audit** : `suspension session` / `reprise session`.

---

## 4. Questionnaires

### `GET /api/advisory/questionnaires`
- Liste des questionnaires par domaine, avec leur version publiée courante.

### `GET /api/advisory/questionnaires/:code/versions/:versionNumber`
- Structure complète (sections, questions, options) d'une version précise —
  utilisé aussi bien pour une session en cours que pour **relire une
  session passée** avec la version qu'elle a réellement utilisée.
- **Audit** : aucun (lecture de structure, pas de donnée personnelle).

### `POST /api/advisory/questionnaires/:code/versions` *(gestion, conseiller senior / usage interne)*
- Crée une nouvelle version en `brouillon` à partir de la précédente.
- **Hors périmètre d'implémentation immédiate** : cette route suppose un
  éditeur de questionnaire, qui n'est pas un livrable des lots 2 à 9. Elle
  est documentée ici pour la cohérence du modèle, son implémentation réelle
  sera proposée explicitement le moment venu.

### `POST /api/advisory/questionnaires/:code/versions/:versionNumber/publish`
- Passe une version de `brouillon` à `publie` — **irréversible** (une version
  publiée ne redevient jamais brouillon ; toute correction crée une nouvelle
  version). Nécessite confirmation explicite côté interface.
- **Audit** : `publication version questionnaire`.

---

## 5. Réponses

### `GET /api/advisory/sessions/:id/answers`
- Réponses **actives** de la session (`superseded_by_answer_id IS NULL`),
  avec les questions résolues (texte, type) pour affichage. Un paramètre
  `include_superseded=true` peut exposer l'historique complet (mode
  conseiller / audit uniquement, jamais en mode présentation).

### `PUT /api/advisory/sessions/:id/answers`
- **Corps** : `{ answers: [{ question_id, household_member_id?, value, is_unknown?, is_not_applicable? }] }` —
  écriture par lot (le questionnaire s'enregistre au fil de l'eau, pas
  question par question, pour limiter les allers-retours réseau pendant un
  rendez-vous en direct).
- **Validation** : type de `value` conforme à `advisory_questions.type` de
  la version figée, sans coercition automatique (même exigence stricte que
  `contract_lamal.deductible` existant) ; refuse toute réponse pour une
  question non applicable au foyer/membre (condition d'affichage non
  satisfaite) sauf si `is_not_applicable = true`.
- **Comportement** (décision GATE LOT 1, point 3.4) : chaque réponse
  transmise **insère toujours une nouvelle ligne** `advisory_answers` et
  renseigne `superseded_by_answer_id` sur la précédente réponse active du
  même `(question_id, household_member_id)`, le cas échéant — jamais de
  mise à jour en place.
- **Interdiction explicite** : refuse toute écriture si `session.status`
  n'est pas `brouillon` ou `en_cours` (une session `termine` ne peut plus
  recevoir de réponse par cette route — voir `POST .../answers/amend`
  ci-dessous pour le seul cas où une correction reste possible après
  finalisation).
- **Audit** : `enregistrement réponses` (résumé : nombre de réponses, jamais
  le contenu détaillé dans le journal) ; `correction réponse` si au moins
  une réponse transmise en remplaçait une existante.

### `POST /api/advisory/sessions/:id/answers/amend`
- **Objectif** : seule route permettant de corriger une réponse d'une
  session déjà `termine` (décision GATE LOT 1, point 3.4).
- **Corps** : `{ answers: [{ question_id, household_member_id?, value, is_unknown?, is_not_applicable? }], amendment_reason }` —
  `amendment_reason` obligatoire et non vide.
- **Validation** : identique à `PUT .../answers` pour le type et la
  conformité de chaque réponse ; refuse (`400`) si `session.status` n'est
  **pas** `termine` (dans ce cas, c'est `PUT .../answers` qu'il faut
  utiliser).
- **Comportement** : insère les nouvelles réponses avec `is_amendment =
  true` et `amendment_reason` renseigné, renseigne `superseded_by_answer_id`
  sur les réponses remplacées, puis déclenche automatiquement une nouvelle
  exécution du moteur de règles (équivalent d'un appel interne à
  `POST .../run-diagnostic`) — le conseiller n'a pas besoin de l'appeler
  séparément.
- **Réponse** : `{ new_findings: [...], changed: boolean }` — `changed`
  indique si le résultat du diagnostic diffère de la dernière exécution
  connue, signal utilisé par l'interface pour proposer la génération d'un
  `rapport_corrige` (voir `REPORT_SPECIFICATION.md`).
- **Audit** : `amendement réponse (session finalisée)`, avec
  `amendment_reason` en détail.
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
