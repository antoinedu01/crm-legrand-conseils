# Vérification des sources officielles — 2026

> Rédigé le 25/07/2026 dans le cadre de `feature/marketing-source-verification-v1`.
> **Ce document n'est ni un avis juridique, ni une validation ou certification
> FINMA.** C'est un contrôle interne prudentiel destiné à préparer la décision
> humaine. Hiérarchie des sources appliquée : Fedlex > OFSP/bag.admin.ch >
> OFAS/bsv.admin.ch > FINMA > AFC/estv.admin.ch > ch.ch > sites cantonaux >
> pages d'assureurs (pour leur propre produit uniquement). Aucun blog
> commercial, média, comparateur, forum, Wikipédia, contenu de courtier ou
> extrait de moteur de recherche non ouvert n'a été retenu comme validation.

---

## 0. Problème d'accès constaté — à lire avant les fiches FACT-XXX

**Constat central de cette mission : l'outil de consultation directe de pages
web (`WebFetch`) retourne une erreur HTTP 403 sur la quasi-totalité des sites
testés dans cet environnement, y compris des sites sans rapport avec
l'administration suisse.**

### Tentatives effectuées (25/07/2026)

| # | URL testée | Domaine | Résultat |
|---|---|---|---|
| 1 | `ch.ch/fr/retraite/prevoyance-vieillesse/prevoyance-privee-3e-pilier/` | ch.ch | HTTP 403 |
| 2 | `ch.ch/fr/assurances/assurance-maladie/conclure-une-assurance-maladie/` | ch.ch | HTTP 403 |
| 3 | `priminfo.admin.ch/fr/zahlen-und-fakten/wechsel` | priminfo.admin.ch | HTTP 403 |
| 4 | `priminfo.admin.ch/fr/faq` | priminfo.admin.ch | HTTP 403 |
| 5 | `fedlex.admin.ch/eli/cc/1995/1328_1328_1328/fr` (LAMal) | fedlex.admin.ch | HTTP 403 |
| 6 | `bag.admin.ch/fr/primes-et-couts-reponses-aux-questions-frequentes` | bag.admin.ch | HTTP 403 |
| 7 | `finma.ch/fr/autorisation/intermediaires-dassurance/registre-des-intermediaires-dassurance/` | finma.ch | HTTP 403 |
| 8 | `bag.admin.ch/dam/.../faktenblatt-2025-wechsel-kv-info.pdf` (fiche officielle OFSP) | bag.admin.ch (PDF) | HTTP 403 |
| 9 | `bag.admin.ch/dam/.../PG26-FB-Versichererwechsel_FR.pdf` (fiche officielle OFSP) | bag.admin.ch (PDF) | HTTP 403 |
| 10 | `priminfo.admin.ch/downloads/08_Resiliation...pdf` (fiche officielle Priminfo) | priminfo.admin.ch (PDF) | HTTP 403 |
| 11 | `bsv.admin.ch/bsv/fr/home.html` | bsv.admin.ch | HTTP 403 |
| 12 | `estv.admin.ch/estv/fr/home.html` | estv.admin.ch | HTTP 403 |
| 13 | `vd.ch` (site cantonal, page d'accueil) | vd.ch | HTTP 403 |
| 14 | `wikipedia.org` (site de contrôle, sans rapport) | wikipedia.org | HTTP 403 |
| 15 | `example.com` (site de contrôle, sans rapport) | example.com | HTTP 403 |
| 16 | `raw.githubusercontent.com/.../README.md` (site de contrôle) | github (allowlisté) | **Réussi** |

**Interprétation** : la réussite du test de contrôle n°16 (domaine technique
généralement autorisé dans les environnements Claude Code) et l'échec
systématique de tous les autres domaines — y compris deux sites de contrôle
totalement étrangers à l'administration suisse (Wikipédia, example.com) —
montrent qu'il ne s'agit **pas** d'un blocage spécifique aux sites
administratifs suisses, mais d'une **restriction d'accès au niveau de
l'environnement d'exécution de cette session**, qui limite `WebFetch` à un
périmètre de domaines restreint n'incluant pas les sites publics généraux.
Conformément à `/root/.ccr/README.md` (« 403/407 : ne pas retenter, signaler
l'hôte bloqué »), ces échecs n'ont pas été retentés au-delà de ce qui est
listé ci-dessus.

### Conséquence méthodologique, appliquée strictement dans ce document

- **`WebSearch` reste utilisable** (il fonctionne dans cet environnement) mais
  **un extrait de recherche n'est jamais traité comme une validation**,
  conformément à la règle impérative du mandat. Les extraits obtenus via
  `WebSearch` sont mentionnés à titre indicatif uniquement lorsqu'ils
  permettent d'identifier l'existence d'une page officielle, jamais comme
  preuve du contenu de cette page.
- Toute affirmation dont la **seule** preuve disponible est un extrait de
  recherche (jamais une page officielle réellement ouverte, par un humain ou
  par un outil) est classée **`Bloqué — source officielle insuffisante`**,
  conformément au § 10 du mandat.
- Deux jeux d'affirmations disposent en revanche d'une preuve **différente
  d'un extrait de recherche**, et restent donc validées sur cette base :
  1. Le **statut FINMA de Legrand Conseils Sàrl** (n° F01569363 / F01569355) :
     preuve = **documents officiels transmis directement par Antoine Legrand
     le 17/07/2026** — preuve de premier rang, indépendante de tout accès web.
  2. Les affirmations **A01 à A06, A10 et A11 de SEO-001** : preuve =
     **lot de six sources (S01-S06) explicitement vérifié humainement le
     23/07/2026** (`marketing-ai/research/sources-seo-001-changer-caisse-maladie.md`),
     et pour A05 spécifiquement, une **vérification manuelle externe
     documentée le 24/07/2026** — ces deux vérifications constituent une
     lecture humaine réelle des sources, pas un extrait de moteur de
     recherche, et satisfont donc l'exigence du mandat.
- Toutes les autres affirmations (3e pilier structurel, 3a/3b, indépendants,
  nouveau-né, obligations générales FINMA, A07/A08/A09/A12 de SEO-001) n'ont
  **jamais** été lues intégralement par personne à ce jour (ni par un humain,
  ni par un outil) : elles restent **`Bloqué — source officielle
  insuffisante`**.

---

## 1. Inventaire — 8.1 Système suisse de prévoyance (3e pilier)

### FACT-001 — Le système suisse repose sur trois piliers (AVS étatique, LPP professionnel, 3e pilier privé et facultatif)
- **Contenus concernés** : `marketing-ai/lead-magnets/guide-pratique-3e-pilier.md` (§1), `marketing-ai/social-media/reels/reel-semaine-17-23-aout-2026.md` (script), `marketing-ai/social-media/instagram/semaine-17-23-aout-2026.md` (carrousel)
- **Registre** : SOC-RE-001, SOC-IG-001
- **Sensibilité** : Prévoyance
- **Risque en cas d'erreur** : Modéré — affirmation structurelle largement stable dans le temps, mais toute erreur nuit à la crédibilité pédagogique
- **Autorité recherchée** : ch.ch / OFAS (bsv.admin.ch)
- **Titre exact de la page ou du document** : non consulté
- **URL officielle** : `ch.ch/fr/retraite/prevoyance-vieillesse/comment-fonctionne-la-prevoyance-vieillesse/` (identifiée par extrait de recherche uniquement, jamais ouverte)
- **Date de consultation** : sans objet (page non ouverte)
- **Passage utile** : sans objet
- **Interprétation prudente** : le principe des trois piliers est un fait de notoriété administrative très largement documenté, mais le mandat interdit explicitement de valider une affirmation à partir d'un extrait de recherche
- **Verdict** : **Bloqué — source officielle insuffisante**
- **Correction nécessaire** : aucune (le contenu reste en No-Go pour cette affirmation ; le texte n'est pas modifié faute de preuve d'erreur)

### FACT-002 — Distinction entre le pilier 3a (« lié ») et le pilier 3b (« libre »)
- **Contenus concernés** : `guide-pratique-3e-pilier.md` (§3-5), `social-media/linkedin/semaine-17-23-aout-2026.md` (Publication 1, 17/08), `social-media/instagram/semaine-17-23-aout-2026.md` (carrousel, slides 3 et 5), `social-media/reels/reel-semaine-17-23-aout-2026.md`, `social-media/instagram/stories-17-23-aout-2026.md` (séquence 2)
- **Registre** : SOC-LI-003, SOC-IG-001, SOC-IG-002, SOC-RE-001
- **Sensibilité** : Prévoyance / Fiscal
- **Risque en cas d'erreur** : Élevé — terminologie juridique précise, reprise sur 4 canaux dès la semaine de lancement
- **Autorité recherchée** : ch.ch / Fedlex (LPP art. 82, OPP 3) / AFC
- **Titre exact** : non consulté
- **URL officielle** : `ch.ch/fr/retraite/prevoyance-vieillesse/prevoyance-privee-3e-pilier/` (identifiée, jamais ouverte — tentative WebFetch n°1, HTTP 403)
- **Date de consultation** : sans objet
- **Passage utile** : sans objet
- **Interprétation prudente** : la distinction « lié / libre » est reprise de manière constante et cohérente dans tous les contenus existants (aucune contradiction interne relevée), mais elle repose sur un extrait de recherche du 16/07/2026, jamais confirmé par une lecture intégrale
- **Verdict** : **Bloqué — source officielle insuffisante**
- **Correction nécessaire** : aucune à ce stade

### FACT-003 — Le 3a bénéficie d'un « traitement fiscal particulier » (cotisations déductibles), sans indication de plafond ni de montant
- **Contenus concernés** : `guide-pratique-3e-pilier.md` (§3), `linkedin/semaine-17-23-aout-2026.md` (Publication 1), `reels/reel-semaine-17-23-aout-2026.md`
- **Registre** : SOC-LI-003, SOC-RE-001
- **Sensibilité** : Fiscal
- **Risque en cas d'erreur** : Élevé (sujet fiscal), atténué par l'absence volontaire de tout chiffre
- **Autorité recherchée** : AFC (estv.admin.ch) / Fedlex OPP 3
- **URL officielle** : non identifiée avec certitude, non ouverte
- **Verdict** : **Bloqué — source officielle insuffisante**
- **Correction nécessaire** : aucune (l'absence de chiffre dans les contenus existants limite déjà le risque)

### FACT-004 — Le retrait anticipé du 3a est encadré par des conditions légales (sans détail des conditions)
- **Contenus concernés** : `guide-pratique-3e-pilier.md` (§3)
- **Sensibilité** : Prévoyance / Fiscal
- **Risque en cas d'erreur** : Modéré
- **Autorité recherchée** : Fedlex (OPP 3, art. 3)
- **Verdict** : **Bloqué — source officielle insuffisante**

### FACT-005 — Le cadre fiscal du 3b est « différent » de celui du 3a (mention générale, sans chiffre, sans affirmer un désavantage ou un avantage)
- **Contenus concernés** : `guide-pratique-3e-pilier.md` (§4)
- **Sensibilité** : Fiscal
- **Risque en cas d'erreur** : Élevé
- **Autorité recherchée** : AFC
- **Verdict** : **Bloqué — source officielle insuffisante**
- **Note de prudence supplémentaire** : le guide utilise déjà la formulation la plus prudente possible sur ce point (« son cadre fiscal diffère de celui du 3a », sans détail) ; aucune généralisation supplémentaire n'est nécessaire

---

## 2. Inventaire — 8.2 Indépendants et protection du revenu

### FACT-006 — « L'indépendant ne bénéficie pas automatiquement de toutes les mêmes protections qu'un salarié » (prévoyance professionnelle facultative, couverture perte de gain non automatique)
- **Contenus concernés** : `social-media/linkedin/semaine-17-23-aout-2026.md` (Publication 2, 20/08)
- **Registre** : SOC-LI-004
- **Sensibilité** : Prévoyance / Assurance
- **Risque en cas d'erreur** : Élevé — généralisation sur une catégorie entière de personnes (« les indépendants »), risque explicitement signalé par le mandat (§8.2)
- **Autorité recherchée** : OFAS (bsv.admin.ch) / Fedlex (LPP art. 4 al. 3 — affiliation facultative des indépendants ; LAA art. 4 — assurance-accidents facultative pour les indépendants)
- **URL officielle** : non identifiée avec certitude, non ouverte
- **Verdict** : **Bloqué — source officielle insuffisante**
- **Correction nécessaire** : Aucune correction textuelle déclenchée par ce verdict au sens strict du § 11 du mandat (qui ne s'applique qu'aux verdicts « Confirmé avec reformulation » et « Contredit »). **Observation transmise séparément** (voir `classement-contenus-publiables.md`) : le texte actuel (« l'indépendant ne bénéficie pas automatiquement de toutes les mêmes protections ») est déjà prudent (il n'affirme pas une règle absolue), mais gagnerait, lors d'une validation humaine, à rappeler explicitement que la situation varie d'un indépendant à l'autre — cette observation est une recommandation, pas une correction appliquée dans cette mission.

---

## 3. Inventaire — 8.3 Nouveau-né et assurance-maladie

### FACT-007 — Modalités et délai d'affiliation d'un nouveau-né à l'assurance-maladie de base, effet rétroactif éventuel
- **Contenus concernés** : `social-media/facebook/semaine-17-23-aout-2026.md`
- **Registre** : SOC-FB-001
- **Sensibilité** : Assurance-maladie
- **Risque en cas d'erreur** : Élevé — sujet familial sensible, jamais vérifié depuis sa rédaction (16/07/2026)
- **Autorité recherchée** : OFSP (bag.admin.ch) / Fedlex (LAMal art. 3)
- **URL officielle** : non identifiée avec certitude, non ouverte
- **Verdict** : **Bloqué — source officielle insuffisante**
- **Note** : le post lui-même **n'affirme aucune modalité ni aucun délai précis** — il se limite à recommander de « vérifier que tout est bien en ordre dès le départ » pour la couverture maladie du nouveau-né, sans détail chiffré. Le risque résiduel est donc **limité à l'absence de vérification**, pas à une affirmation erronée déjà publiée.

---

## 4. Inventaire — 8.4 Intermédiation et FINMA

### FACT-008 — Statut « intermédiaire d'assurance non lié » de Legrand Conseils Sàrl et d'Antoine Legrand ; numéros de registre FINMA F01569363 (société) et F01569355 (dirigeant) ; branches inscrites (assurance-maladie complémentaire, assurance-vie) ; 1ʳᵉ inscription le 22/06/2026 ; UID CHE-376.900.357
- **Contenus concernés** : `flyers/flyer-bilan-assurances-prevoyance.md`, `lead-magnets/guide-pratique-3e-pilier.md` (§10), `strategy/positionnement-legrand-conseils.md`, `social-media/linkedin/post-lancement-officiel.md` (v1 et v2), `social-media/checklist-creation-pages-linkedin-facebook.md`
- **Registre** : SOC-LI-001, SOC-LI-002
- **Sensibilité** : FINMA
- **Risque en cas d'erreur** : Critique
- **Autorité** : FINMA
- **Titre exact de la page ou du document** : documents officiels d'inscription au registre FINMA (transmis directement par le dirigeant, hors dépôt Git, non consultables par cette mission)
- **URL officielle** : sans objet (preuve documentaire directe, pas une page web)
- **Date de consultation** : 17/07/2026 (par le dirigeant, avant cette mission)
- **Date de mise à jour affichée** : 1ʳᵉ inscription déclarée le 22/06/2026
- **Passage utile** : « société Legrand conseils Sàrl, n° F01569363, et Antoine Legrand, n° F01569355 — tous deux intermédiaires d'assurance non liés, 1ʳᵉ inscription le 22/06/2026, branches assurance-maladie complémentaire et assurance-vie, UID CHE-376.900.357 »
- **Interprétation prudente** : ce que confirment les documents = l'inscription et son périmètre exact ; ce qui reste une interprétation = aucune, la portée exacte est déjà fixée par une règle interne (`CLAUDE.md` § 6quater) qui découle directement de ces documents ; ce qui ne peut pas être affirmé = que cette inscription équivaut à un agrément général ou à une autorisation pour la LAMal obligatoire
- **Verdict** : **Confirmé** (preuve de premier rang, non issue du web — conformément à la consigne du mandat, **les numéros FINMA ne sont pas modifiés**, aucune source officielle directement consultée ne contredit ces numéros)
- **Correction nécessaire** : aucune

### FACT-009 — Portée exacte de l'inscription FINMA (ce n'est pas une autorisation générale, ni un agrément pour la LAMal obligatoire) et formulation officielle à employer
- **Contenus concernés** : tous les contenus mentionnant le statut FINMA
- **Sensibilité** : FINMA
- **Risque en cas d'erreur** : Élevé
- **Autorité recherchée** : finma.ch (registre public, définition légale LSA de l'intermédiaire non lié)
- **URL officielle** : `finma.ch/fr/autorisation/intermediaires-dassurance/registre-des-intermediaires-dassurance/` (tentative WebFetch n°7, HTTP 403)
- **Verdict** : **Bloqué — source officielle insuffisante** pour une nouvelle confirmation externe de la définition légale générale. **Observation** : la règle interne déjà en vigueur (`CLAUDE.md` § 6quater, non modifiable dans le périmètre de cette mission) découle directement des documents officiels du FACT-008 et n'a pas été contredite par les contenus vérifiés — aucune occurrence de « approuvé/certifié/conforme FINMA » n'a été trouvée dans les contenus existants.

### FACT-010 — Obligations générales d'un intermédiaire non lié (compétences, RC professionnelle, obligation d'annonce)
- **Contenus concernés** : mentionné uniquement dans `marketing-ai/compliance/sources-officielles-a-verifier.md` (contexte du statut), **aucun contenu public** ne reprend cette affirmation directement
- **Sensibilité** : FINMA
- **Risque en cas d'erreur** : Faible (pas de reprise dans un contenu public)
- **Autorité recherchée** : finma.ch / LSA
- **Verdict** : **Bloqué — source officielle insuffisante**
- **Correction nécessaire** : aucune (aucun contenu public concerné)

### Point distinct — « Je compare plusieurs assureurs, car je ne suis lié à aucun » (formulation des posts de lancement)
Ce point n'est **pas** traité comme un FACT-XXX au sens de ce document : il ne
s'agit pas d'une affirmation vérifiable auprès d'une autorité publique, mais
d'un **fait relatif à la pratique commerciale propre de Legrand Conseils
Sàrl** (le nombre réel de compagnies avec lesquelles Antoine Legrand travaille
effectivement), que seul le dirigeant peut attester. Il est analysé dans la
revue de conformité dédiée aux deux posts de lancement — voir
`marketing-ai/compliance/revue-conformite-posts-lancement.md` § « Analyse
FINMA / comparaison du marché ».

---

## 5. Inventaire — 8.5 Changement de caisse maladie (SEO-001)

> Relecture du dossier `marketing-ai/research/sources-seo-001-changer-caisse-maladie.md`
> (lot S01-S06, vérifié humainement le 23/07/2026) et de l'article
> `marketing-ai/seo/articles/seo-001-changer-caisse-maladie-v3.md`. **Aucune
> régression du statut de SEO-001 n'est appliquée** : aucune erreur ni aucune
> évolution officielle contredisant le contenu actuel n'a été constatée — la
> seule limite constatée est l'impossibilité, pour cette mission, de lire
> personnellement les pages primaires (WebFetch bloqué), ce qui n'est pas une
> preuve d'erreur.

### FACT-012 — A01 : principe général de libre choix de l'assureur pour l'assurance obligatoire des soins
- **Contenus concernés** : `seo/articles/seo-001-changer-caisse-maladie-v3.md`, `wordpress/seo-001-v3/contenu-public-wordpress.md`
- **Registre** : SEO-001
- **Sensibilité** : Assurance-maladie / Juridique
- **Risque en cas d'erreur** : Élevé
- **Autorité** : Fedlex (LAMal, RS 832.10) + ch.ch
- **Titre exact** : « Loi fédérale sur l'assurance-maladie (LAMal) », art. 7 (S03) ; ch.ch, page de résiliation/changement (S04)
- **URL officielle** : `fedlex.admin.ch/eli/cc/1995/1328_1328_1328/fr` ; `ch.ch/fr/assurances/assurance-maladie/conclure-une-assurance-maladie/`
- **Date de consultation** : 23/07/2026, par vérification humaine directe (lot S01-S06), non par cette mission
- **Passage utile** : cf. §6 du dossier de recherche — « Le changement d'assurance de base est possible pour le 1er janvier »
- **Interprétation prudente** : ce que dit la source = principe général de libre choix encadré par la loi ; ce qui reste une interprétation = aucune ; ce qui ne peut pas être affirmé = une garantie d'acceptation par le nouvel assureur (non couvert)
- **Verdict** : **Confirmé** (base : vérification humaine directe du 23/07/2026)
- **Correction nécessaire** : aucune

### FACT-013 — A02 : délai de réception de la résiliation au plus tard le 30 novembre pour un changement au 1er janvier ; communication de la nouvelle prime par l'assureur au plus tard le 31 octobre
- **Registre** : SEO-001
- **Sensibilité** : Assurance-maladie
- **Risque en cas d'erreur** : Élevé (délai précis, déjà publié dans le contenu v3)
- **Autorité** : OFSP/Priminfo (S01, S02, S05)
- **Verdict** : **Confirmé** (vérification humaine directe du 23/07/2026)
- **Correction nécessaire** : aucune

### FACT-014 — A03 : c'est la date de réception par l'assureur qui est déterminante, pas la date d'envoi ni le cachet postal
- **Registre** : SEO-001
- **Sensibilité** : Assurance-maladie
- **Risque en cas d'erreur** : Élevé
- **Autorité** : OFSP/Priminfo (S01, S02)
- **Verdict** : **Confirmé**
- **Correction nécessaire** : aucune

### FACT-015 — A04 : une forme particulière d'assurance (modèle, franchise) n'empêche pas en elle-même le changement au 1er janvier
- **Registre** : SEO-001
- **Sensibilité** : Assurance-maladie
- **Risque en cas d'erreur** : Modéré
- **Autorité** : OFSP (S05)
- **Verdict** : **Confirmé** — la source elle-même comporte une limite (ne pas généraliser aux résiliations en cours d'année ni aux autres cas particuliers de l'art. 7 LAMal) ; cette limite est déjà respectée par la formulation actuelle de l'article v3, aucune reformulation n'est donc nécessaire
- **Correction nécessaire** : aucune (la nuance est déjà présente dans le texte actuel)

### FACT-016 — A05 : primes/participations aux coûts impayées au 31 décembre (avec rappel reçu au plus tard le 30 novembre) → changement en principe impossible ; sans ce rappel, le changement reste possible
- **Registre** : SEO-001
- **Sensibilité** : Assurance-maladie / Juridique
- **Risque en cas d'erreur** : Élevé (règle précise, déjà publiée dans le texte v3)
- **Autorité** : OFSP/Priminfo (S01, S02) + vérification manuelle externe du 24/07/2026 (S06 conservée comme contexte de procédure générale)
- **Verdict** : **Confirmé** — la règle générale est confirmée par S01/S02 ; la formulation actuelle renvoie déjà systématiquement vers une vérification individuelle pour les cas contestés, récents ou particuliers, aucune reformulation n'est donc nécessaire
- **Correction nécessaire** : aucune

### FACT-017 — A06 : inscription en parallèle auprès du nouvel assureur, sans attendre la confirmation de résiliation de l'ancien
- **Registre** : SEO-001
- **Sensibilité** : Assurance-maladie
- **Risque en cas d'erreur** : Modéré
- **Autorité** : OFSP/Priminfo (S01)
- **Verdict** : **Confirmé**
- **Correction nécessaire** : aucune

### FACT-018 — A10 : documents à conserver (copie de résiliation, preuve d'envoi, preuve de réception, confirmation d'affiliation) présentés comme précaution pratique, non comme liste légale exhaustive
- **Registre** : SEO-001
- **Sensibilité** : Assurance-maladie
- **Risque en cas d'erreur** : Faible à modéré
- **Autorité** : OFSP/Priminfo (S01, S02)
- **Verdict** : **Confirmé** — présenté comme précaution pratique et non comme liste légale exhaustive, conformément à la source ; la formulation actuelle respecte déjà cette limite
- **Correction nécessaire** : aucune

### FACT-019 — A11 : envoi recommandé/A Plus avant la mi-novembre = recommandation pratique de l'OFSP, distincte du délai légal (qui porte sur la réception)
- **Registre** : SEO-001
- **Sensibilité** : Assurance-maladie
- **Risque en cas d'erreur** : Modéré
- **Autorité** : OFSP/Priminfo (S01)
- **Verdict** : **Confirmé** — recommandation pratique distincte du délai légal, distinction déjà respectée par la formulation actuelle
- **Correction nécessaire** : aucune

### FACT-020 — A07 : distinction juridique complète entre la LAMal (assurance obligatoire) et la LCA (assurances complémentaires, contrat de droit privé)
- **Registre** : SEO-001
- **Sensibilité** : Juridique / Assurance-maladie
- **Risque en cas d'erreur** : Élevé
- **Autorité recherchée** : Fedlex (LCA/VVG, RS 221.229.1) + OFSP
- **URL officielle** : non identifiée avec certitude, non ouverte
- **Verdict** : **Bloqué — source officielle insuffisante** (statut inchangé depuis le dossier du 23/07/2026 : déjà « à vérifier manuellement », faute d'accès aucune amélioration possible dans cette mission)
- **Correction nécessaire** : aucune — le texte v3 traite déjà ce point avec prudence (renvoi systématique à une vérification séparée, aucune affirmation détaillée sur la LCA)

### FACT-021 — A08 : la résiliation de l'assurance de base (LAMal) n'entraîne pas automatiquement celle des complémentaires (LCA)
- **Registre** : SEO-001
- **Sensibilité** : Assurance-maladie
- **Risque en cas d'erreur** : Élevé
- **Autorité recherchée** : OFSP / Fedlex LCA
- **Verdict** : **Bloqué — source officielle insuffisante**
- **Correction nécessaire** : aucune — le texte v3 est déjà formulé avec la prudence requise (« ne doit pas être présumée suivre automatiquement… ce point n'est pas traité de façon exhaustive ici »)

### FACT-022 — A09 : les assurances complémentaires peuvent être soumises à une sélection ou un questionnaire médical propre à chaque assureur
- **Registre** : SEO-001
- **Sensibilité** : Assurance-maladie / Données de santé
- **Risque en cas d'erreur** : Élevé
- **Autorité recherchée** : Fedlex LCA (réticence, art. 4 ss) + OFSP
- **Verdict** : **Bloqué — source officielle insuffisante**
- **Correction nécessaire** : aucune — le texte v3 reste général et renvoie explicitement à une vérification individuelle, sans détailler de règle

### FACT-023 — A12 : exceptions et cas particuliers de l'article 7 LAMal non détaillés dans le contenu
- **Registre** : SEO-001
- **Sensibilité** : Juridique
- **Risque en cas d'erreur** : Modéré (le texte ne détaille volontairement aucune exception)
- **Autorité recherchée** : Fedlex (texte intégral de l'art. 7 LAMal et de ses dispositions d'application)
- **Verdict** : **Bloqué — source officielle insuffisante**
- **Correction nécessaire** : aucune — le contenu v3 renvoie systématiquement ces cas vers une vérification individuelle sans les détailler

---

## 6. Synthèse chiffrée

| Verdict | Nombre de FACT-XXX |
|---|---|
| Confirmé | 9 (FACT-008, 012, 013, 014, 015, 016, 017, 018, 019) |
| Confirmé avec reformulation | 0 |
| Non confirmé | 0 |
| Contredit | 0 |
| Bloqué — source officielle insuffisante | 14 (FACT-001 à 007, 009, 010, 020 à 023) |
| **Total inventorié** | **23** |

Aucune affirmation existante n'a été trouvée **contredite** par une source
officielle, et aucune n'a nécessité de **reformulation** : les affirmations
« Confirmé » l'ont été telles qu'actuellement rédigées, y compris celles
portant une nuance (A04, A05, A10, A11), déjà correctement formulées dans les
contenus existants. La limite rencontrée par cette mission est un **problème
d'accès technique** (§0), pas la découverte d'erreurs factuelles. **Aucune
correction de texte n'a donc été appliquée** aux contenus sociaux, lead
magnets, flyers ou à l'article SEO-001 dans le cadre de cette mission (voir
`classement-contenus-publiables.md` pour le détail par contenu).
