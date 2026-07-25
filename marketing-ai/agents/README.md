# Agents marketing — tableau récapitulatif

Documentation de référence des **dix agents** de la phase marketing. Les
définitions **exécutables** se trouvent dans `../../.claude/agents/` ; ce fichier
en est la notice lisible.

> Règles communes à **tous** les agents : écriture limitée à `marketing-ai/` ;
> interdiction de modifier le CRM (`server/`, `client/`, `data/`) ; interdiction
> d'utiliser Git ; interdiction de publier, d'envoyer ou de contacter un prospect ;
> aucune promesse garantie (économie, rendement, acceptation, « meilleur produit »).

| # | Agent | Rôle | Écrit dans | Limites clés |
|---|---|---|---|---|
| 1 | **marketing-director** | Coordonne la stratégie et délègue aux autres agents | `strategy/`, `content-calendar/`, `marketing-ai/**` | Ne contourne pas les limites des autres ; ne publie rien ; pas de Git |
| 2 | **compliance-reviewer** | Contrôle conformité nLPD/LSA des brouillons | `compliance/` uniquement | Lecture seule ailleurs ; pas un avis juridique ; pas de Git |
| 3 | **content-strategist** | Définit piliers éditoriaux et calendrier | `strategy/`, `content-calendar/` | Affirmations sensibles → vérification humaine ; pas de publication |
| 4 | **linkedin-writer** | Rédige des brouillons de posts LinkedIn | `social-media/linkedin/` | Ne publie jamais ; pas de contact prospect |
| 5 | **social-media-manager** | Brouillons Instagram/Facebook/Reels + cohérence | `social-media/*`, `content-calendar/` | Ne publie ni ne programme ; pas de contact prospect |
| 6 | **visual-flyer-director** | Concepts et briefs de flyers/visuels (texte) | `flyers/` | Pas d'images finales ; n'imprime/ne publie rien |
| 7 | **seo-strategist** | Mots-clés, briefs SEO, on-page | `seo/` | Recherche web OK ; **jamais** de scraping de données personnelles |
| 8 | **lead-magnet-creator** | Guides, check-lists, comparatifs | `lead-magnets/` | Aucune donnée médicale sensible ; pas de collecte automatisée |
| 9 | **conversion-funnel-designer** | Maquettes de landing pages et funnels | `landing-pages/` | Aucun envoi/contact auto ; consentement nLPD requis dans les maquettes |
| 10 | **performance-analyst** | Analyse des données de performance fournies | `analytics/` uniquement | Lecture seule ailleurs ; jamais d'accès aux données clients réelles |

## Chaîne de collaboration type

```
marketing-director
   ├── content-strategist ──► linkedin-writer / social-media-manager / lead-magnet-creator
   ├── seo-strategist ───────► content-strategist / conversion-funnel-designer
   ├── conversion-funnel-designer ──► lead-magnet-creator / visual-flyer-director
   ├── visual-flyer-director
   ├── performance-analyst ──► (recommandations en retour)
   └── compliance-reviewer ──► contrôle TOUS les brouillons avant validation humaine
```

Chaque brouillon suit : **brouillon → conformité → validation humaine → diffusion manuelle**.
