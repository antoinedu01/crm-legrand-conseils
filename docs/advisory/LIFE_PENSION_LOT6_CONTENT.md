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
  true`. `required: false` reste la règle générale (même rationale que le
  LOT 5 : tolérer des réponses partielles, le mécanisme `missing_information`
  signale déjà correctement, par règle, ce qui manque) — **à l'exception des
  3 questions de couverture (Q4/Q5/Q6, `required: true`), corrigée lors de
  la validation humaine du dossier d'approbation, voir §3.**

| # | `stable_key` | Options | Sensible | Requise |
|---|---|---|---|---|
| 1 | `statut_professionnel_declare` | salarie / independant / sans_emploi / autre | non | non |
| 2 | `dependance_revenu_professionnel_declare` | oui / non | non | non |
| 3 | `personnes_dependantes_financierement_declare` | oui / non | **oui** | non |
| 4 | `couverture_deces_connue_declare` | oui / non | **oui** | **oui** |
| 5 | `couverture_incapacite_gain_connue_declare` | oui / non | **oui** | **oui** |
| 6 | `prevoyance_professionnelle_volontaire_connue_declare` | oui / non | non | **oui** |
| 7 | `epargne_retraite_volontaire_existante_declare` | oui / non | non | non |
| 8 | `souhait_ameliorer_preparation_retraite_declare` | oui / non | non | non |
| 9 | `changement_familial_patrimonial_recent_declare` | oui / non | **oui** | non |
| 10 | `revision_recente_beneficiaires_protections_declare` | oui / non | **oui** | non |

**Q6 — correction de fond apportée lors de la validation humaine du dossier
d'approbation** : le texte interrogeait initialement un **rachat volontaire**
(un versement ponctuel dans une prévoyance professionnelle déjà existante),
alors que la règle C a besoin de savoir si une personne indépendante dispose
ne serait-ce que d'une **affiliation facultative** au 2e pilier — une notion
antérieure et distincte du rachat (on ne peut racheter que dans une
institution à laquelle on est déjà affilié). Reformulé :
*« L'existence d'une affiliation facultative à une institution de
prévoyance professionnelle est-elle connue — posée à chaque membre,
particulièrement déterminante pour un statut indépendant ? »*
(texte conseiller) / *« Êtes-vous actuellement affilié(e), à titre
volontaire, à une caisse de pension ou à une institution de prévoyance
professionnelle ? »* (texte client). `stable_key`, options (oui/non) et
`allows_unknown: true` inchangés. **Correction supplémentaire (revue
`life-pension-domain`)** : la première formulation du texte conseiller
(« Pour la personne indépendante, … ») laissait à tort penser que la
question restait sautable pour un membre non indépendant, alors que
`required: true` (§1) s'applique à CHAQUE membre actif — corrigé pour ne
plus jamais suggérer une portée conditionnelle qui n'existe pas dans le
mécanisme réel. Ne jamais réintroduire le terme « rachat » pour cette
question dans ce document ou dans le code.

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

**Correction du cas silencieux (décision humaine du dossier d'approbation,
logique à modifier → appliquée)** : la version initiale de cette phase 1
laissait un indépendant dont les 3 questions de couverture n'auraient
**jamais été posées ni répondues** (`answer_status = absent`, jamais
`unknown`) sans jamais déclencher la règle C, ni aucun
`missing_information` la concernant — un trou d'analyse silencieux. Corrigé
en rendant les 3 questions de couverture `required: true` sur le
QUESTIONNAIRE (§1 ci-dessus, `allows_unknown: true` conservé) — un
mécanisme **déjà existant** (`validateSessionForCompletion`,
`server/advisorySessions.js`), distinct et complémentaire du `required_data`
d'une règle : il gouverne la finalisation de la SESSION, jamais
l'évaluation d'une règle précise. Aucune nouvelle règle
`missing_information` n'a été créée pour autant — `required_data` de la
règle C reste inchangé (`{"answer": "statut_professionnel_declare"}`
uniquement).

**Comportement résultant, les trois cas distingués** :
1. **Indépendant + au moins une des 3 couvertures explicitement répondue
   « inconnue »** → la règle C se déclenche normalement (inchangé).
2. **L'une des 3 questions de couverture jamais répondue** (pour n'importe
   quel membre, indépendant ou non) → la session ne peut plus atteindre le
   statut `completed` (`409`, `validateSessionForCompletion`) tant que la
   question reste sans réponse — une réponse `unknown` explicite suffit à
   satisfier cette exigence, seule une absence totale la bloque.
3. **Indépendant, les 3 couvertures répondues clairement (oui/non, aucune
   « inconnue »)** → la règle C ne se déclenche pas à cause de ces seules
   réponses (inchangé).

Conséquence directe du point 2 : aucun indépendant ne peut plus rester
silencieusement sans analyse par la règle C parce que ces 3 questions
n'auraient jamais été abordées — la session elle-même ne peut plus être
finalisée dans cet état, quel que soit le statut professionnel du membre
concerné (le mécanisme `required` s'applique à la question, pas
conditionnellement au statut indépendant).

**Deux limites résiduelles du correctif, identifiées par la revue
`rules-engine-auditor` lors de la correction du contenu — CORRIGÉES depuis
par un correctif dédié et distinct, `fix/advisory-session-completion-integrity`
(mécanisme de complétude des sessions, `server/advisorySessions.js`) : elles
n'affectaient jamais spécifiquement ce contenu LOT 5/LOT 6, mais tout
questionnaire comportant au moins une question `required: true` (ce noyau
étant, comme noté ci-dessous, le premier concerné) :**
1. **Contournement possible après finalisation (CORRIGÉ)** : `amendAnswer`
   (`server/advisorySessions.js`) permettait, sur une session déjà
   `completed`, de repasser une réponse à `status: 'cleared'` sur l'une des
   3 questions requises, sans jamais revalider la complétude ni ré-exécuter
   le moteur automatiquement. Corrigé : `amendAnswer` réévalue désormais la
   complétude dans la même transaction que l'amendement et, si elle devient
   invalide, ramène automatiquement la session à `in_progress` (nouvelle
   transition `completed -> in_progress`, jamais atteignable autrement,
   journalisée `session rouverte (amendement)`) — le mécanisme normal de
   réponse manquante redevient alors la seule voie de re-complétion.
2. **Membre historisé avant d'avoir répondu (CORRIGÉ)** : `validateSessionForCompletion`
   incluait les membres historisés du foyer (`can_answer: false`) dans le
   contrôle de complétude requise, alors qu'un membre retiré du foyer ne
   peut plus lui répondre (`assertMemberCanAnswer` refuse toute nouvelle
   réponse pour un membre non actif) — une session ayant démarré avec un
   membre ensuite retiré, avant que ce membre n'ait répondu à l'une de ces
   3 questions, ne pouvait donc plus jamais atteindre `completed`. Corrigé :
   un membre historisé est désormais exclu du contrôle de complétude requise
   (ses réponses déjà enregistrées, elles, restent intégralement conservées
   et consultables ; un membre encore actif continue de bloquer
   normalement). Ce n'était jamais observable avant le correctif de contenu
   qui a introduit `required: true` sur ces 3 questions : c'était la toute
   première fois qu'une question LOT 5/LOT 6 l'était (tout le reste du
   contenu métier reste `required: false`).

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
référence méthodologique interne, non une loi). La logique de la règle C a
été corrigée (§3, 3 questions de couverture `required: true`) sur décision
humaine du dossier d'approbation — **validation nLPD de la durée de
conservation toujours en attente** (aucune durée n'est fixée par cette
correction, hors périmètre, voir `SECURITY_PRIVACY.md` §9).

## 6. Articulation avec les recommandations humaines (LOT 7A/7B, inchangée)

Les findings produits par ces 5 règles sont sélectionnables un par un par
le conseiller pour créer une recommandation humaine — mécanisme déjà livré,
non modifié par ce lot. Aucune recommandation n'est jamais créée
automatiquement, aucun `advisor_rationale` n'est préremplli, aucun choix de
produit/assureur/3a/3b/capital n'est fait par le moteur.
