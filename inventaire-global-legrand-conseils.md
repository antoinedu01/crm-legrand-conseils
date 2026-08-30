# Inventaire global — Legrand Conseils Sàrl

Document généré le 2026-08-30 par exploration récursive de deux dépôts Git et de toutes leurs branches, à partir de `/home/user/crm-legrand-conseils`.

**Dépôts explorés :**
- `crm-legrand-conseils` (le CRM lui-même) — branche courante `claude/legrand-marketing-consolidation-x9nhx7` @ `a94287c`, **31 branches au total** sur `origin`
- `site-legrandconseils` (le site public WordPress) — branche courante `main` @ `de75647`, **7 branches au total** sur `origin`

Aucun autre dossier de projet n'a été trouvé ailleurs sur le système (`/home`, `/workspace`, `/mnt`, `/root/.claude/uploads` vérifiés : vides ou sans rapport).

---

## SYNTHÈSE — qui dit ce qui est où

### Constat principal

Votre activité n'est **pas** répartie dans plusieurs dossiers au sens classique — elle est répartie dans **deux dépôts Git**, et surtout dans **de nombreuses branches Git non fusionnées** à l'intérieur de ces dépôts. Une branche Git peut contenir un travail complet et jamais visible si on ne regarde que la branche actuellement ouverte. C'est exactement ce qui s'est produit ici : la quasi-totalité de votre contenu marketing (calendrier éditorial, posts LinkedIn/Instagram/Facebook, article SEO, guide 3e pilier, flyer, comparatifs) existe uniquement sur des branches jamais fusionnées dans la branche actuellement ouverte du CRM.

### Tableau récapitulatif

| Emplacement | Contient | État |
|---|---|---|
| `crm-legrand-conseils`, branche courante (`claude/legrand-marketing-consolidation-x9nhx7`) | Le CRM lui-même (code), la documentation technique, les 6 agents Diagnostic 360 | Réel, actif, mais **zéro contenu marketing** malgré le nom de la branche |
| `crm-legrand-conseils`, branche `feature/marketing-ai-90-days` | La fondation du système marketing : `CLAUDE.md`, 14 agents, `marketing-ai/` (stratégie, calendrier, réseaux sociaux, conformité, flyer, guide) | Jamais fusionnée dans la branche courante |
| `crm-legrand-conseils`, branche `feature/seo-content-factory-v1` | Descendante directe de la précédente + tout le pipeline SEO-001 (article "changer de caisse maladie") | Jamais fusionnée |
| `crm-legrand-conseils`, branches `feature/marketing-acquisition-consolidation-v1` → `feature/marketing-source-verification-v1` / `feature/marketing-source-reconciliation-v1` | Une **deuxième lignée marketing indépendante**, sans `CLAUDE.md` ; registre éditorial central, posts LinkedIn SOC-LI-001 à 006, vérifications de sources | Jamais fusionnées, et les deux branches finales se **contredisent** entre elles (voir §4) |
| `crm-legrand-conseils`, ~20 autres branches (`feature/advisory-*`, `feature/acquisition-*`, `fix/*`, `integration/*`) | Le module Diagnostic 360 (LAMal/LCA/3a/LPP côté produit CRM) et le module Acquisition, par petits lots successifs | Travail produit/ingénierie, en grande partie déjà intégré dans la branche courante |
| `site-legrandconseils`, branche `main` | Le site public réel : pages produits, comparateur LAMal (version simple), formulaires | Publié |
| `site-legrandconseils`, branche `chore/comparateur-lamal-prod-2026.1.2` | Snapshot exact du plugin WordPress Comparateur LAMal réellement en production (sécurisé cette session) | Non fusionnée, volontairement — c'est un instantané de sauvegarde |
| `site-legrandconseils`, branches `feature/acquisition-tracking-v1` et `feat/demarches-acquisition-tracking-v1` | Tracking d'acquisition (UTM/campaign_key) ajouté à 6 pages du site, dont une déjà validée en production (Démarches en ligne) | Partiellement déployée, à confirmer page par page |

### Alertes prioritaires (à trancher en premier)

