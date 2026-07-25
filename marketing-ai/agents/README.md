# Agents marketing — tableau récapitulatif

Documentation de référence des **onze agents** de la phase marketing et SEO. Les
définitions **exécutables** se trouvent dans `../../.claude/agents/` ; ce fichier
en est la notice lisible.

> Règles communes à **tous** les agents : écriture limitée à `marketing-ai/` ;
> interdiction de modifier le CRM (`server/`, `client/`, `data/`) ; interdiction
> d'utiliser Git ; interdiction de publier, d'envoyer ou de contacter un prospect ;
> aucune promesse garantie (économie, rendement, acceptation, « meilleur produit ») ;
> **aucun agent ne peut accéder aux données clients réelles** ; **aucun agent ne
> peut modifier le CRM** ; **aucun agent ne peut publier** un contenu, sous quelque
> forme que ce soit (réseau social, site, WordPress, e-mail).

> **`compliance-reviewer` ne valide jamais humainement un contenu.** Son rapport
> prépare la décision (`Prêt pour validation humaine` / `À corriger`), mais la
> validation finale — au sens de la mise en circulation d'un contenu — reste
> **toujours** une décision humaine, nommée et datée, jamais produite par un agent.

| # | Agent | Rôle | Écrit dans | Limites clés |
|---|---|---|---|---|
| 1 | **marketing-director** | Coordonne la stratégie et délègue aux autres agents | `strategy/`, `content-calendar/`, `marketing-ai/**` | Ne contourne pas les limites des autres ; ne publie rien ; pas de Git ; portée de l'outil `Task` documentée dans sa propre fiche (voir `../../.claude/agents/marketing-director.md` § « Agents autorisés via Task ») |
| 2 | **compliance-reviewer** | Contrôle conformité nLPD/LSA des brouillons | `compliance/` uniquement | Lecture seule ailleurs ; pas un avis juridique ; pas de Git ; **ne valide jamais humainement** |
| 3 | **content-strategist** | Définit piliers éditoriaux et calendrier | `strategy/`, `content-calendar/` | Affirmations sensibles → vérification humaine ; pas de publication |
| 4 | **linkedin-writer** | Rédige des brouillons de posts LinkedIn | `social-media/linkedin/` | Ne publie jamais ; pas de contact prospect |
| 5 | **social-media-manager** | Brouillons Instagram/Facebook/Reels + cohérence | `social-media/*`, `content-calendar/` | Ne publie ni ne programme ; pas de contact prospect |
| 6 | **visual-flyer-director** | Concepts et briefs de flyers/visuels (texte) | `flyers/` | Pas d'images finales ; n'imprime/ne publie rien |
| 7 | **seo-strategist** | **Stratégie SEO** : brief, mots-clés, intention de recherche, maillage interne, structure de silo, **revue SEO technique** (Hn, longueur de titre, maillage) des brouillons produits par `seo-writer` | `seo/` (hors `seo/articles/`) | Recherche web OK (WebSearch/WebFetch) ; **jamais** de scraping de données personnelles ; ne rédige pas le corps de l'article lui-même |
| 8 | **seo-writer** | **Rédaction SEO** : transforme un brief déjà validé par `content-strategist`/`seo-strategist` en brouillon d'article complet | `seo/articles/` uniquement | Ne choisit **jamais** seul le sujet, le mot-clé, la priorité, la structure stratégique ni les règles réglementaires applicables — ces décisions appartiennent au brief reçu ; aucun accès Bash, Git, WebSearch ni WebFetch ; s'arrête et signale le blocage si une affirmation sensible n'est pas vérifiable avec les éléments du brief |
| 9 | **lead-magnet-creator** | Guides, check-lists, comparatifs | `lead-magnets/` | Aucune donnée médicale sensible ; pas de collecte automatisée |
| 10 | **conversion-funnel-designer** | Maquettes de landing pages et funnels | `landing-pages/` | Aucun envoi/contact auto ; consentement nLPD requis dans les maquettes |
| 11 | **performance-analyst** | Analyse des données de performance fournies | `analytics/` uniquement | Lecture seule ailleurs ; jamais d'accès aux données clients réelles |

## `seo-strategist` vs `seo-writer` — pourquoi deux agents distincts

