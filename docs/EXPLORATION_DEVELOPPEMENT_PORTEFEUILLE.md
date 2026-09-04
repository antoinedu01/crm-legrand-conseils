# Exploration — Développement de portefeuille (02/09/2026)

> **Phase 1 — exploration seulement.** Aucun code, aucune migration, aucune
> donnée touchée pour produire ce document. Rien n'est construit tant que ce
> document n'a pas été validé. Chantier distinct de l'acquisition (phases du
> jour précédent) : ici, il s'agit de faire fructifier le portefeuille de
> clients déjà signés, pas d'en capter de nouveaux.

---

## 0. Pourquoi ce chantier justifie de sortir du gel fonctionnel

Le CRM est gelé sauf besoin métier réel. Celui-ci en est un en une phrase :
**la commission récurrente (portefeuille) de Legrand conseils Sàrl dépend
directement de deux choses que rien n'outille aujourd'hui — ne pas laisser
un contrat partir sans réaction, et ne pas laisser une lacune de couverture
visible dans les données rester invisible pour le conseiller** ; c'est un
sujet de revenu, pas de confort.

---

## 1. Ce qui existe déjà — état exact du schéma et du code

### 1.1 Tables directement concernées

**`clients`** (`server/db.js`, table de base) : `type` (`particulier` |
`entreprise`), `birth_date`, `marital_status`, `profession`, `canton`,
`status` (`prospect` | `client` | `ancien` | `anonymise`). Rien sur le
« potentiel » commercial d'un client — ce n'est stocké nulle part.

**`contracts`** : `client_id`, `company_id`, `branch`, `annual_premium`,
`payment_frequency`, `start_date`, `end_date`, `status` (`offre` | `actif`
| `suspendu` | `resilie` | `echu`). Dix branches possibles (`client/src/labels.js`) :
`vie_3a`, `vie_3b`, `lamal`, `lca`, `lpp`, `hypotheque`, `deces`,
`incapacite`, `rc_menage`, `autre`.

**Point important** : `contracts` porte une **seule** date d'échéance,
`end_date`. Rien ne distingue aujourd'hui la date de fin de couverture du
contrat de la date-limite légale de résiliation (ex. LAMal : résiliable
jusqu'au 30 novembre pour une fin au 31 décembre — deux dates différentes,
vues sur le comparateur LAMal du site public). Pour ce chantier, `end_date`
est la seule donnée exploitable telle quelle.

**Colonnes déjà présentes mais jamais utilisées** — `contracts.review_frequency`
(défaut `annuelle`), `review_last_date`, `review_next_date`, ajoutées en
migration 8 explicitement pour « le pilotage de la revue de portefeuille »,
indexées (`idx_contracts_review_next`), mais **jamais lues ni écrites par
aucune route ni aucune page** (vérifié : aucune occurrence dans
`server/routes/*.js` ni `client/src/**/*.jsx`). C'est un pan entier de
schéma construit puis jamais branché — directement pertinent pour ce
chantier, voir §3.

**`households` / `household_members`** (migration 9, module « Legrand
Diagnostic 360 ») : foyer et adhésion d'un client à un foyer (`principal` /
`conjoint` / `enfant` / `autre_charge`). **Non connecté** aux contrats ou
aux clients côté CRM classique — vérifié, aucune requête ne joint
`contracts`/`clients` à `households` en dehors du sous-système « advisory ».
Utile à savoir pour §2.4.

### 1.2 Deux mécanismes existants qui font déjà, en partie, ce qui est demandé

C'est le point le plus important de cette exploration : **une partie de ce
que vous demandez existe déjà**, sous une forme partielle.

**a) Le widget « Échéances sous 90 jours » du tableau de bord**
(`server/routes/dashboard.js` lignes 64-82) :

```sql
SELECT ... FROM contracts ct ...
WHERE ct.status = 'actif' AND ct.end_date IS NOT NULL
  AND ct.end_date <= date('now', '+90 days')
ORDER BY ct.end_date LIMIT 8
```

Fenêtre fixe de 90 jours, limité à 8 lignes, purement informatif — pas de
priorisation, pas d'action à cocher, pas moyen de voir au-delà des 8
premiers. C'est un teaser, pas un outil de travail.

**b) La règle « Vente complémentaire » du plan d'action du jour**
(`server/routes/today.js` lignes 195-216) — **c'est un prototype quasiment
identique à votre besoin n°1**, juste limité à une seule paire de branches :

```sql
SELECT c.id, ... FROM clients c
WHERE c.status = 'client' AND c.type = 'particulier'
  AND EXISTS (SELECT 1 FROM contracts ct WHERE ct.client_id = c.id AND ct.status = 'actif')
  AND NOT EXISTS (SELECT 1 FROM contracts ct WHERE ct.client_id = c.id
    AND ct.status = 'actif' AND ct.branch = 'incapacite')
```

