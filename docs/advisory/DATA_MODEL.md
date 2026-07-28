# Modèle de données — Legrand Diagnostic 360

> **Statut : proposition de conception (LOT 1).** Aucune de ces tables n'existe.
> Aucun SQL définitif n'est fourni volontairement — ce document décrit la forme
> logique (champs, types, contraintes, relations) pour permettre une revue
> humaine avant toute écriture de migration. La migration réelle sera proposée
> en LOT 2, sous une version `PRAGMA user_version` déterminée **au moment de
> l'implémentation**, après nouvelle vérification de la version courante et des
> branches éventuellement fusionnées entre-temps (voir §0).

## 0. Rappels de cadrage

- Aucune table ci-dessous n'est créée pendant le LOT 1.
- Le numéro de migration n'est **pas** fixé à 9. À déterminer au moment de
  l'implémentation via `db.pragma('user_version', { simple: true })` et une
  vérification des branches fusionnées depuis l'audit LOT 0.
- Toutes les nouvelles tables vivent dans un espace de nommage dédié : préfixe
  `advisory_`, sauf `households` et `household_members` qui forment un socle
  transverse (utilisé par les deux parcours, pas propre à un domaine).
- Principe directeur : **lire et référencer**, jamais dupliquer, les données
  déjà portées par `clients`, `contracts` et les tables spécialisées de
  contrat (migration v8).

## 1. Tables existantes à étudier (lecture seule, aucune modification proposée)

### 1.1 `clients`

**Constat précis des contraintes actuelles** (vérifié dans `server/db.js` et
`server/routes/clients.js`, pas supposé) :

- Aucune contrainte `NOT NULL` en base sur `email`, `phone`, `address`, `npa`,
  `city`, `canton`, `profession`, `birth_date`, `avs_number` — tous nullables
  dès aujourd'hui.
- Le seul champ obligatoire **au niveau applicatif** (pas en base) est un nom :
  `POST /api/clients` exige `first_name` **ou** `last_name` **ou**
  `company_name`. Rien n'exige `email`/`phone`/`profession`.
- `status` est une colonne `TEXT NOT NULL DEFAULT 'prospect'` **sans `CHECK`
  en base** — l'énumération `['prospect', 'client', 'ancien', 'anonymise']`
  n'est imposée qu'en applicatif (`CLIENT_STATUSES` dans
  `server/routes/clients.js`).
- `consent_data`, `mandate_signed`, `info_lsa_date` sont tous optionnels /
  à `0` par défaut.
- Aucune contrainte d'unicité sur `email`/`phone` (seulement des index non
  uniques utilisés pour une détection de doublons applicative,
  `findDuplicates()`).

**Conséquence pour le foyer** : représenter un enfant comme une ligne
`clients` minimale (prénom, nom, date de naissance) est **déjà possible avec
le schéma actuel, sans aucune migration**. Ce n'est donc pas un chantier de
LOT 2 sur `clients` lui-même, mais sur la **construction du foyer autour**.

