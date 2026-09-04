# Découpage en lots — Développement de portefeuille (02/09/2026)

> Suite à `EXPLORATION_DEVELOPPEMENT_PORTEFEUILLE.md` et à vos décisions sur
> les 4 points ouverts. **Aucun code n'a été écrit pour produire ce
> document.** Chaque lot ci-dessous attend votre feu vert individuel avant
> d'être codé — approbation lot par lot, pas un bloc global.

---

## Décisions actées (rappel, pour référence)

1. Fenêtre d'échéance : 90 jours, uniforme, pas de différenciation par
   branche.
2. Pas de cadence de revue automatique (`review_next_date` non activé en
   v1) — seulement échéances réelles + manques mono-produit.
   `review_last_date` peut être utilisé comme simple horodatage de suivi
   (voir Lot 2), sans logique de planification automatique.
3. Raisonnement au niveau client individuel, pas foyer.
4. Seuils de prime annuelle par branche pour la priorisation : LCA/LAMal
   dès CHF 1'500/an, Vie/3a-3b dès CHF 4'000/an.

---

## Lot 1 — Généraliser la détection mono-produit (santé ↔ prévoyance)

### Ce qui change
Deux nouveaux blocs dans `server/routes/today.js`, sur le modèle exact du
bloc `crossSell`/`vente_complementaire` déjà en production (lignes
195-216) :
- **`manque_prevoyance`** : client `particulier`/`client` avec au moins un
  contrat actif `lamal` ou `lca`, aucun contrat actif `vie_3a`/`vie_3b`.
- **`manque_sante`** : symétrique — contrat actif `vie_3a`/`vie_3b`, aucun
  `lamal`/`lca` actif.

Priorité `basse` pour ce lot (comme la règle `incapacite` existante) — la
priorisation par seuil arrive au Lot 3, pas mélangée ici pour garder le
lot petit et testable isolément. Même mécanisme de dé-doublonnage
(`recentlyLogged`, fenêtre à discuter — je proposerais 180 jours, comme
`vente_complementaire`).

**Aucune modification de la règle `incapacite` existante** — elle continue
de fonctionner exactement comme aujourd'hui, en parallèle.

