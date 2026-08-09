# Diagnostic Santé v2 — Moteur de besoins

> **Statut** : contenu **brouillon**, **non publié**, **non actif en
> production**. Provisionné par `server/seed-advisory-health-content.js`,
> fonction `seedAdvisoryHealthContentV2()`, ajoutée à côté de
> `seedAdvisoryHealthContent()` (v1 — voir `HEALTH_LOT5_CONTENT.md`) sans
> jamais la modifier. **v1 reste immuable et reproductible** : aucune ligne
> v1 (`advisory_questionnaire_versions` version 1, `advisory_rule_sets`
> version 1) n'est touchée par ce lot — `test/advisory-health-content-seed-v2.test.js`
> le vérifie explicitement par snapshot avant/après (`snapshotV1()` +
> `assert.deepEqual`).
> **Aucune publication réelle n'a eu lieu** : `publishVersion`/
> `publishRuleSet` ne sont jamais appelées par `seedAdvisoryHealthContentV2`.
> Les tests publient une copie de ce contenu dans une base de test
> **isolée** (`CRM_DATA_DIR` temporaire) uniquement pour prouver sa
> conformité structurelle (`validateVersionForPublish`/
> `validateRuleSetForPublish`) et son comportement réel (exécution de
> scénarios) ; cela ne constitue jamais une publication réelle ni une
> décision métier/juridique.
>
> **Nommage** : ce document et ce contenu sont nommés « Diagnostic Santé
> v2 », jamais « LOT 7A »/« LOT 7B » — ces 2 labels sont déjà utilisés par
> le dépôt pour une fonctionnalité distincte (recommandations humaines,
> `server/advisoryRecommendations.js`, `docs/advisory/IMPLEMENTATION_ROADMAP.md`).
> Ce fichier remplace `HEALTH_LOT7A_V2_CONTENT.md` (renommé sur décision
> humaine pour éviter cette collision) ; `seedAdvisoryHealthContentV2()` et
> les `stable_key` restent inchangés — le renommage ne touche que la
> documentation.

## 1. Relation avec v1 (LOT 5)

Même `stable_key` que v1 pour le questionnaire (`diagnostic-sante-phase1`)
et le rule_set (`regles-sante-phase1`) :

- **Questionnaire** : v2 est une nouvelle ligne `advisory_questionnaire_versions`
  (`version_number = 2`) sous le même `advisory_questionnaires.id` que v1 —
  mécanisme natif de versionnement de questionnaire, déjà utilisé ailleurs
  dans le moteur.
- **Rule set** : v2 est une nouvelle ligne `advisory_rule_sets`
  (`version_number = 2`) partageant le même `stable_key` que v1, créée via
  `createDraftVersion(ruleSetV1.id, {...}, req)` — jamais la même ligne que
  v1, jamais un clone qui copierait les règles v1 dans v2 (v2 redéfinit ses
  37 règles explicitement).

v1 n'est reconduite ni intégralement ni implicitement : chaque question et
chaque règle v2 est une entrée explicite du code (voir §2/§3), y compris
pour les 9 questions et les 4 règles reprises telles quelles de v1.

## 2. Questionnaire v2 — 24 questions, 4 sections

`stable_key` : `diagnostic-sante-phase1`, domaine `health`, version 2,
statut **brouillon**. Toutes les questions : portée `member`, `single_choice`,
`allows_unknown: true` (mécanisme natif « je ne sais pas », jamais une
option littérale — même raisonnement qu'en v1, voir `HEALTH_LOT5_CONTENT.md`
§2). Nouveauté v2 : `required` et `display_condition` sont désormais portés
explicitement par question (v1 figeait `required: false`/`display_condition:
null` pour tout le noyau).

### Section 1 — Coordination et besoins déclarés (10 questions)

9 des 10 questions reconduisent exactement les `stable_key`/textes de v1
(seules les métadonnées `required`/`display_condition`/`sort_order`
changent) ; 1 est nouvelle (`couverture_accident_laa_employeur_declaree`).
**Ordre corrigé par arbitrage humain post-revue** : la question
`couverture_accident_laa_employeur_declaree` suit désormais immédiatement
sa question déclenchante (`couverture_accident_hors_lamal_declaree`), au
lieu d'être placée en fin de section — même patron que les 2 autres
conditionnelles de la section (chacune suit immédiatement sa question
déclenchante).

