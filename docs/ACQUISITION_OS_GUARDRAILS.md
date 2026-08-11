# Acquisition OS — Integration Guardrails

> Porté depuis le garde-fou historique du Lot A0 (`feature/acquisition-os`,
> commit `9be2f8b`), et adapté au contexte de la branche d'intégration créée
> par le preflight M0b/M0c0. Ce document est purement déclaratif : il ne
> contient aucun code runtime et ne modifie aucun comportement du CRM. Il
> fixe les règles de réconciliation entre Acquisition OS et la base
> Diagnostic 360 actuelle.

---

## 1. Contexte d'intégration actuel

- **Base d'intégration actuelle** : `origin/claude/insurance-broker-crm-exx09v`
  (branche par défaut réelle du dépôt, confirmée par le checkpoint et le
  preflight M0b — traitée comme base d'intégration technique actuelle, pas
  déclarée base de production définitive à long terme).
- **Worktree d'intégration** : `/home/user/crm-legrand-conseils-acquisition-integration`
- **Branche d'intégration** : `integration/acquisition-advisory-v1`

`feature/acquisition-os` (worktree `/home/user/crm-legrand-conseils-acquisition`)
est désormais une **SOURCE HISTORIQUE DE COMMITS**, pas la base d'exécution
future. On y lit et on en extrait des commits ciblés ; on n'y développe plus
de nouveau code Acquisition OS destiné à cette base d'intégration.

## 2. Interdiction de fusion en bloc

**`feature/acquisition-os` ne doit jamais être mergée en bloc** (`git merge`)
ni rebasée intégralement dans la base d'intégration. Seuls des commits
individuels, ciblés et explicitement validés, sont importés (cherry-pick).

## 3. Historique parasite — ne jamais importer automatiquement

`feature/acquisition-os` porte des changements sans rapport avec Acquisition
OS (missions marketing antérieures sur la même lignée). **Ne jamais importer
automatiquement** :

- `marketing-ai/*`
- `.claude/agents/*.md`

Seuls les commits Acquisition OS explicitement listés et validés lot par lot
sont candidats à l'import.

## 4. Worktrees protégés — zone interdite en écriture

Ne doivent **jamais être modifiés** depuis une mission d'intégration :

- `/home/user/crm-legrand-conseils` (worktree principal)
- `/home/user/crm-legrand-conseils-acquisition` (worktree Acquisition historique)

Les deux peuvent être **lus** en lecture seule à titre de vérification,
jamais écrits.

## 5. Diagnostic 360 — zone protégée

Diagnostic 360 (le module Legrand Diagnostic 360 / "Advisory", déjà
substantiellement intégré à la base actuelle — households, sessions,
questionnaires, règles, findings, recommandations, rétention) est une
**zone protégée**. Aucun lot d'intégration Acquisition OS ne modifie, ne
touche, ni ne dépend d'un état non commité de Diagnostic 360.

## 6. Appointments et advisory_sessions — deux concepts distincts

Confirmé par analyse de code approfondie (preflight M0b) : la table
`appointments` (Acquisition OS) et `advisory_sessions` (Diagnostic 360) sont
**deux concepts métier différents et complémentaires**, pas un doublon.
`advisory_sessions` est un mécanisme de collecte de données structurées
(questionnaire de diagnostic sur un foyer), sans notion de rendez-vous daté
avec lieu/durée. `appointments` reste la table de rendez-vous datés
d'Acquisition OS. **Les deux doivent coexister** — aucune fusion, aucun
abandon de l'une au profit de l'autre.

## 7. Fichiers partagés — signalement obligatoire avant modification

Toute modification future de l'un de ces fichiers doit être **explicitement
signalée avant implémentation**, jamais faite silencieusement au fil d'un
lot :

- `server/db.js`
- `server/app.js`
- `server/routes/clients.js`
- `server/routes/today.js`
- `client/src/App.jsx`
- `docs/MIGRATIONS.md`

## 8. Taille des lots

Les lots d'intégration doivent être **petits, indépendants et revertables**
individuellement — jamais un lot unique regroupant plusieurs briques
fonctionnelles distinctes.

## 9. Déploiement production

**Aucun déploiement production automatique.** Toute mise en production reste
un acte humain explicite, hors du périmètre d'une mission d'intégration.

