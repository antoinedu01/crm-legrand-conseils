# Déploiement de l'environnement QA (préparation — QA-INFRA1 / QA-INFRA1-HARDEN)

> **CADRAGE UNIQUEMENT — AUCUN DÉPLOIEMENT RÉALISÉ.** Ce document et les
> fichiers `deploy/install-qa.sh`, `deploy/crm-qa.service.template`,
> `.env.qa.example` préparent un environnement QA persistant destiné à un
> **VPS DISTINCT de la production**. Aucun VPS n'a été contacté, aucun DNS
> créé, aucune configuration de reverse proxy modifiée, aucun contenu Santé
> v2 publié. L'exécution réelle de `install-qa.sh` (mode `--apply`) est
> réservée à QA-INFRA2, après validation humaine explicite.

---

## RESSOURCES INTERDITES

**Aucun script QA de ce dépôt ne doit jamais toucher aux ressources
suivantes.** `deploy/install-qa.sh` les refuse explicitement (voir §4) ;
tout script QA futur doit reprendre la même liste :

| Ressource | Valeur interdite |
|---|---|
| Hostname | `crm.legrandconseils.ch` |
| Dossier application | `/home/crm/app` |
| Dossier données | `/home/crm/app/data` |
| Service systemd | `crm` |
| Port | `3000` (port de production connu) |
| Base de données | `crm.sqlite` de production (jamais lue, copiée, ou utilisée comme seed) |

Aucun script QA ne doit : `restart crm`, `stop crm`, `enable crm`, écrire
dans `/home/crm/app`, lire/copier `crm.sqlite` de production, ou seed la
base de production.

---

## 0. Pourquoi QA ne peut pas toucher la production

Dix couches indépendantes, dont **aucune seule** n'est le mécanisme de
protection : si l'une était contournée ou mal configurée, les autres
tiennent encore.

1. **VPS distinct** — QA est destiné à une machine physiquement séparée de
   la production (aucune des deux n'a de visibilité sur l'autre).
2. **Utilisateur système distinct** — `crm-qa` ≠ `crm`, refusé explicitement.
3. **Service systemd distinct** — `crm-qa` (liste blanche par suffixe
   `-qa`) ≠ `crm`, jamais une commande `systemctl` ne référence `crm`.
4. **Chemins whitelistés** — `QA_APP_DIR`/`QA_DATA_DIR` doivent être sous
   `/home/$QA_USER/` après résolution des liens symboliques (`realpath -m`),
   jamais seulement « différents » des chemins de production.
5. **Base de données distincte** — SQLite QA neuve, jamais une copie ni un
   accès à `crm.sqlite` de production.
6. **Hostname distinct** — `crm.legrandconseils.ch` explicitement refusé si
   fourni comme `QA_HOSTNAME`.
7. **Barrière d'intention `--apply`** — aucune mutation n'est possible sans
   ce mode explicite, distinct de `--dry-run` (voir §4).
8. **Confirmations doubles** — `QA_DEPLOY_ALLOW=1` **ET**
   `QA_DEPLOY_CONFIRM=QA_ONLY` pour muter quoi que ce soit ; `--reset` exige
   **en plus** `QA_CONFIRM_RESET=RESET_QA_ONLY`.
9. **SHA de déploiement explicite** — évite un `git pull` aveugle qui
   pourrait, par erreur humaine ailleurs, pointer vers un mauvais dépôt/état.
10. **Secrets distincts** — session, mot de passe conseiller : jamais
    partagés avec la production, jamais commités (voir §7).

Notez explicitement ce qui **n'est pas** dans cette liste : `NODE_ENV`. Voir
§5 — ce n'est délibérément pas un mécanisme d'isolement dans ce dépôt.

## 1. Architecture cible

