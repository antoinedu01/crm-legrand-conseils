# Legrand Diagnostic 360

> Nom provisoire. Module d'aide au diagnostic et au conseil, intégré au CRM
> `crm-legrand-conseils`, destiné à un conseiller en assurance indépendant en
> Suisse romande.

## 1. Vision

Legrand Diagnostic 360 est un outil d'**aide à la décision pour le
conseiller**, pas un moteur de vente automatisé. Il structure un rendez-vous
client, guide le conseiller à travers un questionnaire adapté à la situation
du foyer, applique des règles métier explicables pour faire émerger des
besoins et des lacunes, et laisse le conseiller seul juge de toute
recommandation finale.

Le principe fondamental (rappelé du LOT 0, non renégociable dans ce module) :

> Le logiciel ne recommande jamais automatiquement un contrat définitif, ne
> invente aucune caractéristique de produit, n'utilise aucune règle sans
> source ni version, ne masque aucune information manquante, ne transforme
> jamais une hypothèse en fait, ne fait jamais passer un score statistique
> pour une décision certaine, et n'envoie jamais de données personnelles à un
> service externe sans mécanisme explicitement autorisé.

## 2. Périmètre de cette première version

**Dans le périmètre** :
- Un socle commun « foyer » (`households` / `household_members`), réutilisant
  la table `clients` existante comme représentation de chaque personne.
- Deux parcours de diagnostic : Assurance Maladie (LAMal/LCA) et Vie &
  Prévoyance (3a/3b, LPP, risque décès/invalidité).