1. **Aucune gouvernance (`CLAUDE.md`, agents, garde-fous) ne protège la deuxième lignée marketing** (`marketing-acquisition-consolidation-v1` → `verification-v1`/`reconciliation-v1`). Ses propres fichiers de conformité citent une règle interne (« CLAUDE.md § 6quater ») qui n'existe pas dans leur propre arborescence.
2. **Deux branches marketing sœurs se contredisent sur le même contenu** : `feature/marketing-source-verification-v1` bloque plusieurs publications LinkedIn/Instagram/Facebook faute de source officielle directement consultée ; `feature/marketing-source-reconciliation-v1` débloque exactement ce même contenu sur la base d'une lecture des sources rapportée par vous, mais non vérifiée par l'agent. Les deux versions existent en parallèle, aucune n'a « gagné ».
3. **Rien n'est publié.** Sur les deux dépôts, tout le contenu marketing (calendrier, posts, article SEO, guide, flyer) est à l'état de brouillon validé humainement au mieux — aucune automatisation de publication n'existe, conformément à vos règles internes, mais cela signifie aussi qu'un mois de travail (16 juillet → 26 août 2026) attend une action manuelle de votre part.
4. Aucune donnée client ou prospect réelle n'a été trouvée nécessitant une anonymisation (détail §3).

---

## 1. CARTOGRAPHIE

| Chemin / branche | CLAUDE.md ou `.claude/` ? | Pourquoi pertinent |
|---|---|---|
| `crm-legrand-conseils` @ `claude/legrand-marketing-consolidation-x9nhx7` (courante) | `.claude/agents/` (6 agents Diagnostic 360), pas de `CLAUDE.md` | Le CRM réel : clients, contrats, commissions, module Diagnostic 360, module Acquisition |
| `crm-legrand-conseils` @ `feature/marketing-ai-90-days` | `CLAUDE.md` + `.claude/agents/` (14 agents) + `.claude/settings.json` | Fondation du système marketing complet, jamais fusionnée |
| `crm-legrand-conseils` @ `feature/seo-content-factory-v1` | Identique à ci-dessus + 1 agent (`seo-writer`) | Pipeline SEO complet pour l'article "changer de caisse maladie" |
| `crm-legrand-conseils` @ `feature/marketing-acquisition-consolidation-v1` | Aucun `CLAUDE.md`, 11 agents seulement | Deuxième import indépendant du système marketing, registre éditorial central |
| `crm-legrand-conseils` @ `feature/marketing-source-verification-v1` | Aucun `CLAUDE.md` | Vérification stricte des sources officielles, plusieurs posts bloqués |
| `crm-legrand-conseils` @ `feature/marketing-source-reconciliation-v1` | Aucun `CLAUDE.md` | Version la plus récente (26/08/2026), débloque le contenu que la branche ci-dessus avait bloqué, ajoute 2 nouveaux posts LinkedIn |
| `crm-legrand-conseils` @ `feature/swiss-insurance-crm` | `CLAUDE.md` propre (mis à jour, §3bis ajouté) | Descendante de `marketing-ai-90-days`, ajoute le développement CRM Assurance Suisse ; pas de contenu marketing nouveau |
| `crm-legrand-conseils` @ ~20 branches `feature/advisory-*`, `feature/acquisition-*`, `fix/*`, `integration/*` | Aucun `CLAUDE.md` propre | Ingénierie produit du Diagnostic 360 et de l'Acquisition, par lots ; largement déjà intégrée à la branche courante |
| `crm-legrand-conseils` @ `assurance-complementaire.html` | — | Nom de branche trompeur : ne contient aucun fichier de ce nom, c'est un pointeur dupliqué vers un ancien commit de fusion CRM (probable erreur de commande de push) — sans intérêt propre |
| `site-legrandconseils` @ `main` | Aucun `CLAUDE.md`/`.claude/` (confirmé sur toutes les branches de ce dépôt) | Le site public réel |
| `site-legrandconseils` @ `chore/comparateur-lamal-prod-2026.1.2` | — | Snapshot du plugin WordPress Comparateur LAMal 2026.1.2 réellement en production |
| `site-legrandconseils` @ `feature/acquisition-tracking-v1` / `feat/demarches-acquisition-tracking-v1` | — | Tracking d'acquisition ajouté aux formulaires du site |
| `site-legrandconseils` @ `feature/seo-001-cta-contrast`, `feature/seo-001-cta-hover-contrast`, `claude/legrandconseils-repo-analysis-o2uvrq` | — | **Déjà fusionnées dans `main`** — aucun contenu propre restant, mentionnées pour mémoire uniquement |

---

## 2. INVENTAIRE DÉTAILLÉ PAR DOSSIER/BRANCHE

### 2.1 `crm-legrand-conseils` — branche courante (`claude/legrand-marketing-consolidation-x9nhx7`)

