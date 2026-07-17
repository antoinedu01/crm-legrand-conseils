# Convention UTM — Legrand Conseils Sàrl

> Brouillon marketing (LOT 2B). Convention **simple et stable** pour tracer la
> source des visites et des leads dans GA4. Rédigée le 16/07/2026 par
> `performance-analyst`. **Aucune URL réelle n'est inventée** : les exemples
> utilisent l'emplacement `[URL_CIBLE_CONFIRMEE]`.
> Règle d'or : **minuscules**, **sans accents**, **sans espaces** (tiret `-` comme
> séparateur), valeurs **stables** dans le temps.

## Les quatre paramètres

| Paramètre | Rôle | Valeurs retenues |
|---|---|---|
| `utm_source` | D'où vient le clic (plateforme) | `linkedin`, `instagram`, `facebook`, `flyer`, `guide`, `site` |
| `utm_medium` | Type de support | `social`, `story`, `reel`, `qr`, `pdf`, `formulaire`, `email` |
| `utm_campaign` | Campagne / thème | ex. `lancement-3e-pilier`, `lancement-prevoyance`, `lancement-famille`, `bilan-local`, `guide-3e-pilier` |
| `utm_content` | Variante précise du contenu | ex. `post-3a-3b`, `post-independants`, `story-question`, `reel-30s`, `flyer-a5`, `form-guide` |

### Règles de nommage
- Uniquement `a-z`, `0-9` et `-` (tiret). Pas d'accent, pas d'espace, pas de
  majuscule, pas de caractère spécial.
- `utm_campaign` = préfixe `lancement-` (ou thème) + sujet, pour regrouper les
  contenus d'une même vague.
- `utm_content` = format + sujet court, pour distinguer deux contenus d'une même
  campagne.
- Ne jamais réutiliser une même valeur `utm_content` pour deux contenus différents.

## Exemples (montage : `[URL_CIBLE_CONFIRMEE]?` + paramètres)

**LinkedIn (post)**
```
[URL_CIBLE_CONFIRMEE]?utm_source=linkedin&utm_medium=social&utm_campaign=lancement-3e-pilier&utm_content=post-3a-3b
```

**Instagram (post/carrousel)**
```
[URL_CIBLE_CONFIRMEE]?utm_source=instagram&utm_medium=social&utm_campaign=lancement-3e-pilier&utm_content=carrousel-idees-recues
```

**Facebook (post)**
```
[URL_CIBLE_CONFIRMEE]?utm_source=facebook&utm_medium=social&utm_campaign=lancement-famille&utm_content=post-naissance
```

**Reel**
```
[URL_CIBLE_CONFIRMEE]?utm_source=instagram&utm_medium=reel&utm_campaign=lancement-3e-pilier&utm_content=reel-30s
```

**Story**
```
[URL_CIBLE_CONFIRMEE]?utm_source=instagram&utm_medium=story&utm_campaign=lancement-3e-pilier&utm_content=story-question
```

**Flyer avec QR code**
```
[URL_CIBLE_CONFIRMEE]?utm_source=flyer&utm_medium=qr&utm_campaign=bilan-local&utm_content=flyer-a5
```

**Guide 3e pilier (lien de téléchargement / CTA dans le PDF)**
```
[URL_CIBLE_CONFIRMEE]?utm_source=guide&utm_medium=pdf&utm_campaign=guide-3e-pilier&utm_content=cta-contact
```

## Bonnes pratiques
- Générer les liens **une fois les URL cibles confirmées** (remplacer
  `[URL_CIBLE_CONFIRMEE]`).
- Conserver un **tableau de correspondance** (contenu ↔ lien taggé) — voir
  `../strategy/registre-url-et-cta.md`.
- Tester chaque lien taggé **jusqu'à GA4** avant diffusion.
- Ne pas tagger les liens **internes** au site (uniquement les liens entrants).
- **Aucune modification d'Analytics dans ce lot** : cette convention est une
  spécification à appliquer par un humain.