| Élément | Production (`deploy/install.sh`) | QA (`deploy/install-qa.sh`) |
|---|---|---|
| Utilisateur système | `crm` | `crm-qa` |
| Dossier application | `/home/crm/app` | `/home/crm-qa/app` |
| Dossier données | `/home/crm/app/data` (sous l'app) | `/home/crm-qa/data` (à côté de l'app) |
| Service systemd | `crm` | `crm-qa` |
| `NODE_ENV` | `production` | `production` par défaut (voir §5 — décision, pas un mécanisme d'isolement) |
| Port | `3000` | `3001` (configurable via `QA_PORT`, proposé sauf conflit démontré) |
| Hostname | `crm.legrandconseils.ch` | `qa.crm.legrandconseils.ch` (recommandation conceptuelle — **configurable**, jamais supposé exister, jamais contacté par ce lot) |
| Base de données | réelle, sauvegardée nuit et jour | SQLite **neuve**, jamais une copie de production |
| Exécution mutante | — | **jamais** sans `--apply` + confirmations (voir §4) |

`CRM_DATA_DIR` QA = `/home/crm-qa/data` (jamais imbriqué sous
`/home/crm/app`, jamais un chemin libre non vérifié — voir §4).

## 2. Séparation production/QA — différences nécessaires documentées

Audit de `deploy/install.sh` (production) : script idempotent, root
requis, crée l'utilisateur `crm`, clone dans `/home/crm/app`, service
systemd `crm` avec `NODE_ENV=production`/`PORT=3000`, HTTPS via Caddy
(écrit `/etc/caddy/Caddyfile`), sauvegardes nocturnes cron, mises à jour de
sécurité automatiques.

`install-qa.sh` **réutilise** ces patterns fiables (structure en étapes,
`set -euo pipefail`, service `Restart=on-failure`, utilisateur système
dédié, `ReadWritePaths` limité au dossier de données) mais **ne copie pas
aveuglément** les chemins/service production. Différences volontaires :

1. **Tous les identifiants sont dérivés de constantes QA distinctes**
   (`QA_USER`, `QA_APP_DIR`, `QA_DATA_DIR`, `QA_SERVICE`, `QA_PORT`,
   `QA_HOSTNAME`), jamais des littéraux partagés avec `install.sh`.
2. **Garde-fous fail-closed explicites** (§4) : `install.sh` n'a aucune
   raison de refuser ses propres valeurs de production ; `install-qa.sh`
   doit au contraire les refuser activement.
3. **Barrière d'intention `--apply`** (§4, absente d'`install.sh`) : la
   production n'a qu'un seul mode d'exécution ; QA exige un choix explicite
   entre prévisualisation et mutation réelle, avec confirmations distinctes
   pour cette dernière.
4. **Aucune écriture de reverse proxy** dans `install-qa.sh` (§9) —
   `install.sh` écrit `/etc/caddy/Caddyfile` directement ; ce lot l'interdit
   explicitement, reporté à QA-INFRA2.
5. **Déploiement par SHA explicite recommandé** (§13) plutôt que
   `git reset --hard origin/<branche>` sans réflexion, pour un environnement
   QA dont la reproductibilité doit être vérifiable précisément.
6. **Pas de sauvegarde externe (Swiss Backup)** : `deploy/setup-swissbackup.sh`
   n'est pas répliqué pour QA à ce stade (§12) — une copie locale datée
   suffit.
7. **Le service QA ne redémarre jamais rien d'autre que lui-même** — aucune
   commande `systemctl` de `install-qa.sh` ne référence `crm`.
8. **Durcissement systemd renforcé** (§8) : `ProtectSystem=strict` +
   `ProtectHome=read-only` + `PrivateTmp=true` + `UMask=0077`, au-delà de ce
   qu'utilise `install.sh`.

## 3. Fichiers créés/modifiés (ce lot + QA-INFRA1-HARDEN)

| Fichier | Rôle |
|---|---|
| `deploy/install-qa.sh` | Script d'installation/reset QA, fail-closed, barrière `--dry-run`/`--apply` |
| `deploy/crm-qa.service.template` | Gabarit systemd QA durci (jetons substitués par le script) |
| `.env.qa.example` | Référence de variables QA, placeholders uniquement |
| `docs/advisory/QA_DEPLOYMENT.md` | Ce document |
| `test/deploy-install-qa.test.js` | Tests des garde-fous et de la barrière d'intention |
| `test/qa-health-provision-persistent.test.js` | Tests du mode `QA_PERSISTENT` de provisioning |
| `scripts/qa-health-provision.mjs` | **Modifié** (déjà commité) : ajout du mode `QA_PERSISTENT=1` (§6) |

