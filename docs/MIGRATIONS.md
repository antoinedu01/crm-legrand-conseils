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
