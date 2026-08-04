# LOT 6 phase 1 — Contenu réel Vie et Prévoyance (brouillon, non publié)

> **Statut** : contenu **brouillon**, **non publié**, **non actif en
> production**. Provisionné par `server/seed-advisory-life-pension-content.js`
> (même mécanisme de contenu configuré que le LOT 5 — aucune nouvelle table,
> aucune migration, aucune nouvelle route). **Aucune publication réelle n'a
> eu lieu** : la publication (`publishVersion`/`publishRuleSet`) reste une
> décision humaine distincte, conditionnée à une validation juridique et
> métier séparée. Les tests (`test/advisory-life-pension-content-seed.test.js`)
> publient une copie de ce contenu dans une base de test **isolée**
> uniquement pour prouver sa conformité structurelle et son comportement
> réel ; cela ne constitue jamais une publication réelle.

## 1. Questionnaire

- `stable_key` : `diagnostic-vie-prevoyance-phase1`, domaine `life_pension`,
  statut **brouillon**.
- Une section, portée `member` (« Protection et prévoyance déclarées »).
- 10 questions, toutes `single_choice`, portée `member`, `allows_unknown:
  true`, `required: false` (même rationale que le LOT 5 : tolérer des
  réponses partielles, le mécanisme `missing_information` signale déjà
  correctement, par règle, ce qui manque).

| # | `stable_key` | Options | Sensible |
|---|---|---|---|
| 1 | `statut_professionnel_declare` | salarie / independant / sans_emploi / autre | non |
| 2 | `dependance_revenu_professionnel_declare` | oui / non | non |
| 3 | `personnes_dependantes_financierement_declare` | oui / non | **oui** |
| 4 | `couverture_deces_connue_declare` | oui / non | **oui** |
| 5 | `couverture_incapacite_gain_connue_declare` | oui / non | **oui** |
| 6 | `prevoyance_professionnelle_volontaire_connue_declare` | oui / non | non |
| 7 | `epargne_retraite_volontaire_existante_declare` | oui / non | non |
| 8 | `souhait_ameliorer_preparation_retraite_declare` | oui / non | non |
| 9 | `changement_familial_patrimonial_recent_declare` | oui / non | **oui** |
| 10 | `revision_recente_beneficiaires_protections_declare` | oui / non | **oui** |