| # | `stable_key` | Statut | `display_condition` |
|---|---|---|---|
| 1 | `couverture_accident_hors_lamal_declaree` | CORE_REQUIRED | — |
| 2 | `couverture_accident_laa_employeur_declaree` (**nouvelle**) | CONDITIONAL_REQUIRED | #1 = oui |
| 3 | `accident_inclus_lamal_declare` | CORE_REQUIRED | — |
| 4 | `franchise_actuelle_niveau_declare` | CORE_REQUIRED | — |
| 5 | `capacite_absorber_depense_annuelle` | CORE_REQUIRED | — |
| 6 | `tolerance_risque_financier` | CORE_REQUIRED | — |
| 7 | `parcours_premier_contact_obligatoire_declare` | OPTIONAL | — |
| 8 | `refus_parcours_impose_declare` | CONDITIONAL_REQUIRED | #7 = oui |
| 9 | `intention_resilier_complementaire_declare` | OPTIONAL | — |
| 10 | `acceptation_nouvelle_complementaire_confirmee` | CONDITIONAL_REQUIRED | #9 = oui |

`couverture_accident_laa_employeur_declaree` (position 2) : nouvelle
question, demande si la personne est couverte contre les accidents non
professionnels par la LAA de son employeur — affichée uniquement si la
question 1 (couverture accident hors LAMal) = oui. Aucun seuil horaire
légal (art. 13 OLAA) n'est encodé ni mentionné : la question se limite au
fait déclaré, jamais à une qualification juridique de la couverture.

### Section 2 — Usage et priorités (3 questions, toutes CORE_REQUIRED)

| `stable_key` | Options | Sensible |
|---|---|---|
| `recours_soins_12_mois_declare` | faible / modéré / important | **oui** |
| `depenses_sante_anticipees_declare` | aucune / probablement faibles / probablement modérées / probablement importantes | **oui** |
| `priorite_prime_liberte_declaree` | réduire la prime / équilibre / maximiser la liberté | non |

### Section 3 — Modèle de soins, préférences (5 questions)

| `stable_key` | Statut | Options |
|---|---|---|
| `importance_conserver_medecin_declaree` | CORE_REQUIRED | important / non important / pas de médecin habituel / indifférent |
| `ouverture_telemedecine_declaree` | OPTIONAL | refuse / accepte / préférée |
| `ouverture_medecin_famille_declaree` | OPTIONAL | refuse / accepte / préférée |
| `ouverture_hmo_reseau_declaree` | OPTIONAL | refuse / accepte / préférée |
| `priorite_libre_choix_declaree` | OPTIONAL | non prioritaire / prioritaire |

Toutes non sensibles.

### Section 4 — Complémentaires, besoins déclarés (6 questions, toutes OPTIONAL)

Échelle commune : important / éventuellement / pas important. Toutes non
sensibles.

`interet_complementaire_hospitalisation_declare`,
`interet_medecines_complementaires_declare`,
`interet_complementaire_optique_declare`,
`interet_complementaire_dentaire_declare`, `interet_prevention_declare`,
`interet_couverture_voyage_declare`.

### Bilan CORE_REQUIRED / OPTIONAL / CONDITIONAL_REQUIRED

9 CORE_REQUIRED (5 en section 1 + 3 en section 2 + 1 en section 3),
3 CONDITIONAL_REQUIRED (`couverture_accident_laa_employeur_declaree`,
`refus_parcours_impose_declare`, `acceptation_nouvelle_complementaire_confirmee`,
chacune conditionnée à une réponse « oui » précédente), 12 OPTIONAL (2 en
section 1 + 4 en section 3 + 6 en section 4). Total 24.

## 3. Rule set v2 — 37 règles

`stable_key` : `regles-sante-phase1`, domaine `health`, version 2, statut
**brouillon**. Toutes : `domain: health`, `finding_scope: member`, condition
racine `{"op": "any", "over": "members", ...}` (jamais `all`).

### Reconduites inchangées de v1 (4)

`accident-coordination-doublon-01`, `accident-coverage-gap-01`,
`modele-soins-comportement-01`, `lca-continuite-resiliation-01` — mêmes
conditions, mêmes textes, même source. **`franchise-capacite-financiere-01`
n'est délibérément pas reconduite** (voir §4).

### C. Accident (2)

| Règle | `category_hint` | Condition (résumé) |
|---|---|---|
| `accident-lamal-maintien-01` | `accident_lamal_maintien` | accident inclus LAMal = oui ET (pas de couverture hors LAMal OU pas de LAA employeur confirmée) |
| `accident-lamal-retrait-examinable-01` | `accident_lamal_retrait_examinable` | accident inclus LAMal = oui ET couverture hors LAMal = oui ET LAA employeur = oui |