- Un moteur de questionnaire générique et versionné (pas de questions codées
  en dur dans l'interface).
- Un moteur de règles déterministe, versionné, explicable, séparé de toute
  intelligence artificielle.
- Un mode conseiller (tout est visible) et un mode présentation client (sobre,
  filtré, montrable pendant le rendez-vous sur l'appareil du conseiller).
- Un système de consentements dédié (`advisory_consents`), distinct du
  consentement des leads publics du site.
- Une préparation architecturale (pas une implémentation) pour de futures
  connexions MCP contrôlées, et pour un futur portail client autonome.

**Hors périmètre de cette première version** (voir `IMPLEMENTATION_ROADMAP.md`
pour le séquencement) :
- Génération effective de PDF (le rapport est d'abord un objet de données
  structuré et versionné, avant d'être mis en forme imprimable).
- Toute connexion MCP réelle (Lot 12).
- Un portail où le client se connecterait lui-même (Lot 13, conditionnel).
- Un catalogue de produits réels d'assureurs (Lot 11) — tant qu'il n'existe
  pas, le moteur de règles s'arrête à la « catégorie de solution », jamais au
  produit nommé.
- Toute automatisation de la validation d'une recommandation.

## 3. Les deux parcours principaux

### Assurance Maladie
Diagnostic de la couverture LAMal/LCA du foyer : affiliation, franchise,
modèle d'assurance, hospitalisation, complémentaires, besoins spécifiques aux
enfants, budget, échéances. Détail complet dans `HEALTH_DIAGNOSTIC.md`.

### Vie et Prévoyance
Diagnostic de la prévoyance du foyer : 3a/3b, LPP, risque décès/invalidité,
capacité d'épargne, projets (immobilier, retraite), protection du conjoint et
des enfants. Détail complet dans `LIFE_PENSION_DIAGNOSTIC.md`.

Un même rendez-vous peut couvrir un seul parcours ou les deux
(`advisory_sessions.domain = 'mixed'`, décision validée — voir
`DATA_MODEL.md` §3.1) ; chaque réponse, règle, constat et recommandation
reste néanmoins toujours rattaché à son propre domaine (`health` ou
`life_pension`).

## 4. Principes de sécurité (résumé — détail dans `SECURITY_PRIVACY.md`)

- Minimisation des données : on ne demande que ce qui sert le diagnostic.
- Consentement explicite, granulaire, versionné, révocable, tracé par
  finalité (`advisory_consents`).
- Séparation stricte entre ce que voit le conseiller et ce que voit le
  client — jamais de notes internes, de règles techniques ou de scores bruts
  côté présentation client.
- Journal d'audit sur toute action significative, réutilisant `audit_log`.
- Assistance IA désactivée par défaut, activable uniquement via un double
  verrou (consentement + configuration explicite), jamais par défaut.
- Aucune donnée personnelle réelle dans les fixtures, aucun secret dans le
  dépôt — conventions déjà en vigueur dans le reste du CRM, reconduites à
  l'identique.

## 5. Limites explicites de la première version

- Le module ne fournit pas de conseil fiscal, actuariel ou juridique définitif
  — toute formule de calcul (ex. déficit en cas d'incapacité) est un modèle
  configurable affiché comme tel, jamais une vérité contractuelle (voir
  `LIFE_PENSION_DIAGNOSTIC.md`).
- Aucun rôle « client » authentifié n'existe dans le CRM aujourd'hui (mono-
  utilisateur courtier). Le mode « présentation client » est un affichage
  contrôlé par le conseiller sur son propre appareil, pas un accès client
  distinct.
- Le moteur de règles ne connaît, dans cette version, aucun produit
  d'assureur réel — uniquement des catégories de besoins et de solutions.

## 6. Lots de développement (résumé — détail dans `IMPLEMENTATION_ROADMAP.md`)

| Lot | Contenu |
|---|---|
| 0 | Audit (terminé, validé) |
| 1 | Conception détaillée, sous-agents (ce lot) |
| 2 | Socle foyer (`households`, `household_members`) |
| 3 | Sessions et questionnaire générique |
| 4 | Moteur de règles |
| 5 | Parcours Assurance Maladie |
| 6 | Parcours Vie et Prévoyance |
| 7 | Recommandations et validation humaine |
| 8 | Mode présentation client |
| 9 | Rapports |
| 10 | Sécurité renforcée et rétention |
| 11 | Catalogue produits |
| 12 | MCP contrôlé |
| 13 | Portail client éventuel (conditionnel) |

## 7. Vocabulaire métier

| Terme | Définition |
|---|---|
| **Foyer** | Regroupement de personnes (`households`) formant l'unité d'analyse d'un diagnostic — ne remplace pas la fiche `clients` individuelle. |
| **Membre du foyer** | Une personne (`clients`) rattachée à un foyer avec un `member_role` : principal, conjoint, enfant, autre personne à charge. Le « client principal » (`member_role = 'principal'`) est distingué explicitement des autres membres du foyer dans l'interface. |
| **Session de conseil** | Un rendez-vous structuré (`advisory_sessions`), avec un statut, une version de questionnaire et de règles figée. |
| **Réponse inconnue** | Une réponse explicitement marquée « je ne sais pas », distincte d'une absence de réponse — jamais traitée comme une valeur par défaut. |
| **Constat (finding)** | Résultat produit par une règle : besoin détecté, lacune, avertissement ou contre-indication. Jamais une recommandation. |
| **Catégorie de solution** | Regroupement de besoins en une famille de réponse possible (ex. « renforcement couverture accident »), jamais un produit ou un assureur nommé. |
| **Recommandation validée** | Un choix explicitement validé par le conseiller (horodaté, avec identité), la seule étape pouvant mener à une proposition concrète. |
| **Mode conseiller** | Vue complète : réponses, notes, règles déclenchées, informations manquantes. |
| **Mode présentation client** | Vue filtrée, sobre, sans notes internes ni détails techniques, montrée par le conseiller pendant le rendez-vous. |
| **Rapport** | Document structuré et versionné (brouillon interne, présentation client, rapport final, rapport corrigé) — jamais réécrit rétroactivement. |

## 8. Documents du dossier `docs/advisory/`

- `README.md` — ce document
- `ARCHITECTURE.md` — intégration au CRM, frontières, diagramme
- `DATA_MODEL.md` — entités et tables (proposition, aucun SQL définitif)
- `API_CONTRACT.md` — routes futures `/api/advisory/*`
- `QUESTIONNAIRE_ENGINE.md` — moteur de questionnaire générique
- `RULES_ENGINE.md` — moteur de règles déterministe et explicable
- `HEALTH_DIAGNOSTIC.md` — parcours Assurance Maladie
- `LIFE_PENSION_DIAGNOSTIC.md` — parcours Vie et Prévoyance
- `UX_AND_CLIENT_MODE.md` — écrans, mode conseiller, mode présentation client
- `SECURITY_PRIVACY.md` — sécurité et protection des données
- `REPORT_SPECIFICATION.md` — spécification du rapport
- `MCP_STRATEGY.md` — stratégie MCP future (aucune connexion configurée)
- `IMPLEMENTATION_ROADMAP.md` — découpage des lots 2 à 13
