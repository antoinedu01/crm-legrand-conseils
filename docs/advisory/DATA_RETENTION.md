# Conservation, anonymisation et effacement des données de diagnostic

> **POLITIQUE PROPOSÉE — VALIDATION JURIDIQUE HUMAINE REQUISE AVANT
> ACTIVATION.** Ce document décrit un mécanisme entièrement implémenté
> (`server/advisoryRetention.js`, migration 14) mais **désactivé par
> défaut** dans toute base réelle : les 5 catégories de politique
> (`advisory_retention_policies.enabled = 0`) et la purge réelle
> (`advisory_retention_config.real_purge_enabled = 0`). Aucune durée
> énoncée ci-dessous n'est présentée comme juridiquement validée — chacune
> reste une **proposition** de cadrage, à confirmer par un spécialiste
> avant toute activation. Ce document correspond au Lot 10 annoncé dans
> `IMPLEMENTATION_ROADMAP.md` et referencé (stub) dans
> `SECURITY_PRIVACY.md` §8-9.

## 1. Principe général

Le mécanisme comprend trois couches strictement séparées :

1. **Politiques** (`advisory_retention_policies`) : une ligne par
   catégorie, avec sa durée et son état actif/inactif.
2. **Simulation (dry-run)** : mode par défaut et **seul mode atteignable
   par une route HTTP** dans cette livraison
   (`POST /api/advisory/retention/dry-run`) — calcule l'éligibilité de
   chaque dossier, produit un rapport structuré, **n'écrit jamais** dans
   le contenu de diagnostic (`advisory_sessions`/`advisory_answers`/...).
3. **Purge réelle** (`executePurge`, `server/advisoryRetention.js`) :
   entièrement implémentée et testée sur bases temporaires isolées
   (`test/advisory-retention.test.js`), gardée par un cumul de 8
   conditions explicites (§6), **jamais atteignable par aucune route HTTP**
   de ce lot — aucune activation possible depuis l'interface.

Aucune tâche automatique, aucun cron, aucun scheduler n'exécute jamais ce
mécanisme : chaque simulation ou (hypothétique, hors de ce lot) purge est
un geste humain explicite, authentifié, tracé.

## 2. Catégories, critères et durées proposées

