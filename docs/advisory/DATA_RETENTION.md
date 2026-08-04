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

> **Décision humaine du 2026-08-04 (validation de la PR d'intégration
> technique — sans activation d'aucune politique)** : les 5 durées, la
> conception du legal hold et l'inclusion des données `advisory_*` dans
> l'export nLPD existant sont validées comme **cadrage**, ci-dessous ; **la
> purge réelle reste refusée à ce stade** (aucune modification). Correction
> apportée suite à cette décision : les catégories B et C utilisent
> désormais une arithmétique **calendaire exacte** (12 mois / 10 ans
> civils), plus une approximation en jours (365/3650) — voir §2, §7.

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
| B. Prospect sans mandat ni contrat | `prospect_no_mandate` | **12 mois calendaires exacts** (validé par décision humaine du 2026-08-04 — arithmétique calendaire, plus une approximation en jours, voir §7) | Portée **foyer** : aucun contrat pour aucun membre du foyer (`contracts` via `household_members.client_id`) ; aucune recommandation sur aucune session du foyer ; dernière activité (max sur toutes les sessions du foyer) au-delà de 12 mois calendaires exacts | Identique à la catégorie A, appliqué à chaque session du foyer |
| C. Conseil finalisé | `finalized_advice` | **10 années calendaires exactes** (validé par décision humaine du 2026-08-04) après la **clôture réelle** du mandat ou de la relation client — `completed_at` sert de proxy pour la **simulation** dry-run uniquement (voir §3) | Session complétée **et** au moins une recommandation validée (`validated`/`superseded`/`withdrawn` — toutes ont existé comme preuve d'un conseil réellement délivré) | **`retain` — jamais d'action automatique dans cette livraison, garanti structurellement (double vérification dans `executePurge`).** L'échéance est calculée et affichée pour la transparence du dry-run (§7 interdit explicitement la suppression automatique d'une recommandation nécessaire à la preuve d'un conseil) ; une décision humaine et juridique distincte, hors de ce lot, est requise avant toute implémentation d'une action réelle sur cette catégorie, **et devra alors s'appuyer sur une date de clôture réelle du mandat, jamais sur `completed_at`** |
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

1. **RÉSOLU (décision humaine du 2026-08-04)** — les catégories B et C
   utilisaient initialement une approximation en jours (365/3650) ; elles
   utilisent désormais une **arithmétique calendaire exacte** (12 mois
   civils / 10 années civiles, `addCalendarMonths`,
   `server/advisoryRetention.js`), avec gestion correcte des années
   bissextiles (clampage sur le dernier jour valide du mois cible, ex. 29
   février + 12 mois → 28 février l'année suivante si non bissextile —
   vérifié par test). La catégorie A reste volontairement exprimée en jours
   (90 jours après la dernière activité, décision humaine explicite,
   inchangée) — aucune arithmétique calendaire n'y est appliquée. La
   colonne `advisory_retention_policies.duration_days` reste seedée à
   365/3650 pour B/C à titre d'ordre de grandeur affiché dans l'interface,
   mais n'est plus la source du calcul d'éligibilité pour ces deux
   catégories.
2. **Catégorie C** : absence d'une date dédiée de « clôture du mandat »
   dans le schéma actuel (voir §3) — `completed_at` reste un proxy de
   **simulation uniquement**. **Décision humaine du 2026-08-04** : aucune
   purge réelle ne pourra jamais utiliser `completed_at` comme date de
   clôture — garanti structurellement par `action_planned` toujours
   `'retain'` pour cette catégorie et par une exclusion explicite
   supplémentaire dans `executePurge` (défense en profondeur). Une date de
   clôture réelle du mandat devra être ajoutée au schéma (nouvelle
   migration, hors de ce lot) avant toute implémentation d'une action
   réelle sur cette catégorie.
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

**Validés par décision humaine du 2026-08-04** (cadrage — n'autorisent
aucune activation de politique ni aucune purge réelle) :
- Les 5 durées/catégories (§2) : 90 jours (A), 12 mois calendaires (B), 10
  années calendaires (C), 10 ans déclaratif (D), 90 jours déclaratif (E).
- La conception du legal hold (§4).
- L'inclusion future des données `advisory_*` dans l'export nLPD existant
  (§9) — décision de principe ; l'extension elle-même de
  `GET /api/clients/:id/export` reste **non implémentée**, hors périmètre
  de ce lot, à traiter séparément.
- ~~L'approximation jours/mois/années~~ — **résolu par arithmétique
  calendaire exacte** (§7.1), n'est plus une question ouverte pour B/C.

**Toujours ouverts** (aucune activation possible sans réponse) :
1. La date de référence exacte de la catégorie C (« clôture réelle du
   mandat ou de la relation client », §3, §7.2) — absente du schéma actuel ;
   `completed_at` reste un proxy de simulation uniquement, jamais utilisable
   par une purge réelle (garanti structurellement, §7.2).
2. L'action réelle (le cas échéant) applicable à la catégorie C une fois
   son échéance atteinte (§7.3) — aucune n'est implémentée par ce lot.
3. La propagation effective d'une suppression aux sauvegardes déjà
   produites (§9).