Aucun autre fichier n'a été créé ou modifié (voir `git diff --stat` dans le
rapport final).

## 4. `install-qa.sh` — barrière d'intention et garde-fous (fail-closed)

### 4.1 Barrière d'intention (`--dry-run` / `--apply`)

**Constat corrigé** : la version précédente déclenchait une exécution
réelle dès lors que le script tournait en root avec `QA_DEPLOY_ALLOW=1` —
un incident de manipulation l'a démontré (voir le rapport final, section
incident). Ce n'est plus possible.

- **Aucun mode sélectionné** (ni `--dry-run` ni `--apply`) → refus
  immédiat, aide courte affichée, **aucune mutation, aucune lecture des
  variables QA_***.
- **`--dry-run` et `--apply` simultanément** → refus (ambiguïté).
- **`--dry-run`** : prévisualisation uniquement. Calcule la configuration,
  applique tous les garde-fous, affiche le plan, s'arrête. Ne nécessite ni
  root, ni réseau, ni systemd, ni VPS.
- **`--apply`** : seul mode pouvant muter la machine. Exige **en plus**,
  simultanément :
  - `QA_DEPLOY_ALLOW=1`
  - `QA_DEPLOY_CONFIRM=QA_ONLY`

  Root seul + `QA_DEPLOY_ALLOW=1` seul + `--apply` seul ne suffisent
  individuellement à rien : les trois plus la confirmation distincte sont
  tous nécessaires.
- **`--reset --apply`** : exige **en plus** des deux confirmations
  ci-dessus une troisième, distincte :
  - `QA_CONFIRM_RESET=RESET_QA_ONLY`

  `--reset --dry-run` reste une prévisualisation pure (aucune suppression,
  aucune confirmation requise au-delà de `QA_DEPLOY_ALLOW=1`).

### 4.2 Garde-fous de configuration (fail-closed)

Le script refuse (message explicite, code de sortie 1, **avant** toute
commande réseau/root/systemd) si :

- `QA_DEPLOY_ALLOW` n'est pas exactement `1` ;
- `QA_USER` n'est pas un nom d'utilisateur Unix minuscule valide, ou = `crm` ;
- `QA_APP_DIR` n'est pas un chemin absolu **sous `/home/$QA_USER/`** (liste
  blanche — pas seulement différent de `/home/crm/app`), après résolution
  des liens symboliques (`realpath -m`) ;
- `QA_DATA_DIR` : mêmes règles que `QA_APP_DIR`, plus : doit être
  **exactement** `/home/$QA_USER/data` (jamais un autre sous-dossier, ni
  identique à `QA_APP_DIR`) ;
- `QA_SERVICE` ne se termine pas par `-qa` (liste blanche — pas seulement
  différent de `crm`), ou = `crm` ;
- `QA_HOSTNAME` (si défini) = `crm.legrandconseils.ch` ;
- `QA_PORT` = `3000` ;
- `QA_REPO` ne commence pas par `https://` ou `git@` ;
- `QA_BRANCH` contient des caractères hors `[A-Za-z0-9._/-]` ou commence par
  `-` ;
- `QA_DEPLOY_SHA` (si défini) n'est pas un SHA git hexadécimal minuscule de
  7 à 40 caractères.

