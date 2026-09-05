# Registre éditorial central — vue consolidée intercanaux

> Créé le 24/07/2026 (date système de la mission de consolidation) dans le cadre
> de `feature/marketing-acquisition-consolidation-v1`. Documente la structure du
> fichier `registre-editorial-central.csv` — **le CSV est la source de vérité
> machine-lisible, ce fichier Markdown en est la notice et le détail historique**.
>
> Ce registre devient la **vue consolidée de tout contenu marketing**, SEO et
> social confondus. Il ne remplace pas le registre historique du volet SEO
> (`registre-editorial.csv`/`.md`, voir en tête de ce dernier la note de
> transition ajoutée lors de cette consolidation) : il en absorbe les 6 lignes
> avec mapping complet, documenté ci-dessous, sans perte d'information.

---

## 1. Colonnes du registre central

| Colonne | Définition |
|---|---|
| `content_id` | Identifiant unique et stable. Préfixes : `SEO-` (contenu SEO/blog), `SOC-LI-` (LinkedIn), `SOC-IG-` (Instagram), `SOC-FB-` (Facebook), `SOC-RE-` (Reels). |
| `titre` | Titre de travail du contenu. |
| `theme` | Sujet précis traité (plus fin que le silo). |
| `silo` | Grande thématique : LAMal / Complémentaires / Prévoyance / Famille / Méthode et valeurs / Local. |
| `persona` | Persona principal visé (`../strategy/personas-prioritaires.md`). |
| `canal` | LinkedIn / Instagram / Facebook / Reels / SEO / Site. |
| `compte` | Compte précis : LinkedIn personnel / LinkedIn entreprise / Instagram / Page Facebook / Site (blog). |
| `format` | Post texte / Carrousel / Stories / Reel / Article de blog / etc. |
| `objectif` | Notoriété / éducation / engagement / génération de contact / conversion. |
| `etape_funnel` | Découverte / Engagement / Ressource / Contact / Conversion. |
| `date_prevue` | Date de diffusion envisagée (format ISO `AAAA-MM-JJ` lorsque connue). |
| `date_publication` | Date de publication réelle — **renseignée uniquement après publication effective, par un humain**. |
| `responsable` | Personne humaine responsable de la validation finale. |
| `agent_producteur` | Agent(s) ayant produit le brouillon. |
| `url_cible` | Page du site visée par le contenu. `À confirmer` tant que l'URL réelle n'est pas connue. |
| `cta` | Appel à l'action principal. |
| `utm_source` / `utm_medium` / `utm_campaign` / `utm_content` | Paramètres UTM, repris de `../analytics/convention-utm.md` et `../strategy/registre-url-et-cta.md` sans en inventer de nouveaux. |
| `statut_redaction` | Voir §2. |
| `statut_sources` | Voir §2. |
| `statut_seo` | Voir §2 (sans objet pour le contenu social pur). |
| `statut_conformite` | Voir §2. |
| `validation_humaine` | `Oui` / `Non`. Si `Oui`, le nom du validateur et la date figurent en `notes` (voir §5) et/ou en `responsable`. |
| `statut_publication` | Voir §2. |
| `impressions`, `clics`, `visites_site`, `leads`, `rendez_vous`, `contrats`, `ca_attribue` | Données de performance réelles, à alimenter **uniquement** par `performance-analyst` à partir de données humaines fournies. **Aucune valeur inventée** : toutes vides à ce jour, aucune donnée réelle n'existe puisqu'aucun contenu n'est publié. |
| `notes` | Renvoi vers le fichier source complet, la revue de conformité applicable, et tout élément non couvert par une colonne dédiée. |

---

## 2. Statuts autorisés

### `statut_redaction`
`idée` → `brief à créer` → `brief prêt` → `sources partiellement validées` → `rédaction en cours` → `brouillon prêt` → `corrections requises` (retour possible depuis `brouillon prêt`, `statut_seo` ou `statut_conformite`)

### `statut_sources`
`Non fait` · `En cours` · `Validé avec réserves` · `Validé` · `Sans objet` (contenu sans affirmation à sourcer)

### `statut_seo`
`Non fait` · `En cours` · `Validé` · `Sans objet` (contenu social pur, hors périmètre de la QA `seo-strategist`)

### `statut_conformite`
`Non fait` · `À corriger` · `Prêt pour validation humaine` · `Validé` · `Sans objet`

### `validation_humaine`
`Oui` · `Non` — jamais renseigné `Oui` par un agent : uniquement par une décision humaine nommée et datée (voir `notes`).

### `statut_publication`
`Non créé` · `Brouillon` · `Programmé` · `Publié` · `Dépublié`

