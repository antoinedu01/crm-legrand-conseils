# CLAUDE.md — Règles permanentes du projet

Ce dépôt contient **deux choses distinctes** :

1. **Un CRM en production** pour **Legrand conseils Sàrl** (courtier en assurance
   indépendant, Suisse romande — Vaud / Genève). C'est une **zone protégée**. Un
   chantier de développement CRM (module Assurance Suisse, backend et futur
   frontend) est en cours sur une branche de travail dédiée, distincte de la
   production — voir §1.
2. **Un système de travail marketing** (phase « Marketing / Acquisition IA »),
   entièrement contenu dans `marketing-ai/` et `.claude/agents/`.

Ce fichier définit des **règles permanentes** valables pour toute session de
travail (humaine ou assistée par IA) sur ce dépôt.

---

## 1. Branches

| Branche | Rôle | Règle |
|---|---|---|
| `claude/insurance-broker-crm-exx09v` | **Production** (déployée par `deploy/install.sh`) | Ne jamais développer dessus. Ne jamais la modifier sans validation humaine explicite. Aucune fusion ni déploiement automatique depuis une branche de travail (marketing ou CRM) : toute intégration doit être revue et validée séparément. |
| `feature/swiss-insurance-crm` | **Branche de travail CRM Assurance Suisse** (backend + futur frontend) | Contient les Lots A à G3 déjà validés (migration, routes, validations, tests, documentation). Autorisée pour le développement futur du CRM Assurance Suisse (backend et frontend), par lots validés individuellement. Les protections de la §2 restent pleinement applicables — voir §3bis. |
| `feature/marketing-ai-90-days` | **Branche de travail marketing** | Toute la phase marketing (contenus, outils, agents) se fait ici. Ne plus l'utiliser pour de nouveaux développements CRM ou pour le frontend Assurance Suisse : ce travail se fait désormais sur `feature/swiss-insurance-crm`. |
| `feature/lead-generation-engine` | Bloc 4 CRM (partenaires) — non fusionné | Hors périmètre marketing. |

- La branche de travail marketing est **`feature/marketing-ai-90-days`** :
  contenus, outils et agents marketing uniquement (§3).
- La branche de travail CRM Assurance Suisse est **`feature/swiss-insurance-crm`**,
  créée depuis le commit `8ff16ee3241554e1f402d46732e9ad09f066d5b7`. Elle partage
  donc l'historique antérieur de `feature/marketing-ai-90-days` jusqu'à ce commit
  inclus ; aucun nettoyage, rebase ou réécriture de cet historique n'est prévu.
  Les futurs commits liés au CRM Assurance Suisse (backend et frontend) doivent
  être réalisés exclusivement sur cette branche (§3bis).
- La branche de production est **`claude/insurance-broker-crm-exx09v`** et ne doit
  **jamais** être modifiée directement, ni dans le cadre du marketing ni dans le
  cadre du CRM Assurance Suisse, sans validation humaine explicite.

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
- **les permissions Claude Code** (`.claude/settings.json`)

Interdictions absolues côté technique :

- Ne **jamais** lancer de migration.
- Ne **jamais** créer de migration dans le cadre du travail marketing.
- Ne jamais toucher à la base de données de production.

**Ces protections s'appliquent quelle que soit la branche de travail**, y
compris `feature/swiss-insurance-crm` : le fait que cette branche soit
autorisée pour le développement du CRM Assurance Suisse ne constitue jamais
une autorisation générale de modifier librement `server/db.js`, les
migrations, `server/routes/contracts.js` (y compris ses routes `DELETE`),
l'authentification ou `.claude/settings.json`. Toute modification de ces
éléments reste soumise à autorisation humaine explicite, lot par lot.

---

## 3. Périmètre autorisé pour le marketing

Toutes les créations marketing doivent rester **exclusivement** dans :

- `marketing-ai/`
- `.claude/agents/`

Aucun fichier en dehors de ces deux emplacements ne doit être créé ou modifié
dans le cadre de la phase marketing (à l'exception de ce `CLAUDE.md`, créé une
seule fois comme socle de règles).

---

## 3bis. Périmètre autorisé pour le CRM Assurance Suisse

La branche `feature/swiss-insurance-crm` est dédiée au développement du CRM
Assurance Suisse : migration et modèle de données, routes et validations des
contrats, tests backend, documentation technique, puis interface utilisateur
(frontend) à venir.

