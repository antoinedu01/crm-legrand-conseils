# PROJECT_HANDOFF — CRM Legrand Conseils

Document de passation pour reprise du projet par une nouvelle session.
Dernière mise à jour : commit `6e48218` sur la branche `claude/insurance-broker-crm-exx09v`.

---

## 1. Objectif du CRM

CRM pour un **courtier en assurance indépendant en Suisse romande** (clientèle
particuliers, cantons de Vaud/Genève). Il couvre deux volets :

1. **Gestion métier** : clients, contrats multi-compagnies (vie 3a/3b, LAMal, LCA,
   LPP, hypothèque, risque décès, incapacité de gain), suivi des commissions
   (acquisition + récurrentes), tâches, tableau de bord.
2. **Développement du portefeuille** : acquisition de prospects, canaux, scoring,
   plan d'action quotidien — alimenté notamment par les formulaires du site
   `legrandconseils.ch` qui déposent les leads directement dans le CRM.

Le tout avec conformité **nLPD** (protection des données) et **LSA/FINMA**
(intermédiation d'assurance) intégrée.

---

## 2. Technologies

| Couche | Choix |
|---|---|
| Serveur | Node.js (ESM), Express 4 |
| Base de données | SQLite via `better-sqlite3` **v12** (binaires précompilés Node 20/22/24) |
| Sessions | `express-session` + store SQLite maison (`server/session-store.js`) |
| Sécurité | `bcryptjs`, `express-rate-limit`, TOTP maison (`server/totp.js`) |
| Frontend | React 18 + Vite 7, React Router 6, CSS maison (pas de framework UI) |
| Tests | `node:test` + `supertest` |
| Lint | ESLint 10 (flat config `eslint.config.js`) |

Aucune dépendance à un service externe pour fonctionner. Données hébergées
localement (SQLite). `npm audit` = 0 vulnérabilité au dernier contrôle.

---

## 3. Architecture

```
server/
  app.js            → construit l'app Express (exportée, testable), middlewares,
                       montage des routes. NE lance PAS le serveur.
  index.js          → point d'entrée : importe app.js et écoute le port.
  db.js             → ouverture SQLite, schéma, migrations (PRAGMA user_version),
                       seed initial (12 compagnies, 14 canaux, règles de scoring…).
  session-store.js  → store de sessions persistant en SQLite.
  auth.js           → setup/login/logout, profil, 2FA (TOTP).
  audit.js          → écriture du journal d'audit.
  validate.js       → helpers de validation serveur + erreurs 400.
  scoring.js        → calcul du score des prospects (avec raisons).
  totp.js           → 2FA TOTP (RFC 6238), crypto native.
  seed-demo.js      → données de démonstration (optionnel, base vide uniquement).
  routes/           → clients, companies, contracts, commissions, tasks,
                      dashboard, compliance, channels, prospects, today, public.

client/src/
  main.jsx, App.jsx → routeur + navigation.
  api.js            → wrapper fetch (gère 401, erreurs).
  labels.js         → libellés FR + formatage CHF/dates.
  components/ui.jsx → Modal, Field, Badge, Empty, hook useAsync.
  pages/            → Dashboard, Clients, ClientDetail, Contracts, Commissions,
                      Companies, Tasks, Compliance, Settings, Development.

deploy/
  install.sh            → installe/à jour le CRM sur un VPS (systemd, Caddy HTTPS,
                          UFW, sauvegardes nocturnes, mises à jour auto).
  setup-swissbackup.sh  → raccorde les sauvegardes à Swiss Backup Infomaniak (S3).

docs/MIGRATIONS.md   → historique des migrations et procédure de retour arrière.
```

- API REST sous `/api/*`. Frontend compilé servi par Express en production
  (dossier `client/dist` s'il existe).
- Migrations : versionnées par `PRAGMA user_version`, appliquées automatiquement
  au démarrage dans `server/db.js`. **Versions 1 à 6 en place** sur la branche
  déployée.

---

## 4. Fonctionnalités déjà réalisées (branche déployée, en production)

**Gestion métier**
- Clients (particuliers/entreprises), recherche, statuts, activités, tâches.
- Contrats multi-compagnies ; commission d'acquisition générée automatiquement à
  la création ; génération en un clic des commissions récurrentes annuelles.
- Compagnies partenaires (12 pré-remplies) avec taux par défaut.
- Tableau de bord (KPI, graphique commissions 12 mois, échéances, alertes).

**Développement du portefeuille** (module « Développement »)
- Bloc 1 : 14 canaux d'acquisition + coûts + entonnoir par canal ; carte
  « Origine & prospection » sur la fiche client.
- Bloc 2 : scoring des prospects avec **raisons affichées**, vue pipeline
  (kanban), réglages du scoring.
- Bloc 3 : page « ☀️ Aujourd'hui » (plan d'action quotidien généré) + bouton
  « Résultat » qui journalise et enchaîne la prochaine étape.

**Point d'entrée public** (`server/routes/public.js`, `POST /api/public/lead`)
- Reçoit les leads des formulaires du site `legrandconseils.ch`.
- CORS restreint aux origines du site, rate limiting, champ-piège anti-robots,
  consentement horodaté (table `consents`), détection de doublons.

**Conformité**
- Consentements nLPD, mandats, info art. 45 LSA suivis par dossier.
- Export des données (droit d'accès art. 25), anonymisation (droit à l'effacement).
- Journal d'audit, registre des traitements (art. 12), vue conformité.

**Sécurité / compte**
- Authentification bcrypt, sessions 8 h, verrouillage anti force brute.
- Double authentification (2FA TOTP) activable dans les Paramètres.
- Sauvegarde téléchargeable + sauvegardes nocturnes (serveur) + Swiss Backup.

État qualité : **25 tests d'intégration passent, ESLint sans erreur.**

---

## 5. Fonctionnalités encore incomplètes

- **Bloc 4 — Recommandations & partenaires** : développé sur la branche
  `feature/lead-generation-engine` (fichiers `server/routes/partners.js`,
  `referrals.js`, `templates.js`, migration partenaires, UI dans
  `Development.jsx`). **NON fusionné, NON déployé, UI partielle, non testé
  end-to-end.** Voir « Problèmes connus » pour le conflit de migration à régler
  avant fusion.
- **Blocs 5–6 du plan initial** (campagnes/formulaires publics avancés côté CRM,
  tableau de bord commercial complet, scripts & parcours produit, plan 90 jours
  dans l'app) : non commencés.
- **2FA** : pas de codes de récupération. Si l'utilisateur perd son application
  d'authentification, il faut intervenir dans la base (`UPDATE users SET
  totp_enabled = 0, totp_secret = NULL`).

---

## 6. Règles de sécurité et conformité en place

- Mots de passe : bcrypt coût 12, jamais en clair.
- Sessions : cookie httpOnly, `sameSite=lax`, `secure=auto`, 8 h, store SQLite.
- Anti-CSRF : vérification `Origin` / `Sec-Fetch-Site` sur toute modification
  interne ; tentatives intersites journalisées.
- Content-Security-Policy + en-têtes de sécurité, `trust proxy = 1` (derrière Caddy).
- Rate limiting : global API, connexion, et endpoint public.
- Validation serveur systématique (e-mails, dates, montants, énumérations, longueurs).
- SQL : requêtes préparées partout (pas d'injection). React échappe le HTML (XSS).
- Endpoint public : CORS restreint (`SITE_ORIGINS`), anti-robots, consentement
  obligatoire et versionné, doublons rattachés au dossier existant.
- Conformité : journal d'audit, export/anonymisation nLPD, conservation des
  données comptables (contrat/commission payée non supprimables — art. 958f CO).

---

## 7. Commandes pour lancer et tester

```bash
npm install            # dépendances
npm run build          # compile le frontend (client/dist)
npm start              # démarre en production sur http://localhost:3000
npm run dev            # dev : API (3000) + Vite (5173) rechargés à chaud
npm test               # 25 tests d'intégration (base isolée en tmp)
npm run lint           # ESLint
npm run check          # lint + test + build
npm run seed:demo      # données de démonstration (uniquement si base vide)
```

Premier lancement : l'app demande de créer le compte courtier (le 1er compte
créé devient le seul). Variables d'environnement documentées dans `.env.example`
(port, `NODE_ENV`, `CRM_DATA_DIR`, `SESSION_SECRET` optionnel, `SITE_ORIGINS`,
`PUBLIC_RATE_LIMIT`).

**Déploiement / mise à jour serveur** (le CRM tourne sur un VPS suisse à
`https://crm.legrandconseils.ch`) — commande à exécuter EN SSH SUR LE SERVEUR :
```bash
curl -fsSL https://raw.githubusercontent.com/antoinedu01/crm-legrand-conseils/claude/insurance-broker-crm-exx09v/deploy/install.sh | sudo bash -s -- crm.legrandconseils.ch
```
Les identifiants SSH, l'adresse IP et la clé du serveur sont détenus par
l'utilisateur (hors dépôt).

---

## 8. Fichiers importants

- `server/app.js` — assemblage de l'app et ordre des middlewares (l'endpoint
  public est monté AVANT le contrôle anti-CSRF interne : ne pas inverser).
- `server/db.js` — schéma + migrations + seed. Toute évolution de schéma passe ici.
- `server/routes/public.js` — surface exposée à internet ; toute modification
  touche à la sécurité et à la conformité.
- `server/scoring.js` — logique de score des prospects.
- `deploy/install.sh` — script de déploiement idempotent (sert aussi de mise à jour).
- `docs/MIGRATIONS.md` — journal des migrations + retour arrière.
- `.env.example` — configuration (sans secrets).

---

## 9. À NE SURTOUT PAS modifier / casser

- **Dossier `data/`** : base SQLite de production + secret de session. Jamais
  committé (dans `.gitignore`), jamais écrasé. Contient toutes les données clients.
- **Ne pas renuméroter ni réécrire les migrations existantes** (1→6) : elles se
  sont déjà appliquées en production. Toute évolution = NOUVELLE migration avec un
  numéro supérieur.
- **`better-sqlite3` doit rester en v12+** (compatibilité Node 24 sans compilation).
  Ne pas redescendre en v11.
- **Ordre de montage dans `app.js`** : `/api/public` avant le middleware anti-CSRF.
- **Logique de conservation comptable** (contrats/commissions payées non
  supprimables) : exigence légale, ne pas contourner.
- La branche `claude/insurance-broker-crm-exx09v` est la **branche de production**
  (celle que `install.sh` déploie). Développer sur une branche dédiée, pas dessus.
- Ne rien pousser vers d'autres branches sans autorisation explicite.

---

## 10. Problèmes connus

1. **Conflit de migration à régler avant de fusionner le Bloc 4.** La branche
   déployée utilise `user_version < 6` pour créer la table `consents` (leads
   publics). La branche `feature/lead-generation-engine` utilise AUSSI
   `user_version < 6` pour créer les tables partenaires/modèles. À la fusion, il
   faudra **renuméroter le bloc partenaires en `user_version < 7`** pour que les
   deux migrations coexistent proprement.
2. **Bloc 4 non finalisé** : UI partenaires/recommandations/modèles partielle,
   non testée end-to-end, non déployée.
3. **2FA sans code de récupération** (cf. §5).
4. Le comparateur LAMal du **site** utilise des primes indicatives/approximatives
   (fichier dans le dépôt du site `antoinedu01/site-legrandconseils`, PAS ce
   dépôt) — à confirmer avec les primes officielles OFSP le moment venu.

---

## 11. État actuel du dépôt Git

- **Branche courante / de production** : `claude/insurance-broker-crm-exx09v`
  (poussée sur `origin`). Contient : sécurisation + 2FA + Blocs 1–3 + endpoint
  public. Dernier commit : `6e48218`.
- **Branche de travail** : `feature/lead-generation-engine` (poussée sur
  `origin`) — contient le Bloc 4 en cours (non fusionné).
- Arbre de travail **propre** (aucune modification non committée) hormis la
  création de ce fichier `PROJECT_HANDOFF.md`.
- Dépôts liés : CRM = `antoinedu01/crm-legrand-conseils` (ce dépôt) ; site vitrine
  = `antoinedu01/site-legrandconseils` (branche `feature/acquisition` : formulaires
  reliés au CRM + 3 pages d'atterrissage).

---

## 12. Contexte hors-code utile

- Le CRM est **en production** sur un VPS Infomaniak (Suisse), HTTPS via Caddy,
  sauvegardes nocturnes + Swiss Backup, mises à jour de sécurité automatiques.
- Le site `legrandconseils.ch` (WordPress/Kadence chez IONOS) envoie ses leads au
  CRM via `POST /api/public/lead`. La mesure des conversions est branchée dans
  Google Tag Manager (événement `generer_lead` vers GA4).
- Prochaines étapes envisagées avec l'utilisateur : finaliser le Bloc 4, plan
  90 jours, rédaction des contenus SEO (un plan éditorial a été livré séparément).