Traduction : client actif avec au moins un contrat actif, mais aucun
contrat actif de la branche `incapacite`. Chaque client repéré devient une
« action » dans le plan du jour (`priorité`, `raison`, `objectif`), avec
dé-doublonnage automatique (`recentlyLogged` — une action déjà traitée ne
revient pas avant N jours) et un bouton de résultat (`fait` / `pas joint` /
`à relancer` / `sans suite`) — **jamais un envoi automatique**, uniquement
un signalement que le conseiller traite ou ignore lui-même. C'est
exactement la logique de gouvernance que vous demandez (« produit une
liste... c'est moi qui décide »), déjà construite et déjà en production
pour ce cas précis.

**Conséquence directe pour la conception** : la question n'est pas
« comment construire cette fonctionnalité depuis zéro », mais « comment
généraliser une règle qui existe déjà et brancher deux colonnes qui
existent déjà mais dorment ». C'est un chantier d'extension, pas de
création.

---

## 2. Conception proposée — détection mono-produit (besoin n°1)

### 2.1 Principe

Généraliser la logique déjà utilisée pour `incapacite` à deux paires de
branches, dans les deux sens :

- **Groupe Santé** : `lamal`, `lca`.
- **Groupe Prévoyance** : `vie_3a`, `vie_3b`.

Un client `particulier`, statut `client`, avec au moins un contrat actif
dans un groupe et aucun dans l'autre, est signalé — dans les deux sens
(santé sans prévoyance, et prévoyance sans santé), pas seulement un sens.

### 2.2 Ce qui marche déjà avec les données actuelles

Cette détection ne demande **aucune nouvelle colonne** : `contracts.branch`
et `contracts.status` suffisent, exactement comme pour `incapacite`
aujourd'hui.

### 2.3 Ce qui manque ou reste à trancher

- **Faux positifs attendus, à assumer plutôt qu'à corriger tout de suite** :
  un client entièrement satisfait ailleurs (3e pilier bancaire, prévoyance
  via un autre courtier) apparaîtra comme « mono-produit » alors qu'il n'y
  a rien à faire. Aucune donnée du CRM ne permet de le savoir — le
  mécanisme `incapacite` a exactement la même limite aujourd'hui et
  fonctionne quand même, parce que c'est le conseiller qui filtre au moment
  du traitement, pas l'algorithme. Je ne recommande pas de complexifier
  pour corriger ça avant d'avoir vu l'outil à l'usage.
- **Question ouverte, à trancher par vous** : la détection doit-elle
  raisonner **par client individuel** (ce que vous avez décrit — « quelqu'un
  qui n'a chez nous que du LAMal ») ou serait-il plus utile de raisonner
  **par foyer** une fois `households` connecté (ex. le conjoint porte déjà
  le 3a du couple, donc le mono-produit du client A n'est pas une vraie
  lacune) ? Techniquement possible mais **households n'est aujourd'hui
  connecté à rien côté contrats** — le brancher serait un chantier en soi,
  plus grand que le reste de cette demande. Ma recommandation : démarrer
  au niveau client individuel (comme `incapacite` déjà en production), et
  reconsidérer le niveau foyer seulement si les faux positifs s'avèrent
  trop nombreux à l'usage.
- **Champs profil (`birth_date`, `profession`, `marital_status`)** :
  pourraient affiner « le profil pourrait justifier les deux » (ex. exclure
  les clients très âgés du signalement 3e pilier). Je ne le proposerais
  qu'en V2, une fois la version simple testée — ajouter des règles d'âge
  non validées créerait un risque de sur-fiabilité perçue sur un critère
  arbitraire.

---

## 3. Conception proposée — suivi des échéances (besoin n°2)

### 3.1 Deux mécanismes distincts à ne pas confondre

L'exploration du schéma fait apparaître **deux concepts différents**, tous
deux pertinents, mais pas la même chose :

- **Échéance de contrat** (`contracts.end_date`) : la date réelle à
  laquelle un contrat spécifique se termine ou peut être résilié. C'est ce
  que le widget dashboard suit déjà, partiellement.
- **Revue de portefeuille** (`review_next_date`/`review_frequency`) : une
  cadence de contact périodique (ex. annuelle) décorrélée de toute date de
  fin de contrat précise — l'idée d'origine, jamais implémentée, semble
  être « recontacter chaque client une fois par an pour un point complet »,
  indépendamment de si un contrat arrive à échéance ou non.

**Question à trancher avec vous** : voulez-vous les deux, ou seulement le
suivi des échéances réelles (`end_date`) pour commencer ? Les deux
partagent la même mécanique technique (une date + un délai d'alerte), donc
le coût de les faire toutes les deux n'est pas très supérieur à n'en faire
qu'une — mais autant clarifier l'intention avant de concevoir l'écran.

### 3.2 Délai d'alerte — proposition de départ

**Proposition : 90 jours**, alignée sur le widget dashboard existant (pas
de nouveau chiffre à retenir, cohérence avec ce qui existe déjà à l'écran).
Points pour en discuter avec vous plutôt qu'une recommandation figée :

- Les délais légaux réels vus sur le comparateur LAMal (résiliation LCA au
  30 septembre, LAMal au 30 novembre) impliquent que, pour ces deux
  branches précises, une alerte à 90 jours tombe généralement en
  juillet/septembre — cohérent pour préparer une révision avant la fenêtre
  de résiliation, plutôt que de la découvrir dedans.
- Pour un contrat vie/3a/3b, une échéance (fin de contrat, terme) mérite
  probablement plus de recul (120-180 jours) qu'une simple date de
  renouvellement LAMal/LCA — à voir si un délai unique pour toutes les
  branches suffit pour démarrer, ou si vous préférez un délai différencié
  par branche dès le départ.

### 3.3 Ce qui manque

Rien de nouveau côté données pour une version simple sur `end_date` — la
colonne existe et est déjà indexée indirectement par le widget dashboard.
Si vous voulez la version « revue de portefeuille » (§3.1, deuxième
mécanisme), il faudra en plus **écrire** dans `review_next_date` à un
moment donné (ex. après chaque contact, avancer la date d'un an) — ça,
personne ne le fait aujourd'hui, ce serait une vraie nouvelle logique, pas
juste de la lecture.

---

## 4. Conception proposée — priorisation (besoin n°3)

### 4.1 Ce qui existe déjà comme brique réutilisable

`server/routes/today.js` a déjà un système de priorité à 3 niveaux
(`haute` / `normale` / `basse`) et un tri stable (priorité puis date) qui
fonctionne pour tous les types d'actions du plan du jour, mélangés. La
solution la plus simple et la plus cohérente avec l'existant : **faire des
deux nouveaux signaux (mono-produit, échéance) de nouveaux types d'action
dans ce même plan**, plutôt que construire un tableau de bord séparé avec
sa propre logique de tri.

### 4.2 Proposition de règle de priorité de départ

- **Échéance à moins de 30 jours** → `haute`.
- **Échéance entre 30 et 90 jours, ou mono-produit sur un client dont la
  prime annuelle totale actuelle dépasse un seuil à définir** (proxy simple
  du « potentiel » — aucune autre donnée de valeur client n'existe dans le
  schéma actuel) → `normale`.
- **Mono-produit sans échéance proche** → `basse`.

C'est une proposition de départ délibérément simple, dans le même esprit
que les règles déjà en place (ex. `vente_complementaire` est toujours
`basse` aujourd'hui, sans nuance) — à ajuster une fois que vous aurez vu
la liste réelle plutôt qu'à sur-concevoir avant tout usage.

### 4.3 Ce qui manque

Aucune notion de « valeur du client » ou de « probabilité de conversion »
n'existe dans le schéma — la seule proxy disponible sans rien ajouter est
`annual_premium` (somme des primes actives). Une vraie notion de potentiel
(ex. score composite) serait un chantier de conception à part, à ne pas
mélanger avec la version de départ.

---

## 5. Résumé — ce qui est prêt à construire, ce qui reste à trancher

**Peut être construit avec le schéma actuel, sans migration** :
- Détection mono-produit (2 groupes de branches, client individuel).
- Alerte d'échéance sur `end_date` (fenêtre à confirmer).
- Priorisation simple intégrée au plan du jour existant (`today.js`).

**À trancher avec vous avant de concevoir plus loin** :
1. Fenêtre d'alerte échéance : 90 jours partout, ou différenciée par
   branche ?
2. Faut-il aussi le mécanisme « revue de portefeuille »
   (`review_next_date`), en plus des échéances réelles, ou seulement les
   échéances pour commencer ?
3. Raisonnement mono-produit au niveau client individuel (proposition de
   départ) ou foyer (plus juste mais `households` non connecté aux
   contrats aujourd'hui — chantier plus lourd) ?
4. Seuil de prime annuelle pour la priorisation « normale » en §4.2 (ou
   autre proxy de potentiel) ?

**Rappel** : rien de ce document n'a été construit. Prochaine étape,
seulement sur votre feu vert : je proposerai un découpage en lots (ex.
lot 1 = mono-produit seul, lot 2 = échéances, lot 3 = intégration
priorisée) avec sauvegarde/simulation avant tout déploiement, comme pour
le reste du CRM.