Ce périmètre reste **entièrement soumis aux protections de la §2** : chaque
lot de travail y est validé individuellement par l'utilisateur avant toute
modification de fichier protégé, avec tests rouges avant correction lorsque
c'est pertinent, suite de tests complète après modification, et revue en
lecture seule (sécurité, QA ou migration selon le type de lot) avant tout
commit. Cette autorisation de branche ne remplace ni n'annule les
autorisations ponctuelles déjà exigées par la §2 pour chaque fichier protégé,
et ne présume ni d'une fusion vers la production ni d'un frontend déjà
réalisé.

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
- Les modifications importantes (notamment sur les fichiers protégés de la §2)
  sont réalisées **par lots validés individuellement**, avec tests rouges avant
  correction lorsque c'est pertinent, suite de tests complète après chaque
  modification, et revue en lecture seule (sécurité, QA ou migration selon le
  lot) avant tout commit.
- Aucune fusion vers la branche de production ne doit être effectuée sans une
  validation humaine explicite et distincte, dédiée à cette fusion.

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
> Legrand conseils Sàrl s'impose volontairement. Elles ne constituent **ni un avis
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

## 6ter. Neutralité, conseil et non-dénigrement

Règle permanente applicable à **tous les agents** et à tout contenu produit.

**Interdictions** — aucun agent ne doit :

- dénigrer une compagnie d'assurance ;
- dénigrer un conseiller, un courtier ou un concurrent ;
- affirmer qu'un assureur est globalement meilleur ou moins bon ;
- affirmer qu'un courtier ou conseiller est meilleur qu'un autre ;
- déclarer que passer par Legrand conseils Sàrl est systématiquement
  préférable à passer directement par une compagnie ;
- créer des classements publics d'assureurs ou de conseillers ;
- utiliser des formulations humiliantes, agressives ou inutilement négatives
  concernant un concurrent ;
- généraliser à partir d'un cas isolé ;
- présenter un client comme ayant été « mal conseillé », « arnaqué », ou comme
  ayant « jeté son argent ».

**Autorisations** — les agents peuvent en revanche :

- présenter plusieurs possibilités ;
- expliquer les différences ;
- exposer les avantages, limites, exclusions et conditions ;
- comparer des critères objectifs et vérifiables ;
- recommander une solution en fonction de la situation individuelle ;
- préciser qu'une solution paraît plus adaptée à certains besoins ;
- rappeler qu'aucune solution n'est universellement meilleure.

**Formulation recommandée** :

> `Au regard des informations disponibles et des besoins exprimés, cette
> solution paraît plus adaptée sur les points suivants…`

Toute recommandation doit rester **individualisée, justifiée et neutre**.
Les comparaisons **objectives, utiles, sourcées et neutres** restent autorisées.

---

## 6quater. Portée exacte de l'inscription FINMA

Inscriptions confirmées par les documents officiels (17/07/2026) :

- **Société** : « Legrand conseils Sàrl » (orthographe du registre), registre
  **F01569363**, **intermédiaire d'assurance non lié**, branches inscrites :
  **assurance-maladie complémentaire et assurance-vie**, UID CHE-376.900.357.
- **Personne physique** : Antoine Legrand, registre **F01569355**,
  **intermédiaire d'assurance non lié**, mêmes branches inscrites.

Règles impératives :

- L'inscription FINMA ne doit **jamais** être présentée comme une **autorisation
  générale** couvrant toutes les activités de l'entreprise.
- Elle ne doit notamment **pas** être présentée comme la preuve d'un **agrément
  FINMA pour l'assurance obligatoire LAMal**.
- Toute mention publique doit reprendre **exactement** le statut et les branches
  figurant dans le registre.
- Ne **jamais** employer : « approuvé par la FINMA », « certifié FINMA »,
  « conforme FINMA », « autorisé FINMA pour toutes les assurances ».
- Formulation à préférer :
  > « inscrit au registre public de la FINMA comme intermédiaire d'assurance non
  > lié pour les branches assurance-maladie complémentaire et assurance-vie »

---

## 7. Résumé en une phrase

> Le CRM est intouchable sans accord humain, quelle que soit la branche
> (production, marketing ou CRM Assurance Suisse) ; le marketing vit dans
> `marketing-ai/` et `.claude/agents/` sur `feature/marketing-ai-90-days` ; le
> CRM Assurance Suisse (backend et futur frontend) se développe par lots
> validés sur `feature/swiss-insurance-crm` ; rien n'est publié, envoyé, fusionné
> ou déployé automatiquement ; tout contenu marketing passe par brouillon →
> conformité → validation humaine → diffusion manuelle.