| Fichier | Résumé |
|---|---|
| `README.md` | Présentation produit du CRM : gestion clients/contrats/commissions multi-compagnies, conformité nLPD/LSA/FINMA (journal d'audit, consentement, export/anonymisation). |
| `PROJECT_HANDOFF.md` | Document de passation : état du dépôt, architecture, ce qui est livré vs. incomplet, désigne `claude/insurance-broker-crm-exx09v` comme **branche de production**. |
| `DEPLOIEMENT.md` | Guide d'auto-hébergement sur VPS suisse (script `install.sh`, Caddy HTTPS, sauvegardes nocturnes). |
| `.env.example` / `.env.qa.example` | Gabarits de configuration (aucun secret) ; l'environnement QA est explicitement isolé de la production. |
| `docs/ACQUISITION_OS_GUARDRAILS.md` | Règles strictes d'intégration du module Acquisition (cherry-pick uniquement, jamais de fusion en bloc). |
| `docs/CONTRATS_ASSURANCE_SUISSE.md` | Modèle de données des branches LAMal/LCA/Vie/Prévoyance/LPP-IJM. |
| `docs/MIGRATIONS.md` | Historique complet des migrations de schéma (versions 1 à 16). |
| `docs/advisory/*` (23 fichiers) | Corpus complet du module « Diagnostic 360 » : architecture, modèle de données, moteur de règles, questionnaires LAMal/LCA/Vie-Prévoyance (contenu réel mais non publié), rétention des données, sécurité/vie privée, UX conseiller/client, checklists QA manuelles. |
| `.claude/agents/*.md` (6 fichiers) | `advisory-architect` (architecture du module), `health-insurance-domain` (contenu questionnaire LAMal/LCA), `life-pension-domain` (contenu questionnaire 3a/3b/LPP), `rules-engine-auditor` (audit du moteur de règles), `client-meeting-ux` (ergonomie du rendez-vous), `compliance-privacy-reviewer` (revue nLPD/LSA). Système **entièrement distinct** de celui du marketing. |
| `server/`, `client/`, `deploy/`, `scripts/`, `test/` | Backend Node/Express + SQLite, frontend React/Vite, scripts de déploiement/QA, suite de tests (60+ fichiers). Code produit, pas du contenu métier. |

### 2.2 `feature/marketing-ai-90-days` — fondation du système marketing

Dernier commit : `8ff16ee`, 2026-07-20. **Non fusionnée** dans la branche courante (historique divergent depuis `d9fb0a0`).

**`CLAUDE.md`** — règles permanentes : le dépôt = zone protégée (CRM) + zone marketing confinée à `marketing-ai/` et `.claude/agents/` ; processus obligatoire brouillon IA → revue conformité → validation humaine → publication manuelle (jamais automatique) ; interdiction de collecter des données médicales, de démarchage à froid, de scraping ; ton neutre, pas de dénigrement de concurrents ; numéros d'enregistrement FINMA confirmés (Legrand conseils Sàrl : **F01569363** ; Antoine Legrand : **F01569355**, UID CHE-376.900.357), tous deux intermédiaires non liés.

**`.claude/agents/` (14 agents)** — chacun confiné à écrire uniquement dans son sous-dossier de `marketing-ai/`, jamais de publication automatique :

| Agent | Écrit dans |
|---|---|
| `marketing-director` | `strategy/`, `content-calendar/` (orchestration) |
| `compliance-reviewer` | `compliance/` (filtre nLPD/LSA/FINMA avant validation humaine) |
| `content-strategist` | `strategy/`, `content-calendar/` |
| `linkedin-writer` | `social-media/linkedin/` |
| `social-media-manager` | `social-media/{instagram,facebook,reels}/` |
| `visual-flyer-director` | `flyers/` |
| `seo-strategist` | `seo/` |
| `lead-magnet-creator` | `lead-magnets/` |
| `conversion-funnel-designer` | `landing-pages/` |
| `performance-analyst` | `analytics/` (données humaines uniquement, jamais le CRM réel) |
| `documentation-maintainer` | `docs/**`, `PROJECT_HANDOFF.md` |
| `migration-reviewer` | lecture seule (revue des migrations SQLite) |
| `qa-test-reviewer` | lecture seule (couverture de tests) |
| `security-reviewer` | lecture seule (revue sécurité statique) |

**`marketing-ai/` — contenu (45 fichiers, dont 13 `.gitkeep` vides)**

| Fichier | Résumé |
|---|---|
| `README.md`, `agents/README.md` | Vue d'ensemble du système marketing et table des agents. |
| `analytics/convention-utm.md` | Convention de tagging UTM pour tracer les sources de leads. |
| `analytics/kpi-90-jours.md` | 16 indicateurs KPI du plan 90 jours (portée, leads, coût par lead...), objectifs prudents non garantis. |
| `compliance/revue-conformite-lot-2a.md` | Revue de conformité du lot de contenu 17–23 août 2026 ; sources partiellement vérifiées seulement (blocages HTTP 403 documentés). |
| `compliance/sources-officielles-a-verifier.md` | Registre de 10 affirmations réglementaires à sourcer, dont la confirmation officielle des numéros FINMA. |
| `compliance/verifications-lot-1.md` | Registre de vérification pour les livrables stratégiques (montants 3a/3b, LAMal, LPP à vérifier avant diffusion). |
| `content-calendar/calendrier-editorial-aout-2026.md` + `.csv` | Calendrier éditorial d'août 2026 (Phase 1 préparation, Phase 2 lancement contrôlé), jour par jour. |
| `flyers/flyer-bilan-assurances-prevoyance.md` | Concept complet de flyer A5 « Bilan général assurances et prévoyance », mentions légales à vérifier avant impression. |
| `lead-magnets/formulaire-guide-3e-pilier.md` | Spécification du formulaire de téléchargement du guide 3e pilier : champs minimaux, double consentement, données interdites (AVS, médical, revenus). |
| `lead-magnets/guide-pratique-3e-pilier.md` | Texte complet du guide pédagogique « Comprendre le 3e pilier 3A et 3B », volontairement sans aucun chiffre non vérifié. |
| `social-media/checklist-creation-pages-linkedin-facebook.md` | État des pages sociales (LinkedIn actif, Instagram existant, Facebook créée), éléments encore attendus de vous. |
| `social-media/facebook/semaine-17-23-aout-2026.md` | Brouillon final Facebook, persona famille, thème "après la naissance". |
| `social-media/instagram/semaine-17-23-aout-2026.md` | Carrousel Instagram 6 slides « 3 idées reçues sur le 3e pilier ». |
| `social-media/instagram/stories-17-23-aout-2026.md` | 4 séquences de Stories avec stickers interactifs et réponses-types. |
| `social-media/linkedin/post-lancement-officiel.md` | Post de lancement officiel (profil personnel + page entreprise). |
| `social-media/linkedin/semaine-17-23-aout-2026.md` | 2 posts LinkedIn de la semaine de lancement. |
| `reels/reel-semaine-17-23-aout-2026.md` | Script complet d'un Reel de 30-45s sur le 3e pilier. |
| `strategy/checklist-avant-lancement.md` | Checklist maîtresse en 16 sections avant tout lancement (verrou de phase). |
| `strategy/personas-prioritaires.md` | 4 personas **explicitement fictifs** : Yann, Claire & Marc, Sophie, Léa. |
| `strategy/plan-action-90-jours.md` + `.csv` | Plan d'action complet du 1er août au 29 octobre 2026, tâche par tâche, agent par agent. |
| `strategy/planning-preparation-16-juillet-16-aout-2026.md` | Planning opérationnel de préparation pré-lancement. |
| `strategy/positionnement-legrand-conseils.md` | Positionnement de marque, ton, formulations interdites (rendement garanti, "meilleur produit"...), slogan « Comprendre. Choisir. Protéger. » |
| `strategy/preparation-operationnelle-avant-diffusion.md` | Inventaire de préparation (identité, réseaux, pages, formulaire, mesure, visuels). |
| `strategy/registre-url-et-cta.md` | Registre associant chaque contenu à son URL cible et son UTM (toutes marquées « à confirmer »). |
| `templates/checklist-finale-avant-publication.md`, `templates/content-validation-template.md` | Gabarits réutilisables de validation finale. |
| `landing-pages/`, `partnerships/`, `prompts/`, `seo/` | Dossiers créés mais **vides** (`.gitkeep` seulement) — rien produit sur cette branche. |

### 2.3 `feature/seo-content-factory-v1` — pipeline SEO complet

Descendante directe de `marketing-ai-90-days` (même `CLAUDE.md`, + agent `seo-writer`). Dernier commit `94315fe`, 2026-07-24.

| Fichier | Résumé |
|---|---|
| `marketing-ai/content-calendar/registre-editorial.md` + `.csv` | Premier registre éditorial : cycle de vie en 15 statuts, anti-cannibalisation, interdiction de lier `/comparateur-lamal`. |
| `marketing-ai/strategy/brief-seo-001-changer-caisse-maladie.md` | Brief stratégique (mots-clés, persona, angle) — pas de texte rédigé à ce stade. |
| `marketing-ai/research/sources-seo-001-changer-caisse-maladie.md` | Dossier de sources officielles (Priminfo, LAMal art. 7, ch.ch, OFSP), matrice de confirmation A01–A12. |
| `marketing-ai/outlines/outline-seo-001-changer-caisse-maladie.md` | Plan H1/H2/H3 de l'article. |
| `marketing-ai/seo/articles/seo-001-changer-caisse-maladie-v1/v2/v3.md` | 3 versions successives de l'article SEO. |
| `marketing-ai/reviews/*` (6 fichiers) | Trace complète SEO → conformité → validation humaine ; validation finale accordée par **Antoine Legrand le 24/07/2026**, pour préparation WordPress uniquement, pas publication. |
| `marketing-ai/wordpress/seo-001-v3/*` | Paquet prêt-pour-WordPress (métadonnées Rank Math, fiche de maillage interne, brief image, checklist) — rien publié, URLs réelles à confirmer. |

### 2.4 `feature/marketing-acquisition-consolidation-v1` — deuxième lignée marketing (sans gouvernance)

Diverge de `marketing-ai-90-days` dès le commit pré-marketing commun (`d9fb0a0`) — importe le système marketing **indépendamment**, sans `CLAUDE.md` ni `.claude/settings.json`, avec seulement 11 des 14 agents (absents : `documentation-maintainer`, `migration-reviewer`, `qa-test-reviewer`, `security-reviewer`). Dernier commit `b88c3c2`, 2026-07-25.

| Fichier | Résumé |
|---|---|
| `marketing-ai/content-calendar/registre-editorial-central.csv` + `.md` | **Nouveau registre plus large**, remplaçant celui de `seo-content-factory-v1`, couvrant les 14 contenus tous canaux avec colonnes performance/UTM. |
| `marketing-ai/scripts/validate-editorial-registry.js` | Script Node de validation du registre (colonnes obligatoires, statuts autorisés, interdiction qu'un agent marque « publié » sans validation humaine). |
| `marketing-ai/strategy/identite-et-canaux-officiels.md` | Source de vérité de l'identité de marque : téléphone professionnel confirmé **+41 78 353 96 88**, page LinkedIn entreprise confirmée ; tout le reste marqué « à confirmer humainement ». |

### 2.5 `feature/marketing-source-verification-v1` — vérification stricte des sources

Bâtie sur `marketing-acquisition-consolidation-v1`. Dernier commit `67e6fcb`, 2026-07-28.

| Fichier | Résumé |
|---|---|
| `marketing-ai/compliance/classement-contenus-publiables.md` | Classement final : seuls SOC-LI-001/SOC-LI-002 jugés « Prêts pour validation humaine ». |
| `marketing-ai/compliance/verification-sources-officielles-2026.md` | Vérification stricte : plusieurs contenus classés **« Bloqué — source officielle insuffisante »** (accès direct aux pages officielles bloqué par des erreurs HTTP 403 documentées). |
| `marketing-ai/compliance/revue-conformite-posts-lancement.md`, `revue-conformite-soc-li-003-version-finale.md` | Revues de conformité citant une règle « `CLAUDE.md` § 6quater » — **fichier absent de cette branche** (voir §4). |

### 2.6 `feature/marketing-source-reconciliation-v1` — la version la plus récente (26/08/2026)

Bifurque de `verification-v1` à un point antérieur à sa pointe (commit `3f5acb5`) — **n'inclut pas** les 3 derniers commits de `verification-v1`. Dernier commit `3ad5129`, 2026-08-26 — la branche la plus récente et la plus volumineuse de tout le dépôt.

| Fichier | Résumé |
|---|---|
| `marketing-ai/compliance/revue-conformite-soc-li-005.md` + `-version-finale.md`, `revue-conformite-soc-li-006.md` | Revues de conformité de 2 nouveaux posts LinkedIn. |
| `marketing-ai/compliance/validation-humaine-soc-li-003/005/006.md` | Traces de validation humaine, **débloquant** les contenus que `verification-v1` avait bloqués (voir contradiction §4). |
| `marketing-ai/social-media/linkedin/semaine-10-16-aout-2026.md` | Nouveau post SOC-LI-005 (11/08/2026) : « Je veux juste l'assurance la moins chère ». |
| `marketing-ai/social-media/linkedin/semaine-24-30-aout-2026.md` | Nouveau post SOC-LI-006 (27/08/2026) : « Parfois, le meilleur conseil est de ne rien changer ». |
| `marketing-ai/content-calendar/calendrier-editorial-24-aout-18-octobre-2026.md` + `.csv` | Calendrier étendu jusqu'au 18 octobre 2026. |
| `marketing-ai/strategy/classement-contenus-publiables.md` (mis à jour) | Registre le plus complet à ce jour de « ce qui est prêt à publier » — rien n'est effectivement publié. |

### 2.7 `feature/swiss-insurance-crm` — CLAUDE.md le plus à jour

Descendante directe de `marketing-ai-90-days`, ajoute uniquement du développement CRM (routes/validations LAMal/LCA/Vie). Son `CLAUDE.md` est une **version enrichie** de l'original : ajoute une section §3bis autorisant le développement CRM par lots sur cette branche, sans jamais affaiblir les protections marketing existantes. Aucun contenu marketing nouveau.

### 2.8 Autres branches d'ingénierie (Diagnostic 360 / Acquisition) — résumé synthétique

Une vingtaine de branches (`feature/advisory-*`, `feature/acquisition-*`, `fix/advisory-*`, `fix/dev-vite-csrf-proxy`, `fix/fixed-health-commission-model`, `fix/member-scoped-missing-information`, `integration/*`) documentent le développement lot par lot du module Diagnostic 360 (foyers, sessions, questionnaires, moteur de règles, constats, recommandations, rétention des données) et du module Acquisition (campagnes, attribution, analytics). Ce travail est **du code produit**, pas des documents métier au sens de cet inventaire — largement déjà intégré dans la branche courante. `claude/insurance-broker-crm-exx09v` est désignée dans `PROJECT_HANDOFF.md` comme la branche de production réelle. `assurance-complementaire.html` n'est qu'un pointeur dupliqué vers un ancien commit de fusion (probable erreur de nommage lors d'un push), sans contenu propre.

### 2.9 `site-legrandconseils` — branche `main` (site public réel)

16 fichiers HTML/CSS (blocs Gutenberg « Custom HTML » exportés), dont : `accueil.html`, `a propos.html`, `services.html`, `contact.html` (page statique tel:/mailto:, sans formulaire), `Assurance vie.html` (simulateur 3a/3b), `assurance maladie.html`, `assurance complementaire.html`, `comparateur LAMal.html` (version simple, mailto uniquement), `demarches en ligne.html` et `resiliation.html` (générateurs de documents, mailto uniquement sur cette branche), `changer-caisse-maladie-delais-etapes.html` (article SEO), pages légales (`mention legales.html`, `cookies.html`, `condition d'utilisation.html`, `protection des données.html`, `information sur l'intermediation.html`).

### 2.10 `site-legrandconseils` — `chore/comparateur-lamal-prod-2026.1.2`

Snapshot exact du plugin WordPress réellement en production (sécurisé cette session, voir `PROVENANCE.md` du dossier `wordpress-plugins/legrand-comparateur-lamal/`) : `legrand-comparateur-lamal.php`, template, CSS, JS (tracking d'acquisition complet + intégration CRM), 44 fichiers de primes LAMal officielles OFSP 2026 + `manifest.json`/`communes-regions.json`. Non fusionnée volontairement — c'est un instantané de sauvegarde, pas une branche de développement.

### 2.11 `site-legrandconseils` — `feature/acquisition-tracking-v1` et `feat/demarches-acquisition-tracking-v1`

Ajoutent le tracking d'acquisition (sessionStorage `lc_acquisition_tracking_v1`, 8 champs UTM/`campaign_key`/`gclid`/`fbclid`, formulaire CRM avec consentement) à `comparateur LAMal.html`, `demarches en ligne.html`, `resiliation.html`, et 3 nouvelles pages d'atterrissage (`bilan-prevoyance-3a.html`, `independants-proteger-revenu.html`, `proteger-sa-famille.html`, absentes de `main`). La branche dérivée `feat/demarches-acquisition-tracking-v1` isole uniquement `demarches en ligne.html`, déjà validée en production selon votre confirmation de ce jour.

---

## 3. ANONYMISATION

**Recherche effectuée** : scan systématique (motifs AVS, dates de naissance, noms propres autres qu'« Antoine Legrand », emails, téléphones) sur l'intégralité de `marketing-ai/` (toutes branches), tous les fichiers `docs/`, les fixtures de démonstration du CRM (`server/seed-demo.js`), et l'ensemble des pages HTML de `site-legrandconseils` (toutes branches).

**Résultat : aucune donnée client ou prospect réelle trouvée.**

- Les personas (« Yann », « Claire & Marc », « Sophie », « Léa ») sont **explicitement et systématiquement** étiquetés fictifs dans les documents sources.
- Les scénarios pédagogiques du calendrier étendu (`feature/marketing-source-reconciliation-v1`) portent la mention explicite « Aucun cas fictif n'est présenté comme un cas client réel ».
- Les données de démonstration du CRM (`Julien Moret`, `Sofia Ricci`, `Marc Dubois`...) utilisent des emails `@example.ch` et téléphones placeholder, conformément à la règle documentée du projet (« aucune donnée réelle dans les fixtures »).
- Toute occurrence de « AVS »/« date de naissance » repérée est soit un nom de champ de schéma, soit une explication générique du système suisse — jamais une valeur réelle attribuée à une personne.
- Vos propres coordonnées professionnelles (téléphone **+41 78 353 96 88**, profils LinkedIn, numéros FINMA F01569355/F01569363) apparaissent à plusieurs endroits — non anonymisées puisqu'il s'agit de vos coordonnées professionnelles publiques, pas de données de tiers.

Aucun identifiant `Client-A1` n'a donc été nécessaire. *(Note à vérifier avec vous : cette recherche couvre les fichiers texte/HTML/Markdown lus par les trois explorations ; elle ne couvre pas d'éventuels fichiers binaires — il n'en existe aucun dans les deux dépôts, confirmé par recherche `.pdf/.docx/.xlsx/.pptx/.png/.jpg` sur toutes les branches, qui ne remonte que 3 icônes d'application sans rapport.)*

---

## 4. DOUBLONS ET CONTRADICTIONS À TRANCHER

### 4.1 Deux écosystèmes de gouvernance jamais réconciliés

Le CRM (branche courante) est protégé par 6 agents Diagnostic 360 (`.claude/agents/`), sans aucun `CLAUDE.md`. Le marketing, lui, dépend d'un `CLAUDE.md` + 14 agents qui n'existent que sur `feature/marketing-ai-90-days` et sa descendante `feature/seo-content-factory-v1`. Les deux systèmes ne se recouvrent jamais et n'ont pas de point de rencontre documenté — c'est pourquoi, dans cette session même, les agents marketing ne sont plus disponibles à l'invocation dès que la branche marketing n'est plus celle ouverte.

### 4.2 Une deuxième lignée marketing sans aucune protection

`feature/marketing-acquisition-consolidation-v1` (et ses deux descendantes) réimporte tout le contenu marketing **sans jamais recevoir `CLAUDE.md`, `.claude/settings.json`, ni les 4 agents de contrôle** (documentation, migration, QA, sécurité). Pire : ses propres comptes-rendus de conformité (`revue-conformite-posts-lancement.md`, `verification-sources-officielles-2026.md`) citent une règle interne « `CLAUDE.md` § 6quater » comme contraignante — **alors que ce fichier n'existe pas dans cette branche**. C'est une référence pendante : quiconque relit cette branche seule ne peut pas vérifier la règle qu'elle prétend appliquer. **À trancher : quelle lignée doit devenir la référence unique ?**

### 4.3 Verdicts de conformité contradictoires sur le même contenu

`feature/marketing-source-verification-v1` (28/07/2026) classe plusieurs contenus **« Bloqué — source officielle insuffisante »** (SOC-LI-003, SOC-LI-004, SOC-IG-001/002, SOC-FB-001, SOC-RE-001), l'agent n'ayant pu consulter les pages officielles que via des extraits de moteur de recherche (blocages HTTP 403 documentés). `feature/marketing-source-reconciliation-v1` (26/08/2026), une branche sœur divergente et non fusionnée avec la précédente, **débloque ce même contenu** sur la base d'une lecture des sources que vous avez rapportée avoir faite vous-même, hors de l'environnement de l'agent — lecture que l'agent lui-même ne prétend pas avoir vérifiée. Les deux verdicts existent aujourd'hui en parallèle, sur deux branches distinctes, sans qu'aucune ne l'ait emporté formellement. **À trancher : acceptez-vous votre lecture personnelle des sources officielles comme preuve suffisante, ou faut-il que l'agent parvienne à consulter directement chaque page avant publication ?**

### 4.4 Registre éditorial dupliqué puis remplacé

`feature/seo-content-factory-v1` crée `registre-editorial.md`/`.csv` (SEO uniquement). `feature/marketing-acquisition-consolidation-v1`, en réimportant indépendamment, crée `registre-editorial-central.csv`/`.md` (tous canaux) — un doublon fonctionnel, le second remplaçant de fait le premier sans jamais fusionner avec lui. Pas de contradiction de contenu (les deux lignées ne se recoupent pas dans le temps), mais un doublon structurel à nettoyer si les branches sont un jour réunies.

### 4.5 Aucune contradiction trouvée côté `site-legrandconseils`

Ce dépôt n'a jamais eu de `CLAUDE.md` ni de système d'agents — pas de contradiction de gouvernance possible ici. Le seul point de vigilance (déjà connu et traité cette session) est le décalage entre `main` (comparateur LAMal simple, mailto) et les branches de tracking/le plugin WordPress (architecture bien plus avancée), ce qui n'est pas une contradiction mais un retard de fusion assumé.

---

## 5. CE DOCUMENT

Ce fichier constitue la livraison de l'étape 5 — il est la synthèse maîtresse demandée, à la racine de `crm-legrand-conseils`. Il n'a pas été committé ni poussé ; il reste un fichier de travail local jusqu'à ce que vous décidiez de son sort (le conserver hors Git, le committer sur une branche dédiée, ou autre).

---

## 6. CE QUI MANQUE PAR RAPPORT À UNE ACTIVITÉ DE COURTIER BIEN ORGANISÉE

1. **Aucune fusion réelle** : un mois entier de travail marketing (calendrier, 8+ posts, article SEO, guide, flyer) existe uniquement sur des branches Git non fusionnées. Sans ce inventaire, il aurait pu rester invisible indéfiniment. Il manque un point de convergence unique (une branche "marketing officielle" à jour) plutôt que 5 lignées parallèles.
2. **Aucune publication effective à ce jour** : tout est validé "prêt" mais rien n'est publié sur les réseaux réels — il manque la dernière étape manuelle (ou une décision explicite de ne pas publier certains éléments).
3. **Pas de stratégie Meta Ads/publicité payante** : recherche explicite effectuée dans tout `marketing-ai/` (toutes branches) — zéro mention de Meta Ads, Facebook Ads ou publicité payante. Seule trace : le CRM sait techniquement capter un `fbclid` (clic publicitaire Facebook) si une campagne existait, mais aucune campagne, aucun budget, aucune créature publicitaire n'a été préparée.
4. **Pas de CV ni de documents de présentation professionnelle** (type plaquette commerciale, book, dossier de présentation à remettre en rendez-vous) — recherché explicitement, aucun trouvé sur les deux dépôts.
5. **Pas de comparatifs ou tableaux au format bureautique** (Excel, PDF) — tout le contenu comparatif existe uniquement en Markdown/HTML dans les dépôts ; rien d'imprimable en l'état pour un rendez-vous client hors ligne, à part le concept de flyer (jamais mis en forme graphique finale).
6. **Pas de suivi de performance réel** : l'agent `performance-analyst` et le cadre KPI existent, mais aucune donnée réelle (GA4, réseaux sociaux) n'a encore été fournie pour les alimenter — normal à ce stade puisque rien n'est publié, mais à anticiper.
7. **La branche de production du CRM (`claude/insurance-broker-crm-exx09v`) et la branche marketing la plus aboutie (`feature/marketing-source-reconciliation-v1`) n'ont jamais été réunies** : le CRM qui recevra les vrais leads et le contenu marketing qui doit les générer vivent dans deux univers Git séparés qui ne se sont jamais parlé.
8. **Pas de calendrier de contenu au-delà du 18 octobre 2026** : le plan 90 jours s'arrête à cette date ; rien n'est préparé pour la suite.
9. **La gouvernance marketing (`CLAUDE.md`, agents de contrôle) n'existe que sur une partie des branches** (§4.2) — un futur travail sur les branches non protégées se ferait sans les garde-fous nLPD/LSA/FINMA que vous avez pourtant définis.
