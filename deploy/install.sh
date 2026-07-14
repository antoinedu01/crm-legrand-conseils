#!/bin/bash
# Installation automatique du CRM Legrand Conseils sur un serveur Ubuntu/Debian (VPS suisse).
# Usage :
#   curl -fsSL https://raw.githubusercontent.com/antoinedu01/crm-legrand-conseils/claude/insurance-broker-crm-exx09v/deploy/install.sh | sudo bash -s -- crm.votre-domaine.ch
#
# Le script est idempotent : on peut le relancer sans risque (mises à jour comprises).
set -euo pipefail

DOMAIN="${1:-}"
BRANCH="claude/insurance-broker-crm-exx09v"
REPO="https://github.com/antoinedu01/crm-legrand-conseils.git"
APP_DIR="/home/crm/app"

if [ "$(id -u)" -ne 0 ]; then
  echo "Ce script doit être lancé avec sudo (root)." >&2
  exit 1
fi
if [ -z "$DOMAIN" ]; then
  echo "Indiquez votre domaine : sudo bash install.sh crm.votre-domaine.ch" >&2
  exit 1
fi

echo "=== [1/7] Paquets système ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq git ufw sqlite3 curl ca-certificates unattended-upgrades

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  echo "=== Installation de Node.js 22 LTS ==="
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -yq nodejs
fi

echo "=== [2/7] Pare-feu (SSH + web uniquement) ==="
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "=== [3/7] Compte de service et code ==="
id crm >/dev/null 2>&1 || useradd -m -s /bin/bash crm
if [ -d "$APP_DIR/.git" ]; then
  sudo -u crm git -C "$APP_DIR" fetch origin "$BRANCH"
  sudo -u crm git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  sudo -u crm git clone -b "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
sudo -u crm npm install --no-audit --no-fund
sudo -u crm npm run build

echo "=== [4/7] Service systemd ==="
cat > /etc/systemd/system/crm.service <<EOF
[Unit]
Description=CRM Legrand Conseils
After=network.target

[Service]
User=crm
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=$(command -v node) server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$APP_DIR/data

[Install]
WantedBy=multi-user.target
EOF
mkdir -p "$APP_DIR/data" && chown crm:crm "$APP_DIR/data"
systemctl daemon-reload
systemctl enable --now crm
systemctl restart crm

echo "=== [5/7] HTTPS avec Caddy ==="
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -yq debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -yq caddy
fi
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    reverse_proxy localhost:3000
    header Strict-Transport-Security "max-age=31536000"
}
EOF
systemctl reload caddy || systemctl restart caddy

echo "=== [6/7] Sauvegardes quotidiennes (02h15, rotation 7 jours + 12 mois) ==="
cat > /home/crm/backup.sh <<'EOF'
#!/bin/bash
set -e
DIR=/home/crm/sauvegardes
mkdir -p "$DIR"
STAMP=$(date +%F)
sqlite3 /home/crm/app/data/crm.sqlite ".backup '$DIR/crm-$STAMP.sqlite'"
gzip -f "$DIR/crm-$STAMP.sqlite"
find "$DIR" -name 'crm-*.sqlite.gz' -mtime +7 ! -name 'crm-*-01.sqlite.gz' -delete
find "$DIR" -name 'crm-*-01.sqlite.gz' -mtime +365 -delete
EOF
chmod +x /home/crm/backup.sh && chown crm:crm /home/crm/backup.sh
echo '15 2 * * * crm /home/crm/backup.sh' > /etc/cron.d/crm-backup

echo "=== [7/7] Mises à jour de sécurité automatiques ==="
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

echo
echo "==========================================================="
echo "  Installation terminée !"
echo "  1. Vérifiez que le DNS de $DOMAIN pointe vers ce serveur."
echo "  2. Ouvrez https://$DOMAIN et créez votre compte courtier."
echo "     (le premier compte créé devient LE compte : faites-le vous-même sans tarder)"
echo "  Sauvegardes : /home/crm/sauvegardes (chaque nuit à 02h15)"
echo "  Statut du CRM :  systemctl status crm"
echo "==========================================================="
