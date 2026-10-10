# Conventions de courtage

Module qui enregistre, compagnie par compagnie, les conventions signées par le
courtier : conditions, obligations, barème de la commission d'acquisition et
règle de reprise (extourne). Le CRM s'en sert pour :

- proposer la bonne ligne de barème quand on crée un contrat, et créer
  automatiquement la commission attendue selon la convention ;
- avertir quand on place une affaire chez une compagnie (ou dans une branche)
  sans convention signée ;
- estimer la part de commission à rembourser si un contrat prend fin pendant
  la période de reprise ;
- rappeler les pièces à joindre et les interdits propres à chaque compagnie.

> **Confidentialité.** Les barèmes négociés sont des secrets d'affaires : les
> conventions interdisent de les rendre publics (site Internet, documents
> publics) et certaines prévoient une peine conventionnelle. Ce dépôt est
> public : **aucun barème réel ne doit jamais y figurer** — ni dans le code, ni
> dans les tests, ni dans la documentation, ni dans un fichier d'import
> versionné. Les vraies valeurs entrent uniquement dans la base du CRM, par
> l'interface ou par l'import d'un fichier conservé hors dépôt (motifs
> `*conventions*.json` exclus par `.gitignore`).

## Modèle de données (migration 18)

| Table | Rôle |
|---|---|
| `conventions` | Une convention par compagnie (`company_id`) : titre, cocontractant, n° d'intermédiaire, statut (`signee`, `en_attente`, `resiliee`), dates, champ d'application, résiliation, paiement, délai de contestation des décomptes, suivi du client après conclusion (`compagnie`, `intermediaire`, `non_precise`), obligations, restrictions, pièces manquantes, emplacement de l'original. |
| `convention_rates` | Lignes de barème d'une convention : branche (même vocabulaire que `contracts.branch`), produit, base de calcul, valeur, plafond, commission récurrente, règle de reprise, conditions, référence dans la convention, ligne active ou non. Supprimées en cascade avec leur convention. |
| `contracts.convention_rate_id` | Ligne de barème retenue pour le contrat (traçabilité). |
| `commissions.convention_rate_id` | Ligne de barème qui a servi à calculer la commission. |

Une ligne déjà utilisée par un contrat ou une commission (`usage_count`) ne
peut plus être supprimée (clé étrangère, conservation comptable), ni voir sa
base de calcul, ses montants ou sa règle de reprise modifiés : on la désactive
et on crée une nouvelle ligne. Son libellé, ses conditions et son statut actif
restent modifiables. Une convention dont une ligne a servi ne peut plus
changer de compagnie.

## Bases de calcul

Implémentées dans `shared/conventionRules.js`, module pur importé tel quel par
le serveur **et** par l'interface (aucun miroir à resynchroniser).

| `basis` | Commission d'acquisition estimée |
|---|---|
| `fixe` | `value` CHF par contrat |
| `mois_prime` | `value` × prime mensuelle (prime annuelle / 12) |
| `pct_prime_annuelle` | `value` % de la prime annuelle ; × années entières de durée du contrat si `multiply_by_years` (échéance incluse : du 01.10.2026 au 30.09.2029 = 3 ans) |
| `pct_production` | `value` % de la production = prime annuelle × durée de paiement (plafonnée à `max_years`) × `valuation_pct` % ; pour une prime unique : prime × `valuation_pct` % |
| `aucune` | Aucune commission d'acquisition prévue |
| `a_confirmer` | Barème non chiffrable (pièce manquante) : aucune estimation |

`cap_chf` plafonne le montant. `is_estimate` signale une ligne dont la base
exacte reste à confirmer avec la compagnie (affiché comme estimation). Le
montant est arrondi une seule fois au centime. Une donnée manquante (prime,
durée) n'est **jamais** remplacée par une valeur inventée.

## Reprise (extourne)

| `clawback_mode` | Règle |
|---|---|
| `paliers` | `clawback_steps` = `[{ "months": N, "pct": P }, …]` par durée croissante : si la couverture a duré au plus N mois (dernier jour couvert inclus), P % de la commission est repris ; au-delà du dernier palier, 0 %. Pour des primes mensuelles payées d'avance, « au plus N primes payées » correspond au palier N. |
| `prorata` | Reprise linéaire sur `clawback_months` mois : 100 % au début, 0 % au terme. |
| `aucun` | Aucune reprise. |
| `inconnu` | Règle non fournie : aucune estimation. |