### Fichiers touchés
- `server/routes/today.js` (~35-45 lignes ajoutées, 2 blocs de requête +
  push d'action, aucune ligne existante modifiée)
- Nouveau fichier de test dédié (ex. `test/today-cross-sell-portfolio.test.js`)
  — **constat fait pendant l'exploration** : ni `vente_complementaire` ni
  `anniversaire_contrat` n'ont de test aujourd'hui. Ce lot ajoute donc les
  premiers tests de ce pattern, pas seulement pour les deux nouveaux cas.

### Risque
**Faible.** Aucune migration, aucune colonne nouvelle, lecture seule sur
`contracts`/`clients` déjà indexés (`idx_contracts_branch_status` existe
depuis la migration 8). Pattern déjà éprouvé en production pour
`incapacite` — c'est une généralisation, pas une nouveauté technique.

### Estimation
Petit — de l'ordre d'une demi-journée de travail effectif (règle + tests
+ vérification lint/build/tests complet, comme pour le correctif durée
Vie).

---

## Lot 2 — Rendre les échéances actionnables dans le plan du jour

### Ce qui change
Nouveau bloc `today.js` (type d'action `echeance_contrat`), sur le modèle
du bloc `anniversaire_contrat` déjà en place :
```
status = 'actif' AND end_date IS NOT NULL AND end_date <= date('now', '+90 days')
```
Priorité provisoire pour ce lot : purement basée sur le nombre de jours
restants (ex. < 30 jours → `haute`, sinon `normale`) — indépendante des
seuils de prime du Lot 3, sauf si vous préférez les combiner ; à confirmer
au moment d'approuver ce lot précisément.

**Le widget dashboard « Échéances sous 90 jours » n'est pas touché** — il
reste un coup d'œil rapide et informatif ; le plan du jour devient la
version sur laquelle on agit. Décision volontaire pour garder ce lot
petit ; une fusion des deux vues pourrait être un lot séparé plus tard si
la duplication vous gêne à l'usage.

**Sur `review_last_date`** (branchement optionnel de ce lot, à valider avec
vous) : quand vous loguez un résultat sur une action `echeance_contrat`
via le mécanisme déjà existant `POST /api/today/result`, la date du jour
serait écrite dans `contracts.review_last_date` pour ce contrat précis —
un simple horodatage « dernière fois que ce contrat a été traité depuis le
plan du jour », jamais une planification automatique, jamais un envoi.
`review_next_date` reste totalement inutilisé, conformément à votre
décision n°2. Dites-moi si vous voulez ce petit ajout dans ce lot ou si
vous préférez l'exclure pour l'instant.

### Fichiers touchés
- `server/routes/today.js` (~25-30 lignes pour le nouveau bloc de requête,
  + 1-2 lignes dans le handler `POST /result` si vous validez l'écriture
  de `review_last_date`)
- Nouveau fichier de test (ex. `test/today-contract-expiry.test.js`)

### Risque
**Faible à moyen.** Toujours aucune migration — les colonnes existent déjà
depuis la migration 8. Le seul point qui mérite une vraie attention en
test : si vous validez l'écriture de `review_last_date`, un test dédié
doit confirmer qu'elle ne se déclenche **jamais** en dehors de ce cas
précis (action de type `echeance_contrat`, résultat explicitement logué
par vous).

### Estimation
Petit à moyen — un peu plus que le Lot 1 à cause du chemin d'écriture
optionnel.

---

## Lot 3 — Priorisation par seuils de prime annuelle, par branche

### Ce qui change
Modifie les deux requêtes du Lot 1 (pas de nouvelle requête) pour
calculer en plus la somme des primes actives du groupe déjà détenu par le
client, et en déduire la priorité :
- **`manque_prevoyance`** (le client a du LAMal/LCA, lui manque du
  3a/3b) : somme des primes LAMal/LCA actives ≥ CHF 1'500/an →
  priorité relevée ; en dessous → `basse`, comme aujourd'hui.
- **`manque_sante`** (le client a du 3a/3b, lui manque du LAMal/LCA) :
  somme des primes 3a/3b actives ≥ CHF 4'000/an → priorité relevée.

Proposition de départ : priorité relevée = `normale` (pas `haute`, réservée
aux échéances proches et aux prospects urgents dans le système actuel) —
à confirmer avec vous au moment d'approuver ce lot.

**Dépend du Lot 1** (modifie ses requêtes) — doit être fait après, jamais
avant ni en parallèle.

### Fichiers touchés
- `server/routes/today.js` uniquement (modification des 2 blocs du Lot 1)
- Tests du Lot 1 étendus pour couvrir les deux côtés du seuil (juste en
  dessous / juste au-dessus, par branche)

### Risque
**Faible.** Même table, même règle, enrichissement de la logique de
priorité seulement — aucune migration, aucun nouveau champ.

### Estimation
Petit — un suivi léger une fois le Lot 1 stable et fusionné.

---

## Ordre et dépendances

```
Lot 1 (mono-produit, priorité basse fixe)
  └── Lot 3 (seuils de priorisation) — dépend du Lot 1

Lot 2 (échéances actionnables + review_last_date optionnel) — indépendant,
peut se faire avant, après ou en parallèle du Lot 1/3
```

## Ce qui reste inchangé dans les trois lots

- Aucun e-mail, SMS ou message n'est jamais envoyé automatiquement.
- Aucune tâche ne se crée sans une action de votre part sur le plan du
  jour (le mécanisme `POST /api/today/result` existant reste la seule
  porte d'entrée, exactement comme pour `vente_complementaire` aujourd'hui).
- Aucune migration, aucune nouvelle table, aucune colonne créée — tout
  repose sur des colonnes déjà présentes depuis les migrations 1/8.
- Chaque lot suit la même discipline que le correctif durée Vie : branche
  isolée depuis la production, lint/tests/build vérifiés indépendamment,
  PR ouverte, fusion et déploiement décidés par vous.

---

**Prochaine étape** : dites-moi quel lot approuver en premier (ou si vous
voulez ajuster l'ordre), et je commence à coder uniquement celui-là.