**Décision humaine validée (GATE LOT 1, point 3.1)** : pour cette première
version, `clients.status` **ne reçoit aucune nouvelle valeur** et
`clients` **n'est pas modifié**. La place d'une personne dans le foyer
(y compris « personne à charge, non prospect commercial ») est portée
exclusivement par `household_members.member_role` (voir §2.2 — champ
renommé `member_role` pour éviter toute ambiguïté avec un futur rôle
d'accès/permission). Un enfant reste par défaut `clients.status =
'prospect'` (valeur actuelle inchangée) ; l'interface distingue
explicitement, à l'affichage, « membre du foyer » (toute personne d'un
`household_members`) de « client principal » (la personne portant
`household_members.member_role = 'principal'`), sans que cela ne repose sur
`clients.status` (voir `UX_AND_CLIENT_MODE.md` §1.3). Toute évolution future
de `clients.status` devra être proposée et justifiée séparément, hors de ce
module.

**Décision humaine validée (GATE LOT 1, décision 1 — appartenance à
plusieurs foyers)** : une personne peut appartenir à plusieurs foyers actifs
en même temps (parents séparés, garde alternée, famille recomposée,
personne à charge rattachée à plusieurs contextes). **Aucune contrainte
globale n'interdit** qu'un même `clients.id` apparaisse dans plusieurs
`household_members` actifs simultanément — une personne reste toujours une
**seule** ligne `clients` (jamais dupliquée), voir §2.2 pour le détail des
règles retenues.

**Décision humaine validée (GATE LOT 1, décision 2 — protection contre les
doublons)** : `findDuplicates()` (email/phone, mécanisme existant de
`clients.js`, hors périmètre de ce module) reste inchangé et continue de ne
rien signaler pour une personne sans email ni téléphone (cas courant d'un
enfant) — **ce n'est pas un défaut à corriger**. En complément, ce module
prévoit sa propre **détection souple de doublons entre personnes**,
utilisant des critères plus riches (prénom/nom normalisés, date de
naissance, foyer, représentant légal, adresse, relation familiale),
purement indicative pour le conseiller, jamais bloquante et jamais fondée
sur une contrainte d'unicité automatique — voir §2.3 pour le principe
complet (algorithme non implémenté avant le Lot 2).

**Aucune migration sur `clients` n'est proposée dans ce document.**

### 1.2 `contracts` + tables spécialisées (migration v8)

`contracts`, `contract_lamal`, `contract_lca`, `contract_life`,
`contract_income_protection`, `contract_lpp_ijm` sont **lues seules** par le
moteur de règles pour établir les « protections existantes » d'une personne
(via `contracts.client_id`). Aucune donnée de prime, de franchise, de capital
assuré n'est dupliquée dans les tables `advisory_*` : le moteur y fait
référence par identifiant (`contract_id`), jamais par recopie de valeur
métier.

**Décision humaine validée (GATE LOT 1, point 3.6)** : pour l'explicabilité
(« pourquoi cette conclusion »), le moteur peut conserver, dans
`advisory_rule_executions.inputs_snapshot` (voir §5.3), un **instantané
minimal et immuable** des seules données effectivement utilisées par une
règle — jamais le contrat complet. Cet instantané n'est pas une duplication
de la donnée de référence (`contracts` reste l'unique source de vérité) mais
une preuve d'audit, sur le même principe que la table existante
`contract_history` (qui stocke déjà `old_value`/`new_value` à des fins
d'audit sans être elle-même la source de vérité). Voir §5.3 pour la
structure précise retenue.

`contract_coverages`, `contract_beneficiaries`, `contract_history` existent
mais ne sont, à ce jour, exploitées par aucune route ni interface (cf.
`docs/CONTRATS_ASSURANCE_SUISSE.md`). Le module Diagnostic 360 peut les lire
si utile (ex. `contract_beneficiaries` pour vérifier une désignation
bénéficiaire existante côté Vie), mais ne les modifie pas.

**Non-duplication entre foyers (décision GATE LOT 1, décision 1, point 8)** :
`contracts.client_id` reste l'unique lien entre un contrat et une personne,
indépendamment du nombre de foyers actifs auxquels cette personne
appartient. Quand une même personne est membre de plusieurs foyers, le
moteur de règles lit ses contrats **une seule fois par
`client_id`**, jamais une copie par foyer — aucune table `advisory_*` ne
duplique jamais un contrat.

### 1.3 `audit_log`

Réutilisée telle quelle. Le module ajoute de nouvelles valeurs de `action` et
`entity` (ex. `entity = 'advisory_session'`, `action = 'création session de
diagnostic'`) via la fonction existante `audit()` (`server/audit.js`), sans
modification de son code ni de son schéma.

### 1.4 `consents`

**Non réutilisée, non modifiée** (décision humaine validée en LOT 0). Cette
table reste strictement liée aux formulaires publics du site
(`kind = 'site_form'`) et aux prospects entrants. Le nouveau consentement de
diagnostic vit dans `advisory_consents` (§3), avec un cycle de vie, des
finalités et des acteurs différents (personne authentifiée en rendez-vous vs
visiteur anonyme d'un formulaire web).

---

## 2. Socle commun : foyer et personnes

### 2.1 `households`

**Objectif** : représenter le foyer (l'unité d'analyse du rendez-vous), sans
dupliquer les informations de contact ou d'adresse déjà portées par
`clients`.

| Champ | Type logique | Nullable | Contraintes |
|---|---|---|---|
| `id` | entier | non | clé primaire |
| `label` | texte court | oui | nom d'usage interne du dossier (ex. « Foyer Moret–Ricci »), jamais affiché tel quel au client |
| `primary_client_id` | référence → `clients.id` | non | le contact principal du foyer (doit aussi exister comme `household_members` avec `member_role = 'principal'`) |
| `status` | énumération | non | `actif` \| `archive` |
| `notes` | texte long | oui | notes internes conseiller uniquement |
| `owner_user_id` | référence → `users.id` | oui | prépare le multi-conseiller, même logique que `clients.owner_user_id` existant |
| `created_at` / `updated_at` | horodatage | non | — |

**Volontairement absent** : `canton`, `commune`, `adresse`. Ces informations
restent portées individuellement par chaque `clients` membre (elles peuvent
diverger — garde partagée, adresses différentes). Une « commune de référence
foyer » n'est pas modélisée dans cette première version ; si un besoin
apparaît (ex. région tarifaire LAMal par défaut du foyer), il devra être
proposé explicitement, pas ajouté silencieusement.

**Relations** : 1 `households` → N `household_members` ; 1 `households` → N
`advisory_sessions` ; 1 `households` → N `advisory_consents`.

**Index proposés** : `primary_client_id`, `status`.

**Données sensibles** : aucune donnée personnelle propre (uniquement des
références) — la sensibilité est portée par les tables liées.

**Suppression / anonymisation** : un foyer ne doit jamais être supprimé
physiquement s'il est référencé par une session ou un rapport (intégrité de
l'historique). L'anonymisation suit celle de ses membres (`clients.anonymize`
existant) ; quand tous les membres d'un foyer sont anonymisés, `households`
passe à `status = 'archive'` (pas de suppression physique).

**Immuable après validation** : aucun champ n'est « figé » sur cette table —
c'est une entité vivante. C'est la *composition* (`household_members`) et les
*sessions* qui portent l'immuabilité nécessaire au diagnostic.

**Foyer archivé = figé (implémenté et testé au Lot 2, GATE, contrôle ciblé
« foyers archivés »)** : une fois `status = 'archive'`, toute écriture sur
le foyer ou ses membres est refusée (`409`), y compris une tentative de
réactivation (aucune procédure de réactivation n'existe à ce lot — elle
reste donc interdite plutôt que non spécifiée) ; seule la lecture reste
possible. Voir `API_CONTRACT.md` §1 pour le détail par route.

### 2.2 `household_members`

**Objectif** : relier une personne (`clients`) à un foyer, avec un rôle
dans le foyer, et gérer explicitement la délégation de contact pour les
personnes sans coordonnées propres (enfants, autres personnes à charge).

> **Décision humaine validée (GATE LOT 1, point 3.1)** : le champ est nommé
> `member_role` (et non `role`) afin d'éviter toute ambiguïté future avec un
> rôle d'accès/permission applicatif (ex. un futur rôle « conseiller » /
> « administrateur »), qui serait un concept entièrement différent porté
> ailleurs.

| Champ | Type logique | Nullable | Contraintes |
|---|---|---|---|
| `id` | entier | non | clé primaire |
| `household_id` | référence → `households.id` | non | — |
| `client_id` | référence → `clients.id` | non | — |
| `member_role` | énumération | non | `principal` \| `conjoint` \| `enfant` \| `autre_charge` — rôle **dans le foyer**, sans lien avec un rôle d'accès applicatif |
| `relationship_detail` | texte court | oui | nuance libre courte (ex. « partenaire enregistré », « petit-fils à charge ») — jamais une donnée médicale |
| `legal_representative_client_id` | référence → `clients.id` | oui | si non nul, les coordonnées (email/téléphone/adresse) affichées pour cette personne sont celles de ce représentant, jamais dupliquées sur la ligne `clients` de l'enfant |
| `start_date` / `end_date` | date | oui | période d'appartenance au foyer (ex. enfant qui quitte le foyer, séparation) |
| `status` | énumération | non | `actif` \| `archive` |
| `created_at` / `updated_at` | horodatage | non | — |

**Contraintes proposées** :
- Un même `(household_id, client_id, status='actif')` ne peut apparaître
  qu'une fois (empêche un doublon actif de la même personne dans le même
  foyer) — **mais**, décision humaine validée (GATE LOT 1, décision 1), un
  même `client_id` **peut** appartenir à plusieurs foyers différents en
  simultané (parents séparés, garde alternée, familles recomposées,
  personne à charge rattachée à plusieurs contextes) : la relation est
  volontairement many-to-many, pas one-to-many, et **aucune contrainte
  globale ne l'interdit**. Règles précises retenues :
  1. une personne est toujours représentée par une seule ligne `clients`,
     jamais dupliquée entre les foyers ;
  2. elle peut avoir plusieurs lignes `household_members`, une par foyer ;
  3. elle ne peut avoir qu'une seule adhésion **active** au **même** foyer
     (contrainte `(household_id, client_id, status='actif')` ci-dessus) ;
  4. chaque foyer actif garde exactement un `member_role = 'principal'`
     actif (inchangé, voir ci-dessous) ;
  5. `principal` reste un rôle strictement administratif, interne à *ce*
     foyer — une même personne peut être `principal` dans un foyer et
     `conjoint`/`autre_charge` dans un autre, sans contradiction ;
  6. une `advisory_sessions` est toujours rattachée à **un seul**
     `household_id` précis (`DATA_MODEL.md` §3.1) — jamais à une personne
     indépendamment d'un foyer choisi ;
  7. quand une personne recherchée appartient à plusieurs foyers actifs,
     l'interface doit toujours demander ou afficher explicitement quel
     foyer est utilisé (voir `UX_AND_CLIENT_MODE.md` §1.2/§1.4) — jamais un
     choix implicite ;
  8. les contrats existants ne sont jamais dupliqués entre foyers (§1.2) ;
  9. `start_date`/`end_date`/`status` (déjà dans le tableau ci-dessus)
     couvrent respectivement l'entrée, la sortie éventuelle et le caractère
     actif de l'adhésion ; `member_role` + `relationship_detail` couvrent la
     relation avec le membre principal *de ce foyer précis* (une même
     personne peut ainsi avoir des relations différentes selon le foyer) ;
  10. toute modification significative d'une adhésion (ajout, changement
      de représentant légal, sortie, changement de principal) est auditée
      (`ajout membre foyer` / `modification membre foyer` / `retrait membre
      foyer` / `changement de membre principal`, déjà prévus ci-dessous et
      dans `API_CONTRACT.md` §2).