---

## 3. Règles de gouvernance (reprises et étendues du registre SEO historique)

- **Aucun agent ne peut, seul, passer un contenu à `validé pour validation_humaine=Oui` ni à `statut_publication=Publié`.** Ces deux passages sont réservés à une décision humaine explicite, nommée et datée.
- **Aucun saut direct vers `Publié`** : un contenu doit être passé par `statut_conformite=Prêt pour validation humaine` puis `validation_humaine=Oui` avant tout passage à `statut_publication=Programmé` puis `Publié`.
- **Retour en arrière possible** depuis `statut_seo` ou `statut_conformite` vers `statut_redaction=corrections requises`, à tout moment.
- **`date_publication` ne peut être renseignée que si `statut_publication` vaut `Programmé` ou `Publié`.**
- **`statut_publication=Publié` ne peut être vrai que si `validation_humaine=Oui`.**
- Ces deux dernières règles sont contrôlées mécaniquement par `../scripts/validate-editorial-registry.js` (voir §6).

## 4. Rôles autorisés à modifier chaque famille de colonnes

| Rôle | Peut proposer ou mettre à jour |
|---|---|
| `content-strategist` | `titre`, `theme`, `silo`, `persona`, `objectif`, `etape_funnel`, `date_prevue` |
| `seo-writer` | `agent_producteur` (mention de lui-même), `statut_redaction` (`rédaction en cours` → `brouillon prêt`), `notes` (notes de brouillon) — uniquement pour les contenus `SEO-*` |
| `linkedin-writer` / `social-media-manager` / `visual-flyer-director` | `agent_producteur`, `statut_redaction`, `notes` — uniquement pour les contenus de leur canal |
| `seo-strategist` | `statut_seo`, `url_cible` (proposition), `utm_*` (proposition) — uniquement pour les contenus `SEO-*` |
| `compliance-reviewer` | `statut_sources`, `statut_conformite`, et le retour à `corrections requises` si nécessaire |
| **L'humain** | **Tous les champs**, en particulier `validation_humaine`, `responsable`, `date_publication`, `url_cible` (confirmation finale), `statut_publication`, et les 7 colonnes de performance |

**Aucun agent ne peut, seul, marquer un contenu `Publié`** ni renseigner `date_publication`, `impressions`, `clics`, `visites_site`, `leads`, `rendez_vous`, `contrats` ou `ca_attribue` — ces champs sont réservés à l'action humaine, après publication réelle et avec des données réelles fournies par l'humain (jamais de données clients réelles brutes).

---

## 5. Mapping détaillé des 6 contenus SEO (historique complet préservé)

### SEO-001 — Changer de caisse maladie : délais, étapes, documents et erreurs à éviter

**Statut réel à la date de cette consolidation (24/07/2026)** : `statut_sources=Validé avec réserves`, `statut_seo=Validé`, `statut_conformite=Validé`, `validation_humaine=Oui` (Antoine Legrand, 24/07/2026), `statut_publication=Non publié`.

Le registre SEO historique (`registre-editorial.csv`, ligne SEO-001) documentait ce contenu avec les champs suivants, entièrement préservés ici :

