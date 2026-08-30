# Déploiement du correctif « durée contractuelle Vie » — préparation uniquement

> **CADRAGE — AUCUN DÉPLOIEMENT RÉALISÉ.** Ce document prépare le
> déploiement en production du correctif de pré-remplissage automatique de
> la durée contractuelle Vie (commit `f659644`, branche
> `claude/legrand-conseils-status-tigurq`). Aucune commande de ce document
> n'a été exécutée contre le serveur de production ni contre
> `data/crm.sqlite`. Toute exécution reste une action humaine, déclenchée et
> menée par Antoine Legrand — cadence identique à la procédure suivie pour
> Santé v2 le 18/08/2026 : sauvegarde → simulation sur copie → déploiement →
> vérification, avec rollback prêt à chaque étape.

---

## 0. Périmètre exact du changement

- **Fichiers touchés** : `client/src/pages/Contracts.jsx`,
  `client/src/components/contracts/policyTermFromDates.js` (nouveau),
  `test/frontend-policy-term-from-dates.test.js` (nouveau).
- **Aucune migration, aucun changement de schéma** : `server/db.js` n'est
  pas touché, `PRAGMA user_version` reste inchangé. C'est un correctif
  **frontend pur** — pré-remplissage d'un champ de formulaire déjà existant
  (`policy_term_years`), jamais une nouvelle colonne ni une nouvelle table.
- **Aucune écriture de données** au déploiement : le changement n'affecte
  que le rendu du formulaire de création/édition de contrat, pas
  `server/routes/contracts.js`, pas la validation métier déjà en place.
- Conséquence directe : la case « simulation » ci-dessous porte sur le
  **comportement de l'interface**, pas sur une transformation de données —
  il n'y a rien à faire migrer ni à vérifier au niveau du schéma.

## 1. Préalable — ce document ne fait pas

Le code du correctif vit aujourd'hui sur `claude/legrand-conseils-status-tigurq`,
**jamais sur `claude/insurance-broker-crm-exx09v`** (branche de production).
`deploy/install.sh` déploie toujours cette dernière (`BRANCH` codée en dur).
Faire atteindre ce correctif à la production suppose donc, **avant toute
étape ci-dessous**, une fusion explicite de ce commit dans la branche de
production — une action distincte, qui reste à votre seule décision (ce
document ne la déclenche pas et ne la recommande pas à un moment précis).

## 2. Étape 1 — Sauvegarde de production + vérification d'intégrité

À exécuter en SSH sur le VPS (`ov-c6490d`), en tant qu'utilisateur `crm` ou
via `sudo -u crm` :

```bash
DIR=/home/crm/sauvegardes
mkdir -p "$DIR"
STAMP=$(date +%F-%H%M)
sqlite3 /home/crm/app/data/crm.sqlite ".backup '$DIR/crm-pre-duree-vie-$STAMP.sqlite'"

# Vérification d'intégrité de la copie fraîche (jamais du fichier live)
sqlite3 "$DIR/crm-pre-duree-vie-$STAMP.sqlite" "PRAGMA integrity_check;"
# Attendu : une seule ligne "ok". Toute autre sortie = ARRÊT, ne pas continuer.

gzip -k "$DIR/crm-pre-duree-vie-$STAMP.sqlite"
```

Cette sauvegarde s'ajoute à la rotation automatique quotidienne existante
(`/home/crm/backup.sh`, 02h15) — elle porte un nom distinct
(`pre-duree-vie`) pour être identifiable et n'est jamais écrasée par la
rotation à 7 jours de la sauvegarde nocturne.