- **Décision humaine validée (GATE LOT 1, point 3.2)** : `member_role =
  'principal'` doit être **exactement un** par foyer actif — jamais zéro,
  jamais deux. `principal` désigne exclusivement le contact administratif
  de référence du dossier, **sans aucune interprétation hiérarchique ou
  juridique** (un couple à égalité peut désigner l'un ou l'autre comme
  contact administratif sans que cela ne reflète une préséance). Le
  changement de membre principal n'est jamais un simple `PUT` générique : il
  passe par une procédure dédiée (`POST /api/advisory/households/:id/
  members/:memberId/set-primary`, voir `API_CONTRACT.md` §2), qui rétrograde
  atomiquement l'ancien principal (`member_role = 'conjoint'` ou
  `'autre_charge'`, à préciser dans la requête) et promeut le nouveau, avec
  une entrée d'audit dédiée (`changement de membre principal`) portant
  l'ancien et le nouveau `client_id`.
- `legal_representative_client_id`, quand renseigné, doit référencer un
  `client_id` **membre du même foyer** avec `member_role IN ('principal',
  'conjoint', 'autre_charge')` — règle applicative, pas une contrainte SQL
  portable simplement (SQLite ne fait pas de contrainte inter-lignes
  facilement) : à appliquer et tester comme le sont aujourd'hui les règles
  de branche de `contract_lamal`/`contract_life`.

**Index proposés** : `household_id`, `client_id`, `(household_id,
member_role)`.

**Distinction d'affichage (`UX_AND_CLIENT_MODE.md` §1.3)** : l'interface
distingue toujours « membre du foyer » (n'importe quelle ligne
`household_members` active) de « client principal » (la ligne dont
`member_role = 'principal'`) — jamais un raccourci qui les confondrait.

**Données sensibles** : `relationship_detail` peut être sensible selon son
contenu (statut familial) — à classer comme donnée personnelle standard, pas
sensible au sens strict (santé, origine, opinions), sous réserve de revue par
`compliance-privacy-reviewer`.

**Suppression / anonymisation** : ne supprime jamais la ligne
`household_members` d'une session déjà terminée (elle fait partie de
l'historique du diagnostic passé) ; on la marque `status = 'archive'` avec
`end_date`. La suppression physique n'intervient qu'en cascade d'une
anonymisation complète du foyer (tous les membres anonymisés + aucune session
active).

**Immuable après validation** : le rôle et le rattachement d'un membre *au
moment d'une session donnée* ne doivent pas être modifiés rétroactivement une
fois la session terminée — voir `advisory_sessions.household_snapshot`
(§3.1) qui fige la composition vue par ce diagnostic précis, indépendamment
de l'évolution future du foyer réel.

### 2.3 Détection souple de doublons entre personnes

**Décision humaine validée (GATE LOT 1, décision 2)** — principe validé au
GATE LOT 1, **implémenté au Lot 2** (`server/advisorySimilarity.js`,
`server/advisoryHouseholds.js`, testé et audité indépendamment — voir le
rapport du Lot 2). Ne s'applique pas comme une contrainte de base de
données : c'est un service de vérification exécuté au moment où le
conseiller s'apprête à créer une nouvelle personne (création rapide d'un
membre de foyer, `API_CONTRACT.md` §2), jamais une contrainte SQL.

**Ce que ce service ne doit jamais faire** : fusionner automatiquement deux
personnes, supprimer automatiquement une fiche, empêcher systématiquement la
création, ou conclure à une identité sur la seule base d'un nom identique.
Il **signale**, il ne **décide** jamais à la place du conseiller. Confirmé
par audit indépendant du code (Lot 2) : aucune fusion, aucune suppression
automatique, aucun blocage non contournable par confirmation explicite
n'existe dans l'implémentation.

**Critères indicatifs** (combinables, aucun n'est à lui seul suffisant pour
conclure) : prénom normalisé, nom normalisé, date de naissance, foyer
d'appartenance, représentant légal commun, adresse (lorsque disponible),
relation familiale déclarée. Le **nom de famille normalisé doit toujours
concorder** pour envisager toute correspondance — sans cette concordance,
le service renvoie immédiatement `no_match`, quels que soient les autres
critères disponibles (y compris si tous les autres critères concordent par
ailleurs) : ce n'est jamais un « nom identique seul » qui élève le niveau,
c'est son **absence** qui l'exclut d'emblée.

