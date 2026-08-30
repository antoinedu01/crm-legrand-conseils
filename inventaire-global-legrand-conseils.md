# Inventaire global — Legrand Conseils

*Compilé le 30 août 2026. Explore récursivement les dépôts accessibles à ce compte GitHub, sur toutes les branches contenant du travail non fusionné pertinent — pas seulement les branches par défaut.*

---

## Synthèse

Le travail de Legrand Conseils Sàrl (Antoine Legrand, courtier en assurance indépendant, Vaud/Genève) est réparti sur **quatre dépôts GitHub**, pas des dossiers locaux : un CRM métier complet, un site vitrine, un dépôt de planification resté vide, et un dépôt sans rapport. Mais la partie la plus importante de la découverte n'est pas dans les branches par défaut : **une quantité considérable de travail — un système marketing entier, des pages d'atterrissage, le tracking Meta/Google Ads, un comparateur LAMal avec données OFSP officielles — existe déjà, prêt ou presque, sur des branches non fusionnées que l'on ne voit pas si l'on ne regarde que la branche principale.**

| Dépôt | Branche(s) pertinente(s) | CLAUDE.md / `.claude/` | Essentiel |
|---|---|---|---|
| `antoinedu01/crm-legrand-conseils` | `claude/insurance-broker-crm-exx09v` (production) | `.claude/agents/` (6 agents Diagnostic 360), pas de `CLAUDE.md` racine | Le CRM lui-même : clients, contrats, commissions, conformité nLPD/LSA, et le module « Legrand Diagnostic 360 » (questionnaires + moteur de règles santé/prévoyance). En production sur VPS suisse. |
| `antoinedu01/crm-legrand-conseils` | `feature/marketing-ai-90-days` → `feature/seo-content-factory-v1` → `feature/marketing-acquisition-consolidation-v1` (non fusionnées) | `CLAUDE.md` racine + `.claude/agents/` (**14 agents marketing**, différents des 6 ci-dessus) | Système marketing complet : positionnement, personas, plan 90 jours (1er août → 29 octobre 2026 — **on est dedans, à la charnière Phase 2/3**), calendrier éditorial, 1 article SEO validé humainement, brouillons réseaux sociaux, guide 3e pilier, conformité, KPI, conventions UTM. Rien n'est encore publié. |
| `antoinedu01/site-legrandconseils` | `main` | aucun | Le site public legrandconseils.ch : 16 pages (accueil, services, LAMal, LCA, prévoyance 3a/3b, comparateur, générateur de résiliation, espace démarches en ligne, pages légales). |
| `antoinedu01/site-legrandconseils` | `feature/acquisition-tracking-v1`, `feat/demarches-acquisition-tracking-v1`, `chore/comparateur-lamal-prod-2026.1.2` (non fusionnées) | aucun | 3 pages d'atterrissage pour campagnes payantes, tracking UTM/Google Ads/**Meta Ads** (`fbclid`) branché sur le CRM, et un comparateur LAMal reconstruit avec les **vraies données de primes OFSP 2026** (corrige un défaut connu documenté dans `PROJECT_HANDOFF.md`). |
| `antoinedu01/plan-evolution-exploitation-legrand-conseils-` | — | — | **Dépôt vide** (aucun commit, sur aucune branche). |
| `antoinedu01/desktop-tutorial` | — | — | Dépôt tutoriel par défaut de GitHub Desktop. **Sans rapport avec Legrand Conseils.** |

### Points clés à retenir

- **Aucune donnée client ou prospect réelle n'a été trouvée dans le code.** Toutes les données personnelles rencontrées sont des fixtures de test ou de démonstration explicitement fictives (voir Étape 3). La base réelle (`data/crm.sqlite`) n'est jamais versionnée.
- **Le calendrier éditorial que vous pensez peut-être ne pas avoir existe déjà**, en détail (90 jours, personas, piliers, cadence), mais dort sur une branche jamais fusionnée du dépôt CRM — pas dans le dépôt du site, pas ailleurs.
- **L'infrastructure de tracking Meta Ads/Google Ads existe déjà** (paramètres `fbclid`/`gclid`, first-touch attribution, envoi vers le CRM), également sur une branche non fusionnée du dépôt du site. Le garde-fou du dépôt CRM (`ACQUISITION_OS_GUARDRAILS.md`) interdit explicitly toute campagne payante **avant le 1er septembre 2026 — soit demain**.
- **Deux systèmes d'agents Claude Code distincts et non réconciliés cohabitent** dans l'historique du même dépôt CRM : 6 agents « Diagnostic 360 » (branche de production) et 14 agents « marketing » (branche marketing, jamais fusionnée). Ils ont des règles, des tons et des périmètres différents — voir Étape 4.
- **L'inscription FINMA couvre précisément les branches « assurance-maladie complémentaire » et « assurance-vie »** — pas une branche LAMal distincte. C'est documenté noir sur blanc dans la branche marketing, mais cette nuance n'apparaît nulle part dans les pages LAMal du site public actuellement en ligne. Point à vérifier en priorité.
- **Rien de ce qui a été préparé côté marketing n'est publié.** Le registre éditorial de la branche marketing le confirme explicitement : zéro contenu au statut `Publié` à ce jour.
- Aucun CV n'a été trouvé dans les dépôts accessibles.

### Anonymisation

Aucune donnée client/prospect réelle identifiée. Les seules données personnelles trouvées (noms, e-mails, un numéro AVS type) sont des fixtures de test ou de démonstration, manifestement fictives par construction (voir détail Étape 3). Elles sont recensées ci-dessous sous forme `Fixture-X`, avec la mention **à vérifier avec l'utilisateur** par précaution, conformément à la consigne.

### Contradictions à trancher en premier

Voir Étape 4 pour le détail. En résumé, dans l'ordre de priorité proposé :
1. Portée exacte de l'inscription FINMA (LAMal exclue) à réconcilier avec le contenu LAMal du site public.
2. Deux systèmes de sous-agents Claude Code non réconciliés dans le même dépôt (Diagnostic 360 vs marketing).
3. Orthographe de la raison sociale (« Legrand conseils » vs « Legrand Conseils »).
4. URL de la page LinkedIn entreprise (deux variantes constatées).
5. Le nom d'événement analytics `generer_lead` (documenté dans deux dépôts) ne correspond à aucun nom d'événement trouvé dans le code de tracking réel (`lead_form_open`/`lead_submit`).
6. Une page du site actuellement en ligne (`changer-caisse-maladie-delais-etapes.html`) est supprimée par les branches de tracking les plus récentes du même dépôt.

### Ce qui manque

Voir Étape 6 en fin de document pour le détail complet, organisé par domaine.

---

## Étape 1 — Cartographie des dossiers explorés

