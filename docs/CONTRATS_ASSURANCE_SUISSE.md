# Modèle de contrats spécialisés « Assurance Suisse »

Référence technique du support backend des détails spécialisés par branche de
contrat (LAMal, LCA, assurance vie, incapacité de gain privée, LPP/IJM).

> **Portée.** Ce module couvre le schéma (`server/db.js`, migration
> version 8 — voir [`MIGRATIONS.md`](./MIGRATIONS.md#version-8)), l'API
> backend (`server/routes/contracts.js`) et une interface frontend associée
> (`client/src/pages/Contracts.jsx`, `client/src/components/contracts/`) pour
> les branches LAMal, LCA et Vie ; les branches incapacité de gain privée et
> LPP/IJM disposent du schéma et de l'API mais n'ont, à ce jour, aucune
> interface frontend dédiée. Module préparé sur la branche d'intégration
> `swiss-insurance-crm-v1`.
>
> Toute affirmation de ce document est vérifiée contre le code au moment de
> la rédaction. En cas de divergence future entre ce document et le code,
> **le code fait foi**.

## 1. Migration et tables

Les 5 tables spécialisées décrites ici sont créées par la migration
version 8 (`server/db.js`). Chacune est en relation stricte 1:1 avec la table
générique `contracts` (0 ou 1 ligne spécialisée par contrat), via
`contract_id INTEGER PRIMARY KEY REFERENCES contracts(id) ON DELETE
CASCADE` — la suppression d'un contrat (`DELETE /api/contracts/:id`) supprime
donc automatiquement sa ligne spécialisée, sans code applicatif dédié.

Trois tables supplémentaires créées par la même migration
(`contract_coverages`, `contract_beneficiaries`, `contract_history`) restent
**hors périmètre** de ce document et de l'API actuelle : aucune route, aucune
validation, aucun test ne les exploite à ce jour.

Voir [`MIGRATIONS.md`](./MIGRATIONS.md#version-8) pour le détail complet de
la migration (colonnes, réversibilité, précautions).

## 2. Branches et blocs spécialisés

Chaque branche de contrat (`contracts.branch`) est compatible avec au plus un
bloc spécialisé. Les cinq ensembles de compatibilité sont deux à deux
disjoints dans le code : aucune branche n'est jamais compatible avec deux
blocs à la fois, ce qui garantit qu'un contrat ne peut porter qu'un seul bloc
spécialisé.

### 2.1 LAMal — branche `lamal`, bloc `lamal`

Table `contract_lamal`.

| Champ | Type attendu | Nullable | Obligatoire création | Obligatoire mise à jour | Contraintes |
|---|---|---|---|---|---|
| `care_model` | `string` (enum) | non | oui | oui | `['standard', 'medecin_famille', 'hmo', 'telmed', 'pharmacie', 'autre']` |
| `deductible` | `number` (entier) | non | oui | oui | doit appartenir à `[0, 100, 200, 300, 400, 500, 600, 1000, 1500, 2000, 2500]` (franchises OFSP, adultes + enfants) ; aucune coercition de chaîne acceptée |
| `accident_coverage` | `boolean` | non | non (défaut `true`) | non | `true`/`false`, `0`/`1` acceptés ; toute autre valeur rejetée |
| `canton` | `string` (enum) | oui | non | non | 2 lettres, parmi les 26 cantons suisses (normalisé en majuscules) |
| `tariff_region` | `string` | oui | non | non | 20 caractères maximum |

**Particularité importante** : contrairement aux quatre autres blocs, LAMal
**n'accepte pas les mises à jour partielles**. `care_model` et `deductible`
sont toujours exigés, y compris en `PUT` sur une ligne déjà existante — un
`PUT` n'envoyant que `canton` par exemple est rejeté (400). Toute mise à jour
doit renvoyer l'objet `lamal` complet.

*Liste des franchises reprise de `LAMAL_DEDUCTIBLES`
(`server/routes/contracts.js`) ; il s'agit d'une donnée métier interne au
code, pas d'une citation officielle datée de l'OFSP — `Vérification humaine
obligatoire` de son actualité avant toute utilisation hors contexte technique
interne.*

### 2.2 LCA — branche `lca`, bloc `lca`

Table `contract_lca`. Porte uniquement le processus de souscription/décision
(statuts administratifs) ; les garanties elles-mêmes ne sont pas modélisées
ici. Aucun champ ne doit contenir de diagnostic, de pathologie, de résultat
médical ni de contenu de questionnaire de santé — les champs `*_notes` sont
volontairement courts et strictement administratifs.

| Champ | Type attendu | Nullable | Obligatoire création | Obligatoire mise à jour | Contraintes |
|---|---|---|---|---|---|
| `underwriting_status` | `string` (enum) | non (défaut SQL `'non_requis'`) | non | non | `['non_requis', 'questionnaire_transmis', 'decision_attendue', 'acceptee', 'acceptee_avec_reserve', 'refusee']` ; `null` explicite rejeté |
| `waiting_period_days` | `number` (entier) | oui | non | non | `>= 0` ; aucune coercition de chaîne |
| `administrative_reservation_status` | `string` (enum) | non (défaut SQL `'aucune'`) | non | non | `['aucune', 'en_cours', 'active', 'levee']` ; `null` explicite rejeté |
| `reservation_notes` | `string` | oui | non | non | 200 caractères maximum |
| `exclusions_status` | `string` (enum) | non (défaut SQL `'aucune'`) | non | non | `['aucune', 'presentes']` ; `null` explicite rejeté |
| `exclusions_notes` | `string` | oui | non | non | 200 caractères maximum |

Les trois champs enum ont une valeur par défaut SQL : ils peuvent être omis
sans erreur (la valeur par défaut ou existante s'applique), mais un `null`
explicite est rejeté (400) — voir §4.

### 2.3 Assurance vie — branches `vie_3a` / `vie_3b`, bloc `life`

Table `contract_life`. Le type 3a/3b n'est pas dupliqué dans ce bloc : il est
déjà porté par `contracts.branch`. Les bénéficiaires (hors périmètre) vivent
dans `contract_beneficiaries`, pas dans ce bloc.

| Champ | Type attendu | Nullable | Obligatoire création | Obligatoire mise à jour | Contraintes |
|---|---|---|---|---|---|
| `component_type` | `string` (enum) | non | oui | non (préservé si absent) | `['mixte', 'risque_pur', 'capital_differe', 'rente', 'unit_linked', 'autre']` ; `null` explicite toujours rejeté |
| `insured_death_capital` | `number` | oui | non | non | `>= 0`, nombre fini ; aucune coercition de chaîne |
| `insured_disability_capital` | `number` | oui | non | non | `>= 0`, nombre fini |
| `insured_rent` | `number` | oui | non | non | `>= 0`, nombre fini |
| `surrender_value` | `number` | oui | non | non | `>= 0`, nombre fini |
| `premium_waiver` | `boolean` | non (défaut `false`) | non | non | `null` explicite rejeté |
| `indexation_type` | `string` (enum) | non (défaut SQL `'aucune'`) | non | non | `['aucune', 'fixe', 'indice_prix_conso', 'autre']` ; `null` explicite rejeté |
| `policy_term_years` | `number` (entier) | oui | non | non | `> 0` si renseigné ; aucun plafond |

**Règle conditionnelle liée à la commission (à la création uniquement).** Le
tableau ci-dessus décrit la validation du bloc `life` en tant que tel, où
`policy_term_years` reste un champ optionnel. Une règle supplémentaire,
propre au calcul de la commission d'acquisition (`server/commissionCalc.js`),
s'applique uniquement à la création (`POST /api/contracts`) d'un contrat des
branches `vie_3a`/`vie_3b` :

- **Prime périodique** (`payment_frequency` différent de `'unique'`) :
  `policy_term_years` devient **obligatoire** (entier `> 0`). Son absence ou
  son invalidité fait échouer la création avec un code `400`, avant toute
  écriture en base. Formule appliquée :
  `commission = prime annuelle × durée contractuelle × taux d'acquisition / 100`.
- **Prime unique** (`payment_frequency` égal à `'unique'`) : `policy_term_years`
  n'est **pas utilisé** dans le calcul, qu'il soit renseigné ou non — la
  durée est ignorée. Formule appliquée (identique à la règle générale de
  toutes les autres branches) :
  `commission = prime annuelle × taux d'acquisition / 100`.

Cette règle ne s'applique qu'à la génération de la commission d'acquisition à
la création ; elle n'intervient pas en mise à jour (`PUT`), où le champ reste
optionnel comme indiqué dans le tableau (voir aussi §7). Voir §9.6 pour un
exemple de rejet et §9.7 pour un exemple de prime unique.

### 2.4 Incapacité de gain privée — branche `incapacite`, bloc `income_protection`

Table `contract_income_protection`. Couvre exclusivement l'incapacité de gain
**individuelle privée**. Aucune logique d'IJM collective employeur, d'AI
détaillée ou de coordination de prestations détaillée n'est développée ;
`coordination_ai_lpp` est un simple indicateur booléen.

| Champ | Type attendu | Nullable | Obligatoire création | Obligatoire mise à jour | Contraintes |
|---|---|---|---|---|---|
| `benefit_type` | `string` (enum) | non | oui | non (préservé si absent) | `['rente', 'indemnite_journaliere', 'capital', 'autre']` ; `null` explicite toujours rejeté |
| `insured_amount` | `number` | oui | non | non | `>= 0`, nombre fini |
| `waiting_period_days` | `number` (entier) | oui | non | non | `>= 0` |
| `benefit_duration_months` | `number` (entier) | oui | non | non | `> 0` si renseigné |
| `disability_trigger_rate` | `number` (entier) | oui | non | non | entre `0` et `100` inclus |
| `coordination_ai_lpp` | `boolean` | non (défaut `false`) | non | non | `null` explicite rejeté |
| `premium_waiver` | `boolean` | non (défaut `false`) | non | non | `null` explicite rejeté |
| `exclusions_notes` | `string` | oui | non | non | 200 caractères maximum, purement administratif |

### 2.5 LPP/IJM — branche `lpp`, bloc `lpp_ijm`

Table `contract_lpp_ijm`. Module volontairement minimal (usage individuel
uniquement, pas un module entreprise). `product_type` distingue uniquement la
nature du produit (`lpp` = prévoyance professionnelle, `ijm` = indemnité
journalière maladie), sans logique employeur, collective, AI détaillée ou de
coordination.

| Champ | Type attendu | Nullable | Obligatoire création | Obligatoire mise à jour | Contraintes |
|---|---|---|---|---|---|
| `product_type` | `string` (enum) | non | oui | non (préservé si absent) | `['lpp', 'ijm', 'autre']` ; `null` explicite toujours rejeté |
| `institution_name` | `string` | oui | non | non | 200 caractères maximum |
| `retirement_capital` | `number` | oui | non | non | `>= 0`, nombre fini |
| `disability_pension` | `number` | oui | non | non | `>= 0`, nombre fini |
| `daily_allowance` | `number` | oui | non | non | `>= 0`, nombre fini |
| `waiting_period_days` | `number` (entier) | oui | non | non | `>= 0` |
| `benefit_duration_days` | `number` (entier) | oui | non | non | `> 0` si renseigné |

## 3. Comportement à la création et à la mise à jour

- **Création (`POST /api/contracts`)** : le bloc spécialisé est optionnel.
  Absent → aucune ligne créée. Objet → création après validation stricte,
  uniquement si la branche du contrat est compatible avec le bloc.
- **Mise à jour (`PUT /api/contracts/:id`)** : absent → aucune modification du
  bloc existant. Objet → création (si aucune ligne n'existe encore) ou mise à
  jour, partielle pour tous les blocs sauf LAMal (§2.1). `null` explicite →
  suppression de la ligne spécialisée (auditée), quel que soit le bloc.
- **Changement de branche** : si une ligne spécialisée existe déjà, changer
  `branch` vers une branche incompatible est refusé (400), sauf si la même
  requête envoie explicitement le bloc concerné à `null`.

## 4. Sémantique des mises à jour (absent / valeur / `null`)

| Situation | Comportement |
|---|---|
| Champ non nullable **absent** du bloc | Valeur existante (mise à jour) ou valeur par défaut SQL (création, si elle existe) préservée — aucune erreur. |
| Champ non nullable **présent avec une valeur valide** | La valeur est appliquée. |
| Champ non nullable **présent avec `null`** | **Toujours rejeté (400)**, quel que soit le champ ou le bloc — aucun champ non nullable ne peut être effacé silencieusement. |
| Champ nullable **absent** | Valeur existante préservée (mise à jour) ou `NULL` (création). |
| Champ nullable **présent avec `null`** | Le champ est effectivement mis à `NULL` en base. |
| Bloc spécialisé **absent** du payload | Aucune écriture sur la table spécialisée. |
| Bloc spécialisé **présent (objet)** | Création ou mise à jour, selon qu'une ligne existe déjà. |
| Bloc spécialisé **explicitement `null`** | Suppression de la ligne spécialisée (auditée), quel que soit le bloc. |

Point d'attention propre à LAMal : le bloc `lamal`, lorsqu'il est envoyé
comme objet, est **toujours validé comme un objet complet** (`care_model` et
`deductible` requis à chaque fois, création comme mise à jour) — il n'existe
pas de notion de « mise à jour partielle » pour ce bloc précis.

**Atomicité observable.** Une mise à jour invalide (contrat générique ou
bloc spécialisé) est rejetée **avant toute modification persistée** : il
s'agit d'un rejet atomique observable avant modification persistée, et non
d'un rollback SQL déclenché après une écriture partielle. Dans tous les cas,
après un rejet, le contrat générique, les détails spécialisés déjà
enregistrés, les commissions existantes et le journal d'audit restent
strictement inchangés — aucune entrée d'audit de modification n'est créée
(comportement observable confirmé par les tests, ex. « rollback logique d'un
PUT combinant champ générique valide et bloc LAMal invalide »). Le fait que
la validation ait lieu avant l'ouverture de la transaction SQL est, lui, une
observation du code (`server/routes/contracts.js`) plutôt qu'un point vérifié
par une assertion de test dédiée à cet ordre d'exécution interne.

## 5. Règles de validation strictes

- **Aucune coercition automatique** des chaînes numériques : une chaîne comme
  `"300"` n'est jamais convertie silencieusement en nombre. Les nombres
  (`deductible`, `waiting_period_days`, capitaux, montants) doivent être
  envoyés comme de vrais nombres JSON (`typeof === 'number'`).
- La franchise LAMal (`deductible`) n'est acceptée que sous forme d'entier
  réel appartenant à la liste métier fermée des franchises OFSP.
- Le délai d'attente LCA (`waiting_period_days`) n'est accepté que sous forme
  d'entier réel non négatif lorsqu'il est renseigné — jamais de chaîne, de
  décimal ni de valeur négative.
- Les trois enums LCA sans valeur explicite requise (`underwriting_status`,
  `administrative_reservation_status`, `exclusions_status`) rejettent un
  `null` explicite (400), même s'ils ont une valeur par défaut SQL.
- Les champs « type » principaux de vie (`component_type`), incapacité
  (`benefit_type`) et LPP/IJM (`product_type`) rejettent également tout `null`
  explicite.
- Les champs booléens (`accident_coverage`, `premium_waiver`,
  `coordination_ai_lpp`) n'acceptent que `true`/`false` ou `0`/`1` — toute
  autre valeur (chaîne, objet) est rejetée.
- `tariff_region` (LAMal) est limité à **20 caractères** ; les autres champs
  texte administratifs (`reservation_notes`, `exclusions_notes`,
  `institution_name`) sont limités à 200 caractères.

## 6. Audit

Chaque écriture spécialisée génère une entrée dans le journal d'audit
(`audit_log`), en plus des entrées génériques `création contrat` /
`modification contrat` / `suppression contrat`. Les libellés exacts des
actions (colonnes ci-dessous) sont vérifiés à la fois dans le code et par un
test dédié par bloc :

| Bloc | Création | Modification | Suppression |
|---|---|---|---|
| LAMal | `création détails LAMal` | `modification détails LAMal` | `suppression détails LAMal` |
| LCA | `création détails LCA` | `modification détails LCA` | `suppression détails LCA` |
| Vie | `création détails vie` | `modification détails vie` | `suppression détails vie` |
| Incapacité | `création détails incapacité de gain` | `modification détails incapacité de gain` | `suppression détails incapacité de gain` |
| LPP/IJM | `création détails LPP/IJM` | `modification détails LPP/IJM` | `suppression détails LPP/IJM` |

Le détail journalisé (5ᵉ argument de `audit()`) est systématiquement limité à
une valeur d'énumération — **jamais** de montant détaillé, de texte libre
issu de `*_notes`, ni a fortiori de donnée médicale. Le contenu exact de ce
détail est vérifié par une assertion de test dédiée pour LCA (`statut
acceptee`), vie (`composante mixte`), incapacité (`type rente`) et LPP/IJM
(`type lpp`). Pour LAMal, seule la présence des trois actions ci-dessus est
testée ; le contenu exact du détail (illustré par `franchise 300`) n'est, à
ce jour, pas couvert par une assertion de test dédiée.

## 7. Commissions et atomicité observable

- Une opération de validation rejetée (contrat générique ou bloc spécialisé)
  **n'altère jamais** les commissions existantes.
- La commission d'acquisition, générée automatiquement à la création d'un
  contrat, n'est ni couplée ni dépendante d'un bloc spécialisé particulier :
  elle se comporte de façon identique, qu'un bloc soit présent ou non.
- Les modifications génériques et spécialisées d'un même `PUT` sont traitées
  comme une seule opération cohérente : une requête invalide ne produit
  aucune modification partielle observable, ni aucune entrée d'audit de
  modification.

## 8. Couverture de tests

La couverture est organisée par catégories plutôt que par un nombre de tests
figé (susceptible d'évoluer) :

- création (avec et sans bloc spécialisé) ;
- validation (types, enums, bornes, longueurs, branche incompatible) ;
- mise à jour (complète pour LAMal, partielle pour les quatre autres blocs) ;
- suppression (bloc seul via `null`, ou contrat entier) ;
- audit (présence des actions attendues, contenu non sensible) ;
- commissions (non-régression après opération valide ou invalide) ;
- absence de création orpheline après un rejet ;
- atomicité observable (rejet avant toute modification persistée) ;
- suppression en cascade (`ON DELETE CASCADE`) à la suppression du contrat.

Les commandes de référence sont `node --test test/api.test.js` (tests
d'intégration API, dont ce module) et `npm test` (suite complète, incluant les
tests de migration et de 2FA). Les décomptes exacts évoluent à chaque lot ;
se référer à l'exécution réelle plutôt qu'à un chiffre imprimé ici.

## 9. Exemples API

Identifiants, montants et libellés ci-dessous sont **fictifs**, à des fins
d'illustration uniquement. Toutes les routes sont authentifiées
(`requireAuth`) ; les exemples omettent les en-têtes de session pour la
lisibilité.

### 9.1 Création d'un contrat LAMal valide

```
POST /api/contracts
{
  "client_id": 42,
  "company_id": 3,
  "branch": "lamal",
  "annual_premium": 3600,
  "lamal": {
    "care_model": "standard",
    "deductible": 300,
    "accident_coverage": true,
    "canton": "VD"
  }
}
```
Réponse `201` : `{ "id": 123, "warnings": [] }` (le tableau `warnings`
signale, sans bloquer, un mandat ou un consentement manquant sur le client).

### 9.2 Mise à jour complète du bloc LAMal

```
PUT /api/contracts/123
{
  "lamal": {
    "care_model": "hmo",
    "deductible": 2500,
    "accident_coverage": false,
    "canton": "GE"
  }
}
```
Réponse `200` : `{ "ok": true }`. Rappel : les quatre champs doivent être
renvoyés ensemble (§2.1) — un objet partiel est rejeté.

### 9.3 Suppression d'un bloc spécialisé

```
PUT /api/contracts/123
{
  "lamal": null
}
```
Réponse `200` : `{ "ok": true }`. La ligne `contract_lamal` est supprimée ; le
contrat générique et ses commissions restent inchangés ; une entrée d'audit
`suppression détails LAMal` est créée.

### 9.4 Rejet d'une franchise envoyée comme chaîne

```
POST /api/contracts
{
  "client_id": 42,
  "company_id": 3,
  "branch": "lamal",
  "annual_premium": 3600,
  "lamal": { "care_model": "standard", "deductible": "300" }
}
```
Réponse `400` : aucun contrat n'est créé — `deductible` doit être un nombre
JSON réel, jamais une chaîne, même numériquement valide.

### 9.5 Mise à jour partielle d'un bloc vie

```
PUT /api/contracts/456
{
  "life": { "surrender_value": 1200 }
}
```
Réponse `200` : `{ "ok": true }`. Seul `surrender_value` est modifié ; les
autres champs déjà enregistrés (`component_type`, capitaux, etc.) sont
préservés — comportement de mise à jour partielle, disponible pour ce bloc
(contrairement à LAMal, §2.1).

### 9.6 Rejet d'une création Vie périodique sans durée

```
POST /api/contracts
{
  "client_id": 42,
  "company_id": 3,
  "branch": "vie_3a",
  "annual_premium": 6000,
  "payment_frequency": "annuelle",
  "acq_commission_rate": 4,
  "life": { "component_type": "mixte" }
}
```
Réponse `400` : `{ "error": "La durée contractuelle est nécessaire pour
calculer la commission d’acquisition d’un contrat Vie." }`. Aucun contrat
n'est créé — `payment_frequency` étant différent de `'unique'`,
`policy_term_years` est requis pour calculer la commission (voir §2.3) et son
absence bloque la création avant toute écriture.

### 9.7 Création Vie à prime unique, durée ignorée

```
POST /api/contracts
{
  "client_id": 42,
  "company_id": 3,
  "branch": "vie_3a",
  "annual_premium": 50000,
  "payment_frequency": "unique",
  "acq_commission_rate": 3,
  "life": { "component_type": "capital_differe" }
}
```
Réponse `201` : `{ "id": 789, "warnings": [] }`. `policy_term_years` est
absent et n'est pas requis : pour une prime unique, la commission
d'acquisition suit la formule générale
(`50000 × 3 / 100 = 1500.00` CHF), sans intervention de la durée
contractuelle.
