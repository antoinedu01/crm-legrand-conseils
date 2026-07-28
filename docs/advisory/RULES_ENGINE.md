# Moteur de règles — déterministe, versionné, explicable

> Proposition de conception (LOT 1). Aucun moteur n'est implémenté. Tous les
> exemples de règles sont **fictifs et non contractuels** — aucune règle
> réelle d'assurance, aucun seuil réglementaire officiel n'est affirmé ici.

## 1. Principes non négociables

- **Déterministe** : mêmes réponses + même version de règles → toujours le
  même résultat. Aucun hasard, aucun appel à un modèle statistique ou à une
  IA dans le calcul lui-même.
- **Versionné** : toute règle appartient à un `advisory_rule_set` versionné
  par domaine (`DATA_MODEL.md` §5.1). Une session fige la version utilisée.
- **Explicable** : chaque résultat pointe vers la règle exacte qui l'a
  produit, avec une explication en langage naturel pour le conseiller et,
  séparément, une reformulation pédagogique pour le client.
- **Testable** : une règle est une donnée versionnée, testable
  indépendamment du reste de l'application (mêmes conventions que
  `test/migrations.test.js`/`test/api.test.js`).
- **Auditable** : chaque exécution est tracée (`advisory_rule_executions`),
  jamais recalculée silencieusement après coup.
- **Indépendant de l'intelligence artificielle** : le moteur ne fait aucun
  appel IA. L'IA peut, plus tard, reformuler un résultat déjà produit
  (`client_explanation`), jamais produire elle-même un constat ou une
  recommandation.

## 2. Format logique d'une règle

