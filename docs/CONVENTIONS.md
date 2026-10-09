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

Une ligne déjà utilisée par un contrat ou une commission ne peut plus être
supprimée (clé étrangère, conservation comptable), ni voir sa base de calcul,
ses montants ou sa règle de reprise modifiés : on la désactive et on crée une
nouvelle ligne. Son libellé, ses conditions et son statut actif restent
modifiables.

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
part reprise et le montant proposé (base : montant reçu, sinon attendu). C'est
une estimation en lecture seule : la reprise reste créée par le conseiller
(`POST /api/commissions/:id/reverse`), le décompte de la compagnie fait foi.

## Effet sur les contrats

- **Création avec `convention_rate_id`** : la ligne doit appartenir à une
  convention **signée** de la même compagnie, pour la même branche, et être
  active. La commission attendue est créée en montant fixe (`fixed_amount`,
  y compris en LAMal/LCA, où aucun taux générique n'est jamais appliqué), avec
  la ligne d'origine et le détail du calcul en note. Les taux génériques du
  contrat ne génèrent alors aucune autre commission. Si une donnée manque, le
  contrat est créé sans commission et un avertissement l'explique.
- **Sans `convention_rate_id`** : comportement historique inchangé.
- **Avertissements** : dès qu'au moins une convention existe dans le CRM, la
  création d'un contrat chez une compagnie sans convention signée, ou dans une
  branche que sa convention ne couvre pas, renvoie un avertissement (non
  bloquant). Tant qu'aucune convention n'est saisie, aucun avertissement.
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
  "conventions": [
    {
      "company": { "name": "Compagnie Exemple SA", "aliases": ["Exemple"], "default_acq_rate": 0, "default_rec_rate": 0 },
      "title": "Convention de collaboration",
      "status": "signee",
      "intermediary_code": "0000",
      "effective_date": "2026-01-01",
      "client_followup": "compagnie",
      "obligations": "Pièces à joindre à chaque proposition…",
      "rates": [
        { "branch": "lamal", "label": "Assurance de base", "basis": "fixe", "value": 10,
          "clawback_mode": "paliers", "clawback_steps": [{ "months": 12, "pct": 100 }] }
      ]
    }
  ]
}
```

(valeurs d'exemple sans rapport avec une convention réelle)

- La compagnie est retrouvée par nom ou alias (casse et accents ignorés), sinon
  créée. `default_acq_rate` / `default_rec_rate` remplacent les taux par défaut
  génériques de la compagnie.
- Une convention est reconnue par compagnie + titre ; une ligne par branche +
  libellé. Une ligne utilisée dont les montants changent est **remplacée**
  (l'ancienne est désactivée, jamais réécrite) ; une ligne absente du fichier
  est désactivée.
- `deactivate_companies_without_convention` (ou `deactivate_others` dans la
  requête) désactive les compagnies qui n'ont aucune convention dans le
  fichier — leurs contrats restent intacts.
- Le fichier est entièrement validé avant toute écriture, puis appliqué dans
  une seule transaction ; l'interface affiche d'abord un aperçu.

## Interface

- **Conventions** (menu) : liste par compagnie, conditions, pièces manquantes,
  barème, création/modification, import avec aperçu.
- **Compagnies** : statut de la convention de chaque compagnie.
- **Contrat** : choix de la ligne de barème, commission estimée, période de
  reprise, conditions et pièces à joindre.
- **Commissions → Reprise** : montant proposé selon la convention et la date
  de fin de couverture.
