# Moteur de questionnaire dynamique

> Proposition de conception (LOT 1). Aucun moteur n'est implémenté à ce
> stade. Les exemples ci-dessous sont **fictifs et non contractuels** — aucun
> nom de produit réel n'est utilisé.

## 1. Objectif

Permettre de définir, faire évoluer et exécuter des questionnaires
**sans jamais coder de question ou de logique de dépendance en dur dans les
composants React**. Le frontend est un simple moteur de rendu qui affiche ce
que le backend lui envoie (sections, questions, options, conditions déjà
résolues côté serveur ou évaluables simplement côté client à partir d'un
format déclaratif).

## 2. Ce que le moteur doit couvrir

- Plusieurs domaines (`health`, `life_pension`), chacun avec ses propres
  questionnaires.
- Plusieurs versions par domaine, publiées indépendamment, sans jamais
  altérer une version déjà utilisée par une session passée.
- Des sections, ordonnées, avec une portée `foyer` (une fois) ou `membre`
  (répétée automatiquement pour chaque personne concernée du foyer).
- Des questions de types : choix simple, choix multiple, montant, nombre,
  date, texte court, texte long, oui/non.
- Une réponse « inconnue » explicite (`is_unknown`), distincte d'une absence
  de réponse — jamais interprétée comme une valeur par défaut par le moteur
  de règles.
- Une réponse « non applicable » explicite (`is_not_applicable`), pour les
  questions masquées par une condition d'affichage.
- Des questions obligatoires et des questions de clarification (déclenchées
  par une réponse précédente, ex. réponse « inconnue » à une question
  budgétaire → question de clarification optionnelle).
- Des questions posées par personne du foyer plutôt qu'une seule fois pour
  le foyer entier.
- Une validation déclarative (bornes, longueur, énumération) exécutée côté
  serveur avant tout enregistrement, jamais uniquement côté client.
- Des dépendances / conditions d'affichage entre questions et sections.
- Un versionnement complet, avec reprise d'une ancienne version pour
  comprendre un diagnostic passé (voir §7).

## 3. Portée « foyer » vs « membre »

Une section ou une question `applies_to = membre` est évaluée automatiquement
pour chaque `household_member` actif et pertinent du foyer au moment de la
session (le périmètre exact — ex. exclure un membre `autre_charge` d'une
question réservée aux enfants — est défini par une condition d'affichage,
voir §4). Le moteur génère donc dynamiquement N instances de la question,
une par personne concernée, sans que cela soit codé dans l'interface : c'est
une propriété déclarative de la question elle-même.

## 4. Format déclaratif d'une condition d'affichage

Une condition référence soit une réponse précédente (par `stable_key`), soit
un attribut calculable du foyer (nombre d'enfants, âge d'un membre, domaine
de la session). Forme logique proposée (pas un format figé, à raffiner en
Lot 3) :

```json
{
  "all": [
    { "answer": "possede_enfants", "equals": true },
    { "member_attribute": "age", "member_role": "enfant", "gte": 0 }
  ]
}
```

ou, pour une condition simple :

```json
{ "answer": "franchise_connue", "equals": "non" }
```

Opérateurs proposés : `equals`, `not_equals`, `in`, `gte`, `lte`, `is_unknown`,
combinables via `all` (ET) / `any` (OU) / `not`. Ce n'est **pas** un langage
d'expression arbitraire exécutable (pas de `eval`) — un interpréteur fermé,
testable, comme le sont déjà les validations de `contract_lamal` par
énumération fermée.

## 5. Questions de clarification

Une question peut déclencher une question de clarification supplémentaire
quand la réponse est `is_unknown = true` ou quand une valeur dépasse un seuil
(ex. prime actuelle très supérieure à la moyenne cantonale déclarée). La
clarification est elle-même une question normale du questionnaire, affichée
via une condition d'affichage portant sur `is_unknown` de la question
précédente — pas un mécanisme séparé.

## 6. Validation

