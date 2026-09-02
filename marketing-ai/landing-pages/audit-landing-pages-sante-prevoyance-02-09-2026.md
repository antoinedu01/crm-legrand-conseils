# Audit des landing pages — campagnes Santé 2027 et Prévoyance 3a/3b (02/09/2026)

> Audit de constat et de propositions, pas des corrections appliquées.
> Réalisé en lisant le code réel des pages (dépôt `site-legrandconseils`,
> branche `main` après fusion de la PR #4) — pas une supposition sur leur
> contenu. Aucune page n'a été modifiée pour produire ce document.

---

## 0. Résumé — ce qui compte le plus

1. **Santé — action opérationnelle à ne pas rater** : le comparateur LAMal
   réellement en ligne tourne sur des primes **OFSP 2026**, alors que la
   campagne s'appelle « Santé **2027** » et cible la décision de changement
   pour le 1er janvier 2027. La page le dit déjà honnêtement aux visiteurs
   (voir §1.1) — mais quelqu'un doit s'assurer que les primes 2027 (publiées
   par l'OFSP en général fin septembre) sont importées et le plugin
   reconstruit/réinstallé **avant ou pendant** la fenêtre de la campagne,
   sans quoi le comparateur restera avec des chiffres 2026 pendant toute la
   période où les prospects décident pour 2027.
2. **Santé — la question FINMA/LAMal reste ouverte** (voir
   `marketing-ai/compliance/perimetre-finma-vs-lamal-site-public.md`) : elle
   concerne directement cette page, landing page exacte de la campagne.
3. **Prévoyance** : rien de bloquant identifié sur les 3 pages. La page qui
   sert réellement la campagne actuelle (`bilan-prevoyance-3a`) est solide ;
   deux améliorations concrètes proposées ci-dessous.
4. **Point d'organisation à noter** : sur les 3 pages « prévoyance »
   auditées, **seule `bilan-prevoyance-3a` est la landing page de la
   campagne Meta actuelle** (`legrandconseils.ch/bilan-prevoyance-3a/`,
   `campaign_key` `cmp_3ef0fdfd034642549857d7ed65503126`). Les deux autres
   (`independants-proteger-revenu`, `proteger-sa-famille`) sont terminées,
   solides, mais **ne reçoivent actuellement aucun trafic** — ni lien
   interne, ni campagne configurée vers elles à ce jour. Auditées ici
   complètement puisque demandées, mais à traiter comme « prêtes pour une
   future campagne », pas comme faisant partie de la campagne actuelle.

---

## 1. Santé — comparateur LAMal

**Landing page de la campagne** : `legrandconseils.ch/comparateur-lamal/`.

### Précision importante sur ce qui est réellement audité

Le dépôt `site-legrandconseils` contient **deux versions** de cette page :
- `comparateur LAMal.html` (racine, branche `main`) — **version historique
  obsolète**, primes d'exemple codées en dur (« ⚠️ VALEURS D'EXEMPLE À
  REMPLACER ⚠️ » dans le code), non représentative de ce qui est en ligne.
- L'extension WordPress `legrand-comparateur-lamal` (snapshot sur la branche
  `chore/comparateur-lamal-prod-2026.1.2`, daté du 22/08/2026) — **c'est
  celle-ci qui est réellement active en production**, avec les vraies primes
  OFSP par canton/région (44 fichiers, traçabilité SHA256).

**Cet audit porte sur la version réellement en ligne** (le plugin), pas sur
le fichier historique.

### 1.1 Constat sur le millésime des primes

Le plugin embarque les primes OFSP **2026** (`manifest.json` :
`"activeYear": 2026`, généré le 29/07/2026). Le texte d'en-tête de la page
le dit déjà explicitement et honnêtement :

> « Préparez votre assurance maladie 2027 dès maintenant [...] Les primes
> affichées restent celles officiellement publiées par l'OFSP pour 2026
> jusqu'à la publication des primes 2027. »