| Chemin exploré | CLAUDE.md ? | `.claude/` ? | Pertinence |
|---|---|---|---|
| `/home/user/crm-legrand-conseils` (branche `claude/legrand-conseils-mapping-kshsio`, basée sur `claude/insurance-broker-crm-exx09v`) | Non | Oui — `.claude/agents/` (6 fichiers) | **Très pertinent.** Le CRM métier complet et le module Diagnostic 360 ; c'est le dépôt de départ de cette mission. |
| ↳ branche `feature/marketing-ai-90-days` (et ses descendantes `feature/seo-content-factory-v1`, `feature/marketing-acquisition-consolidation-v1`) | Oui (racine) | Oui — `.claude/agents/` (14 fichiers, différents des 6 ci-dessus) et `.claude/settings.json` | **Très pertinent, non fusionné.** Tout le système marketing/acquisition IA. |
| ↳ autres branches du même dépôt (`feature/lead-generation-engine`, `feature/acquisition-os`, `integration/acquisition-advisory-v1`, `integration/swiss-insurance-crm-v1`, `feature/swiss-insurance-crm`, une quinzaine de branches `feature/advisory-*`/`fix/*`) | — | — | Pertinent par le nom mais non exploré en détail (voir note en fin d'Étape 2.2) : essentiellement des étapes intermédiaires déjà absorbées dans la branche de production, ou hors du périmètre direct de cette mission (Bloc 4 partenaires, portage Acquisition OS déjà documenté dans `PROJECT_HANDOFF.md`/`ACQUISITION_OS_GUARDRAILS.md`). |
| `/home/user/site-legrandconseils` (branche `main`) | Non | Non | **Très pertinent.** Le site public legrandconseils.ch, 16 pages HTML + 1 feuille de style. |
| ↳ branches `feature/acquisition`, `feature/acquisition-tracking-v1`, `feat/demarches-acquisition-tracking-v1` | Non | Non | **Très pertinent, non fusionné.** 3 pages d'atterrissage + tracking Meta/Google Ads relié au CRM. |
| ↳ branche `chore/comparateur-lamal-prod-2026.1.2` | Non | Non | **Très pertinent, non fusionné.** Plugin WordPress du comparateur LAMal avec données OFSP officielles 2026. |
| ↳ branches `feature/seo-001-cta-contrast`, `feature/seo-001-cta-hover-contrast`, `claude/legrandconseils-repo-analysis-o2uvrq` | — | — | Non explorées en détail : corrections visuelles mineures (contraste d'un bouton) et une branche d'analyse antérieure du dépôt lui-même. |
| `/home/user/plan-evolution-exploitation-legrand-conseils-` | — | — | **Non pertinent en l'état : dépôt totalement vide** (`git ls-remote` ne retourne aucune référence). À vérifier si ce n'est pas une erreur — le nom suggère un contenu attendu (plan d'évolution de l'exploitation) qui n'a jamais été poussé. |
| `/home/user/desktop-tutorial` | — | — | **Non pertinent.** Dépôt tutoriel par défaut créé automatiquement par GitHub Desktop (« Welcome to GitHub Desktop! »), sans aucun lien avec Legrand Conseils. |

---

## Étape 2 — Inventaire détaillé par dossier

### 2.1 `crm-legrand-conseils` — branche de production (`claude/insurance-broker-crm-exx09v`)

CRM Node.js/Express + React (SQLite locale), décrit par son propre README comme : *« CRM complet pour courtier en assurance indépendant en Suisse : prévoyance (3a/3b, LPP), assurance maladie (LAMal), complémentaires (LCA), assurance hypothèque, avec suivi des commissions multi-compagnies et conformité nLPD/LSA (FINMA) intégrée. »* Selon `PROJECT_HANDOFF.md`, il tourne **en production** sur un VPS Infomaniak (`https://crm.legrandconseils.ch`), HTTPS via Caddy, sauvegardes nocturnes + Swiss Backup.

#### Racine

- **`README.md`** — présentation, démarrage, tableau de conformité nLPD/LSA (audit, consentement, registre des traitements, export, anonymisation, formation continue Cicero), recommandations d'hébergement en Suisse.
- **`PROJECT_HANDOFF.md`** — document de passation très complet : architecture, fonctionnalités livrées vs incomplètes (Bloc 4 partenaires non fusionné), règles de sécurité, commandes, fichiers sensibles, problèmes connus (dont le comparateur LAMal du site aux primes indicatives — résolu depuis, voir 2.4), état des branches.
- **`DEPLOIEMENT.md`** — guide pas-à-pas non technique pour héberger le CRM soi-même (VPS suisse Infomaniak/Hostpoint/Exoscale ou Tailscale gratuit), installation en une commande, sauvegardes, installation « comme une app » sur iPhone/iPad/PC.
- **`Demarrer-Mac.command`** / **`Demarrer-Windows.bat`** — scripts de lancement en double-clic pour utilisateur non technique (installe si besoin, build si besoin, ouvre le navigateur sur `localhost:3000`).
- **`package.json`** — dépendances : Express 4, better-sqlite3 v12, React 18 + Vite 8, tests via `node:test`. Aucune dépendance à un service externe.
- **`.env.example`** / **`.env.qa.example`** — configuration (port, `SESSION_SECRET`, `SITE_ORIGINS`, réservation `ANTHROPIC_API_KEY` pour une future phase IA). Aucun secret réel.
- **`.gitignore`** — exclut `node_modules/`, `data/` (base réelle), `client/dist/`, `.env`. Confirmé : aucune base ni secret n'est jamais committé.

#### `.claude/agents/` — 6 sous-agents « Legrand Diagnostic 360 »

Système cohérent de sous-agents Claude Code, tous au même format (Périmètre, Fichiers autorisés/interdits, Outils autorisés, Règles de sécurité, Format de restitution, Critères d'arrêt, Obligations) :

- **`advisory-architect.md`** — architecture générale du module, frontières avec le reste du CRM, revue des migrations. N'invente jamais de règle métier, ne modifie jamais `server/db.js` seul.
- **`client-meeting-ux.md`** — ergonomie du rendez-vous de conseil (mode conseiller vs mode présentation client), ne touche jamais au code React réel, propose des wireframes uniquement.
- **`compliance-privacy-reviewer.md`** — revue nLPD/LSA, distingue systématiquement fait confirmé / interprétation / hypothèse / décision humaine requise / expertise externe requise.
- **`health-insurance-domain.md`** — contenu métier du parcours Assurance Maladie (LAMal/LCA) ; interdiction absolue d'inventer une garantie ou de recommander un assureur nommé.
- **`life-pension-domain.md`** — contenu métier du parcours Vie et Prévoyance (3a/3b, LPP) ; interdiction de promettre un rendement ou une fiscalité non sourcée.
- **`rules-engine-auditor.md`** — audit strict du moteur de règles (déterminisme, versionnement, traçabilité) ; doit *rejeter* toute règle non conforme plutôt que la corriger silencieusement.

#### `docs/` (racine)

- **`ACQUISITION_OS_GUARDRAILS.md`** — garde-fous d'intégration pour le module « Acquisition OS » : interdiction de fusion en bloc de la branche historique, zones protégées, **interdiction de toute campagne publicitaire payante (Google Ads, Meta Ads ou équivalent) avant le 1er septembre 2026** (§14 — soit demain par rapport à la date du jour), procédure stricte de numérotation des migrations.
- **`CONTRATS_ASSURANCE_SUISSE.md`** — référence technique des 5 blocs de contrats spécialisés (LAMal, LCA, vie, incapacité de gain, LPP/IJM) : champs, validations strictes, règle de commission spécifique aux contrats vie à prime périodique, exemples d'API.
- **`MIGRATIONS.md`** — historique complet des migrations SQLite (versions 1 à 16), avec objectif, réversibilité et précautions de chacune ; contient l'évolution du modèle de commission (correction LAMal/LCA en montant fixe plutôt qu'en pourcentage, version 15) et l'ajout de la table `appointments` (version 16, Acquisition OS).

#### `docs/advisory/` — 22 documents du module « Legrand Diagnostic 360 »

Documentation dense (13 600 lignes au total) d'un module d'aide au diagnostic pour le conseiller — *« un outil d'aide à la décision, pas un moteur de vente automatisé »* — qui ne recommande jamais automatiquement un contrat, ne masque jamais une information manquante, n'envoie jamais de donnée personnelle à un service externe sans mécanisme explicite.

- **`README.md`** — vision, périmètre, vocabulaire métier (foyer, session, constat/finding, catégorie de solution), table des 13 lots de développement.
- **`ARCHITECTURE.md`** — intégration comme 5ᵉ domaine du CRM (aux côtés clients/contrats/commissions/compliance), mêmes middlewares, mêmes tables préfixées `advisory_`.
- **`DATA_MODEL.md`** (1275 lignes) — modèle de données complet ; constats précis sur les contraintes réelles de `clients` (rien n'est obligatoire en base sauf un nom).
- **`API_CONTRACT.md`** (1547 lignes) — contrat des routes `/api/advisory/*`, dont la règle « foyer archivé = figé » (409 sur toute écriture).
- **`QUESTIONNAIRE_ENGINE.md`** — moteur de questionnaire générique versionné, jamais de question codée en dur dans l'interface.
- **`RULES_ENGINE.md`** (751 lignes) — moteur de règles déterministe : DSL à 16 opérateurs, 7 natures de référence, double contrôle anti-contradiction.
- **`HEALTH_DIAGNOSTIC.md`** — proposition de conception du parcours Assurance Maladie (26 sections).
- **`HEALTH_LOT5_CONTENT.md`** — le premier contenu **réellement provisionné** (brouillon, non publié) : 9 questions, 5 règles, sourcées OFSP (art. 8 LAMal, art. 11 OAMal), aucune mention de grossesse/maternité (exclue explicitement).
- **`HEALTH_DIAGNOSTIC_V2_CONTENT.md`** (599 lignes) — version 2 du même contenu, 24 questions / 4 sections, coexistant avec v1 sans la modifier.
- **`LIFE_PENSION_DIAGNOSTIC.md`** — proposition de conception du parcours Vie et Prévoyance (déficit d'incapacité, besoin de capital décès, réserve de sécurité — tous des « modèles configurables », jamais des vérités).
- **`LIFE_PENSION_LOT6_CONTENT.md`** — contenu réel provisionné : 10 questions, 5 règles.
- **`HEALTH_SYNTHESIS.md`** — moteur de synthèse Santé pur, strictement en lecture seule, sans recommandation.
- **`REPORT_SPECIFICATION.md`** — spécification du futur rapport de conseil (brouillon interne / présentation client / rapport final / rapport corrigé — jamais modifié en place).
- **`UX_AND_CLIENT_MODE.md`** (997 lignes) — écrans proposés, réutilise le design existant (`ui.jsx`, `styles.css`) sans nouveau système.
- **`SECURITY_PRIVACY.md`** (922 lignes) — classification des données (dont « sensible — association indirecte à la santé »), minimisation, invariants de confidentialité testés.
- **`DATA_RETENTION.md`** — politique de conservation/anonymisation à 5 catégories, **entièrement implémentée mais désactivée par défaut**, en attente de validation juridique.
- **`IMPLEMENTATION_ROADMAP.md`** (1250 lignes) — découpage des lots 2 à 13, avec critères d'acceptation et actions interdites par lot.
- **`MCP_STRATEGY.md`** — stratégie future pour des connecteurs MCP en lecture seule uniquement, liste blanche, aucune activation actuelle.
- **`QA_DEPLOYMENT.md`** (488 lignes) — cadrage d'un environnement QA isolé, dix couches de protection contre tout impact sur la production.
- **`LOT2_MANUAL_UI_CHECKLIST.md`, `LOT3A_MANUAL_UI_CHECKLIST.md`, `LOT3B_MANUAL_UI_CHECKLIST.md`, `LOT4B_MANUAL_UI_CHECKLIST.md`, `LOT7B_MANUAL_UI_CHECKLIST.md`** — checklists de tests manuels réellement exécutés (navigateur Chromium piloté par Playwright) faute de framework de test frontend dans le dépôt.

#### `server/` — 30 fichiers, groupés par thème

| Groupe | Fichiers | Rôle |
|---|---|---|
| Noyau applicatif | `app.js`, `index.js`, `db.js` (1717 lignes, schéma + migrations), `session-store.js`, `auth.js`, `audit.js`, `validate.js`, `totp.js`, `canonicalJson.js` | Assemblage Express, authentification (bcrypt + 2FA TOTP), journal d'audit, validation serveur systématique. |
| Métier CRM historique | `scoring.js`, `commissionCalc.js`, `seed-demo.js`, `seed-commission-demo.js` | Score des prospects (raisons toujours affichées), calcul de commission (corrigé pour LAMal/LCA en montant fixe), données de démo. |
| Routes CRM historique | `routes/clients.js`, `companies.js`, `contracts.js`, `commissions.js`, `tasks.js`, `dashboard.js`, `compliance.js` | API REST des entités de base ; ex. `clients.js` porte l'export nLPD (`/:id/export`) et l'anonymisation (`/:id/anonymize`). |
| Acquisition (déjà en prod) | `routes/prospects.js`, `channels.js`, `campaigns.js`, `public.js` (`POST /api/public/lead`, point d'entrée des leads du site), `today.js`, `acquisition-attribution.js` | Canaux d'acquisition (14 pré-seedés), scoring, plan d'action quotidien, résolveur d'attribution (lecture seule). |
| Acquisition OS (partiel) | `appointments-pipeline.js`, `routes/appointments.js`, `routes/acquisition-analytics.js` | Rendez-vous datés (table créée migration 16) ; `acquisition-analytics.js` référence un schéma de commissions antérieur à la migration 15, **à adapter avant activation**. |
| Diagnostic 360 — services | `advisoryHouseholds.js`, `advisoryQuestionnaires.js`, `advisoryConditions.js`, `advisoryRules.js`, `advisoryRuleConditions.js`, `advisoryRuleExecutions.js` (1647 lignes), `advisoryFindingsProjection.js`, `advisorySessions.js`, `advisorySimilarity.js`, `advisoryRecommendations.js` (866 lignes), `advisoryRetention.js`, `advisoryHealthSynthesis.js` | Logique métier isolée des routes (transactions, invariants), testable indépendamment. |
| Diagnostic 360 — routes + seeds | `routes/advisoryHouseholds.js`, `advisoryQuestionnaires.js`, `advisoryRules.js`, `advisorySessions.js`, `advisoryRecommendations.js`, `advisoryRetention.js`, `seed-advisory-health-content.js` (1045 lignes), `seed-advisory-life-pension-content.js` | Adaptateurs HTTP fins + injection du contenu brouillon santé/prévoyance décrit ci-dessus. |

#### `client/src/` — interface React, groupée par thème

- **Cœur** : `main.jsx`, `App.jsx` (navigation), `api.js` (wrapper fetch), `labels.js` (formatage FR/CHF), `navigationGuard.jsx`, `components/ui.jsx` (Modal/Field/Badge/Empty), `styles.css` (jetons de thème clair/sombre).
- **Pages CRM historique** : `Dashboard.jsx`, `Clients.jsx`, `ClientDetail.jsx`, `Companies.jsx`, `Contracts.jsx` (+ `components/contracts/` : champs et calculs spécialisés LAMal/LCA/Vie), `Commissions.jsx`, `Tasks.jsx`, `Compliance.jsx`, `DataRetention.jsx`, `Settings.jsx`, `Login.jsx`.
- **Pages Acquisition** : `Acquisition.jsx` (971 lignes), `Development.jsx`.
- **Pages Diagnostic 360** : `Households.jsx`, `HouseholdDetail.jsx`, `Sessions.jsx`, `SessionDetail.jsx`, `SessionWorkspace.jsx` (1200 lignes), `SessionFindings.jsx` (773 lignes), `SessionHealthSynthesis.jsx`, `SessionRecommendations.jsx` (1126 lignes) + fichiers de logique pure associés.

#### `test/`, `scripts/`, `deploy/`

- **`test/`** — 55 fichiers, ~26 000 lignes cumulées avec le reste de `server`/`client` ; couvre migrations, moteur de règles, conformité, 2FA, paiements partiels, etc. Le test `household-member-validation.test.js` vérifie explicitement qu'un message d'erreur **ne doit jamais** exposer un nom ou un numéro AVS.
- **`scripts/`** — `qa-acquisition-provision.mjs`, `qa-health-provision.mjs`, `qa-health-e2e-playwright.mjs` : provisionnement de données QA isolées et tests de bout en bout Playwright.
- **`deploy/`** — `install.sh` (déploiement idempotent VPS), `install-qa.sh` (environnement QA, refuse explicitement de toucher aux ressources de production — hostname, dossier, service, port, base — listées noir sur blanc), `setup-swissbackup.sh`, `crm-qa.service.template`.

---

### 2.2 `crm-legrand-conseils` — branche marketing non fusionnée (« marketing-ai »)

Trois branches en lignée évolutive : `feature/marketing-ai-90-days` → `feature/seo-content-factory-v1` → `feature/marketing-acquisition-consolidation-v1` (la plus complète, utilisée ci-dessous comme référence). **Aucune de ces branches n'est fusionnée dans la production.**

#### `CLAUDE.md` (racine de ces branches uniquement)

Règles permanentes du projet côté marketing : le CRM (`server/`, `client/`, `data/`, migrations, déploiement, authentification) est une **zone strictement protégée**, jamais modifiée dans le cadre marketing. Tout le travail marketing reste dans `marketing-ai/` et `.claude/agents/`. Process obligatoire sans exception : **Brouillon IA → Contrôle conformité → Validation humaine → Publication/envoi manuel (jamais automatique)**. Dix règles internes nLPD/LSA/FINMA (aucune donnée réelle transmise à un outil IA externe, aucun démarchage à froid, consentement marketing distinct et jamais pré-coché…), plus des règles de neutralité (jamais dénigrer un assureur ou un confrère, jamais de classement public). Une section « §6quater » précise l'inscription FINMA exacte (voir Étape 4, point 1).

#### `.claude/agents/` — 14 agents (système distinct des 6 agents Diagnostic 360)

`marketing-director`, `compliance-reviewer`, `content-strategist`, `linkedin-writer`, `social-media-manager`, `visual-flyer-director`, `seo-strategist`, `lead-magnet-creator`, `conversion-funnel-designer`, `performance-analyst` (les 10 documentés dans `marketing-ai/agents/README.md`), plus 4 agents à vocation plus générale/technique : `documentation-maintainer`, `migration-reviewer`, `qa-test-reviewer`, `security-reviewer`. Chaque agent n'écrit que dans son propre sous-dossier de `marketing-ai/` ; aucun n'a accès à Git, ne publie ni ne contacte un prospect.

#### `marketing-ai/strategy/`

- **`positionnement-legrand-conseils.md`** — proposition de valeur (« Comprendre. Choisir. Protéger. »), ton éditorial en **première personne du singulier** (voix d'Antoine Legrand, jamais « nous » sauf nécessité juridique), liste précise des formulations interdites (« économies garanties », « meilleur produit du marché », faux témoignages…).
- **`personas-prioritaires.md`** — 4 personas fictifs et explicitement labellisés comme tels : Persona A « Yann » (jeune actif, 3e pilier), B « Claire & Marc » (famille), C « Sophie » (indépendante), D « Léa » (changement de situation) — chacun avec besoins, freins, canaux, CTA adaptés.
- **`plan-action-90-jours.md`** + **`.csv`** — plan détaillé du **1er août au 29 octobre 2026** (90 jours, 4 phases, 13 semaines), avec responsable/livrable/priorité/KPI par tâche. Statut de départ : toutes les tâches à `À faire`.
- **`identite-et-canaux-officiels.md`** — document déclaré comme « source de vérité » pour l'identité de marque, avec une discipline stricte confirmé/à confirmer ; signale lui-même une divergence d'URL LinkedIn (voir Étape 4).
- **`registre-url-et-cta.md`** — tableau contenu × canal × CTA × URL cible × UTM proposé ; presque toutes les URL au statut `À confirmer avant diffusion`.
- **`checklist-avant-lancement.md`** — 16 sections de checklist (profils sociaux, formulaires, consentements, UTM, Analytics, mentions légales…), toutes non cochées dans le snapshot consulté.
- **`preparation-operationnelle-avant-diffusion.md`**, **`planning-preparation-16-juillet-16-aout-2026.md`** — notes de préparation complémentaires (non détaillées ici).

#### `marketing-ai/content-calendar/` — le calendrier éditorial

- **`registre-editorial-central.md`** + **`.csv`** — registre consolidé de **tout** le contenu marketing (SEO + réseaux sociaux), avec machine à états stricte (`statut_redaction` → `statut_sources` → `statut_seo` → `statut_conformite` → `validation_humaine` → `statut_publication`), gouvernée par un script (`marketing-ai/scripts/validate-editorial-registry.js`) qui empêche mécaniquement qu'un agent seul marque un contenu « Publié ». **Aucun contenu n'est marqué publié à ce jour.**
- **`calendrier-editorial-aout-2026.md`** + **`.csv`**, **`calendrier-editorial-24-aout-18-octobre-2026.md`** + **`.csv`** — calendriers de publication par semaine.

#### `marketing-ai/social-media/`

- **`checklist-creation-pages-linkedin-facebook.md`** — checklist de création des pages.
- **`linkedin/post-lancement-officiel.md`** — 2 versions du post de lancement (profil personnel d'Antoine Legrand + page entreprise), ~1550 caractères, aucun chiffre, aucune promesse.
- **`linkedin/semaine-17-23-aout-2026.md`** — 2 posts programmés pour cette semaine-là.
- **`instagram/semaine-17-23-aout-2026.md`** (carrousel « idées reçues ») + **`stories-17-23-aout-2026.md`** (4 séquences).
- **`facebook/semaine-17-23-aout-2026.md`** — post « après une naissance », CTA corrigé le 16/07 pour ne plus pointer vers une ressource inexistante.
- **`reels/semaine-17-23-aout-2026.md`** — script du 1er reel pédagogique (« 3e pilier en 30 s »).

#### `marketing-ai/seo/`, `marketing-ai/wordpress/`, `marketing-ai/outlines/`, `marketing-ai/research/`, `marketing-ai/reviews/`

Chaîne de production complète d'un seul article à ce jour (**SEO-001 — « Changer de caisse maladie : délais, étapes, documents et erreurs à éviter »**) : brief → sources officielles (Fedlex art. 7 LAMal, OFSP/Priminfo) → outline → brouillon v1 → revue SEO (78/100, corrections requises) → v2 → validation SEO → revue conformité v2 → v3 (après arbitrage humain) → revue SEO v3 (conforme) → revue conformité v3 (16 contrôles, 0 non-conforme) → **validation humaine finale par Antoine Legrand le 24/07/2026**, statut *« prêt pour préparation WordPress, aucune publication effectuée »* à la date de rédaction de ce registre. Package WordPress préparé (`wordpress/seo-001-v3/` : métadonnées Rank Math, maillage interne, brief d'image, checklist de publication) mais non exécuté. **Cet article correspond exactement à la page `changer-caisse-maladie-delais-etapes.html`, actuellement en ligne sur le site** (voir 2.3 et Étape 4).

#### `marketing-ai/lead-magnets/`, `marketing-ai/flyers/`

- **`guide-pratique-3e-pilier.md`** — guide pédagogique complet (page de couverture, sections), volontairement sans aucun chiffre non sourcé.
- **`formulaire-guide-3e-pilier.md`** — spécification du formulaire de téléchargement.
- **`flyer-bilan-assurances-prevoyance.md`** — concept de flyer local, corrigé le 16/07 pour retirer une mention de gratuité et préciser le statut d'intermédiaire.

#### `marketing-ai/compliance/` — gouvernance conformité

- **`verifications-lot-1.md`** — cadrage réglementaire général (nLPD/LSA), liste des affirmations ne devant jamais être publiées sans source (plafonds 3a, primes LAMal, prestations LPP…).
- **`revue-conformite-lot-2a.md`** — revue détaillée contenu par contenu (statuts « Prêt pour validation humaine » / « Vérification humaine obligatoire »), avec un historique honnête des tentatives de vérification de sources (accès direct à ch.ch bloqué en HTTP 403, contournement via extraits de recherche, lecture intégrale toujours en attente).
- **`sources-officielles-a-verifier.md`** — tableau des 10 affirmations à vérifier, dont le **point 9, confirmé le 17/07/2026 par des documents officiels transmis par le dirigeant** : identité FINMA exacte (voir Étape 4).

#### `marketing-ai/analytics/`

- **`kpi-90-jours.md`** — 16 indicateurs définis (portée, engagement, clics, formulaires commencés/terminés, coût par lead si publicité un jour testée…), tous qualifiés d'objectifs **prudents et non garantis**.
- **`convention-utm.md`** — convention `utm_source`/`utm_medium`/`utm_campaign`/`utm_content`, règles de nommage strictes (minuscules, sans accents).

#### Autres branches du dépôt CRM (non explorées en détail)

`feature/lead-generation-engine` (Bloc 4 partenaires/recommandations, décrit dans `PROJECT_HANDOFF.md` comme non fusionné, UI partielle), `feature/acquisition-os` (source historique de commits pour le module Acquisition déjà en grande partie porté dans la branche de production, cf. `ACQUISITION_OS_GUARDRAILS.md`), `integration/acquisition-advisory-v1`, `integration/swiss-insurance-crm-v1`, `feature/swiss-insurance-crm`, et une quinzaine de branches `feature/advisory-*`/`fix/*` qui correspondent, d'après leur nom et les documents déjà lus, aux lots de développement individuels du module Diagnostic 360 déjà intégrés dans la branche de production actuelle.

---

### 2.3 `site-legrandconseils` — branche `main` (site en ligne)

Site vitrine WordPress/Kadence (hébergé chez IONOS d'après `PROJECT_HANDOFF.md`) exporté ici en pages HTML statiques, ton à la première personne (« je »), FINMA et indépendance mis en avant systématiquement.

| Page | Contenu |
|---|---|
| `accueil.html` | Page d'accueil : accroche, « pourquoi me faire confiance », 3 domaines de service, 3 outils gratuits (comparateur, générateur de résiliation, démarches en ligne), FAQ, zone Vaud/Genève. |
| `a propos.html` | Positionnement personnel d'Antoine Legrand, valeurs, cadre légal (FINMA, rémunération, nLPD, devoir de conseil). |
| `services.html` | Détail des 3 domaines (LAMal, LCA, prévoyance 3a/3b) avec livrables concrets par domaine. |
| `assurance maladie.html` | Page LAMal : couverture/exclusions, 4 modèles d'assurance, franchises (CHF 300 à 2500), FAQ délais de résiliation. |
| `assurance complementaire.html` | Page LCA : comparaison LAMal/LCA, types de complémentaires, réserves/délais d'attente, questionnaire de santé. |
| `Assurance vie.html` | Page prévoyance 3a/3b : 3 piliers suisses, comparatif 3a vs 3b, **simulateur fiscal interactif** (revenu, canton, situation familiale → économie d'impôt et capital projeté sur 10/20/30 ans), plafonds 2026 (CHF 7 258 salarié, 20%/CHF 36 288 indépendant), spécificités GE/FR pour le 3b. |
| `comparateur LAMal.html` | Outil de comparaison de primes (canton, âge, modèle, franchise) auprès de 4 assureurs partenaires nommés (Helsana, Groupe Mutuel, SWICA, CSS) + profil de besoins en complémentaires ; rappelle les 2 échéances de résiliation (30 nov. LAMal / 30 sept. LCA). |
| `changer-caisse-maladie-delais-etapes.html` | Article de fond (guide pédagogique) sur la procédure de changement de caisse : délai de réception (30 novembre), documents à conserver, cas des primes impayées, sources OFSP/Priminfo/Fedlex citées en fin d'article. **Correspond au contenu SEO-001 de la branche marketing du CRM** (voir 2.2 et Étape 4). |
| `resiliation.html` | Générateur de lettre de résiliation (formulaire → lettre pré-remplie), 4 règles d'or, précise qu'aucune donnée saisie n'est transmise ou conservée. |
| `demarches en ligne.html` | Espace complet de préparation documentaire : fiche d'information art. 45 LSA, mandat de courtage, protocole d'entretien-conseil — les trois avec champs `{{COURTIER_NOM}}`/`{{FINMA_NO}}` etc. (gabarits, pas de données réelles). Précise que la signature électronique qualifiée (QES) est acceptée sauf pour la résiliation LAMal (forme écrite exigée par la loi). |
| `contact.html` | Coordonnées (téléphone, e-mail), formulaire Forminator (id 322). |
| `information sur l'intermediation.html` | Fiche légale art. 45/45b LSA : raison sociale, zone d'activité, statut de courtier non lié, mode de rémunération, procédure de réclamation (Ombudsman de l'assurance privée). |
| `mention legales.html` | Impressum : identité, activité réglementée, limitation de responsabilité, droit suisse/for à Vaud. Dernière mise à jour mars 2026. |
| `condition d'utilisation.html` | CGU du site : usage personnel, propriété intellectuelle, précise que les montants (ex. plafond 3a) peuvent évoluer. |
| `protection des données.html` | Politique de confidentialité nLPD : données collectées (dont données de santé « uniquement avec accord explicite »), durées de conservation (10 ans contact/conseil, 13 mois navigation, 5 ans correspondances), droits (accès/rectification/effacement/portabilité/opposition). |
| `cookies.html` | Politique cookies : cookies WordPress techniques + Google Analytics (`_ga`, `_ga_*`, `_gid`) ; **aucun cookie publicitaire/ciblage mentionné** (cohérent avec l'absence de Meta Pixel constatée, voir Étape 6). |
| `menu-css-additionnel.css` | Feuille de style autonome (271 lignes) à coller dans WordPress → Personnaliser → CSS additionnel, pour la lisibilité du menu de navigation. |

---

### 2.4 `site-legrandconseils` — branches non fusionnées (acquisition, tracking, comparateur)

#### `feature/acquisition` et `feature/acquisition-tracking-v1` — 3 nouvelles pages d'atterrissage + tracking

Ajoutent **3 landing pages** absentes de `main`, chacune ciblée sur un persona (cohérent avec les personas de la branche marketing du CRM) et terminée par un formulaire (canton, créneau de rappel, consentement explicite non pré-coché) :

- **`bilan-prevoyance-3a.html`** — cible « jeunes actifs », accroche « Commencer son 3e pilier, enfin simplement ».
- **`independants-proteger-revenu.html`** — cible indépendants, accroche « Indépendant : et si vous ne pouviez plus travailler ? ».
- **`proteger-sa-famille.html`** — cible familles, accroche « Protéger votre famille et votre revenu ».

Ces 3 pages modifient aussi en profondeur `comparateur LAMal.html`, `demarches en ligne.html` et `resiliation.html`, et **suppriment `changer-caisse-maladie-delais-etapes.html`** (voir Étape 4, point 6).

#### `feat/demarches-acquisition-tracking-v1` — le mécanisme de tracking en détail

Branche plus ciblée (146 lignes ajoutées sur `demarches en ligne.html` uniquement), qui montre précisément le mécanisme :
- Capture **first-touch** en `sessionStorage` des paramètres `campaign_key`, `utm_source/medium/campaign/content/term`, **`gclid`** (Google Ads) et **`fbclid`** (Meta Ads).
- Un formulaire de contact s'insère dynamiquement sur les CTA de la page et **envoie les données en `POST` vers `https://crm.legrandconseils.ch/api/public/lead`** — l'endpoint déjà en production côté CRM.
- Pousse des événements `lead_form_open` et `lead_submit` dans `window.dataLayer` (Google Tag Manager).
- Le texte de la page est mis à jour en conséquence : l'ancienne mention *« aucune donnée saisie n'est transmise »* devient *« les informations que vous saisissez sont transmises à Legrand Conseils Sàrl avec votre consentement »*.
- Le numéro FINMA réel apparaît en dur dans la configuration du script : **`F01569355`** (celui de la personne physique, Antoine Legrand — cohérent avec la branche marketing du CRM, voir Étape 4).

#### `chore/comparateur-lamal-prod-2026.1.2` — comparateur LAMal en plugin WordPress avec données officielles

Package complet dans `wordpress-plugins/legrand-comparateur-lamal/` :
- **`legrand-comparateur-lamal.php`** — plugin WordPress (« Version: 2026.1.2 »), shortcode `[legrand_comparateur_lamal]`, n'installe aucune table, charge ses ressources uniquement sur les pages où le shortcode est utilisé.
- **`templates/comparateur-lamal-template.php`** — gabarit d'affichage.
- **`data/premiums-2026/`** — **24 fichiers JSON par canton/région** + `manifest.json` (395 lignes), généré le 2026-07-29 à partir des **données officielles de l'OFSP** (`opendata.swiss` — « Primes de l'assurance-maladie », année active 2026, année d'enquête 2025). Ceci répond directement au point connu documenté dans `PROJECT_HANDOFF.md` §10.4 (« le comparateur LAMal du site utilise des primes indicatives/approximatives — à confirmer avec les primes officielles OFSP »).

---

### 2.5 `plan-evolution-exploitation-legrand-conseils-`

Dépôt **entièrement vide** : `git ls-remote` ne retourne aucune référence, sur aucune branche. Rien n'a jamais été poussé ici. Le nom du dépôt (« plan d'évolution de l'exploitation ») suggère qu'un contenu était prévu mais n'a pas atterri dans Git — potentiellement un document existant ailleurs (traitement de texte local, autre outil) et jamais versionné, ou un dépôt créé par anticipation. **À clarifier avec l'utilisateur.**

### 2.6 `desktop-tutorial`

Dépôt tutoriel créé automatiquement par l'application GitHub Desktop lors d'une première utilisation (« Welcome to GitHub Desktop! Write your name on line 6… »). Un seul fichier, `README.md` par défaut. **Aucun rapport avec Legrand Conseils** ; probablement un résidu de configuration initiale du compte GitHub.

---

## Étape 3 — Anonymisation des données personnelles trouvées

Un balayage ciblé (numéros AVS au format `756.xxxx.xxxx.xx`, champs `birth_date`/`avs_number`, e-mails, noms complets dans les fixtures et données de démonstration) a été effectué sur l'ensemble des dépôts et branches explorés. **Aucune donnée client ou prospect réelle n'a été trouvée** : `data/crm.sqlite` (la base réelle) est exclue du dépôt par `.gitignore` et n'a jamais été committée, sur aucune branche consultée.

Les seules données personnelles rencontrées sont des fixtures de test ou de démonstration, manifestement fictives (l'une des deux utilise littéralement « Jean Dupont », l'équivalent français de « John Doe »). Elles sont recensées ci-dessous sous forme anonymisée par précaution, conformément à la consigne — **à vérifier avec l'utilisateur** dans chaque cas :

| Identifiant | Emplacement | Nature | Note |
|---|---|---|---|
| `Fixture-A1` | `test/api.test.js` | Prénom/nom + e-mail + AVS de test | Nom « Efface » (jeu de mots sur la fonction testée : effacement/anonymisation). **À vérifier avec l'utilisateur.** |
| `Fixture-A2` | `test/household-member-validation.test.js` | Nom complet + AVS de test | Littéralement « Jean Dupont » — équivalent de « John Doe » ; le test vérifie précisément que ce nom et cet AVS **n'apparaissent jamais** dans un message affiché. **À vérifier avec l'utilisateur.** |
| `Fixture-B1` à `Fixture-B4` | `server/seed-demo.js` | 3 prénoms/noms + 1 raison sociale fictive (« Boulangerie du Bourg Sàrl ») + e-mail associé | Données de démonstration pour peupler un CRM vide à but de démo. **À vérifier avec l'utilisateur.** |
| `Fixture-C1` à `Fixture-C5` | `server/seed-commission-demo.js` | Entrées marquées par une constante `DEMO_MARKER`, e-mails en `@demo-fictif.invalid` | Explicitement conçues pour être identifiables et supprimables comme données de démo. **À vérifier avec l'utilisateur.** |
| — | `resiliation.html` (site) | Un numéro AVS type (`756.1234.5678.90`) en `placeholder` d'un champ de formulaire | Simple exemple de saisie affiché à l'utilisateur du site, pas une donnée stockée. |

Par ailleurs, l'identité professionnelle d'Antoine Legrand / Legrand Conseils Sàrl (nom, e-mail `a.l@legrandconseils.ch`, téléphone, numéros FINMA F01569363/F01569355, UID CHE-376.900.357) apparaît largement dans les documents et sur le site public lui-même. **Elle n'a pas été anonymisée** : il s'agit de l'identité professionnelle propre de l'exploitant, déjà publique (site web, registre FINMA), et non d'une donnée de client ou de prospect au sens de la consigne.

Les personas marketing fictifs (« Yann », « Claire & Marc », « Sophie », « Léa ») ne sont pas non plus anonymisés ici : ils sont déjà explicitement désignés comme fictifs et représentatifs par leur document source, et ne portent aucune donnée sensible (pas de date de naissance, pas d'AVS, pas de nom de famille réel).

---

## Étape 4 — Doublons et contradictions à trancher

Classées par ordre de priorité proposé.

### 1. Portée exacte de l'inscription FINMA vs contenu LAMal du site public

**Fait établi** (`marketing-ai/compliance/sources-officielles-a-verifier.md`, confirmé le 17/07/2026 par documents officiels transmis par le dirigeant) : l'inscription FINMA de Legrand conseils Sàrl (n° F01569363) et d'Antoine Legrand (n° F01569355) couvre exactement les branches **« assurance-maladie complémentaire » et « assurance-vie »** — explicitement **pas** une autorisation générale, et explicitement **pas** un agrément pour l'assurance obligatoire **LAMal**.

**Ce qui est en ligne aujourd'hui** : le site public (`assurance maladie.html`, `comparateur LAMal.html`, `accueil.html`, `services.html`) présente l'optimisation LAMal (choix de modèle, de franchise, comparaison de caisses) comme l'un des 3 piliers de service, à égalité avec la LCA et la prévoyance, sans que cette nuance de périmètre FINMA n'apparaisse dans ce que j'ai pu lire.

**Ce qui n'est pas tranché ici** : le conseil sur le *choix* de modèle/franchise LAMal (assurance de base, sans sélection ni tarification négociée par le courtier) est-il de nature différente, du point de vue LSA, de l'intermédiation sur des produits LCA/vie à souscription ? C'est précisément le type de question que `compliance-privacy-reviewer` (CRM) et `compliance-reviewer` (marketing) sont conçus pour signaler sans trancher seuls. **Expertise externe requise** avant toute action.

### 2. Deux systèmes de sous-agents Claude Code non réconciliés

Le dépôt `crm-legrand-conseils` porte, selon la branche, deux jeux de sous-agents totalement différents : les **6 agents Diagnostic 360** (branche de production, périmètre métier assurance/CRM) et les **14 agents marketing** (branches `feature/marketing-ai-*`, périmètre communication/acquisition). `ACQUISITION_OS_GUARDRAILS.md` (§3) liste explicitement `.claude/agents/*.md` et `marketing-ai/*` comme un « historique parasite » à ne **jamais** importer automatiquement lors d'une fusion — mais ce garde-fou concerne une mission d'intégration technique précise, pas une décision définitive sur l'avenir de ces deux systèmes. Risque concret : un nom d'agent comme `compliance-reviewer` (marketing) ressemble beaucoup à `compliance-privacy-reviewer` (Diagnostic 360) mais couvre un périmètre différent — confusion possible si les deux existaient un jour dans la même branche. **À trancher : les deux systèmes doivent-ils un jour cohabiter dans une seule branche, rester séparés, ou l'un doit-il être abandonné ?**

### 3. Orthographe de la raison sociale

Le document de conformité le plus fiable sur ce point (`sources-officielles-a-verifier.md`, confirmé par documents officiels) précise explicitement : *« Dans la communication de marque, utiliser "Legrand conseils Sàrl" ("conseils" avec un c minuscule, comme au registre) »*. Or le site public (mentions légales, protection des données, intermédiation), le `README.md` du CRM et ce document lui-même (dans son titre et sa consigne d'origine) utilisent systématiquement **« Legrand Conseils »** avec un C majuscule. Il peut s'agir d'un choix de style de marque assumé (casse de registre vs casse de communication) plutôt que d'une erreur — **à confirmer avec l'utilisateur**, puisque le document marketing lui-même le présente comme une règle à appliquer strictement.

### 4. URL de la page LinkedIn entreprise

Deux variantes constatées dans les mêmes documents marketing :
- `https://www.linkedin.com/company/legrand-conseils-s%C3%A0rl/` (avec accent encodé) — retenue comme « confirmée » dans `identite-et-canaux-officiels.md`.
- `https://www.linkedin.com/company/legrand-conseils-sarl/` (sans accent) — utilisée dans `checklist-creation-pages-linkedin-facebook.md` et dans `social-media/linkedin/post-lancement-officiel.md`.

Cette divergence est **déjà repérée par le document source lui-même**, qui la marque explicitement comme *« à réconcilier par un humain »*. Une URL candidate pour le profil LinkedIn personnel d'Antoine Legrand a par ailleurs été trouvée (`linkedin.com/in/antoine-legrand-abaa68196/`) mais reste, elle aussi, au statut non confirmé dans le document de référence.

### 5. Nom de l'événement analytics « lead généré »

`PROJECT_HANDOFF.md` (CRM) et plusieurs documents marketing (`kpi-90-jours.md`, `checklist-avant-lancement.md`, `registre-url-et-cta.md`) désignent tous, de façon cohérente entre eux, un événement GA4 nommé **`generer_lead`**. Mais le code de tracking réellement trouvé (branche `feat/demarches-acquisition-tracking-v1` du site) pousse dans `dataLayer` des événements nommés **`lead_form_open`** et **`lead_submit`**, jamais littéralement `generer_lead`. Cela peut simplement signifier qu'un conteneur Google Tag Manager (non visible dans le code) traduit ces événements `dataLayer` vers un événement GA4 appelé `generer_lead` — configuration que je ne peux pas vérifier depuis le code seul. **À confirmer côté GTM/GA4.**

### 6. Une page en ligne est supprimée par la branche de tracking la plus récente

`changer-caisse-maladie-delais-etapes.html` est actuellement **en ligne** sur `main` du site, et correspond très vraisemblablement à l'article SEO-001 validé humainement le 24/07/2026 dans la branche marketing du CRM. Or les branches `feature/acquisition` et `feature/acquisition-tracking-v1` (site) **suppriment ce fichier** (249 lignes retirées) sans visiblement le remplacer par un contenu équivalent ailleurs dans le même diff. Avant toute fusion de ces branches, il faut vérifier si cette suppression est intentionnelle (contenu déplacé/restructuré ailleurs) ou un oubli.

### 7. `feature/acquisition-analytics.js` avec un schéma de commissions obsolète

Signalé par `ACQUISITION_OS_GUARDRAILS.md` lui-même (§11, fait déjà connu, pas une découverte de cette mission) : `server/routes/acquisition-analytics.js` interroge la table `commissions` avec des noms de colonnes antérieurs à la migration 15 (`amount`/`due_date`/`paid_date` plutôt que `expected_amount_chf`/`expected_payment_date`/etc.). Le fichier existe dans la branche de production mais **ne doit pas être activé** avant adaptation.

---

## Étape 6 — Ce qui manque par rapport à une activité de courtier bien organisée

Organisé par domaine, avec le statut réel constaté (existe et actif / préparé mais non déployé / réellement absent) plutôt qu'un simple oui/non — car une grande partie de ce qu'on pourrait croire « manquant » existe en réalité déjà, juste pas fusionné ni publié.

### CRM et outillage métier — globalement en place
- Le CRM lui-même est riche, testé (55 fichiers de test) et, d'après sa propre documentation, **en production**. Rien à signaler ici sinon la confirmation que cette documentation reste exacte aujourd'hui.
- Le Bloc 4 (partenaires/recommandations, apporteurs d'affaires) reste **non fusionné et non testé de bout en bout** (`feature/lead-generation-engine`) — à reprendre ou abandonner explicitement.
- La table `acquisition-analytics.js` (analytics d'acquisition) existe mais n'est **pas activable** en l'état (point 7 ci-dessus).
- Aucune trace d'intégration comptable (au-delà de la règle de conservation légale des commissions payées, art. 958f CO) — normal si la comptabilité reste externe, mais à confirmer.
- Aucune trace des conventions de courtage signées avec les 12 compagnies pré-remplies dans le CRM — probablement des documents papier/PDF hors dépôt, ce qui est attendu, mais elles ne sont donc pas retrouvables depuis ce code.

### Contenu et calendrier éditorial — préparé en détail, non déployé
- Un calendrier éditorial complet **existe** (`marketing-ai/content-calendar/`), mais uniquement sur une branche jamais fusionnée du dépôt CRM — un point d'entrée que personne ne consulterait en ouvrant simplement le site ou la branche de production.
- Selon le registre éditorial lui-même, **zéro contenu n'est au statut `Publié`** à ce jour, alors que le plan visait un rythme de 2-3 posts LinkedIn/semaine dès le 16 août. Le brouillon disponible ne couvre, au moment de la dernière consolidation (24/07), que le lancement + une semaine (17-23 août) — pas six semaines de contenu, comme le plan l'aurait voulu à la date d'aujourd'hui (30 août).
- Un seul article de blog a été mené jusqu'au bout (SEO-001), et son statut de publication réelle sur le site public **n'est pas confirmé** par les documents eux-mêmes (voir Étape 4, point 6, sur le risque de suppression).
- Les comptes Instagram et Facebook restent au statut « à confirmer humainement » (existence et URL) dans le document censé faire autorité sur ce point.

### Acquisition payante (Meta Ads / Google Ads) — délibérément non lancée
- L'infrastructure technique (tracking `fbclid`/`gclid`, first-touch attribution, transmission au CRM) **existe et est prête**, mais sur une branche du dépôt du site jamais fusionnée.
- 3 pages d'atterrissage dédiées existent, prêtes mais non publiées.
- Le garde-fou du CRM interdit explicitement toute campagne Meta Ads/Google Ads avant le **1er septembre 2026** — soit littéralement le lendemain de la date de compilation de cet inventaire. Rien à « corriger » ici : c'est une décision déjà prise, il s'agit simplement de savoir si la bascule est prévue pour demain.

### Comparateur LAMal — correction déjà prête, non déployée
- Le comparateur en ligne (site, branche `main`) utilise encore des primes indicatives.
- Une version avec les **vraies données OFSP 2026** existe sous forme de plugin WordPress complet, prête, mais non fusionnée/déployée.

### Gouvernance et conformité — solide sur le papier, fragmentée dans les faits
- Deux corpus de règles (CRM/Diagnostic 360 et marketing) ne se référencent pas l'un l'autre et vivent sur des branches différentes — pas de point d'entrée unique pour « les règles de la maison ».
- La politique de conservation/anonymisation des données de diagnostic (`DATA_RETENTION.md`) est entièrement codée mais **désactivée par défaut**, en attente d'une validation juridique qui ne semble pas encore avoir eu lieu.
- Aucun document de type « registre des sous-traitants » ou « analyse d'impact nLPD » formalisé au-delà de ce qui est déjà intégré au CRM (registre des traitements) n'a été trouvé pour le volet marketing, bien que les brouillons marketing anticipent correctement la question (consentement séparé, minimisation).

### Mesure et pilotage — cadre défini, pas encore alimenté
- Un cadre de KPI détaillé et prudent existe (`kpi-90-jours.md`), mais dépend de données qui, selon le registre éditorial, n'existent pas encore puisque rien n'est publié.
- Aucun tableau de bord ou rapport consolidé J14/J30/J60/J90 n'a été trouvé comme livré — seulement prévu dans le plan.

### Éléments explicitement demandés et non trouvés
- **Aucun CV** n'a été trouvé dans les dépôts accessibles.
- **Aucun « comparatif »** au sens document autonome (au-delà de l'outil comparateur LAMal lui-même et de `CONTRATS_ASSURANCE_SUISSE.md`, qui est une référence technique interne plutôt qu'un comparatif commercial).
- Rien dans `plan-evolution-exploitation-legrand-conseils-` (dépôt vide) — si un plan d'évolution de l'exploitation existe réellement, il n'est pas dans Git.
