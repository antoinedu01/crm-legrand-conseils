# Checklist manuelle — espace de conduite du rendez-vous (Lot 3B)

> Aucun framework de test frontend n'existe dans ce dépôt (confirmé aux
> Lots 0/2/3A). Conformément aux instructions du Lot 3B, aucune dépendance
> de test frontend n'a été ajoutée pour ce lot. Cette checklist remplace des
> tests automatisés frontend absents — elle a été **exécutée réellement**
> via un navigateur Chromium piloté par Playwright (déjà installé dans cet
> environnement, non ajouté au projet), pas seulement rédigée sur la base du
> code. Les captures et scripts temporaires utilisés pour l'exécution ont été
> supprimés après vérification ; seul ce document et son historique
> d'exécution en gardent la trace.

## Écran : ouverture du workspace (`/diagnostic-360/sessions/:id/workspace`)

- [ ] Le bouton « Ouvrir l'espace de rendez-vous » de la fiche session mène
      au workspace.
- [ ] En-tête : titre, foyer (avec repli `Foyer {primary_display_name}`
      quand `household.label` est absent), statut, domaine, dates,
      conseiller.
- [ ] Tuiles de progression : globale + une par module, avec bouton
      « Ouvrir → » vers le module correspondant.

## Modules et sections

- [ ] Session mono-domaine (Assurance Maladie ou Vie et Prévoyance) : un
      seul module, pas d'onglets affichés.
- [ ] Session mixte : 3 onglets distincts (Commun / Assurance Maladie / Vie
      et Prévoyance), jamais fusionnés, jamais un module « mixed ».
- [ ] Rail de sections : ordre respecté, pastille `✓` ou `x/y` par section
      selon les questions obligatoires visibles, sections masquées comptées
      discrètement en bas du rail plutôt que disparues sans explication.
- [ ] Une condition d'affichage change dynamiquement la visibilité d'une
      question/section sans recharger la page entière ni perdre la position
      de lecture (`usePreservedScroll`).

## Membres

- [ ] Sélecteur de membre sticky visible uniquement pour les sections
      `applies_to: membre`.
- [ ] Changer de membre affiche immédiatement les réponses du bon membre,
      sans mélange entre foyers/membres.
- [ ] Un rôle est visible à côté du nom (`MEMBER_ROLES`).
- [ ] **Périmètre figé (GATE LOT 3B §5)** : un membre retiré du foyer après
      le démarrage de la session reste affiché (suffixe « retiré du foyer »),
      avec un bandeau d'avertissement et ses champs de saisie désactivés ;
      ses réponses déjà enregistrées restent lisibles. Un membre ajouté au
      foyer après le démarrage n'apparaît jamais dans la session déjà en
      cours. La finalisation utilise le même périmètre figé (un manquant
      obligatoire d'un membre historisé reste compté).

## Types de question et valeurs spéciales

- [ ] `boolean` : boutons Oui/Non, `role="radiogroup"` + `aria-checked` par
      bouton, mise à jour optimiste immédiate.
- [ ] `single_choice` / `multiple_choice` : vrais `<input type="radio"/
      "checkbox">`, options retirées non proposées sauf si déjà sélectionnées.
- [ ] `text` / `long_text` / `integer` / `decimal` / `money` : saisie
      debouncée (600 ms), pas de sauvegarde à chaque frappe.
- [ ] `date` : sauvegarde immédiate au changement.
- [ ] « Je ne sais pas encore » / « Non applicable » n'apparaissent que si
      `allows_unknown` / `allows_not_applicable` l'autorisent, sont
      visuellement distincts (style *ghost*) des vraies valeurs de réponse
      juste au-dessus, et se comportent comme un état bascule (`toggled`).
- [ ] « Effacer la réponse » n'apparaît que s'il y a une réponse active, et
      est désactivé pendant que sa propre requête est en vol.

## Sauvegarde et concurrence

- [ ] Indicateur d'état visible : non enregistré / en cours / enregistré /
      erreur, avec le message d'erreur réel du serveur affiché (pas un
      texte générique) via `role="alert" aria-live="assertive"`.
