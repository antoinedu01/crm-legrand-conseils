# Synthèse Santé — moteur pur + exposition API

> **Statut d'implémentation** : moteur implémenté et testé au sous-lot
> SYNTH-BE1 (`server/advisoryHealthSynthesis.js`, 57 tests dans
> `test/advisoryHealthSynthesis.test.js`) ; route HTTP exposée en lecture
> au sous-lot SYNTH-API (`server/routes/advisorySessions.js`, 19 tests
> dans `test/advisory-health-synthesis-api.test.js`).

## 1. Objectif et périmètre

La synthèse Santé regroupe, membre par membre, les réponses déclarées au
questionnaire Diagnostic Santé et les findings déjà produits par le moteur
de règles (`server/advisoryRuleExecutions.js`) en un DTO déterministe
destiné à la consultation conseiller — jamais un nouveau moteur de calcul,
jamais une seconde source de vérité.

Ce que la synthèse **n'est pas** :
- **Aucune donnée contractuelle** : ni assureur, ni produit, ni prime, ni
  tarif, ni sélection de couverture — le moteur ne connaît RIEN de ces
  notions (LAMal/LCA compris).
- **Aucune recommandation** : elle ne crée, ne modifie ni ne suggère
  aucune ligne dans `advisory_recommendations`.
- **Aucune validation automatique** : elle ne change jamais l'état d'un
  finding, d'une session ou d'une exécution.
- **Aucune donnée persistée** : calculée à la volée à chaque appel, jamais
  écrite en base, jamais mise en cache serveur (`Cache-Control: no-store,
  private` sur la route HTTP).

## 2. Architecture — deux couches strictement séparées

```
buildHealthSynthesis({ sessionId })          [server/advisoryHealthSynthesis.js]
  └─ getProjectedSessionFindings(sessionId, { domain: 'health' })   [SYNTH-T]
       └─ session / foyer / membres / état d'analyse / findings Santé

GET /api/advisory/sessions/:id/health-synthesis    [server/routes/advisorySessions.js]
  └─ appelle buildHealthSynthesis({ sessionId })  — JAMAIS `req` passé au moteur
  └─ audite la consultation HTTP (voir §7)
  └─ retransmet le DTO tel quel (res.json(dto))
```

- **`buildHealthSynthesis`** est **strictement read-only** : aucun
  `audit_log`, aucune écriture, aucune transaction, utilisable
  indépendamment d'HTTP (par exemple par un futur générateur de brouillon
  de recommandation) sans jamais produire d'entrée d'audit.
- **`getProjectedSessionFindings`** (sous-lot SYNTH-T) reste la seule
  source de vérité pour la résolution session/foyer/membres/état
  d'analyse — le moteur de synthèse ne reproduit jamais cette logique. Elle
  est également, par construction, la seule source du contrôle d'accès en
  lecture (404 session/foyer introuvable, 400 domaine non applicable).
- **La route HTTP** ne duplique aucune logique métier ni aucun contrôle
  d'accès : elle appelle le moteur, transmet le DTO sans transformation,
  et n'ajoute que la frontière d'audit (§7). C'est la SEULE couche qui
  connaisse HTTP — le moteur n'a pas connaissance de la requête.

## 3. Support de version — exclusivement Diagnostic Santé v2

Le moteur ne supporte **que** :
- questionnaire `diagnostic-sante-phase1`, version **2** ;
- si une exécution existe, ensemble de règles `regles-sante-phase1`,
  version **2**.

Toute session dont le questionnaire Santé ou la dernière exécution Santé
utilise une autre version (notamment la v1) est refusée explicitement,
jamais traitée de façon approximative ni rétroactive :

```json
{
  "error": "Le questionnaire Santé de cette session (version 1) n'est pas pris en charge par le moteur de synthèse (version 2 attendue).",
  "code": "HEALTH_SYNTHESIS_UNSUPPORTED_VERSION",
  "details": { "expected_questionnaire_version": 2, "actual_questionnaire_version": 1 }
}
```

— HTTP `409`. Le même code et la même forme de `details` s'appliquent si
c'est la dernière **exécution** Santé (et non le questionnaire) qui utilise
un ensemble de règles non supporté (`expected_rule_set_version`/
`actual_rule_set_version`). Cette garde de version vit **uniquement** dans
le moteur (`SUPPORTED_QUESTIONNAIRE_VERSION`, `SUPPORTED_RULE_SET_VERSION`)
— la route ne la duplique jamais, elle se contente de laisser le `409`
bulle jusqu'au client sans traduction destructive, `details` inclus.

## 4. `analysis_status` et `requires_reanalysis`

Trois états, dérivés de l'état d'analyse produit par SYNTH-T — **tous des
réponses HTTP `200` normales**, jamais transformés en erreur :

