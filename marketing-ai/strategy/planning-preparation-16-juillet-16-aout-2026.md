# Planning de préparation — 16 juillet au 16 août 2026

> Brouillon marketing (LOT 2B). Planning **réaliste** pour préparer, d'ici le
> lancement (17/08), tout ce qui doit être confirmé, créé ou configuré. Rédigé le
> 16/07/2026. Coordination : `marketing-director`.
> **Aucune modification technique du site/CRM/Analytics dans ce lot** : les tâches
> techniques sont décrites comme **actions humaines à réaliser hors de ce lot**.
> Statut initial de toutes les tâches : **`À faire`**.
> Responsables : Humain = Antoine ; Dev = intervenant technique site ; Graph =
> graphiste ; CR/PA/MD = agents marketing (specs/brouillons uniquement).
> Le 16/07/2026 est un **jeudi** ; la 1re semaine est donc courte (jeu → dim).

---

> **Note de démarrage (mise à jour 17/07/2026)** : la période générale reste **16
> juillet → 16 août 2026**, mais l'**exécution opérationnelle commence le 17 juillet
> 2026**. Les éventuelles tâches prévues le 16 juillet sont **reportées dans la
> fenêtre du 17 au 19 juillet** (Semaine 1). La **date finale du 16 août reste
> inchangée**. Le calendrier n'est **pas** décalé d'un jour.

## Semaine 1 — 16 au 19 juillet (exécution effective 17 → 19 juillet)
- **Objectif** : lancer la préparation et débloquer les points juridiques.
- **Tâches** :
  1. Réunir les **informations d'entreprise** (coordonnées, adresse, e-mail pro).
  2. Lancer la **vérification FINMA** (n° d'enregistrement, inscription au registre public).
  3. Rassembler les **éléments de charte** (logo, couleurs, typographies) ou décider de leur création.
  4. Lister les **pages du site existantes** et leurs URL réelles.
- **Responsable** : Humain (Dev en appui pour les URL).
- **Dépendances** : aucune.
- **Durée estimée** : ~4–5 h.
- **Validation nécessaire** : Humain.
- **Livrable** : informations d'entreprise réunies + point FINMA engagé.
- **Statut** : `À faire`.

## Semaine 2 — 20 au 26 juillet
- **Objectif** : sécuriser l'identité et le socle juridique.
- **Tâches** :
  1. **Confirmer** les informations d'entreprise et la **formulation exacte du statut** d'intermédiaire (avec CR).
  2. **Vérifier l'inscription FINMA** (dossier déclaré validé) : présence et données actuelles au registre public — **à confirmer avant diffusion**.
  3. Récupérer/valider la **charte visuelle existante** (logo/couleurs/typos + droits) et **briefer le graphiste**.
  4. **Vérifier et, si besoin, mettre à jour** la **page Protection des données** et les **mentions légales** (existence déclarée) — **à confirmer avant diffusion**.
- **Responsable** : Humain + CR ; Graph pour la charte.
- **Dépendances** : S1 (infos + FINMA).
- **Durée estimée** : ~6–8 h.
- **Validation nécessaire** : Humain + CR.
- **Livrable** : statut confirmé ; charte validée ; brouillons politique de conf. + mentions.
- **Statut** : `À faire`.

## Semaine 3 — 27 juillet au 2 août
- **Objectif** : verrouiller les URL, les pages et le formulaire (spéc.).
- **Tâches** :
  1. **Confirmer les URL** cibles (page Contact + décider des pages à créer : 3e pilier, prévoyance, ressources, bilan, téléchargement, remerciement).
  2. **Finaliser la vérification/mise à jour** de la page Protection des données et des mentions légales (validation CR/Humain).
  3. Préparer la **spécification du formulaire** (champs, consentements, e-mail transactionnel, rétention) — prête à implémenter.
  4. Confirmer l'accès aux **réseaux sociaux** (profils, admin, 2FA).
- **Responsable** : Humain + Dev + CR.
- **Dépendances** : S2 (charte, statut, juridique).
- **Durée estimée** : ~6–8 h.
- **Validation nécessaire** : Humain + CR.
- **Livrable** : registre des URL confirmé ; juridique finalisé ; spéc. formulaire prête.
- **Statut** : `À faire`.

## Semaine 4 — 3 au 9 août
- **Objectif** : créer les pages, le formulaire et les supports visuels.
- **Tâches** (actions techniques = **humaines, hors de ce lot marketing**) :
  1. **Créer/valider les pages** nécessaires (Dev), avec politique de conf. et mentions liées.
  2. **Créer le formulaire** du guide (champs minimaux, consentements séparés non pré-cochés) + page de remerciement + e-mail transactionnel.
  3. **Concevoir les supports** : gabarits LinkedIn / carrousel / story / reel, miniature, flyer (imprimé + numérique), couverture et visuels du guide.
  4. Finaliser les **profils sociaux** (photo, bannière, bio, lien site).
- **Responsable** : Dev (pages/formulaire) ; Graph (visuels) ; Humain (profils).
- **Dépendances** : S3 (URL, juridique, spéc. formulaire, charte).
- **Durée estimée** : ~10–14 h (réparties).
- **Validation nécessaire** : Humain + CR (formulaire/consentements).
- **Livrable** : pages en ligne, formulaire fonctionnel, supports visuels prêts, profils complets.
- **Statut** : `À faire`.

## Semaine 5 — 10 au 16 août
- **Objectif** : produire le guide PDF, tout tester, préparer la programmation manuelle.
- **Tâches** :
  1. **Créer le guide en PDF** (mise en page depuis le brouillon validé) + couverture.
  2. **Tester le téléchargement** (formulaire → e-mail → PDF) et la **délivrabilité**.
  3. **Tester les UTM** (liens taggés → GA4) et les **événements** (`form_start`, `generer_lead`, téléchargement).
  4. **Tester sur mobile** l'ensemble du parcours (pages, formulaire, remerciement).
  5. Générer le **QR code** du flyer **une fois l'URL confirmée**.
  6. **Relecture finale** de chaque contenu via `../templates/checklist-finale-avant-publication.md` + validation conformité + validation humaine.
  7. **Programmation manuelle** des premiers contenus (semaine 17→23/08), **par un humain**, après validation finale.
- **Responsable** : Humain + Dev + PA + CR.
- **Dépendances** : S4 (pages, formulaire, supports).
- **Durée estimée** : ~8–12 h.
- **Validation nécessaire** : Humain + CR (validation finale obligatoire avant toute programmation).
- **Livrable** : guide PDF + parcours testé + contenus validés + programmation manuelle prête.
- **Statut** : `À faire`.

---

## Points de vigilance
- Les **vérifications juridiques prioritaires** (statut FINMA/registre public,
  page Protection des données, mentions légales — **existence déclarée par le
  dirigeant, à confirmer**) doivent être traitées en **priorité (S1–S3)** : tant
  qu'elles ne sont pas confirmées, ni le flyer, ni le formulaire, ni les posts à
  CTA ne peuvent être diffusés.
- Toute **modification du site, du formulaire, d'Analytics ou du CRM** est une
  **action humaine réalisée hors de ce lot** : ce planning la décrit, ne l'exécute
  pas.
- La **programmation** reste **manuelle** et n'intervient qu'après **validation
  humaine finale**. Aucune publication automatique.
