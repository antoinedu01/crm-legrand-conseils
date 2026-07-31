# Checklist manuelle — interface minimale sessions/questionnaires (Lot 3A)

> Aucun framework de test frontend n'existe dans ce dépôt (confirmé aux
> Lots 0/2 : `package.json` ne référence que `node:test` côté serveur).
> Conformément aux instructions du Lot 3A, aucune dépendance de test
> frontend n'a été ajoutée uniquement pour ce lot. Cette checklist remplace
> des tests automatisés frontend absents — elle a été **exécutée
> réellement** via un navigateur Chromium piloté par Playwright (déjà
> installé dans cet environnement, non ajouté au projet), pas seulement
> rédigée sur la base du code. Le frontend de ce lot reste volontairement
> minimal (technique) : le rendu complet des questions, la progression
> visuelle et le mode présentation client sont différés au Lot 3B, non
> démarré.

## Écran : Liste des sessions (`/diagnostic-360/sessions`)

- [ ] L'entrée « Sessions RDV » apparaît dans la barre latérale, à côté de
      « Diagnostic 360 ».
- [ ] État vide : « Aucune session. Créez la première avec « + Nouvelle
      session ». »
- [ ] Le filtre par statut fonctionne (Brouillon / En cours / Suspendue /
      Finalisée / Annulée / Tous).
- [ ] Chaque ligne affiche : foyer, domaine, statut (badge), date prévue,
      dernière activité.
- [ ] Cliquer une ligne ouvre la fiche session.

## Écran : Création d'une session

- [ ] Recherche d'un foyer existant : taper 2+ caractères affiche des
      résultats cliquables ; aucune création de foyer depuis cet écran.
- [ ] Changer le domaine (Maladie / Vie et Prévoyance / Mixte) change
      dynamiquement les sélecteurs de version affichés.
- [ ] Domaine « Assurance Maladie » : sélecteur de version « Assurance
      Maladie » obligatoire, sélecteur « Commun » facultatif, pas de
      sélecteur « Vie et Prévoyance ».
- [ ] Domaine « Mixte » : sélecteurs « Assurance Maladie » **et** « Vie et
      Prévoyance » tous deux obligatoires, « Commun » facultatif.
- [ ] Si aucune version publiée n'existe pour un domaine, un message clair
      l'indique (« Aucune version publiée pour ce domaine pour le
      moment. ») plutôt qu'un sélecteur vide silencieux.
- [ ] La création aboutit sur la fiche de la nouvelle session (statut
      Brouillon).
- [ ] Tenter de créer sans avoir choisi les versions requises affiche une
      erreur claire, pas un échec silencieux.

## Écran : Fiche session

- [ ] Statut (badge), foyer, domaine, dates (prévue/démarrée/suspendue/
      finalisée/dernière activité), révision, nombre de réponses
      enregistrées sont tous affichés.
- [ ] Tableau « Questionnaires rattachés » : ordre, domaine, rôle (Commun /
      Spécifique au domaine), version.
- [ ] Un bloc « Questionnaire et réponses » affiche un état vide explicite
      (pas une section manquante) — réservé au Lot 3B.
- [ ] Boutons d'action cohérents avec le statut courant : Brouillon
      (Démarrer, Annuler) ; En cours (Suspendre, Annuler, Vérifier la
      finalisation, Finaliser) ; Suspendue (Reprendre, Annuler) ; Finalisée
      et Annulée (aucune action de transition).
- [ ] « Vérifier la finalisation » affiche, pour une session mixte, les
      éléments manquants **séparément** par domaine (Commun / Assurance
      Maladie / Vie et Prévoyance), jamais une liste unique indifférenciée.
- [ ] « Finaliser » réussit uniquement quand la vérification est positive ;
      sinon affiche la même liste d'éléments manquants par domaine.

## Écran : Fiche foyer — intégration

- [ ] Le bloc « Diagnostics » de la fiche foyer (`/diagnostic-360/foyers/:id`)
      affiche désormais la liste réelle des sessions de ce foyer (domaine,
      statut, dernière activité), cliquable vers la fiche session.
- [ ] État vide explicite si aucune session n'existe pour ce foyer.

## Multi-appareil

- [ ] Mise en page identique au reste du module (grilles/`table.data`
      existants, non retestée spécifiquement à la souris/tactile dans ce
      lot).

## Historique d'exécution

Exécutée le 28 juillet 2026 sur une base de démonstration temporaire
(`CRM_DATA_DIR` isolé, données entièrement fictives, jamais committées),
via un parcours automatisé Playwright couvrant : connexion, liste de
sessions vide, ouverture de la modale de création, recherche et sélection
d'un foyer, sélection d'une version « Assurance Maladie » publiée
(questionnaire technique de démonstration, contenu manifestement fictif),
création de la session, démarrage, vérification de finalisation (éléments
manquants affichés par domaine), suspension, reprise, et vérification de
l'intégration dans la fiche foyer (bloc « Diagnostics » affichant la
session réelle). Aucune erreur console navigateur observée à aucune étape.
Toutes les étapes ci-dessus ont été observées visuellement conformes lors
de cette exécution.

Une seconde exécution ciblée, le même jour, a vérifié visuellement les deux
correctifs issus de la revue `client-meeting-ux` : (1) réinitialisation des
sélecteurs de version santé/vie-prévoyance lors d'un changement de domaine
(scénario mixte → santé → mixte) — un premier passage a révélé que l'état
interne était bien remis à zéro (soumission refusée avec message d'erreur
explicite, jamais de soumission silencieuse d'une ancienne sélection) mais
que l'affichage du `<select>` « Assurance Maladie » restait trompeur (valeur
visuellement conservée) car ce composant reste monté d'un domaine à l'autre
lorsque les deux impliquent la santé ; corrigé en ajoutant `key={domain}` à
chaque `VersionPicker` pour forcer un remontage complet à chaque changement
de domaine, puis revérifié visuellement conforme ; (2) confirmation
`window.confirm` avant l'action « Annuler » une session — vérifié que le
dialogue s'affiche avec le message attendu et que le statut de la session
reste inchangé après annulation du dialogue. Aucune erreur console
navigateur observée.