Ces deux agents se partagent le travail SEO selon une séparation stricte des
responsabilités, volontairement cloisonnée :

- **`seo-strategist` définit** : il choisit le mot-clé principal, l'intention de
  recherche, la structure du silo, le maillage interne recommandé, la priorité du
  contenu, et réalise ensuite la **QA SEO technique** (structure Hn, longueur des
  titres, maillage, absence de cannibalisation) sur le brouillon produit par
  `seo-writer`. Il ne rédige pas le corps de l'article.
- **`seo-writer` rédige** : il transforme un brief déjà produit et validé en amont
  (par `content-strategist`, avec les éléments techniques de `seo-strategist`) en
  un brouillon Markdown complet. Il n'a **aucune autonomie stratégique** : pas de
  choix de sujet, de mot-clé ou de règle réglementaire ; pas de recherche web ;
  pas de Git ; pas de Bash. S'il constate qu'une information nécessaire au brief
  manque, il ne l'invente pas : il rédige ce qui peut l'être et signale
  explicitement le manque dans le brouillon.

Le circuit complet reste : `content-strategist` (brief) → `seo-writer`
(rédaction) → `seo-strategist` (QA SEO) → `compliance-reviewer` (conformité) →
**validation humaine** → publication manuelle éventuelle. Aucune étape ne peut
être court-circuitée par un agent.

## Limite technique actuelle des permissions

> Section ajoutée lors de la consolidation (`feature/marketing-acquisition-consolidation-v1`).
> À lire avant de considérer les limites ci-dessus comme des garanties techniques.

Les restrictions de sous-dossiers indiquées dans le tableau ci-dessus (« Écrit
dans ») et dans le corps de chaque fiche d'agent (`../../.claude/agents/*.md`,
section « Écriture autorisée ») sont **principalement documentaires**. Elles
décrivent le comportement attendu de chaque agent et sont respectées par la
prose de chaque fiche, mais **elles ne sont pas toutes techniquement imposées**
par `.claude/settings.json`.

Concrètement, à ce jour :

- `.claude/settings.json` (lorsqu'il est présent sur une branche donnée) bloque
  techniquement, en écriture, uniquement : `server/**`, `client/**`, `data/**`,
  `package.json`, `package-lock.json`, `deploy/**`, `**/install.sh`. C'est la
  **seule** zone dont l'interdiction d'écriture est réellement garantie par la
  configuration, indépendamment du comportement du modèle.
- Rien dans `.claude/settings.json` n'empêche techniquement un agent disposant
  de l'outil `Write`/`Edit` (soit 9 des 11 agents de ce tableau) d'écrire en
  dehors du sous-dossier `marketing-ai/` qui lui est nommément attribué — par
  exemple dans `CLAUDE.md`, `PROJECT_HANDOFF.md`, `README.md`, `docs/**`, ou dans
  le sous-dossier d'écriture d'un autre agent marketing.
- L'outil `Task` de `marketing-director` (voir `../../.claude/agents/marketing-director.md`)
  n'est, de la même façon, pas techniquement restreint à la liste d'agents
  qu'il documente : cette liste est une **règle de gouvernance**, pas une
  restriction garantie par Claude Code.

**Cette section n'invente aucune protection qui n'existe pas.** Le renforcement
technique de `.claude/settings.json` (ajout de règles `deny`/`ask` par
sous-dossier d'agent) est identifié comme une action de suivi possible, mais
n'a **pas** été réalisé dans le cadre de cette consolidation — voir le rapport
de mission correspondant.

## Chaîne de collaboration type

```
marketing-director
   ├── content-strategist ──► linkedin-writer / social-media-manager / lead-magnet-creator
   ├── seo-strategist ───────► seo-writer (rédaction) ───► seo-strategist (QA SEO)
   ├── conversion-funnel-designer ──► lead-magnet-creator / visual-flyer-director
   ├── visual-flyer-director
   ├── performance-analyst ──► (recommandations en retour)
   └── compliance-reviewer ──► contrôle TOUS les brouillons avant validation humaine
                                (ne valide jamais humainement lui-même)
```

Chaque brouillon suit : **brouillon → rédaction → QA SEO (si applicable) →
conformité → validation humaine → diffusion manuelle**. Aucun agent ne peut
publier, envoyer ou programmer un contenu.
