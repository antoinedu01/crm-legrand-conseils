# Migrations de la base de données

Le schéma est versionné avec `PRAGMA user_version` (voir `server/db.js`).
Chaque migration s'applique automatiquement et une seule fois au démarrage.

**Avant toute mise à jour du CRM : faites une sauvegarde**
(Paramètres → « Télécharger une sauvegarde complète », ou copie de `data/crm.sqlite`).
La procédure de retour en arrière est toujours : arrêter le CRM, remettre
l'ancienne version du code, restaurer la sauvegarde de la base.

## Version 1

| Changement | Retour en arrière |
|---|---|
| `clients.owner_user_id` (colonne nullable, prépare le multi-conseiller) | colonne ignorée par l'ancien code — aucune action nécessaire |
| Index `idx_clients_email`, `idx_clients_phone` (détection de doublons) | `DROP INDEX idx_clients_email; DROP INDEX idx_clients_phone;` |
| Table `sessions` (sessions persistantes, créée par `session-store.js`) | `DROP TABLE sessions;` — seule conséquence : tout le monde doit se reconnecter |

## Version 8

**Objectif** : modèle métier « Assurance Suisse » — schéma relationnel pour les
détails spécialisés par branche de contrat (LAMal, LCA, assurance vie,
incapacité de gain privée, LPP/IJM). La numérotation saute volontairement de 6
à 8 : la version 7 reste réservée au Bloc 4 partenaires (branche séparée, non
fusionnée), afin d'éviter tout conflit de numérotation entre les deux modules.

**Colonnes ajoutées à `contracts`** : `review_frequency TEXT DEFAULT 'annuelle'`,
`review_last_date TEXT`, `review_next_date TEXT` (pilotage de la revue de
portefeuille, communes à toutes les branches). Ces colonnes sont créées mais ne
sont à ce jour **pas exposées** par l'API des contrats.

**Tables créées** :
- `contract_lamal`, `contract_lca`, `contract_life`, `contract_income_protection`,
  `contract_lpp_ijm` — chacune en relation **1:1** avec `contracts` via
  `contract_id INTEGER PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE`
  (0 ou 1 ligne spécialisée par contrat). `contract_lca` porte le processus de
  souscription/décision ; les garanties elles-mêmes restent hors périmètre,
  dans `contract_coverages`. `contract_lpp_ijm` est un module volontairement
  minimal.
- `contract_coverages`, `contract_beneficiaries`, `contract_history` — en
  relation **1:n** avec `contracts` (clé primaire `id INTEGER PRIMARY KEY
  AUTOINCREMENT` propre à chaque table, `contract_id` en simple clé étrangère
  avec `ON DELETE CASCADE`, plusieurs lignes possibles par contrat). Ces trois
  tables sont créées par la migration et couvertes par des **tests de schéma**
  (contraintes `UNIQUE`, suppression en cascade, présence des index —
  `test/migrations.test.js`), mais **non exploitées par l'API actuelle** :
  aucune route, aucune validation métier, aucun test API/CRUD ne les concerne
  à ce jour ; hors périmètre des lots de développement réalisés à ce jour.

Chaque table spécialisée est décrite en détail, champ par champ, dans
[`CONTRATS_ASSURANCE_SUISSE.md`](./CONTRATS_ASSURANCE_SUISSE.md).

**Compatibilité avec les contrats génériques existants** : migration
strictement additive. Aucune colonne existante de `contracts` n'est modifiée
ni supprimée ; aucune donnée existante n'est réécrite. Un contrat sans ligne
dans une table spécialisée reste pleinement valide (relation 0..1:1).

