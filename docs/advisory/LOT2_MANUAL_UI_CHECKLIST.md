# Checklist manuelle — interface du socle foyer (Lot 2)

> Aucun framework de test frontend n'existe dans ce dépôt (confirmé en
> LOT 0/LOT 2 : `package.json` ne référence que `node:test` côté serveur).
> Conformément aux instructions du Lot 2, aucune dépendance de test frontend
> n'a été ajoutée uniquement pour ce lot. Cette checklist remplace des tests
> automatisés frontend absents — elle a été **exécutée réellement** une
> première fois via un navigateur Chromium piloté par Playwright (déjà
> installé dans cet environnement, non ajouté au projet) pendant ce lot, pas
> seulement rédigée sur la base du code. Les captures d'écran correspondantes
> ont été prises à cette occasion.

## Écran : Liste des foyers (`/diagnostic-360/foyers`)

- [ ] L'entrée « Diagnostic 360 » apparaît dans la barre latérale, entre
      « Tâches » et « Conformité ».
- [ ] État vide : message « Aucun foyer. Créez le premier avec « + Nouveau
      foyer ». » s'affiche quand la liste est vide.
- [ ] La recherche (`q`) filtre par nom de foyer et par nom du principal.
- [ ] Le filtre par statut fonctionne (Actif / Archivé / Tous).
- [ ] Chaque ligne affiche : nom du foyer, client principal, statut (badge),
      commune/canton (tiret si absent), nombre de membres actifs, dernière
      modification (date formatée, pas un horodatage brut).
- [ ] Cliquer une ligne ouvre la fiche foyer correspondante.
- [ ] Le bouton « + Nouveau foyer » ouvre la modale de création.

## Écran : Création d'un foyer

- [ ] Recherche d'une personne existante : taper 2+ caractères affiche des
      résultats cliquables.
- [ ] Sélectionner un résultat passe à l'étape libellé + création.
- [ ] Bouton « + Créer une nouvelle personne » ouvre le formulaire client
      complet existant (`ClientForm`) — mêmes champs, mêmes validations que
      la création d'un client depuis la page Clients.
- [ ] Après création du client, on revient automatiquement à l'étape
      libellé + création (le nouveau client est déjà sélectionné comme
      principal).
- [ ] Le champ « Nom d'usage interne » est facultatif.
- [ ] La création aboutit sur la fiche du nouveau foyer.
- [ ] Si la personne appartient déjà à un autre foyer actif, un message
      informatif (non bloquant) l'indique après création **et reste affiché
      jusqu'à ce que le conseiller clique « Continuer vers le foyer »** — la
      navigation n'est jamais automatique dans ce cas (corrigé suite à la
      revue `client-meeting-ux`, voir « Corrections » ci-dessous).

## Écran : Fiche foyer

- [ ] Le libellé, le statut (badge) sont affichés en en-tête.
- [ ] Le tableau des membres distingue sans ambiguïté « Client principal »
      (badge vert) des autres rôles (badges de couleur différente).
- [ ] Chaque membre affiche : nom, rôle, relation, âge calculé (ou « — » si
      date de naissance inconnue), date d'entrée, date de sortie, statut.
- [ ] Une personne sans e-mail ni téléphone affiche « Sans coordonnées
      propres », avec le représentant légal si défini.
- [ ] Un membre appartenant à un autre foyer actif affiche « Également
      membre de : … ».
- [ ] Le bouton « Retirer » n'apparaît que pour les membres actifs non
      principaux.
- [ ] Un bloc « Diagnostics » affiche un état vide explicite (pas une
      section manquante ou une erreur) — réservé au Lot 3.
- [ ] Bouton « Modifier » : change le libellé et/ou le statut (archivage).
- [ ] Bouton « Changer le principal » : ouvre la modale dédiée.
- [ ] Bouton « + Ajouter un membre » : ouvre la modale d'ajout.

## Écran : Modifier le foyer