| `analysis_status` | Signification | `requires_reanalysis` |
| --- | --- | --- |
| `current` | La dernière exécution Santé complétée porte la révision courante de la session. | `false` |
| `stale` | La session a été modifiée (réponse, amendement) depuis la dernière exécution. | `true` |
| `not_run` | Aucune exécution Santé n'a encore eu lieu pour cette session. | `true` |

Ni la route ni le moteur ne relancent jamais automatiquement une analyse
— `requires_reanalysis` est une information de présentation, jamais un
déclencheur.

## 5. Contenu du DTO

```json
{
  "synthesis_version": 1,
  "session_id": 1,
  "domain": "health",
  "analysis_status": "current",
  "requires_reanalysis": false,
  "source_state_at": "2026-08-01T10:00:00.000Z",
  "members": [
    {
      "household_member_id": 12,
      "member_role": "principal",
      "member_label": "Jean Dupont",
      "historical": false,
      "no_longer_active": false,
      "completeness": {
        "overall": "complete",
        "by_dimension": {
          "accident": { "state": "complete", "missing_stable_keys": [] },
          "franchise_orientation": { "state": "complete", "missing_stable_keys": [] },
          "franchise_current_comparison": { "state": "complete", "missing_stable_keys": [] },
          "care_model": { "state": "complete", "missing_stable_keys": [] },
          "hospitalisation": { "state": "complete", "missing_stable_keys": [] },
          "medecines_complementaires": { "state": "complete", "missing_stable_keys": [] },
          "optique": { "state": "complete", "missing_stable_keys": [] },
          "dentaire": { "state": "complete", "missing_stable_keys": [] },
          "prevention": { "state": "complete", "missing_stable_keys": [] },
          "voyage": { "state": "complete", "missing_stable_keys": [] }
        }
      },
      "accident": { "orientation": { "value": "...", "provenance": "declared_answer", "source_finding_ids": [], "source_answer_ids": [123], "source_answer_keys": ["..."] }, "warnings": [] },
      "franchise": { "orientation": { }, "current_comparison": { }, "warnings": [] },
      "care_model": { "cost_freedom_priority": { }, "preserve_current_doctor": { }, "telemedicine": { }, "family_doctor": { }, "hmo": { }, "free_choice": { }, "warnings": [] },
      "complementary_needs": { "hospitalisation": { }, "alternative_medicine": { }, "optics": { }, "dental": { }, "prevention": { }, "travel": { }, "warnings": [] },
      "warnings": [],
      "source_answer_ids_used": [123, 456],
      "source_finding_ids_all": []
    }
  ],
  "household_summary": {
    "franchise_orientations_present": ["..."],
    "members_with_missing_information": [12]
  }
}
```

### 5.1 Membres — `historical` / `no_longer_active`

Les métadonnées de membre sont propagées **telles quelles** depuis
`sessionMembersFor` (via SYNTH-T) — jamais réinterprétées : un membre
devenu historique (retiré du foyer après le démarrage de la session) reste
**pleinement synthétisé** (réponses et conclusions de cette session
inchangées, complétude et `analysis_status` jamais affectés), seulement
identifiable comme tel via `historical`/`no_longer_active`. Un membre exclu
par contamination croisée entre membres n'est jamais produit : chaque
champ n'utilise que les réponses du membre concerné (jamais
`rule_result`/`getRuleResult`, résultat par exécution et non par membre).

### 5.2 Champs déclarés — `provenance`

Chaque champ individuel (`accident.orientation`, `franchise.orientation`,
`care_model.*`, `complementary_needs.*`, …) porte sa propre `provenance` :

- `declared_answer` — une réponse `answered` existe pour ce membre sur la
  question visible correspondante ;
- `unknown` — une ligne de réponse existe mais n'est pas `answered`
  (statut `unknown`/`cleared`), ou la question est visible sans réponse
  utilisable ;
- `not_applicable` — la question n'est pas visible pour ce membre
  (condition d'affichage non satisfaite, ex. accident déjà couvert par un
  employeur).

`source_answer_ids`/`source_answer_keys` tracent la ou les réponses ayant
produit la valeur ; `source_finding_ids` trace les findings ayant
éventuellement enrichi ou contredit la valeur déclarée (avertissements).
Ces identifiants source restent **présents** dans le DTO — ils font partie
du contrat technique, jamais retirés à l'exposition HTTP.

### 5.3 Complétude — `completeness`

`overall` et `by_dimension[dimension]` prennent l'un de trois états,
jamais un booléen simple :
- `complete` — aucune donnée requise manquante pour cette dimension ;
- `partial` — les données requises (`core`) sont présentes, mais des
  données optionnelles manquent (ex. certains volets du modèle de soins) ;
- `blocked_by_missing_information` — au moins une donnée requise manque.

`missing_stable_keys` liste les clés stables des questions manquantes,
jamais un texte de question ni une valeur de réponse.