`GET /api/commissions/:id/clawback-estimate?coverage_end=AAAA-MM-JJ` renvoie la
part reprise et le montant proposé (base : montant reçu, sinon attendu), pour
une commission **d'acquisition** uniquement (la règle de reprise d'une
convention ne porte pas sur les récurrentes ni sur les ajustements). Sans
`coverage_end` : date d'échéance d'un contrat résilié ou échu, sinon date du
jour en Suisse. C'est une estimation en lecture seule : la reprise reste créée
par le conseiller (`POST /api/commissions/:id/reverse`), le décompte de la
compagnie fait foi.

## Effet sur les contrats

- **Création avec `convention_rate_id`** : la ligne doit appartenir à une
  convention **signée et en vigueur** (sans date de fin, ou date de fin pas
  encore dépassée) de la même compagnie, pour la même branche, et être
  active. La commission attendue est créée en montant fixe (`fixed_amount`,
  y compris en LAMal/LCA, où aucun taux générique n'est jamais appliqué), liée
  à la ligne d'origine. Sa note ne reprend **jamais** le détail du calcul (les
  taux négociés suivraient la commission jusque dans l'export nLPD du
  client) : le détail se recalcule à tout moment depuis la ligne liée et
  s'affiche dans le formulaire du contrat. Les taux génériques du contrat ne
  génèrent alors aucune autre commission ; la commission récurrente de la
  ligne pré-remplit celle du contrat. Si une donnée manque (prime, durée,
  barème à confirmer, base périodique sur une prime unique), le contrat est
  créé sans commission et un avertissement l'explique.
- **Durée du contrat** : une seule règle partout (formulaire, serveur,
  commission) — années entières de couverture, dernier jour inclus
  (`wholeYearsCovered`).
- **Sans `convention_rate_id`** : comportement historique inchangé.
- **Avertissements** : dès qu'au moins une convention existe dans le CRM, la
  création d'un contrat chez une compagnie sans convention signée et en
  vigueur, ou dans une branche que sa convention ne couvre pas, renvoie un
  avertissement (non bloquant). Tant qu'aucune convention n'est saisie, aucun
  avertissement.
- **Modification** : changer de compagnie ou de branche alors qu'une ligne est
  liée est refusé, sauf si la même requête retire la ligne
  (`convention_rate_id: null`) ou en choisit une autre valide.

## API (authentifiée)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/conventions` | Toutes les conventions avec leurs lignes |
| GET | `/api/conventions/rates?company_id=&branch=[&include_inactive=1]` | Lignes applicables à un contrat |
| GET | `/api/conventions/:id` | Une convention |
| POST | `/api/conventions` | Créer |
| PUT | `/api/conventions/:id` | Modifier |
| DELETE | `/api/conventions/:id` | Supprimer (refusé si une ligne a servi) |
| POST | `/api/conventions/:id/rates` | Ajouter une ligne |
| PUT | `/api/conventions/rates/:rateId` | Modifier une ligne (montants figés si utilisée) |
| DELETE | `/api/conventions/rates/:rateId` | Supprimer une ligne inutilisée |
| POST | `/api/conventions/import` | Importer un fichier (`dry_run` par défaut) |

Toutes les écritures sont journalisées (`audit_log`), sans montant détaillé.

## Fichier d'import

```json
{
  "format": "crm-legrand-conventions",
  "version": 1,
  "deactivate_companies_without_convention": true,
  "retire_missing_rates": false,
  "conventions": [
    {
      "company": { "name": "Compagnie Exemple SA", "aliases": ["Exemple"], "default_acq_rate": 0, "default_rec_rate": 0 },
      "title": "Convention de collaboration",
      "status": "signee",
      "intermediary_code": "0000",
      "effective_date": "2026-01-01",
      "client_followup": "compagnie",
      "obligations": "Pièces à joindre à chaque proposition…",
      "_commentaire": "clé ignorée : tout champ commençant par « _ » est un commentaire",
      "rates": [
        { "branch": "lamal", "label": "Assurance de base", "basis": "fixe", "value": 10,
          "clawback_mode": "paliers", "clawback_steps": [{ "months": 12, "pct": 100 }] }
      ]
    }
  ]
}
```

