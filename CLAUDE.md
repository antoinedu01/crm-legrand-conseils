# CLAUDE.md — Règles permanentes du projet

Ce dépôt contient **deux choses distinctes** :

1. **Un CRM en production** pour **Legrand Conseils Sàrl** (courtier en assurance
   indépendant, Suisse romande — Vaud / Genève). C'est une **zone protégée**.
2. **Un système de travail marketing** (phase « Marketing / Acquisition IA »),
   entièrement contenu dans `marketing-ai/` et `.claude/agents/`.

Ce fichier définit des **règles permanentes** valables pour toute session de
travail (humaine ou assistée par IA) sur ce dépôt.

---

## 1. Branches

| Branche | Rôle | Règle |
|---|---|---|
| `claude/insurance-broker-crm-exx09v` | **Production** (déployée par `deploy/install.sh`) | Ne jamais développer dessus. Ne jamais la modifier. |
| `feature/lead-generation-engine` | Bloc 4 CRM (partenaires) — non fusionné | Hors périmètre marketing. |
| `feature/marketing-ai-90-days` | **Branche de travail marketing** | Toute la phase marketing se fait ici. |

- La branche de travail marketing est **`feature/marketing-ai-90-days`**.
- La branche de production est **`claude/insurance-broker-crm-exx09v`** et ne doit
  **jamais** être modifiée dans le cadre du marketing.

---

## 2. Zone protégée — le CRM (interdiction de modifier sans autorisation humaine)

Ne **jamais** modifier, sans autorisation humaine explicite, les éléments suivants :

- `server/` (backend Express, routes, logique métier)
- `client/` (frontend React)
- `data/` (base SQLite de production + secret de session — **données clients réelles**)
- **les migrations** (`server/db.js`, `PRAGMA user_version`)
- **la base SQLite** (`data/crm.sqlite` et fichiers `-wal` / `-shm`)
- **les dépendances** (`package.json`, `package-lock.json`, `node_modules/`)
- **les fichiers de déploiement** (`deploy/`)
- **les routes publiques** (`server/routes/public.js`)
- **l'authentification** (`server/auth.js`, `server/totp.js`, `server/session-store.js`)
- **les données clients** (toute donnée personnelle réelle)

Interdictions absolues côté technique :

- Ne **jamais** lancer de migration.
- Ne **jamais** créer de migration dans le cadre du travail marketing.
- Ne jamais toucher à la base de données de production.

---

## 3. Périmètre autorisé pour le marketing

Toutes les créations marketing doivent rester **exclusivement** dans :

- `marketing-ai/`
- `.claude/agents/`

Aucun fichier en dehors de ces deux emplacements ne doit être créé ou modifié
dans le cadre de la phase marketing (à l'exception de ce `CLAUDE.md`, créé une
seule fois comme socle de règles).

---

## 4. Règles de conduite marketing (nLPD / LSA / FINMA)

- Ne **jamais** publier automatiquement (réseaux sociaux, site, blog, etc.).
- Ne **jamais** envoyer automatiquement de message ou d'e-mail à un prospect.
- Ne **jamais** collecter de **données médicales sensibles** dans un formulaire
  marketing.
- Ne **jamais** utiliser de **scraping de données personnelles**.
- Ne **jamais** organiser de **démarchage à froid automatisé**.

### Processus obligatoire pour tout contenu

Aucune exception :

1. **Brouillon IA** ;
2. **Contrôle conformité** ;
3. **Validation humaine** ;
4. **Publication ou envoi manuel** (jamais automatique).

### Vérification des affirmations

- Toute affirmation **juridique, réglementaire, fiscale, tarifaire** ou **liée à
  une assurance** doit être **vérifiée avant publication**.
- En cas de doute, ajouter la mention : **`Vérification humaine obligatoire`**.

### Marché et ton

- Contenus adaptés à la **Suisse romande**, principalement **Vaud et Genève**.
- Ton **professionnel, humain, pédagogique et non agressif**.

### Promesses interdites

Aucun agent, aucun contenu ne doit promettre :

- une **économie garantie** ;
- un **rendement garanti** ;
- une **acceptation d'assurance** garantie ;
- le **« meilleur produit du marché »**.

---

## 5. Discipline Git et rendu de compte

- Avant chaque lot de travail : exécuter **`git status`**.
- Après chaque lot, présenter systématiquement :
  - les **fichiers créés** ;
  - les **fichiers modifiés** ;
  - les **validations nécessaires** ;
  - les **risques** ;
  - le **résultat de `git status`**.
- Ne **jamais** effectuer de **commit, push, merge, rebase ou suppression** sans
  demande explicite de l'utilisateur.

---

## 6. Rappel — conflit de migrations (documenté dans `PROJECT_HANDOFF.md`)

`PROJECT_HANDOFF.md` (§10) documente un **conflit de migration** : la branche de
production crée la table `consents` en `user_version < 6`, tandis que la branche
`feature/lead-generation-engine` crée aussi ses tables partenaires en
`user_version < 6`. La résolution prévue est de renuméroter le bloc partenaires
en `user_version < 7`.

**Ce rappel est purement informatif.** La phase marketing ne doit créer **aucune
migration** et ne touche pas au schéma. Si un jour un module marketing devait
exister *dans l'application* (décision humaine séparée), il faudrait viser une
migration de numéro **strictement supérieur** aux versions déjà utilisées pour
éviter de reproduire ce conflit.

---

## 6bis. Règles internes de conformité — 10 points (nLPD / LSA / FINMA)

> **Nature de ces règles.** Ce sont des **règles internes prudentielles** que
> Legrand Conseils Sàrl s'impose volontairement. Elles ne constituent **ni un avis
> juridique**, **ni une certification ou une approbation FINMA**. En cas de doute :
> **`Vérification humaine obligatoire`**.

1. **Aucune donnée réelle de client ou de prospect** ne doit être transmise à un
   outil d'IA externe : ni identité, ni coordonnées, ni contrats, ni documents, ni
   données financières, ni données médicales / de santé.
2. **Uniquement des données fictives, anonymisées ou agrégées** dans les brouillons
   marketing et les exemples.
3. **Toute exception** doit faire l'objet d'une **validation humaine documentée**
   couvrant : base légale, sous-traitance, sécurité, lieu de traitement et
   transferts éventuels hors de Suisse.
4. **Aucun démarchage téléphonique à froid.**
5. **Aucune liste de prospects** obtenue par scraping, achat ou collecte non
   sollicitée.
6. **Aucun téléchargement de guide** n'inscrit automatiquement à une newsletter.
7. **Le consentement marketing est distinct, explicite, facultatif et jamais
   pré-coché.**
8. **Aucun agent ne délivre de conseil personnalisé automatique** ni de
   recommandation de produit définitive.
9. **Toute affirmation** relative à la LSA, la LAMal, la LCA, la LPP, la fiscalité,
   aux primes, rendements, rémunérations ou prestations doit indiquer sa **source**
   et sa **date de vérification** ; en cas de doute, mention
   **`Vérification humaine obligatoire`**.
10. **Le passage du marketing au conseil** déclenche les **procédures
    d'intermédiation réglementées** (LSA / FINMA) : information précontractuelle,
    devoir de diligence, documentation.

---

## 7. Résumé en une phrase

> Le CRM est intouchable sans accord humain ; le marketing vit dans `marketing-ai/`
> et `.claude/agents/` ; rien n'est publié ni envoyé automatiquement ; tout contenu
> passe par brouillon → conformité → validation humaine → diffusion manuelle.
