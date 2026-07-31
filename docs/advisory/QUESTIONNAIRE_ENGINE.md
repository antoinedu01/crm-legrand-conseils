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

> **Implémenté au Lot 3A** (`server/advisoryConditions.js`), avec un format
> définitif divergeant de l'esquisse initiale ci-dessous (opérateurs
> renommés/étendus, forme de référence différente) — décision humaine
> explicite du Lot 3A, testée exhaustivement (déterminisme, cycles,
> références inconnues).

Une condition référence soit une réponse à une question **de la même
version de questionnaire** (jamais une autre version — voir restriction
ci-dessous), soit une propriété de session en liste blanche (`domain`),
soit une propriété du membre en cours d'évaluation en liste blanche
(`member_role`). Forme réellement implémentée :

```json
{ "op": "equals", "ref": { "question": "franchise_connue" }, "value": "non" }
```

```json
{
  "op": "and",
  "conditions": [
    { "op": "exists", "ref": { "question": "possede_enfants" } },
    { "op": "equals", "ref": { "session_property": "domain" }, "value": "mixed" }
  ]
}
```

**Opérateurs implémentés (liste fermée, 12)** : `equals`, `not_equals`,
`in`, `not_in`, `exists`, `not_exists`, `greater_than`, `greater_or_equal`,
`less_than`, `less_or_equal` (comparateurs), `and`, `or` (combinateurs — pas
de `not` séparé, une négation s'exprime via `not_equals`/`not_in`/
`not_exists`). Ce n'est **pas** un langage d'expression arbitraire
exécutable (pas de `eval`, pas de `new Function`) — un interpréteur fermé,
testable (`test/advisory-conditions.test.js`), comme le sont déjà les
validations de `contract_lamal` par énumération fermée.

**Règles de résolution explicites** (tranchées pendant l'implémentation,
absentes de l'esquisse initiale) :
- `exists` est vrai uniquement si la réponse a le statut `answered` avec une
  valeur — `unknown`/`not_applicable`/`cleared`/absence comptent tous comme
  « n'existe pas ».
- Toute comparaison (`equals` **et** `not_equals` y compris) sur une donnée
  absente est **toujours fausse** — jamais de vérité par défaut.
- `and`/`or` évaluent systématiquement toutes leurs sous-conditions (logique
  booléenne pure, sans court-circuit qui changerait un résultat).

**Limite de profondeur d'imbrication (corrigée lors du GATE de validation)** :
`validateConditionFormat` refuse toute condition imbriquée au-delà de 20
niveaux `and`/`or`. Aucune condition métier réelle n'en a jamais besoin ;
cette limite existe uniquement pour empêcher un JSON pathologiquement
imbriqué (des milliers de niveaux) de faire déborder la pile d'appel — un
`RangeError` non intercepté, confirmé empiriquement lors du GATE à partir
d'environ 10 000 niveaux, avant l'ajout de cette limite. La largeur (un
tableau `conditions` très large) reste bornée séparément par la limite de
taille de requête existante (`express.json({ limit: '1mb' })`,
`server/app.js`) : aucune limite de largeur dédiée n'était donc nécessaire.

**Restriction de portée (décision explicite du Lot 3A, pour limiter la
complexité et garantir le déterminisme)** : une condition ne peut référencer
qu'une question de la **même** version de questionnaire — jamais une
question d'une autre version rattachée à la même session (`common` ↔
`health` ↔ `life_pension`), jamais de recherche implicite par `stable_key`
à travers plusieurs versions. Les dépendances inter-domaines restent
réservées au futur moteur de règles (Lot 4+) ou à une évolution
explicitement versionnée.