**Quatre niveaux de correspondance**, jamais un simple binaire
doublon/pas-doublon. **Décision humaine explicite (Lot 2)** : identifiants
techniques en anglais, snake_case (`exact_match`/`probable_match`/
`possible_similarity`/`no_match`), même divergence assumée que pour
`advisory_sessions.domain` (§3.1) :

| Niveau | Définition implémentée |
|---|---|
| **`exact_match`** | Nom de famille, prénom et date de naissance normalisés concordent tous les trois (les trois doivent être disponibles) — reste néanmoins **toujours** un signal, jamais une conclusion automatique d'identité. |
| **`probable_match`** | Nom de famille et prénom concordent ; la date de naissance n'est pas disponible des deux côtés à la fois (absente d'au moins un côté) ; **et** au moins un élément corroborant est disponible (e-mail, téléphone, code postal, adresse, foyer commun, représentant légal commun). **Jamais** produit si les deux dates sont renseignées et différentes. |
| **`possible_similarity`** | Nom de famille et prénom concordent sans aucun élément corroborant disponible (y compris si les deux dates de naissance sont renseignées mais différentes) ; **ou** nom de famille et date de naissance concordent avec un prénom différent. |
| **`no_match`** | Le nom de famille ne concorde pas (ou est inconnu d'un côté) — **y compris si tous les autres critères concordent par ailleurs** ; ou aucun signal significatif. Jamais renvoyé par l'API (filtré avant réponse), seulement un état interne du moteur. |

**Comportement attendu à l'interface** (détail dans
`UX_AND_CLIENT_MODE.md` §1.2/§1.3) — quand une ou plusieurs correspondances
sont détectées, le conseiller doit toujours pouvoir : ouvrir la personne
existante correspondante, confirmer explicitement qu'il s'agit d'une
personne différente, ou annuler la création. **Toute confirmation de
création malgré une correspondance `exact_match` ou `probable_match` doit
être auditée** (`audit_log`, action dédiée avec le niveau de correspondance
et la personne existante concernée — voir `API_CONTRACT.md` §2) ; une
`possible_similarity` reste informative et n'exige pas d'audit systématique
de la confirmation (la présentation de la correspondance elle-même est en
revanche auditée, voir `API_CONTRACT.md` §2).

Cette détection est complémentaire, pas un remplacement, du mécanisme
`findDuplicates()` déjà existant dans `server/routes/clients.js`
(email/téléphone, avec blocage `409` sauf `force: true`) — ce dernier n'est
pas modifié par ce module et continue de s'appliquer tel quel à la création
d'un client via l'API `clients` existante.

---

## 3. Sessions de conseil

### 3.1 `advisory_sessions`