## 10. Migrations — numérotation

**Aucun numéro de migration Acquisition n'est réservé à ce jour.** Toute
migration Acquisition OS portée sur cette base doit être numérotée **après
le plafond réel de `server/db.js` de la base d'intégration, revérifié au
moment précis de son intégration** — jamais un numéro décidé à l'avance ou
supposé stable dans le temps, la base ayant déjà avancé plusieurs fois
pendant les seuls audits précédents.

Toute modification de `server/db.js` exige, dans l'ordre :

1. contrôle du plafond réel de version au moment de l'exécution ;
2. tests de migration base actuelle → schéma final (base vierge, base
   actuelle réelle, idempotence, préservation des données) ;
3. sauvegarde préalable avant toute exécution en production.

**Aucune migration production automatique** — décision humaine explicite et
sauvegarde préalable requises (voir `docs/MIGRATIONS.md`, non modifié par ce
lot).

## 11. Analytics Acquisition — dépendance au schéma commissions

`server/routes/acquisition-analytics.js` interroge `commissions` avec des
noms de colonnes et un vocabulaire de statut antérieurs à la migration 15 de
la base actuelle (`amount`/`due_date`/`paid_date`/statuts français). **Ce
fichier doit être adapté au schéma `commissions` courant avant toute
activation** — non fait dans ce lot, à traiter dans un lot Analytics dédié
ultérieur, avec une décision métier explicite sur les métriques
`expected_amount_chf` vs `received_amount_chf` (déjà actée séparément :
Analytics exposera les deux, la métrique principale de performance
d'acquisition étant les commissions **attendues**).

## 12. Avant chaque lot d'intégration

Avant d'entamer tout nouveau lot, vérifier systématiquement :

- la branche courante (`git branch --show-current` = `integration/acquisition-advisory-v1`) ;
- le `HEAD` courant (`git rev-parse HEAD`) ;
- l'état du working tree (`git status --short` = propre) ;
- que le tip de `origin/claude/insurance-broker-crm-exx09v` n'a pas avancé
  depuis la dernière vérification (sinon : STOP, ne pas merger/rebaser/reset) ;
- l'état des worktrees Acquisition historique et principal, en lecture seule
  uniquement.

Si l'une de ces conditions n'est pas remplie, arrêter avant toute
modification.

## 13. Après chaque lot d'intégration

- exécuter les tests disponibles ;
- afficher le diff complet des changements ;
- afficher la liste exacte des fichiers modifiés ;
- vérifier l'état des trois worktrees (intégration, Acquisition historique,
  principal) ;
- ne committer qu'après validation explicite ;
- ne jamais pousser (`push`) la branche d'intégration sans validation
  explicite distincte.

## 14. Publicité payante

**Aucun travail publicitaire payant ne doit être activé avant le
1er septembre 2026.** Aucune campagne Google Ads, Meta Ads ou équivalent ne
doit être configurée ni appelée avant cette date.

## 15. Briques existantes confirmées réutilisables

Le preflight M0b (analyse de code, pas une simple lecture de commit) a
confirmé, sur la base d'intégration actuelle :

- `clients`, `campaigns`, `lead_details` — **schéma 100% inchangé** depuis
  le point de divergence, compatibles sans adaptation.
- `channels` (référentiel de canaux d'acquisition, 14 canaux pré-seedés).
- `POST /api/public/lead` (point d'ingestion externe déjà en production).
- `server/routes/prospects.js`, `server/scoring.js` (pipeline des
  prospects, scoring).
- `commissions` — **schéma substantiellement remanié par la migration 15**
  (déjà fusionnée) : colonnes renommées, nouveau vocabulaire de statut,
  paiement partiel désormais possible. Toute brique Acquisition qui lit
  cette table (notamment Analytics, §11) doit être adaptée, pas réutilisée
  telle quelle.

Ces briques doivent être **réutilisées**, jamais reconstruites en parallèle.

## 16. Objectif du produit

Acquisition OS doit **combler les trous fonctionnels identifiés** (gestion
des rendez-vous, CRUD campagnes, attribution contrat → canal/campagne) et
**coexister** avec Diagnostic 360 — pas créer un CRM parallèle, pas dupliquer
une brique déjà existante et fonctionnelle sur l'une ou l'autre lignée.
