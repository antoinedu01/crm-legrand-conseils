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