Chaque question porte une `validation_rule` déclarative (bornes numériques,
longueur de texte, appartenance à une liste fermée d'options). Le serveur
revalide systématiquement à l'écriture (`PUT /api/advisory/sessions/:id/
answers`), même si le frontend valide déjà côté client — même principe de
défense en profondeur que `contract_lamal.deductible` aujourd'hui (aucune
coercition silencieuse de type).

## 7. Versionnement et compatibilité

- Une version publiée (`advisory_questionnaire_versions.status = publie`)
  est **immuable** : sections, questions et options ne changent plus.
- Une évolution (ajout, retrait, reformulation d'une question) crée une
  **nouvelle** version. Les questions dont le sens ne change pas conservent
  le même `stable_key` d'une version à l'autre, ce qui permet de comparer une
  réponse « franchise actuelle » entre deux diagnostics réalisés à un an
  d'écart, même si la version du questionnaire a changé entre-temps.
- Une session référence toujours une version précise
  (`advisory_sessions.questionnaire_version_id`), figée dès le passage en
  `en_cours`. **Relire une session ancienne rejoue exactement la version
  utilisée à l'époque**, y compris si le questionnaire courant est très
  différent aujourd'hui.
- Une option retirée (`advisory_question_options.active = false`) dans une
  nouvelle version n'efface pas les réponses passées qui la référençaient —
  elle reste lisible dans le contexte de l'ancienne version figée.

## 8. Reprise de session

Une session `suspendu` conserve toutes ses réponses déjà enregistrées et sa
version de questionnaire figée. La reprise (`POST .../resume`) réaffiche
exactement l'état où le conseiller s'était arrêté — le moteur recalcule
simplement quelles questions restent à afficher à partir des réponses déjà
connues, sans réinitialiser quoi que ce soit.

### 8.1 Session mixte (`domain = mixed`)

Une session mixte assemble, à la suite l'une de l'autre, les sections du
questionnaire `health` et celles du questionnaire `life_pension` — chaque
section garde la trace de son domaine d'origine (via son
`advisory_questionnaire_version_id` propre). Le moteur ne mélange jamais les
deux questionnaires en un seul : il enchaîne deux parcours distincts au sein
d'une même session, ce qui permet à chaque réponse, chaque règle et chaque
constat de rester rattaché à son domaine (décision GATE LOT 1, point 3.3 —
voir aussi `DATA_MODEL.md` §3.1 et `RULES_ENGINE.md`).

### 8.2 Correction pendant et après la session

Conformément à la décision GATE LOT 1 (point 3.4, détaillée dans
`DATA_MODEL.md` §4.6 et `API_CONTRACT.md` §5) : tant que la session est
`brouillon`, `en_cours` ou `suspendu`, une réponse déjà donnée peut être
librement corrigée en rejouant l'écran correspondant — le moteur ne
conserve que la réponse la plus récente comme active, sans jamais réafficher
une ancienne valeur remplacée comme si elle était toujours en vigueur. Une
fois la session `termine`, le moteur de questionnaire lui-même ne permet
plus aucune saisie : seule la route d'amendement dédiée
(`POST .../answers/amend`) peut introduire une nouvelle réponse, hors du
parcours normal du questionnaire.

## 9. Exemple fictif — Assurance Maladie

*Aucun de ces libellés, seuils ou catégories ne doit être lu comme une règle
officielle. Illustration de structure uniquement.*

```
Section « Franchise et capacité financière » (applies_to: foyer)
  Q. franchise_actuelle_connue (oui_non, required)
      → si "non" : Q. clarification_franchise (texte_court, applies_to: membre)
  Q. capacite_supporter_franchise_elevee (choix_unique: [faible, moyenne, élevée], allows_unknown)

Section « Enfants du foyer » (applies_to: membre, affichée seulement si le foyer compte des membres role=enfant)
  Q. enfant_pratique_sport_licence (oui_non)
  Q. enfant_besoin_orthodontie_connu (oui_non, allows_unknown)
```

## 10. Exemple fictif — Vie et Prévoyance

```
Section « Capacité d'épargne » (applies_to: foyer)
  Q. epargne_mensuelle_disponible (montant, allows_unknown)
  Q. horizon_investissement (choix_unique: [court_terme, moyen_terme, long_terme])

Section « Protection du conjoint » (applies_to: foyer, affichée si household compte un membre role=conjoint)
  Q. conjoint_revenu_propre (oui_non)
  Q. conjoint_couverture_deces_existante_connue (oui_non, allows_unknown)
```

## 11. Frontière avec le moteur de règles

Le moteur de questionnaire ne décide jamais d'un besoin ou d'une lacune — il
collecte uniquement des réponses structurées. C'est le moteur de règles
(`RULES_ENGINE.md`) qui les interprète. Cette séparation permet de tester les
deux moteurs indépendamment, et d'auditer séparément « la question a-t-elle
été bien posée » de « la conclusion est-elle correcte ».
