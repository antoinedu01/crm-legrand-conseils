#!/bin/bash
# QA-INFRA1 — Installation de l'environnement QA persistant (JAMAIS la
# production). Ce script est conçu pour un VPS DISTINCT de la production.
#
# Séparation absolue avec deploy/install.sh (production, service `crm`,
# /home/crm/app) : ce script REFUSE explicitement toute configuration qui
# ressemble à la production (utilisateur, dossiers, service, hostname). Voir
# docs/advisory/QA_DEPLOYMENT.md pour la procédure complète et le détail des
# 10 couches d'isolation indépendantes de la production.
#
# Barrière d'intention (QA-INFRA1-HARDEN) : un incident de manipulation a
# montré qu'« être root + QA_DEPLOY_ALLOW=1 » suffisait auparavant à
# déclencher une exécution réelle. Ce n'est plus vrai. Aucune mutation n'est
# possible sans le mode --apply ET une deuxième confirmation explicite
# distincte (QA_DEPLOY_CONFIRM=QA_ONLY) — voir §2 ci-dessous.
#
# Usage (prévisualisation, aucune mutation, ni root ni réseau ni systemd) :
#   QA_DEPLOY_ALLOW=1 bash deploy/install-qa.sh --dry-run
#
# Usage (exécution réelle, sur le futur VPS QA UNIQUEMENT) :
#   QA_DEPLOY_ALLOW=1 QA_DEPLOY_CONFIRM=QA_ONLY sudo -E bash deploy/install-qa.sh --apply
#
# Usage (réinitialisation réelle de CRM_DATA_DIR QA UNIQUEMENT) :
#   QA_DEPLOY_ALLOW=1 QA_DEPLOY_CONFIRM=QA_ONLY QA_CONFIRM_RESET=RESET_QA_ONLY \
#     sudo -E bash deploy/install-qa.sh --reset --apply
set -euo pipefail

# --- Constantes de production (jamais des valeurs QA) -----------------------
PROD_USER="crm"
PROD_APP_DIR="/home/crm/app"
PROD_DATA_DIR="/home/crm/app/data"
PROD_SERVICE="crm"
PROD_HOSTNAME="crm.legrandconseils.ch"
PROD_PORT="3000"

refuse() {
  echo "REFUS : $1" >&2
  exit 1
}

print_usage_short() {
  cat <<'USAGE'
Usage :
  deploy/install-qa.sh --dry-run [--reset]   Prévisualisation uniquement (aucune mutation).
  deploy/install-qa.sh --apply   [--reset]   Exécution réelle (mutations) -- exige en plus
                                              QA_DEPLOY_ALLOW=1 et QA_DEPLOY_CONFIRM=QA_ONLY
                                              (et QA_CONFIRM_RESET=RESET_QA_ONLY avec --reset).

Un des deux modes (--dry-run ou --apply) est OBLIGATOIRE -- sans l'un des
deux, ce script ne fait rien (ni écriture, ni réseau, ni useradd, ni
systemctl). Voir docs/advisory/QA_DEPLOYMENT.md pour la procédure complète.
USAGE
}

# --- Analyse des options -----------------------------------------------
DRY_RUN=0
APPLY=0
RESET=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --apply) APPLY=1 ;;
    --reset) RESET=1 ;;
    --help|-h)
      print_usage_short
      exit 0
      ;;
    *) refuse "option inconnue : $arg (utilisez --dry-run, --apply, --reset ou --help)" ;;
  esac
done

# Barrière d'intention n°1 : un mode explicite et NON ambigu est obligatoire.
# Ni QA_DEPLOY_ALLOW=1, ni root, ni aucune autre variable ne peut jamais
# remplacer ce choix explicite -- c'est la correction directe de l'incident
# (exécution réelle déclenchée sans intention explicite de muter la machine).
if [ "$DRY_RUN" -eq 0 ] && [ "$APPLY" -eq 0 ]; then
  echo "REFUS : --dry-run ou --apply est obligatoire (aucun mode sélectionné)." >&2
  echo >&2
  print_usage_short >&2
  exit 1