- [ ] Taper, laisser le débounce partir, puis reprendre la saisie avant que
      le rechargement déclenché par la sauvegarde précédente ne soit revenu
      : la frappe la plus récente n'est **jamais** écrasée par l'ancienne
      valeur serveur.
- [ ] Deux sauvegardes rapprochées sur la même question (ex. clics rapides
      Oui puis Non) : seul l'état de la plus récente doit primer.
- [ ] Changer de membre pendant qu'une sauvegarde est en vol pour un autre
      membre n'altère jamais la réponse du second membre.
- [ ] Un double-clic sur « Confirmer la finalisation », « Enregistrer la
      correction » ou « Effacer la réponse » ne déclenche jamais deux
      requêtes concurrentes (bouton désactivé pendant la requête en vol).
- [ ] **Concurrence optimiste (GATE LOT 3B §2)** : deux onglets ouverts sur
      la même session — une écriture sur une révision devenue obsolète
      (autre onglet ayant écrit entre-temps) est refusée avec un message
      explicite (« modifiée ailleurs… ») et déclenche un rechargement
      automatique, sans jamais écraser silencieusement l'écriture
      concurrente. Vérifié également avec des requêtes réseau délibérément
      inversées (la requête émise en premier par l'utilisateur, mais
      retardée réseau, arrive en second au serveur et est bien celle
      rejetée).
- [ ] **Sauvegardes en attente (GATE LOT 3B §3)** : une saisie texte tapée
      juste avant un changement de membre/section/module, une suspension ou
      un contrôle de finalisation est envoyée avant que l'action ne
      s'exécute (`flushPendingSaves`), jamais perdue silencieusement.
- [ ] **Session suspendue = lecture seule totale (GATE LOT 3B §4)** :
      aucune commande de réponse active, tous les champs désactivés ;
      « Reprendre » réactive immédiatement la saisie.

## Finalisation

- [ ] Éléments manquants groupés par module → section → membre, chaque ligne
      cliquable navigue vers la question correspondante et referme la
      modale.
- [ ] Aucun élément manquant : confirmation en deux temps avant finalisation
      effective.
- [ ] Après finalisation : session en lecture seule, saisie désactivée
      partout, bandeau explicite.

## Amendement (post-finalisation)

- [ ] Motif de correction obligatoire (soumission refusée sans motif).
- [ ] La correction crée une nouvelle réponse active sans jamais supprimer
      l'ancienne (visible ensuite dans l'historique).
- [ ] **Amendement contextualisé (GATE LOT 3B §8)** : chaque question
      visible et répondue d'une session finalisée porte une action
      « Corriger cette réponse » qui ouvre directement l'amendement de
      cette question précise (aucun sélecteur à parcourir). Le bouton
      global du header ouvre une recherche textuelle groupée par
      module/section, jamais un `<select>` plat, et reste utilisable avec
      un questionnaire de nombreuses questions (vérifié avec ~100
      questions).

## Historique

- [ ] Modale d'historique : ancienne valeur affichée, auteur, motif
      d'amendement le cas échéant, badge « Actif » sur la ligne courante.

## Responsive et accessibilité

- [ ] Sous 900px (même seuil que `.sidebar`) : rail de sections devient une
      rangée horizontale défilante ; un bandeau de progression sticky
      (`.wksp-progress-sticky`) reste visible en permanence pendant le
      défilement d'une section (remplace les tuiles/le rail, qui eux ne
      restent pas visibles sous ce seuil).
