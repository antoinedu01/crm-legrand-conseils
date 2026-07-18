# compliance/ — Contrôle conformité des contenus marketing

Ce dossier reçoit les **rapports de conformité** produits par l'agent
`compliance-reviewer` avant la validation humaine de chaque contenu.

## Rappel essentiel

- **Tout contenu doit être vérifié avant publication.** Aucun brouillon ne va en
  diffusion sans contrôle conformité **puis** validation humaine.
- **Ceci n'est pas un avis juridique.** Les rapports de cet agent sont une aide
  au contrôle interne. Ils ne remplacent pas l'avis d'un juriste, d'un
  fiscaliste ou de l'autorité compétente. En cas de doute :
  **`Vérification humaine obligatoire`**.

## Ce qui est systématiquement contrôlé

- **Promesses interdites** : économie garantie, rendement garanti, acceptation
  d'assurance, « meilleur produit du marché ».
- **Affirmations à vérifier** : toute affirmation juridique, réglementaire,
  fiscale, tarifaire ou liée à un produit d'assurance doit être **sourcée** ou
  marquée pour vérification humaine.
- **Données personnelles (nLPD)** : pas de données médicales sensibles dans un
  formulaire marketing ; pas de scraping ; pas de démarchage à froid automatisé ;
  consentement explicite et versionné pour toute collecte.
- **Ton et marché** : professionnel, humain, pédagogique, non agressif ; adapté à
  la Suisse romande (Vaud/Genève).
- **Neutralité / non-dénigrement** : aucun dénigrement d'une compagnie, d'un
  courtier ou d'un conseiller ; aucune affirmation de supériorité générale ; aucun
  classement public ; comparaisons uniquement objectives, vérifiables et neutres
  (cf. `CLAUDE.md`, section « Neutralité, conseil et non-dénigrement »).
- **Portée FINMA** : l'inscription au registre (intermédiaire non lié, branches
  assurance-maladie complémentaire et assurance-vie) n'est ni une autorisation
  générale, ni un agrément pour la LAMal obligatoire ; jamais « approuvé /
  certifié / conforme FINMA » (cf. `CLAUDE.md` § 6quater).

## Règles internes de conformité — 10 points (nLPD / LSA / FINMA)

> Règles internes prudentielles de Legrand conseils Sàrl. **Ni avis juridique, ni
> certification/approbation FINMA.** En cas de doute : `Vérification humaine obligatoire`.

1. **Aucune donnée réelle de client ou de prospect** transmise à un outil d'IA
   externe (identité, coordonnées, contrats, documents, données financières,
   médicales / de santé).
2. **Uniquement des données fictives, anonymisées ou agrégées.**
3. **Toute exception** = validation humaine documentée (base légale, sous-traitance,
   sécurité, lieu de traitement, transferts hors de Suisse).
4. **Aucun démarchage téléphonique à froid.**
5. **Aucune liste de prospects** par scraping, achat ou collecte non sollicitée.
6. **Aucun téléchargement de guide** n'inscrit automatiquement à une newsletter.
7. **Consentement marketing distinct, explicite, facultatif, jamais pré-coché.**
8. **Aucun conseil personnalisé automatique** ni recommandation de produit définitive.
9. **Affirmation LSA / LAMal / LCA / LPP / fiscalité / primes / rendements /
   rémunérations / prestations** → source + date de vérification, sinon
   `Vérification humaine obligatoire`.
10. **Passage marketing → conseil** = procédures d'intermédiation réglementées
    (LSA / FINMA).

## Cadre de référence

- nLPD (protection des données), LSA / FINMA (intermédiation d'assurance).
- Règles internes : voir `../../CLAUDE.md`.
- Fiche de contrôle : `../templates/content-validation-template.md`.

## Processus

1. Un agent dépose un brouillon dans `marketing-ai/`.
2. `compliance-reviewer` rédige ici un rapport (un fichier par contenu).
3. L'humain lit le rapport, corrige si besoin, puis **valide**.
4. La diffusion est **manuelle**, réalisée par un humain.