| Catégorie | `category` | Durée proposée | Critères d'éligibilité | Action prévue |
|---|---|---|---|---|
| A. Diagnostic abandonné | `abandoned_diagnostic` | 90 jours | Session jamais complétée (`completed_at IS NULL` — **jamais** `status != 'completed'`, qui redeviendrait vrai après une réouverture par amendement, voir `RULES_ENGINE.md`/`API_CONTRACT.md` sur la machine d'état de session) ; aucune recommandation (même brouillon — restriction volontairement plus stricte que « aucune validée », un brouillon reste un travail humain, jamais détruit automatiquement) ; dernière activité de plus de 90 jours (`last_activity_at`, ou `created_at` si jamais renseignée) | Suppression des réponses/findings/exécutions ; la ligne session elle-même est conservée (trace technique minimale : id, dates, statut) mais anonymisée (`title`/`household_snapshot` vidés) |
| B. Prospect sans mandat ni contrat | `prospect_no_mandate` | 12 mois (365 jours, approximation — voir §7) | Portée **foyer** : aucun contrat pour aucun membre du foyer (`contracts` via `household_members.client_id`) ; aucune recommandation sur aucune session du foyer ; dernière activité (max sur toutes les sessions du foyer) de plus de 12 mois | Identique à la catégorie A, appliqué à chaque session du foyer |
| C. Conseil finalisé | `finalized_advice` | 10 ans (3650 jours, approximation — voir §7) | Session complétée **et** au moins une recommandation validée (`validated`/`superseded`/`withdrawn` — toutes ont existé comme preuve d'un conseil réellement délivré) | **`retain` — jamais d'action automatique dans cette livraison.** L'échéance est calculée et affichée pour la transparence du dry-run (§7 interdit explicitement la suppression automatique d'une recommandation nécessaire à la preuve d'un conseil) ; une décision humaine et juridique distincte, hors de ce lot, est requise avant toute implémentation d'une action réelle sur cette catégorie |
| D. Journaux d'audit | `audit_log` | 10 ans | — (déclaratif uniquement) | **Aucune** — aucun code de ce lot ne supprime jamais une ligne `audit_log` : la supprimer minerait la traçabilité qu'elle est censée garantir |
| E. Sauvegardes | `backups` | 90 jours | — (déclaratif uniquement) | **Aucune** — ce lot ne gère, ne crée ni ne supprime jamais aucune sauvegarde ; le mécanisme existant (`GET /api/backup`, `SECURITY_PRIVACY.md` §11) reste inchangé |

Seules les catégories **A, B et C** sont effectivement évaluées par le
moteur d'éligibilité (`computeSessionEligibility`/
`computeHouseholdEligibility`) ; **D et E restent des paramètres
déclaratifs**, consultables pour la transparence nLPD (droit d'information
sur les durées de conservation), jamais des cibles d'effacement.

## 3. Déclenchement du délai

- Catégories A/B : `last_activity_at` de la session (colonne déjà
  existante, mise à jour à chaque démarrage/reprise/réponse enregistrée/
  effacée) — jamais `updated_at`, qui peut avancer pour des raisons
  purement techniques.
- Catégorie C : `completed_at` de la session — **limite documentée** : le
  schéma actuel ne porte aucune date dédiée de « clôture du mandat ou de
  la relation client » (l'expression exacte du cadrage). `completed_at`
  est utilisé comme proxy pratique, explicitement signalé comme une
  approximation nécessitant validation métier avant toute activation
  réelle de cette catégorie.

## 4. Legal hold

Un legal hold (`advisory_retention_legal_holds`) bloque
**inconditionnellement** toute action de purge pour le foyer concerné,
quelle que soit la catégorie ou l'échéance calculée.

- Motif obligatoire à la création et à la levée.
- Un seul hold actif par foyer à la fois (contrainte SQL).
- Origine (motif/auteur/date de création) immuable une fois posée ; la
  levée renseigne `ended_at`/`ended_by_user_id`/`ended_reason` sur la même
  ligne. Réactiver un hold après levée insère une **nouvelle** ligne —
  l'historique complet d'un foyer reste donc la liste de toutes ses
  lignes, jamais une donnée écrasée.
- **Aucune activation automatique** : seul un utilisateur authentifié
  (`requireAuth`, même garde que le reste de l'application) peut poser ou
  lever un hold, via `POST /api/advisory/retention/households/:id/legal-holds`
  et `.../legal-holds/:holdId/lift`.

## 5. Simulation (dry-run) — rapport produit

Chaque simulation (`advisory_retention_purge_runs` + `_items`) enregistre,
par dossier éligible : identifiant technique (`household_id`/`session_id`),
catégorie, date de dernière activité *dérivée* (jamais republiée en clair
si elle contiendrait une donnée sensible — ici uniquement des dates),
durée applicable, date d'échéance, motif d'éligibilité (identifiant
technique court, ex. `session_never_completed_inactive`), statut vis-à-vis
d'un éventuel legal hold, action envisagée, nombre de lignes concernées
**par table** (`rows_affected_summary`, uniquement des compteurs).

**Ne figure jamais** dans un rapport : valeur de réponse, donnée de santé,
donnée financière, justification humaine, titre de session, nom complet —
vérifié explicitement par test (`test/advisory-retention.test.js`, « dry-run
— aucune valeur sensible dans le rapport »).

## 6. Activation d'une purge réelle — conditions cumulatives

`executePurge` refuse l'exécution tant que **l'une** des conditions
suivantes n'est pas remplie (`assertPurgeAuthorized`,
`server/advisoryRetention.js`) :

1. configuration globale activée (`advisory_retention_config.real_purge_enabled = 1`) ;
2. utilisateur authentifié résolu ;
3. confirmation explicite (`confirmed: true`) ;
4. un rapport dry-run récent existe (≤ 24h par défaut) ;
5. une sauvegarde vérifiée récente est fournie (≤ 24h) ;
6. absence de legal hold pour le foyer concerné (revérifiée juste avant
   l'écriture, en plus du calcul d'éligibilité) ;
7. exécution dans une transaction SQLite unique (rollback complet en cas
   d'erreur, y compris une violation de contrainte de clé étrangère) ;
8. un indicateur d'intention explicite (`confirmProductionTarget`) est
   requis dès que `CRM_DATA_DIR` n'est pas positionné (donc potentiellement
   une cible réelle) — protège contre un « test involontaire ».

**Aucune route HTTP de ce lot n'appelle `executePurge`.** La fonction
n'est exercée que par `test/advisory-retention.test.js`, toujours sur une
base temporaire isolée. Activer une purge réelle en production exigerait
une décision humaine et technique distincte, hors du périmètre de cette
livraison (créer une route dédiée, décider qui peut l'invoquer, etc.).

## 7. Limites documentées (à trancher avant toute activation)

1. **Durées exprimées en jours, jamais en mois/années calendaires** — « 12
   mois » et « 10 ans » sont approximés à 365 et 3650 jours faute de
   logique calendaire dédiée dans le schéma actuel. Sur des durées aussi
   longues, l'écart avec un calcul calendaire exact (années bissextiles)
   reste de l'ordre de quelques jours — jugé négligeable pour une
   politique elle-même non encore validée juridiquement, mais à
   reconsidérer si une précision calendaire stricte devient exigée.
2. **Catégorie C** : absence d'une date dédiée de « clôture du mandat »
   dans le schéma actuel (voir §3) — `completed_at` est un proxy, jamais
   une validation métier.
3. **Catégorie C, action réelle** : ce lot calcule et affiche l'échéance
   mais n'implémente **aucune** action d'effacement/anonymisation
   automatique sur une recommandation validée, quelle que soit son
   ancienneté — décision humaine distincte requise.
4. **Aucun indicateur dédié côté conseiller** pour signaler qu'un dossier
   approche d'une échéance de rétention — seul le rapport dry-run (§10,
   interface de consultation) l'expose aujourd'hui.

## 8. Stratégie d'effacement — relations et interdictions

Relations couvertes : `households` / `household_members` /
`advisory_sessions` / `advisory_answers` / `advisory_rule_executions` /
`advisory_findings` / `advisory_recommendations` / `audit_log` /
`contracts` / `commissions`.

**Interdictions absolues, vérifiées par test** (`test/advisory-retention.test.js`) :

- jamais de suppression d'un `contracts` ou `commissions` via ce
  mécanisme — la purge advisory ne lit ces tables que pour calculer
  l'éligibilité (présence d'un contrat), ne les modifie jamais ;
- jamais de suppression automatique d'une recommandation nécessaire à la
  preuve d'un conseil (catégorie C, `action_planned` toujours `retain`) ;
- jamais de clé étrangère cassée (`PRAGMA foreign_key_check` vérifié après
  chaque purge de test) ;
- jamais de réutilisation d'un identifiant supprimé (aucune ligne n'est
  jamais physiquement supprimée de `advisory_sessions`/`households` par ce
  mécanisme — seul le CONTENU d'une session est effacé, jamais la ligne
  elle-même) ;