fi
if [ "$DRY_RUN" -eq 1 ] && [ "$APPLY" -eq 1 ]; then
  refuse "--dry-run et --apply sont mutuellement exclusifs -- choisissez l'un des deux."
fi

# --- Configuration QA (toujours dérivée des garde-fous ci-dessous, jamais
# un chemin libre non vérifié — voir docs/advisory/QA_DEPLOYMENT.md §6) -----
QA_USER="${QA_USER:-crm-qa}"
QA_APP_DIR="${QA_APP_DIR:-/home/$QA_USER/app}"
QA_DATA_DIR="${QA_DATA_DIR:-/home/$QA_USER/data}"
QA_SERVICE="${QA_SERVICE:-crm-qa}"
QA_PORT="${QA_PORT:-3001}"
QA_HOSTNAME="${QA_HOSTNAME:-}"
# NODE_ENV : décision QA-INFRA1-HARDEN §5 (voir rapport et QA_DEPLOYMENT.md) --
# l'audit du code n'a trouvé AUCUN comportement de sécurité (cookies, CSRF,
# erreurs, proxy, CORS, rate limiting, en-têtes, fichiers statiques) qui
# dépende de NODE_ENV dans ce dépôt : c'est une étiquette, pas une barrière.
# QA doit donc utiliser la même valeur que la production (`production`),
# exactement comme elle tourne réellement (même point d'entrée, mêmes
# fichiers construits, aucun serveur de développement) -- `development`
# serait trompeur ici. L'isolement vis-à-vis de la vraie production ne
# repose jamais sur NODE_ENV, uniquement sur les couches ci-dessous
# (utilisateur, chemins, service, hostname, base, confirmations).
QA_NODE_ENV="${QA_NODE_ENV:-production}"
QA_REPO="${QA_REPO:-https://github.com/antoinedu01/crm-legrand-conseils.git}"
QA_BRANCH="${QA_BRANCH:-claude/insurance-broker-crm-exx09v}"
QA_DEPLOY_SHA="${QA_DEPLOY_SHA:-}"
QA_BACKUPS_DIR="${QA_BACKUPS_DIR:-/home/$QA_USER/backups-qa}"
QA_ENV_FILE="${QA_ENV_FILE:-/etc/crm-qa.env}"

# --- Garde-fous fail-closed (aucun appel réseau/root/systemd requis) -------
[ "${QA_DEPLOY_ALLOW:-}" = "1" ] || refuse "QA_DEPLOY_ALLOW=1 doit être explicitement défini."

