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

## Version 9 (Acquisition OS — implémentée, lot A2a)

**Statut : implémentée.** La réservation notationnelle posée au Lot A0 est
désormais une migration réelle dans `server/db.js` (bloc
`if (version < 9)`), sur la branche `feature/acquisition-os`
(worktree `/home/user/crm-legrand-conseils-acquisition`). Elle appartient à
Acquisition OS et **ne doit être réutilisée par aucune autre branche**
(en particulier pas par `feature/lead-generation-engine`, qui reste sur la
réservation v7 ci-dessous).

Récapitulatif des numéros engagés, pour éviter toute collision :

| Version | Statut | Portée |
|---|---|---|
| 7 | **Réservée** | Branche historique non fusionnée `feature/lead-generation-engine` (Bloc 4 « partenaires/recommandations »). Ne pas réutiliser ce numéro pour un autre module tant que cette branche n'est pas tranchée. |
| 8 | **Utilisée** | Tables satellites de contrats par branche d'assurance (voir section « Version 8 » ci-dessus), déjà présente dans `server/db.js` de ce dépôt. |
| 9 | **Utilisée — Acquisition OS** | Table `appointments` (rendez-vous réels, datés, rattachés à `clients`). Lot A2a, `server/routes/`, aucune API/UI/intégration pipeline dans ce lot. |

**Objectif** : rendez-vous réels et datés, distincts du plan d'action
quotidien (`today.js`, non persistant) et des tâches (`tasks`, sans heure).
Rattaché à `clients.id` — pas de nouvelle entité prospect créée.

**Table créée** : `appointments` — `id`, `client_id` (FK `clients(id)`,
sans `ON DELETE CASCADE`, cohérent avec l'absence de suppression physique
des clients dans tout le schéma), `starts_at`/`ends_at` (TEXT, format
`datetime('now')` du projet, contrainte `CHECK (ends_at > starts_at)`),
`status` (TEXT, défaut `booked`, sans CHECK — comme tous les autres statuts
texte du schéma, validé côté API), `appointment_type` (TEXT, défaut
`other`), `location_type` (TEXT, défaut `in_person`), `location`,
`meeting_url`, `notes`, `created_at`/`updated_at`.

**Index créés** : `idx_appointments_client` (recherche par client),
`idx_appointments_starts_at` (tri/recherche par date),
`idx_appointments_status` (filtrage par statut).

**Compatibilité** : migration strictement additive — aucune table ni colonne
existante n'est modifiée. Base déjà en version 8 : migre proprement vers 9.

**Réversibilité** : un `DROP TABLE appointments` est possible sans casser le
reste du schéma (aucune autre table n'y fait référence en clé étrangère à
ce jour).

**Précautions avant déploiement** : sauvegarde préalable obligatoire ; cette
migration n'a, à ce jour, jamais été exécutée sur la base de production —
elle n'existe que sur `feature/acquisition-os`.
