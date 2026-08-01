# Architecture — Legrand Diagnostic 360

> Proposition de conception (LOT 1). Aucun code n'est modifié par ce
> document. Les chemins de fichiers ci-dessous sont des **propositions** pour
> le LOT 2 et suivants, pas des fichiers existants.

## 1. Intégration dans le CRM existant

Le module s'intègre comme un **cinquième domaine métier** aux côtés de
`clients`, `contracts`, `commissions`, `compliance` — pas comme une
application séparée. Il partage :

- le même serveur Express (`server/app.js`), sous un espace de routes dédié
  `/api/advisory/*`, monté avec le même middleware `requireAuth` que les
  routes existantes ;
- la même base SQLite (`server/db.js`), dans des tables préfixées
  `advisory_` (plus `households`/`household_members`) ;
- le même mécanisme de session, d'authentification, d'anti-CSRF, de
  rate-limiting, d'audit (`server/audit.js`) — aucune duplication de ces
  briques ;
- la même interface React (`client/src/`), sous de nouvelles pages montées
  dans le routeur existant (`client/src/App.jsx`), avec de nouveaux
  composants dans `client/src/components/advisory/` suivant la convention
  déjà utilisée pour `client/src/components/contracts/`.

Le module ne crée **pas** de second serveur, de second processus, de second
schéma de base de données, ni de second système d'authentification.

## 2. Frontières du module

**Ce que le module possède et peut modifier** (une fois implémenté) :
- Toutes les tables `advisory_*`, `households`, `household_members`.
- Ses propres routes `/api/advisory/*`.
- Ses propres composants et pages React dédiés au diagnostic.

