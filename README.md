# CRM Legrand Conseils

CRM complet pour courtier en assurance indépendant en Suisse : prévoyance (3a/3b, LPP),
assurance maladie (LAMal), complémentaires (LCA), assurance hypothèque, avec suivi des
commissions multi-compagnies et conformité nLPD / LSA (FINMA) intégrée.

## Démarrage rapide

```bash
npm install
npm run build        # compile l'interface
npm start            # démarre sur http://localhost:3000
```

Au premier lancement, l'application vous demande de créer votre compte courtier
(e-mail, mot de passe d'au moins 10 caractères, n° de registre FINMA optionnel).

Pour le développement :

```bash
npm run dev          # API (port 3000) + interface Vite (port 5173) rechargée à chaud
```

Données de démonstration (optionnel, uniquement si la base est vide) :

```bash
npm run seed:demo
```

## Fonctionnalités

- **Clients** — particuliers et entreprises, recherche, statuts (prospect → client),
  journal de suivi (appels, rendez-vous, notes), tâches liées.
- **Compagnies partenaires** — 12 compagnies suisses pré-remplies (Swiss Life, AXA,
  Helvetia, Groupe Mutuel, CSS…), taux de commission par défaut par compagnie.
- **Contrats** — branches vie 3a/3b, LAMal, LCA, LPP, hypothèque, RC/ménage ;
  primes, fréquences, échéances ; les taux de commission se pré-remplissent depuis
  la compagnie choisie.
- **Commissions** — la commission d'acquisition est **créée automatiquement à la
  création du contrat** ; génération en un clic des commissions récurrentes
  (portefeuille) de l'année ; suivi attendue → payée ; totaux par année et par compagnie.
- **Tableau de bord** — KPI (clients, contrats actifs, primes, commissions perçues et
  attendues), graphique des commissions sur 12 mois, répartition par branche,
  échéances de contrats sous 90 jours, alertes de conformité.
- **Tâches & rappels** — relances, renouvellements, priorités, retards signalés.

## Conformité intégrée

| Exigence | Mise en œuvre dans le CRM |
|---|---|
| **nLPD art. 6/8 — sécurité et traçabilité** | Journal d'audit de toutes les actions (consultation de dossier, modifications, exports), mots de passe hachés (bcrypt), sessions httpOnly de 8 h, verrouillage anti force brute. |
| **nLPD — consentement** | Case et date de consentement par client, alerte si manquant, blocage signalé à la création de contrat. |
| **nLPD art. 12 — registre des traitements** | Onglet « Registre des traitements » pré-rempli (finalités, bases légales, durées de conservation, mesures). |
| **nLPD art. 25 — droit d'accès** | Bouton « Export des données » sur chaque dossier : export JSON complet (client, contrats, commissions, activités). |
| **nLPD — droit à l'effacement** | Action « Anonymiser » : efface toutes les données personnelles, conserve les données contractuelles de façon anonyme (obligation comptable, art. 958f CO — 10 ans). |
| **LSA art. 41–42 — registre FINMA** | Champ n° d'enregistrement FINMA du courtier dans les Paramètres. |
| **LSA art. 45 — devoir d'information** | Date de remise de l'information suivie par client ; avertissement automatique si un contrat est créé sans elle. |
| **LSA art. 45b — transparence de la rémunération** | Commissions rattachées au contrat et au client, exportables par dossier. |
| **LSA art. 43 — formation continue** | Champ n° Cicero dans le profil courtier. |
| **Orientation ISO 27001** | Mesures techniques ci-dessus + en-têtes de sécurité HTTP, journal consultable, données locales (SQLite). La certification ISO reste une démarche organisationnelle (sauvegardes chiffrées, poste de travail, locaux). |

> ⚠️ Ce logiciel outille la conformité mais ne remplace pas un avis juridique.
> Les fiches du registre des traitements et les textes d'information au client
> doivent être validés pour votre situation.

## Recommandations d'exploitation

- **Hébergement** : gardez la base (`data/crm.sqlite`) sur un serveur ou un poste
  situé **en Suisse**, disque chiffré.
- **Sauvegardes** : copiez régulièrement le dossier `data/` sur un support chiffré
  (la base contient tout : clients, contrats, commissions, journal d'audit).
- **HTTPS** : en production, placez l'application derrière un proxy TLS
  (Caddy, nginx + Let's Encrypt) — les cookies de session passent en `secure`
  automatiquement.

## Architecture

- **API** : Node.js + Express, base SQLite locale (`better-sqlite3`), sessions serveur.
- **Interface** : React 18 + Vite, français, thèmes clair/sombre automatiques.
- **Structure** : `server/` (API, schéma, routes), `client/` (interface), `data/`
  (base et secret de session — jamais versionnés).
