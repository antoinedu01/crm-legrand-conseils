# Checklist manuelle — interface conseiller des recommandations (Lot 7B)

> Aucun framework de test frontend n'existe dans ce dépôt (confirmé aux
> Lots 0/2/3A/3B/4B). Conformément à cette même convention déjà établie
> (`LOT4B_MANUAL_UI_CHECKLIST.md`), aucune dépendance de test frontend n'a
> été ajoutée pour ce lot. Cette checklist remplace des tests automatisés
> frontend absents — elle a été **exécutée réellement** via un navigateur
> Chromium piloté par Playwright (déjà installé dans cet environnement, non
> ajouté au projet), pas seulement rédigée sur la base du code. Bases de
> démonstration temporaires (`CRM_DATA_DIR` isolé, données 100% fictives),
> scripts de fixture/QA et captures ont été supprimés après exécution ;
> seul ce document en garde la trace.

## Périmètre exécuté en direct (navigateur réel, assertions programmatiques)

26 scénarios sur les 42 du brief ont été exécutés intégralement en direct
avec des assertions vérifiées (pas seulement une capture visuelle) : liste
vide, création contextualisée depuis un constat, blocage du changement de
domaine pendant une sélection multiple, les trois portées (session/foyer/
membre), plusieurs membres ciblés simultanément, un ancien membre du
périmètre figé (sélectionnable, jamais bloqué côté client), les trois états
de la déclaration à trois choix (non renseigné/rien identifié/décrit),
création de brouillon avec garde anti-double-clic, conflit de révision de
recommandation (409, deux onglets réels), validation normale, contenu
immuable après validation, écartement (refus sans motif puis succès),
retrait, création d'un remplacement, non-bascule prématurée de la source
avant validation du remplacement, historique complet avec tous les filtres,
foyer archivé (lecture seule, bouton de création masqué), tablette portrait
et paysage (absence de débordement horizontal vérifiée programmatiquement),
absence de `localStorage`/`sessionStorage`, absence de texte sensible dans
l'URL et absence d'erreur console.

## Scénarios NON rejoués en direct dans cette QA (transparence, aucun
## camouflage) — avec la justification exacte de chacun