**Ce que le module lit mais ne modifie jamais** :
- `clients` (lecture, et création de nouvelles lignes `clients` via l'API
  `clients` existante — jamais d'écriture directe en base parallèle).
- `contracts` et les tables spécialisées de contrat (migration v8) — lecture
  seule, pour établir les protections existantes.
- `companies` — lecture seule, si une future mise en relation « catégorie de
  solution → compagnies partenaires potentielles » est envisagée (hors
  périmètre de cette version, voir Lot 11).
- `audit_log` — écriture **additive uniquement**, via la fonction `audit()`
  existante, jamais de nouveau mécanisme de journalisation parallèle.

**Ce que le module ne touche jamais** :
- `consents` (formulaires publics — décision LOT 0).
- `commissions`, `channels`, `campaigns`, `scoring_rules`, `action_log`
  (module Développement du portefeuille) — aucune dépendance dans un sens ou
  dans l'autre.
- Le schéma, les routes ou l'interface existants ne sont modifiés par aucun
  lot de ce module, sauf ajout strictement additif validé explicitement
  (ex. un nouveau lien de navigation dans `App.jsx`).

## 3. Dépendances autorisées

- Les dépendances déjà présentes dans `package.json`
  (`express`, `better-sqlite3`, `express-session`, `bcryptjs`,
  `express-rate-limit`, `react`, `react-router-dom`, `vite`) — **aucune
  nouvelle dépendance npm n'est ajoutée par ce module** sauf besoin explicite
  justifié et validé (ex. une librairie de génération PDF, au Lot 9, à
  proposer et faire valider avant ajout).
- Les conventions de test existantes (`node:test`, `supertest`), sans
  nouvelle librairie de test.

## 4. Dépendances interdites

- Aucun appel réseau sortant vers un service tiers (IA, MCP, API externe)
  sans mécanisme d'autorisation explicite, journalisé, et désactivé par
  défaut (voir `SECURITY_PRIVACY.md`, `MCP_STRATEGY.md`).
- Aucune dépendance à un état stocké côté client uniquement pour des données
  qui doivent être auditables (pas de « source de vérité » dans le
  `localStorage` du navigateur, sauf brouillon local temporaire avant envoi
  au serveur — à encadrer en Lot 3).
- Aucun couplage direct entre les tables `advisory_*` et les tables du
  module Développement du portefeuille (`lead_details`, `scoring_rules`,
  etc.) : un prospect qui devient client puis fait l'objet d'un diagnostic
  reste relié uniquement via `clients.id`, jamais par un lien direct
  supplémentaire entre les deux modules.

## 5. Flux frontend / backend (vue générale)

```mermaid
flowchart TB
    subgraph Client["Navigateur du conseiller"]
        UIConseiller["Mode conseiller<br/>(React)"]
        UIPresentation["Mode présentation client<br/>(React, même poste)"]
    end

    subgraph API["server/app.js — /api/advisory/*"]
        RouteHouseholds["/households, /members"]
        RouteSessions["/sessions"]
        RouteQuestionnaire["/questionnaires, /answers"]
        RouteEngine["/sessions/:id/run-diagnostic"]
        RouteFindings["/findings, /recommendations"]
        RouteConsents["/consents"]
        RouteReports["/reports"]
    end

    subgraph Engines["Moteurs déterministes (code serveur, pas d'IA)"]
        QEngine["Moteur de questionnaire<br/>(interprète les versions figées)"]
        REngine["Moteur de règles<br/>(déterministe, versionné, explicable)"]
    end

    subgraph DB["SQLite (better-sqlite3)"]
        THouseholds[("households / household_members")]
        TSessions[("advisory_sessions / advisory_answers")]
        TQuestionnaire[("advisory_questionnaire_versions / sections / questions")]
        TRules[("advisory_rule_sets / advisory_rules / advisory_rule_executions")]
        TFindings[("advisory_findings / advisory_recommendations")]
        TConsents[("advisory_consents")]
        TReports[("advisory_reports / advisory_report_versions")]
        TExisting[("clients / contracts / contract_* (existants, lecture seule)")]
        TAudit[("audit_log (existant, écriture additive)")]
    end

    subgraph FutureAI["Couche IA (future, désactivée par défaut)"]
        AIAssist["Assistance IA<br/>(résumé, reformulation, brouillon)"]
    end

    subgraph FutureMCP["MCP (futur, non configuré)"]
        MCPDoc["MCP documentaire<br/>(catalogue interne, lecture seule)"]
    end

    UIConseiller --> RouteHouseholds & RouteSessions & RouteQuestionnaire & RouteEngine & RouteFindings & RouteConsents & RouteReports
    UIPresentation -->|lecture filtrée uniquement| RouteReports

    RouteQuestionnaire --> QEngine --> TQuestionnaire
    RouteEngine --> REngine
    REngine --> TRules
    REngine -->|lecture seule| TExisting
    REngine --> TFindings

    RouteHouseholds --> THouseholds
    RouteSessions --> TSessions
    RouteFindings --> TFindings
    RouteConsents --> TConsents
    RouteReports --> TReports

    RouteHouseholds & RouteSessions & RouteFindings & RouteConsents & RouteReports -.->|audit()| TAudit

    RouteFindings -.->|"si consentement + activation explicites"| AIAssist
    AIAssist -.->|"jamais d'écriture directe en base"| RouteFindings

    RouteReports -.->|"futur, lecture seule, jamais action métier"| MCPDoc
```

## 6. Moteur de questionnaire (résumé — détail dans `QUESTIONNAIRE_ENGINE.md`)

Un service serveur qui interprète une `advisory_questionnaire_version`
(sections, questions, conditions d'affichage) pour produire, à chaque étape,
la liste des questions pertinentes pour le foyer et ses membres. Le frontend
ne fait que **rendre** ce que le moteur renvoie — aucune logique de
questionnaire codée en dur dans les composants React.

## 7. Moteur de règles (résumé — détail dans `RULES_ENGINE.md`)

Un service serveur, purement déterministe, qui évalue les `advisory_rules`
d'un `rule_set` figé contre les réponses de la session et les données
existantes (contrats). Il produit des `advisory_rule_executions` (traces) et
des `advisory_findings` (constats). Il ne produit **jamais** directement une
`advisory_recommendation` à l'état `validee_conseiller`.

> **Point confirmé (Lot 4A, implémenté)** : le moteur vit dans deux modules
> serveur distincts — `server/advisoryRules.js` (cycle de vie des règles :
> création, brouillon, validation de publication, publication, clonage,
> archivage) et `server/advisoryRuleExecutions.js` (exécution sur une
> session et lecture des findings) — même séparation de responsabilité que
> `advisoryQuestionnaires.js`/`advisorySessions.js` au Lot 3A. Le module de
> conditions du DSL (`server/advisoryRuleConditions.js`) est volontairement
> **séparé** du moteur de conditions d'affichage de questionnaire
> (`server/advisoryConditions.js`, Lot 3A) : l'univers référençable diffère
> réellement (contrats, résultat d'une autre règle), une réutilisation
> directe aurait été incorrecte. Les routes vivent sous
> `/api/advisory/rule-sets` (règles) et sous `/api/advisory/sessions/:id/
> rule-executions`+`.../findings` (exécutions/findings, rattachées à la
> session comme n'importe quel autre sous-ensemble de ses données, même
> convention que `.../answers`) — pas de route `/sessions/:id/run-
> diagnostic` distincte comme envisagé au schéma du §5 ci-dessous.
>
> **GATE LOT 4A — corrections d'architecture confirmées** :
> - **Domaine `common`, troisième domaine de `rule_set` à part entière**
>   (décision humaine confirmée) : facultatif, pour les constats transverses
>   au foyer. Une session `mixed` reste toujours exécutée séparément par
>   domaine réel (jusqu'à trois `advisory_rule_executions` distinctes,
>   `common`/`health`/`life_pension`) — jamais fusionnée dans une exécution
>   opaque, propriété d'architecture déjà énoncée ci-dessus et désormais
>   vérifiée pour les trois domaines.
> - **Attribution membre déplacée dans le moteur, pas repoussée à
>   l'interface** : `finding_scope` (`session`/`household`/`member`) est une
>   propriété de la RÈGLE, évaluée par le moteur d'exécution
>   (`resolveQuantifierMembers`), jamais déduite après coup par le futur
>   Lot 4B — cohérent avec le principe déjà énoncé que le moteur ne délègue
>   aucun raisonnement à l'interface.
> - **Reproductibilité vérifiée empiriquement** (archivage du rule_set,
>   publication d'une nouvelle version, amendement de session, départ d'un
>   membre, contrat vivant modifié, sensibilité consultée plus tard) : une
>   exécution historique reste identique dans tous ces cas, seule une
>   NOUVELLE exécution capture le changement (`RULES_ENGINE.md` §10,
>   `API_CONTRACT.md` §6).
> - **Exécution finale réservée à une session `completed`** (et non plus
>   `in_progress` ou `completed`) : décision humaine confirmée pendant ce
>   GATE, reconnue en contradiction avec l'implémentation initiale du Lot
>   4A et corrigée.
> - **Concurrence — garantie SQLite, pas seulement applicative (correctif
>   ciblé, second GATE avant commit, décision humaine confirmée)** : la
>   politique « un seul rule_set publié par domaine » reposait initialement
>   sur la seule vérification applicative
>   (`assertNoOtherPublishedFamilyForDomain`), suffisante tant qu'un seul
>   processus écrit dans le fichier SQLite mais pas au-delà. Un index UNIQUE
>   PARTIEL (`idx_advisory_rule_sets_one_published_per_domain`, migration
>   11) rend désormais cette garantie vraie au niveau du fichier lui-même,
>   quel que soit le nombre de processus applicatifs — architecture décidée
>   pour ne jamais dépendre d'une hypothèse de déploiement non vérifiable
>   par le schéma. Vérifié avec deux vraies connexions `better-sqlite3`
>   concurrentes sur le même fichier (verrouillage WAL observé, puis
>   violation d'unicité) et un rollback forcé (échec après l'archivage,
>   avant la fin de la transaction — aucun état intermédiaire persistant).

## 8. Mode conseiller

Vue complète (réponses, notes internes, règles déclenchées, raisonnement,
informations manquantes, alertes, contrôles de conformité). Toujours rendu
côté serveur à partir des mêmes données que le mode présentation — jamais une
seconde source de vérité.

## 9. Mode présentation client

Rendu à partir d'une **projection filtrée** des mêmes données (pas une copie
distincte maintenue en parallèle). Le filtrage (retrait des notes internes,
des règles techniques, des scores) est une fonction pure côté serveur,
testable indépendamment — voir `UX_AND_CLIENT_MODE.md`. Affiché sur
l'appareil du conseiller pendant le rendez-vous (pas d'authentification
client distincte dans cette version).

## 10. Génération future de rapport

Le rapport (`advisory_reports`/`advisory_report_versions`) est d'abord un
objet de données structuré et versionné. La mise en forme imprimable (PDF)
est un lot distinct (Lot 9) : aucune dépendance de génération PDF n'existe
aujourd'hui dans le CRM (vérifié en LOT 0), son introduction sera proposée et
validée séparément le moment venu.

## 11. Extension future MCP

Prévue architecturalement, non implémentée : un point d'extension unique
(voir `MCP_STRATEGY.md`) permettrait, plus tard, à un connecteur en liste
blanche de consulter un catalogue interne validé (Lot 11/12) en lecture
seule, jamais de modifier un dossier client, jamais activé par défaut.

## 12. Possibilité future d'un portail client

Le modèle de données anticipe cette possibilité sans l'implémenter :
- **Point corrigé (Lot 3A, GATE)** : `advisory_answers` ne porte
  aujourd'hui qu'un `answered_by_user_id` référençant le conseiller
  authentifié — la distinction `conseiller`/`client_direct` initialement
  envisagée ici n'a pas été implémentée et n'a donc **pas** de point
  d'ancrage réel dans le schéma actuel. Elle reste à concevoir
  explicitement (nouvelle colonne ou nouvelle valeur) au moment du Lot 13,
  pas supposée acquise par ce document. Voir `DATA_MODEL.md` §4.6.
- Le mode présentation client est déjà une projection filtrée servie
  indépendamment du mode conseiller — un futur portail réutiliserait la même
  fonction de filtrage plutôt que d'en inventer une seconde.
- Aucune authentification client n'existe : l'introduire (Lot 13, si décidé)
  demanderait un nouveau système d'identité et de contrôle d'accès, distinct
  du compte courtier actuel — à concevoir en temps voulu, pas anticipé
  prématurément dans le schéma.

## 13. Ce que ce document ne décide pas

- Le nom définitif du module (« Legrand Diagnostic 360 » reste provisoire).
- Le numéro de migration exact (déterminé au moment de l'implémentation).
- Le choix technique exact de génération PDF (Lot 9).
- L'activation de tout MCP réel (Lot 12, sous condition).
