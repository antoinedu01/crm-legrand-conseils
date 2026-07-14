# Héberger le CRM en Suisse — accessible depuis téléphone, iPad et ordinateurs

Deux options selon votre besoin. Dans les deux cas, **vous seul** avez accès :
le CRM n'a qu'un seul compte (le vôtre) et bloque toute connexion sans mot de passe.

---

## Option A (recommandée) — Petit serveur suisse (~CHF 10–15/mois)

Le CRM tourne 24h/24 sur un serveur situé en Suisse ; vous y accédez depuis
n'importe quel appareil via une adresse du type `https://crm.votre-domaine.ch`.

Hébergeurs suisses adaptés (données en Suisse, support en français) :

- **Infomaniak** (Genève) — VPS Lite, le plus simple
- **Hostpoint** (Rapperswil)
- **Exoscale** (Lausanne)

### Étapes (une fois, ~1 heure ; votre hébergeur peut aider)

1. **Commander un VPS** Ubuntu 24.04 (1 vCPU / 1–2 Go de RAM suffisent largement).
2. **Pointer un sous-domaine** (p. ex. `crm.legrand-conseils.ch`) vers l'adresse IP
   du serveur (enregistrement DNS de type A, dans la console de votre hébergeur).
3. **Sur le serveur** (copier-coller bloc par bloc, en SSH) :

```bash
# Node.js 22 LTS + outils
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git ufw

# Pare-feu : ne laisser passer que SSH et le web
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable

# Récupérer le CRM
sudo useradd -m -s /bin/bash crm
sudo -u crm git clone -b claude/insurance-broker-crm-exx09v \
  https://github.com/antoinedu01/crm-legrand-conseils.git /home/crm/app
cd /home/crm/app
sudo -u crm npm install --omit=dev --no-audit
sudo -u crm npm install --no-audit   # dépendances de build de l'interface
sudo -u crm npm run build
```

4. **Service systemd** (le CRM démarre tout seul, même après redémarrage) —
   créer `/etc/systemd/system/crm.service` :

```ini
[Unit]
Description=CRM Legrand Conseils
After=network.target

[Service]
User=crm
WorkingDirectory=/home/crm/app
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/node server/index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now crm
```

5. **HTTPS automatique avec Caddy** (certificat suisse Let's Encrypt, renouvelé seul) :

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

Contenu de `/etc/caddy/Caddyfile` (remplacez le domaine) :

```
crm.legrand-conseils.ch {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl reload caddy
```

6. **Sauvegarde automatique quotidienne** (7 jours glissants + 12 mois) —
   créer `/home/crm/backup.sh` :

```bash
#!/bin/bash
set -e
DIR=/home/crm/sauvegardes
mkdir -p "$DIR"
STAMP=$(date +%F)
sqlite3 /home/crm/app/data/crm.sqlite ".backup '$DIR/crm-$STAMP.sqlite'"
gzip -f "$DIR/crm-$STAMP.sqlite"
# garde 7 sauvegardes quotidiennes, et celle du 1er du mois pendant 12 mois
find "$DIR" -name 'crm-*.sqlite.gz' -mtime +7 ! -name 'crm-*-01.sqlite.gz' -delete
find "$DIR" -name 'crm-*-01.sqlite.gz' -mtime +365 -delete
```

```bash
sudo apt-get install -y sqlite3
chmod +x /home/crm/backup.sh
echo '15 2 * * * crm /home/crm/backup.sh' | sudo tee /etc/cron.d/crm-backup
```

Idéalement, faites aussi copier `/home/crm/sauvegardes` vers un second lieu
(p. ex. kDrive/Swiss Backup d'Infomaniak — données en Suisse — via `rclone`),
et téléchargez de temps en temps une sauvegarde depuis **Paramètres →
Télécharger une sauvegarde** pour en garder une copie chez vous.

### Sécurité obtenue

| Mesure | Détail |
|---|---|
| Données en Suisse | serveur + sauvegardes chez un hébergeur suisse (nLPD) |
| Chiffrement en transit | HTTPS/TLS automatique (Caddy) |
| Accès | votre compte unique, mot de passe bcrypt, verrouillage anti force brute |
| Pare-feu | seuls les ports web et SSH sont ouverts |
| Sauvegardes | quotidiennes, rotation 7 jours + 12 mois, + bouton manuel |
| Traçabilité | journal d'audit intégré (nLPD art. 8) |

Renforcement conseillé : connexion SSH par clé uniquement
(`PasswordAuthentication no` dans `/etc/ssh/sshd_config`) et mises à jour
automatiques (`sudo apt-get install unattended-upgrades`).

---

## Option B (gratuite) — Accès à distance via Tailscale, sans rien exposer sur internet

Si votre ordinateur du bureau peut rester allumé : installez **Tailscale**
(VPN privé, gratuit pour un usage personnel) sur le PC qui fait tourner le CRM
et sur votre iPhone/iPad/portable. Chaque appareil reçoit une adresse privée ;
le CRM n'est **jamais visible sur internet**, seulement depuis vos appareils.

1. Créez un compte sur tailscale.com et installez l'application sur le PC du CRM
   et sur vos appareils (App Store pour iPhone/iPad).
2. Sur le PC, lancez le CRM comme d'habitude (`Demarrer-Windows.bat`).
3. Depuis l'iPhone/iPad, ouvrez `http://<nom-du-pc>:3000` (le nom apparaît dans
   l'application Tailscale).

Limites : le PC doit rester allumé, et les sauvegardes restent chez vous
(utilisez le bouton de sauvegarde + une copie sur disque chiffré).

---

## Installer le CRM « comme une application » (iPhone, iPad, Mac, PC)

Une fois le CRM accessible (option A ou B), sur chaque appareil :

- **iPhone / iPad** : ouvrez l'adresse dans **Safari** → bouton **Partager** →
  **« Sur l'écran d'accueil »**. Une icône CRM apparaît, plein écran, comme une app.
- **Windows / Mac (Chrome ou Edge)** : icône **« Installer »** dans la barre
  d'adresse (ou menu ⋮ → « Installer l'application »).

Aucune installation via App Store n'est nécessaire — et vos données ne passent
par aucun intermédiaire.