**Optionnel mais recommandé** : rapatrier une copie de cette sauvegarde hors
du VPS avant de continuer (`scp` vers votre poste, ou vérifier que
Swiss Backup l'a déjà synchronisée si `setup-swissbackup.sh` est actif).

## 3. Étape 2 — Simulation sur une copie (avant tout déploiement réel)

Objectif : vérifier que l'application, une fois reconstruite avec le
correctif, démarre et sert normalement contre une **copie** de la vraie
base — sans jamais toucher `data/crm.sqlite` ni le service `crm` en cours.

Sur une machine de test (le VPS lui-même dans un dossier séparé, ou votre
poste local) :

```bash
# 1. Copie de travail jetable de la sauvegarde (jamais le fichier .backup original)
mkdir -p /tmp/crm-sim-duree-vie
cp /home/crm/sauvegardes/crm-pre-duree-vie-<STAMP>.sqlite /tmp/crm-sim-duree-vie/crm.sqlite

# 2. Clone du correctif dans un dossier séparé (jamais /home/crm/app)
git clone -b claude/legrand-conseils-status-tigurq \
  https://github.com/antoinedu01/crm-legrand-conseils.git /tmp/crm-sim-duree-vie/app
cd /tmp/crm-sim-duree-vie/app
npm install --no-audit
npm run build

# 3. Démarrage isolé, pointé sur la copie — port distinct, jamais 3000 s'il y a
#    un vrai service crm actif sur cette même machine
CRM_DATA_DIR=/tmp/crm-sim-duree-vie PORT=3999 node server/index.js
```

Puis, dans un navigateur pointé sur cette instance isolée (`http://<hôte>:3999`,
ou en tunnel SSH si exécuté sur le VPS) :

- [ ] Connexion avec votre compte habituel réussie (même base = mêmes identifiants)
- [ ] Ouvrir un contrat Vie existant (édition) : le formulaire s'ouvre sans erreur
- [ ] Créer un nouveau contrat Vie de test, avec des dates de début/échéance :
      la « Durée contractuelle (années) » se pré-remplit automatiquement
- [ ] Modifier manuellement la durée pré-remplie, changer à nouveau la date
      d'échéance : la valeur saisie à la main n'est **pas** écrasée
- [ ] Enregistrer ce contrat de test, puis **le supprimer** depuis
      l'interface — la copie de base est jetable, mais autant garder
      l'habitude
- [ ] Aucune erreur dans la sortie du terminal où tourne `node server/index.js`

Une fois la simulation validée, arrêter le processus (`Ctrl+C`) et supprimer
le dossier jetable :

```bash
rm -rf /tmp/crm-sim-duree-vie
```

## 4. Étape 3 — Déploiement réel (à ne déclencher que vous-même)

Une fois la fusion vers `claude/insurance-broker-crm-exx09v` faite (§1) et
la simulation validée (§3), le déploiement lui-même est la mise à jour de
code standard déjà utilisée pour Santé v2 — **pas besoin de relancer
`install.sh` en entier** (qui retoucherait aussi pare-feu/Caddy/cron sans
raison) : seule la partie « code » de ce script est nécessaire ici.

En SSH sur le VPS, en root ou via `sudo` :

```bash
cd /home/crm/app
sudo -u crm git fetch origin claude/insurance-broker-crm-exx09v
# Notez le SHA actuel avant de bouger, pour le rollback (§6) :
git rev-parse HEAD
sudo -u crm git reset --hard origin/claude/insurance-broker-crm-exx09v
sudo -u crm npm install --no-audit --no-fund
sudo -u crm npm run build
systemctl restart crm
```

## 5. Étape 4 — Vérification post-déploiement

```bash
systemctl status crm
curl -s http://localhost:3000/api/auth/status
```

Puis, dans un navigateur, sur `https://crm.legrandconseils.ch` :

- [ ] Connexion normale, aucune régression visible sur le tableau de bord
- [ ] Créer un contrat Vie de test réel (client de test si vous en avez un,
      sinon un client existant en acceptant de le supprimer ensuite), avec
      dates de début/échéance : la durée se pré-remplit
- [ ] **Supprimer immédiatement ce contrat de test** — jamais laisser une
      donnée de test dans la production
- [ ] `journalctl -u crm -n 50` : aucune erreur inhabituelle depuis le
      redémarrage

## 6. Plan de rollback

**Code** (aucune migration à défaire, donc rollback simple) :

```bash
cd /home/crm/app
sudo -u crm git reset --hard <SHA noté avant le déploiement, §4>
sudo -u crm npm install --no-audit --no-fund
sudo -u crm npm run build
systemctl restart crm
```

**Base de données** : ce correctif n'écrit et ne migre rien — en principe
aucune restauration de base n'est nécessaire. Si un doute apparaît malgré
tout après déploiement :

```bash
systemctl stop crm
cp /home/crm/sauvegardes/crm-pre-duree-vie-<STAMP>.sqlite /home/crm/app/data/crm.sqlite
systemctl start crm
```

(Perdrait toute donnée saisie entre la sauvegarde et la restauration — à
n'utiliser qu'en dernier recours, puisqu'aucune migration ne justifie
normalement d'y recourir pour ce correctif précis.)

## 7. Checklist finale récapitulative

- [ ] Fusion du commit `f659644` (ou équivalent) vers
      `claude/insurance-broker-crm-exx09v` décidée et faite par vous
- [ ] Sauvegarde de production prise et `PRAGMA integrity_check` = `ok` (§2)
- [ ] Simulation sur copie exécutée et tous les points de §3 validés
- [ ] Déploiement réel exécuté (§4), SHA précédent noté
- [ ] Vérification post-déploiement faite (§5), contrat de test supprimé
- [ ] En cas de problème : rollback (§6) prêt et compris avant de commencer

---

*Aucune commande de ce document n'a été exécutée par Claude Code. Chaque
étape reste à déclencher par Antoine Legrand.*
