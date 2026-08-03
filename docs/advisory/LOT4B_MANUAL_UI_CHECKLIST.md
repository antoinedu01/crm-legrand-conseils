# Checklist manuelle — espace conseiller des findings (Lot 4B)

> Aucun framework de test frontend n'existe dans ce dépôt (confirmé aux
> Lots 0/2/3A/3B). Conformément aux instructions du Lot 4B, aucune
> dépendance de test frontend n'a été ajoutée pour ce lot. Cette checklist
> remplace des tests automatisés frontend absents — elle a été **exécutée
> réellement** via un navigateur Chromium piloté par Playwright (déjà
> installé dans cet environnement, non ajouté au projet), pas seulement
> rédigée sur la base du code, exactement selon la même convention que
> `LOT3B_MANUAL_UI_CHECKLIST.md`. Les bases de démonstration, scripts de
> seed/vérification et captures temporaires ont été supprimés après
> exécution ; seul ce document et son historique d'exécution en gardent la
> trace.

## Écran : ouverture de l'espace des constats (`/diagnostic-360/sessions/:id/findings`)

- [ ] Le bouton « Ouvrir les constats » n'apparaît sur la fiche session que
      pour une session `completed` (absent sur `draft`/`in_progress`/
      `suspended`/`cancelled`).
- [ ] En-tête : titre, foyer, statut de session, bouton secondaire
      « Ouvrir l'espace de rendez-vous » pour revenir corriger une réponse
      sans quitter le contexte.
- [ ] La route n'est jamais ajoutée au menu latéral (`NAV`), au même titre
      que `/workspace` — atteignable uniquement depuis la fiche session.

## Domaines et onglets

- [ ] Session mono-domaine (Assurance Maladie ou Vie et Prévoyance) : deux
      onglets (Commun + le domaine propre), jamais un onglet « mixed ».
- [ ] Session mixte : trois onglets distincts (Commun / Assurance Maladie /
      Vie et Prévoyance), jamais fusionnés, jamais interleaved — les
      constats d'un domaine n'apparaissent JAMAIS dans un autre onglet.
- [ ] Un onglet portant au moins un conflit actif affiche un repère visuel
      (⚠) sans qu'il faille l'ouvrir pour le savoir.
- [ ] Lancer l'analyse depuis un onglet sans résultat bascule automatiquement
      vers le premier domaine ayant produit des constats — jamais un onglet
      vide laissé silencieusement après un lancement réussi ailleurs.

## États d'analyse par domaine (§9)