- **Slug** : non confirmé (vide dans le registre historique).
- **Mot-clé principal** : changer caisse maladie suisse.
- **Variantes lexicales** : changer assurance maladie suisse, résilier caisse maladie suisse, délai changement caisse maladie, changer assurance de base, changement LAMal, résiliation assurance maladie obligatoire.
- **Priorité** : Très haute.
- **Angle différenciant** : guide chronologique et opérationnel, centré sur les décisions et vérifications à effectuer avant d'envoyer une résiliation.
- **Sources officielles** : Fedlex art. 7 LAMal ; OFSP/Priminfo changement d'assurance-maladie et FAQ ; ch.ch résiliation et changement ; OFSP FAQ primes et coûts ; OFSP primes arriérées.
- **Date de validité des sources** : 23/07/2026 — à revérifier avant publication.
- **Historique de production** (chronologie complète, préservée du registre historique) :
  1. Brief stratégique créé (`marketing-ai/strategy/brief-seo-001-changer-caisse-maladie.md`), article non rédigé.
  2. Lot de sources officielles intégré (`marketing-ai/research/sources-seo-001-changer-caisse-maladie.md`), article non rédigé.
  3. Outline créé (`marketing-ai/outlines/outline-seo-001-changer-caisse-maladie.md`), article non rédigé.
  4. Brouillon v1 rédigé (`marketing-ai/seo/articles/seo-001-changer-caisse-maladie-v1.md`), non validé, non publié.
  5. Review SEO v1 (`marketing-ai/reviews/seo-review-seo-001-v1.md`) — verdict : corrections importantes requises (maillage interne absent, redondance FAQ/H3), score interne 78/100.
  6. Brouillon v2 (`marketing-ai/seo/articles/seo-001-changer-caisse-maladie-v2.md`) — corrections SEO appliquées.
  7. Validation SEO v2 (`marketing-ai/reviews/seo-validation-seo-001-v2.md`) — SEO validé.
  8. Review conformité v2 (`marketing-ai/reviews/compliance-validation-seo-001-v2.md`) — verdict conforme (valable pour la v2 uniquement).
  9. Version courante passée en v3 après décision humaine du 24/07/2026 (v2 non validée en l'état par l'humain).
  10. Review SEO v3 (`marketing-ai/reviews/seo-validation-seo-001-v3.md`) — verdict conforme avec améliorations optionnelles, aucune correction obligatoire, améliorations optionnelles non retenues (décision humaine).
  11. Review conformité v3 (`marketing-ai/reviews/compliance-validation-seo-001-v3.md`) — verdict conformité validable avec observations non bloquantes : 16 contrôles (11 conformes, 5 conformes avec nuance, 0 non-conforme), aucune correction obligatoire.
  12. Validation humaine finale (`marketing-ai/reviews/human-validation-seo-001-v3.md`) — accordée par Antoine Legrand le 24/07/2026, v3 non modifiée. **Préparation à la publication autorisée. Aucune publication effectuée.**
