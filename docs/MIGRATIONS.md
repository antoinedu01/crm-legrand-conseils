# Migrations de la base de données

Le schéma est versionné avec `PRAGMA user_version` (voir `server/db.js`).
Chaque migration s'applique automatiquement et une seule fois au démarrage, dans
une transaction. Il n'existe pas de dossier `migrations/` séparé : toute la
logique vit directement dans `server/db.js`.

> **Note de méthode.** Ce document distingue deux niveaux de certitude :
> - **Confirmé dans le code** : vérifiable par simple lecture de `server/db.js`
>   (présence des instructions SQL, structure des transactions).
> - **À tester** : comportement qui ne peut être garanti avec certitude qu'en
>   l'exécutant réellement dans un environnement isolé (jamais sur la base de
>   production) — notamment l'effet exact d'un `DROP` sur des données déjà
>   présentes, ou les interactions avec des données réelles accumulées.
>
> Ce document est un guide opérationnel interne, pas un avis juridique. Toute
> question de conformité nLPD/LSA relative à une migration doit faire l'objet
> d'une vérification humaine séparée.

## Procédure générale de sauvegarde préalable

**Avant toute mise à jour du CRM (code ou base) : faites une sauvegarde.**

1. Application déjà démarrée et accessible : **Paramètres → « Télécharger une
   sauvegarde complète »** (route `GET /api/backup`, authentifiée) — produit une
   copie cohérente via l'API `.backup()` de SQLite, journalisée dans l'audit.
   *(Confirmé dans le code : `server/app.js`.)*
2. Accès direct au serveur (alternative ou complément) : copier `data/crm.sqlite`
   **ainsi que** les fichiers `data/crm.sqlite-wal` et `data/crm.sqlite-shm`
   (mode WAL actif — une copie du seul fichier `.sqlite` pendant que le service
   tourne peut être incohérente). Le plus sûr : arrêter le service (`systemctl
   stop crm`) avant la copie, ou utiliser la sauvegarde automatisée nocturne
   (`/home/crm/backup.sh`, voir `deploy/install.sh`) qui utilise déjà la commande
   `.backup` de sqlite3, cohérente à chaud.
3. Conserver la sauvegarde **hors du serveur** si possible (Swiss Backup,
   `deploy/setup-swissbackup.sh`) avant toute opération risquée.

## Procédure générale de restauration

1. Arrêter le service : `systemctl stop crm`.
2. Remettre en place l'ancienne version du code si la migration provenait d'une
   mise à jour de version (`git checkout` de la version précédente, ou restaurer
   depuis le dernier commit connu-bon) — **à faire par un humain, jamais
   automatiquement**.
3. Remplacer `data/crm.sqlite` (et supprimer/remplacer `-wal`/`-shm` associés)
   par la sauvegarde retenue.
4. Redémarrer le service : `systemctl start crm`.
5. Vérifier `GET /api/auth/status` et un dossier client au hasard avant de
   considérer la restauration terminée.

*Cette procédure est générale et confirmée par la structure du code de
déploiement (`deploy/install.sh`, `server/app.js`) ; le détail des commandes
exactes reste à valider en conditions réelles sur l'environnement concerné
avant une restauration critique — **à tester**.*

## Version 1

| Changement | Retour en arrière |
|---|---|
| `clients.owner_user_id` (colonne nullable, prépare le multi-conseiller) | colonne ignorée par l'ancien code — aucune action nécessaire |
| Index `idx_clients_email`, `idx_clients_phone` (détection de doublons) | `DROP INDEX idx_clients_email; DROP INDEX idx_clients_phone;` |
| Table `sessions` (sessions persistantes, créée par `session-store.js`) | `DROP TABLE sessions;` — seule conséquence : tout le monde doit se reconnecter |

*(Statut : confirmé dans le code — `server/db.js`, bloc `if (version < 1)`.)*

## Version 2

**Objectif** : activer la double authentification (2FA / TOTP) pour le compte
courtier.

**Tables / colonnes concernées** : ajout à la table `users` de
`totp_secret TEXT` et `totp_enabled INTEGER NOT NULL DEFAULT 0`.

**Réversibilité** : **réversible avec réserve**. Les deux colonnes sont
ignorées par un code plus ancien qui ne les connaîtrait pas (pas de rupture de
compatibilité descendante). Un retour en arrière technique
(`ALTER TABLE users DROP COLUMN totp_secret; ... DROP COLUMN totp_enabled;`)
supprimerait la 2FA de tout compte qui l'aurait activée — **à faire uniquement
après avoir confirmé qu'aucun utilisateur ne dépend de la 2FA**, sinon il
perdrait la protection sans le savoir tant que le code applicatif n'a pas aussi
été redescendu en version antérieure.

**Précautions avant déploiement** : sauvegarde préalable (voir ci-dessus) ;
vérifier qu'aucune session 2FA n'est « en cours » (`totpSetupSecret` en
session) au moment du redémarrage — sans conséquence pour la base, mais
l'utilisateur devrait recommencer l'activation.

*(Statut : structure des colonnes confirmée dans le code — `server/db.js`,
bloc `if (version < 2)`. Effet réel d'un retrait de colonne en présence de 2FA
active : à tester en environnement isolé.)*