- [ ] Aucun ensemble de règles publié pour un domaine : bannière explicite
      (« aucun ensemble de règles n'est actuellement publié »), jamais une
      erreur, jamais un plantage — le bouton de lancement reste désactivé
      seulement au niveau du domaine concerné.
- [ ] Ensemble publié mais aucune exécution encore lancée : bannière
      « analyse non encore lancée », distincte de l'état précédent.
- [ ] Après une analyse réussie : bannière « à jour » avec la date, lien
      « Voir l'historique des analyses » atteignable qu'importe l'état
      (voir plus bas).
- [ ] Une réponse amendée après une analyse fait passer le domaine à
      « modifications depuis la dernière analyse » (state) — les constats
      affichés restent ceux de la DERNIÈRE analyse réussie, jamais
      recalculés silencieusement ; seule une relance explicite les met à
      jour (§7.5, jamais automatique).
- [ ] Un dernier lancement en échec est signalé distinctement (bannière
      d'erreur), sans jamais masquer les constats de la dernière analyse
      réussie s'il y en a une.

## Cohérence multi-domaines : état global et synthèse active (GATE LOT 4B §3, ajouté après le premier commit)

- [ ] Un badge d'état global (« Non analysée »/« À jour »/« Partielle »/
      « Obsolète »/« Indisponible »/« En erreur ») apparaît dans l'en-tête,
      calculé UNIQUEMENT sur les domaines REQUIS par le type de session
      (santé requiert santé ; vie/prévoyance requiert vie/prévoyance ; mixte
      requiert les deux) — `Commun` reste toujours facultatif, son absence
      ou son état obsolète ne fait jamais chuter l'état global.
- [ ] Un bandeau « Synthèse active » (visible uniquement en session mixte)
      totalise les constats actifs/conflits UNIQUEMENT des domaines
      eux-mêmes à jour ; un domaine obsolète reste consultable dans son
      propre onglet mais son bandeau explique clairement qu'il n'est pas
      compté dans ce total tant qu'une nouvelle analyse n'a pas été
      relancée pour lui spécifiquement.

## Lancement de l'analyse (orchestration, §7)

- [ ] Un seul bouton « Lancer l'analyse » lance TOUS les domaines
      applicables à la session en un geste ; le résultat est structuré par
      domaine (`completed`/`failed`/`skipped_no_published_rule_set`),
      jamais un statut global opaque.
- [ ] Un échec inattendu sur un domaine n'empêche jamais un autre domaine
      valide de se terminer normalement (pas d'atomicité globale, GATE LOT
      4B §7) — vérifié en forçant une erreur ciblée côté serveur, y compris
      dans les deux ordres (premier domaine en échec puis second réussi, et
      l'inverse — GATE LOT 4B §4).
- [ ] Double-clic rapide sur « Lancer l'analyse » : une seule requête
      envoyée (garde anti-double-clic), vérifié avec une latence réseau
      artificielle — garde renforcée par une ref synchrone après détection
      d'une fenêtre de course réelle pendant le GATE ciblé (voir Historique
      d'exécution).
- [ ] Double-clic rapide sur « Écarter » (modale d'écartement) : même garde,
      même correctif.
- [ ] Amendement/écartement/relance survenant dans un AUTRE onglet pendant
      que cet onglet reste ouvert : la révision périmée déclenche un 409 à
      la prochaine écriture de cet onglet (message clair, rechargement
      automatique) ; un simple rechargement manuel reflète toujours l'état
      qui vient d'être modifié ailleurs (constat/exécution ajoutée, écartée,
      ou remplacée), jamais fusionné silencieusement.
- [ ] Aucun message de succès n'apparaît jamais avant la confirmation
      effective du serveur (le bouton affiche « Analyse en cours… » pendant
      toute la requête, aucun texte de succès prématuré).
- [ ] Révision de session obsolète (409) au lancement : message clair,
      rechargement automatique, jamais une erreur brute.
- [ ] Erreur réseau/serveur inattendue au lancement : message d'erreur
      affiché, bouton réactivé (jamais bloqué définitivement), aucune
      exception JavaScript non gérée.
- [ ] Foyer archivé : bouton de lancement désactivé, bannière d'archivage
      explicite.

## Contenu de la carte de constat (§12)

- [ ] Badges toujours présents : type (fait/besoin/lacune/avertissement/
      information manquante/catégorie générale), priorité, portée
      (session/foyer/membre), et le nom du membre concerné le cas échéant.
- [ ] `advisor_explanation` toujours affichée ; `client_explanation`,
      quand présente, porte le libellé obligatoire « Formulation
      préparatoire — à valider par le conseiller. », visuellement distinct.
- [ ] Un constat `missing_information` liste les données manquantes avec un
      lien « Répondre → » qui navigue vers la question correspondante.
- [ ] Avertissements/contre-indications affichés distinctement (styles
      alerte dédiés), jamais noyés dans le texte libre.

## Conflits entre constats (§14)

- [ ] Deux constats issus de règles DIFFÉRENTES partageant la même
      catégorie sont tous deux marqués « Conflit actif (N) ».
- [ ] Des constats produits par LA MÊME règle pour plusieurs membres
      (portée membre) ne se signalent jamais en conflit entre eux, même en
      partageant une catégorie — correctif appliqué et vérifié après
      détection en QA (voir Historique d'exécution).
- [ ] Écarter l'un des deux constats en conflit fait disparaître le badge
      sur l'AUTRE (recalcul de l'état actif), sans jamais toucher au
      constat historique figé à la production de l'exécution.

## Filtres et organisation (§11)

- [ ] Puces de filtre : Statut (Actifs/Écartés/Tous), Priorité, Type,
      Membre (n'apparaît que si des constats à portée membre existent).
- [ ] Chaque filtre est une PARTITION STABLE de la liste déjà triée par le
      serveur — jamais un nouveau tri : l'ordre relatif des éléments
      restant visibles ne change jamais en togglant un filtre.
- [ ] Ordre par défaut respecté : conflits actifs d'abord, puis priorité
      (critique > élevée > moyenne > faible), puis ordre déterministe du
      serveur — jamais réordonné différemment côté client.

## Sources, traçabilité et navigation vers la réponse source (§15, §16, §17)

- [ ] Panneau « Sources et traçabilité » (accordéon natif) : source,
      référence, date d'effet.
- [ ] Chaque réponse utilisée est identifiée par le TEXTE de la question
      (jamais un identifiant technique brut, jamais la valeur de la
      réponse elle-même) ; une donnée sensible est signalée par un repère
      textuel, sans jamais afficher la valeur.
- [ ] « Voir la réponse source » navigue vers l'espace de rendez-vous SANS
      jamais placer d'identifiant dans l'URL (état de navigation React
      Router uniquement) ; la question ciblée est défilée à l'écran, reçoit
      le focus clavier, et un surlignage temporaire qui s'efface après
      quelques secondes.
- [ ] Référence vers une question actuellement MASQUÉE (condition
      d'affichage non remplie) : bannière explicite dans le workspace,
      jamais un défilement silencieux vers rien, jamais un plantage.
- [ ] Référence vers la réponse d'un membre devenu historique (retiré du
      foyer depuis) : bannière dédiée nommant le membre, en plus de la
      bannière déjà existante du Lot 3B pour toute instance de membre
      historique ; champs de saisie en lecture seule.
- [ ] Aucune valeur de réponse brute n'apparaît nulle part dans le DOM de
      l'écran des constats (vérifié programmatiquement, pas seulement
      visuellement).

### Navigation par `answer_id` (GATE LOT 4B §2, ajouté après le premier commit)

- [ ] « Voir la réponse source » transmet désormais `answerId` (en plus de
      `questionId`/`memberId`) via l'état de navigation — jamais dans l'URL,
      vérifié identiquement au point ci-dessus.
- [ ] Le workspace positionne l'historique EXACTEMENT sur la ligne
      `answer_id` annoncée (jamais seulement la réponse active courante) et
      la marque « Réponse utilisée lors de cette analyse », visuellement
      distincte du badge « Active » porté par la ligne réellement active
      aujourd'hui — les deux badges peuvent désigner deux lignes
      DIFFÉRENTES.
- [ ] Réponse depuis remplacée par un amendement : la ligne mise en avant
      porte en plus la mention « remplacée depuis par une correction plus
      récente » ; le lien source, au niveau du constat lui-même, porte déjà
      un repère « réponse modifiée depuis ».
- [ ] Réponse encore active : aucune de ces deux mentions, badges « Réponse
      utilisée… » et « Active » réunis sur la MÊME ligne.
- [ ] `answer_id` invalide pour ce contexte (inexistant, d'une autre
      session, d'un autre foyer, ou incohérent avec la question/le membre
      annoncés) : les quatre cas sont volontairement INDISCERNABLES pour le
      conseiller — aucune valeur affichée, message d'erreur générique,
      aucune navigation effectuée (ni changement de module/section, ni
      ouverture d'historique).
- [ ] La navigation reste possible et ouvre correctement l'historique même
      quand la question source est actuellement masquée ou provient d'un
      membre historique (les deux bannières existantes restent affichées en
      plus).

## Écartement d'un constat (§20)

- [ ] Motif d'écartement obligatoire (soumission refusée sans motif,
      garde anti-double-clic identique aux autres formulaires de ce
      module).
- [ ] Un constat écarté reste visible dans le filtre « Écartés »/« Tous »
      avec auteur, date et motif — jamais supprimé.
- [ ] Un constat déjà écarté ne propose plus l'action « Écarter ».
- [ ] Action indisponible sur un foyer archivé.

## Historique des analyses (§21)

- [ ] Modale accessible depuis n'importe quel état du domaine dès qu'au
      moins une exécution existe (pas seulement l'état « à jour »).
- [ ] Liste chronologique des exécutions du domaine, avec statut, date,
      nombre de constats/règles évaluées ; une exécution remplacée porte la
      mention « remplacée depuis ».
- [ ] Le détail d'une exécution passée s'ouvre en LECTURE SEULE stricte :
      aucune action d'écartement proposée, même pour l'exécution la plus
      récente affichée depuis l'historique.
- [ ] Une relance de l'analyse crée une nouvelle exécution tracée sans
      jamais écraser l'historique existant.

## Stockage et confidentialité (§24)

- [ ] Aucune clé `localStorage`/`sessionStorage` utilisée par l'écran des
      constats ni par l'extension de navigation du workspace.
- [ ] `Cache-Control: no-store, private` confirmé en conditions réelles de
      navigateur sur `GET .../findings-workspace`.

## Accessibilité (§26)

- [ ] Onglets de domaine en `role="tab"`/`aria-selected`, cohérent avec
      `role="tablist"` sur le conteneur (même convention que les onglets de
      modules du workspace, Lot 3B).
- [ ] Puces de filtre en `aria-pressed`, état bascule correctement reflété.
- [ ] Question ciblée depuis une navigation entrante reçoit un focus
      clavier programmatique (`tabIndex=-1` + `.focus()`), sans jamais
      l'ajouter à l'ordre de tabulation naturel.

## Responsive (§27)

- [ ] 375px (mobile) : aucun débordement horizontal, ni sur l'écran des
      constats ni sur le workspace après navigation entrante — deux
      régressions de mise en page pré-existantes découvertes et corrigées
      pendant cette QA (voir Historique d'exécution).
- [ ] Tablette portrait (820×1180) et paysage (1180×820) : aucun
      débordement, seuil desktop partagé (`.sidebar`, 900px) cohérent en
      paysage.

## Historique d'exécution

**Exécution unique (GATE de validation, avant premier commit du Lot 4B)** :
bases de démonstration temporaires dédiées (`CRM_DATA_DIR` isolé, données
entièrement fictives, jamais committées) — un foyer avec une session mixte
(Commun rattaché sans exécution/Assurance Maladie analysée/Vie et
Prévoyance sans ensemble de règles publié), deux findings volontairement en
conflit, un constat à portée membre fanned-out sur deux membres (dont un
retiré du foyer après la première exécution), une question conditionnelle
démasquée puis re-masquée via un amendement réel, une information
manquante ; un second foyer archivé avec une session déjà analysée ; un
troisième foyer avec une session non finalisée (pour vérifier l'absence du
point d'entrée). Plusieurs contextes de navigateur et interceptions réseau
délibérées (409, 500, latence artificielle) pour les scénarios de
concurrence et de résilience.

Deux défauts réels ont été détectés et corrigés pendant cette exécution
(jamais seulement documentés comme limitation connue) :

1. **Détection de conflit trop large** (`server/advisoryRuleExecutions.js`)
   — des constats produits par LA MÊME règle à portée membre (un par membre
   correspondant, comportement normal du Lot 4A §3) partageaient
   nécessairement le même `category_hint` et se signalaient à tort comme
   en conflit ENTRE EUX. Corrigé en excluant explicitement les paires
   issues de la même règle (`rule.id` identique) du regroupement par
   catégorie ; deux nouveaux tests unitaires verrouillent ce comportement
   (findings d'une même règle jamais en conflit entre eux, même
   `category_hint` partagée ; deux règles DIFFÉRENTES partageant une
   catégorie restent bien détectées).
2. **Débordement horizontal à 375px** — deux causes distinctes, toutes
   deux des motifs CSS classiques de « conteneur flex/grille refusant de
   rétrécir sous la largeur intrinsèque d'un descendant » (`min-width:
   auto` par défaut) :
   - `.main` (mise en page globale de l'application, partagée par TOUTES
     les pages) ne définissait pas `min-width: 0` en tant qu'élément flex
     de `.app` — un descendant profond avec une pression de largeur
     intrinsèque (ici, le contenu d'un panneau de traçabilité replié)
     poussait toute la page plus large que le viewport, décalant
     horizontalement des éléments sans rapport (boutons d'en-tête, tuiles,
     puces de filtre). Vérifié comme un débordement RÉEL (pas seulement une
     mesure DOM) via un défilement horizontal effectif à la molette avant
     correctif, disparu après ;
   - `.wksp-rail` (rail de sections du workspace, Lot 3B, sous 900px) ne
     définissait pas non plus `min-width: 0`, empêchant son
     `overflow-x: auto` propre de contenir réellement son contenu.
   Les deux correctifs sont des ajouts `min-width: 0` strictement
   non-régressifs (assouplissent une contrainte, n'en imposent aucune) ;
   `.wksp-rail` est un composant du Lot 3B jamais modifié par ce lot avant
   cette découverte — corrigé ici car directement exposé par la nouvelle
   navigation entrante du Lot 4B.

Un troisième point a été amélioré sans être un défaut à proprement parler :
le lien « Voir l'historique des analyses » n'était initialement rendu que
dans la bannière d'état « à jour », disparaissant dès qu'un domaine passait
à « modifications depuis la dernière analyse » — corrigé en le rendant
persistant dès qu'une exécution existe, indépendamment de l'état courant.

Aucune erreur console/page non attendue observée à travers l'ensemble des
scénarios (hormis les échecs réseau 409/500 délibérément simulés par les
scénarios 31/32, correctement filtrés du décompte). Matrice exacte des 38
scénarios exécutés, tous réussis après application des trois correctifs
ci-dessus :

| # | Scénario | Résultat |
|---|---|---|
| 1 | Bouton absent (session non finalisée) | Réussi |
| 2 | Bouton présent (session finalisée) | Réussi |
| 3 | Session mixte : 3 onglets distincts | Réussi — jamais « mixed » |
| 4 | Domaine sans ensemble publié | Réussi — bannière explicite |
| 5 | Domaine déjà analysé au chargement | Réussi — état « à jour » direct |
| 6 | Bascule d'onglet | Réussi — bon sous-ensemble affiché |
| 7 | Badges de conflit actif | Réussi — exactement les 2 findings concernés |
| 8 | Information manquante | Réussi — lien « Répondre → » |
| 9 | Fan-out portée membre | Réussi — un finding par membre correspondant |
| 10 | Membre retiré marqué | Réussi — « retiré du foyer » |
| 11 | `client_explanation` étiquetée | Réussi — label obligatoire présent |
| 12 | Filtre Priorité | Réussi |
| 13 | Filtre Type | Réussi |
| 14 | Partition stable (Statut) | Réussi — ordre identique Actifs/Tous |
| 15 | Filtre Membre | Réussi — membres distincts listés |
| 16 | Ordre par défaut (conflits en tête) | Réussi |
| 17 | Traçabilité : source/référence/date | Réussi |
| 18 | Traçabilité : texte de question, jamais une valeur | Réussi |
| 19 | Navigation source (question visible) | Réussi — surlignage, aucune bannière parasite |
| 20 | Navigation source (membre historique) | Réussi — bannière dédiée, lecture seule |
| 21 | Navigation source (question masquée) | Réussi — bannière explicite, jamais un plantage |
| 22 | Écartement refusé sans motif | Réussi |
| 23 | Écartement visible dans l'historique | Réussi — auteur/motif/date |
| 24 | Recalcul de conflit après écartement | Réussi |
| 25 | Ré-écartement impossible | Réussi |
| 26 | Historique des analyses (liste) | Réussi |
| 27 | Historique : détail en lecture seule | Réussi |
| 28 | Relance : nouvelle exécution tracée | Réussi — ancienne marquée remplacée |
| 29 | Anti-double-clic (lancement) | Réussi — une seule requête |
| 30 | Foyer archivé | Réussi — lecture seule totale |
| 31 | Révision obsolète (409) | Réussi — message clair |
| 32 | Erreur serveur (500) | Réussi — message affiché, aucune exception JS |
| 33 | Aucun stockage navigateur | Réussi |
| 34 | Accessibilité (ARIA) | Réussi |
| 35 | Responsive 375px | Réussi — après correctifs `.main`/`.wksp-rail` |
| 36 | Responsive tablette | Réussi |
| 37 | Cache-Control no-store | Réussi — conditions réelles navigateur |
| 38 | Aucune valeur brute dans le DOM | Réussi |

`npm run lint`, `npm test` (812/812) et `npm run build` exécutés avec
succès après l'ensemble des correctifs de cette QA. Bases de démonstration,
scripts de seed et de vérification, et tous les fichiers temporaires
supprimés après exécution ; aucune de ces données n'a été committée.

**Vérification ciblée (après les 4 revues finales post-implémentation)** :
les 4 revues (`advisory-architect`, `compliance-privacy-reviewer`,
`rules-engine-auditor`, `client-meeting-ux`) ont porté sur le CODE réel
(pas une proposition) et relevé deux régressions fonctionnelles réelles non
couvertes par les 38 scénarios ci-dessus (aucun n'exerçait une donnée
manquante à portée MEMBRE, ni la modale d'historique avec un finding
écarté par un utilisateur nommé) :
- navigation « Répondre → » toujours cassée pour une information manquante
  de portée membre (aucune instance foyer n'existe pour une telle
  question) ;
- historique des analyses non hydraté (auteur d'écartement/texte de
  question en repli générique).

Les deux ont été corrigés, ainsi que trois points d'ergonomie (message
dupliqué pour un domaine sans exécution, badge de conflit sans référence
au constat concerné, deux lacunes de test signalées par
`rules-engine-auditor`). Nouvelle base de démonstration temporaire dédiée
(foyer à deux membres, un membre ne répondant jamais à une question de
portée membre, deux findings en conflit), 4 vérifications ciblées en
navigateur réel : lien cassé absent (0 lien trouvé, message explicite
affiché à la place), référence croisée « En conflit avec : … » affichée
correctement sur les deux cartes concernées, message unique (plus de
doublon) pour le domaine sans exécution — aucune erreur console/page.
`npm run lint`, `npm test` (813/813) et `npm run build` exécutés avec
succès après ces correctifs. Base de démonstration, scripts et captures
supprimés après vérification.

**GATE ciblé LOT 4B (avant tout commit, §2/§3/§4/§7 de ce GATE)** : base de
démonstration temporaire dédiée (`CRM_DATA_DIR` isolé, données 100%
fictives) — foyer à deux membres (principal + enfant), session mixte
santé/vie-prévoyance avec quatre constats santé (une réponse jamais
amendée, une réponse dont la question sera masquée après coup via un
amendement d'un autre toggle, une réponse amendée après l'exécution, un
constat à portée membre sur l'enfant retiré du foyer après l'exécution) et
un constat vie/prévoyance ; relance ciblée du domaine santé pour obtenir un
état mixte à jour/obsolète représentatif. Deux navigateurs Chromium
(contextes distincts, même session authentifiée) pour les scénarios de
concurrence multi-onglets ; interceptions réseau (latence artificielle,
`route.abort`, réponse HTTP réécrite) pour les doubles-clics, l'erreur
réseau et le cas `answer_id` invalide.

Un défaut réel a été détecté et corrigé pendant cette exécution :

3. **Fenêtre de course dans la garde anti-double-clic** (`client/src/pages/SessionFindings.jsx`,
   `launchAnalysis` et `DismissModal.submit`) — la garde reposait
   uniquement sur un état React (`if (analyzing) return` / `if (submitting)
   return`) : deux clics quasi simultanés pouvaient tous deux lire la même
   fermeture obsolète AVANT que React n'ait eu l'occasion de re-rendre le
   bouton désactivé entre les deux, laissant passer deux requêtes réseau au
   lieu d'une. Détecté par un test Playwright de double-clic réel (deux
   clics quasi simultanés sur le bouton « Lancer l'analyse », latence
   artificielle de 400ms sur la requête pour élargir la fenêtre). Corrigé en
   ajoutant une garde SYNCHRONE (`useRef`, lue/écrite avant tout `await`,
   immunisée contre le calendrier de rendu) en complément de l'état React
   existant (qui reste la source de vérité pour l'affichage) — appliqué aux
   deux formulaires du Lot 4B concernés (lancement d'analyse, écartement).
   Vérifié après correctif : une seule requête réseau sur les deux
   scénarios, à chaque exécution. Le même motif (état React seul comme
   garde anti-double-clic) existe encore, inchangé, à trois autres endroits
   du Lot 3B (`SessionWorkspace.jsx` — transition de session, finalisation,
   amendement) : hors périmètre de ce GATE (aucun de ces trois formulaires
   n'appartient au Lot 4B), signalé ici pour une correction ciblée future
   si jugée utile, jamais corrigé silencieusement en dehors du périmètre
   demandé.

13 scénarios supplémentaires exécutés en navigateur réel, tous réussis
après le correctif ci-dessus (aucun autre défaut détecté) :

| # | Scénario | Résultat |
|---|---|---|
| 39 | Navigation par `answer_id` — réponse encore active | Réussi — badges « Réponse utilisée… » + « Active » sur la même ligne, URL sans identifiant |
| 40 | Navigation par `answer_id` — membre historique | Réussi — bannière dédiée + historique tout de même ouvert |
| 41 | Navigation par `answer_id` — question désormais masquée | Réussi — bannière explicite + historique tout de même ouvert |
| 42 | Navigation par `answer_id` — réponse remplacée depuis un amendement | Réussi — repère au niveau du constat, badge « Réponse utilisée… » + mention « remplacée depuis » sur la ligne surlignée, ligne « Active » distincte |
| 43 | Navigation par `answer_id` — session finalisée | Réussi — historique consultable en lecture seule |
| 44 | Navigation par `answer_id` — identifiant invalide (inexistant / autre session / autre foyer / question incohérente, indiscernables) | Réussi — erreur générique, aucune valeur, aucune navigation |
| 45 | Anti-double-clic « Lancer l'analyse » (clics réels quasi simultanés) | Réussi après correctif — une seule requête |
| 46 | Aucun message de succès avant confirmation serveur | Réussi |
| 47 | Erreur réseau pendant le lancement de l'analyse | Réussi — message affiché, bouton réactivé |
| 48 | Amendement dans un autre onglet pendant une révision périmée (409) | Réussi — bannière de conflit, projection rechargée |
| 49 | Constat écarté dans un autre onglet | Réussi — reflété après rechargement |
| 50 | Analyse relancée dans un autre onglet | Réussi — nouvelle exécution reflétée après rechargement, jamais fusionnée |
| 51 | Anti-double-clic « Écarter » (clics réels quasi simultanés) | Réussi après correctif — une seule requête |

Les scénarios 19, 20 et 21 (navigation source visible / membre historique /
question masquée, table originale ci-dessus) ont été REJOUÉS sous le
nouveau mécanisme par `answer_id` (le code de navigation a substantiellement
changé, §2 de ce GATE) — toujours réussis, absorbés dans les scénarios 39,
40 et 41 ci-dessus qui les remplacent désormais. Le scénario 29
(anti-double-clic lancement, table originale) est de même absorbé et
remplacé par le scénario 45 (le comportement a changé : garde renforcée).
Les 35 autres scénarios originaux (1-18, 22-28, 30-38) portent sur des
parties du code NON touchées par ce GATE ciblé (filtres, conflits,
écartement lui-même, accessibilité, responsive, stockage) — non rejoués en
navigateur réel cette fois-ci, mais couverts par la suite de tests
automatisés complète (§9 de ce GATE) qui n'a révélé aucune régression sur
ces zones.

`npm run lint`, `npm test` (833/833) et `npm run build` exécutés avec
succès après le correctif ci-dessus. Base de démonstration, scripts de
seed/QA et captures temporaires supprimés après exécution ; aucune de ces
données n'a été committée.

**MICRO-GATE final LOT 4B (avant tout commit)** : le rapport du GATE
précédent notait qu'un seul scénario représentatif avait vérifié les cas
`answer_id` invalides (les quatre/cinq cas y étaient affirmés indiscernables
« par construction », sans preuve séparée par cas) — corrigé par cinq tests
backend/API DISTINCTS, chacun documenté séparément ci-dessous
(`test/advisory-rule-executions.test.js`, `test/advisory-sessions-api.test.js`).
Sémantique du domaine `common` dans l'état global également corrigée : sa
facultativité ne couvrait jusqu'ici que le cas de son ABSENCE — un
`common` publié mais en échec/obsolète/jamais exécuté pouvait passer
inaperçu de l'état global, contrairement à un domaine spécialisé dans le
même état. Neuf tests dédiés ajoutés (`resolveGlobalAnalysisState`), voir
`RULES_ENGINE.md` §3quater.

### Cas `answer_id` invalides — résultats détaillés (§2 du micro-GATE)

| # | Cas | Vérifications | Résultat |
|---|---|---|---|
| 1/5 | Inexistant (identifiant ne correspondant à AUCUNE ligne en base) | Absent de l'historique retourné ; aucune fuite dans `audit_log.details` (aucune mention de l'identifiant demandé) | Réussi |
| 2/5 | Appartient à une AUTRE session du MÊME foyer | Absent de l'historique de la session consultée ; aucune valeur de l'autre session ne fuite | Réussi |
| 3/5 | Appartient à une session d'un AUTRE foyer | Absent de l'historique, même question technique réutilisée entre foyers | Réussi |
| 4/5 | Valide, mais rattaché à une AUTRE question que celle annoncée | Absent quand on interroge la question réellement annoncée (une session avec `common` rattaché fournit deux questions foyer légitimes) | Réussi |
| 5/5 | Valide, bonne question, mais MEMBRE incohérent | Absent quand on interroge un membre différent de celui réellement associé à la ligne | Réussi |
| — | Contrat HTTP | `GET .../answers/history` : statut 200 et forme `{ answers: [] }` IDENTIQUES pour une session sans réponse propre que pour n'importe quelle autre — jamais un statut distinct révélant qu'une réponse existe ailleurs | Réussi |

Dans les cinq cas, le frontend (`SessionWorkspace.jsx`) affiche désormais le
message neutre exact demandé : *« La réponse historique demandée n'est pas
disponible pour cette session. »* — aucune navigation n'est effectuée
(ni changement de module/section, ni ouverture d'historique), aucune valeur
n'est jamais affichée, et la réponse active courante n'est jamais substituée
silencieusement à la référence demandée (comportement déjà vérifié en
navigateur réel, scénario 44 du GATE précédent — code de vérification
inchangé par ce micro-GATE, seul le texte du message a été aligné).

### Sémantique du domaine `common` — résultats détaillés (§3 du micro-GATE)

| Situation | État global attendu | Résultat |
|---|---|---|
| `common` absent (aucun rule_set jamais publié), domaine(s) spécialisé(s) à jour | `up_to_date` (absence toujours acceptable) | Réussi (health seul, life_pension seul, mixed — 3 tests) |
| `common` publié ET à jour (révision courante), domaine spécialisé à jour | `up_to_date` | Réussi |
| `common` publié en ÉCHEC (dernière tentative), domaine spécialisé à jour | `partial` | Réussi |
| `common` publié et OBSOLÈTE (mélange avec un domaine spécialisé à jour) | `partial` (jamais `stale` quand une partie reste à jour) | Réussi |
| `common` publié mais JAMAIS EXÉCUTÉ sur cette session, domaine spécialisé à jour | jamais `up_to_date` (`partial`) | Réussi |
| `common` en échec pur ET le seul domaine spécialisé également en échec pur | `error` | Réussi |
| Synthèse active | `common` obsolète/en échec reste consultable dans son onglet, jamais additionné au total actif | Réussi |
| Historique | les anciennes exécutions de `common` restent toutes consultables après plusieurs bascules d'état | Réussi |

`npm run lint`, `npm test` et `npm run build` exécutés avec succès après ces
corrections. Aucune base de démonstration temporaire créée pour ce
micro-GATE (corrections entièrement couvertes par les tests automatisés
backend/API ci-dessus, aucun scénario ne nécessitait une vérification
visuelle en navigateur réel).

**Revues ciblées finales** (`advisory-architect`, `compliance-privacy-reviewer`,
lecture seule, aucune édition par les agents eux-mêmes) : verdicts « prêt
pour commit » et « prêt avec réserves mineures ». Aucun défaut de
sécurité/confidentialité confirmé. Un défaut de QUALITÉ DE TEST confirmé par
`compliance-privacy-reviewer` : le test annonçant une « réponse
structurellement identique » pour les cinq cas `answer_id` invalides
n'exerçait en réalité qu'un seul appel légitime, avec une assertion
(`Array.isArray`) trivialement vraie par construction — il ne comparait
RIEN entre les cinq scénarios malgré son nom. Corrigé :
- remplacé par un test comparant réellement la FORME des lignes retournées
  (mêmes clés) entre un appel légitime et chacun des cinq scénarios ;
- la preuve de neutralité HTTP (statut 200, forme identique), jusque-là
  vérifiée pour un seul des cinq cas, étendue aux trois autres cas
  vérifiables au niveau HTTP (autre foyer, question incohérente, membre
  incohérent — le cas « inexistant » n'a pas de variante HTTP distincte,
  la route n'acceptant jamais d'`answer_id` en paramètre) ;
- comparaison par sous-chaîne sur du JSON sérialisé (fragile : un petit
  identifiant numérique peut apparaître par coïncidence dans un autre champ
  d'une base de test aux identifiants séquentiels) remplacée partout par une
  comparaison précise ligne par ligne (`.some((a) => a.id === ...)`) ;
- imprécision mineure corrigée dans la fenêtre de lecture d'audit d'un test
  (aucune conséquence sur le résultat, clarification de nommage).

`npm run lint`, `npm test` (852/852) et `npm run build` exécutés avec succès
après ce dernier correctif. Aucune base de démonstration supplémentaire
créée ; aucune donnée n'a été committée.

**Correctif final (avant tout commit)** : la condition d'applicabilité de
`common` utilisée jusqu'ici (`state !== 'no_rule_set_available'`) reflétait
en réalité l'ÉTAT D'EXÉCUTION passé, pas le statut de publication ACTUEL —
un `common` publié puis exécuté puis ARCHIVÉ conservait `state =
'up_to_date'`/`'stale'` (reproductibilité : une exécution déjà pinnée reste
valide après archivage de son rule_set) et restait donc, à tort,
« applicable » à l'analyse courante. Corrigé en introduisant un champ dédié
`has_published_rule_set` (`resolveDomainAnalysisState`), qui ne reflète QUE
`status = 'published'`, évalué à la lecture — jamais l'historique.

| Situation | État global attendu | Résultat |
|---|---|---|
| Health seul, common publié PUIS ARCHIVÉ (aucun actuellement publié) | `up_to_date` (l'historique de common ne le rend jamais applicable) | Réussi |
| Ancienne exécution common (rule_set désormais archivé) | reste consultable dans l'historique des exécutions | Réussi |
| Ses findings, alors que `state` affiche encore `up_to_date` | exclus de la synthèse active (`has_published_rule_set = false`) | Réussi |
| Ancien common archivé PUIS nouvelle version common publiée | seule la version ACTUELLEMENT publiée détermine l'applicabilité et le pin | Réussi |
| Session mixte, common publié PUIS ARCHIVÉ, health et life_pension actuels | `up_to_date` | Réussi |

Les scénarios déjà couverts par le tableau « Sémantique du domaine `common` »
ci-dessus (absent, publié+actuel, échoué, obsolète, jamais exécuté, échec
pur, synthèse, historique) restent valides sans modification — aucun ne
distinguait « jamais publié » de « publié puis archivé », donc aucun n'était
affecté par ce correctif ciblé.

`npm run lint`, `npm test` (855/855) et `npm run build` exécutés avec succès
après ce correctif. Aucune base de démonstration créée (corrections
entièrement couvertes par les tests automatisés backend). Aucune donnée n'a
été committée.
