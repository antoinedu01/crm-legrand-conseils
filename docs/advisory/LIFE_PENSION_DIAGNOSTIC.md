# Parcours Vie et Prévoyance

> Proposition de conception (LOT 1). Toute formule mentionnée dans ce
> document est un **modèle configurable**, présenté comme tel au conseiller
> et au client — jamais comme une vérité contractuelle, actuarielle ou
> fiscale universelle. Aucune conclusion fiscale, actuarielle ou
> contractuelle n'est affirmée par ce module. **Aucun rendement, aucune
> promesse contractuelle n'est générée.**

## 1. Sections proposées

| Section | Portée | Contenu |
|---|---|---|
| Situation familiale | foyer | dérivée de `households`/`household_members`, jamais reposée si déjà connue |
| Situation professionnelle | membre | statut (salarié, indépendant, sans activité), stabilité perçue |
| Revenus | membre | revenu net mensuel/annuel déclaré |
| Charges | foyer | charges fixes mensuelles |
| Dettes | foyer | hypothèque, crédits, montants et échéances |
| Patrimoine | foyer | biens, placements, valeur estimée |
| Liquidités | foyer | épargne disponible à court terme |
| Fonds d'urgence | foyer | épargne de précaution existante |
| Capacité d'épargne | foyer | épargne mensuelle disponible |
| Fiscalité | foyer | tranche/situation déclarée par le client — **jamais une conclusion fiscale calculée par le module**, uniquement une donnée déclarative servant de contexte |
| Prévoyance professionnelle (LPP) | membre | caisse, prestations connues ou non |
| Prestations d'invalidité | membre | montants estimés connus (LPP + éventuel privé) |
| Prestations en cas de décès | membre | capital/rente connus |
| Contrats 3a existants | membre | lus depuis `contracts` où `branch = 'vie_3a'` |
| Contrats 3b existants | membre | lus depuis `contracts` où `branch = 'vie_3b'` |
| Assurances de risque existantes | membre | lues depuis `contract_income_protection`/`contract_life` |
| Protection du conjoint | foyer | couverture existante en cas de décès/invalidité du conjoint |
| Protection des enfants | foyer | bénéficiaires désignés (lecture `contract_beneficiaries` si exploité) |
| Projet immobilier | foyer | projet en cours ou prévu, horizon |
| Retraite | membre | âge visé, attentes |
| Horizon | foyer | horizon de temps des objectifs exprimés |
| Tolérance au risque | foyer | déclarative, pas un score psychométrique validé |
| Besoin de garanties | foyer | préférence pour la sécurité du capital vs recherche de performance |
| Besoin de flexibilité | foyer | capacité à interrompre/réduire un engagement |
| Capacité à maintenir les primes | foyer | stabilité perçue des revenus sur la durée d'engagement envisagée |

## 2. Analyses attendues (modèles configurables, pas des vérités)

Chaque analyse ci-dessous est produite par une ou plusieurs règles du
moteur (`RULES_ENGINE.md`), avec `advisor_explanation` rappelant
explicitement qu'il s'agit d'un modèle configurable.

### 2.1 Déficit mensuel en cas d'incapacité
Modèle indicatif : `revenu_net_mensuel − (prestations_lpp_invalidite_estimees +
prestations_prive_existantes) − charges_mensuelles_fixes`. Si positif,
signale un déficit potentiel — **jamais affiché comme un montant garanti**,
toujours accompagné d'un avertissement rappelant que les prestations LPP
réelles dépendent du règlement de prévoyance effectif de la caisse
concernée, non vérifié par ce module.

### 2.2 Besoin de capital décès
Modèle indicatif comparant les charges/dettes restantes (notamment
hypothécaires) et les revenus de remplacement nécessaires pour le conjoint
et les enfants, contre le capital décès déjà assuré (`contract_life.
insured_death_capital` existant + LPP décès déclaré). Résultat = `lacune` si
écart positif.

### 2.3 Réserve de sécurité
Compare les liquidités déclarées à un multiple configurable des charges
mensuelles (ex. « 3 à 6 mois de charges » — **paramètre configurable, pas un
principe universel imposé**). Signale une insuffisance de réserve, jamais un
jugement moral sur les habitudes d'épargne du foyer.

### 2.4 Capacité d'épargne disponible
Dérive directement des réponses « revenus », « charges », « capacité
d'épargne déclarée » — pas de calcul supplémentaire au-delà de la
soustraction déclarative, restituée telle quelle avec sa source (déclaratif
client, pas vérifié).

### 2.5 Incompatibilité entre engagement long et besoin de liquidité
Règle de cohérence : si `horizon` est court ou `besoin_de_flexibilite` est
élevé, et qu'une recommandation envisagée porte sur un produit à engagement
long (ex. catégorie « épargne liée à horizon long »), la règle produit un
`avertissement` explicite de contre-indication plutôt que de bloquer
silencieusement la catégorie.

### 2.6 Besoin éventuel de 3a
Signale une catégorie de solution (`besoin_3a_a_examiner`) si la capacité
d'épargne est positive, qu'aucun 3a existant n'est présent ou que le 3a
existant est significativement sous-alimenté par rapport au maximum légal
déductible — **le montant légal exact doit être injecté comme paramètre
sourcé et daté, jamais codé en dur sans référence** (point de validation
métier explicite, voir `SECURITY_PRIVACY.md` §20).

### 2.7 Besoin éventuel de 3b
Signale une catégorie de solution similaire côté 3b, typiquement quand un
besoin de capital décès ou de flexibilité prime sur l'avantage fiscal
recherché en 3a.

### 2.8 Priorité à une couverture risque
Quand un déficit d'incapacité ou de décès est détecté en même temps qu'une
capacité d'épargne faible, la règle privilégie, dans son
`result_payload.category_hint`, une catégorie de couverture de risque plutôt
que d'épargne — présenté comme une priorisation indicative, pas un ordre
imposé au conseiller.

### 2.9 Absence de besoin immédiat
Cas explicite et documenté : si aucune règle de lacune ne se déclenche, le
parcours produit un constat positif clair (« aucune lacune détectée à ce
jour selon les informations disponibles ») plutôt que de laisser un écran
vide ambigu — évite de faire croire à une analyse incomplète.

## 3. Ce que ce parcours ne fait jamais

- Ne calcule ni n'affiche un rendement projeté d'un produit.
- Ne fournit aucune simulation fiscale personnalisée définitive (renvoie
  vers un conseil fiscal externe pour toute décision engageante).
- Ne code aucun montant légal (plafonds 3a, barèmes) sans référence sourcée
  et datée, révisable indépendamment du code (donnée de paramétrage, pas une
  constante gelée dans le moteur).
- Ne confond jamais une simulation indicative avec un engagement contractuel
  réel.