**Classification conservatrice** : les questions révélant une structure
familiale/de dépendance (Q3), une lacune de couverture décès/incapacité
(Q4, Q5 — dimension émotionnellement sensible, décès/invalidité) ou un
changement familial/patrimonial et son suivi (Q9, Q10 — proche de la
succession) sont classées sensibles. Les faits professionnels/financiers
neutres (statut, dépendance au revenu, prévoyance volontaire connue,
épargne existante, souhait d'amélioration) restent « standard nLPD »,
cohérent avec `SECURITY_PRIVACY.md` (catégorie « Financière »).

**Aucune option « inconnue » littérale** : comme au LOT 5, le mécanisme
natif du moteur (`allows_unknown`/`is_unknown`) est utilisé pour « je ne
sais pas » sur les 9 questions oui/non — sauf pour la logique de la règle C
(voir §3).

## 2. Bibliothèque de règles (5, brouillon)

`rule_set` `regles-vie-prevoyance-phase1`, domaine `life_pension`, statut
**brouillon**.

| Règle | `category_hint` | `finding_type` | `priority` | Condition (résumé) |
|---|---|---|---|---|
| `deces-couverture-absente-01` | `deces_coverage_gap` | `gap` | `high` | personnes dépendantes = oui ET couverture décès connue = non |
| `incapacite-gain-couverture-absente-01` | `incapacite_gain_coverage_gap` | `gap` | `high` | dépendance au revenu = oui ET couverture incapacité connue = non |
| `independant-couverture-incertaine-01` | `independant_couverture_incertaine` | `warning` | `medium` | statut = indépendant ET (au moins une des 3 couvertures explicitement répondue « inconnue ») |
| `retraite-epargne-absente-01` | `retraite_epargne_besoin` | `detected_need` | `medium` | épargne retraite = non ET souhait d'amélioration = oui |
| `beneficiaires-situation-a-revoir-01` | `beneficiaires_situation_a_revoir` | `warning` | `medium` | changement récent = oui ET révision récente = non |

Toutes : `domain: life_pension`, `finding_scope: member`, condition racine
`{"op": "any", "over": "members", ...}` (jamais `all`).

**Aucune arithmétique de date, aucun calcul actuariel, aucune comparaison
fiscale** — vérifié empiriquement contre le vrai validateur de format
(`validateRuleConditionFormat`) et contre `validateRuleSetForPublish` une
fois le questionnaire publié en base de test isolée (0 erreur).

## 3. Règle C — mécanisme `answer_status` (décision délibérée)

La règle `independant-couverture-incertaine-01` doit détecter que la
personne **a explicitement répondu « je ne sais pas »** à au moins une des
trois questions de couverture, jamais une simple absence de réponse. Elle
utilise donc la nature de référence `answer_status` (une des 7 déjà
existantes du DSL, jamais une extension) pour comparer le **statut** de la
réponse (`unknown`) plutôt que sa valeur :

```json
{ "op": "equals", "ref": { "answer_status": "couverture_deces_connue_declare" }, "value": "unknown" }
```

**Conséquence délibérée sur `required_data`** : cette règle ne déclare que
`{"answer": "statut_professionnel_declare"}` dans `required_data` — jamais
les 3 questions de couverture elles-mêmes. Les inclure aurait fait basculer
toute réponse « inconnue » (statut ≠ `answered`) vers `missing_information`
avant même l'évaluation de la condition, ce qui aurait empêché la règle de
jamais se déclencher — contradiction avec son objet même (détecter
précisément cette incertitude). Une absence totale de réponse (jamais posée)
résout `answer_status` à `absent`, distinct de `unknown` — la règle ne se
déclenche donc que sur une incertitude **explicitement exprimée par le
client**, jamais sur une question simplement non atteinte.

**Limite connue, signalée par la revue `life-pension-domain`** : un
indépendant dont les 3 questions de couverture n'ont **jamais été posées ni
répondues** (`answer_status = absent`, jamais `unknown`) ne déclenche pas
la règle C — ce cas résiduel n'est que partiellement rattrapé par le
`missing_information` des règles A/B (qui référencent les deux mêmes
questions), et uniquement si les conditions de A/B sont elles-mêmes
pertinentes pour cette personne. Décision assumée pour cette phase 1
(cohérent avec l'intention du brief : détecter une incertitude **exprimée**,
pas une simple lacune de collecte) — **à confirmer explicitement par une
validation métier humaine avant publication** : soit accepter ce trou de
message spécifique aux indépendants, soit élargir la règle C au cas
« jamais répondu » dans une itération future.

**Thème identifié comme manquant pour une itération future** (signalé par
la revue `life-pension-domain`) : la réserve de sécurité / fonds d'urgence,
prévue dans `LIFE_PENSION_DIAGNOSTIC.md` mais absente de ce noyau de 5 —
hors périmètre de cette phase 1, à considérer pour la suite.

## 4. Limites (rappel explicite)

Aucune des 5 règles ne :
- choisit un produit, un assureur, un 3a ou un 3b ;
- calcule un capital, une rente ou tout montant ;
- établit une planification financière complète ;
- produit une recommandation ou une décision client ;
- donne un conseil successoral ou fiscal automatique ;
- collecte de salaire exact, patrimoine exact, diagnostic médical, détail
  médical, numéro de police, nom d'assureur, nom de produit, montant
  bancaire précis ou bénéficiaire nommé en texte libre.

Chaque règle signale uniquement un point à analyser ou un sujet de
discussion, avec un texte explicite rappelant cette limite.

## 5. Validation avant publication réelle (non faite par ce lot)

Avant tout passage `brouillon → publié` : confirmation par
`compliance-privacy-reviewer` de la classification de confidentialité des
5 questions sensibles ; revue finale par un rôle spécialisé Vie et
Prévoyance du contenu réel des 5 règles ; aucune source réglementaire
externe n'est citée par ce noyau (toutes les 5 règles reposent sur une
référence méthodologique interne, non une loi).

## 6. Articulation avec les recommandations humaines (LOT 7A/7B, inchangée)

Les findings produits par ces 5 règles sont sélectionnables un par un par
le conseiller pour créer une recommandation humaine — mécanisme déjà livré,
non modifié par ce lot. Aucune recommandation n'est jamais créée
automatiquement, aucun `advisor_rationale` n'est préremplli, aucun choix de
produit/assureur/3a/3b/capital n'est fait par le moteur.