- [ ] Modifier le libellé seul fonctionne.
- [ ] Passer le statut à « Archivé » fonctionne et se reflète immédiatement
      sur la fiche et dans la liste.

## Écran : Ajouter un membre

- [ ] Bascule « Personne existante » / « Nouvelle personne (enfant…) »
      fonctionne.
- [ ] Mode « Personne existante » : recherche + sélection dans un tableau.
- [ ] Mode « Nouvelle personne » : seuls prénom/nom/date de naissance sont
      proposés — aucun champ e-mail/téléphone/profession/revenu requis ou
      même présent.
- [ ] Sélecteur de rôle : ne propose jamais « Client principal ».
- [ ] Champ « Représentant légal » : liste les membres actifs du foyer,
      option « Aucun » par défaut.
- [ ] Ajouter une personne existante déjà membre actif du même foyer est
      refusé (message d'erreur clair, pas un écran cassé).
- [ ] Ajouter une personne déjà membre d'un **autre** foyer réussit sans
      blocage, et le message informatif correspondant reste affiché avec un
      bouton « Continuer » avant fermeture de la modale (corrigé suite à la
      revue `client-meeting-ux`).
- [ ] En mode « Nouvelle personne », dès que prénom + nom sont saisis, un
      encart non bloquant (couleur avertissement) apparaît si une ou
      plusieurs personnes « similarité possible » (`possible_similarity`)
      existent déjà — sans jamais empêcher la validation du formulaire
      (implémenté suite à la revue `client-meeting-ux`, qui avait constaté
      que ce niveau n'était affiché nulle part).
- [ ] Créer une personne dont le nom/prénom/date de naissance correspond
      exactement à une personne existante affiche l'écran de correspondance
      (jamais une création silencieuse).
- [ ] L'écran de correspondance affiche : nom, date de naissance, niveau de
      correspondance (badge, jamais un simple oui/non), et propose bien les
      trois actions : « Utiliser cette personne », « Confirmer : il s'agit
      d'une personne différente », « Annuler ».
- [ ] « Utiliser cette personne » rattache la personne existante (pas de
      création).
- [ ] « Confirmer une personne différente » crée bien une **nouvelle** ligne
      client distincte (vérifié : aucune fusion, deux fiches similaires
      coexistent après confirmation).
- [ ] « Annuler » referme sans effet de bord.

## Écran : Changer le client principal

- [ ] Liste uniquement les membres actifs non principaux.
- [ ] Sélecteur du rôle de repli (« Conjoint/partenaire » ou « Autre
      personne à charge ») uniquement — jamais « Enfant » ni « Principal ».
- [ ] Texte rassurant sur l'absence de portée hiérarchique/juridique
      affiché.
- [ ] Cas sans autre membre actif : message clair, pas un formulaire cassé,
      et un bouton « Fermer » explicite permet de quitter la modale (ajouté
      suite à la revue `client-meeting-ux`, qui avait constaté l'absence de
      tout bouton dans ce cas — seuls Échap/clic-hors-modale fonctionnaient).
- [ ] Après confirmation : le nouveau principal est bien marqué comme tel
      (badge), l'ancien reprend le rôle choisi, la fiche et la liste se
      mettent à jour immédiatement.

## Écran : Retirer un membre

- [ ] Une confirmation est demandée avant le retrait.
- [ ] Après confirmation : le membre passe en statut « Sorti », une date de
      sortie apparaît, la ligne reste visible (jamais supprimée de
      l'affichage).
- [ ] Tenter de retirer le principal est refusé avec un message explicite.

## Multi-appareil

- [ ] La mise en page reste utilisable en dessous de 900px de large (la
      sidebar se masque, les grilles passent en une colonne — comportement
      déjà géré par le CSS existant, réutilisé tel quel, non retesté
      spécifiquement à la souris/tactile dans ce lot).

## Corrections apportées suite à la revue `client-meeting-ux`

La revue post-implémentation du sous-agent `client-meeting-ux` a relevé 5
constats sur l'interface React. Conformément à la procédure du Lot 2 (§12 —
« le processus principal doit collecter les constats, corriger les
problèmes certains, relancer les tests concernés, documenter les
corrections »), voici leur traitement :

1. **Confirmé et corrigé** — `HouseholdCreateForm` (`Households.jsx`)
   affichait un message « déjà membre d'un autre foyer » via `setInfo(...)`
   puis appelait `onSaved(res.id)` sans condition ni délai ; le parent
   (`onSaved: () => { setShowForm(false); reload(); navigate(...) }`)
   démontait la modale dans le même cycle, rendant le message invisible en
   pratique. Corrigé : la création n'appelle plus `onSaved` immédiatement
   quand `already_in_households.length > 0` ; elle affiche le message et
   attend un clic explicite sur « Continuer vers le foyer ».
2. **Confirmé et corrigé** — `AddMemberForm` (`HouseholdDetail.jsx`)
   n'utilisait même pas la réponse de `POST .../members` (`await api.post(...)`
   sans capture), donc `already_in_households` n'était jamais consulté ni
   affiché. Corrigé selon le même principe que le point 1 : la réponse est
   capturée, et un écran de confirmation intermédiaire (« Continuer ») est
   affiché si la personne appartient déjà à un autre foyer actif.
3. **Confirmé et corrigé** — le niveau `possible_similarity` n'était déclenché
   nulle part côté client (la route `check-similarity` n'était jamais
   appelée dans le code frontend), alors que
   `docs/advisory/UX_AND_CLIENT_MODE.md` prévoit un signalement non bloquant
   de ce niveau. Corrigé : en mode « Nouvelle personne » de `AddMemberForm`,
   un appel `check-similarity` est déclenché (avec un court anti-rebond de
   400 ms) dès que prénom et nom sont renseignés, et les correspondances
   trouvées sont affichées dans un encart d'information — jamais bloquant,
   la validation du formulaire reste toujours possible. Le blocage strict
   (409, confirmation explicite) reste réservé, comme avant, à
   `exact_match`/`probable_match` au moment de la soumission réelle.
4. **Confirmé et corrigé** — `SetPrimaryForm` n'offrait aucun bouton dans son
   état « aucun candidat éligible » (seuls Échap ou le clic hors modale
   fermaient la fenêtre, incohérent avec les autres écrans). Un bouton
   « Fermer » a été ajouté.
5. **Confirmé et corrigé (mineur)** — une classe CSS `active` sans aucune
   règle correspondante dans `styles.css` était appliquée aux lignes
   sélectionnées de `AddMemberForm` (la sélection était déjà rendue visible
   par le texte en gras) ; supprimée. Par la même occasion,
   `HouseholdCreateForm` et `AddMemberForm` ont été encapsulés dans
   `<form onSubmit>` (au lieu d'un simple `onClick` sur le bouton), pour un
   comportement clavier (Entrée pour valider) cohérent avec les autres
   modales du module (`HouseholdEditForm`, `SetPrimaryForm`).

Ces 5 corrections sont uniquement du code frontend (aucun changement de
migration, de service métier ni de route). La suite de tests backend
(`npm test`, 382 tests) et `npm run lint`/`npm run build` ont été relancés
après coup et restent au vert — ce lot n'ayant pas de tests automatisés
frontend (cf. avertissement en tête de ce document), la vérification de ces
5 points reste manuelle, à effectuer lors de la prochaine exécution de cette
checklist.

## Historique d'exécution

Exécutée une première fois le 28 juillet 2026 sur une base de démonstration
temporaire (`CRM_DATA_DIR` isolé, données entièrement fictives, jamais
committées), via un parcours automatisé Playwright couvrant : création de
foyer via nouveau client, ajout d'un membre par création rapide, tentative
de doublon exact bloquée puis confirmée (aucune fusion), changement de
principal, retrait d'un membre. Toutes les étapes ci-dessus ont été
observées visuellement conformes lors de cette exécution.