**Détection de cycle et de référence inconnue** : à la publication d'une
version (jamais à l'exécution), le service construit le graphe de
dépendances de toutes les conditions (sections **et** questions) de cette
version et refuse la publication si une référence pointe vers une
`stable_key` inconnue de la version, ou si une dépendance circulaire existe
entre questions (ex. Q1 visible seulement si Q2 = « oui », et Q2 visible
seulement si Q1 = « oui » — aucune des deux ne serait jamais affichable).

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

### 7.1 Empreinte de contenu (`content_hash`)

**Ce que c'est** : une empreinte technique d'intégrité (SHA-256, module
`crypto` de Node — aucune dépendance ajoutée), calculée une seule fois à la
publication d'une version et stockée sur `advisory_questionnaire_versions.content_hash`.
Elle permet de vérifier après coup qu'une version publiée n'a pas été
altérée. **Ce n'est jamais une signature cryptographique ni une preuve
juridique** — aucune clé privée, aucun tiers de confiance, aucune valeur
probante au sens légal : c'est un simple contrôle d'intégrité interne.

**Indépendance vis-à-vis des identifiants techniques (correctif final avant
premier commit du Lot 3A)** : les identifiants SQLite (`id` de section, de
question, d'option, de version) sont des détails techniques qui varient
entre une version originale et son clone (`cloneVersionToNewDraft`), entre
deux bases distinctes, ou après une restauration — **sans que le contenu
fonctionnel n'ait changé**. Ils n'influencent donc jamais l'empreinte.
`computeContentHash` (`server/advisoryQuestionnaires.js`) construit une
structure canonique :
- **Ordre** : sections, questions et options sont triées par `sort_order`
  puis par `stable_key` (jamais par `id` ni par ordre physique d'insertion).
- **Champs inclus** : `stable_key`, textes (`title`/`description` de
  section ; `advisor_text`/`client_text`/`help_text` de question),
  `type`, `scope`/`applies_to`, `required`, `allows_unknown`,
  `allows_not_applicable`, `sort_order`, `display_condition`,
  `validation_rule`, et pour les options : `stable_key`, `label`, `value`,
  `sort_order`.
- **Jamais inclus** : identifiants de lignes, identifiants de clé étrangère,
  `created_at`/`updated_at`, auteur, `status`, `content_hash` lui-même,
  numéro de version.

**Canonicalisation JSON** : `display_condition` et `validation_rule` sont
des objets JSON dont l'ordre des clés n'a aucune signification
fonctionnelle. `canonicalizeJson` (fonction locale, aucune dépendance
externe) trie récursivement les clés de tout objet par ordre alphabétique
avant sérialisation, tout en conservant l'ordre des tableaux (fonctionnellement
significatif, ex. la liste de valeurs d'un opérateur `in`) ; elle n'exécute
jamais aucun code et ne modifie jamais le contenu réellement stocké en base
— une vue transitoire utilisée uniquement pour le calcul de l'empreinte.

**Propriétés vérifiées par test** (`test/advisory-questionnaires.test.js`) :
même contenu inséré dans un ordre physique différent → même empreinte ;
mêmes objets JSON avec un ordre de clés différent → même empreinte ; un
original publié puis son clone publié sans modification → même empreinte
malgré des identifiants SQLite entièrement différents ; identique même sous
un écart artificiel important entre les plages d'identifiants ; sensible à
tout changement fonctionnel réel (texte, `sort_order`, `stable_key`, option,
`allows_unknown`, `allows_not_applicable`).

## 8. Reprise de session

Une session `suspendu` conserve toutes ses réponses déjà enregistrées et sa
version de questionnaire figée. La reprise (`POST .../resume`) réaffiche
exactement l'état où le conseiller s'était arrêté — le moteur recalcule
simplement quelles questions restent à afficher à partir des réponses déjà
connues, sans réinitialiser quoi que ce soit.

### 8.1 Session mixte (`domain = mixed`)

> **Implémenté au Lot 3A par composition modulaire** (`advisory_session_
> questionnaires`, `DATA_MODEL.md` §3.2), remplaçant l'esquisse ci-dessous
> qui envisageait une version « mixed » assemblant elle-même les deux
> contenus — la revue d'architecture a signalé un risque réel de
> duplication de contenu entre un questionnaire pur et un questionnaire
> mixte avec cette approche.

Une session mixte rattache, via `advisory_session_questionnaires`,
**exactement une version `health` et une version `life_pension`** (chacune
un questionnaire à part entière, jamais fusionné), plus éventuellement une
version `common` partagée (composition du foyer, situation professionnelle,
coordonnées, objectifs globaux du rendez-vous — pour éviter de dupliquer
ces informations dans les deux questionnaires spécialisés). Chaque version
garde son domaine propre et ses conditions d'affichage restent scopées à
elle-même (§4) — ce qui permet à chaque réponse de rester rattachée à son
domaine d'origine sans ambiguïté (décision GATE LOT 1, point 3.3 — voir
aussi `DATA_MODEL.md` §3.1/§3.2 et `RULES_ENGINE.md`), sans qu'aucun contenu
ne soit jamais dupliqué entre un questionnaire pur et une session mixte.

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
