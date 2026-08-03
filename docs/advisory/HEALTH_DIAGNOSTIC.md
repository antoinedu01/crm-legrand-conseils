# Parcours Assurance Maladie

> **Statut (LOT 5 phase 1)** : un premier noyau réel (9 questions, 5 règles)
> est désormais provisionné en **brouillon, non publié** — voir
> `HEALTH_LOT5_CONTENT.md`. Ce document reste la proposition de conception
> complète (26 sections) ; seul un sous-ensemble restreint en est
> implémenté à ce stade, le reste demeure une proposition non réalisée.

> Proposition de conception (LOT 1). Décrit le contenu métier du
> questionnaire et les analyses attendues, en s'appuyant sur le moteur
> générique (`QUESTIONNAIRE_ENGINE.md`) et le moteur de règles
> (`RULES_ENGINE.md`). Aucune règle ni aucun seuil cité ici n'est une
> vérité réglementaire figée — tout doit être vérifié et sourcé avant
> passage en `status = valide` (voir `RULES_ENGINE.md` §6). **Aucune
   recommandation liée à un assureur précis n'est codée dans ce parcours.**

## 1. Sections proposées

| Section | Portée | Contenu |
|---|---|---|
| Personnes à assurer | membre | qui, dans le foyer, est concerné par ce diagnostic |
| Canton et commune | membre | déjà porté par `clients.canton`/`clients.city` — le questionnaire **lit** ces champs plutôt que de les redemander ; ne pose une question que si l'information est absente sur la fiche |
| Situation d'affiliation | membre | assuré actuellement où, depuis quand, changement récent |
| Assurance actuelle | membre | compagnie actuelle (texte libre ou lien vers `companies` si déjà partenaire), depuis quand |
| Primes actuelles | membre | montant mensuel déclaré |
| Franchise | membre | franchise actuelle si connue (peut recouper `contract_lamal.deductible` si un contrat existe déjà dans le CRM — lecture, jamais redemande une valeur déjà connue sans la confirmer) |
| Modèle LAMal | membre | standard, médecin de famille, HMO, télémédecine, pharmacie, autre — mêmes catégories que `contract_lamal.care_model` existant, pour cohérence de vocabulaire |
| Consommation médicale habituelle | membre | fréquence de recours, pas de contenu médical détaillé |
| Capacité financière | foyer/membre | capacité à absorber une franchise plus élevée en cas de besoin de soins |
| Liberté de choix | membre | importance de choisir librement médecin/établissement |
| Médecin de famille | membre | a un médecin de famille référent ou non |
| Télémédecine | membre | ouverture à un modèle télémédecine |
| Hospitalisation | membre | division souhaitée (commune, semi-privée, privée), zone géographique |
| Médecines alternatives | membre | recours actuel ou souhaité |
| Physiothérapie | membre | fréquence de recours |
| Lunettes | membre | port de lunettes/lentilles, fréquence de renouvellement |
| Dentaire | membre | soins réguliers, orthodontie pour un enfant |
| Prévention | membre | recours à des prestations de prévention (fitness, checkup) |
| Sport | membre | pratique sportive, licence, risque associé |
| Transport et sauvetage | foyer | besoin perçu de couverture transport/sauvetage |
| Voyage | foyer | fréquence des voyages, couverture actuelle |
| Maternité | membre | projet ou grossesse en cours (question posée avec tact, jamais obligatoire) |
| Besoins des enfants | membre (role=enfant) | orthodontie, lunettes, activités spécifiques |
| Budget | foyer | budget mensuel indicatif acceptable pour l'ensemble des primes du foyer |
| Priorités | foyer | classement des priorités exprimées par le foyer |
| Échéances | membre | date de résiliation possible du contrat actuel (délai légal à respecter — voir avertissement type ci-dessous) |
| Informations manquantes | — | récapitulatif automatique, pas une section posée au client |

## 2. Lecture des données existantes avant de reposer la question

Avant d'afficher une question, le moteur de questionnaire vérifie si la
donnée existe déjà :
- `clients.canton`, `clients.city` → pré-remplissent, ne redemandent pas.
- `contracts` où `branch = 'lamal'` et `contract_lamal.*` existants pour ce
  `client_id` → pré-remplissent franchise, modèle, couverture accident ; le
  conseiller **confirme** plutôt que ressaisit.
- Cette règle vaut aussi entre deux diagnostics successifs du même foyer :
  une information déjà connue d'une session antérieure du même domaine peut
  être proposée en pré-remplissage, à confirmer plutôt qu'à ressaisir en
  entier (détail d'implémentation, Lot 5).

## 3. Résultat attendu du parcours

À l'issue du questionnaire et de l'exécution du moteur de règles, le
parcours doit produire :

1. **Résumé du profil** — foyer et par personne, factuel (pas d'hypothèse
   présentée comme fait).
2. **Besoins prioritaires** — `advisory_findings` de type `besoin_detecte`,
   triés par `priority`.
3. **Protections existantes** — lues depuis `contracts`/`contract_lamal`,
   affichées sans duplication de données.
4. **Lacunes** — `advisory_findings` de type `lacune`, chacune reliée à la
   protection existante (ou absente) qui la justifie.
5. **Questions suivantes recommandées** — questions du questionnaire non
   encore répondues mais dont une condition d'affichage les rend pertinentes
   (ex. clarifications déclenchées par une réponse « inconnue »).
6. **Orientations de stratégie** — `advisory_recommendations` à l'état
   `envisagee`, par catégorie de solution (jamais par produit).
7. **Risques et compromis** — `warnings`/`contraindications` des règles
   déclenchées (ex. changement de modèle impliquant un délai de résiliation).
8. **Éléments à vérifier avant toute proposition** — `missing_data` agrégées
   de toutes les règles évaluées pour cette session.
9. **Rapport compréhensible pour le client** — projection filtrée (voir
   `UX_AND_CLIENT_MODE.md`, `REPORT_SPECIFICATION.md`).

## 4. Avertissements types (catégories, pas de texte réglementaire figé)

- Délai de résiliation légal à respecter avant tout changement d'assureur
  de base — **date exacte et formulation à faire valider par un spécialiste
  métier avant toute mise en production** (marqué comme point de validation
  juridique/métier, voir `SECURITY_PRIVACY.md` §20).
- Questionnaire de santé éventuel pour une complémentaire (LCA) — le module
  ne collecte et n'affiche **aucun contenu médical détaillé** ; il se limite
  à signaler qu'une acceptation médicale peut être requise, cohérent avec la
  restriction déjà appliquée à `contract_lca` (statuts administratifs
  uniquement, cf. `docs/CONTRATS_ASSURANCE_SUISSE.md`).

## 5. Ce que ce parcours ne fait jamais

- Ne calcule ni n'affiche une prime chiffrée d'un produit réel (aucun
  comparateur de primes officiel n'est intégré dans cette version).
- Ne code aucune préférence ou recommandation en faveur d'une compagnie
  particulière.
- Ne transforme jamais une réponse « inconnue » en valeur par défaut
  silencieuse dans le calcul des règles.
