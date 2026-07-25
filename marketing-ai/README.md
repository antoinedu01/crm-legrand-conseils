# marketing-ai/ — Système de travail marketing (Legrand conseils Sàrl)

Ce dossier regroupe **toute** la production de la phase marketing / acquisition IA
pour Legrand conseils Sàrl (courtier en assurance indépendant, Suisse romande —
Vaud / Genève). Il est **isolé du CRM** : aucun fichier ici n'affecte
l'application en production.

> À lire avant tout : `../CLAUDE.md` (règles permanentes du projet).

---

## 1. Objectif du système marketing

Augmenter la **visibilité** et générer des **leads entrants qualifiés** de façon
**éthique et respectueuse du cadre légal** (nLPD, LSA), grâce à des agents IA qui produisent
des **brouillons** — jamais des publications automatiques. L'humain garde la
décision finale à chaque étape.

## 2. `.claude/agents/` vs `marketing-ai/agents/`

| Emplacement | Nature | Contenu |
|---|---|---|
| **`.claude/agents/`** | **Agents Claude Code exécutables** | Définitions techniques (frontmatter + permissions) réellement chargées par Claude Code comme sous-agents. |
| **`marketing-ai/agents/`** | **Documentation** | Descriptions lisibles, tableau récapitulatif des rôles et limites (voir `agents/README.md`). N'est **pas** exécuté. |

Autrement dit : `.claude/agents/` = le « moteur » ; `marketing-ai/agents/` = la
« notice ».

## 3. Processus de validation (obligatoire, sans exception)

1. **Brouillon IA** — un agent produit un brouillon dans `marketing-ai/`.
2. **Contrôle conformité** — `compliance-reviewer` rédige un rapport
   (`marketing-ai/compliance/`).
3. **Validation humaine** — l'utilisateur relit, corrige, approuve.
4. **Publication ou envoi manuel** — réalisé **par un humain**, jamais par l'IA.

> **Aucune publication ni aucun envoi n'est automatique.**

## 4. Zones protégées du CRM (rappel)

Ne jamais modifier sans autorisation humaine : `server/`, `client/`, `data/`,
les migrations, la base SQLite, les dépendances (`package.json` /
`package-lock.json`), `deploy/`, les routes publiques, l'authentification et les
données clients. Détails dans `../CLAUDE.md` et `../PROJECT_HANDOFF.md`.

## 5. Comment utiliser les agents

- Décrire le besoin au **`marketing-director`**, qui cadre et délègue ; ou
  invoquer directement l'agent spécialisé adéquat.
- Chaque agent **n'écrit que dans son dossier** de `marketing-ai/`.
- Faire systématiquement passer le brouillon par **`compliance-reviewer`** avant
  de solliciter la validation humaine.
- Renseigner la fiche `templates/content-validation-template.md` pour chaque
  contenu.

## 6. Structure des dossiers

```
marketing-ai/
├── README.md                 → ce fichier
├── agents/                   → documentation des agents (tableau récap)
├── prompts/                  → prompts réutilisables
├── strategy/                 → stratégie, personas, piliers éditoriaux
├── content-calendar/         → calendrier éditorial
├── social-media/
│   ├── linkedin/             → brouillons LinkedIn
│   ├── instagram/            → brouillons Instagram
│   ├── facebook/             → brouillons Facebook
│   └── reels/                → brouillons Reels
├── flyers/                   → briefs/concepts de flyers et visuels
├── lead-magnets/             → guides, check-lists, comparatifs
├── landing-pages/            → maquettes de pages et funnels
├── seo/                      → mots-clés, briefs SEO
├── compliance/               → rapports de conformité
├── analytics/                → rapports de performance
├── templates/                → gabarits (fiche de validation…)
└── partnerships/             → partenariats et recommandations
```

## 7. Règle d'or

> **Rien n'est publié ni envoyé automatiquement.** Tout contenu passe par
> brouillon → conformité → validation humaine → diffusion manuelle.