**Réversibilité** : **partiellement réversible**. Un `DROP TABLE` sur les 8
tables créées est techniquement possible sans casser le reste du schéma
(aucune autre table n'y fait référence en clé étrangère), mais entraînerait la
perte définitive des détails spécialisés déjà saisis. Le retrait des 3
colonnes `review_*` sur `contracts` est sans risque pour les données de
contrat elles-mêmes (colonnes non exploitées par l'API).

**Précautions avant déploiement** : sauvegarde préalable obligatoire ; cette
migration n'a, à ce jour, jamais été exécutée sur la base de production.

*(Statut : structure des 8 tables et des 3 colonnes confirmée dans le code —
`server/db.js`, bloc `if (version < 8)`. Le support CRUD complet côté API
n'existe, à ce jour, que pour les 5 premières tables — voir
`CONTRATS_ASSURANCE_SUISSE.md`. Cette migration s'exécute dans une transaction
SQLite unique — en cas d'erreur en cours de migration, SQLite annule
l'ensemble du bloc, ce qui limite le risque d'un schéma à moitié migré.)*

## Version 9

**Objectif** : socle foyer du module « Legrand Diagnostic 360 » (Lot 2) —
`households` et `household_members`, premier module transverse indépendant
des contrats/clients existants, préparant les parcours de diagnostic
(sessions, questionnaires, moteur de règles) des lots suivants. Numéro
vérifié disponible au moment de l'implémentation : aucun bloc `< 9`
n'existait, la version 8 restait la dernière ; la branche
`feature/lead-generation-engine` (Bloc 4, non fusionnée) reste à `user_
version < 6` et ne revendique pas la version 9.

**Tables créées** :
- `households` — le foyer : `label` (nom d'usage interne), `primary_client_id`
  (référence `clients(id)`, sans `ON DELETE CASCADE` — cohérent avec le fait
  qu'aucune route ne supprime physiquement un client, seulement
  `POST /:id/anonymize`), `status` (`actif`/`archive`), `notes`,
  `owner_user_id` (prépare le multi-conseiller, même logique que
  `clients.owner_user_id`).
- `household_members` — l'adhésion d'une personne (`clients.id`) à un foyer :
  `member_role` (`principal`/`conjoint`/`enfant`/`autre_charge`),
  `relationship_detail`, `legal_representative_client_id` (délégation de
  contact), `start_date`/`end_date`, `status` (`actif`/`archive` — distinct du
  statut du foyer).

**Index** : index simples (`household_id`, `client_id`,
`(household_id, member_role)`, `primary_client_id`, `status`) plus **deux
index uniques partiels** garantissant en base :
- `idx_household_members_active_unique` — une personne ne peut avoir qu'une
  seule adhésion **active** dans un même foyer (mais peut appartenir à
  plusieurs foyers actifs différents — décision humaine explicite : aucune
  contrainte globale n'interdit l'appartenance multi-foyer, utile pour
  représenter parents séparés, garde alternée, familles recomposées) ;
- `idx_household_members_one_active_principal` — un foyer actif ne peut
  jamais avoir plus d'un membre `principal` actif. L'invariant complémentaire
  (« un foyer actif a toujours **au moins** un principal actif ») n'est pas
  exprimable par une contrainte SQL portable en SQLite (pas de contrainte
  inter-lignes sur un agrégat) : il est garanti exclusivement par le service
  métier (`server/advisoryHouseholds.js`) — création atomique foyer+principal,
  procédure dédiée de changement de principal, refus de retirer un principal
  sans remplacement.

**Compatibilité** : migration strictement additive, aucune table existante
modifiée. Aucune donnée existante réécrite.

**Réversibilité** : totalement réversible techniquement — `DROP TABLE
household_members; DROP TABLE households;` — aucune autre table n'y fait
référence en clé étrangère à ce stade (les futures tables `advisory_*` des
lots suivants y feront référence, ce qui réduira la réversibilité une fois
créées).

**Précautions avant déploiement** : sauvegarde préalable obligatoire ; cette
migration n'a, à ce jour, jamais été exécutée sur la base de production.

*(Statut : structure confirmée dans le code — `server/db.js`, bloc
`if (version < 9)`. Testée dans `test/migrations.test.js` : base neuve,
migration depuis une base héritée, idempotence, colonnes, index, et
comportement des deux index uniques partiels (multi-foyer autorisé,
doublon actif dans le même foyer refusé, deux principaux actifs refusés).
Cette migration s'exécute dans une transaction SQLite unique.)*

## Version 10

**Objectif** : socle générique « sessions de conseil et questionnaires »
(Lot 3A) — huit tables entièrement nouvelles, aucun contenu métier réel
(santé/vie), uniquement le moteur générique et versionné. Numéro vérifié
disponible au moment de l'implémentation : aucun bloc `< 10` n'existait, la
version 9 restait la dernière ; aucune branche distante ne dépasse la
version 9 (`feature/lead-generation-engine` reste à `< 6`).

**Tables créées (8)** :
- `advisory_questionnaires` — famille fonctionnelle de questionnaires
  (`stable_key` unique, `domain` ∈ `common`/`health`/`life_pension` — **pas**
  `mixed` à ce niveau, voir composition modulaire ci-dessous).
- `advisory_questionnaire_versions` — version figée et publiable
  indépendamment (`status` ∈ `draft`/`published`/`archived`,
  `content_hash` SHA-256 calculé à la publication via le module `crypto` de
  Node, déjà utilisé par `server/app.js`/`server/totp.js` — aucune
  dépendance ajoutée).
- `advisory_sections`, `advisory_questions`, `advisory_question_options` —
  structure d'une version (clés stables uniques au niveau de la version,
  `questionnaire_version_id` dupliqué sur `advisory_questions` depuis sa
  section, même principe que `advisory_rules.domain` dupliqué depuis son
  `rule_set`, `DATA_MODEL.md` §5.2). `advisory_questions.allows_not_applicable`
  (`INTEGER NOT NULL DEFAULT 0`) ajoutée **directement dans cette migration
  10** (correctif final avant premier commit du Lot 3A — jamais déployée
  entre-temps, donc pas de migration 11 séparée) : distincte de
  `allows_unknown` (déjà présente), désactivée par défaut, voir
  `DATA_MODEL.md` §4.
- `advisory_sessions` — un rendez-vous de conseil (`status` ∈
  `draft`/`in_progress`/`suspended`/`completed`/`cancelled`, `domain` ∈
  `health`/`life_pension`/`mixed`, `household_snapshot` JSON figé au
  démarrage — ajout documenté ci-dessous).
- `advisory_session_questionnaires` — **composition modulaire** (décision
  évoluée en cours de lot par rapport à la proposition initiale, voir
  ci-dessous) : associe une session à une ou plusieurs versions publiées
  (`domain` ∈ `common`/`health`/`life_pension`, `module_role` ∈
  `core`/`domain`, `display_order`).
- `advisory_answers` — réponses append-only (`status` ∈
  `answered`/`unknown`/`not_applicable`/`cleared`, `superseded_by_answer_id`,
  `is_amendment`/`amendment_reason`, `revision`).

Aucune autre table `advisory_*` créée (pas de `rule_sets`/`rules`/
`rule_executions`/`findings`/`recommendations`/`consents`/`reports`, Lot 4+).

**Décision d'architecture évoluée en cours de lot — composition modulaire au
lieu d'une version « mixed »** : la conception initialement proposée
prévoyait qu'une version de questionnaire puisse elle-même être « mixte »
(sections tagués individuellement par domaine). La revue d'architecture a
signalé un risque réel de duplication de contenu entre un questionnaire pur
et un questionnaire mixte. Décision retenue : `advisory_session_questionnaires`
rattache à une session une ou plusieurs versions **chacune mono-domaine**
(`common`/`health`/`life_pension`) — une session mixte rattache exactement
une version `health` et une version `life_pension`, plus éventuellement une
version `common` partagée, sans jamais dupliquer de contenu. Contraintes
uniques `(session_id, questionnaire_version_id)`,
`(session_id, display_order)` et `(session_id, domain)` — cette dernière
empêche nativement deux versions actives du même domaine dans une session.

**Ajout non explicitement listé mais documenté — `household_snapshot`** :
colonne JSON sur `advisory_sessions`, figée au démarrage (`in_progress`),
jamais réécrite ensuite. Invariant central déjà documenté dans
`DATA_MODEL.md` §2.2 point 10/§3.1 (empêcher qu'une modification ultérieure
des membres du foyer réécrive silencieusement le contexte d'une session
déjà démarrée) — absent de la liste explicite des champs du Lot 3A, ajouté
par décision d'ingénierie documentée dans le rapport du lot (coût minime,
garantie importante).

**Identifiants techniques en anglais** (statuts, types, opérateurs de
condition) : décision humaine explicite du Lot 3A, reconduisant la
divergence déjà actée et documentée au Lot 2 pour `exact_match`/etc.

**Index** : un index simple par clé étrangère/filtre courant, plus les
contraintes uniques citées ci-dessus et deux index uniques partiels sur
`advisory_answers` garantissant qu'une seule réponse reste active
(`superseded_by_answer_id IS NULL`) par `(session_id, question_id)` en
portée foyer/session, et par `(session_id, question_id, household_member_id)`
en portée membre.

**Aucun `CHECK` déclaratif** sur les colonnes-énumération (statuts, types,
domaines) : convention déjà en vigueur pour `clients.status`/
`contracts.status`/`households.status`, reconduite à l'identique.

**Compatibilité** : migration strictement additive, aucune table existante
modifiée. Aucune donnée existante réécrite.

**Réversibilité** : `DROP TABLE` des 8 tables dans l'ordre inverse de
création (respect des clés étrangères) — aucune donnée hors de ce module
n'est affectée.

**Précautions avant déploiement** : sauvegarde préalable obligatoire ; cette
migration n'a, à ce jour, jamais été exécutée sur la base de production.

*(Statut : structure confirmée dans le code — `server/db.js`, bloc
`if (version < 10)`. Testée dans `test/migrations.test.js` : base neuve,
migration depuis une base héritée, idempotence (y compris redémarrages
répétés), les 8 tables et leurs colonnes — dont
`advisory_questions.allows_not_applicable` (présence, type `INTEGER`,
`NOT NULL`, valeur par défaut `0`) —, les index (dont les 3 contraintes
uniques de composition et les 2 index partiels de réponse), hiérarchie
questionnaire → version → section → question → option via les FK réelles,
refus de deux versions du même domaine dans une session, coexistence de
réponses actives pour deux membres différents. Cette migration s'exécute
dans une transaction SQLite unique.)*

## Version 11

**Objectif** : moteur déterministe de règles et de findings (Lot 4A) —
quatre tables entièrement nouvelles. Le moteur produit exclusivement des
constats/besoins/lacunes/avertissements/informations manquantes/catégories
de solution à examiner (`findings`) — jamais un contrat à souscrire, un
assureur, un produit précis, une recommandation finale ou une validation de
conseil (voir `RULES_ENGINE.md`). Numéro vérifié disponible au moment de
l'implémentation : aucun bloc `< 11` n'existait, la version 10 restait la
dernière.

**Tables créées (4)** :
- `advisory_rule_sets` — famille fonctionnelle **et** version figée
  fusionnées en une seule table (`stable_key` + `version_number`,
  `UNIQUE(stable_key, version_number)`), contrairement au couple de tables
  `advisory_questionnaires`/`advisory_questionnaire_versions` du Lot 3A —
  décision d'architecture documentée : un rule_set n'a pas de sous-structure
  propre à découpler (pas d'équivalent section/question), et le brief plafonne
  explicitement le lot à 4 tables (pas de 5ᵉ table d'association). `domain` ∈
  `common`/`health`/`life_pension` (GATE LOT 4A §2, décision humaine
  confirmée : `common`, facultatif, ajouté en cours de GATE pour les
  constats transverses au foyer) — **jamais** `mixed` (cette valeur ne
  qualifie qu'une session, jamais un rule_set, une règle ou un finding).
  `status` ∈
  `draft`/`published`/`archived`, `content_hash` SHA-256 calculé à la
  publication (même mécanisme de canonicalisation que les questionnaires,
  factorisé dans `server/canonicalJson.js`, voir ci-dessous).
- `advisory_rules` — une règle individuelle (`rule_set_id`, `stable_key`
  unique par rule_set, `domain` dupliqué depuis son `rule_set` — même
  principe que `advisory_questions.questionnaire_version_id`, Lot 3A —,
  `conditions`/`required_data` JSON, `result_finding_type` ∈ `fact` /
  `detected_need` / `gap` / `warning` / `missing_information` /
  `solution_category`, `finding_scope` ∈ `session`/`household`/`member`
  (GATE LOT 4A §3, colonne ajoutée en cours de GATE — comble une lacune
  initiale où `advisory_findings.household_member_id` existait sans
  jamais être renseignée ; `member` exige une condition racine `all`/`any`,
  validé à la publication), `result_payload` restreint à la seule clé
  `category_hint`, `priority` ∈ `low`/`medium`/`high`/`critical`,
  `advisor_explanation`/`client_explanation`/`warnings`/`contraindications`,
  `source`/`source_reference`/`effective_from`/`effective_until`,
  `validated_by_user_id`/`validated_at`, `status` ∈ `active`/`archived`).
  **Décision documentée** : contrairement à la proposition initiale
  (`RULES_ENGINE.md` v1, cycle `brouillon`/`valide`/`archivé` propre à la
  règle), le statut d'une règle individuelle reprend le cycle déjà éprouvé
  `advisory_questions.status` (`active`/`archived`) — la « validation
  humaine » qui fait passer une règle à l'état valide est exactement l'acte
  de publication du `rule_set` qui la contient (`publishRuleSet` horodate
  alors `validated_by_user_id`/`validated_at` sur chaque règle active) ;
  inventer un second cycle de vie propre à la règle aurait dupliqué cette
  même décision sans bénéfice réel.
- `advisory_rule_executions` — **une ligne par exécution du moteur pour un
  couple (session, domaine)**, jamais une ligne par règle individuelle
  (divergence documentée par rapport à `DATA_MODEL.md` v1 §5, qui proposait
  initialement une granularité par règle — resserrée après revue
  `rules-engine-auditor`/`advisory-architect` : l'auditabilité exigée porte
  sur le résultat d'ensemble d'une exécution, la traçabilité par règle étant
  déjà pleinement assurée par `advisory_findings.rule_id` et
  `inputs_snapshot`). Champs : `session_revision` (fraîcheur au moment de
  l'exécution), `rule_set_id`/`rule_set_version_number`/`content_hash` figés,
  `status` ∈ `completed`/`failed` (`running` prévu au schéma pour complétude
  future mais jamais produit par ce lot — moteur synchrone mono-processus,
  aucune exécution n'est jamais observable en cours), `mode` (`final`
  uniquement pris en charge dans ce lot, colonne conservée pour extension
  future), `inputs_snapshot` JSON (références résolvables — `question_id`/
  `stable_key`/`household_member_id`/`answer_id` — jamais la valeur de
  réponse elle-même dupliquée ici ; porte désormais aussi, par référence,
  une classification de sensibilité FIGÉE à l'exécution —
  `sensitivity_at_execution`/`questionnaire_version_id`/`read_at`, GATE
  LOT 4A §4, colonne inchangée mais structure JSON enrichie en cours de
  GATE), `superseded_by_execution_id` auto-référencé (même principe que
  `advisory_answers.superseded_by_answer_id`).
- `advisory_findings` — un constat produit par une règle déclenchée, ou une
  information manquante l'ayant empêchée de conclure (`rule_execution_id`,
  `rule_id`, `finding_type`/`priority`/`title`/`summary`/
  `advisor_explanation`/`client_explanation`, `missing_data`/`warnings`/
  `contraindications`/`used_inputs_ref` JSON — toujours des références
  résolvables, jamais une valeur dupliquée —, `finding_scope`/
  `household_member_id` (GATE LOT 4A §3, voir `advisory_rules` ci-dessus),
  `status` ∈ `active`/`dismissed`/`superseded` — `superseded` est une
  dénormalisation **dérivée** de la supersession de l'exécution parente,
  jamais basculée indépendamment ; seul `dismissed` est une action humaine
  distincte, motif obligatoire —, `needs_review`/`conflicts_with` pour le
  recoupement de findings sur une même catégorie (état ACTIF courant,
  recalculé à chaque écartement) et `conflicts_detected_at_execution`
  (GATE LOT 4A §5, colonne ajoutée en cours de GATE : constat HISTORIQUE
  et IMMUABLE du recoupement à la production de l'exécution, distinct de
  `conflicts_with`, jamais réécrit ensuite)).

**Tables explicitement hors périmètre de ce lot** (absentes, par choix) :
`advisory_recommendations`, tout catalogue produit/assureur,
`advisory_consents`, `advisory_reports`/`advisory_report_versions`.

**Pas de colonne de figeage du rule_set sur `advisory_sessions`** :
contrairement à une proposition initiale de colonne `rule_set_version_id`
(incompatible avec une session `mixed`, qui a besoin de DEUX rule_sets figés
simultanément, et qui aurait exigé une 5ᵉ table d'association comme
`advisory_session_questionnaires` pour les questionnaires) — le rule_set
utilisé pour un couple (session, domaine) est **dérivé de l'historique
lui-même** : la première ligne de `advisory_rule_executions` pour ce couple
devient la référence permanente, jamais mise à niveau silencieusement vers
une version plus récemment publiée, même en cas de ré-exécution après
amendement (reproductibilité).

**Séparation des modules** : `server/canonicalJson.js` (nouveau) extrait les
fonctions de canonicalisation JSON auparavant privées à
`server/advisoryQuestionnaires.js`, pour garantir un comportement de hachage
identique entre l'empreinte de contenu d'une version de questionnaire et
celle d'un rule_set. `server/advisoryRuleConditions.js` (nouveau) est un
module **séparé** de `server/advisoryConditions.js` (conditions d'affichage
de questionnaire, Lot 3A) : l'univers référençable diffère réellement (7
natures de référence contre 2, dont `contract_branch`/`rule_result`,
inconnues du moteur de conditions du questionnaire), ce qui aurait rendu une
réutilisation directe incorrecte — seuls les principes génériques sans
sémantique de domaine propre (détection de cycle par coloration DFS) sont
repris à l'identique.

**Index** : un index simple par clé étrangère/filtre courant
(`advisory_rule_sets.stable_key`/`domain`/`status`, `advisory_rules.rule_
set_id`/`domain`, `advisory_rule_executions.session_id`/`rule_set_id`/
`(session_id, domain)`, `advisory_findings.rule_execution_id`/`session_id`/
`rule_id`/`status`), **plus un index UNIQUE PARTIEL** (correctif ciblé
GATE LOT 4A, décision humaine confirmée, ajouté directement dans cette
migration 11 avant tout commit — jamais une migration 12 distincte,
puisque celle-ci n'était encore ni committée ni déployée) :
`idx_advisory_rule_sets_one_published_per_domain ON advisory_rule_sets
(domain) WHERE status = 'published'`. Garantit « un seul rule_set publié
par domaine, pour les trois domaines `common`/`health`/`life_pension`
indépendamment les uns des autres » **au niveau SQLite lui-même**, quel
que soit le nombre de processus applicatifs qui écrivent dans ce fichier
— cette garantie ne dépend d'aucune hypothèse sur le nombre de processus.
L'ancienne vérification purement applicative
(`assertNoOtherPublishedFamilyForDomain`, `server/advisoryRules.js`) reste
la voie normale (message clair, décision humaine explicite requise avant
toute republication concurrente) mais ne suffisait pas, à elle seule, à
empêcher deux processus distincts d'écrire chacun une ligne `published`
pour le même domaine dans la fenêtre entre sa lecture et son écriture ;
l'index comble entièrement cette fenêtre. **Remplacement transactionnel** :
l'archivage d'une ancienne version de la même famille précède désormais
toujours sa republication dans la même transaction (`publishRuleSet`),
l'index étant vérifié statement par statement, jamais différé en SQLite —
l'ordre inverse violerait la contrainte tant que l'ancienne ligne reste
`published`. **Rollback** : si la transaction échoue après l'archivage
mais avant son terme (vérifié par un test dédié à déclencheur SQL
temporaire), `db.transaction()` annule intégralement l'archivage comme la
publication — aucun état intermédiaire n'est jamais persisté, aucun audit
de succès n'est journalisé. Vérifié par test (écriture SQL brute hors
service pour chacun des trois domaines, deux VRAIES connexions
`better-sqlite3` sur le même fichier observant le verrouillage WAL réel
puis la violation d'unicité, plusieurs brouillons/archivés du même domaine
restant possibles, absence de corruption après résolution). **Évolution
future** : si plusieurs rule_sets publiés par domaine devaient un jour être
autorisés (aucun besoin identifié à ce stade), cet index devra être
explicitement supprimé ou reformulé dans une migration ultérieure — il ne
peut pas être contourné silencieusement par le code applicatif seul.

**Aucun `CHECK` déclaratif** sur les colonnes-énumération — convention déjà
en vigueur, reconduite à l'identique.

**Compatibilité** : migration strictement additive, aucune table existante
modifiée. Aucune donnée existante réécrite.

**Réversibilité** : `DROP TABLE` des 4 tables dans l'ordre inverse de
création (`advisory_findings` → `advisory_rule_executions` →
`advisory_rules` → `advisory_rule_sets`) — aucune donnée hors de ce module
n'est affectée.

**Précautions avant déploiement** : sauvegarde préalable obligatoire ; cette
migration n'a, à ce jour, jamais été exécutée sur la base de production.
Aucune règle métier réelle n'est semée par cette migration — toute règle
créée en test est fictive et porte la mention « Exemple technique fictif —
ne constitue pas un conseil d'assurance. » dans son champ `source`.

*(Statut : structure confirmée dans le code — `server/db.js`, bloc
`if (version < 11)`. Testée dans `test/migrations.test.js` : base neuve,
migration depuis une base héritée, idempotence, les 4 tables et l'absence
explicite des tables hors périmètre (`advisory_recommendations`/
`advisory_consents`/`advisory_reports`). Cette migration s'exécute dans une
transaction SQLite unique.)*

## Version 12

**Objectif** : backend générique des recommandations humaines (Lot 7A) —
trois tables entièrement nouvelles. Une recommandation est **toujours**
créée par un conseiller humain authentifié ; le moteur de règles
(`server/advisoryRules.js`/`server/advisoryRuleExecutions.js`) n'écrit
jamais dans ces tables, ne peut ni créer ni valider une recommandation, ni
choisir un produit ou un assureur, ni renseigner automatiquement une
justification (aucune table produit/assureur n'existe, Lot 11 hors
périmètre). Numéro vérifié disponible au moment de l'implémentation : aucun
bloc `< 12` n'existait, la version 11 restait la dernière ; aucune branche
locale ou distante connue ne dépasse la version 11.

**Tables créées (3)** :
- `advisory_recommendations` — `session_id`, `domain` (∈
  `common`/`health`/`life_pension`, **jamais** `mixed` — tous les findings
  liés doivent appartenir au même domaine que la recommandation, contrôle
  applicatif), `scope` (∈ `session`/`household`/`member`, choisi
  explicitement par le conseiller, **jamais dérivé automatiquement** des
  findings liés), `status` (∈ `draft`/`validated`/`dismissed`/`superseded`/
  `withdrawn`), `revision` (`INTEGER NOT NULL DEFAULT 1` — verrou de
  concurrence optimiste **propre à la ligne**, grain nouveau dans ce dépôt,
  distinct de `advisory_sessions.revision`, incrémenté après **toute**
  écriture réussie y compris les transitions terminales), les champs
  narratifs (`title`/`summary`/`advisor_rationale`/`expected_benefits`/
  `limitations`/`risks`/`alternatives_considered`/
  `alternative_rejection_reason`/`missing_information`/`warnings`/
  `reservations`) plus trois booléens de déclaration explicite
  (`no_alternatives_identified`/`no_additional_risks_identified`/
  `no_missing_information_known`, défaut `0`, distinguent « non renseigné »
  de « examiné, rien identifié » — jamais renseignés automatiquement), les
  champs d'audit par transition (`created_by_user_id`/`created_at`,
  `validated_by_user_id`/`validated_at`/`validated_session_revision`,
  `dismiss_reason`/`dismissed_by_user_id`/`dismissed_at`,
  `withdraw_reason`/`withdrawn_by_user_id`/`withdrawn_at`), et
  `supersedes_recommendation_id` (auto-référence, portée par la **nouvelle**
  recommandation, une seule direction explicite). **Aucun champ `category`**
  (délibérément exclu — ambiguïté avec
  `advisory_rules.result_payload.category_hint`, décision humaine) ;
  **aucun champ produit, assureur, contrat, prime, comparaison,
  `presented_to_client` ou `client_decision`** (hors périmètre Lot 7B/9/11).
- `advisory_recommendation_findings` — relation **N:M** vers
  `advisory_findings` (`UNIQUE(recommendation_id, finding_id)`,
  `ON DELETE CASCADE` depuis la recommandation parente uniquement). Un
  finding peut justifier plusieurs recommandations/alternatives ; une
  recommandation peut citer plusieurs findings, toujours du même domaine et
  de la même session (contrôle applicatif). Les findings restent strictement
  en lecture depuis ce module.
- `advisory_recommendation_members` — relation **N:M** vers
  `household_members` (`UNIQUE(recommendation_id, household_member_id)`,
  `ON DELETE CASCADE` depuis la recommandation parente uniquement). Un
  membre référencé doit appartenir au `household_snapshot` figé de la
  session (`sessionMembersFor`) — jamais une lecture directe et vivante de
  `household_members`.

**Index UNIQUE PARTIEL** (empêche au niveau SQLite lui-même qu'une
recommandation `validated` ait plus d'un successeur **actif** à la fois,
tout en autorisant un nouvel essai après abandon du précédent — syntaxe
vérifiée empiriquement compatible SQLite/`better-sqlite3` avant
implémentation) :
```sql
CREATE UNIQUE INDEX idx_advisory_recommendations_one_non_dismissed_successor
ON advisory_recommendations(supersedes_recommendation_id)
WHERE supersedes_recommendation_id IS NOT NULL
  AND status <> 'dismissed';
```
Vérifié par une matrice de tests SQL bruts (plusieurs successeurs
`dismissed` acceptés, un deuxième successeur `draft`/`validated` rejeté,
sources indépendantes toujours autorisées), une migration réelle depuis une
base héritée en v11, des redémarrages répétés, et deux VRAIES connexions
`better-sqlite3` concurrentes sur le même fichier (verrouillage WAL observé,
puis violation d'unicité).

**Aucun `CHECK` déclaratif** sur les colonnes-énumération — convention déjà
en vigueur, reconduite à l'identique.

**Compatibilité** : migration strictement additive, aucune table existante
modifiée. Aucune donnée existante réécrite.

**Réversibilité** : `DROP TABLE` des 3 tables dans l'ordre inverse de
création (`advisory_recommendation_members` → `advisory_recommendation_findings`
→ `advisory_recommendations`) — aucune donnée hors de ce module n'est
affectée, aucune recommandation réelle n'existant encore à ce stade.

**Précautions avant déploiement** : sauvegarde préalable obligatoire ; cette
migration n'a, à ce jour, jamais été exécutée sur la base de production.

*(Statut : structure confirmée dans le code — `server/db.js`, bloc
`if (version < 12)`. Testée dans `test/migrations.test.js` : base neuve,
migration réelle depuis une base héritée en v11, idempotence, redémarrages
répétés, les 3 tables et l'absence des tables hors périmètre (produit/
assureur/`advisory_consents`/`advisory_reports`), les colonnes attendues
(dont l'absence de `category`/`presented_to_client`/`client_decision`),
l'index unique partiel (présence/unicité/caractère partiel/SQL exact du
WHERE/matrice complète des statuts), deux connexions `better-sqlite3`
réelles. Cette migration s'exécute dans une transaction SQLite unique.)*
