# Registre éditorial central — SEO

> Brouillon marketing. Documente le registre `registre-editorial.csv` — **le
> CSV est la source de vérité**, ce fichier Markdown en est la notice. Créé le
> 23/07/2026, dans le cadre de la préparation du workflow SEO (`content-strategist`
> → `seo-writer` → `seo-strategist` → `compliance-reviewer` → validation humaine).
> Voir aussi `../templates/content-validation-template.md` (fiche par contenu),
> `../templates/checklist-finale-avant-publication.md` (checklist finale) et
> `../strategy/registre-url-et-cta.md` (registre URL/CTA du social).

---

## 1. Rôle du registre

Le registre éditorial central donne une vue d'ensemble, ligne par ligne, de
**chaque contenu SEO** — du sujet envisagé jusqu'à sa publication éventuelle et
sa prochaine révision. Il ne remplace pas la fiche de validation détaillée par
contenu (`content-validation-template.md`) ni la checklist finale : il en est
la **vue consolidée**, utile pour piloter l'ensemble des contenus sans ouvrir
chaque fiche individuellement.

**Le fichier `registre-editorial.csv` est la source de vérité.** Ce fichier
Markdown documente sa structure et ses règles, mais n'est jamais lui-même
rempli avec des données de contenu.

---

## 2. Définition de chaque colonne

| Colonne | Définition |
|---|---|
| `id` | Identifiant unique et stable du contenu. |
| `titre` | Titre de travail de l'article. |
| `slug` | Slug d'URL envisagé (proposé par `seo-strategist`, confirmé par l'humain). |
| `silo` | LAMal / LCA / Prévoyance / Guides / Local. |
| `persona` | Persona principal visé (`../strategy/personas-prioritaires.md`). |
| `mot_cle_principal` | Mot-clé principal ciblé. |
| `variantes_lexicales` | Variantes et expressions associées. |
| `intention` | Intention de recherche (informationnelle, comparative, transactionnelle…). |
| `priorite` | P0 à P3. |
| `angle_differenciant` | Ce qui distingue ce contenu de la page pilier et des autres contenus. |
| `page_pilier` | Page pilier du site renforcée par ce contenu. |
| `statut` | Voir la liste des statuts autorisés (§3). |
| `agent_auteur` | Agent ayant produit le brouillon (`seo-writer`) ou mention « humain » si rédigé manuellement. |
| `sources_officielles` | Sources officielles citées ou attendues. |
| `date_validite` | Année ou date de validité des données citées. |
| `fact_check` | Statut du contrôle des faits (Non fait / En cours / Confirmé). |
| `seo_review` | Statut de la QA technique SEO (Non fait / En cours / Confirmé). |
| `compliance_review` | Statut du contrôle de conformité (Non fait / À corriger / Prêt pour validation humaine). |
| `validation_humaine` | Oui / Non. |
| `validateur` | Nom de la personne ayant validé. |
| `date_validation` | Date de la validation humaine. |
| `date_prevue` | Date de publication envisagée. |
| `date_publication` | Date de publication réelle (une fois publié). |
| `url_finale` | URL publique définitive, une fois confirmée. |
| `liens_internes_entrants` | Contenus/pages qui pointent vers ce contenu. |
| `liens_internes_sortants` | Contenus/pages vers lesquels ce contenu pointe. |
| `cta_principal` | Appel à l'action principal. |
| `statut_wordpress` | Non créé / Brouillon / Prévisualisé / Publié. |
| `date_prochaine_revision` | Date à laquelle les données doivent être revérifiées. |
| `notes` | Remarques libres. |

---

## 3. Statuts autorisés (colonne `statut`)

Dans l'ordre attendu du cycle de vie d'un contenu :

1. `idée`
2. `brief à créer`
3. `brief prêt`
4. `sources partiellement validées`
5. `rédaction en cours`
6. `brouillon prêt`
7. `SEO à vérifier`
8. `conformité à vérifier`
9. `corrections requises`
10. `prêt pour validation humaine`
11. `validé`
12. `brouillon WordPress`
13. `publié`
14. `à mettre à jour`
15. `archivé`

**`sources partiellement validées`** : les sources principales sont
documentées, mais certains points sensibles restent à vérifier avant
rédaction ou validation finale.

Un contenu peut revenir à `corrections requises` depuis `SEO à vérifier` ou
`conformité à vérifier` à tout moment — le cycle n'est pas strictement linéaire
dans ce sens (retour en arrière possible, jamais de saut direct vers `publié`).

---

## 4. Workflow de changement de statut