C'est une divulgation transparente, pas un problème de contenu. Le point
d'attention est **opérationnel** : la campagne « Santé 2027 » démarre le
14/09/2026 et court pendant exactement la période où les prospects décident
pour 2027 (résiliation LAMal au plus tard le 30 novembre pour un changement
au 1er janvier). L'OFSP publie généralement les primes de l'année suivante
fin septembre. **Action à prévoir** : dès leur publication, regénérer les
données (`tools/import-ofsp-premiums/`, référencé mais absent de ce dépôt
au moment du snapshot — à vérifier où il vit réellement), reconstruire le
ZIP (`tools/build-wordpress-plugin/`) et réinstaller l'extension sur
WordPress. Sans quoi le comparateur continuera d'afficher des primes 2026 à
des prospects qui décident pour 2027, pendant une partie ou la totalité de
la campagne.

### 1.2 Ce qui fonctionne bien

- **Deux niveaux de résultats** (README du plugin) : « Offres avec
  accompagnement Legrand Conseils » (assureurs partenaires, avec numéro OFSP
  affiché) et « Autres primes officielles OFSP » (marché complet). C'est un
  vrai gage de transparence — le visiteur voit qu'il n'est pas enfermé sur 4
  assureurs, cohérent avec la posture de neutralité du positionnement.
- **Précision géographique renforcée** vs l'ancienne version : champ commune
  (`lamal-commune`) et NPA facultatif ajoutés, en plus du canton — les primes
  LAMal varient par région tarifaire, pas seulement par canton ; c'est un
  vrai gain de justesse.
- **Aucune promesse chiffrée non sourcée** : les montants viennent des
  fichiers OFSP, pas d'estimations inventées.
- **CTA sobre et cohérent** : « Préparer mon comparatif → », jamais
  « Économisez maintenant » ou équivalent.
- **Formulaire minimal** (prénom, nom, téléphone, e-mail facultatif,
  créneau de rappel) — pas de sur-collecte.
- **3 onglets** (Comparateur LAMal / Complémentaires / Mes délais) donnent
  un vrai outil complet en une seule URL, cohérent avec l'ambition de la
  page d'accueil (« Mes outils »).

### 1.3 Améliorations concrètes proposées

1. **Le millésime 2027** (§1.1) — priorité absolue, opérationnelle plutôt
   qu'éditoriale.
2. **Nommer les 4 assureurs partenaires plus tôt** : aujourd'hui, Helsana /
   Groupe Mutuel / SWICA / CSS n'apparaissent qu'en petite note sous le
   formulaire, jamais dans l'en-tête. Les nommer dès l'en-tête (« Comparez
   les primes de mes 4 partenaires ») rendrait la promesse plus concrète
   dès la première lecture — à valider avec vous puisque cela change une
   formulation déjà en production.
3. **Onglet « Mes délais » sous-exploité pour une campagne de septembre** :
   le compte à rebours (30 nov. LAMal / 30 sept. LCA) est un vrai argument
   d'urgence honnête, calculé en direct — mais il faut activement cliquer
   sur l'onglet pour le voir. Pour une campagne qui démarre justement à la
   période où ce délai devient concret, un rappel discret dans l'en-tête
   principal (pas seulement dans l'onglet caché) pourrait capter plus tôt
   l'attention des visiteurs déjà dans une logique de deadline.
4. **Aucun élément de preuve sociale** (nombre de personnes accompagnées,
   avis) — absent aujourd'hui. À n'ajouter que si un chiffre réel et
   vérifiable existe (jamais un chiffre inventé) ; sinon, ne rien ajouter
   plutôt que d'improviser une preuve sociale non sourcée.

---

## 2. Prévoyance — `bilan-prevoyance-3a.html` (landing page réelle de la campagne)

**Landing page de la campagne** : `legrandconseils.ch/bilan-prevoyance-3a/`.

### 2.1 Ce qui fonctionne bien

- **Structure complète et éprouvée** : hero → problème → 3 bénéfices → 4
  étapes → FAQ → formulaire, cohérente avec les deux autres pages « lp2 »
  (identité visuelle partagée, bleu marine/or, `Fraunces`/`DM Sans`).
- **Persona net** : badge « Jeunes actifs · Suisse romande », ton et
  problème (« Je sais que je devrais faire un 3e pilier… ») bien calibrés.
- **Conformité déjà propre** : « Aucune économie, aucun rendement ni
  acceptation ne sont garantis » en pied de page ; FAQ « C'est vraiment
  gratuit ? » explique la rémunération par les compagnies sans rien cacher.
- **Le badge « ✅ Enregistré FINMA » est ici sans ambiguïté** — contrairement
  à la page LAMal, cette page porte sur le 3e pilier (assurance-vie), qui
  est précisément l'une des deux branches inscrites au registre FINMA. Pas
  de question de périmètre à se poser ici.
- **Suivi d'attribution identique** aux autres pages (`campaign_key`, UTM,
  `lead_form_view`/`lead_submit`) — cohérent avec le reste du site.