- [ ] Zone de clic des options `single_choice`/`multiple_choice`
      (`.radiogroup label.check`) suffisante au doigt (~35px de hauteur
      mesurée à l'origine, au-dessus du minimum recommandé de 24px). Les
      autres contrôles interactifs du workspace (Oui/Non, valeurs
      spéciales, effacer, historique, amender, sélecteur de membre) portés
      à ~40-44px de hauteur minimale au GATE LOT 3B §12.
- [ ] Navigation clavier : focus visible et ordre logique sur les
      principaux contrôles.

## Historique d'exécution

**Première exécution** (implémentation initiale) : parcours Playwright
couvrant la quasi-totalité des scénarios ci-dessus sur une base de
démonstration temporaire (`CRM_DATA_DIR` isolé, données entièrement
fictives, jamais committées) : session santé simple, session mixte à 3
modules, bascule d'onglets, visibilité conditionnelle, portée par membre et
changement de membre, tous les types de question majeurs (dont un test
dédié `multiple_choice`), `unknown`/`not_applicable`/effacement, état
d'erreur de sauvegarde, suspension/reprise, finalisation bloquée puis
réussie, verrouillage en lecture seule, amendement (avec une erreur de
validation authentique puis un succès), historique avec valeur et auteur,
tablette en paysage et portrait, et une vérification programmatique (pas
seulement visuelle) du focus clavier. Aucune erreur console/page observée à
aucune étape. Captures et scripts temporaires supprimés après vérification.

**Seconde exécution** (corrections issues des revues post-implémentation
`client-meeting-ux` et « auditeur généraliste ») : nouvelle base de
démonstration temporaire dédiée, session santé fictive avec une question
`boolean` et une question `text`. Vérifié spécifiquement :
- la race condition de resynchronisation texte : latence artificielle
  injectée (`page.route`) sur la sauvegarde et le rechargement (jusqu'à
  ~2,4 s cumulées, très supérieur à la fenêtre réelle du bug), frappe
  reprise pendant que l'ancien rechargement était encore en vol — la valeur
  finale correspond exactement à la dernière frappe, aucune perte
  constatée ;
- le rôle `radiogroup`/`aria-checked` du type `boolean` : présents et mis à
  jour correctement après clic ;
- le style `ghost` des boutons « Je ne sais pas encore »/« Non applicable »,
  désormais visuellement distincts des boutons Oui/Non ;
- le garde-fou anti-double-clic, avec latence artificielle sur chaque route
  concernée : « Effacer la réponse » reste désactivé pendant toute la durée
  de sa requête (une seule requête `DELETE` envoyée), « Confirmer la
  finalisation » de même (une seule requête `POST .../complete`), et
  « Enregistrer la correction » de même (une seule requête `POST .../
  answers/amend` — la vérification a par ailleurs produit une erreur de
  validation authentique du serveur, imputable au script de vérification
  qui avait choisi une valeur vide pour une question booléenne, pas à
  l'application) ;
- le bandeau de progression sticky sous 900px : visible et non chevauché
  par le sélecteur de membre (rendu non collant sous ce seuil pour éviter
  toute superposition des deux bandeaux) ;
- la hauteur de zone cliquable de `.radiogroup label.check` : mesurée à
  35px après correctif (contre ~16-20px avant), au-dessus du minimum
  recommandé.

Aucune erreur console/page observée pendant cette seconde exécution.
`npm run lint`, `npm test` (573/573) et `npm run build` exécutés avec
succès après les correctifs. Base de démonstration, scripts et captures
temporaires supprimés après vérification ; aucune de ces données n'a été
committée.

**Troisième exécution (GATE de validation et de correction, avant premier
commit)** : base de démonstration temporaire dédiée (5 sessions fictives —
mixte à 3 modules avec section conditionnelle par membre, santé simple,
santé avec membre historisé/ajouté, vie-prévoyance simple, santé à ~100
questions), plusieurs contextes de navigateur concurrents pour les
scénarios de concurrence. Matrice exacte des 30 scénarios requis :

| # | Scénario | Résultat |
|---|---|---|
| 1 | Santé | Réussi — mono-domaine, pas d'onglets |
| 2 | Vie/prévoyance | Réussi — mono-domaine, pas d'onglets |
| 3 | Mixte | Réussi — 3 onglets distincts (Commun/Maladie/Prévoyance), jamais « mixed » |
| 4 | Commun | Réussi — premier onglet |
| 5 | Conditionnelle | Réussi — section masquée puis révélée par la réponse au déclencheur |
| 6 | Membre | Réussi — sélecteur de membre présent pour la section à portée membre |
| 7 | Changement de membre | Réussi — bascule immédiate, isolation confirmée |
| 8 | Neuf types de question | Réussi — les 9 types saisis, persistés, relus après rechargement |
| 9 | `unknown` | Réussi — bascule visuelle correcte |
| 10 | `not_applicable` | Réussi — bascule visuelle correcte |
| 11 | Effacement | Réussi — bouton disparaît après effacement |
| 12 | Erreur de sauvegarde | Réussi — état d'erreur affiché après coupure réseau simulée |
| 13 | Suspension | Réussi — lecture seule totale, tous champs désactivés |
| 14 | Reprise | Réussi — saisie réactivée immédiatement |
| 15 | Finalisation bloquée | Réussi — élément manquant listé, navigation au clic |
| 16 | Finalisation réussie | Réussi — confirmation en deux temps, session finalisée |
| 17 | Lecture seule | Réussi — bannière + champs désactivés après finalisation |
| 18 | Amendement | Réussi — contextualisé (verrouillé sur la question) et recherche globale (groupée, sans `<select>` plat) |
| 19 | Tablette | Réussi — portrait 820×1180 et paysage étroit 850×500 : rail horizontal, bandeau de progression visible au défilement ; paysage tablette standard 1180×820 (>900px) : disposition desktop, cohérent avec le seuil partagé `.sidebar` |
| 20 | Clavier | Réussi — focus visible, navigation Tab fonctionnelle (vérification programmatique) |
| 21 | Deux onglets concurrents | Réussi — écriture sur révision obsolète refusée avec message clair, rechargement automatique, aucune erreur JS |
| 22 | Requêtes réseau inversées | Réussi — requête émise en premier mais retardée réseau (1,5 s), arrivée en second au serveur : bien rejetée ; valeur finale en base = celle arrivée en premier, jamais celle émise en premier |
| 23 | Saisie texte puis finalisation immédiate | Réussi — `flushPendingSaves` envoie la saisie avant l'ouverture de la modale, valeur bien persistée |
| 24 | Saisie texte puis changement de membre | Réussi — note flushée avant le changement, relue correctement après retour sur le membre |
| 25 | Ancien membre | Réussi — retiré via l'API réelle (`DELETE .../members/:id`), reste visible marqué « retiré du foyer », bandeau d'avertissement, saisie désactivée, réponse historique toujours affichée |
| 26 | Membre ajouté après démarrage | Réussi — ajouté via l'API réelle (`POST .../members`) après le démarrage, n'apparaît jamais dans la session déjà en cours |
| 27 | Absence de questionnaire publié | Vérification de non-régression (écran de création de session accessible) — le scénario complet est déjà couvert par `LOT2_MANUAL_UI_CHECKLIST.md`/`LOT3A_MANUAL_UI_CHECKLIST.md`, non modifié par ce lot |
| 28 | Historique/amendement avec 100 questions | Réussi — 20 questions répondues correctement listées (sur 100, dont 80 jamais répondues et donc absentes du sélecteur d'amendement, comportement attendu), recherche textuelle instantanée (664ms), sélection ouvre la bonne question |
| 29 | Cache HTTP | Réussi — `Cache-Control: no-store, private` confirmé sur la route workspace en conditions réelles de navigateur (en complément du test API) |
| 30 | Audit d'accès dédupliqué | Réussi — vérifié en base après l'ensemble des scénarios de concurrence (5 contextes de navigateur distincts, dizaines de rechargements réels) : une seule ligne `consultation workspace session` par session, jamais une par rechargement |

Aucune erreur console/page observée à travers l'ensemble des 30 scénarios
(hormis l'erreur réseau délibérément provoquée par le scénario 12,
attendue). `npm run lint`, `npm test` (589/589) et `npm run build` exécutés
avec succès après l'ensemble des correctifs du GATE. Base de démonstration,
scripts de seed et de vérification, et tous les fichiers temporaires
supprimés après exécution ; aucune de ces données n'a été committée.
