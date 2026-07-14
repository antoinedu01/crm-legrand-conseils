#!/bin/bash
# Raccordement des sauvegardes nocturnes du CRM au Swiss Backup d'Infomaniak
# (copie externe, chiffrée en transit, hébergée en Suisse).
#
# Prérequis : dans le Manager Infomaniak → Swiss Backup → ajouter un « appareil »
# de type « Cloud (compatible S3) », puis noter : endpoint, access key, secret key.
#
# Usage (les identifiants sont saisis à l'écran, jamais dans l'historique) :
#   curl -fsSL https://raw.githubusercontent.com/antoinedu01/crm-legrand-conseils/claude/insurance-broker-crm-exx09v/deploy/setup-swissbackup.sh -o setup-swissbackup.sh
#   sudo bash setup-swissbackup.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Lancez ce script avec sudo." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get install -yq rclone >/dev/null

echo "=== Identifiants Swiss Backup (type S3) — voir Manager Infomaniak → Swiss Backup ==="
read -rp "Endpoint S3 (p. ex. https://s3.swiss-backup03.infomaniak.com) : " ENDPOINT
read -rp "Access Key ID : " ACCESS_KEY
read -rsp "Secret Key (invisible à la saisie) : " SECRET_KEY
echo
BUCKET_DEFAULT="crm-sauvegardes"
read -rp "Nom du coffre/bucket [${BUCKET_DEFAULT}] : " BUCKET
BUCKET="${BUCKET:-$BUCKET_DEFAULT}"

# Nettoyage : espaces, retours à la ligne et guillemets parasites (copier-coller)
clean() { printf '%s' "$1" | tr -d '[:space:]"' ; }
ENDPOINT="$(clean "$ENDPOINT")"
ACCESS_KEY="$(clean "$ACCESS_KEY")"
SECRET_KEY="$(clean "$SECRET_KEY")"
BUCKET="$(clean "$BUCKET")"

# Configuration rclone pour l'utilisateur crm (celui qui exécute les sauvegardes)
CONF_DIR=/home/crm/.config/rclone
mkdir -p "$CONF_DIR"
cat > "$CONF_DIR/rclone.conf" <<EOF
[swissbackup]
type = s3
provider = Other
access_key_id = $ACCESS_KEY
secret_access_key = $SECRET_KEY
endpoint = $ENDPOINT
region = us-east-1
acl = private
EOF
chown -R crm:crm /home/crm/.config
chmod 600 "$CONF_DIR/rclone.conf"

echo "=== Test de connexion ==="
if ! sudo -u crm rclone mkdir "swissbackup:$BUCKET" 2>/dev/null; then
  echo "Création du coffre impossible — coffres existants :"
  sudo -u crm rclone lsd swissbackup: || {
    echo "ÉCHEC : identifiants ou endpoint incorrects. Relancez le script." >&2
    exit 1
  }
  echo "Si un coffre existe déjà ci-dessus, relancez le script et indiquez son nom."
  exit 1
fi

# Ajout de l'envoi externe à la sauvegarde nocturne (idempotent)
if ! grep -q 'swissbackup:' /home/crm/backup.sh; then
  cat >> /home/crm/backup.sh <<EOF

# Copie externe vers Swiss Backup (Infomaniak, Suisse)
rclone copy "\$DIR" "swissbackup:$BUCKET" --max-age 48h
EOF
fi

echo "=== Premier envoi (test réel) ==="
sudo -u crm bash -c 'cd /home/crm && /home/crm/backup.sh'
echo "Contenu du coffre distant :"
sudo -u crm bash -c "cd /home/crm && rclone ls 'swissbackup:$BUCKET'"

echo
echo "==========================================================="
echo "  Swiss Backup raccordé !"
echo "  Chaque nuit à 02h15 : sauvegarde locale + copie vers"
echo "  le coffre '$BUCKET' chez Infomaniak (rotation 7 j + 12 mois)."
echo "==========================================================="
