# Acquisition OS — Development Guardrails

> Créé dans le cadre du Lot A0 (garde-fous), sur la branche
> `feature/acquisition-os`. Ce document est purement déclaratif : il ne
> contient aucun code runtime et ne modifie aucun comportement du CRM. Il
> fixe les règles à respecter pour tout développement futur d'Acquisition
> OS, en particulier vis-à-vis de Client 360, développé en parallèle.

---

## 1. Branche de développement

Acquisition OS est développé exclusivement sur :

```
feature/acquisition-os
```

## 2. Worktree

Tout le travail Acquisition OS s'effectue exclusivement dans :

```
/home/user/crm-legrand-conseils-acquisition
```

## 3. Worktree principal — zone interdite depuis les missions Acquisition

Le worktree principal :

```
/home/user/crm-legrand-conseils
```

**ne doit jamais être modifié** depuis une mission Acquisition OS — ni son
contenu, ni sa branche courante, ni son état Git. Il peut être **lu** en
lecture seule à titre de vérification (ex. `git -C
/home/user/crm-legrand-conseils status --short`), jamais écrit.

## 4. Client 360 — zone protégée

Client 360 (module en développement parallèle dans le worktree principal)
est une **zone protégée**. Aucune mission Acquisition OS ne modifie, ne
touche, ni ne dépend d'un état non commité de Client 360.

## 5. Fichiers partagés — signalement obligatoire avant modification

Les fichiers suivants sont partagés avec le reste du CRM (et potentiellement
avec le travail Client 360 en cours). Toute modification future de l'un
d'eux doit être **explicitement signalée avant implémentation**, jamais
faite silencieusement au fil d'un lot :

- `server/db.js`
- `server/app.js`
- `server/routes/clients.js`
- `server/routes/today.js`
- `client/src/App.jsx`

## 6. Taille des lots

Les lots de développement Acquisition OS doivent être **petits,
indépendants et revertables** individuellement — jamais un lot unique
regroupant plusieurs briques fonctionnelles distinctes.

## 7. Déploiement production

**Aucun déploiement production automatique.** Toute mise en production reste
un acte humain explicite, hors du périmètre d'une mission de développement.

## 8. Migrations production

**Aucune migration production automatique.** Une migration de schéma ne
s'applique en production qu'après décision humaine explicite et sauvegarde
préalable (voir `docs/MIGRATIONS.md`).

## 9. Numérotation des migrations

Toute migration Acquisition OS commence à `user_version = 9` (voir
`docs/MIGRATIONS.md`, section « Version 9 (réservée — Acquisition OS) »).
Les numéros 7 (réservé à `feature/lead-generation-engine`) et 8 (déjà
utilisé par les tables satellites de contrats) sont interdits.

## 10. Avant chaque lot

Avant d'entamer tout nouveau lot Acquisition OS, vérifier systématiquement :

- la branche courante (`git branch --show-current` = `feature/acquisition-os`) ;
- le `HEAD` courant (`git rev-parse HEAD`) ;
- l'état du working tree (`git status --short` = propre) ;
- l'état du worktree principal, en lecture seule uniquement
  (`git -C /home/user/crm-legrand-conseils status --short`).

Si l'une de ces conditions n'est pas remplie, arrêter avant toute
modification.

## 11. Après chaque lot

Après chaque lot Acquisition OS :

- exécuter les tests disponibles (si l'environnement le permet) ;
- afficher le diff complet des changements ;
- afficher la liste exacte des fichiers modifiés ;
- vérifier l'état des deux worktrees (Acquisition et principal) ;
- ne committer qu'après validation explicite, si le mandat de la mission le
  prévoit.

## 12. Publicité payante

**Aucun travail publicitaire payant ne doit être activé avant le
1er septembre 2026.** Aucune campagne Google Ads, Meta Ads ou équivalent ne
doit être configurée ni appelée avant cette date.

## 13. Briques existantes à réutiliser, pas à reconstruire

L'audit read-only préalable (branche `feature/acquisition-os`, commit
`378b439`) a confirmé que les briques suivantes existent déjà et sont
fonctionnelles. Elles doivent être **réutilisées**, jamais reconstruites en
parallèle :

- `clients` + `lead_details` (modèle lead/prospect, pipeline, scoring, canal
  et campagne d'origine)
- `channels` (référentiel de canaux d'acquisition, 14 canaux pré-seedés)
- `campaigns` (table existante — CRUD à compléter, pas à recréer)
- `channel_costs` (coûts par canal, base du calcul ROI/CAC)
- `scoring_rules` (règles de scoring paramétrables)
- `action_log` (anti-répétition des actions de prospection)
- `consents` (preuves de consentement horodatées, nLPD)
- `activities` (journal d'interactions, inclut déjà le type `rdv`)
- `tasks` (tâches de relance)
- `server/scoring.js` (moteur de scoring transparent et configurable)
- `server/routes/prospects.js` (pipeline des prospects, fonctionnel)
- `POST /api/public/lead` (point d'ingestion externe déjà en production)

## 14. Objectif du produit

Acquisition OS doit **combler les trous fonctionnels identifiés** par
l'audit (notamment : absence de table de rendez-vous, absence de CRUD
campagnes, absence d'attribution contrat → canal/campagne) — **pas créer un
CRM parallèle** ni dupliquer une brique déjà existante et fonctionnelle.