- **CTA principal** : Demander un bilan.
- **Page pilier** : `assurance-maladie-lamal` (slug proposé ; URL réelle du site `À confirmer`).
- **Package WordPress préparé** (non exécuté) : `marketing-ai/wordpress/seo-001-v3/` — métadonnées Rank Math, maillage interne (5 liens en attente de confirmation d'URL), brief d'image principale, checklist de publication, contenu public extrait.

**Précision sur `agent_producteur`** : le registre SEO historique indique `content-strategist` dans la colonne `agent_auteur`, reflétant le fait que `content-strategist` a produit et fait vivre l'entrée de registre / le brief. Le brouillon lui-même (v1 à v3) a été rédigé selon le workflow documenté dans `../../.claude/agents/seo-writer.md`, dont le rôle est précisément de transformer un brief validé en brouillon. Les deux informations sont conservées ici sans qu'aucune ne soit effacée au profit de l'autre.

### SEO-002 à SEO-006

Ces cinq contenus étaient, au 23/07/2026 (date d'initialisation du registre SEO
historique), au statut `brief à créer` (SEO-002, SEO-003) ou `idée` (SEO-004,
SEO-005, SEO-006). **Aucun brief, aucun brouillon, aucune source, aucune date de
publication, aucune URL et aucune validation n'étaient renseignés** pour ces
cinq lignes dans le registre historique — cet état est repris strictement à
l'identique dans le registre central : aucune information n'a été ajoutée,
déduite ou inventée pour ces cinq contenus lors de cette consolidation.

SEO-003 et SEO-005 sont explicitement cités comme cibles de maillage interne
futures dans le brouillon SEO-001 v3 (marqueurs `[LIEN INTERNE — SEO-003]` et
`[LIEN INTERNE — SEO-005]`), non activés tant que ces contenus ne sont pas
publiés.

---

## 6. Mapping détaillé des 8 contenus sociaux

Les 8 contenus sociaux demandés ont été identifiés à partir des 6 fichiers
réellement présents dans `marketing-ai/social-media/**` (voir le rapport
d'audit de la mission précédente pour le détail intégral des textes). Le
fichier `linkedin/post-lancement-officiel.md` contient 2 publications
distinctes (personnel/entreprise) → `SOC-LI-001`/`SOC-LI-002`. Le fichier
`linkedin/semaine-17-23-aout-2026.md` contient 2 publications → `SOC-LI-003`/
`SOC-LI-004`. Le fichier de stories Instagram (4 séquences) est traité comme
**une seule entrée** `SOC-IG-002`, avec le détail des 4 séquences en `notes`,
conformément à la consigne de cette mission.

**Aucun des 8 contenus sociaux n'est indiqué comme publié ni comme validé
humainement** : c'est leur état réel constaté dans les fichiers sources et dans
`marketing-ai/compliance/revue-conformite-lot-2a.md`. Deux contenus
(`SOC-LI-001`, `SOC-LI-002` — le post de lancement) ne sont **couverts par
aucune revue de conformité formelle** : `revue-conformite-lot-2a.md` traite les
sections 1 (LinkedIn semaine du 17-23/08), 2 (Instagram carrousel), 3
(Facebook), 4 (Stories), 5 (Reel), mais ne mentionne jamais
`post-lancement-officiel.md`. Ce point est documenté en `notes` pour ces deux
lignes plutôt que masqué.

Les UTM des 8 contenus sociaux ont été repris tels quels depuis
`../strategy/registre-url-et-cta.md`, sans en inventer aucun. Pour `SOC-IG-002`
(pack Stories), seule la séquence 3 (« La question du jour ») dispose d'un UTM
documenté dans le registre source (`utm_content=story-question`) ; les 3
autres séquences n'ont pas d'UTM assigné à ce jour — cela est noté explicitement
plutôt que d'inventer une valeur pour les séquences manquantes.

---

## 7bis. Mission 3 — vérification des sources officielles (25/07/2026)

Dans le cadre de `feature/marketing-source-verification-v1`, un inventaire
exhaustif des affirmations sensibles de `marketing-ai/**` a été mené et
documenté dans trois nouveaux fichiers :

- `marketing-ai/compliance/verification-sources-officielles-2026.md` —
  16 affirmations inventoriées (FACT-001 à FACT-016), avec tentative réelle
  d'accès direct (`WebFetch`) aux domaines officiels suisses (Fedlex,
  Priminfo, OFSP/BAG, ch.ch, ESTV, BSV, FINMA) : accès bloqué (HTTP 403) sur
  l'ensemble de ces domaines, de façon reproductible avec le blocage déjà
  documenté le 16/07/2026. Aucune validation n'a été tirée d'un simple
  extrait de moteur de recherche.
- `marketing-ai/compliance/revue-conformite-posts-lancement.md` — première
  revue de conformité formelle de `SOC-LI-001` et `SOC-LI-002` (post de
  lancement officiel), non couverts par `revue-conformite-lot-2a.md`.
  Verdict : prêts pour validation humaine.
- `marketing-ai/compliance/classement-contenus-publiables.md` — classement
  des 14 contenus du registre selon 4 catégories (publiable après validation
  humaine finale / correction factuelle requise / bloqué — source officielle
  insuffisante / non rédigé — hors publication).

**Corrections factuelles appliquées** : reformulation de « beaucoup plus
souple » en « généralement plus souple » à propos du pilier 3b, dans
`social-media/linkedin/semaine-17-23-aout-2026.md` et
`social-media/reels/reel-semaine-17-23-aout-2026.md` (FACT-003) — pour éviter
de présenter la souplesse du 3b comme une règle absolue.

**Aucune régression** : `SEO-001` conserve son statut et sa validation
humaine du 24/07/2026 ; aucun contenu déjà `Prêt pour validation humaine`
n'a été rétrogradé. **Aucune validation humaine** n'a été ajoutée par cette
mission : `validation_humaine` reste `Non` pour les 13 contenus autres que
SEO-001.

## 7ter. Mission 3B — réconciliation externe humaine (25/07/2026)

Sur `feature/marketing-source-reconciliation-v1`, Antoine Legrand a communiqué
six sources officielles (H01 à H06) qu'il a consultées personnellement, hors
de l'environnement Claude, en réponse au blocage HTTP 403 rencontré pendant
la Mission 3 sur l'ensemble des domaines officiels suisses testés. **Claude
n'a pas consulté ces pages directement** — une nouvelle tentative `WebFetch`
sur deux de ces URL le 25/07/2026 a de nouveau échoué (HTTP 403). Le détail
complet (URL, éléments confirmés, mapping FACT-XXX) figure dans
`marketing-ai/compliance/verification-sources-officielles-2026.md` §2bis.

**Conséquences** :
- 12 des 16 affirmations inventoriées passent de `Non confirmé` à `Confirmé` ;
  4 restent/passent à `Confirmé avec reformulation`. Aucune n'est `Contredit`
  ni `Bloqué`.
- Deux corrections de texte obligatoires ont été appliquées : `SOC-FB-001`
  (retrait de « Rien d'urgent », mention du délai réel de trois mois pour
  affilier un nouveau-né) et `SOC-LI-002` (retrait d'une formulation pouvant
  laisser croire à une comparaison de tout le marché).
- Ces deux contenus modifiés **ne peuvent pas** hériter d'une validation
  humaine qui aurait porté sur leur texte antérieur : une nouvelle validation
  humaine, nommée et datée, est requise avant toute publication.
- `SEO-001` conserve sa validation humaine du 24/07/2026, non remise en
  cause ; son `statut_sources` est relevé à `Validé` (H05 corrobore
  intégralement le lot S01-S06 déjà utilisé).
- **La validation des sources reste distincte de la validation humaine
  finale des contenus** : aucune validation humaine positive n'a été ajoutée
  par cette mission au-delà de celle déjà existante pour SEO-001.

## 7quater. Versions finales SOC-LI-001 / SOC-LI-002 (25/07/2026)

Antoine Legrand a transmis des versions finales réécrites pour les deux posts
de lancement LinkedIn. Avant écriture dans le fichier source, ces deux textes
ont été relus par l'agent `compliance-reviewer`, qui a consigné son verdict
dans `marketing-ai/compliance/revue-conformite-posts-lancement.md` (section
« Revue des versions finales proposées — 25/07/2026 ») : **prêt pour
validation humaine** pour les deux contenus, aucune correction de fond
nécessaire, raison sociale « Legrand conseils Sàrl » (c minuscule) utilisée
systématiquement et sans erreur.

Les textes ont ensuite été écrits dans
`marketing-ai/social-media/linkedin/post-lancement-officiel.md`, en
remplacement intégral des versions précédentes (conservées dans l'historique
Git). `SOC-LI-002` conserve la formulation d'indépendance corrigée en
Mission 3B (« j'examine différentes solutions parmi les compagnies avec
lesquelles je travaille, tout en conservant mon statut d'intermédiaire non
lié »).

**Aucune validation humaine positive n'a été ajoutée.** `SOC-LI-001` et
`SOC-LI-002` passent tous deux en classification
`Corrections appliquées — nouvelle validation humaine requise` dans
`marketing-ai/compliance/classement-contenus-publiables.md` : toute
validation humaine antérieure portait sur un texte désormais remplacé et ne
peut pas s'y reporter.

## 7quinquies. Validation humaine — SOC-LI-001 / SOC-LI-002 (26/07/2026)

Le 26/07/2026, Antoine Legrand a explicitement validé humainement les
versions finales du 25/07/2026 (voir §7quater) de `SOC-LI-001` et
`SOC-LI-002` : « Je valide les deux versions finales de SOC-LI-001 et
SOC-LI-002 pour publication manuelle. »

- `validation_humaine` passe à `Oui` pour les deux lignes, `responsable`
  renseigné à `Antoine Legrand`, `statut_conformite` passe à `Validé`.
- Cette validation porte exactement sur le texte réécrit du 25/07/2026
  (voir `marketing-ai/social-media/linkedin/post-lancement-officiel.md`) —
  elle ne concerne aucune version antérieure.
- **`statut_publication` reste `Non publié` et `date_publication` reste
  vide** : la validation autorise une **publication manuelle** par
  l'humain, pas une programmation ou une publication par un agent. Aucun
  agent ne peut renseigner `statut_publication=Publié` ni
  `date_publication` — ces champs restent réservés à l'action humaine
  réelle, après publication effective.

## 7sexies. Publication confirmée — SOC-LI-001 / SOC-LI-002 (05/09/2026)

Le 05/09/2026, Antoine Legrand a confirmé directement dans la session en
cours : « SOC-LI-001 et SOC-LI-002 sont publiés. »

- `statut_publication` passe de `Non publié` à `Publié` pour les deux
  lignes, conformément à la réserve posée en §7quinquies (« ces champs
  restent réservés à l'action humaine réelle, après publication
  effective »).
- `date_publication` et l'URL réelle des deux posts (`url_finale`) **ne sont
  pas renseignées** : la date exacte de mise en ligne et le lien n'ont pas
  été communiqués à cette occasion. Ces champs restent à compléter par un
  humain ou sur confirmation ultérieure — aucune date ni URL n'est
  inventée.
- Cette confirmation ne porte que sur la publication elle-même ; elle ne
  rouvre pas la validation humaine du texte (acquise le 26/07/2026,
  §7quinquies, sur le texte réécrit du 25/07/2026, §7quater) ni la revue de
  conformité (`marketing-ai/compliance/revue-conformite-posts-lancement.md`).

## 7. Ce que ce registre ne fait pas

- Il ne fixe **aucune** date de publication pour SEO-001 ou pour aucun contenu
  social : ces dates restent `À décider par l'humain` tant qu'une validation
  humaine et une confirmation d'URL n'ont pas eu lieu.
- Il n'invente **aucune** URL réelle du site, aucun identifiant de réseau
  social non confirmé, aucune donnée de performance.
- Il ne fait **régresser aucun statut** existant : SEO-001 reste au niveau de
  validation qu'il avait atteint dans le registre SEO historique (`validé`,
  puis validation humaine finale du 24/07/2026), simplement représenté avec les
  colonnes du registre central.
