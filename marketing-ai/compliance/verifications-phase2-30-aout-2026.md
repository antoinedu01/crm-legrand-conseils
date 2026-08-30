# Vérifications Phase 2 — 30 août 2026

> Document de constat, pas de correction. Rédigé dans le cadre de la
> consolidation marketing du 30/08/2026, en réponse aux points 2 à 4 de la
> Phase 2 du plan de reprise. Aucune modification de code ou de contenu
> n'a été faite sur la base de ces constats — ils sont transmis pour
> décision humaine.

---

## 1. Événement GA4 `generer_lead` vs code de tracking réel

**Constat** : plusieurs documents (`PROJECT_HANDOFF.md` du dépôt CRM,
`marketing-ai/analytics/kpi-90-jours.md`,
`marketing-ai/strategy/checklist-avant-lancement.md`,
`marketing-ai/strategy/registre-url-et-cta.md`,
`marketing-ai/strategy/planning-preparation-16-juillet-16-aout-2026.md`,
`marketing-ai/lead-magnets/formulaire-guide-3e-pilier.md`) désignent un
événement GA4 nommé `generer_lead`.

Le code de tracking réel trouvé dans le dépôt `site-legrandconseils`
(branches `main`, `feat/demarches-acquisition-tracking-v1`,
`feature/acquisition-tracking-v1`) ne pousse jamais littéralement
`generer_lead`. Il pousse dans `window.dataLayer` :

- `lead_form_open` (ouverture du formulaire)
- `lead_submit` (soumission réussie)

Exemple (`demarches en ligne.html`, branche
`feat/demarches-acquisition-tracking-v1`) :

```
window.dataLayer.push({event:name, lead_tool:tool, page_path:location.pathname});
...
lgcEvent("lead_form_open", opts.tool);
...
lgcEvent("lead_submit", opts.tool);
```

**Recherche effectuée** : aucun fichier d'export de conteneur Google Tag
Manager (JSON) n'existe dans aucun des deux dépôts, sur aucune branche.
Un conteneur GTM se configure normalement via l'interface web de GTM, pas
via un fichier versionné — sa configuration n'est donc, par construction,
pas vérifiable depuis le code seul.

**Conclusion** : il est plausible qu'un conteneur GTM (`GTM-PFMFCTMP`,
d'après le document de synthèse) traduise l'événement `dataLayer`
`lead_submit` vers un événement GA4 nommé `generer_lead` — mais rien dans le
code ne le confirme ni ne l'infirme. **Vérification à faire côté interface
GTM/GA4, par un humain avec accès à ces comptes.** Si aucune traduction de
ce type n'existe côté GTM, l'événement de conversion réellement remonté à
GA4 serait `lead_submit`, pas `generer_lead`, ce qui aurait potentiellement
un impact sur les rapports/objectifs GA4 configurés sous ce dernier nom.

---

## 2. CTA de la campagne Meta « Santé 2027 »

**Constat** : deux sources internes désignent des CTA différents pour la
même campagne :

- Document de passation « Meta Business » : CTA **« En savoir plus »**
- Document de lancement acquisition : CTA **« Voir les détails »**

Cette investigation n'a pas accès au compte Meta Ads (hors périmètre des
dépôts Git disponibles) et ne peut donc pas arbitrer entre les deux. **À
vérifier directement dans l'interface Meta Ads Manager**, sur l'annonce de
la campagne `LC │ SANTE 2027 │ PROSPECTION │ VD-GE │ SEP26`
(`campaign_key` : `cmp_35840ff5627849a084acac6f7f60f262`), avant le
préflight du 11/09/2026.

---

## 3. Suppression de `changer-caisse-maladie-delais-etapes.html` dans les branches de tracking

**Constat détaillé** (dépôt `site-legrandconseils`) :

- Le fichier `changer-caisse-maladie-delais-etapes.html` (article SEO-001,
  24 172 octets) a été ajouté sur `main` par le commit `8fe59a5`
  (« content: add SEO-001 WordPress draft HTML »), via la pull request #1.
- La branche `feature/acquisition-tracking-v1` (CTA→CRM, 3 landing pages,
  capture d'attribution first-touch) a été créée à partir du commit
  `a50dfac` (« Add files via upload ») — **c'est-à-dire avant** l'ajout de
  l'article sur `main`. Elle n'a jamais été rebasée ni fusionnée avec les
  commits ultérieurs de `main` (ni l'article, ni les corrections de
  contraste CTA de SEO-001 faites depuis).
- Recherche de contenu repris ailleurs : le texte de l'article (délais,
  étapes, documents, erreurs à éviter pour changer de caisse maladie)
  n'apparaît, ni intégralement ni sous forme résumée, dans aucun autre
  fichier modifié par cette branche.
- Une **autre** branche de tracking, `feat/demarches-acquisition-tracking-v1`,
  est en revanche construite directement sur le `main` actuel (le contient
  entièrement comme ancêtre) et ne touche qu'un seul fichier
  (`demarches en ligne.html`) — elle conserve l'article sans y toucher.

**Conclusion** : il ne s'agit pas d'une suppression volontaire du contenu.
C'est un artefact de divergence de branche — `feature/acquisition-tracking-v1`
a simplement été créée avant que l'article n'existe sur `main`, puis n'a
jamais été resynchronisée. Si cette branche était fusionnée telle quelle
dans `main`, elle **ferait disparaître l'article actuellement en ligne**
(et les corrections de contraste CTA faites depuis). **Action recommandée
avant toute fusion de `feature/acquisition-tracking-v1`** : la rebaser (ou
la refusionner) sur le `main` actuel pour récupérer l'article et les
correctifs — décision et exécution laissées à validation humaine, aucune
fusion n'a été faite ici.

---

*Aucun fichier n'a été modifié dans `site-legrandconseils` pour produire ce
constat — lecture seule uniquement.*