Réutilisent la source OFSP déjà validée en v1 (`SOURCE_OFSP_ACCIDENT`).
Aucune déduction automatique de retrait — formulation « potentiellement
examinable », jamais un fait acquis.

**Chevauchement avec `accident-coordination-doublon-01` — accepté et
documenté par décision humaine** : cette règle v1 (2 variables) se
déclenche systématiquement en même temps que l'une des 2 règles ci-dessus
dès que la nouvelle question (LAA employeur) est répondue — cas le plus
fréquent en pratique (salarié couvert par la LAA de son employeur). Ce
n'est jamais fusionné ni modifié : la première décrit une situation de
coordination/doublon potentiel à vérifier, les secondes décrivent
l'orientation (maintien/retrait) à examiner — 2 niveaux d'information
complémentaires. Un futur LOT de synthèse devra les présenter ensemble
intelligemment ; documenté en commentaire de code au-dessus de
`ACCIDENT_RULES_V2`.

### D. Franchise — orientation (3)

`franchise-orientation-elevee-01`, `franchise-orientation-prudente-01`,
`franchise-orientation-indeterminee-01`. `required_data` : les 4 mêmes
données pour les 3 règles (`capacite_absorber_depense_annuelle`,
`tolerance_risque_financier`, `recours_soins_12_mois_declare`,
`depenses_sante_anticipees_declare`) — la franchise actuelle **ne participe
pas** à l'orientation. Conditions exactes en §4.

### E. Franchise — comparaison à l'actuelle (7)

`franchise-comparaison-alignee-elevee-01`,
`franchise-comparaison-ecart-elevee-basse-01`,
`franchise-comparaison-contextuelle-elevee-moyenne-01`,
`franchise-comparaison-alignee-prudente-01`,
`franchise-comparaison-ecart-prudente-elevee-01`,
`franchise-comparaison-contextuelle-prudente-moyenne-01`,
`franchise-comparaison-impossible-indeterminee-01` — table complète en §4.
Toutes utilisent `FRANCHISE_REQUIRED_5` (5 données, dont la franchise
actuelle), **sauf** `franchise-comparaison-impossible-indeterminee-01` qui
utilise `FRANCHISE_REQUIRED_4` (sa condition ne lit jamais la franchise
actuelle — correction post-revue, voir §6).

### F. Modèles de soins (12)

3 règles par famille (`compatible`/`preferee`/`refusee`, sur
accepte/préférée/refuse) pour télémédecine, médecin de famille, HMO (9
règles), plus `libre-choix-prioritaire-01`, `libre-choix-non-prioritaire-01`
et `importance-medecin-actuel-01` (conservation du médecin actuel,
`detected_need`, jamais classée `warning` par défaut).

### G. Priorité coût/liberté (3)

`priorite-cout-eleve-01`, `priorite-equilibre-cout-liberte-01`,
`priorite-liberte-elevee-01` — `required_data` unique :
`priorite_prime_liberte_declaree`, mutuellement exclusives par construction
(une seule valeur possible pour cette réponse).

### H. Complémentaires (6)