`idée` → `brief à créer` → `brief prêt` (par `content-strategist`) →
`sources partiellement validées` (recherche/vérification des sources
officielles, humaine ou par lot vérifié) →
`rédaction en cours` → `brouillon prêt` (par `seo-writer`) →
`SEO à vérifier` → corrigé si besoin (par `seo-strategist`) →
`conformité à vérifier` → corrigé si besoin (par `compliance-reviewer`) →
`prêt pour validation humaine` → `validé` (décision humaine) →
`brouillon WordPress` → `publié` (action humaine manuelle) →
`à mettre à jour` (à l'échéance de `date_prochaine_revision`) → nouveau cycle
de vérification, ou `archivé`.

Aucune étape de ce cycle ne peut être court-circuitée par un agent.

---

## 5. Rôles autorisés à modifier les champs

| Rôle | Peut proposer ou mettre à jour |
|---|---|
| `content-strategist` | `titre`, `silo`, `persona`, `mot_cle_principal`, `intention`, `priorite`, `angle_differenciant`, `page_pilier`, `date_prevue`. |
| `seo-writer` | Uniquement `agent_auteur`, le statut de rédaction (`rédaction en cours` → `brouillon prêt`), et `notes` (notes de brouillon). |
| `seo-strategist` | `seo_review`, `liens_internes_entrants`, `liens_internes_sortants`, corrections SEO, `slug`, `title`/`meta` si ajoutés ultérieurement. |
| `compliance-reviewer` | `sources_officielles`, `date_validite`, `fact_check`, `compliance_review`, et le statut `corrections requises` si nécessaire. |
| **L'humain** | **Tous les champs**, en particulier `validation_humaine`, `validateur`, `date_validation`, `statut_wordpress`, `date_publication`, `url_finale`, `date_prochaine_revision`. |

**Aucun agent ne peut, seul, marquer un contenu comme `publié`** ni renseigner
`date_publication` ou `url_finale` — ces champs sont réservés à l'action
humaine, après publication manuelle réelle.

---

## 6. Règle de validation humaine

Un contenu ne peut passer au statut `validé` que si :
- `compliance_review` = `Prêt pour validation humaine` (ou équivalent confirmé) ;
- `validation_humaine` = `Oui`, avec `validateur` et `date_validation` renseignés.

Sans ces deux conditions réunies, le contenu reste bloqué à un statut
antérieur, quel que soit l'avancement de la rédaction.

---

## 7. Règle de publication manuelle

Le passage à `statut_wordpress = Publié` et le remplissage de
`date_publication`/`url_finale` sont **toujours** des actions humaines,
réalisées après une publication manuelle réelle dans WordPress. Aucun agent
marketing ne dispose d'un accès à WordPress ou à son API — cette limite est
technique autant qu'organisationnelle (voir `CLAUDE.md`).

---

## 8. Règles sur les sources et les dates de validité

- Toute ligne dont `sources_officielles` ou `date_validite` est vide ne peut
  pas dépasser le statut `conformité à vérifier`.
- `date_prochaine_revision` doit être renseignée pour tout contenu marqué
  `publié` portant une donnée susceptible de changer (fiscalité, franchises,
  plafonds, délais, primes, règles cantonales).
- À l'échéance de `date_prochaine_revision`, le contenu repasse au statut
  `à mettre à jour`.

---

## 9. Règle anti-cannibalisation

Avant qu'un brief ne passe à `brief prêt`, `content-strategist` documente dans
`angle_differenciant` en quoi ce contenu ne reformule pas la page pilier
associée ni un autre contenu déjà présent dans ce registre (existant ou
planifié). Un contenu sans `angle_differenciant` renseigné ne doit pas
avancer au-delà de `brief à créer`.

---

## 10. Interdiction de lien vers /comparateur-lamal

Aucune ligne de ce registre, ni aucun contenu qu'elle décrit, ne doit
contenir de lien — direct ou en simple mention — vers `/comparateur-lamal`,
tant que la fiabilité, la maintenance et le rôle de conversion de cet outil ne
sont pas formellement validés. Cette règle est contrôlée à l'étape
`seo_review` et confirmée à l'étape `compliance_review`.

---

## 11. Historique des contenus

- **23/07/2026** — Initialisation des 6 premiers contenus du trimestre
  (`SEO-001` à `SEO-006`), avec uniquement les champs déjà connus renseignés
  (titre, silo, persona, mot-clé principal, intention, priorité, page pilier,
  statut, CTA principal — et l'angle différenciant pour `SEO-001` uniquement).
  Aucun brief, aucun brouillon, aucune source, aucune date de publication,
  aucune URL et aucune validation ne sont renseignés à ce stade — ces champs
  restent volontairement vides jusqu'à ce que l'information soit réellement
  disponible, conformément à la règle §1.
- **SEO-001** : brief stratégique créé, article non rédigé.
- **SEO-001** : lot de sources officielles intégré ; article non rédigé.
- **SEO-001** : outline créé, article non rédigé.
- **SEO-001** : brouillon v1 rédigé, non validé et non publié.