**Objectif** : représenter un rendez-vous et son cycle de vie complet, tel
que décrit dans les spécifications (identifiant, foyer, conseiller, date,
type, statut, réponses par référence, hypothèses, besoins détectés,
informations manquantes, recommandations envisagées/écartées, validation
humaine, version des règles utilisées, journal d'audit).

| Champ | Type logique | Nullable | Contraintes |
|---|---|---|---|
| `id` | entier | non | clé primaire |
| `household_id` | référence → `households.id` | non | — |
| `advisor_user_id` | référence → `users.id` | non | conseiller conduisant le rendez-vous |
| `domain` | énumération | non | `health` \| `life_pension` \| `mixed` |
| `status` | énumération | non | `brouillon` \| `en_cours` \| `suspendu` \| `termine` \| `annule` |
| `questionnaire_version_id` | référence → `advisory_questionnaire_versions.id` | oui tant que `brouillon` | figé dès le passage en `en_cours` — ne change plus ensuite, même si une nouvelle version du questionnaire est publiée entre-temps |
| `rule_set_version_id` | référence → `advisory_rule_sets.id` | oui tant qu'aucun diagnostic n'a tourné | figé au premier calcul du moteur de règles |
| `scheduled_at` | horodatage | oui | date/heure prévue du rendez-vous |
| `started_at` / `ended_at` | horodatage | oui | début/fin réels |
| `meeting_mode` | énumération | oui | `presentiel` \| `distanciel` \| `telephone` |
| `internal_notes` | texte long | oui | **jamais visible en mode client** |
| `household_snapshot` | JSON structuré | non (à la clôture) | copie figée de la composition du foyer et des rôles *au moment du diagnostic* — garantit qu'un foyer qui évolue plus tard (enfant qui part, divorce) ne réécrit pas silencieusement un diagnostic passé |
| `created_by` / `created_at` / `updated_at` | — | non | — |

**Décision humaine validée (GATE LOT 1, point 3.3)** : `domain` en 3 valeurs
(`health`, `life_pension`, `mixed`) permet qu'un même rendez-vous couvre les
deux parcours (cas fréquent en pratique) sans créer deux sessions distinctes
à recorréler manuellement. Le questionnaire assemble alors les sections des
deux questionnaires (voir `QUESTIONNAIRE_ENGINE.md`).

**Une session `mixed` n'efface jamais la séparation par domaine** : chaque
réponse (`advisory_answers`, via la question à laquelle elle répond),
chaque règle (`advisory_rules.domain`), chaque constat
(`advisory_findings`, via la règle qui l'a produit) et chaque recommandation
(`advisory_recommendations`, via ses `finding_ids`) reste rattaché à un
domaine précis (`health` ou `life_pension`), jamais à une valeur `mixed`
propre à l'objet lui-même — `mixed` ne qualifie que la session dans son
ensemble. Le rapport d'une session `mixed` doit en conséquence présenter
deux analyses clairement séparées, jamais fusionnées (voir
`REPORT_SPECIFICATION.md`).

> Note de cohérence terminologique : cette énumération utilise des
> identifiants techniques en anglais (`health`/`life_pension`/`mixed`), par
> décision humaine explicite, alors que les énumérations existantes du CRM
> (`contracts.branch`, `clients.status`, etc.) sont en français
> (`vie_3a`, `lamal`, `prospect`…). Ce choix crée une divergence de
> convention assumée pour ce nouveau module — signalé ici pour visibilité,
> pas pour la remettre en cause.

**Index proposés** : `household_id`, `advisor_user_id`, `status`,
`(household_id, status)`.

**Données sensibles** : `internal_notes` peut contenir des observations
subjectives sur la situation d'une personne — à traiter comme sensible par
défaut (accès conseiller uniquement, jamais exporté dans le rapport client).

**Suppression / anonymisation** : jamais supprimée après `termine` (valeur
probante de traçabilité). `internal_notes` peut être vidée (pas la ligne)
lors d'une demande d'effacement, en conservant un enregistrement minimal
« session existante, notes supprimées le [date] » pour ne pas casser
l'intégrité référentielle des `advisory_findings`/`advisory_recommendations`
liés.

**Immuable après validation** (passage à `termine`) : `household_snapshot`,
`questionnaire_version_id`, `rule_set_version_id`, toutes les réponses, tous
les findings, toutes les exécutions de règles. **Modifiable** : `status` (ex.
réouverture explicite auditée si une erreur est découverte — à définir en
LOT 2 si un tel cas doit exister), `internal_notes` (jusqu'à archivage).

---

## 4. Questionnaire dynamique versionné

### 4.1 `advisory_questionnaires`

Descripteur de haut niveau, stable dans le temps.

| Champ | Type logique | Contraintes |
|---|---|---|
| `id` | entier | clé primaire |
| `domain` | énumération | `health` \| `life_pension` |
| `code` | texte court | identifiant stable (ex. `questionnaire-health`) |
| `label` | texte court | nom affiché conseiller |
| `created_at` | horodatage | — |

### 4.2 `advisory_questionnaire_versions`

**Objectif** : figer une version exploitable et publiable indépendamment des
versions suivantes — une session référence toujours une version précise, pas
le questionnaire « en cours d'édition ».

| Champ | Type logique | Nullable | Contraintes |
|---|---|---|---|
| `id` | entier | non | clé primaire |
| `questionnaire_id` | référence → `advisory_questionnaires.id` | non | — |
| `version_number` | entier | non | unique par `questionnaire_id`, strictement croissant |
| `status` | énumération | non | `brouillon` \| `publie` \| `archive` |
| `changelog` | texte long | oui | résumé des changements vs version précédente, à l'usage du conseiller |
| `effective_from` | date | oui | à partir de quand cette version est proposée pour de nouvelles sessions |
| `effective_until` | date | oui | — |
| `published_by` / `published_at` | — | oui | — |
| `created_at` | horodatage | non | — |

**Immuable après `publie`** : la structure (sections/questions/options) ne
doit plus changer. Toute évolution crée une **nouvelle** version. C'est ce
qui garantit la « reprise d'une ancienne version pour comprendre un
diagnostic passé » demandée dans les spécifications.

### 4.3 `advisory_sections`

| Champ | Type logique | Nullable | Contraintes |
|---|---|---|---|
| `id` | entier | non | clé primaire |
| `questionnaire_version_id` | référence | non | — |
| `code` | texte court | non | stable au sein d'une version |
| `title` | texte court | non | — |
| `description` | texte long | oui | — |
| `applies_to` | énumération | non | `foyer` (une fois) \| `membre` (répétée par personne concernée) |
| `display_condition` | JSON structuré | oui | expression logique référencant des réponses précédentes ou des attributs du foyer (ex. « si `enfants.count > 0` ») — format détaillé dans `QUESTIONNAIRE_ENGINE.md` |
| `sort_order` | entier | non | — |

### 4.4 `advisory_questions`

| Champ | Type logique | Nullable | Contraintes |
|---|---|---|---|
| `id` | entier | non | clé primaire |
| `section_id` | référence | non | — |
| `stable_key` | texte court | non | identifiant stable **à travers les versions** quand la question est sémantiquement inchangée — permet de comparer/agréger dans le temps |
| `type` | énumération | non | `choix_unique` \| `choix_multiple` \| `montant` \| `nombre` \| `date` \| `texte_court` \| `texte_long` \| `oui_non` |
| `required` | booléen | non | — |
| `allows_unknown` | booléen | non | si vrai, « je ne sais pas » est une réponse explicite valide, distincte d'une non-réponse |
| `applies_to_member` | booléen | non | reprend/affine `section.applies_to` au niveau question si besoin |
| `display_condition` | JSON structuré | oui | — |
| `validation_rule` | JSON structuré | oui | bornes, regex, référence à une énumération — jamais codée en dur côté React |
| `help_text_advisor` | texte long | oui | — |
| `help_text_client` | texte long | oui | reformulation pédagogique, affichable en mode présentation |
| `sort_order` | entier | non | — |

### 4.5 `advisory_question_options`

| Champ | Type logique | Nullable | Contraintes |
|---|---|---|---|
| `id` | entier | non | clé primaire |
| `question_id` | référence | non | — |
| `value` | texte court | non | valeur stockée |
| `label` | texte court | non | libellé affiché |
| `is_exclusive` | booléen | non | ex. « aucune de ces réponses » désactive les autres choix d'un `choix_multiple` |
| `sort_order` | entier | non | — |
| `active` | booléen | non | permet de retirer une option d'une **nouvelle** version sans toucher aux versions déjà publiées |

### 4.6 `advisory_answers`

**Objectif** : réponses données pendant une session, typées explicitement
(pas un blob unique), avec réponse « inconnue » et « non applicable » comme
états explicites distincts d'une absence de réponse.

| Champ | Type logique | Nullable | Contraintes |
|---|---|---|---|
| `id` | entier | non | clé primaire |
| `session_id` | référence → `advisory_sessions.id` | non | — |
| `question_id` | référence → `advisory_questions.id` | non | pointe la question **de la version figée** utilisée par la session |
| `household_member_id` | référence → `household_members.id` | oui | rempli si la question s'applique par personne |
| `value_text` / `value_number` / `value_boolean` / `value_date` / `value_json` | typés | oui (un seul rempli selon le type de question) | jamais de coercition silencieuse de type (même principe que `contract_lamal.deductible` existant) |
| `is_unknown` | booléen | non | réponse explicite « je ne sais pas » |
| `is_not_applicable` | booléen | non | question masquée/neutralisée par une condition d'affichage |
| `answered_by` | énumération | non | `conseiller` \| `client_direct` — la seconde valeur prépare, sans l'activer, un futur mode de saisie autonome par le client (voir §13 `ARCHITECTURE.md`) |
| `superseded_by_answer_id` | référence → elle-même | oui | non nul dès qu'une réponse plus récente la remplace — jamais mis à jour en place |
| `is_amendment` | booléen | non (défaut `false`) | vrai uniquement si cette réponse a été enregistrée après que la session soit passée `termine` |
| `amendment_reason` | texte long | oui | obligatoire si `is_amendment = true`, jamais renseigné sinon |
| `answered_at` | horodatage | non | — |

**Décision humaine validée (GATE LOT 1, point 3.4)** : `advisory_answers`
est **append-only** — une correction n'écrase jamais une ligne existante,
elle insère toujours une nouvelle ligne et renseigne
`superseded_by_answer_id` sur l'ancienne. La réponse « active » pour un
`(session_id, question_id, household_member_id)` donné est la plus récente
non remplacée (`superseded_by_answer_id IS NULL`).

- **Pendant `brouillon`/`en_cours`/`suspendu`** : une nouvelle réponse peut
  remplacer la précédente à tout moment ; chaque remplacement est
  significatif et déclenche une entrée `audit_log` (« correction réponse »,
  sans le contenu de la valeur — cohérent avec la limitation déjà en place
  sur le détail journalisé des contrats spécialisés) ; la dernière valeur
  devient la valeur active, immédiatement utilisée par tout nouveau calcul
  du moteur de règles.
- **Après `termine`** : une réponse déjà utilisée par le diagnostic final ne
  peut plus être modifiée silencieusement. Toute correction doit passer par
  `POST /api/advisory/sessions/:id/answers/amend` (voir `API_CONTRACT.md`
  §5), qui insère une réponse avec `is_amendment = true` et
  `amendment_reason` obligatoire, sans jamais toucher aux lignes
  précédentes au-delà d'y renseigner `superseded_by_answer_id`. Cette
  action doit systématiquement déclencher une nouvelle exécution du moteur
  de règles (`POST run-diagnostic`) et, si le résultat en est changé, la
  génération d'une nouvelle version de rapport (`rapport_corrige`, voir
  `REPORT_SPECIFICATION.md`).

**Index** : `session_id`, `(session_id, question_id)`,
`superseded_by_answer_id`.

**Données sensibles** : par nature, cette table peut contenir des données
financières (montants), voire des indices de santé indirects (consommation
médicale déclarée pour le dimensionnement de franchise LAMal) — **jamais de
diagnostic médical ni de contenu de questionnaire de santé assurantiel**, en
cohérence avec la restriction déjà appliquée à `contract_lca` (§1.2). À
qualifier précisément par `compliance-privacy-reviewer` avant le LOT 2.

**Suppression/anonymisation** : suit `advisory_sessions` — jamais supprimée
individuellement, seulement dans le cadre d'une anonymisation complète.

**Immuable après validation de la session** : oui, en totalité.

---

## 5. Moteur de règles

### 5.1 `advisory_rule_sets`

| Champ | Type logique | Nullable | Contraintes |
|---|---|---|---|
| `id` | entier | non | clé primaire |
| `domain` | énumération | non | `health` \| `life_pension` |
| `version_number` | entier | non | unique par domaine, croissant |
| `status` | énumération | non | `brouillon` \| `valide` \| `archive` |
| `changelog` | texte long | oui | — |
| `effective_from` / `effective_until` | date | oui | — |
| `validated_by_user_id` / `validated_at` | — | oui | validation humaine explicite avant passage à `valide` |
| `created_at` | horodatage | non | — |

Publier un ensemble de règles ensemble (plutôt que règle par règle) évite
qu'une session s'appuie sur un mélange incohérent de règles à moitié migrées.

### 5.2 `advisory_rules`

Reprend le format exigé par vos spécifications (`RULES_ENGINE.md` en donne le
détail conceptuel complet — ici la forme de stockage).

| Champ | Type logique | Nullable | Contraintes |
|---|---|---|---|
| `id` | entier | non | clé primaire |
| `rule_set_id` | référence → `advisory_rule_sets.id` | non | — |
| `stable_key` | texte court | non | identifiant stable **à travers les rule sets** — trace l'évolution d'« une même règle logique » de version en version |
| `domain` | énumération | non | dupliqué depuis le rule_set pour permettre des requêtes directes, jamais divergent (contrainte applicative) |
| `description` | texte long | non | — |
| `conditions` | JSON structuré | non | forme documentée dans `RULES_ENGINE.md`, jamais de code exécutable arbitraire |
| `required_data` | JSON (liste) | non | données nécessaires à l'évaluation |
| `result_finding_type` | énumération | non | `besoin_detecte` \| `lacune` \| `avertissement` \| `contre_indication` — **jamais** `recommandation_validee` (voir §5.4 et `RULES_ENGINE.md`) |
| `result_payload` | JSON structuré | non | contenu du constat (catégorie de besoin, pas de produit nommé) |
| `priority` | entier | non | — |
| `advisor_explanation` | texte long | non | texte destiné au conseiller |
| `client_explanation` | texte long | oui | reformulation pédagogique, affichable en présentation client |
| `warnings` | JSON (liste) | oui | — |
| `contraindications` | JSON (liste) | oui | — |
| `source` | texte long | non | référence interne ou réglementaire précise, jamais vide |
| `effective_from` / `effective_until` | date | oui | — |
| `status` | énumération | non | `brouillon` \| `valide` \| `archive` |
| `created_by` / `validated_by` / `validated_at` | — | oui | — |

**Contraintes d'intégrité proposées** (détaillées dans `RULES_ENGINE.md`) :
pas de règle `valide` sans `source` non vide, pas de règle sans
`stable_key`, pas de règle produisant `result_finding_type =
recommandation_validee`.

### 5.3 `advisory_rule_executions`

**Objectif** : trace d'exécution — l'explicabilité concrète (« pourquoi cette
conclusion apparaît »).

| Champ | Type logique | Nullable | Contraintes |
|---|---|---|---|
| `id` | entier | non | clé primaire |
| `session_id` | référence | non | — |
| `rule_id` | référence → `advisory_rules.id` | non | version précise de la règle évaluée |
| `engine_version` | texte court | non | version du code du moteur lui-même (distincte de la version des règles) |
| `executed_at` | horodatage | non | — |
| `outcome` | énumération | non | `declenchee` \| `non_declenchee` \| `donnees_manquantes` |
| `inputs_snapshot` | JSON structuré | non | voir structure précise ci-dessous |
| `missing_data` | JSON (liste) | oui | — |

**Décision humaine validée (GATE LOT 1, point 3.6)** — structure retenue
pour `inputs_snapshot` : une liste d'entrées, une par donnée effectivement
utilisée par la règle, chacune de la forme

```json
{
  "source_table": "contract_lamal",
  "source_id": 123,
  "field_name": "deductible",
  "value_observed": 300,
  "read_at": "2026-07-28T10:15:00Z",
  "rule_version": "rule_set_id=4"
}
```

pour une donnée de contrat, ou, pour une réponse du questionnaire :

```json
{
  "source_table": "advisory_answers",
  "source_id": 456,
  "field_name": "value_text",
  "value_observed": "moyenne",
  "read_at": "2026-07-28T10:15:00Z",
  "rule_version": "rule_set_id=4"
}
```

Contraintes explicites sur cette structure :
- ne contient **que** les champs effectivement nécessaires au raisonnement
  de la règle (`required_data`), jamais le contrat ou la réponse complets ;
- indique toujours la table et l'identifiant source (`source_table`,
  `source_id`), jamais une valeur sans provenance ;
- indique toujours la date de lecture (`read_at`), distincte d'une
  éventuelle date de modification ultérieure de la source ;
- est toujours associée à la version de règle qui l'a produite
  (`rule_version`) ;
- est protégée contre toute modification rétroactive : `advisory_rule_
  executions` est immuable dès l'écriture (§5.3, déjà énoncé) — un
  changement ultérieur du contrat source ne modifie jamais un instantané
  déjà écrit ;
- respecte la minimisation des données : aucune valeur hors périmètre du
  raisonnement de la règle n'y figure.

**Index** : `session_id`, `rule_id`.

**Immuable** : totalement, dès l'écriture.

### 5.4 `advisory_findings`

| Champ | Type logique | Nullable | Contraintes |
|---|---|---|---|
| `id` | entier | non | clé primaire |
| `session_id` | référence | non | — |
| `household_member_id` | référence | oui | si le constat concerne une personne précise |
| `rule_execution_id` | référence → `advisory_rule_executions.id` | non | traçabilité obligatoire vers la règle qui l'a produit |
| `finding_type` | énumération | non | `besoin_detecte` \| `lacune` \| `avertissement` \| `contre_indication` |
| `description` | texte long | non | — |
| `priority` | entier | non | — |
| `status` | énumération | non | `actif` \| `ecarte_par_conseiller` |
| `discard_reason` | texte long | oui | obligatoire si `status = ecarte_par_conseiller` |
| `created_at` | horodatage | non | — |

**Distinction stricte maintenue** : un `finding` n'est jamais une
recommandation. Il n'a pas de champ « produit », pas de champ « assureur ».

### 5.5 `advisory_recommendations`

| Champ | Type logique | Nullable | Contraintes |
|---|---|---|---|
| `id` | entier | non | clé primaire |
| `session_id` | référence | non | — |
| `finding_ids` | JSON (liste de références) | non | un ou plusieurs findings à l'origine |
| `category` | énumération contrôlée | non | catégorie de solution (ex. « renforcement couverture accident »), **jamais un nom de produit ou de compagnie** |
| `rationale` | texte long | non | — |
| `status` | énumération | non | `envisagee` \| `ecartee` \| `validee_conseiller` |
| `discard_reason` | texte long | oui | obligatoire si `ecartee` |
| `validated_by_user_id` / `validated_at` | — | oui | **seule** façon d'atteindre `validee_conseiller` — jamais automatique |
| `presented_to_client` | booléen | non | — |
| `client_decision` | énumération | oui | `accepte` \| `refuse` \| `a_reflechir` |
| `client_decision_at` | horodatage | oui | — |

**Aucune API ne doit permettre de passer directement à `validee_conseiller`
sans `validated_by_user_id` renseigné par une action humaine explicite** —
voir `API_CONTRACT.md` et `RULES_ENGINE.md`.

---

## 6. Consentements

### 6.1 `advisory_consents`

Table dédiée (décision validée en LOT 0), séparée de `consents`.

| Champ | Type logique | Nullable | Contraintes |
|---|---|---|---|
| `id` | entier | non | clé primaire |
| `household_id` | référence | non | — |
| `client_id` | référence → `clients.id` | oui | si le consentement est individuel plutôt que pour tout le foyer |
| `session_id` | référence → `advisory_sessions.id` | oui | certains consentements peuvent précéder la création d'une session |
| `purpose` | énumération | non | `diagnostic` \| `traitement_donnees_personnelles` \| `traitement_donnees_sensibles` \| `informations_financieres` \| `generation_rapport` \| `assistance_ia` \| `partage_assureur_partenaire` |
| `granted` | booléen | non | — |
| `text_version` | texte court | non | version exacte du texte présenté |
| `collection_mode` | énumération | non | `oral_en_rdv` \| `formulaire_papier_signe` \| `formulaire_electronique` \| `autre` |
| `collected_at` | horodatage | non | — |
| `collected_by_user_id` | référence → `users.id` | non | conseiller ayant recueilli |
| `revoked_at` | horodatage | oui | — |
| `revoked_reason` | texte long | oui | — |
| `proof_reference` | texte court | oui | pointeur vers une preuve externe (scan, formulaire signé) — **aucun binaire stocké dans cette table** |
| `revoked_by_user_id` | référence → `users.id` | oui | conseiller ayant enregistré la révocation — distinct de `collected_by_user_id` |
| `created_at` | horodatage | non | — |

**Décision humaine validée (GATE LOT 1, point 3.5)** : le modèle retenu est
la **mise à jour de la ligne d'origine** (`revoked_at`/
`revoked_by_user_id`/`revoked_reason` renseignés sur la ligne existante),
jamais une nouvelle ligne séparée — plus simple à interroger (« ce
consentement est-il actif aujourd'hui ») tout en préservant intégralement
la preuve initiale, puisque **rien de ce qui a été écrit à la création
(`granted`, `text_version`, `collection_mode`, `collected_at`,
`collected_by_user_id`, `proof_reference`) n'est jamais modifié ou
écrasé** — seuls les trois champs de révocation, initialement `NULL`,
peuvent passer d'absent à renseigné, une seule fois, jamais en sens
inverse.

**La révocation n'agit que pour l'avenir** : elle ne doit jamais être
présentée, dans l'interface ou le rapport, comme entraînant automatiquement
l'effacement des données déjà traitées sous ce consentement lorsqu'une
autre obligation de conservation s'applique (ex. données déjà intégrées à
un rapport final déjà généré, ou conservation légale par ailleurs
applicable) — **ce point reste soumis à validation juridique**, voir
`SECURITY_PRIVACY.md` §20.