Les 6 dimensions complémentaires portent des noms de clé **distincts**
entre `completeness.by_dimension` (`hospitalisation`/
`medecines_complementaires`/`optique`/`dentaire`/`prevention`/`voyage`) et
`complementary_needs` (`hospitalisation`/`alternative_medicine`/`optics`/
`dental`/`prevention`/`travel`) — imposé par le cadrage d'origine, jamais
fusionné ni harmonisé silencieusement par le moteur.

### 5.4 `household_summary`

Rollups factuels déterministes sur l'ensemble des membres — **jamais une
conclusion de foyer** : `franchise_orientations_present` (orientations
franchise réellement déclarées, dédupliquées et triées),
`members_with_missing_information` (ids des membres dont `completeness.
overall !== 'complete'`).

### 5.5 Ce qui n'apparaît jamais

Aucun `generated_at` (la synthèse n'est pas un document horodaté produit
et figé — elle est recalculée à chaque lecture, seul `source_state_at`,
dérivé de données réellement persistées — `session.updated_at`/dernière
exécution — indique la fraîcheur des données source). Aucune donnée
contractuelle, aucun assureur/produit/prime/tarif.

## 6. Route HTTP

`GET /api/advisory/sessions/:id/health-synthesis` — voir
`docs/advisory/API_CONTRACT.md` §7 pour la référence complète (réponse,
erreurs, cache, audit). En bref :
- **Accès** : identique à `GET .../findings-workspace` — foyer archivé
  toujours lisible, statut de session jamais restrictif, aucun droit plus
  permissif ni restriction supplémentaire ajoutée par cette route.
- **Réponse** : le DTO ci-dessus, transmis sans transformation.
- **Erreurs** : `404` session/foyer introuvable, `400` domaine non
  applicable (ni `health` ni `mixed`), `409`
  `HEALTH_SYNTHESIS_UNSUPPORTED_VERSION` (§3).
- **Cache** : `Cache-Control: no-store, private`.

## 7. Audit — frontière HTTP uniquement

Décision d'architecture définitive : **`buildHealthSynthesis`/
`getProjectedSessionFindings` ne journalisent jamais rien.** Seule la
consultation HTTP réelle par un conseiller est auditée, et uniquement
après une synthèse construite **avec succès** — jamais d'entrée
`"consultation synthèse santé session"` créée sur une session inexistante,
un domaine non applicable, ou une version non supportée.

- **Action** : `consultation synthèse santé session`.
- **Entité** : `advisory_session` / `entity_id` = id de session.
- **Déduplication** : même patron que `consultation espace constats
  session` (`server/advisoryRuleExecutions.js`) — fenêtre glissante de 15
  minutes par utilisateur/session ; deux consultations rapprochées ne
  produisent qu'une seule entrée.
- **Détails** — strictement minimisés, au maximum : `domain`,
  `synthesis_version`, `analysis_status`, `requires_reanalysis`
  (`session_id` n'est jamais dupliqué dans `details`, déjà porté par
  `entity_id`). **Ne journalise jamais** : une réponse de santé, une
  valeur de franchise ou de modèle de soins, un besoin complémentaire, un
  texte de finding, une donnée médicale, ni le DTO complet.

Cette séparation garantit qu'un futur appelant interne au moteur (par
exemple un générateur de brouillon de recommandation qui consulterait la
synthèse pour proposer un contenu) n'écrira jamais cette ligne d'audit —
seule une consultation humaine via cette route HTTP le fait.

**Audit dérivé `consultation findings sensibles`** (correction post-revue
compliance-privacy-reviewer) : la synthèse expose un contenu DÉRIVÉ des
mêmes findings Santé que `.../findings-workspace`/`listActiveFindings`
(sans jamais réexposer `used_inputs_ref` elle-même) — même précédent que
les Lots 4A/4B/7A (`docs/advisory/SECURITY_PRIVACY.md`) : toute route de
lecture exposant un tel contenu applique le même critère dérivé
(`hasFrozenSensitiveRefInFindings`, exportée de
`server/advisoryRuleExecutions.js` pour être réutilisée telle quelle,
jamais redéfinie) et le même audit (`auditSensitiveDataAccessIfNeeded`,
action `consultation findings sensibles`, déduplication 15 minutes). La
route rappelle `getProjectedSessionFindings` une seconde fois, uniquement
après le succès de `buildHealthSynthesis`, pour obtenir les findings bruts
nécessaires à ce seul calcul — redondance de lecture déjà assumée ailleurs
dans ce moteur, jamais une seconde logique de projection.

## 8. Hors périmètre de ce sous-lot

- Aucune interface (`client/**` non modifié).
- Aucune publication du questionnaire/ensemble de règles Santé v2 en
  production.
- Aucune migration, aucun changement de schéma.
- Aucune création automatique de recommandation à partir de la synthèse.
- Aucune modification de la logique métier du moteur
  (`server/advisoryHealthSynthesis.js` inchangé depuis SYNTH-BE1).