**Correction post-revue de sécurité (QA-INFRA1, avant commit)** : la
première version n'excluait que les littéraux de production exacts pour
`QA_APP_DIR`/`QA_DATA_DIR`/`QA_SERVICE` — une revue `deployment-safety`
ciblée a démontré que `QA_DATA_DIR=/etc` passait alors toutes les
vérifications et atteignait `rm -rf` en mode réel, et que `QA_SERVICE=sshd`
aurait pu écraser une unité systemd sans rapport. Remplacé par des listes
blanches strictes (ci-dessus) plutôt que de simples exclusions. La même
revue a identifié l'absence de résolution des liens symboliques avant
comparaison (corrigé via `realpath -m`) et l'absence de validation de
format sur `QA_REPO`/`QA_BRANCH`/`QA_DEPLOY_SHA` (vecteur d'injection
d'arguments git, corrigé par liste blanche de format).

**Constat corrigé (QA-INFRA1-HARDEN)** : `NODE_ENV=production` est
AUTORISÉ ET RECOMMANDÉ pour le service QA — le script ne refuse plus cette
valeur (voir §5). Le mot « production » désigne ici uniquement le mode
runtime Node, jamais l'environnement métier — la séparation QA/production
ne repose jamais sur `NODE_ENV`, seulement sur les couches listées en §0
(VPS distinct, utilisateur, chemins, service, base, hostname,
confirmations, secrets).

Avant toute commande destructive, le script affiche systématiquement :
`MODE`, `QA APP DIR`, `QA DATA DIR`, `QA SERVICE`, `QA PORT`, `QA HOSTNAME`,
`QA_NODE_ENV` (et le SHA/branche cible).

## 5. Décision NODE_ENV (audit QA-INFRA1-HARDEN §5)

**Audit effectué** : recherche exhaustive de `NODE_ENV`/`process.env.NODE_ENV`
dans `server/`, `client/src/`, `vite.config.js`, et dans les dépendances
directes (`express`, `express-session`, `express-rate-limit`, `bcryptjs`,
`better-sqlite3`).

**Constat** : **zéro** référence à `NODE_ENV` dans le code propre à ce
dépôt (`server/`, `client/src/`, `vite.config.js`). Aucune des protections
suivantes n'en dépend : cookies de session (`secure: 'auto'` dépend de
`req.secure`/`trust proxy`, jamais de `NODE_ENV`), anti-CSRF (s'exécute
inconditionnellement), messages d'erreur (gestionnaire personnalisé,
toujours le même message générique, jamais de stack trace exposée au
client, `NODE_ENV` ou pas), `trust proxy` (fixé explicitement à `1`,
inconditionnel), CORS (aucun mécanisme CORS générique, uniquement le
contrôle anti-CSRF Origin/Host), limitation de débit (inconditionnelle),
en-têtes de sécurité (`X-Content-Type-Options`, CSP, etc. — inconditionnels),
fichiers statiques (`express.static` sans configuration conditionnelle),
journalisation (`console.error` inconditionnel côté serveur uniquement,
jamais renvoyé au client). Seules deux dépendances lisent `NODE_ENV` en
interne, et ni l'une ni l'autre n'affecte ce dépôt : Express l'utilise pour
la mise en cache des vues (aucune vue utilisée ici) et un gestionnaire
d'erreur par défaut interne, toujours court-circuité par le gestionnaire
personnalisé de `server/app.js` ; `express-session` ne l'utilise que pour
émettre un avertissement de démarrage sur `MemoryStore` en production
(non pertinent : ce dépôt utilise `SqliteSessionStore`, jamais
`MemoryStore`).

**Décision** : QA utilise `NODE_ENV=production` par défaut (configurable
via `QA_NODE_ENV`), **la même valeur que la production réelle**. Raisons :

1. Aucune protection de sécurité n'en dépend dans ce dépôt — ce n'est
   qu'une étiquette.
2. `development` serait trompeur : rien dans la façon dont le service QA
   tourne réellement (même point d'entrée `node server/index.js`, mêmes
   fichiers construits via `npm run build`, aucun serveur de développement
   Vite, aucun rechargement à chaud) ne correspond à un mode « développement ».
3. Faire tourner QA exactement comme la production limite le risque
   « fonctionne en QA, casse en production » si un futur changement de code
   venait un jour à dépendre réellement de `NODE_ENV` — c'est précisément
   le rôle d'un environnement QA.

**L'isolement vis-à-vis de la vraie production ne repose jamais sur
`NODE_ENV`** — uniquement sur les couches listées en §0 (utilisateur,
chemins, service, hostname, base, confirmations `--apply`).