| Champ | Rôle |
|---|---|
| `stable_key` | identifiant stable de « cette règle logique », à travers ses versions successives |
| `domain` | `health` \| `life_pension` — une règle n'appartient jamais à `mixed` (cette valeur ne qualifie qu'une session, jamais une règle, un finding ou une recommandation ; voir `DATA_MODEL.md` §3.1) |
| `version` | portée par le `rule_set` auquel la règle appartient |
| `status` | `brouillon` \| `valide` \| `archive` — seul `valide` peut s'exécuter sur une session réelle |
| `conditions` | expression déclarative fermée (même famille de format que les conditions d'affichage du questionnaire, §4 de `QUESTIONNAIRE_ENGINE.md`), portant sur des réponses (`stable_key`) et/ou des données de contrat existantes |
| `required_data` | liste des données nécessaires à l'évaluation (réponses et/ou champs de contrat) |
| `missing_data` (calculé à l'exécution) | sous-ensemble de `required_data` non disponible pour cette session — si non vide, la règle ne conclut pas, elle signale l'insuffisance (voir §6) |
| `result` | `finding_type` + `result_payload` structuré (catégorie de besoin/lacune, jamais un produit nommé) |
| `type de finding` | `besoin_detecte` \| `lacune` \| `avertissement` \| `contre_indication` — jamais `recommandation_validee` |
| `priority` | entier, pour l'ordonnancement de l'affichage |
| `explication conseiller` | texte technique, peut citer la condition exacte qui a déclenché |
| `explication client` | reformulation pédagogique, sans jargon, affichable en mode présentation |
| `avertissements` | liste de mises en garde associées (ex. « nécessite vérification de l'état de santé ») |
| `contre-indications` | liste de situations qui invalident la conclusion malgré des conditions par ailleurs remplies |
| `source` | référence interne ou réglementaire précise et datée — **jamais vide** pour une règle `valide` |
| `date d'effet` / `date de fin` | validité temporelle de la règle elle-même (indépendante de la version du rule_set) |
| `validateur humain` | identité + date de la validation qui a fait passer la règle de `brouillon` à `valide` |

## 3. Les sept étapes — distinction stricte

Le moteur ne doit jamais fusionner ces étapes :

1. **Donnée collectée** — une réponse (`advisory_answers`) ou une donnée de
   contrat existante (`contracts`/`contract_*`). Fait brut, non interprété.
2. **Constat** — une observation directe dérivée d'une donnée (ex. « le
   foyer a 2 enfants », « la franchise actuelle est 300 ») — pas encore un
   jugement de besoin.
3. **Besoin détecté** (`finding_type = besoin_detecte`) — une règle a établi
   qu'une situation appelle une réponse (ex. « capacité financière compatible
   avec une franchise plus élevée »).
4. **Lacune** (`finding_type = lacune`) — un écart entre une protection
   existante (lue dans `contracts`) et un besoin détecté.
5. **Catégorie de solution** (`advisory_recommendations.category`) — un
   regroupement de besoins/lacunes en famille de réponse possible (ex.
   « révision de la franchise LAMal »), **jamais un produit ou un assureur
   nommé**.
6. **Produit potentiellement compatible** — hors périmètre de cette version
   (aucun catalogue produit n'existe, cf. Lot 11) ; quand il existera, ce
   sera une donnée **distincte**, alimentée par un catalogue validé
   séparément, jamais générée par le moteur de règles lui-même.
7. **Recommandation validée humainement**
   (`advisory_recommendations.status = validee_conseiller`) — **exclusivement**
   via une action explicite du conseiller authentifié
   (`PUT /api/advisory/recommendations/:id`), jamais une sortie directe du
   moteur.

**Une règle automatique ne doit jamais produire directement l'étape 7.** Le
moteur peut, au mieux, proposer une recommandation à l'état `envisagee` —
l'étape 7 exige toujours une action humaine distincte, horodatée, dont
l'identité est renseignée côté serveur (jamais transmise par le client de
l'API, voir `API_CONTRACT.md` §7).

## 4. Empêcher les règles contradictoires

- Deux règles `valide` du même `rule_set` ne doivent pas produire, pour les
  mêmes conditions exactes, deux `result_payload` incompatibles pour la
  même catégorie de besoin. Proposition de contrôle (à l'implémentation,
  Lot 4) : un test de cohérence exécuté à la publication d'un `rule_set`
  (pas à l'exécution en temps réel), qui simule des combinaisons de réponses
  types et signale toute collision.
- En cas de déclenchement simultané de règles aux conclusions différentes
  sur un même sujet, les deux `findings` sont conservés (jamais l'un
  supprimé silencieusement au profit de l'autre) — c'est au conseiller de
  trancher, avec les deux explications sous les yeux.

## 5. Empêcher les doublons

- `stable_key` unique par `rule_set` (contrainte à l'implémentation).
- Un test de publication vérifie qu'aucune règle du nouveau `rule_set` n'a un
  `conditions` strictement identique à une autre règle déjà présente dans le
  même ensemble (alerte, pas blocage automatique — la décision de fusionner
  ou non revient à l'humain qui publie).

## 6. Empêcher les règles sans source

- Une règle ne peut passer `status = valide` si `source` est vide ou si
  `validated_by`/`validated_at` ne sont pas renseignés. Contrôle proposé au
  niveau applicatif (Lot 4), pas uniquement documentaire.

## 7. Empêcher les règles expirées

- À l'exécution, seules les règles dont `effective_from <= date du jour <=
  effective_until (ou null)` sont évaluées. Une règle expirée reste visible
  dans l'historique (elle a pu s'appliquer à une session passée) mais ne
  s'exécute plus sur une nouvelle session.

## 8. Empêcher les diagnostics basés sur des informations manquantes

- Si `missing_data` n'est pas vide pour une règle, celle-ci produit une
  exécution `outcome = donnees_manquantes` — **pas** un résultat par défaut,
  **pas** une hypothèse silencieuse. Le manque est lui-même visible et
  journalisé (voir aussi le principe LOT 0 : « ne jamais masquer une
  information manquante »).
- Le rapport (`REPORT_SPECIFICATION.md`) reprend explicitement la liste des
  informations manquantes ayant empêché une conclusion.

## 9. Empêcher les recommandations silencieuses

- Toute `advisory_recommendation` à l'état `envisagee` doit être visible
  dans l'interface conseiller **avant** toute génération de rapport — aucune
  route ne doit permettre de générer un `rapport_final` sans qu'au moins un
  passage explicite par l'écran de validation ait eu lieu (contrôle
  applicatif à l'implémentation, Lot 7/9).
- Écarter une recommandation ou un constat exige toujours un motif
  (`discard_reason` non vide) — jamais un écartement muet.

## 10. Empêcher la modification rétroactive d'un ancien diagnostic

- Dès que `advisory_sessions.status = termine`, toutes les lignes déjà
  écrites (`advisory_answers`, `advisory_rule_executions`,
  `advisory_findings`, `advisory_recommendations` déjà validées,
  `advisory_report_versions` déjà générées) deviennent **immuables — aucune
  n'est jamais mise à jour en place**. Une erreur découverte après coup ne
  réécrit rien : elle passe par le mécanisme d'amendement explicite
  (décision GATE LOT 1, point 3.4) — une nouvelle réponse
  `advisory_answers.is_amendment = true` avec motif obligatoire
  (`POST /api/advisory/sessions/:id/answers/amend`), qui déclenche une
  **nouvelle** exécution du moteur de règles et, si le résultat en est
  changé, une **nouvelle** version de rapport (`rapport_corrige`). L'ancienne
  réponse reste consultable (`superseded_by_answer_id`), l'ancienne
  exécution et l'ancien rapport restent inchangés et consultables — rien
  n'est jamais réécrit, seulement complété par une couche supplémentaire
  tracée.
- Publier une nouvelle version d'un `rule_set` ou d'un questionnaire n'altère
  jamais les sessions qui référencent une version antérieure figée.

## 11. Exemple fictif de règle — Assurance Maladie

*Catégorie de besoin fictive, aucun seuil ni référence réglementaire réels.*

```
stable_key: "health-franchise-capacite-01"
domain: health
conditions: {
  "all": [
    { "answer": "capacite_supporter_franchise_elevee", "in": ["moyenne", "élevée"] },
    { "answer": "franchise_actuelle_connue", "equals": true },
    { "contract_field": "contract_lamal.deductible", "lte": 300 }
  ]
}
required_data: ["capacite_supporter_franchise_elevee", "franchise_actuelle_connue", "contract_lamal.deductible"]
result:
  finding_type: besoin_detecte
  result_payload: { category_hint: "revision_franchise_lamal" }
priority: 30
advisor_explanation: "Franchise actuelle basse alors que la capacité financière déclarée permettrait d'envisager une franchise plus élevée — à confirmer avec le client avant toute proposition."
client_explanation: "Votre franchise actuelle pourrait ne plus correspondre à votre situation financière actuelle."
warnings: ["Nécessite de vérifier la consommation médicale réelle avant toute décision."]
source: "Référence interne — méthodologie de conseil Legrand Conseils, à valider par un spécialiste métier avant mise en production"
status: brouillon
```

## 12. Exemple fictif de règle — Vie et Prévoyance

```
stable_key: "vie-deficit-incapacite-01"
domain: life_pension
conditions: {
  "all": [
    { "answer": "epargne_mensuelle_disponible", "is_unknown": false },
    { "computed": "deficit_mensuel_incapacite", "gt": 0 }
  ]
}
required_data: ["revenu_net_mensuel", "charges_mensuelles_fixes", "prestations_lpp_invalidite_estimees"]
result:
  finding_type: lacune
  result_payload: { category_hint: "couverture_incapacite_gain" }
priority: 40
advisor_explanation: "Le modèle configurable de calcul du déficit mensuel en cas d'incapacité indique un écart positif — à vérifier avec les prestations LPP réelles du foyer avant toute conclusion."
client_explanation: "En cas d'incapacité de travail prolongée, votre revenu de remplacement pourrait ne pas couvrir vos charges actuelles."
warnings: ["Le calcul est un modèle configurable, pas une simulation actuarielle certifiée."]
source: "Modèle de calcul interne — à valider par un spécialiste prévoyance avant mise en production"
status: brouillon
```

## 13. Rapport avec `compliance-privacy-reviewer` et `rules-engine-auditor`

Aucune règle ne passe `brouillon → valide` sans revue explicite (source
présente, absence de contradiction, tests associés) — c'est le rôle du
sous-agent `rules-engine-auditor` (voir `.claude/agents/rules-engine-
auditor.md`), pas une auto-validation par le moteur lui-même.