### 2.2 Améliorations concrètes proposées

1. **Le vrai délai de fin d'année n'est jamais rendu concret.** Le texte dit
   « un versement non fait une année est définitivement perdu pour la
   déduction fiscale » — c'est vrai et déjà mentionné, mais sans jamais
   écrire « avant le 31 décembre ». Pour une campagne qui démarre le
   14/09/2026, c'est une **urgence réelle et vérifiable** (pas fabriquée :
   c'est une règle fiscale, pas un argument commercial) qui reste sous-
   exploitée. Écrire explicitement la date donnerait un vrai levier de
   conversion honnête, cohérent avec la période de lancement de la
   campagne. `Vérification humaine obligatoire` sur la formulation exacte
   avant tout ajout (délai de versement effectif vs délai bancaire de
   traitement, qui diffèrent).
2. **Le rappel de délai de réponse (24 h ouvrées) n'apparaît qu'après la
   soumission du formulaire.** L'afficher aussi près du bouton d'appel à
   l'action principal (`Demander mon bilan gratuit`, en haut de page)
   réduirait l'incertitude avant même que le visiteur descende jusqu'au
   formulaire.

---

## 3. Prévoyance — les deux pages non encore rattachées à une campagne

Ces deux pages sont terminées, cohérentes avec `bilan-prevoyance-3a`
(même structure, même identité visuelle) et prêtes à recevoir du trafic —
mais **aucun lien interne ni campagne ne pointe vers elles aujourd'hui**.

### 3.1 `independants-proteger-revenu.html`

- Persona net (« Indépendants · Suisse romande »), problème réel et bien
  posé (absence de protection automatique du revenu, contrairement au
  salariat), sans dramatisation excessive.
- FAQ couvre les objections attendues (coût, moment, déductibilité,
  indépendance du conseil).
- Rien à corriger — page prête pour activation si une campagne dédiée
  « indépendants » est envisagée un jour.

### 3.2 `proteger-sa-famille.html`

- Persona « Familles · Vaud & Genève », angle « et si votre revenu
  s'arrêtait demain ? » traité sans alarmisme — la FAQ anticipe même
  explicitement l'objection (« Vous allez me faire peur pour vendre ? »
  → « Ce n'est pas ma méthode. »), un réflexe de conformité déjà intégré
  dans le texte lui-même.
- Rien à corriger — page prête pour activation si une campagne dédiée
  « familles » est envisagée un jour.

### 3.3 Remarque technique mineure (les 3 pages « lp2 »)

Le CSS est dupliqué à l'identique dans les 3 fichiers plutôt que partagé.
Sans conséquence pour le visiteur — mais si la charte graphique évolue un
jour (couleurs, typographies), il faudra penser à répercuter le changement
dans les 3 fichiers séparément. Signalé pour information, pas une action à
mener maintenant.

---

*Aucune modification de code n'a été faite pour produire cet audit —
lecture seule sur `site-legrandconseils`.*