## 6. Mot de passe conseiller QA — mode persistant

`scripts/qa-health-provision.mjs` (déjà commité, modifié dans ce sous-lot)
avait un mot de passe fixe (`QaE2eTest#2026Local!`) adapté à son usage
originel : bases **éphémères**, créées et supprimées dans la même exécution
de test automatisé, jamais exposées. Inadapté tel quel à un environnement
persistant.

**Changement** : nouvelle variable `QA_PERSISTENT=1`.

- **`QA_PERSISTENT=1`** : exige `QA_ADVISER_PASSWORD` (sinon refus
  immédiat, aucun compte créé). Le mot de passe fourni n'est **jamais**
  affiché sur stdout, et **jamais** écrit dans le manifeste JSON produit
  par le script (`adviser.password` vaut `null` dans ce mode — le
  manifeste persiste sur le disque de l'hôte QA au-delà de l'exécution,
  contrairement au cas éphémère ci-dessous).
- **Sans `QA_PERSISTENT`** (comportement par défaut, inchangé) : le mot de
  passe fixe existant est conservé **uniquement** pour ce cas — usage
  éphémère déjà validé (QA-E2E1, `scripts/qa-health-e2e-playwright.mjs`),
  base temporaire supprimée après le test. Ce choix évite de casser un flux
  automatisé déjà en production de test, et le mot de passe fixe n'est de
  toute façon jamais accessible depuis un environnement persistant réel
  (bloqué explicitement dès que `QA_PERSISTENT=1`).

**Garde-fou anti-erreur-opérateur (constat revue conformité, ajouté avant
commit)** : rien n'empêchait initialement d'oublier `QA_PERSISTENT=1` par
erreur lors d'un provisioning réel sur le futur VPS QA, ce qui aurait
silencieusement créé un compte avec le mot de passe fixe. Corrigé par un
garde-fou fail-closed supplémentaire : en mode par défaut (sans
`QA_PERSISTENT=1`), le script refuse désormais si `CRM_DATA_DIR` n'est pas
sous le répertoire temporaire du système (`os.tmpdir()`, typiquement
`/tmp`) — un chemin hors de `/tmp` doit donc obligatoirement passer par
`QA_PERSISTENT=1` (et fournir `QA_ADVISER_PASSWORD`), y compris par
inadvertance.

**Limite résiduelle connue (revue de sécurité, non bloquante)** : `QA_ADVISER_PASSWORD`
passé en ligne de commande reste visible le temps de l'exécution via
`/proc/<pid>/environ` et peut atterrir dans l'historique shell de
l'opérateur — limite inhérente à tout secret passé en variable
d'environnement CLI, pas spécifique à ce script. Pour QA-INFRA2, préférer
si possible une invocation qui évite l'historique (ex. `read -rs` interactif
avant d'exporter la variable, ou un fichier temporaire à permissions
restreintes lu puis supprimé) plutôt qu'un mot de passe en clair dans la
commande elle-même.

Procédure prévue pour QA-INFRA2 (provisioning persistant) :

```bash
QA_PERSISTENT=1 QA_ADVISER_PASSWORD='<choisi hors Git>' \
  QA_E2E_ALLOW=1 CRM_DATA_DIR=/home/crm-qa/data QA_MODE=main \
  node scripts/qa-health-provision.mjs
```

## 7. Secrets du service persistant

| Secret | Où | Quand | Dans Git ? | Dans le service au runtime ? |
|---|---|---|---|---|
| `SESSION_SECRET` | `/etc/crm-qa.env` (optionnel) ou auto-généré dans `CRM_DATA_DIR/.session-secret` (0600) | Démarrage du service | Jamais | Oui (nécessaire en continu) |
| `QA_ADVISER_PASSWORD` | Ligne de commande uniquement, au provisioning | Une seule fois, à la création du compte | Jamais | **Non** — jamais dans `/etc/crm-qa.env` ni dans l'unité systemd |