# Format de QA_USER : mêmes règles qu'un nom d'utilisateur Unix classique.
[[ "$QA_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || refuse "QA_USER doit être un nom d'utilisateur Unix valide en minuscules (reçu : « $QA_USER »)."
[ "$QA_USER" != "$PROD_USER" ] || refuse "QA_USER ne peut pas être « $PROD_USER » (utilisateur de production)."

# Les chemins fournis doivent être absolus AVANT résolution -- `realpath -m`
# accepterait silencieusement un chemin relatif en le résolvant contre le
# répertoire courant, ce qui romprait l'exigence explicite du cadrage et le
# rendrait dépendant du cwd d'invocation.
case "$QA_APP_DIR" in
  /*) ;;
  *) refuse "QA_APP_DIR doit être un chemin absolu (reçu : « $QA_APP_DIR »)." ;;
esac
case "$QA_DATA_DIR" in
  /*) ;;
  *) refuse "QA_DATA_DIR doit être un chemin absolu (reçu : « $QA_DATA_DIR »)." ;;
esac

# Résolution des liens symboliques AVANT toute comparaison : un lien à
# l'intérieur d'un chemin QA apparemment valide mais pointant réellement
# vers la production doit être détecté après résolution, jamais sur la
# chaîne brute. `realpath -m` n'exige pas que la cible existe déjà (premier
# déploiement : les dossiers n'existent pas encore).
QA_APP_DIR="$(realpath -m -- "$QA_APP_DIR")"
QA_DATA_DIR="$(realpath -m -- "$QA_DATA_DIR")"

# Liste blanche stricte : QA_APP_DIR et QA_DATA_DIR doivent être sous
# /home/$QA_USER/ -- jamais seulement « différent des littéraux de
# production ». Sans cette liste blanche, QA_DATA_DIR=/etc passerait toutes
# les exclusions suivantes et atteindrait `rm -rf` en mode --reset --apply.
QA_HOME_PREFIX="/home/$QA_USER/"
case "$QA_APP_DIR/" in
  "$QA_HOME_PREFIX"*) ;;
  *) refuse "QA_APP_DIR doit être sous $QA_HOME_PREFIX (reçu après résolution : « $QA_APP_DIR »)." ;;
esac
case "$QA_DATA_DIR/" in
  "$QA_HOME_PREFIX"*) ;;
  *) refuse "QA_DATA_DIR doit être sous $QA_HOME_PREFIX (reçu après résolution : « $QA_DATA_DIR »)." ;;
esac
# QA_DATA_DIR doit être EXACTEMENT le dossier de données attendu (jamais
# QA_APP_DIR lui-même ni un autre sous-dossier de /home/$QA_USER/) : la
# suppression en mode --reset ne doit jamais pouvoir cibler autre chose que
# ce chemin précis.
QA_EXPECTED_DATA_DIR="$(realpath -m -- "/home/$QA_USER/data")"
[ "$QA_DATA_DIR" = "$QA_EXPECTED_DATA_DIR" ] || refuse "QA_DATA_DIR doit être exactement $QA_EXPECTED_DATA_DIR (reçu après résolution : « $QA_DATA_DIR »)."

# Exclusions explicites de la production (redondantes avec la liste blanche
# ci-dessus tant que QA_USER != crm, mais conservées : défense en
# profondeur, et ce sont exactement les littéraux exigés par le cadrage).
[ "$QA_APP_DIR" != "$PROD_APP_DIR" ] || refuse "QA_APP_DIR ne peut pas être « $PROD_APP_DIR » (dossier de production)."
case "$QA_APP_DIR" in
  "$PROD_APP_DIR"/*) refuse "QA_APP_DIR (« $QA_APP_DIR ») est à l'intérieur du dossier de production ($PROD_APP_DIR)." ;;
esac
[ "$QA_DATA_DIR" != "$PROD_DATA_DIR" ] || refuse "QA_DATA_DIR ne peut pas être « $PROD_DATA_DIR » (données de production)."
case "$QA_DATA_DIR" in
  "$PROD_APP_DIR"/*) refuse "QA_DATA_DIR (« $QA_DATA_DIR ») est à l'intérieur du dossier de production ($PROD_APP_DIR)." ;;
esac
# Ni identique, ni imbriqué dans un sens ou dans l'autre (constat revue
# sécurité QA-INFRA1-HARDEN §3b) : QA_APP_DIR == QA_DATA_DIR, ou QA_APP_DIR
# sous QA_DATA_DIR (ex. QA_DATA_DIR/app), ferait que --reset --apply
# supprime le code de l'application en même temps que les données --
# contredit l'invariant documenté « reset ne touche jamais au code ».
[ "$QA_DATA_DIR" != "$QA_APP_DIR" ] || refuse "QA_DATA_DIR ne peut pas être identique à QA_APP_DIR."
case "$QA_APP_DIR/" in
  "$QA_DATA_DIR/"*) refuse "QA_APP_DIR (« $QA_APP_DIR ») est à l'intérieur de QA_DATA_DIR (« $QA_DATA_DIR ») -- --reset supprimerait le code de l'application." ;;
esac

# QA_SERVICE : liste blanche par suffixe -- seulement exclure « crm »
# laisserait passer QA_SERVICE=sshd (ou tout autre service système), qui
# écraserait une unité systemd sans rapport en mode réel. Le suffixe -qa est
# cohérent avec le nom par défaut (crm-qa).
case "$QA_SERVICE" in
  *-qa) ;;
  *) refuse "QA_SERVICE doit se terminer par « -qa » (reçu : « $QA_SERVICE »), pour ne jamais pouvoir cibler un service système existant." ;;
esac
[ "$QA_SERVICE" != "$PROD_SERVICE" ] || refuse "QA_SERVICE ne peut pas être « $PROD_SERVICE » (service de production)."

if [ -n "$QA_HOSTNAME" ]; then
  [ "$QA_HOSTNAME" != "$PROD_HOSTNAME" ] || refuse "QA_HOSTNAME ne peut pas être « $PROD_HOSTNAME » (hostname de production)."
fi

# Format de QA_REPO / QA_BRANCH / QA_DEPLOY_SHA : ces valeurs sont passées à
# `git` ; sans validation, une valeur commençant par « - » serait
# interprétée comme une option (ex. --upload-pack=...), un vecteur connu
# d'injection d'arguments git. Liste blanche stricte plutôt que seulement
# exclure « - » en tête.
[[ "$QA_REPO" =~ ^(https://|git@) ]] || refuse "QA_REPO doit commencer par https:// ou git@ (reçu : « $QA_REPO »)."
[[ "$QA_BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] && [[ "$QA_BRANCH" != -* ]] || refuse "QA_BRANCH contient des caractères non autorisés ou commence par « - » (reçu : « $QA_BRANCH »)."
if [ -n "$QA_DEPLOY_SHA" ]; then
  [[ "$QA_DEPLOY_SHA" =~ ^[0-9a-f]{7,40}$ ]] || refuse "QA_DEPLOY_SHA doit être un SHA git hexadécimal minuscule de 7 à 40 caractères (reçu : « $QA_DEPLOY_SHA »)."
fi

[ "$QA_PORT" != "$PROD_PORT" ] || refuse "QA_PORT ne peut pas être « $PROD_PORT » (port de production)."

# --- Affichage systématique AVANT toute commande destructive ---------------
echo "==========================================================="
echo "  MODE         : $([ "$APPLY" -eq 1 ] && echo 'APPLY (mutations réelles)' || echo 'DRY-RUN (aucune mutation)')"
echo "  QA APP DIR   : $QA_APP_DIR"
echo "  QA DATA DIR  : $QA_DATA_DIR"
echo "  QA SERVICE   : $QA_SERVICE"
echo "  QA PORT      : $QA_PORT"
echo "  QA HOSTNAME  : ${QA_HOSTNAME:-<non défini — configurable, jamais supposé exister>}"
echo "  QA_NODE_ENV  : $QA_NODE_ENV"
echo "  QA_DEPLOY_SHA: ${QA_DEPLOY_SHA:-<non défini — utilisera HEAD de $QA_BRANCH, SHA explicite recommandé>}"
echo "==========================================================="

if [ "$RESET" -eq 1 ]; then
  echo
  echo "=== Mode RESET QA demandé ==="
  echo "1. arrêt de $QA_SERVICE uniquement"
  echo "2. sauvegarde de $QA_DATA_DIR/crm.sqlite (si présent) vers $QA_BACKUPS_DIR"
  echo "3. suppression de $QA_DATA_DIR uniquement (jamais un autre chemin)"
  echo "4. recréation du dossier $QA_DATA_DIR"
  echo "5. redémarrage de $QA_SERVICE uniquement"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "(--dry-run : aucune commande ci-dessus n'a été exécutée.)"
    exit 0
  fi
  # Barrière d'intention n°2 (reset) : --apply seul ne suffit jamais à
  # supprimer des données -- il faut EN PLUS les deux confirmations
  # ci-dessous, distinctes de celles de l'installation. Vérifié AVANT le
  # contrôle root pour rester testable sans privilèges.
  [ "${QA_DEPLOY_CONFIRM:-}" = "QA_ONLY" ] || refuse "QA_DEPLOY_CONFIRM=QA_ONLY doit être explicitement défini pour --reset --apply."
  [ "${QA_CONFIRM_RESET:-}" = "RESET_QA_ONLY" ] || refuse "QA_CONFIRM_RESET=RESET_QA_ONLY doit être explicitement défini pour supprimer $QA_DATA_DIR."
  [ "$(id -u)" -eq 0 ] || refuse "le mode --reset --apply doit être lancé avec sudo (root)."
  # Dernière vérification avant la commande destructive elle-même : le
  # chemin résolu doit encore correspondre exactement au dossier de données
  # QA attendu (défense en profondeur, redondant avec les gardes ci-dessus).
  [ "$QA_DATA_DIR" = "$(realpath -m -- "/home/$QA_USER/data")" ] || refuse "QA_DATA_DIR a changé de manière inattendue -- opération annulée par prudence."
  systemctl stop "$QA_SERVICE" 2>/dev/null || true
  if [ -f "$QA_DATA_DIR/crm.sqlite" ]; then
    mkdir -p "$QA_BACKUPS_DIR"
    STAMP="$(date +%Y%m%d-%H%M%S)"
    cp "$QA_DATA_DIR/crm.sqlite" "$QA_BACKUPS_DIR/crm-qa-reset-$STAMP.sqlite"
    echo "Sauvegarde QA écrite : $QA_BACKUPS_DIR/crm-qa-reset-$STAMP.sqlite"
  fi
  rm -rf "${QA_DATA_DIR:?}"
  mkdir -p "$QA_DATA_DIR"
  chown "$QA_USER:$QA_USER" "$QA_DATA_DIR"
  systemctl start "$QA_SERVICE"
  echo "RESET QA terminé."
  exit 0
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo
  echo "=== --dry-run : aucune commande ci-dessous n'est exécutée ==="
  echo "1. création (si absent) de l'utilisateur système : $QA_USER"
  echo "2. clonage/checkout de $QA_REPO"
  if [ -n "$QA_DEPLOY_SHA" ]; then
    echo "   -> checkout du SHA explicite : $QA_DEPLOY_SHA"
  else
    echo "   -> checkout HEAD de la branche : $QA_BRANCH (SHA explicite recommandé pour QA-INFRA2)"
  fi
  echo "   dans : $QA_APP_DIR"
  echo "3. npm install --no-audit --no-fund && npm run build (dans $QA_APP_DIR)"
  echo "4. création (si absent) de $QA_ENV_FILE, vide, permissions 600 root:root"
  echo "   (secrets optionnels -- ex. SESSION_SECRET -- jamais générés ni écrits par ce script)"
  echo "5. rendu de deploy/crm-qa.service.template -> /etc/systemd/system/$QA_SERVICE.service"
  echo "   (User=$QA_USER, NODE_ENV=$QA_NODE_ENV, PORT=$QA_PORT, CRM_DATA_DIR=$QA_DATA_DIR)"
  echo "6. mkdir -p $QA_DATA_DIR && chown $QA_USER:$QA_USER $QA_DATA_DIR (jamais suppression si déjà présent)"
  echo "7. systemctl daemon-reload && systemctl enable --now $QA_SERVICE"
  echo "8. AUCUNE modification de reverse proxy (Caddy/Nginx/Apache) — voir docs/advisory/QA_DEPLOYMENT.md §9"
  if [ -n "$QA_HOSTNAME" ]; then
    echo "   (hostname prévu pour QA-INFRA2 : $QA_HOSTNAME — non contacté, non configuré ici)"
  fi
  exit 0
fi

# --- Exécution réelle (--apply) -----------------------------------------
# Barrière d'intention n°2 (installation) : --apply seul ne suffit jamais --
# il faut EN PLUS QA_DEPLOY_CONFIRM=QA_ONLY. Vérifié AVANT le contrôle root
# pour rester testable sans privilèges.
[ "${QA_DEPLOY_CONFIRM:-}" = "QA_ONLY" ] || refuse "QA_DEPLOY_CONFIRM=QA_ONLY doit être explicitement défini pour --apply."
[ "$(id -u)" -eq 0 ] || refuse "ce script doit être lancé avec sudo (root) pour --apply."

echo "=== [1/7] Compte de service QA ==="
id "$QA_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$QA_USER"

echo "=== [2/7] Code (SHA explicite recommandé) ==="
if [ -d "$QA_APP_DIR/.git" ]; then
  sudo -u "$QA_USER" git -C "$QA_APP_DIR" fetch origin -- "$QA_BRANCH"
else
  sudo -u "$QA_USER" git clone -b "$QA_BRANCH" -- "$QA_REPO" "$QA_APP_DIR"
fi
if [ -n "$QA_DEPLOY_SHA" ]; then
  sudo -u "$QA_USER" git -C "$QA_APP_DIR" checkout --detach "$QA_DEPLOY_SHA"
else
  echo "Attention : aucun QA_DEPLOY_SHA fourni — utilisation de HEAD de $QA_BRANCH." >&2
  sudo -u "$QA_USER" git -C "$QA_APP_DIR" reset --hard "origin/$QA_BRANCH"
fi

echo "=== [3/7] Dépendances et build ==="
cd "$QA_APP_DIR"
sudo -u "$QA_USER" npm install --no-audit --no-fund
sudo -u "$QA_USER" npm run build

echo "=== [4/7] Données QA (jamais une copie de production — base neuve) ==="
mkdir -p "$QA_DATA_DIR"
chown "$QA_USER:$QA_USER" "$QA_DATA_DIR"

echo "=== [5/7] Fichier de secrets optionnel (jamais dans Git) ==="
# Ce script ne génère ni ne connaît aucun secret : il se contente de
# préparer un emplacement sûr, vide, que l'opérateur remplit manuellement
# après coup (ex. SESSION_SECRET) si l'auto-génération intégrée de l'app
# (server/app.js, stockée dans CRM_DATA_DIR/.session-secret, 0600) ne suffit
# pas. Jamais affiché, jamais lu par ce script.
if [ ! -f "$QA_ENV_FILE" ]; then
  install -m 600 -o root -g root /dev/null "$QA_ENV_FILE"
  echo "Fichier créé (vide) : $QA_ENV_FILE (permissions 600, root:root)"
else
  echo "Fichier déjà présent, non modifié : $QA_ENV_FILE"
fi

echo "=== [6/7] Service systemd $QA_SERVICE ==="
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/crm-qa.service.template"
[ -f "$TEMPLATE" ] || refuse "gabarit introuvable : $TEMPLATE"
QA_HOSTNAME_LABEL="${QA_HOSTNAME:-sans hostname configuré}"
sed \
  -e "s#__QA_USER__#$QA_USER#g" \
  -e "s#__QA_APP_DIR__#$QA_APP_DIR#g" \
  -e "s#__QA_DATA_DIR__#$QA_DATA_DIR#g" \
  -e "s#__QA_NODE_ENV__#$QA_NODE_ENV#g" \
  -e "s#__QA_PORT__#$QA_PORT#g" \
  -e "s#__QA_HOSTNAME_LABEL__#$QA_HOSTNAME_LABEL#g" \
  -e "s#__QA_ENV_FILE__#$QA_ENV_FILE#g" \
  -e "s#__NODE_BIN__#$(command -v node)#g" \
  "$TEMPLATE" > "/etc/systemd/system/$QA_SERVICE.service"
systemctl daemon-reload
systemctl enable --now "$QA_SERVICE"
systemctl restart "$QA_SERVICE"

echo "=== [7/7] Reverse proxy / HTTPS ==="
echo "Non configuré ici (interdit pour QA-INFRA1). Voir docs/advisory/QA_DEPLOYMENT.md §9"
echo "pour les commandes prévues en QA-INFRA2."

echo
echo "==========================================================="
echo "  Environnement QA installé : $QA_SERVICE"
echo "  Statut :  systemctl status $QA_SERVICE"
echo "  Logs   :  journalctl -u $QA_SERVICE"
echo "  Healthcheck local : curl -s http://localhost:$QA_PORT/api/auth/status"
echo "  Compte conseiller QA : à créer séparément, voir docs/advisory/QA_DEPLOYMENT.md §10"
echo "==========================================================="