**Assistance IA — double verrou (exigé par la décision humaine LOT 0)** :
1. Un consentement `purpose = 'assistance_ia'` doit exister et être
   `granted = true` et non révoqué.
2. Une activation opérationnelle distincte (drapeau, hors de cette table,
   probablement sur `advisory_sessions` ou au niveau foyer) doit également
   être active.
Les deux sont désactivés par défaut ; l'absence de l'un ou l'autre bloque
tout appel IA. Détaillé dans `SECURITY_PRIVACY.md` et `MCP_STRATEGY.md`.

**Index** : `household_id`, `(household_id, purpose)`, `session_id`.

**Données sensibles** : le fait même qu'un consentement `traitement_donnees_
sensibles` existe est une donnée sensible par association — accès restreint
au conseiller et à l'audit.

**Suppression** : jamais supprimée (preuve légale) ; seule la révocation est
possible, pas l'effacement, sauf anonymisation complète du foyer — et même
alors, la question de l'effacement effectif reste conditionnée par les
obligations de conservation applicables (voir ci-dessus).

**Immuable après création** : `granted`, `text_version`, `collection_mode`,
`collected_at`, `collected_by_user_id`, `proof_reference`. **Modifiable
une seule fois, de non-renseigné à renseigné** : `revoked_at`,
`revoked_by_user_id`, `revoked_reason`.

---

## 7. Rapport

### 7.1 `advisory_reports`

| Champ | Type logique | Nullable | Contraintes |
|---|---|---|---|
| `id` | entier | non | clé primaire |
| `session_id` | référence | non | un rapport par session (unique) |
| `current_version_id` | référence → `advisory_report_versions.id` | oui | — |
| `created_at` | horodatage | non | — |

### 7.2 `advisory_report_versions`

| Champ | Type logique | Nullable | Contraintes |
|---|---|---|---|
| `id` | entier | non | clé primaire |
| `report_id` | référence | non | — |
| `version_number` | entier | non | croissant par rapport |
| `kind` | énumération | non | `brouillon_interne` \| `presentation_client` \| `rapport_final` \| `rapport_corrige` |
| `content_snapshot` | JSON structuré | non | instantané figé (foyer, besoins, lacunes, recommandations, consentements, avertissements) — **jamais recalculé après coup** |
| `questionnaire_version_id` / `rule_set_version_id` | référence | non | traçabilité des versions utilisées |
| `generated_by_user_id` / `generated_at` | — | non | — |
| `client_decision` | JSON structuré | oui | — |
| `superseded_by_version_id` | référence → elle-même | oui | une correction crée une **nouvelle** version, ne modifie jamais une version existante |

**Immuable dès la création** : `content_snapshot` en totalité. Une erreur
détectée après coup produit une nouvelle version `rapport_corrige`, jamais
une modification de l'ancienne.

---

## 8. Synthèse des relations (texte, le diagramme complet est dans `ARCHITECTURE.md`)

```
clients ──< household_members >── households ──< advisory_sessions
                                                        │
                    advisory_questionnaire_versions ────┤
                    advisory_rule_sets (via version) ───┤
                                                        │
                                            ┌───────────┼────────────┐
                                       advisory_answers  advisory_rule_executions
                                                              │
                                                      advisory_findings
                                                              │
                                                      advisory_recommendations
                                                              │
                                                      advisory_reports ──< advisory_report_versions

