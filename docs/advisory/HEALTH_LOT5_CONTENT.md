# LOT 5 phase 1 — Contenu réel Assurance Maladie (brouillon, non publié)

> **Statut** : contenu **brouillon**, **non publié**, **non actif en
> production**. Provisionné par `server/seed-advisory-health-content.js`
> (mécanisme de contenu configuré existant, aucune nouvelle table, aucune
> migration, aucune nouvelle route — `createQuestionnaire`/`upsertSection`/
> `upsertQuestion`/`upsertOption` et `createRuleSet`/`upsertRule`, Lots
> 3A/4A). **Aucune publication réelle n'a eu lieu** : la publication
> (`publishVersion`/`publishRuleSet`) reste une décision humaine distincte,
> conditionnée à une validation juridique et métier séparée — voir §5
> ci-dessous. Les tests (`test/advisory-health-content-seed.test.js`)
> publient une copie de ce contenu dans une base de test **isolée**
> uniquement pour prouver sa conformité structurelle et son comportement
> réel ; cela ne constitue jamais une publication réelle.

## 1. Découpage phase 1 / phase 2

Ce lot est scindé en deux phases de réalisation, sous le même numéro de
roadmap (Lot 5) :

- **Phase 1 (ce document)** : uniquement des règles entièrement exprimables
  avec le moteur actuel — aucune arithmétique de date, aucun calcul par
  rapport à la date du jour, aucune extension backend, aucune migration,
  aucune nouvelle route.
- **Phase 2 (non conçue, non implémentée)** : règles à délais légaux
  (affiliation LAMal après arrivée, délais de résiliation de caisse/modèle).
  Trois options ont été présentées lors du cadrage, aucune retenue :
  extension minimale du DSL avec référence temporelle ; fait dérivé calculé
  côté serveur ; exclusion durable du moteur déterministe. **Aucune de ces
  options n'est implémentée par ce lot** — ne jamais lire ce document comme
  une preuve que les règles temporelles existent.

## 2. Questionnaire

- `stable_key` : `diagnostic-sante-phase1`, domaine `health`, statut
  **brouillon** (`advisory_questionnaires`/`advisory_questionnaire_versions`).
- Une section, portée `member` (« Coordination et besoins déclarés »).
- 9 questions, toutes `single_choice`, portée `member`, `allows_unknown:
  true`, **`required: false`** (délibéré — voir §4, limites).

| # | `stable_key` | Options | Sensible |
|---|---|---|---|
| 1 | `couverture_accident_hors_lamal_declaree` | oui / non | non |
| 2 | `accident_inclus_lamal_declare` | oui / non | non |
| 3 | `franchise_actuelle_niveau_declare` | basse / moyenne / elevee | **oui** |
| 4 | `capacite_absorber_depense_annuelle` | faible / moyenne / elevee | **oui** |
| 5 | `tolerance_risque_financier` | faible / moyenne / elevee | non |
| 6 | `parcours_premier_contact_obligatoire_declare` | oui / non | non |
| 7 | `refus_parcours_impose_declare` | oui / non | non |
| 8 | `intention_resilier_complementaire_declare` | oui / non | **oui** |
| 9 | `acceptation_nouvelle_complementaire_confirmee` | oui / non | **oui** |

**Correction apportée lors de la validation humaine du dossier
d'approbation (question 5, `tolerance_risque_financier`)** : le texte
client interrogeait initialement une alternative binaire (prime stable /
économiser), incohérente avec les 3 options réelles de la question
(faible/moyenne/élevée). Reformulé pour interroger directement le niveau :
« Quel niveau de risque financier êtes-vous prêt(e) à assumer en cas de
dépenses de santé imprévues ? ». Ni la règle `franchise-capacite-financiere-01`
ni ses seuils ne sont modifiés par cette correction.

**Choix délibéré — pas d'option « inconnue » littérale** : le mécanisme
natif du moteur de questionnaire (`allows_unknown` / `is_unknown`, voir
`QUESTIONNAIRE_ENGINE.md` §2) est utilisé pour « je ne sais pas », jamais
une option de choix supplémentaire. Une option littérale « inconnue »
produirait un statut de réponse `answered` (valeur = "inconnue"), compté
comme présent pour `required_data` — ce qui empêcherait le déclenchement du
mécanisme `missing_information` attendu. Le mécanisme natif (`status =
'unknown'`) n'est, lui, jamais compté comme présent (`RULES_ENGINE.md` §8),
ce qui produit exactement le comportement requis.

## 3. Bibliothèque de règles (5, brouillon)

`rule_set` `regles-sante-phase1`, domaine `health`, statut **brouillon**.