- jamais de session identifiable sans finalité valable : `title` et
  `household_snapshot` sont vidés pour toute session purgée (catégories
  A/B), ne laissant qu'une trace technique (id, dates, statut).

Ordre d'effacement (`eraseSessionDiagnosticContent`) : `advisory_findings`
→ `advisory_rule_executions` → `advisory_answers` → anonymisation de la
ligne `advisory_sessions` — respecte les dépendances de clés étrangères
existantes ; aucune ligne `advisory_recommendations` n'est jamais présente
à ce stade (l'éligibilité l'exige explicitement, voir §2).

## 9. Transparence nLPD

- **Finalité** : permettre au conseiller de mener un diagnostic
  d'assurance (santé, vie/prévoyance) et de formuler un conseil documenté.
- **Catégories de données concernées** : réponses au questionnaire de
  diagnostic (dont certaines classées sensibles, `advisory_questions.sensitive`),
  constats produits par le moteur de règles, recommandations humaines.
- **Durées/critères de conservation** : voir §2 — proposées, non validées
  juridiquement.
- **Déclenchement du délai** : voir §3.
- **Legal hold** : voir §4 — empêche toute suppression tant qu'une
  obligation de conservation particulière (ex. procédure en cours)
  s'applique.
- **Sauvegardes** : voir `SECURITY_PRIVACY.md` §11 — mécanisme existant,
  inchangé par ce lot ; propagation d'une suppression aux sauvegardes déjà
  produites : **non garantie avant l'expiration naturelle de la
  sauvegarde** (durée proposée 90 jours, §2.E) — une donnée supprimée de
  la base active peut donc subsister dans une sauvegarde déjà existante
  jusqu'à sa propre expiration, point à documenter explicitement dans
  toute communication aux personnes concernées avant activation.