households ──< advisory_consents
contracts (existant) ──(lecture seule)──> advisory_rule_executions.inputs_snapshot
```

## 9. Décisions humaines validées (GATE LOT 1) et points encore ouverts

Les points suivants, initialement listés comme « à valider », ont été
tranchés lors du GATE de validation LOT 1 et sont reflétés dans les sections
correspondantes ci-dessus :

1. Pas de nouvelle valeur de statut `clients.status` pour les personnes à
   charge ; classification exclusivement via `household_members.member_role`
   (§1.1).
2. `household_members.member_role = 'principal'` exactement un par foyer
   actif, lecture strictement administrative, changement via procédure
   dédiée et audit (§2.2).
3. `advisory_sessions.domain` accepte `mixed` ; réponses, règles, findings et
   recommandations conservent chacun leur propre domaine (`health` \|
   `life_pension`) même au sein d'une session `mixed`, et le rapport sépare
   clairement les deux analyses (§3.1, voir aussi `REPORT_SPECIFICATION.md`).
4. Correction d'une réponse : append-only avec `superseded_by_answer_id` ;
   pendant `brouillon`/`en_cours`/`suspendu`, la dernière valeur devient la
   valeur active avec traçabilité par `audit_log` ; après `termine`, toute
   correction passe par un amendement explicite (§4.6, `API_CONTRACT.md`
   §5).
5. Révocation d'un consentement : mise à jour de la ligne d'origine
   (`revoked_at`/`revoked_by_user_id`/`revoked_reason`), jamais de
   suppression ni d'écrasement de la preuve initiale ; effet uniquement
   prospectif, sans effacement automatique des données déjà traitées quand
   une autre obligation de conservation s'applique — **ce dernier point
   reste soumis à validation juridique** (§6.1).
6. Instantané minimal des contrats existants dans
   `advisory_rule_executions.inputs_snapshot`, structure précisée en §5.3
   (§1.2, §5.3).
7. Une personne peut appartenir à plusieurs foyers actifs simultanément
   (parents séparés, garde alternée, familles recomposées) ; aucune
   contrainte globale ne l'interdit ; règles précises en §2.2 ; l'interface
   doit toujours désambiguïser le foyer utilisé pour une session
   (§1.1, §2.2, `UX_AND_CLIENT_MODE.md` §1.2/§1.4).
8. Pas de contrainte d'unicité automatique nom/email/téléphone ; détection
   souple de doublons à 4 niveaux (`exact_match`/`probable_match`/
   `possible_similarity`/`no_match`), jamais bloquante ni fusionnante,
   implémentée et auditée indépendamment au Lot 2 (§1.1, §2.3,
   `SECURITY_PRIVACY.md` §19).

**Points encore ouverts** : aucun point structurant non tranché ne subsiste
à l'issue de ce second GATE. Les 7 points de validation **juridique**
listés dans `SECURITY_PRIVACY.md` §20 restent, par nature, hors du
périmètre que ce document peut trancher seul.