**Distinction importante** : `QA_ADVISER_PASSWORD` n'est consommé qu'une
fois, par `qa-health-provision.mjs`, pour hacher (bcrypt) et insérer le
compte conseiller en base — il n'a plus aucune utilité pour le service en
fonctionnement normal (celui-ci ne lit jamais ce mot de passe en clair,
seulement le hash déjà stocké). Il ne doit donc jamais persister dans la
configuration du service.

**`SESSION_SECRET`** : si absent, `server/app.js` en génère un
automatiquement au premier démarrage et le persiste dans
`CRM_DATA_DIR/.session-secret` (permissions `0600`) — ce mécanisme existant
suffit dans la plupart des cas et ne nécessite aucune action. Pour fixer
volontairement un secret externe (rotation, réutilisation contrôlée),
`deploy/crm-qa.service.template` déclare :

```ini
EnvironmentFile=-/etc/crm-qa.env
```

Le tiret initial rend le fichier optionnel (le service démarre normalement
s'il est absent ou vide). `install-qa.sh --apply` crée ce fichier **vide**
s'il n'existe pas déjà (`install -m 600 -o root -g root /dev/null
/etc/crm-qa.env`) — le script ne génère, ne connaît et n'écrit jamais de
valeur de secret ; l'opérateur le remplit manuellement après coup s'il le
souhaite. Permissions vérifiées : `600`, propriétaire `root:root` — hors de
`/home/crm-qa/app` (donc hors du dépôt Git cloné), hors de Git par
construction (jamais dans le dépôt), jamais affiché par `install-qa.sh`.

## 8. Durcissement systemd — vérification de l'interaction

`ReadWritePaths` seul n'est pas une sandbox d'écriture sans les directives
`Protect*` qui restreignent le reste de l'arborescence — un audit du
gabarit était donc nécessaire avant de le considérer réellement effectif.

```ini
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/crm-qa/data
UMask=0077
```

**Interaction `ProtectHome=read-only` / `ReadWritePaths` vérifiée** (contre
la documentation `systemd.exec(5)`) : `ProtectHome=read-only` rend
`/home`, `/root`, `/run/user` en lecture seule pour cette unité —
`/home/crm-qa/app` (le code) reste donc **lisible** (Node doit pouvoir
charger ses propres fichiers et `node_modules`) mais jamais inscriptible au
runtime, ce qui est le comportement voulu (le code ne doit jamais
s'auto-modifier pendant l'exécution). Les chemins listés dans
`ReadWritePaths` ont priorité sur `ProtectHome`/`ProtectSystem` pour ce
chemin précis (comportement documenté de systemd) : c'est ce qui rend
spécifiquement `/home/crm-qa/data` inscriptible malgré
`ProtectHome=read-only` — nécessaire pour que SQLite (`crm.sqlite`,
`.session-secret`) puisse y écrire. `ProtectSystem=strict` étend cette
protection en lecture seule à la quasi-totalité du reste du système
(`/usr`, `/boot`, `/etc`, etc.), au-delà de `full` utilisé en production.

**Limite de cette vérification** : elle est faite par lecture attentive de
`systemd.exec(5)` et par cohérence avec le gabarit — cet environnement de
développement n'a pas de systemd réel (`systemctl`/`journalctl` y échouent
immédiatement, absence de PID 1 systemd), donc **aucun test empirique
« service réellement démarré sous ces contraintes » n'a pu être exécuté**
dans ce lot. À vérifier une fois sur le vrai VPS QA (QA-INFRA2), avant
exposition.

## 9. Reverse proxy / HTTPS — préparation uniquement, rien exécuté

`install.sh` (production) installe Caddy et écrit `/etc/caddy/Caddyfile`
directement. **`install-qa.sh` ne fait rien de tout cela** — même en mode
`--apply`, il se contente d'afficher un rappel. Aucune configuration
Nginx/Caddy/Apache n'est modifiée par ce lot, aucun service Let's Encrypt
n'est contacté.

Commandes prévues pour **QA-INFRA2** (hostname `QA_HOSTNAME` à choisir,
jamais présumé exister) :