(valeurs d'exemple sans rapport avec une convention réelle)

L'import est **non destructif** et entièrement validé avant toute écriture,
puis appliqué dans une seule transaction ; l'interface affiche d'abord un
aperçu (`dry_run`, par défaut) avec, pour chaque convention et chaque ligne,
l'action prévue et les champs modifiés.

- **Champs connus seulement** : un champ inconnu (faute de frappe) fait
  refuser le fichier, avec la convention et la ligne concernées. Une clé qui
  commence par « _ » est un commentaire. En tête de fichier sont admis
  `format`, `version`, `generated_at`, `note`,
  `deactivate_companies_without_convention`, `retire_missing_rates` et
  `conventions`.
- **Compagnie** : les entrées du fichier qui partagent un nom ou un alias
  désignent la même compagnie, quel que soit leur ordre. Ce groupe est
  rattaché à la compagnie du CRM qui porte l'un de ses noms — noms
  principaux d'abord, puis alias, dans l'ordre du fichier ; casse, espaces
  et accents ignorés ; une fiche active prime sur un doublon désactivé du
  même nom. Les autres fiches du CRM qui portent l'un de ces noms sont
  signalées dans l'aperçu (homonymes). Sinon la compagnie est créée — active
  seulement si l'une de ses conventions du fichier est signée et en vigueur.
  Seuls les champs fournis (`contact_*`, `finma_number`,
  `default_acq_rate`, `default_rec_rate`) sont écrits. Une compagnie
  **inactive** n'est réactivée que si l'une de ses conventions du fichier
  est **signée et en vigueur**.
- **Convention** : reconnue par compagnie + titre exact (la plus récente en
  cas de doublon). Pour une convention existante, seuls les champs présents
  dans le fichier sont écrits ; un champ absent garde la valeur saisie dans le
  CRM, un champ vide (`""` ou `null`) l'efface — sauf `status` et
  `client_followup`, qui gardent alors leur valeur. Renommer une convention
  ou une ligne dans le CRM la détache du fichier : au prochain import, le
  titre ou le libellé du fichier crée une nouvelle convention ou ligne
  (visible dans l'aperçu) — garder les mêmes intitulés des deux côtés.
- **Lignes de barème** : sans clé `rates`, les lignes de la convention ne
  sont pas touchées. Une ligne est reconnue par branche + libellé ; pour une
  ligne existante, seuls les champs fournis changent (fusion). Une ligne
  **utilisée** dont un montant ou la règle de reprise change est
  **remplacée** : l'ancienne est désactivée, jamais réécrite, et les contrats
  existants la gardent. Une ligne désactivée dans le CRM reste inactive, sauf
  si le fichier indique `"active": true` (un `active` vide ne change rien).
- **Lignes absentes du fichier** : conservées telles quelles par défaut ;
  désactivées (jamais supprimées) avec `retire_missing_rates: true` ou
  l'option `retire_missing` de la requête.
- **Compagnies absentes du fichier** :
  `deactivate_companies_without_convention` (ou `deactivate_others` dans la
  requête) désactive les compagnies actives qui n'ont aucune convention dans
  le fichier — leurs contrats et commissions restent intacts, et une
  compagnie qui a une convention signée et en vigueur dans le CRM n'est
  jamais désactivée.
- **Journal** : une entrée d'audit pour l'import, plus une par compagnie et
  par convention touchée (noms de champs et nombres de lignes, jamais de
  montant).

## Interface

- **Conventions** (menu) : liste par compagnie, conditions, pièces manquantes,
  barème, création/modification, import avec aperçu.
- **Compagnies** : statut de la convention de chaque compagnie.
- **Contrat** : choix de la ligne de barème, commission estimée, période de
  reprise, conditions et pièces à joindre. En modification, aucune commission
  n'est créée ni recalculée. La compagnie d'un contrat existant reste
  sélectionnable même si elle a été désactivée.
- **Commissions → Reprise** : montant proposé selon la convention et la date
  de fin de couverture.
