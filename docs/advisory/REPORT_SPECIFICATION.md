# Spécification du rapport de conseil

> Proposition de conception (LOT 1). Aucune génération de rapport n'est
> implémentée. Ce document décrit le contenu et le cycle de versions ; la
> mise en forme imprimable (PDF) est un lot distinct (Lot 9).

## 1. Contenu attendu

| Section | Source |
|---|---|
| Identité du conseiller | `users` (nom, n° FINMA/Cicero — déjà existants) |
| Identité et composition du foyer | `households`/`household_members`, figée via `advisory_sessions.household_snapshot` |
| Date | `advisory_sessions.scheduled_at`/`started_at` |
| Objet | `advisory_sessions.domain` |
| Consentements | `advisory_consents` actifs au moment de la génération |
| Situation déclarée | résumé des réponses (`advisory_answers`), jamais le détail brut de chaque question |
| Contrats existants | lecture `contracts`/`contract_*`, jamais dupliqués dans le contenu figé au-delà d'un résumé (référence à l'identifiant + valeurs clés au moment de la génération) |
| Objectifs | réponses dédiées du questionnaire |
| Besoins | `advisory_findings` de type `besoin_detecte` |
| Lacunes | `advisory_findings` de type `lacune` |
| Hypothèses | toute donnée marquée comme non vérifiée/déclarative, explicitement labellisée comme telle |
| Informations manquantes | `missing_data` agrégées des `advisory_rule_executions` |
| Solutions étudiées | `advisory_recommendations` (toutes, quel que soit leur statut) |
| Avantages / contraintes | `advisory_rules.client_explanation`/`warnings` des règles à l'origine des recommandations retenues |
| Solutions écartées | `advisory_recommendations.status = ecartee` + `discard_reason` |
| Recommandations humaines | `advisory_recommendations.status = validee_conseiller` uniquement |
| Décision du client | `advisory_recommendations.client_decision` |
| Prochaines étapes | champ dédié, renseigné par le conseiller |
| Version du questionnaire | `advisory_report_versions.questionnaire_version_id` |
| Version des règles | `advisory_report_versions.rule_set_version_id` |
| Mentions réglementaires | information art. 45 LSA, mentions nLPD déjà pratiquées ailleurs dans le CRM (`README.md` existant) — **contenu exact à valider juridiquement**, voir `SECURITY_PRIVACY.md` §20 |
| Historique des versions | liste des `advisory_report_versions` du même `advisory_reports.id`, avec `superseded_by_version_id` |

**Session `domain = mixed` (décision GATE LOT 1, point 3.3)** : le contenu
ci-dessus (besoins, lacunes, solutions étudiées/écartées, recommandations)
est produit **séparément pour `health` et pour `life_pension`**, présenté
en deux sous-sections clairement titrées et jamais fusionné en une liste
unique — chaque finding/recommandation reste rattaché à son domaine
d'origine (voir `DATA_MODEL.md` §3.1, `RULES_ENGINE.md`).

## 2. Distinction des types de version

| Type | Usage | Visible client | Modifiable |
|---|---|---|---|
| `brouillon_interne` | travail en cours, avant tout arbitrage | non | remplacé par une nouvelle génération, jamais réellement figé comme preuve |
| `presentation_client` | ce qui a été montré en rendez-vous (mode présentation, §`UX_AND_CLIENT_MODE.md` 1.11) | oui | non — figé dès génération |
| `rapport_final` | document remis après validation conseiller complète | oui | non — figé dès génération |
| `rapport_corrige` | correction d'une erreur découverte après coup | oui | non — nouvelle version, référence explicitement la version corrigée via `superseded_by_version_id` sur l'ancienne |

**Principe absolu** : aucune version, une fois générée, n'est modifiée en
place. Une correction crée toujours une nouvelle version numérotée,
traçable jusqu'à la précédente.

## 3. Conditions de génération

- `brouillon_interne` : possible à tout moment dès qu'une session existe.
- `presentation_client` : possible dès que le mode présentation a été utilisé
  au moins une fois pendant la session.
- `rapport_final` : nécessite qu'au moins une recommandation ait été
  arbitrée (validée ou écartée avec motif) — jamais généré avec des
  recommandations encore « envisagées » sans que ce soit un choix explicite
  et visible du conseiller (cf. `RULES_ENGINE.md` §9).
- `rapport_corrige` : nécessite une référence explicite à la version
  remplacée ; le cas déclencheur principal est un amendement de réponse
  après finalisation (`POST /api/advisory/sessions/:id/answers/amend`, voir
  `API_CONTRACT.md` §5 et `DATA_MODEL.md` §4.6) dont le résultat diffère de
  la dernière exécution connue.

## 4. Ce que ce document ne fait pas

- Ne choisit pas de bibliothèque de génération PDF (Lot 9, à proposer et
  valider séparément — aucune dépendance de ce type n'existe aujourd'hui
  dans le CRM, vérifié en LOT 0).
- Ne définit pas le layout graphique final (charte exacte, mise en page) —
  matière du Lot 9, en cohérence avec `UX_AND_CLIENT_MODE.md`.