```bash
# Exemple Caddy (à exécuter uniquement en QA-INFRA2, après validation) :
cat > /etc/caddy/Caddyfile <<EOF
${QA_HOSTNAME} {
    reverse_proxy localhost:${QA_PORT}
    header Strict-Transport-Security "max-age=31536000"
}
EOF
systemctl reload caddy || systemctl restart caddy
```

## 10. Healthcheck

Endpoint existant réutilisé (aucun nouvel endpoint créé) : `GET
/api/auth/status` (`server/auth.js`) — non authentifié, sans effet de bord,
interroge la base (`SELECT COUNT(*) FROM users`) donc exerce à la fois le
serveur HTTP et la couche DB.

```bash
# Local, sur le VPS QA lui-même :
curl -s http://localhost:3001/api/auth/status
# Après configuration du reverse proxy (QA-INFRA2) :
curl -s https://<hostname QA>/api/auth/status
```

## 11. Logs / systemd

```bash
systemctl status crm-qa
journalctl -u crm-qa
systemctl restart crm-qa
```

Jamais `systemctl ... crm`. `Restart=on-failure` (comportement fiable,
compatible avec la production qui utilise `Restart=always` — QA tolère un
arrêt volontaire sans redémarrage automatique, utile en debug).

## 12. Backup / reset QA

Pas de Swiss Backup pour QA à ce stade. `install-qa.sh --reset --apply`
écrit une copie locale datée de `CRM_DATA_DIR/crm.sqlite` vers
`/home/crm-qa/backups-qa/` avant toute suppression (voir §4). Les
sauvegardes QA et production ne sont **jamais** mélangées (dossiers,
comptes système et scripts entièrement distincts).

## 13. Déploiement de code (QA-INFRA2)

Le futur VPS QA devra utiliser explicitement la branche
`claude/insurance-broker-crm-exx09v`, **idéalement un commit SHA précis**
via `QA_DEPLOY_SHA` plutôt qu'un `git pull`/`reset --hard` aveugle sur la
branche. `install-qa.sh` supporte déjà les deux (SHA explicite prioritaire
si fourni, sinon HEAD de la branche avec avertissement). Le SHA initial
attendu sera celui validé au moment du déploiement réel (QA-INFRA2).

## 14. QA-E2E sur le VPS (après déploiement, QA-INFRA2)

`scripts/qa-health-e2e-playwright.mjs` sera relancé, **sans aucune
modification spécifique au VPS**, contre le hostname QA :

```bash
QA_BASE_URL=https://<hostname QA> \
QA_MANIFEST=<manifeste produit par qa-health-provision.mjs> \
QA_DATA_DIR=/home/crm-qa/data \
QA_OUT_DIR=<dossier de résultats> \
node scripts/qa-health-e2e-playwright.mjs
```

avec les mêmes scénarios A→K déjà validés localement (QA-E2E1). Point
opérationnel à noter pour QA-INFRA2 : le script effectue aussi des lectures
SQLite directes (assertions `audit_log`/recommandations) via `QA_DATA_DIR`
— il doit donc s'exécuter **sur le VPS QA lui-même** (ou avec un accès
filesystem local à ce dossier), pas depuis une machine tierce qui n'aurait
qu'un accès HTTP au hostname.

## 15. Rollback QA

- **Code** : `git checkout <SHA précédent>` dans `QA_APP_DIR`, puis
  `npm install && npm run build && systemctl restart crm-qa`.
- **Base** : restaurer une copie SQLite QA depuis
  `/home/crm-qa/backups-qa/` (jamais depuis une sauvegarde de production).
- **Service** : `systemctl restart crm-qa` — jamais `crm`.

Aucune interaction avec la production à aucune étape du rollback QA.

## 16. Hors périmètre de QA-INFRA1 / QA-INFRA1-HARDEN

- aucun VPS contacté ;
- aucun DNS créé/modifié ;
- aucune configuration reverse proxy écrite ;
- aucune publication de contenu Santé v2 ;
- aucune exécution réelle (`--apply`) d'`install-qa.sh` ;
- aucun commit.

Passage à QA-INFRA2 uniquement après validation humaine explicite.