`complementaire-hospitalisation-a-examiner-01`,
`complementaire-medecines-alternatives-a-examiner-01`,
`complementaire-optique-a-examiner-01`,
`complementaire-dentaire-a-examiner-01`,
`complementaire-prevention-a-examiner-01`,
`complementaire-voyage-a-examiner-01` — condition : intérêt déclaré IN
[important, éventuellement] ; aucun finding si « pas important ». Chacune
rappelle explicitement qu'une acceptation médicale n'est jamais garantie
(examen de risque de l'assureur).

**Total : 4 + 2 + 3 + 7 + 12 + 3 + 6 = 37 règles.** (inchangé depuis la
première version de v2 — les arbitrages de ce document ne touchent ni au
nombre de questions, ni au nombre de règles, ni à aucune condition de
règle.)

## 4. Différences volontaires par rapport à v1

- **`required`/`display_condition` désormais utilisés** : v1 figeait les 9
  questions à `required: false` (conçu pour tolérer des réponses
  partielles, `missing_information` faisant le reste). v2 introduit un
  noyau réellement obligatoire (9 CORE_REQUIRED) et des questions
  conditionnelles bloquantes (3 CONDITIONAL_REQUIRED), décision humaine
  explicite du cadrage v2.
- **`capacite_absorber_depense_annuelle` — texte v2 corrigé, v1 intact** :
  décision humaine explicite. Le texte v1 (`QUESTIONS`, dans
  `server/seed-advisory-health-content.js`) reste **strictement
  inchangé** (« Pourriez-vous absorber une dépense de santé imprévue
  importante sur une année ? », question fermée oui/non). En v2
  uniquement, `client_text`/`advisor_text` sont reformulés pour annoncer
  explicitement l'échelle attendue (faible/moyenne/élevée) :
  « Comment évaluez-vous votre capacité financière à absorber une dépense
  de santé annuelle importante ? » (client) — même défaut déjà corrigé
  pour `tolerance_risque_financier` en v1 (voir `HEALTH_LOT5_CONTENT.md`
  §2), appliqué ici par analogie mais seulement à partir de v2. Les 3
  options (`faible`/`moyenne`/`elevee`) restent inchangées.
- **`franchise-capacite-financiere-01` non reconduite en v2** : reste
  intacte et immuable dans `regles-sante-phase1` v1 (jamais supprimée ni
  modifiée là où elle existe) mais absente de v2 — remplacée
  fonctionnellement par les 3 règles d'orientation + 7 règles de
  comparaison (§3 D/E), plus riches (4 données au lieu de 2, distinction
  orientation vs état actuel), en v2 uniquement.
- **Nouvelle question `couverture_accident_laa_employeur_declaree`** :
  permet aux 2 nouvelles règles accident (§3 C) de distinguer maintien vs
  retrait potentiellement examinable, absente du noyau v1.
- **`rule_result` délibérément écarté pour les dépendances franchise** :
  le cadrage envisageait `rule_result` (référence au résultat d'une autre
  règle, `RULES_ENGINE.md` §2) « si cela permet d'éviter de dupliquer
  proprement ». Vérification dans `server/advisoryRuleExecutions.js`
  (`ruleResults`) : le résultat d'une règle `finding_scope: member` y est
  stocké comme **un seul booléen par exécution** (`anyTriggered`, vrai dès
  qu'au moins un membre du foyer a déclenché la règle) — jamais un résultat
  par membre. L'utiliser pour « indéterminée » ou pour la comparaison
  contaminerait donc les membres entre eux dans un foyer à plusieurs
  personnes (un membre A « élevée » ferait taire à tort la règle
  « indéterminée » pour un membre B réellement indéterminé) — exactement le
  risque que ce moteur s'interdit par ailleurs (isolation stricte entre
  membres). Les conditions sont donc dupliquées **explicitement** via des
  fonctions JS partagées (`andC`/`orC`/`notC`/`inC`, mêmes fonctions
  utilisées partout ailleurs dans le fichier — jamais un second moteur),
  conformément à la clause de repli du cadrage. Documenté dans le code
  (`server/seed-advisory-health-content.js`, commentaire au-dessus de
  `FR`/`franchiseEleveeCondition`).
- **Franchise actuelle exclue de l'orientation** : `franchise_actuelle_niveau_declare`
  ne fait partie du `required_data` d'aucune des 3 règles d'orientation
  (§3 D) — seulement de 6 des 7 règles de comparaison (§3 E — voir §3 pour
  l'exception `impossible-indeterminee-01`), pour éviter que l'orientation
  « ce qui serait adapté » soit biaisée par « ce qui est actuellement en
  place ».
- **Modèles de soins — convention honnête** : chaque règle de modèle de
  soins déclare son `required_data` réel (la question dont elle dépend),
  sans convention muette/propriétaire pour masquer les doublons — la
  déduplication de `missing_information` visible au conseiller est déjà
  assurée par la projection existante (`getSessionFindingsWorkspace`, LOT
  4B), pas par une convention de contenu.

### Conditions exactes — orientation de franchise (§3 D)

- **Élevée** : `capacite_absorber_depense_annuelle == elevee` ET
  `tolerance_risque_financier == elevee` ET
  `recours_soins_12_mois_declare == faible` ET
  `depenses_sante_anticipees_declare IN [aucune, probablement_faibles]`.
- **Prudente** : `signal_fort` (`capacite == faible` OU `depenses ==
  probablement_importantes`) OU (`tolerance == faible` ET `recours ==
  important`) OU (`tolerance == faible` ET `depenses ==
  probablement_moderees`) OU (`recours == important` ET `depenses ==
  probablement_moderees`) — forme explicite OR-de-AND, jamais un comptage
  générique de signaux.
- **Indéterminée** : NOT(élevée OU prudente), sur les 4 mêmes données
  (`required_data` identique aux 2 autres orientations) — le contrôle de
  complétude des données (`missing_information`) s'applique **avant** la
  négation, jamais après.

### Table complète — comparaison franchise (§3 E)

| Orientation | Franchise actuelle | Résultat | Type |
|---|---|---|---|
| Élevée | élevée | alignée | `fact` |
| Élevée | basse | écart | `detected_need` |
| Élevée | moyenne | contextuelle | `fact` |
| Prudente | basse | alignée | `fact` |
| Prudente | élevée | écart | `detected_need` |
| Prudente | moyenne | contextuelle | `fact` |
| Indéterminée | (toute valeur, y compris inconnue) | comparaison impossible | `fact` |

Aucune formulation « changez votre franchise » dans aucune des 7 règles.

### Nature de la donnée `franchise_actuelle_niveau_declare` (clarification, aucun changement de structure)

Décision humaine explicite : cette donnée **reste** une catégorie
qualitative à 3 niveaux (`basse`/`moyenne`/`elevee`), non modifiée par ce
lot. Points à retenir, documentés ici pour éviter toute mauvaise
interprétation future :

- il s'agit d'une **catégorie déclarée par le client**, jamais d'une
  mesure — aucune précision de montant n'est demandée ni stockée ;
- elle **ne représente pas une détermination économique de la franchise
  optimale** — les 7 règles de comparaison (§3 E) ne calculent jamais un
  montant, une économie, ni une franchise recommandée, seulement un écart
  qualitatif entre orientation et niveau déclaré ;
- **aucune correspondance CHF basse/moyenne/élevée n'est inventée** dans ce
  contenu — ni dans le code, ni dans ce document ; les montants réels de
  franchise LAMal (0/100/200/300/400/500/600/1000/1500/2000/2500 CHF)
  existent ailleurs dans le CRM (`contract_lamal.deductible`,
  `docs/CONTRATS_ASSURANCE_SUISSE.md` §2.1) mais ne sont jamais référencés
  ni mappés ici ;
- un futur **LOT de synthèse** devra privilégier la franchise exacte du
  contrat structuré (`contract_lamal.deductible`) lorsqu'elle est
  disponible, plutôt que cette catégorie déclarative, chaque fois que les
  deux sources coexistent pour un même membre ;
- le futur **moteur tarifaire** (non conçu, non engagé par ce lot)
  travaillera sur les montants officiels/réels des caisses, jamais sur
  cette catégorie qualitative.

## 5. Sécurité architecturale (rappel explicite)

Aucune des 37 règles ne :
- crée de recommandation automatiquement (`advisory_recommendation`) — les
  findings restent sélectionnables un par un par le conseiller, mécanisme
  de recommandations humaines (LOT 7A/7B) inchangé ;
- choisit ni ne nomme un produit, un assureur, une prime ou un tarif fictif ;
- affirme une conclusion juridique définitive (retrait/suspension toujours
  « potentiellement examinable », jamais automatique) ;
- présente une acceptation médicale de complémentaire comme garantie ;
- qualifie une franchise d'« optimale », de « meilleure », ni ne promet une
  économie garantie.

`seedAdvisoryHealthContentV2()` ne modifie jamais v1, ne publie jamais
automatiquement, n'archive jamais une version publiée, et n'écrit jamais
sur `data/crm.sqlite` (exécutée uniquement en base isolée
`CRM_DATA_DIR`, y compris par les tests).

## 6. Revues et corrections apportées (post-implémentation, 2 rounds)

### Round 1 — 4 revues ciblées après l'implémentation initiale

`rules-engine-auditor`, `health-insurance-domain`, `advisory-architect`,
`client-meeting-ux`, avec pour consigne explicite de rechercher :
conclusions trop affirmatives, contradictions entre règles, chevauchements,
`required_data` incorrect, `display_condition` incorrecte, doublons de
`missing_information` visibles, collecte de données sensibles inutile,
questions ambiguës en rendez-vous, formulations pouvant être lues comme un
conseil définitif, non-reproductibilité de v1.

**Corrections appliquées immédiatement :**

- **`required_data` incorrect** (`franchise-comparaison-impossible-indeterminee-01`,
  E7) : déclarait `FRANCHISE_REQUIRED_5` (5 données, dont
  `franchise_actuelle_niveau_declare`) alors que sa condition
  (`franchiseIndetermineeCondition()`) ne lit que 4 données — corrigé en
  `FRANCHISE_REQUIRED_4`.
- **Ton trop affirmatif** (`franchise-comparaison-alignee-elevee-01`,
  `franchise-comparaison-alignee-prudente-01`) : `advisor_explanation`
  affirmait « est alignée » sans nuance — uniformisé sur « semble
  alignée ».
- **`client_text` ambigus** (questions propres à v2 uniquement) :
  `depenses_sante_anticipees_declare`, `priorite_prime_liberte_declaree`
  et `importance_conserver_medecin_declaree` reformulées pour annoncer
  explicitement leur échelle de réponse.
- **Chevauchements documentés** (non corrigés par changement de règle au
  round 1) : D3/E7 (conditions strictement identiques) et
  `accident-coordination-doublon-01`/règles accident v2 — voir §3 C et §6
  round 2 pour la confirmation de ces décisions.

### Round 2 — arbitrages humains finaux

- **Ordre de la question LAA (§2)** : `couverture_accident_laa_employeur_declaree`
  déplacée immédiatement après sa question déclenchante — voir §2.
  `stable_key`, options, `display_condition` et `required` inchangés ; seul
  `sort_order` a changé. Test dédié ajouté
  (`test/advisory-health-content-seed-v2.test.js`).
- **Texte `capacite_absorber_depense_annuelle` (v2 uniquement)** : corrigé
  — voir §4. v1 strictement intacte.
- **Nature qualitative de `franchise_actuelle_niveau_declare`** : clarifiée
  explicitement — voir §4, aucun changement de structure.
- **Renommage documentaire** : ce fichier remplace
  `HEALTH_LOT7A_V2_CONTENT.md` pour éviter la collision de label avec la
  fonctionnalité de recommandations déjà livrée sous « LOT 7A »/« LOT 7B ».
  Toutes les mentions internes (« LOT 7A », « futur LOT 7B ») ont été
  remplacées par « Diagnostic Santé v2 » et « futur LOT de synthèse »,
  dans ce document et dans les commentaires de
  `server/seed-advisory-health-content.js`/`test/advisory-health-content-seed-v2.test.js`
  qui désignaient ce contenu précis (jamais dans les mentions qui
  désignent réellement la fonctionnalité de recommandations existante,
  laissées inchangées).
- **Chevauchement `accident-coordination-doublon-01`** : confirmé accepté
  et documenté par décision humaine — aucune fusion, aucune modification
  de la règle v1 reconduite. Voir §3 C.
- **Priorités des findings** : vérifiées, aucune incohérence trouvée entre
  `priority` et `finding_type` — voir §6bis pour le détail de cette
  vérification.
- **Classification `sensitive`** : revue ciblée par `compliance-privacy-reviewer`
  — voir §6ter pour le résultat complet.

### Round 3 — arbitrages humains de clôture

- **`interet_medecines_complementaires_declare` — `sensitive` définitivement
  confirmée `false`** : décision humaine finale, clôturant le point ambigu
  soulevé au round 2. Voir §6ter pour la justification complète (la
  question porte exclusivement sur le souhait d'examiner une couverture
  d'assurance, jamais sur un diagnostic/traitement/fréquence de recours) et
  la limite explicite de `sensitive` comme classification interne de
  protection, non une qualification juridique nLPD/RGPD définitive.
- **Texte `capacite_absorber_depense_annuelle` (v2 uniquement) — dernière
  amélioration UX** : `client_text`/`advisor_text` alignés sur « Comment
  évaluez-vous votre capacité financière à absorber une dépense de santé
  annuelle importante : faible, moyenne ou élevée ? » — énumère désormais
  explicitement l'échelle, résolvant la dernière hétérogénéité de style
  relevée par `client-meeting-ux` au round 2 (voir §4). v1 strictement
  inchangée ; options (`faible`/`moyenne`/`elevee`) inchangées.
- Aucune condition de règle, aucun `required_data`, aucun `stable_key`
  modifié par ce round — 24 questions et 37 règles inchangés. Les 4 grands
  reviewers ne sont pas relancés (aucune logique métier/règle modifiée).

### 6bis. Vérification des priorités (round 2, aucun changement de code)

Vérification demandée : (1) les écarts de franchise ne sont pas classés
moins importants qu'un simple `fact` ; (2) l'orientation indéterminée
n'est pas présentée comme une alerte critique ; (3) aucune priorité n'est
manifestement contradictoire avec son `finding_type`.

- Les 2 règles d'écart (`franchise-comparaison-ecart-*`) portent
  `priority: medium` ; les règles `alignée`/`contextuelle` (`fact`)
  portent `priority: low` — un écart n'est donc jamais moins prioritaire
  qu'un simple fait constaté. **(1) confirmé.**
- `franchise-orientation-indeterminee-01` porte `priority: low` — jamais
  présentée comme critique. **(2) confirmé.**
- Aucune règle ne porte une `priority` manifestement incohérente avec son
  `finding_type` (les `gap`/`detected_need` restent `medium`/`high`, les
  `fact` restent `low`, les `solution_category` varient selon le degré de
  certitude du signal). **(3) confirmé.**

Conclusion : cohérent, **aucun changement appliqué** (conformément à la
consigne : ne pas construire une nouvelle méthodologie de priorité).

### 6ter. Revue ciblée de la classification `sensitive` (round 2, `compliance-privacy-reviewer`)

Revue des 24 questions v2, distinguant 4 catégories : **A** donnée de santé
(ou révélant raisonnablement un état/usage de santé), **B** donnée
financière, **C** préférence contractuelle/comportementale, **D** donnée
administrative. Référentiel interne déjà en place utilisé comme base de
cohérence : `SECURITY_PRIVACY.md` §1 (catégorie « Sensible — association
indirecte à la santé », exemples déjà cités : franchise, consommation
médicale déclarée, statut d'affiliation).

**22 des 24 classifications confirmées correctes**, y compris les 2 cas les
plus manifestement de catégorie A du lot (`recours_soins_12_mois_declare`,
`depenses_sante_anticipees_declare`, déjà `sensitive: true`) et les 5
questions de modèles de soins (section 3, catégorie C, `sensitive: false`
confirmé — aucune ne révèle un état de santé, même indirectement).

**1 correction non ambiguë appliquée** : `tolerance_risque_financier`
(catégorie B, portant sur le même objet qu'un scénario de dépense de
santé que `capacite_absorber_depense_annuelle` et
`franchise_actuelle_niveau_declare`, déjà `sensitive: true` pour un
raisonnement identique) — classification actuelle `false`, proposée et
**appliquée** `true` (en v2 uniquement, v1 non touchée). Justification :
incohérence interne sans raison objective entre 2 questions structurellement
identiques ; le changement n'améliore que la protection (badge + entrée
d'audit `sensitivity_at_execution` supplémentaire lors d'une exécution de
règle, `advisoryRuleExecutions.js`) et ne modifie aucun comportement
fonctionnel existant ni la ligne v1.

**1 point ambigu, tranché par décision humaine finale** :
`interet_medecines_complementaires_declare` (section 4) — contrairement
aux 5 autres questions de complémentaires (préférence de produit générique,
catégorie C), celle-ci nomme des modalités de soin précises
(« naturopathie, ostéopathie, etc. »). Le reviewer avait signalé qu'un
intérêt déclaré pour cette complémentaire précise pourrait être lu comme
révélant un usage ou besoin de soin déjà existant (plus proche de la
catégorie A), sans trancher lui-même.
- Classification actuelle et **définitive** : `false` — **confirmée par
  décision humaine**, arbitrage clos.
- Classification proposée par le reviewer à titre indicatif : `true` — non
  retenue.
- **Justification de la décision humaine** : la question, telle qu'elle est
  réellement posée, porte exclusivement sur le souhait d'examiner une
  **couverture d'assurance** pour cette catégorie de soins — elle ne
  demande aucun diagnostic, aucune pathologie, aucun traitement en cours,
  aucune fréquence réelle de recours aux soins, ni aucune information sur
  l'état de santé. `sensitive` reste donc `false`, cohérent avec les 5
  autres questions de la section.
- **Limite explicite de cette classification** : `sensitive` est une
  classification **interne de protection du CRM** (badge affiché + entrée
  d'audit `sensitivity_at_execution` lors d'une exécution de règle,
  `advisoryRuleExecutions.js`) — elle ne constitue **pas, à elle seule, une
  qualification juridique définitive** au sens nLPD/RGPD. Si une future
  question demandait l'usage réel de médecines complémentaires (fréquence,
  praticien consulté, motif) ou toute information permettant de déduire
  l'état de santé du client, cette future donnée devrait être réévaluée et
  très probablement classée `sensitive: true` — cette classification-ci ne
  vaut que pour la question telle qu'elle existe aujourd'hui, jamais comme
  précédent automatique pour un contenu futur différent.
- Aucune autre classification `sensitive` n'est modifiée par cette
  décision.

**Qualification juridique définitive non couverte par cette revue** :
comme déjà noté au §7 ci-dessous, la qualification nLPD/RGPD stricte de
plusieurs de ces classifications (notamment `tolerance_risque_financier`,
`capacite_absorber_depense_annuelle`, `franchise_actuelle_niveau_declare`)
reste à confirmer par une expertise externe avant toute publication réelle.

## 7. Validation avant publication réelle (non faite par ce lot)

Comme pour v1 (`HEALTH_LOT5_CONTENT.md` §5), avant tout passage
`brouillon → publié` (questionnaire v2 et rule_set v2) :
- validation juridique formelle des 2 nouvelles règles accident (mêmes
  articles LAMal/OAMal que v1, réutilisés — pas de nouvelle base légale à
  valider, mais la formulation « potentiellement examinable » doit être
  revue par un spécialiste qualifié) ;
- classification `sensitive` des 24 questions : revue ciblée déjà réalisée
  (§6ter) — confirmation finale par un spécialiste conformité avant
  publication réelle recommandée ;
- revue finale par `health-insurance-domain` du contenu réel des 37 règles.

## 8. Documentation pour un futur LOT de synthèse — dimensions

**Ce lot n'implémente aucun moteur de synthèse.** Ce qui suit documente,
pour un futur LOT de synthèse (non conçu, non planifié en détail), les
dimensions de lecture que le contenu v2 rend disponibles, afin qu'un futur
travail de synthèse (agrégation par thème plutôt que liste plate de
findings) ait un inventaire de référence sans avoir à redécouvrir la
structure des 37 règles.

### 8.1 Dimensions identifiées (10)

Chaque dimension regroupe un sous-ensemble des 37 règles v2, par thème
métier — un regroupement de lecture, jamais une nouvelle table ni un champ
persistant sur `advisory_findings` :

| Dimension | Règles concernées (§3) | `category_hint` (préfixe) |
|---|---|---|
| `accident` | 2 (C) + `accident-coordination-doublon-01`/`accident-coverage-gap-01` (reconduites) | `accident_*` |
| `franchise_orientation` | 3 (D) | `franchise_orientation_*` |
| `franchise_current_comparison` | 7 (E) | `franchise_comparaison_*` |
| `care_model` | 12 (F) | `care_model_*` |
| `hospitalisation` | 1 (H, `complementaire-hospitalisation-a-examiner-01`) | `complementaire_hospitalisation_*` |
| `medecines_complementaires` | 1 (H, `complementaire-medecines-alternatives-a-examiner-01`) | `complementaire_medecines_alternatives_*` |
| `optique` | 1 (H, `complementaire-optique-a-examiner-01`) | `complementaire_optique_*` |
| `dentaire` | 1 (H, `complementaire-dentaire-a-examiner-01`) | `complementaire_dentaire_*` |
| `prevention` | 1 (H, `complementaire-prevention-a-examiner-01`) | `complementaire_prevention_*` |
| `voyage` | 1 (H, `complementaire-voyage-a-examiner-01`) | `complementaire_voyage_*` |

Note : `priorite_prime_liberte` (G, 3 règles) et `modele-soins-comportement-01`/
`lca-continuite-resiliation-01` (reconduites) ne sont volontairement
rattachées à aucune des 10 dimensions listées par le cadrage — un futur LOT
de synthèse devra décider s'il les intègre à `care_model`/une dimension
transverse ou les traite hors synthèse thématique.

### 8.2 États futurs envisagés (3, par dimension et par membre)

Un futur LOT de synthèse pourrait qualifier, pour chaque dimension et
chaque membre du foyer, un état parmi 3 — **non implémenté ici**, décrit
uniquement pour cadrer un futur travail :

- **`complete`** : toutes les `required_data` des règles de la dimension
  sont répondues (`status: 'answered'`) pour ce membre — la dimension a pu
  s'exprimer pleinement (déclenchée ou non).
- **`partial`** : une partie des `required_data` de la dimension sont
  répondues, mais au moins une règle de la dimension reste incomplète pour
  ce membre — certains findings de la dimension ont pu se déclencher,
  d'autres non, sans certitude qu'ils ne se déclencheraient pas avec plus
  d'information.
- **`blocked_by_missing_information`** : aucune `required_data` de la
  dimension n'est répondue pour ce membre — la dimension n'a produit aucun
  finding, uniquement des entrées `missing_information` (mécanisme déjà
  livré, LOT 4B/`RULES_ENGINE.md` §8).

Ces 3 états seraient dérivables mécaniquement de `missing_information` déjà
projeté par `getSessionFindingsWorkspace` (LOT 4B) — aucune nouvelle donnée
ne serait nécessaire pour les calculer, seulement une agrégation par
dimension au moment de la lecture. Le moteur de synthèse lui-même (choix
d'affichage, priorisation entre dimensions, texte de synthèse) reste
entièrement à concevoir par un futur LOT de synthèse et n'est engagé par
aucune décision de ce document.