- **Anonymisation vs effacement** : ce lot privilégie la conservation
  d'une trace technique minimale anonymisée (jamais une suppression
  physique de la ligne `advisory_sessions`) — cohérent avec le principe
  déjà documenté pour `households`/`household_members`
  (`DATA_MODEL.md` §2.1/§2.2 : « ne supprime jamais... anonymise »).
- **Droits d'accès/rectification/effacement** : ce lot n'étend pas
  aujourd'hui le mécanisme d'export existant (`GET /api/clients/:id/export`,
  `SECURITY_PRIVACY.md` §10) — l'inclusion des données `advisory_*` dans
  cet export reste une proposition à confirmer (Lot 10, non traitée par ce
  lot précis).
- **Absence de décision entièrement automatisée** : aucune purge réelle
  n'a jamais lieu automatiquement (§6) — toute exécution reste un geste
  humain explicite, tracé, réversible seulement dans la mesure où le mode
  par défaut (dry-run) ne modifie jamais rien.

## 10. Interface (consultation et simulation uniquement)

`client/src/pages/DataRetention.jsx` (voir aussi
`docs/advisory/API_CONTRACT.md`) affiche : état actif/inactif de chaque
politique (« en attente de validation juridique » tant qu'aucune catégorie
n'est activée), dossiers prochainement éligibles (résultat de la dernière
simulation), historique des simulations, legal holds actifs et leur
historique, raisons d'exclusion (legal hold, contrat existant, session déjà
complétée...). **Aucun bouton d'exécution réelle** n'existe dans cette
interface — cohérent avec l'absence de route `executePurge` (§6).

## 11. Points nécessitant une validation juridique, réglementaire ou métier

(Complète la liste déjà tenue par `SECURITY_PRIVACY.md` §20.)

1. Les 5 durées proposées (§2) — aucune n'est validée juridiquement.
2. L'approximation jours/mois/années (§7.1).
3. La date de référence de la catégorie C (« clôture du mandat », §3, §7.2)
   — absente du schéma actuel, à définir précisément.
4. L'action réelle (le cas échéant) applicable à la catégorie C une fois
   son échéance atteinte (§7.3) — aucune n'est implémentée par ce lot.
5. L'inclusion des données `advisory_*` dans l'export nLPD existant (§9).
6. La propagation effective d'une suppression aux sauvegardes déjà
   produites (§9).