## Version 3

**Objectif** : Bloc 1 du module « Développement du portefeuille » — suivi des
canaux d'acquisition, campagnes, coûts par canal et origine des prospects.

**Tables / colonnes concernées** : création de `channels`, `campaigns`,
`channel_costs`, `lead_details` (clé primaire = `client_id`), plus les index
`idx_lead_details_channel` et `idx_channel_costs_channel`.

**Réversibilité** : **partiellement réversible**. `DROP TABLE` sur les quatre
tables est techniquement possible, mais entraîne une **perte définitive** des
données de suivi d'acquisition (origine des prospects, campagnes, coûts) si
elles ont déjà été renseignées. Aucune donnée personnelle de client n'est
perdue en tant que telle (les tables `clients` ne sont pas touchées), mais le
lien entre un client et son origine commerciale le serait.

**Précautions avant déploiement** : sauvegarde préalable obligatoire si des
données de canaux/campagnes existent déjà ; vérifier qu'aucune requête
applicative ne dépend de `lead_details` avant un éventuel retrait (plusieurs
routes en dépendent : `server/routes/clients.js`, `server/routes/prospects.js`,
`server/routes/channels.js`, `server/scoring.js`).

*(Statut : structure confirmée dans le code — `server/db.js`, bloc
`if (version < 3)`. Impact d'un retrait sur les routes dépendantes : à tester.)*

## Version 4

**Objectif** : Bloc 2 — scoring configurable des prospects (règles à points,
modifiables depuis l'interface).

**Tables / colonnes concernées** : création de `scoring_rules` ; ajout de la
colonne `lead_details.urgent INTEGER NOT NULL DEFAULT 0`.

**Réversibilité** : **partiellement réversible**. `DROP TABLE scoring_rules`
supprimerait toute personnalisation des règles de scoring faite par
l'utilisateur (les règles par défaut sont réinsérées automatiquement au
prochain démarrage si la table est vide — voir le seed dans `server/db.js` —
mais les **modifications** faites depuis l'interface seraient perdues).
Le retrait de la colonne `urgent` ferait échouer le calcul de score
(`server/scoring.js` s'appuie dessus) tant que le code n'est pas lui aussi
redescendu en version antérieure.

**Précautions avant déploiement** : sauvegarde préalable ; si retour en
arrière envisagé, exporter d'abord le contenu de `scoring_rules` pour pouvoir
le restaurer manuellement.

*(Statut : structure confirmée dans le code — `server/db.js`, bloc
`if (version < 4)` ; dépendance de `server/scoring.js` à la colonne `urgent`
confirmée par lecture du code. Comportement exact en cas de retrait à chaud :
à tester.)*

## Version 5

**Objectif** : Bloc 3 — journal des actions commerciales (plan d'action
quotidien du courtier).

**Tables / colonnes concernées** : création de `action_log` (+ index
`idx_action_log_key`).

**Réversibilité** : **réversible**. `DROP TABLE action_log` est possible sans
casser le reste du schéma ; seule conséquence, la perte de l'historique des
actions quotidiennes enregistrées (aucune donnée client primaire n'est
stockée dans cette table au-delà des références `client_id`/`contract_id`).

**Précautions avant déploiement** : sauvegarde préalable si l'historique
d'actions a une valeur (suivi d'activité commerciale) que l'on souhaite
conserver.

*(Statut : confirmé dans le code — `server/db.js`, bloc `if (version < 5)`.)*

## Version 6

**Objectif** : traçabilité horodatée des consentements recueillis via les
formulaires publics du site (exigence nLPD de preuve du consentement).

**Tables / colonnes concernées** : création de `consents` (+ index
`idx_consents_client`).

**Réversibilité** : **non recommandée**. `DROP TABLE consents` supprimerait
des preuves de consentement qui peuvent avoir une portée légale (traçabilité
au sens de la nLPD). Un retour en arrière technique est possible, mais devrait
être précédé d'une **validation humaine explicite** au regard des obligations
de conservation applicables — ce document ne tranche pas cette question,
`Vérification humaine obligatoire` avant toute suppression de cette table.

**Précautions avant déploiement** : sauvegarde préalable systématique ; ne
jamais supprimer cette table dans le cadre d'une opération de routine.

*(Statut : structure confirmée dans le code — `server/db.js`, bloc
`if (version < 6)` ; portée légale exacte de la conservation à faire valider
par un humain, hors périmètre de ce document technique.)*

## Bloc-notes général

- Ne jamais renuméroter ni réécrire une migration déjà appliquée en
  production — toute évolution future doit utiliser un numéro de version
  strictement supérieur au dernier utilisé (actuellement 6). Voir aussi
  `PROJECT_HANDOFF.md` §9 et §10 pour le conflit de numérotation identifié
  avec la branche `feature/lead-generation-engine`.
- Chaque migration ci-dessus s'exécute dans une transaction SQLite
  (`db.transaction(...)`) — en cas d'erreur en cours de migration, SQLite
  annule l'ensemble du bloc (comportement standard des transactions),
  ce qui limite le risque d'un schéma à moitié migré. *(Confirmé dans le code
  par la structure des blocs `db.transaction`.)*