| Règle | `category_hint` | `finding_type` | `priority` | Condition (résumé) |
|---|---|---|---|---|
| `accident-coordination-doublon-01` | `accident_coordination` | `warning` | `medium` | couverture hors LAMal = oui ET accident inclus LAMal = oui |
| `accident-coverage-gap-01` | `accident_coverage_gap` | `gap` | `high` | couverture hors LAMal = non ET accident inclus LAMal = non |
| `franchise-capacite-financiere-01` | `franchise_financial_risk` | `detected_need` | `medium` | franchise = élevée ET (capacité = faible OU tolérance = faible) |
| `modele-soins-comportement-01` | `care_model_compatibility` | `warning` | `medium` | parcours imposé = oui ET refus du parcours = oui |
| `lca-continuite-resiliation-01` | `lca_coverage_continuity` | `warning` | `high` | intention de résilier = oui ET acceptation nouvelle complémentaire = non |

Toutes : `domain: health`, `finding_scope: member`, condition racine
`{"op": "any", "over": "members", ...}` (jamais `all` — chaque situation est
individuelle, un finding par membre réellement concerné).

**Exclusion mutuelle A/B** : garantie par construction (négation stricte
des deux mêmes réponses), jamais par le mécanisme `needs_review` (qui ne
s'active qu'entre règles différentes partageant un même `category_hint` —
aucun `category_hint` n'est partagé dans ce noyau de 5 règles).

**Sources** : `accident-coordination-doublon-01`/`accident-coverage-gap-01`
citent une référence OFSP — **corrigée lors de la validation humaine du
dossier d'approbation** : page OFSP « Assurés pouvant suspendre le risque
accidents », art. 8 al. 1 LAMal (suspension possible **uniquement sur
demande** de l'assuré, jamais automatique) et art. 11 OAMal (procédure de
suspension, preuve d'une couverture accident complète au sens de la LAA
requise). La référence initiale citait à tort l'art. 3 al. 2 LAMal — retirée,
cet article ne constitue pas la base légale de la suspension du risque
accident. **Consultée le 2026-08-04** (portée par `source_reference`,
jamais par `effective_from`, qui reste la date d'entrée en vigueur du
contenu de la règle — une notion distincte). La décision finale de
suspension relève toujours de l'assureur, jamais du moteur de règles. Les 3
autres règles citent une référence méthodologique interne, explicitement
non présentée comme une loi.

## 4. Limites (rappel explicite, aucune de ces garanties n'est optionnelle)

Aucune des 5 règles ne :
- choisit une caisse, un produit ou une complémentaire ;
- calcule une franchise optimale ou une économie garantie ;
- affirme une conclusion juridique définitive (délai légal, obligation de
  couverture) ;
- collecte de diagnostic médical, de traitement, de nom de médecin, de
  facture ou de texte médical libre ;
- aborde la grossesse ou la maternité (thème explicitement exclu de la
  phase 1 — voir §6).

Chaque règle signale uniquement un point à examiner par le conseiller, avec
un texte explicite rappelant cette limite.

**`required: false` sur les 9 questions** : décision délibérée — un
questionnaire conçu pour tolérer des réponses partielles (le mécanisme
`missing_information`, automatique et par règle, signale déjà correctement
ce qui manque pour conclure) ne doit pas bloquer la finalisation d'une
session tant qu'au moins une réponse manque.

## 5. Validation avant publication réelle (non faite par ce lot)

Avant tout passage `brouillon → publié` (questionnaire et rule_set) :
- validation juridique **formelle** (par un spécialiste qualifié) de la
  source OFSP citée par les règles A/B — la référence a été corrigée et
  datée (art. 8 al. 1 LAMal, art. 11 OAMal, consultée le 2026-08-04, voir
  §3 ci-dessus) sur décision humaine dans le dossier d'approbation, mais
  cette correction ne remplace pas une validation juridique formelle
  (délai, seuils, portée exacte — non vérifiés par ce lot) ;
- confirmation par `compliance-privacy-reviewer` de la classification de
  confidentialité des 4 questions sensibles ;
- revue finale par `health-insurance-domain` du contenu réel des 5 règles.

## 6. Grossesse et maternité — hors périmètre confirmé

Aucune question, aucune règle de ce noyau ne traite ce thème, même
indirectement. Un module futur facultatif nécessiterait une validation
métier, juridique, de confidentialité, un consentement et une formulation
dédiés, ainsi qu'une justification de nécessité — aucune de ces validations
n'est engagée par ce lot.

## 7. Articulation avec les recommandations humaines (LOT 7A/7B, inchangée)

Les findings produits par ces 5 règles sont sélectionnables un par un par
le conseiller pour créer une recommandation humaine — mécanisme déjà livré,
non modifié par ce lot. Aucune recommandation n'est jamais créée
automatiquement, aucun `advisor_rationale` n'est préremplli, aucun choix de
caisse/franchise/complémentaire/produit/assureur n'est fait par le moteur.