| # | Scénario | Pourquoi non rejoué en direct | Garantie de remplacement |
|---|---|---|---|
| 3 | Création depuis plusieurs findings du même domaine | Même chemin de code que la création simple (`finding_ids` tableau), déjà exercé côté mécanisme de sélection (voir scénario 4) | Chemin de code identique, revu |
| 10 | Membre hors snapshot refusé | Structurellement impossible dans l'interface : le sélecteur ne liste jamais que `session.members` (périmètre figé renvoyé par le serveur), aucun champ libre pour saisir un id arbitraire | Impossible par construction + refus serveur testé (`assertMembersInSnapshot`, LOT 7A) |
| 11 | Finding member correspondant | Chemin de code identique à la création contextualisée déjà testée | Cohérence finding/membre testée exhaustivement côté serveur (78 tests) |
| 12 | Finding member incohérent refusé | L'interface ne permet de choisir un finding QUE parmi ceux déjà sélectionnés sur l'écran des constats (jamais un formulaire libre d'id) | Refus serveur (`assertFindingMemberCoherence`) déjà testé LOT 7A |
| 13 | Finding household pour recommandation member | Autorisé par construction (jamais bloqué par l'interface, qui ne filtre rien côté client) | Testé côté serveur LOT 7A |
| 17-20 | Risques / informations manquantes (3 états) | `DeclarationField` est un composant unique strictement réutilisé pour les trois rubriques (alternatives/risques/informations manquantes) — le défaut détecté et corrigé sur « alternatives » (voir plus bas) s'appliquait identiquement aux trois avant correctif, et le correctif s'applique identiquement aux trois après | Composant unique, même code, même correctif |
| 25 | Révision de session 409 (distincte de la révision de recommandation) | Mécanisme analogue au scénario 23 (rejoué en direct), mais avec un texte de message différent (`CONFLICT_MESSAGE_SESSION`) — non déclenché par un scénario réel dans cette QA | Code revu (distinction par correspondance du texte serveur) ; `assertExpectedSessionRevision` exhaustivement testé côté serveur LOT 7A |
| 31-32 | Validation du remplacement / ancienne recommandation « Remplacée » | Script Playwright réutilisé sur une session de fixture accumulant de nombreuses recommandations entre plusieurs exécutions successives, provoquant une instabilité de sélecteur (délai de rendu de liste) sans rapport avec le code produit | Vérifié autrement : (a) inspection directe du texte exact de la bannière de remplacement (« Remplace la recommandation #15, actuellement validée… ») ; (b) la transaction atomique de supersession (`validateRecommendation`) est déjà testée exhaustivement côté serveur, y compris un test de **rollback forcé en cours de transaction** (LOT 7A) ; (c) revue de code du rendu frontend (`successorOf`, bannières conditionnelles) |
| 33 | Remplacement écarté puis nouvel essai | Dépend du même mécanisme que 31-32 | Index unique partiel ignorant les remplacements écartés déjà testé exhaustivement côté serveur (LOT 7A, y compris 2 connexions SQLite concurrentes réelles) |
| 34 | Potentiellement obsolète | Nécessiterait d'amender la session après validation, scénario long à construire | `potentially_stale` est un booléen **dérivé côté serveur uniquement**, le frontend l'affiche tel quel sans jamais le recalculer (revue de code) ; le calcul lui-même (`computeStaleness`) est exhaustivement testé côté serveur (LOT 7A) |
| 37 | Erreur réseau | Pattern générique déjà identique à `SessionFindings.jsx`/`SessionWorkspace.jsx` | `catch (err) { setError(err.message) }` sans optimisme, comportement déjà vérifié pour ces pages au Lot 4B, jamais modifié ici |
| 40 | Clavier et focus (parcours complet) | `Modal` (gestion Escape) hérité tel quel du Lot 3B/4B, jamais modifié par ce lot | Comportement déjà vérifié au Lot 3B/4B pour le composant partagé |

**Aucun scénario n'a été purement supposé sans base** : chaque ligne
ci-dessus s'appuie soit sur une impossibilité structurelle de l'interface,
soit sur une couverture de test serveur déjà exhaustive et récemment
vérifiée (GATE LOT 7A), soit sur une revue de code explicite du chemin
concerné.

## Défaut réel détecté et corrigé pendant les revues finales post-implémentation

**Masquage incomplet des actions d'écriture pour un foyer archivé, sur les
points d'entrée depuis `SessionFindings.jsx`** — détecté indépendamment par
`advisory-architect` et `compliance-privacy-reviewer` lors des revues
finales (§32), convergentes sur le même défaut et le même correctif. Le
scénario 36 ci-dessous (« Foyer archivé ») n'avait vérifié en direct que le
bouton principal de `SessionRecommendations.jsx` (bien gardé dès
l'implémentation) — il ne couvrait pas les deux points d'entrée ajoutés côté
`SessionFindings.jsx` (bouton par constat « Créer une recommandation à
partir de ce constat », bouton groupé du bandeau de sélection multiple),
qui n'étaient initialement pas gardés par `household.status === 'archive'`,
contrairement au bouton voisin « Écarter ce constat » (`canDismiss`).
Conséquence concrète : un conseiller pouvait ouvrir et remplir intégralement
le formulaire de création sur un foyer archivé, refusé seulement à la
soumission par le serveur (409, `assertSessionWritable` déjà exhaustivement
testé côté serveur — aucune écriture n'aboutissait jamais, aucune fuite de
donnée). Corrigé par un double garde : défense principale dans
`SessionRecommendations.jsx` (l'écran de création n'est plus atteignable via
la navigation entrante `location.state.findingIds` lorsque la page est en
lecture seule — foyer archivé ou session non finalisée) ; défense
complémentaire dans `SessionFindings.jsx` (les deux points d'entrée, ainsi
que le bouton « Sélection multiple » lui-même, masqués dès que le foyer est
archivé). Revérifié après correctif : `npm run lint` et `npm run build`
toujours propres, `npm test` toujours vert (aucun de ces deux fichiers
n'étant couvert par des tests automatisés, cf. absence de framework
frontend).

## Défauts certains détectés et corrigés — revue finale `client-meeting-ux`

Revue de code (pas un rejeu manuel scénario par scénario, la QA en direct
ayant déjà eu lieu séparément — voir plus bas la vérification ciblée
effectuée après correctifs) ayant identifié 10 défauts par ordre de
sévérité, dont 2 « élevée ». Tous les défauts en jeu de code frontend ont
été corrigés (aucun n'impliquait de migration, de règle métier ou de
contrat serveur — hormis un point signalé mais non traité, voir la fin de
cette section) :

1. **Perte de texte silencieuse dans `DeclarationField`** (sévérité
   élevée) : changer d'état radio depuis « Décrit ci-dessous » alors qu'un
   texte était déjà tapé effaçait ce texte sans confirmation. Corrigé :
   confirmation (`window.confirm`) demandée avant tout effacement d'un
   texte non vide ; aucune confirmation si le texte est déjà vide.
2. **Navigation sans avertissement malgré une saisie non enregistrée**
   (sévérité élevée) : les boutons « ← Fiche session », « Ouvrir les
   constats », « Annuler » et « ← Recommandations » démontaient le
   formulaire actif sans avertir d'une perte de saisie. Corrigé : suivi de
   l'état « non enregistré » (comparaison aux valeurs de référence, jamais
   un drapeau approximatif) et confirmation avant de quitter, sur le même
   principe que `SessionWorkspace.jsx`.
3. **`.rec-sources` restait `position: sticky` en layout empilé
   (<900px)**, risque de recouvrement du formulaire — corrigé
   (`position: static` dans la media query, même précédent que
   `.wksp-rail`).
4. **Groupe de radios sans association programmatique à son libellé** —
   corrigé (`<div>/<span>` remplacé par `<fieldset>/<legend>`).
5. **Absence de `role="alert"`/`aria-live` sur les bandeaux d'erreur** —
   corrigé sur l'ensemble des messages d'erreur dynamiques de
   `SessionRecommendations.jsx` et sur les deux bandeaux d'erreur
   principaux de `SessionFindings.jsx`, alignés sur le précédent déjà en
   place dans `SessionWorkspace.jsx`.
6. **Erreurs affichées loin du point d'action, sans défilement
   automatique** — corrigé (`scrollIntoView` sur l'erreur de sauvegarde et
   sur l'erreur globale, même mécanisme que le lien « Voir les constats
   sources » déjà présent).
7. **Cibles tactiles incohérentes (~34px au lieu de ~44px)** sur
   `.declaration-group label.check` et sur la case de sélection multiple
   des constats — corrigé (alignées sur `.radiogroup label.check`, GATE LOT
   3B §12) ; les boutons `#id` des bannières de remplacement avaient un
   `padding: 0` explicite réduisant leur cible sous le minimum déjà faible
   de `button.small` — retiré.
8. **`.recommendation-card.superseded` sans l'opacité atténuée déjà
   appliquée à `dismissed`/`withdrawn`** — corrigé (défaut de sélecteur CSS
   isolé, la logique JS avait déjà l'intention correcte).
9. Dispatch des deux messages de conflit 409 fragile (couplé à un texte
   serveur non contractualisé, pas de champ structuré) — **signalé, non
   corrigé** : le mécanisme fonctionne correctement aujourd'hui pour les
   deux formulations existantes (revérifié), et introduire un discriminant
   structuré toucherait le contrat d'API serveur — hors périmètre d'un
   correctif frontend sans nouvelle validation humaine explicite du contrat
   (§28 du brief : pas de changement métier/serveur sans blocage certain de
   l'interface). Documenté ici comme limite connue pour un lot ultérieur.
10. **Champ « Domaine » désactivé sans explication visible** — corrigé
    (texte muted expliquant pourquoi selon le contexte : constat source,
    remplacement, ou statut non-brouillon).

Deux défauts d'accessibilité relevés par la même revue n'ont **pas** été
traités dans ce lot, sur la propre recommandation du relecteur : l'absence
de piège de focus/restitution de focus dans `Modal` (`ui.jsx`, composant
partagé non modifié par ce lot, hérité tel quel du Lot 3B/4B) et l'absence
d'`aria-describedby` liant les erreurs de validation à leur champ (pattern
déjà présent ailleurs dans l'application, notamment `SessionFindings.jsx`
`DismissModal` — pas une régression propre à ce lot). Les deux relèvent
d'un chantier d'accessibilité transverse, pas d'un correctif localisé au
Lot 7B.

### Vérification ciblée en direct après correctifs

Les deux défauts de sévérité « élevée » (perte de texte silencieuse,
navigation sans avertissement) impliquant un comportement d'interaction
état/dialogue, une vérification en direct (navigateur Chromium piloté par
Playwright, base de démonstration temporaire isolée, données 100%
fictives, tout supprimé après exécution) a été refaite ciblée sur les
correctifs de cette section plutôt qu'un rejeu complet des 42 scénarios
déjà couverts précédemment :

| Vérification | Résultat |
|---|---|
| `DeclarationField` rendu en `<fieldset>/<legend>` (3 occurrences) | Réussi |
| Texte saisi visible après passage en « décrit » | Réussi |
| `window.confirm` déclenché avant tout effacement d'un texte non vide | Réussi |
| Confirmation acceptée → bascule effective vers le nouvel état | Réussi |
| Confirmation refusée → état ET texte conservés (aucune perte silencieuse) | Réussi |
| Bouton « Annuler » avec saisie non enregistrée → confirmation demandée | Réussi |
| Confirmation refusée → formulaire conservé, rien perdu | Réussi |
| Foyer archivé : bandeau explicite visible | Réussi |
| Foyer archivé : bouton « Sélection multiple » masqué (`SessionFindings.jsx`) | Réussi |
| Foyer archivé : bouton « Créer une recommandation à partir de ce constat » masqué | Réussi |
| Foyer archivé : bouton « Nouvelle recommandation » masqué (`SessionRecommendations.jsx`) | Réussi |
| Aucune erreur console sur l'ensemble du parcours | Réussi |
| Parcours complet de création (chemin nominal, non régressé par les correctifs) : brouillon créé avec le bon titre, `no_alternatives_identified` correctement sérialisé | Réussi (vérifié directement en base) |

13/13 vérifications réussies. `npm run lint`, `npm test` (1036/1036) et
`npm run build` exécutés avec succès après l'ensemble de ces correctifs.
Base de démonstration, scripts et captures temporaires supprimés après
exécution.

## Défaut réel détecté et corrigé pendant cette QA

**`DeclarationField` — l'état « Décrit ci-dessous » ne pouvait pas être
sélectionné avant d'avoir tapé du texte** (`client/src/pages/
SessionRecommendations.jsx`) — l'état affiché (non renseigné / rien
identifié / décrit) était initialement **dérivé** de `(flag, text,
extraText)` plutôt qu'un champ explicite : un texte vide combiné à
`flag=false` retombait systématiquement sur « non renseigné », quel que
soit le bouton radio réellement cliqué. Conséquence concrète : cliquer sur
« Décrit ci-dessous » depuis l'état « Aucune alternative identifiée »
faisait « rebondir » silencieusement la sélection sur « Non renseigné »
(aucun texte encore tapé), empêchant tout simplement d'atteindre cet état
tant qu'aucun caractère n'était saisi ailleurs au préalable. Détecté par un
test Playwright réel (clic sur la radio, l'état ne changeait pas). Corrigé
en remplaçant la dérivation par un champ explicite `value.mode` (`'unset'
| 'none_identified' | 'described'`), qui reflète fidèlement le dernier choix
du conseiller indépendamment du contenu du texte — la conversion vers
`no_X_identified`/le texte transmis au serveur ne se fait qu'au moment de
la soumission (`fieldsToBody`). Vérifié après correctif : la radio « Décrit
ci-dessous » reste sélectionnée immédiatement, révèle les deux champs
texte, quel que soit l'état de départ. Le même correctif s'applique
identiquement aux trois rubriques (alternatives, risques, informations
manquantes), qui partagent ce même composant.

## Matrice des scénarios exécutés en direct

| # | Scénario | Résultat |
|---|---|---|
| 1 | Liste vide | Réussi |
| 2 | Création depuis un constat de domaine santé, domaine verrouillé | Réussi — panneau « sources consultables », aucun texte copié |
| 4 | Sélection cross-domaine refusée | Réussi — changement d'onglet bloqué tant qu'une sélection existe, bandeau explicite, « Vider la sélection » débloque |
| 5 | Portée « session » | Réussi — aucun sélecteur de membre |
| 6 | Portée « foyer » | Réussi — retrait implicite des membres au changement de portée (jamais un appel séparé) |
| 7 | Portée « membre » | Réussi — sélecteur de membres affiché |
| 8 | Plusieurs membres ciblés | Réussi — deux cases cochables simultanément |
| 9 | Ancien membre du périmètre figé | Réussi — visible, mention « retiré du foyer », sélectionnable (décision `advisory-architect`, jamais bloqué côté client) |
| 14 | Alternatives — non renseigné | Réussi — état par défaut |
| 15 | Alternatives — aucune identifiée | Réussi — texte libre masqué |
| 16 | Alternatives — décrites | Réussi après correctif — les deux champs (alternatives envisagées + motif de rejet) apparaissent |
| 21 | Sauvegarde de brouillon | Réussi |
| 22 | Garde anti-double-clic (création) | Réussi — un seul brouillon créé, double clic quasi simultané |
| 23 | Conflit de révision de recommandation (409, deux onglets réels) | Réussi — l'onglet B modifie en premier, l'onglet A reçoit le message de conflit et recharge la version serveur (jamais un écrasement silencieux) |
| 24 | Validation normale | Réussi |
| 26 | Contenu immuable après validation | Réussi — tous les champs passent en lecture seule, badge « Validée », date/auteur affichés |
| 27 | Écartement d'un brouillon | Réussi — refusé sans motif, réussi avec motif, statut « Écartée » |
| 28 | Retrait d'une recommandation validée | Réussi — statut « Retirée » |
| 29 | Création d'un remplacement | Réussi — formulaire affiche « Remplace la recommandation #X, actuellement validée » |
| 30 | Remplacement non encore validé | Réussi — la source reste « Validée » (jamais « Remplacée » prématurément) tant que le remplacement n'est pas lui-même validé |
| 35 | Historique complet | Réussi — filtres domaine/statut/portée/membre/obsolescence tous fonctionnels, noms d'auteur résolus |
| 36 | Foyer archivé | Réussi — bandeau explicite, bouton principal de `SessionRecommendations.jsx` masqué, lecture seule. Portée initiale de ce test limitée à ce seul point d'entrée : voir « Défaut réel détecté et corrigé pendant les revues finales » ci-dessus pour les deux points d'entrée `SessionFindings.jsx` non couverts ici et corrigés après coup |
| 38 | Tablette portrait (820×1180) | Réussi — aucun débordement horizontal (`scrollWidth <= clientWidth`, vérifié programmatiquement) |
| 39 | Tablette paysage (1180×820) | Réussi — idem |
| 41 | Absence de `localStorage`/`sessionStorage` | Réussi — 0 clé dans les deux, vérifié programmatiquement après une création avec marqueur distinctif |
| 42 | Absence de texte narratif dans l'URL, absence d'erreur console | Réussi — marqueur absent de l'URL, aucune erreur console sur l'ensemble du parcours |

## Backend

Aucune modification du moteur de règles ni des transitions de statut. Deux
ajouts additifs, en lecture seule, validés au préalable par
`advisory-architect` (voir rapport final) :
- `members` ajouté à `GET /api/advisory/sessions/:id` (`getSessionDetail`,
  `server/advisorySessions.js`) — réutilise `sessionMembersFor` déjà
  existante, surface minimale.
- Résolution du nom d'auteur (`hydrateRecommendationNames`, `server/
  advisoryRecommendations.js`) sur les 13 fonctions de lecture/écriture
  retournant une recommandation — même pattern que `hydrateFindingRows`
  (Lot 4A).

Les deux ajouts sont couverts par des tests dédiés
(`test/advisory-sessions.test.js`, `test/advisory-recommendations.test.js`).

`npm run lint`, `npm test` et `npm run build` exécutés avec succès après
l'ensemble des correctifs de cette QA. Base de démonstration, scripts de
fixture/QA et captures temporaires supprimés après exécution ; aucune de
ces données n'a été committée.

---

## GATE ciblé complémentaire (§4-§9) — QA en direct sur les nouveaux ajouts

Round de QA distinct, exécuté après l'ajout de l'accessibilité des modales
(§4), de la garde de perte de saisie complète (§5), des codes d'erreur
machine (§3, déjà couvert par une QA `curl` séparée — voir rapport final)
et de l'audit de minimisation (§6). Même méthodologie que ci-dessus :
navigateur Chromium réel piloté par Playwright, base de démonstration
isolée (`CRM_DATA_DIR` dédié), serveur unique origine (build de production
servi directement par Express — le proxy Vite en mode développement réécrit
le `Host` vers sa cible, artefact propre à l'outillage de test qui aurait
fait échouer à tort le contrôle anti-CSRF réel du serveur ; sans effet en
usage réel où Express sert toujours le build depuis la même origine).
Données 100% fictives, tout supprimé après exécution.

**34 scénarios exécutés en direct avec assertions programmatiques (jamais
une inspection statique seule)** — reprend une partie des 42 scénarios du
brief (ceux directement concernés par les ajouts §3/§4/§5/§6, plus une
repasse des flux principaux) :

| # | Scénario | Résultat | Preuve |
|---|---|---|---|
| 1 | Liste vide | Réussi | `.empty` affiché, texte exact vérifié |
| 2 | Création contextualisée depuis un constat, domaine verrouillé | Réussi | `select` domaine `disabled`, bandeau « Aucun texte n'est jamais copié » présent |
| 21 | Sauvegarde de brouillon (formulaire contextualisé) | Réussi | Écran détail atteint, `id` résolu via l'API |
| 22 | Garde anti-double-clic (création) | Réussi | Deux `click()` DOM synchrones (même microtâche, contournant l'attente d'« actionability » de Playwright) -> un seul brouillon créé (`submittingRef`, pas seulement l'attribut `disabled`, vérifié ainsi) |
| 5 | Portée « session » | Réussi | Aucun `.radiogroup` affiché |
| 6 | Portée « foyer » | Réussi | Retrait implicite des membres au changement de portée |
| 7 | Portée « membre » | Réussi | `.radiogroup` affiché |
| 8 | Plusieurs membres ciblés simultanément | Réussi | 2 cases cochées simultanément sur 3 |
| 9 | Ancien membre du périmètre figé | Réussi | Visible, mention « retiré du foyer », sélectionnable |
| 14-16 | Déclaration à trois états (alternatives) : non renseigné / aucune identifiée / décrite | Réussis | État par défaut, texte libre masqué/affiché selon l'état |
| **9001** | **NOUVEAU §4** — ConfirmModal perte de texte : ouverture, `role="dialog"`/`aria-modal`/`aria-labelledby` pointant vers le vrai titre | Réussi | `aria-labelledby` == `id` du `<h2>` du titre affiché |
| **9002** | **NOUVEAU §4** — focus initial posé dans la modale | Réussi | `document.activeElement` contenu dans le conteneur `role="dialog"` |
| **9003** | **NOUVEAU §4** — piège de focus Tab (boucle avant, dernier -> premier) | Réussi | Focus sur le dernier bouton + Tab -> focus revient au premier |
| **9004** | **NOUVEAU §4** — piège de focus Shift+Tab (boucle arrière, premier -> dernier) | Réussi | Focus sur le premier bouton + Shift+Tab -> focus va au dernier |
| **9005** | **NOUVEAU §4** — Escape ferme la modale, focus revient au déclencheur | Réussi | Modale disparue, `document.activeElement` == élément ayant ouvert la modale |
| 17 | Annulation de la ConfirmModal (perte de texte) : texte ET état conservés | Réussi | Radio « Décrit » toujours cochée, texte intact |
| 18 | Confirmation acceptée : bascule effective, texte effacé | Réussi | Radio « Aucune identifiée » cochée, `<textarea>` disparu |
| **1001-1006** | **NOUVEAU §5** — dirty guard complet sur `RecommendationDetail` : formulaire propre au chargement (pas de ConfirmModal) ; modifier le DOMAINE puis revenir exactement à l'état initial redevient propre (pas seulement les champs narratifs) ; une modification réelle déclenche la ConfirmModal au retour ; « Annuler » la ConfirmModal conserve formulaire ET saisie ; « Quitter sans enregistrer » perd la saisie et revient à la liste | 6/6 réussis | Détail : `dialogs=0`/`dialogs=1`/`titleValue` contient la modification/`onList>0`, un test par étape |
| **1007** | **NOUVEAU §5** — `beforeunload` absent sur un formulaire propre | Réussi | Rechargement réel déclenché, aucune boîte de dialogue native interceptée |
| **1008** | **NOUVEAU §5** — `beforeunload` présent sur un formulaire modifié | Réussi | Boîte de dialogue native de type `beforeunload` interceptée et annulée (formulaire resté affiché) |
| **1009** | **NOUVEAU §5** — `beforeunload` retiré après sauvegarde réussie, aucun écouteur résiduel | Réussi | Sauvegarde effectuée puis rechargement réel : aucune boîte de dialogue |
| **23** | **NOUVEAU §3 (revérifié en contexte UI complet)** — conflit de révision de recommandation (409, deux « onglets » réels via deux séquences `fetch` directes) | Réussi | Réponse HTTP effective : `status=409`, `code="RECOMMENDATION_REVISION_CONFLICT"` |
| **25** | **NOUVEAU §3** — conflit de révision de SESSION (409, code distinct) | Réussi | `status=409`, `code="SESSION_REVISION_CONFLICT"` |
| 24 | Validation normale | Réussi | `status=200`, `recommendation.status="validated"` |
| 26 | Contenu immuable après validation | Réussi | Champ titre `disabled`, bouton « Enregistrer » absent, badge « Validée » |
| 27 | Écartement d'un brouillon : refus sans motif puis succès avec motif | Réussi | Erreur affichée sans motif ; badge « Écartée » après motif saisi |
| 28 | Retrait d'une recommandation validée | Réussi | Badge « Retirée » |
| 4 | Sélection cross-domaine refusée (changement d'onglet bloqué), « Vider la sélection » débloque | Réussi | Bandeau affiché, onglet « Assurance Maladie » reste actif malgré le clic sur « Commun », puis bascule effective après avoir vidé la sélection |
| 29 | Création d'un remplacement, bannière « Remplace la recommandation #X, actuellement validée » | Réussi | Texte exact de la bannière vérifié |
| 30 | Remplacement non encore validé : la source reste « Validée », pas « Remplacée » prématurément | Réussi | Vérifié directement via l'API : `supersedes_recommendation_id` correctement lié, statut source toujours `validated` |
| 35 | Historique complet | Réussi | Toutes les cartes portent un nom d'auteur résolu |
| 36 | Foyer archivé : capacité de création refusée, lecture seule, bandeau explicite | Réussi | Bouton absent, bandeau affiché, `recommendation_capabilities.create=false` vérifié via l'API en plus de l'UI |
| 38 | Tablette portrait (820×1180) | Réussi | `scrollWidth <= clientWidth`, vérifié programmatiquement |
| 39 | Tablette paysage (1180×820) | Réussi | Idem |
| **40** | **NOUVEAU §4** — parcours clavier complet sur la modale de validation : focus initial, 8 tabulations consécutives sans jamais sortir du conteneur, Escape ferme | Réussi | `initialFocusInside=true`, `stayedInside=true` sur 8 `Tab` consécutifs, `dialogClosed=true` |
| 41 | Absence de `localStorage`/`sessionStorage` | Réussi | 0 clé dans les deux |
| 42 | Absence de texte narratif dans l'URL, absence d'erreur console | Réussi | Marqueur distinctif absent de l'URL ; 0 erreur console inattendue (bruit réseau attendu des conflits 409 délibérément déclenchés en §23/§25 explicitement filtré et compté séparément) |
| 37 | Erreur réseau : message affiché, aucun optimisme silencieux | Réussi | Contexte navigateur mis hors ligne, erreur affichée, formulaire non perdu |

**34/34 réussis.**

### Défaut réel détecté et corrigé pendant cette QA (§5)

**Navigation entrante contextualisée non purgée de `history.state`** —
`SessionRecommendations.jsx` consommait `location.state.findingIds`
(venant de `SessionFindings.jsx`) via un garde en mémoire
(`consumedNavKeyRef`) supposé empêcher une seconde ouverture de l'écran de
création. Ce garde ne survit pas à un remontage du composant, alors que
`location.state` lui-même SURVIT à un rechargement complet de page (le
navigateur conserve l'état associé à une entrée d'historique). Détecté en
vérifiant l'effet d'un rechargement après avoir annulé une création
contextualisée : l'écran de création se rouvrait silencieusement avec les
mêmes `finding_ids`, potentiellement déjà traités. Corrigé en purgeant
`history.state` dès la consommation
(`navigate(location.pathname, { replace: true })`), sans ajouter de
nouvelle entrée d'historique. Revérifié en direct après correctif (le
même scénario ne reproduit plus le défaut).

### Scénarios non rejoués dans ce round (déjà couverts par le round
### précédent ci-dessus, comportement inchangé par ce GATE ciblé)

3 (création multi-findings même domaine), 10-13 (cohérence finding/membre),
17-20 côté risques/informations manquantes (même composant `DeclarationField`
que les alternatives, déjà revérifié dans ce round), 31-34 (validation du
remplacement / ancienne recommandation « Remplacée » / remplacement écarté
puis nouveau essai / potentiellement obsolète) — aucun de ces chemins de
code n'a été modifié par le volet §4-§9 de ce GATE ciblé ; les garanties
déjà citées dans le round précédent (structurelles, couverture serveur
exhaustive, revue de code) restent valables telles quelles.

### Contrôles finaux de ce round

`npm run lint`, `npm test` (1089/1089) et `npm run build` exécutés avec
succès après l'ensemble des correctifs de ce round. Base de démonstration,
scripts de fixture/QA (y compris les scripts de diagnostic ayant permis de
détecter le défaut ci-dessus) et captures temporaires supprimés après
exécution ; aucune de ces données n'a été committée.

## Round 3 — corrections issues des trois revues finales ciblées (§11)

Sept corrections apportées en réponse aux revues `advisory-architect`,
`compliance-privacy-reviewer` et `client-meeting-ux` (détail complet dans
`IMPLEMENTATION_ROADMAP.md`, bullet §11) : minimisation de
`getExecutionDetail`, découplage de la purge de `history.state` du succès
du chargement, retrait de `can_answer` inutilisé sur `session.members`,
timing de capture du déclencheur de focus dans `ui.jsx`, condition de
portée sur `link_member`/`unlink_member`, alignement de la gestion
d'erreur de `DismissRecommendationModal`/`WithdrawModal`, reformulation du
texte de conflit de révision dans `ValidateModal`.

**Vérification effectuée pour ce round** : `npm run lint` (aucune erreur),
`npm test` (**1091/1091**, dont 2 nouveaux tests — un verrou de projection
exacte pour `getExecutionDetail`, un test dédié `allowed_actions` pour le
cas `scope = member` — et 3 tests existants mis à jour pour refléter le
changement de comportement `link_member`/`unlink_member` désormais
conditionné à la portée), `npm run build` (succès).

**Ce qui n'a PAS été revérifié en direct dans ce round**, consigné
explicitement plutôt que passé sous silence : une tentative de démarrage
du serveur en production (méthodologie déjà établie aux rounds
précédents) a été faite pour rejouer en direct le scénario de retour de
focus du correctif `ui.jsx`, mais la base de démonstration présente dans
l'environnement de cette passe ne contenait aucun utilisateur exploitable
pour se connecter (table `users` vide) — la reconstitution d'un compte de
démonstration complet dépassait le périmètre proportionné d'une simple
vérification de correctif ponctuel. Le serveur a été arrêté sans action
supplémentaire. Les 4 corrections de comportement UI (`ui.jsx`,
`ValidateModal`, `DismissRecommendationModal`, `WithdrawModal`) reposent
donc sur le raisonnement de code et la suite de tests automatisés
ci-dessus, jamais sur une exécution Playwright réelle de ce round
spécifique — à la différence des rounds 1 et 2 ci-dessus, où chaque
scénario marqué comme corrigé a été rejoué en direct après correctif.
Cette distinction est reprise dans `UX_AND_CLIENT_MODE.md` §6.2.

## Round 4 — correction round exigée avant commit : 42/42 scénarios réellement rejoués

**Ce round remplace et corrige l'annonce du round 3 ci-dessus** : le rapport
précédent présentait un total de 34 scénarios rejoués en direct (round « GATE
ciblé complémentaire »), pas 42. Le round ci-dessous exécute intégralement
et sans exception les 42 scénarios du brief, dans une seule matrice non
ambiguë, avec pour chaque ligne des données fictives, un résultat attendu,
un résultat observé et une preuve réellement exécutée — aucun résultat
n'est présenté sur la base d'une inspection statique.

### Environnement QA isolé (créé automatiquement par le script)

- `CRM_DATA_DIR` temporaire dédié (`scratchpad/qa42/data`, jamais
  `data/**` du dépôt).
- Compte conseiller fictif créé par le script via le **véritable** parcours
  de premier démarrage (`POST /api/auth/setup`, jamais une insertion SQL
  directe d'utilisateur) — `qa-conseiller@exemple-fictif.ch`.
- Données 100% fictives créées par script : 2 foyers (le second archivé au
  scénario 36), 4 sessions (santé, vie/prévoyance, santé sur le second
  foyer, domaine mixte), constats de portée foyer et membre, un membre
  historique retiré et un membre ajouté après l'exécution de référence
  (pour les scénarios 9-10).
- Serveur unique origine (build de production Express), Chromium réel
  piloté par Playwright (`playwright@latest`, installé de façon isolée
  hors du `package.json` du projet — jamais ajouté aux dépendances).
- Base, comptes, scripts et captures temporaires supprimés après
  exécution ; aucune de ces données n'a été committée.

### Défauts réels détectés et corrigés pendant ce round

Trois défauts certains, chacun détecté par l'échec **réel** d'un scénario en
direct (jamais par une relecture statique du code), corrigés puis
revérifiés par un rejeu complet :

1. **`createReplacement` ignorait silencieusement `finding_ids`**
   (`server/advisoryRecommendations.js`) — contrairement à
   `createRecommendation`, la création d'un remplacement (« Créer une
   nouvelle version ») ne liait jamais aucun constat, et le formulaire
   frontend (`SessionRecommendations.jsx`) passait toujours
   `initialFindingIds={[]}` pour ce cas. Conséquence concrète : un
   remplacement créé depuis l'interface ne pouvait **jamais** être validé
   (refus serveur 400 « Au moins un constat source est obligatoire pour
   valider une recommandation »), bloquant définitivement les scénarios
   29-33. Corrigé des deux côtés : `createReplacement` accepte désormais
   `finding_ids` avec exactement le même contrôle que `createRecommendation`
   (cohérence de domaine, cohérence membre) et les lie dans la même
   transaction ; le formulaire de remplacement pré-remplit désormais
   `initialFindingIds` avec les constats déjà liés à la recommandation
   remplacée (référence structurelle, jamais un texte narratif copié — même
   principe que la création contextualisée depuis un constat). Quatre tests
   dédiés ajoutés (`test/advisory-recommendations.test.js`).
2. **`allowed_actions.replace` ne reflétait pas le contrôle bloquant réel de
   `createReplacement`** (`server/advisoryRecommendations.js`) — valait
   `isValidated` seul, sans jamais vérifier l'absence d'un remplacement déjà
   actif (non écarté). Conséquence concrète : le bouton « Créer une
   nouvelle version » restait affiché même lorsqu'un remplacement actif
   existait déjà, une tentative aboutissant alors à un refus serveur 409
   (« a déjà un remplacement actif en cours ») — jamais détecté par la QA
   Playwright précédente, qui ne revérifiait le bouton qu'**après**
   écartement du remplacement précédent, jamais **pendant** qu'un
   remplacement actif existait. Détecté en écrivant précisément le test de
   capacité manquant exigé par ce correctif. Corrigé : `replace` reproduit
   désormais exactement le même prédicat que le contrôle bloquant
   (`hasActiveSuccessor`). Trois tests dédiés ajoutés.
3. **Script QA lui-même (pas un défaut produit)** — le scénario 22 (garde
   anti-double-clic) utilisait deux appels Playwright `.click()` successifs
   sur le même bouton, dont le second, si le bouton était momentanément
   désactivé (`saving`) par le premier clic, attend son propre délai puis
   déclenche un second clic **réellement nouveau** une fois le premier
   enregistrement terminé — un faux positif d'outillage, jamais une
   défaillance de la garde applicative (`savingRef`, synchrone). Confirmé
   par diagnostic direct : deux appels DOM natifs synchrones
   (`btn.click(); btn.click();` dans la même microtâche, contournant
   l'attente d'« actionability » de Playwright) ne produisent jamais qu'un
   seul incrément de révision. Le script a été corrigé pour utiliser cette
   technique déterministe.

### Matrice exacte — 42/42 scénarios, rejeu réel

| # | Scénario | Données fictives | Attendu | Observé | Résultat |
|---|---|---|---|---|---|
| 1 | Liste vide | Session sans aucune recommandation | Message d'état vide explicite, aucune carte | `"Aucune recommandation ne correspond aux filtres actuels."` | **PASS** |
| 2 | Création depuis un finding health | Constat `finding_scope=household`, domaine santé | Domaine verrouillé sur santé, 1 constat source affiché | Domaine health verrouillé, 1 constat source affiché | **PASS** |
| 3 | Création depuis plusieurs findings même domaine | 2 constats domaine santé sélectionnés | Les 2 constats source affichés | 2 constats sources affichés | **PASS** |
| 4 | Sélection cross-domain refusée | Sélection active sur Assurance Maladie, tentative d'ouvrir Vie et Prévoyance | Changement d'onglet refusé tant que la sélection existe | Onglet Vie et Prévoyance refusé tant que la sélection active existe | **PASS** |
| 5 | Scope session | Aucun membre ciblé | Portée « Transverse au foyer », aucun sélecteur de membres | Brouillon créé, aucun sélecteur de membres | **PASS** |
| 6 | Scope household | Portée par défaut à la création | Portée household confirmée par défaut | Brouillon créé, portée household confirmée | **PASS** |
| 7 | Scope member | 3 membres proposés (périmètre figé de la session) | Sélecteur de membres affiché, 1 membre sélectionnable | 3 membres proposés, 1 sélectionné, brouillon créé | **PASS** |
| 8 | Plusieurs membres | 2 des 3 membres cochés simultanément | Les deux membres ciblés simultanément | 2 membres ciblés simultanément, brouillon créé | **PASS** |
| 9 | Ancien membre | Membre retiré du foyer après le snapshot de la session | Affiché avec la mention « retiré du foyer », sélectionnable (jamais bloqué côté client) | Membre historique affiché, mention présente, sélectionnable | **PASS** |
| 10 | Membre ajouté après snapshot refusé | Membre ajouté au foyer après l'exécution de référence de la session | Sélecteur limité au périmètre figé, nouveau membre absent | Sélecteur limité à 3 membres, "Nouveau" absent | **PASS** |
| 11 | Finding member correspondant | Constat `finding_scope=member` (membre principal) + recommandation scope=member ciblant le même membre | Création acceptée | Création réussie, cohérence confirmée | **PASS** |
| 12 | Finding member incohérent refusé | Constat `finding_scope=member` (membre B) lié à une recommandation ciblant le membre A | Refus serveur 409, message de cohérence | `"Le finding #3 concerne un membre non ciblé par cette recommandation (portée « member » incohérente)."` | **PASS** |
| 13 | Finding household pour recommandation member | Constat `finding_scope=household` lié à une recommandation scope=member | Autorisé (cohérence non exigée pour ce cas) | Lié sans refus | **PASS** |
| 14 | Alternatives non renseignées | Formulaire de création, aucune saisie | Radio « Non renseigné » cochée par défaut | Radio « Non renseigné » cochée par défaut | **PASS** |
| 15 | Aucune alternative | Radio « Aucune identifiée » choisie | État `none` persisté après rechargement complet | Persisté après rechargement | **PASS** |
| 16 | Alternatives décrites | Radio « Décrit » choisie, texte saisi | État `described` persisté après rechargement complet | Persisté après rechargement | **PASS** |
| 17 | Aucun risque | Radio « Aucun risque » choisie | État `none` persisté après rechargement complet | Persisté après rechargement | **PASS** |
| 18 | Risques décrits | Radio « Décrit » choisie, texte saisi | État `described` persisté après rechargement complet | Persisté après rechargement | **PASS** |
| 19 | Aucune information manquante | Radio « Aucune » choisie | État `none` persisté après rechargement complet | Persisté après rechargement | **PASS** |
| 20 | Informations manquantes décrites | Radio « Décrit » choisie, texte saisi | État `described` persisté après rechargement complet | Persisté après rechargement | **PASS** |
| 21 | Sauvegarde brouillon | Titre modifié, « Enregistrer » cliqué | Révision +1, statut `draft` conservé | Révision 7 → 8, statut draft conservé | **PASS** |
| 22 | Double clic sauvegarde | Deux clics DOM natifs synchrones sur « Enregistrer » | Un seul incrément de révision | Révision 8 → 9 (un seul incrément) | **PASS** |
| 23 | Conflit révision recommandation | Modification externe (API directe) puis sauvegarde UI avec révision périmée | Message de conflit distinct, rechargement de la version serveur | `"Cette recommandation a été modifiée ailleurs (un autre onglet ?)…"` | **PASS** |
| 24 | Validation normale | Brouillon complet lié à un constat actif | Statut passé à `validated` après confirmation | Statut validated confirmé | **PASS** |
| 25 | Conflit révision session | Révision de session modifiée entre chargement et validation | Message distinct du conflit de recommandation | `"La session a changé depuis la dernière consultation…"` | **PASS** |
| 26 | Contenu immuable après validation | Recommandation déjà `validated` | Champs désactivés, bouton Enregistrer absent | Confirmé | **PASS** |
| 27 | Écartement | Brouillon, motif saisi | Statut `dismissed`, motif obligatoire | Statut dismissed avec motif | **PASS** |
| 28 | Retrait | Recommandation `validated`, motif saisi | Statut `withdrawn` | Statut withdrawn avec motif | **PASS** |
| 29 | Création remplacement | Recommandation source `validated` | Brouillon créé, `supersedes_recommendation_id` référence la source | Brouillon référence supersedes_recommendation_id correct | **PASS** |
| 30 | Remplacement non validé | Remplacement encore `draft` | Source reste `validated` (jamais « Remplacée » prématurément) | Source reste validated | **PASS** |
| 31 | Validation remplacement | Remplacement complété et lié à un constat | Statut du remplacement passe à `validated` | Remplacement passé à validated | **PASS** |
| 32 | Ancienne recommandation superseded | Remplacement validé | Source bascule atomiquement à `superseded` | Statut serveur confirmé superseded | **PASS** |
| 33 | Remplacement dismissed puis nouvel essai | Premier remplacement écarté | Un nouveau remplacement reste possible depuis la source toujours validated | Nouveau remplacement possible, confirmé | **PASS** |
| 34 | Potentially stale | Révision de session modifiée après validation | Bandeau « Potentiellement obsolète » affiché | Bandeau affiché après rechargement | **PASS** |
| 35 | Historique | 12 recommandations statuts variés | Toutes visibles, statuts terminaux affichés | 12 cartes, écartées: 2, retirées: 1 | **PASS** |
| 36 | Foyer archivé | Foyer archivé via un appel API direct (« autre onglet »), page déjà chargée puis actualisée | Bandeau affiché, bouton de création disparu après actualisation, capacités serveur revérifiées | Confirmé après actualisation | **PASS** |
| 37 | Erreur réseau | Route interceptée en échec (`route.abort('failed')`) | Message d'erreur clair, aucun optimisme silencieux | `"Failed to fetch"` affiché | **PASS** |
| 38 | Tablette portrait | Viewport 768×1024 | Aucun débordement horizontal | `scrollWidth=768, clientWidth=768` | **PASS** |
| 39 | Tablette paysage | Viewport 1024×768 | Aucun débordement horizontal | `scrollWidth=1024, clientWidth=1024` | **PASS** |
| 40 | Clavier et focus | Modale de validation ouverte, mutation interceptée avec délai artificiel | Focus initial dans la modale, boucle Tab/Shift+Tab, fond `inert`, Échap ferme, focus revient au déclencheur, fermeture bloquée pendant la mutation, erreur annoncée | Focus initial, boucle Tab/Shift+Tab, fond inert, Échap, retour du focus, fermeture bloquée pendant mutation — tous vérifiés en direct | **PASS** |
| 41 | Absence localStorage/sessionStorage | Texte narratif distinctif saisi puis recherché dans les deux stockages | Aucune occurrence | Aucun texte narratif QA dans localStorage (2 car.) ni sessionStorage (2 car.) | **PASS** |
| 42 | Absence de texte sensible dans URL et console | Parcours complet, URL et erreurs console inspectées | URL sans texte narratif, aucune erreur console ne contient de texte narratif | URL propre, 5 erreurs console au total sur toute la session, aucune ne contient de texte narratif | **PASS** |

**42/42 réussis. Aucun FAIL, aucun BLOCKED.** Journal brut complet de
l'exécution (avant suppression de l'environnement QA temporaire) :
`results-partial.json` généré en continu par le script, un résultat écrit
immédiatement après chaque scénario (jamais après coup en bloc).

### Garde de perte de saisie — documentée dans les scénarios concernés

Rejouée à même les scénarios ci-dessus plutôt qu'isolée : la navigation
sidebar/session/constats (scénarios impliquant `guardedNavigate`), le
rechargement complet (scénarios 15-20, 34), et l'annulation de formulaire
(`robustCancel`, utilisée pour revenir proprement à la liste entre les
scénarios 2-3, 10, 29, 33-34) passent tous par le contexte partagé
`NavigationGuardProvider` (`client/src/navigationGuard.jsx`) — aucune
implémentation locale divergente.

**Correction d'une affirmation erronée** (relevée par la revue finale
`advisory-architect` de ce round, avant toute clôture) : une version
précédente de cette section affirmait que le mécanisme sentinelle
(`history.pushState` + `popstate`) et la garde sidebar/déconnexion
« rest[aient] ceux déjà vérifiés en direct au round « GATE ciblé
complémentaire » ». C'est **faux** : `navigationGuard.jsx` §1-2 le dit
explicitement lui-même — avant ce module, la barre latérale, la déconnexion
et le bouton Précédent/Suivant du navigateur n'étaient **jamais** protégés.
Il ne s'agit pas d'une relocalisation de code inchangé mais d'un mécanisme
entièrement nouveau, qui n'avait encore fait l'objet d'aucune vérification
Playwright réelle dans aucun round — exactement le type de défaut ayant
motivé le rejet du rapport précédent. Corrigé en rejouant réellement ces
scénarios (voir ci-dessous) avant toute clôture.

### Vérification live dédiée — sidebar / déconnexion / Précédent / Suivant

Script Playwright séparé (`verify-nav-guard.cjs`), un contexte navigateur
frais par groupe de vérification, environnement QA isolé identique à la
matrice 42/42 ci-dessus :

| # | Vérification | Résultat | Preuve |
|---|---|---|---|
| 1 | Navigation sidebar bloquée, formulaire sale, Annuler | **PASS** | texte saisi et écran conservés après Annuler |
| 2 | Navigation sidebar bloquée, formulaire sale, Confirmer | **PASS** | navigation réelle vers « Tableau de bord » confirmée (`nav.active`) |
| 3 | Déconnexion bloquée, formulaire sale, Annuler | **PASS** | toujours connecté, formulaire intact |
| 4 | Déconnexion bloquée, formulaire sale, Confirmer | **PASS** | écran de connexion réellement atteint |
| 5 | Précédent navigateur bloqué, formulaire sale, Annuler | **PASS** | `popstate` intercepté, texte et écran conservés |
| 6 | Précédent navigateur bloqué, formulaire sale, Confirmer | **PASS** | navigation Précédent réelle effectuée après confirmation |
| 7 | Limite connue : Suivant après un Précédent + formulaire rendu sale ensuite | **Documenté** | `pushState` (armement de la sentinelle) détruit l'entrée « Suivant » existante — comportement de l'API History, pas une défaillance applicative. Reproduit réellement : `goForward()` n'a rien à atteindre (aucune confirmation affichée, dashboard non atteint, formulaire reste affiché) — **sûr** (le bouton Suivant devient simplement sans effet, jamais un contournement silencieux de la garde), mais pas la séquence littérale « confirmation puis respect » pour ce cas composé précis. Limite acceptée, documentée dans le code (`navigationGuard.jsx`) au même titre que celle déjà connue sur le tout premier appui Précédent d'un épisode sale. |
| 8 | `beforeunload` toujours actif (nouvelle architecture partagée) | **PASS** | boîte native interceptée sur un formulaire sale |

**Défaut de script corrigé pendant cette vérification (pas un défaut
produit)** : les deux premières tentatives ont échoué sur les vérifications
5-6 et 8, root-causées par diagnostic direct plutôt que supposées :
`page.goBack()` était déclenché immédiatement après avoir rempli le champ
titre, avant que l'effet React armant la sentinelle d'historique n'ait eu
le temps de committer (`pushState`) — un défaut d'outillage, jamais
atteignable par un utilisateur réel à cette vitesse ; confirmé par
plusieurs reproductions isolées où le mécanisme fonctionnait correctement.
Corrigé par une marge d'attente déterministe après la saisie. La
vérification 8 échouait pour une raison distincte et sans rapport : un
écouteur `dialog` persistant hérité (auto-acceptation) entrait en course
avec l'écouteur dédié du test, masquant la boîte réellement affichée.

**7/7 vérifications testables réussies, 1 limite connue reproduite et
documentée honnêtement (pas un FAIL, pas un succès forcé).**

### Trois autres défauts certains détectés et corrigés par les revues finales de ce round

En plus des deux défauts produit du round 4 ci-dessus (`createReplacement`,
`allowed_actions.replace`), les trois revues finales relancées après le
rejeu 42/42 (§11 du brief) ont identifié et fait corriger :

- **`onOpenOther` contournait intégralement le garde de navigation**
  (`SessionRecommendations.jsx`, défaut critique relevé par
  `client-meeting-ux`) : les boutons « #X » des bannières de remplacement
  (« Remplace la recommandation #X » / « Remplacée par #X ») changeaient
  `recId` sur le même `RecommendationDetail` déjà monté sans jamais appeler
  `confirmIfDirty()` — un brouillon de remplacement en cours d'édition
  perdait ses modifications d'un simple clic, sans aucun avertissement.
  Corrigé (`handleOpenOther`, même garde que `handleBack`).
- **Échap fermait deux modales empilées simultanément** (`ui.jsx`, défaut
  élevé relevé par `client-meeting-ux`) : chaque `Modal` posait son propre
  écouteur clavier sans notion de modale « du dessus » — une confirmation
  de perte de saisie ouverte par-dessus une modale d'écartement/retrait
  fermait les deux à la fois sur une seule pression, détruisant un motif
  déjà tapé. Corrigé par une pile partagée (`modalStack`) : seule la
  modale au sommet répond désormais à Échap/Tab.
- **Ctrl/Cmd/Maj+clic sur un lien sidebar ne pouvait plus ouvrir un nouvel
  onglet** (`App.jsx`, défaut moyen relevé par `client-meeting-ux`) :
  `preventDefault()` inconditionnel. Corrigé (modificateurs exemptés de la
  garde).

Corrections mineures supplémentaires (revue `advisory-architect`) :
requête SQL du contrôle de remplacement actif factorisée
(`activeSuccessorOf`, plus jamais dupliquée textuellement entre
`createReplacement` et `allowed_actions.replace`) ; ordre des vérifications
de `createReplacement` aligné sur les 9 autres fonctions d'écriture
(anti-IDOR avant inscriptibilité) ; couleurs `rgba` figées de
`button.danger:hover`/`.alert.error` remplacées par `color-mix(... var(--critical) ...)`
(suivent désormais le thème automatiquement).

### Vérification live dédiée — `onOpenOther` et pile de modales

Script Playwright séparé (`verify-client-ux-fixes.cjs`), environnement QA
isolé identique aux vérifications précédentes :

| # | Vérification | Résultat | Preuve |
|---|---|---|---|
| 1a | `onOpenOther` (lien « #X » d'une bannière de remplacement) bloqué pendant qu'un brouillon est sale, Annuler | **PASS** | texte non enregistré conservé après Annuler |
| 1b | `onOpenOther` bloqué, Confirmer | **PASS** | écran de la recommandation source réellement atteint après confirmation (champ titre affiche désormais celui de la source) |
| 2 | Échap sur une confirmation de perte de saisie ouverte PAR-DESSUS une modale « Écarter » déjà affichée (déclenchée via le bouton Précédent du navigateur, seule voie réellement cliquable quand une modale couvre l'écran) | **PASS** | une seule pression d'Échap referme uniquement la confirmation du dessus ; la modale « Écarter » reste ouverte, motif déjà tapé intact |

**Observation de fraîcheur, non liée à ce correctif (transparence, aucune
action requise)** : après avoir créé un remplacement puis sauté directement
vers l'original via `onOpenOther` SANS repasser par l'écran liste, la
bannière inverse « Remplacée par la recommandation #X » peut ne pas encore
apparaître sur l'écran de l'original — `allRecommendations` (tête de page)
n'est rafraîchi que par `backToList`/retour à la liste, pas après chaque
mutation imbriquée. Le lien structurel (`supersedes_recommendation_id`,
toujours à jour côté serveur et sur l'écran du remplacement lui-même)
n'est jamais affecté ; seule cette bannière de confort, dérivée
côté client, peut retarder d'un aller-retour liste. Caractéristique
préexistante, sans rapport avec le garde de navigation corrigé ici.

### Contrôles finaux de ce round

`npm run lint`, `npm test` (**1103/1103**, dont 12 nouveaux tests : 4 pour
la liaison des constats à la création d'un remplacement, 3 pour la
capacité `allowed_actions.replace`, 5 pour la politique foyer archivé sur
`createReplacement`/`linkFinding`/`unlinkFinding`/`linkMember`/
`unlinkMember`) et `npm run build` exécutés avec succès après l'ensemble
des correctifs de ce round (les deux défauts produit initiaux, les trois
défauts relevés par les revues finales, et la vérification live du garde
de navigation sidebar/déconnexion/Précédent/Suivant/`beforeunload`). Base
de démonstration, comptes, scripts de fixture/QA et captures temporaires
supprimés après exécution ; aucune de ces données n'a été committée.
