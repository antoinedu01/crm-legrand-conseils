# Tableau des KPI — Plan 90 jours (01/08 → 29/10/2026)

> Brouillon marketing (LOT 1). Cadre de mesure pour une **petite structure**.
> Agent contributeur : `performance-analyst` (coordination `marketing-director`).
> **Les objectifs ci-dessous sont prudents et NE SONT PAS garantis.** Ce sont des
> repères de pilotage, pas des promesses de résultat. Les données réelles (GA4,
> réseaux, CRM) sont **fournies par l'humain** ; cet agent n'accède jamais aux
> données clients réelles du CRM.

## Principes de mesure

- **Sources** : GA4 (site), statistiques natives des réseaux (LinkedIn, Instagram,
  Facebook), export/relevé manuel du CRM pour les leads et rendez-vous.
- **Attribution** : paramètres **UTM** sur les liens + champ « source » côté
  formulaire (à **documenter** dans ce lot, à implémenter par un humain — aucune
  modification du CRM ici).
- **Fréquence** : relevé hebdomadaire léger ; rapports consolidés à J14, J30, J60,
  J90.
- **Prudence** : petits volumes = forte variabilité. On lit les **tendances**, pas
  les chiffres isolés.

---

## Indicateurs

Légende objectifs : valeurs **cumulées ou mensuelles** selon l'indicateur,
**prudentes**, à ajuster après les premières données réelles.

### 1. Portée (reach)
- **Définition** : nombre de personnes uniques ayant vu un contenu.
- **Formule** : somme des portées uniques par plateforme (dédupliquée par réseau).
- **Source** : statistiques natives LinkedIn / Instagram / Facebook.
- **Fréquence** : hebdomadaire.
- **Objectifs prudents** : J30 : amorçage mesurable ; J60 : +30–50 % vs J30 ;
  J90 : tendance de croissance régulière. *(Valeurs relatives : la base réelle
  n'est pas encore connue.)*
- **Limites** : dépend de l'algorithme et de la taille d'audience de départ.

### 2. Engagement
- **Définition** : interactions (likes, commentaires, partages, enregistrements).
- **Formule** : taux d'engagement = interactions / portée (ou / impressions).
- **Source** : réseaux sociaux.
- **Fréquence** : hebdomadaire.
- **Objectifs prudents** : établir une **base de référence** au mois 1, puis viser
  une amélioration progressive du taux.
- **Limites** : un « bon » taux varie selon le format et la plateforme.

### 3. Clics vers le site
- **Définition** : clics depuis les réseaux/CTA vers legrandconseils.ch.
- **Formule** : somme des clics sortants (liens taggés UTM).
- **Source** : GA4 (sessions par source) + réseaux.
- **Fréquence** : hebdomadaire.
- **Objectifs prudents** : J30 : premières dizaines de clics ; J60/J90 : croissance
  régulière. *(Repère, non garanti.)*
- **Limites** : écart possible entre clics annoncés par les réseaux et sessions GA4.

### 4. Taux de clic (CTR)
- **Définition** : proportion de vues qui aboutissent à un clic.
- **Formule** : CTR = clics / impressions (ou / portée).
- **Source** : réseaux + GA4.
- **Fréquence** : hebdomadaire.
- **Objectifs prudents** : identifier les formats/CTA au meilleur CTR et les
  privilégier ; viser une amélioration relative.
- **Limites** : sensible au wording du CTA et au ciblage.

### 5. Visites des pages ciblées
- **Définition** : sessions sur les pages clés (3e pilier, LAMal, prévoyance,
  ressources, contact).
- **Formule** : somme des vues de pages ciblées.
- **Source** : GA4.
- **Fréquence** : hebdomadaire.
- **Objectifs prudents** : croissance parallèle aux clics ; identifier les pages
  les plus consultées.
- **Limites** : dépend des pages réellement existantes/créées (hors périmètre LOT 1).

### 6. Téléchargements (lead magnets)
- **Définition** : nombre de ressources téléchargées volontairement.
- **Formule** : somme des téléchargements par ressource.
- **Source** : GA4 (événement) et/ou comptage côté formulaire.
- **Fréquence** : hebdomadaire.
- **Objectifs prudents** : premiers téléchargements dès la mise en ligne du guide ;
  progression avec 2e et 3e ressources.
- **Limites** : un téléchargement n'est pas un lead qualifié.

### 7. Formulaires commencés
- **Définition** : nombre de formulaires initiés (au moins un champ rempli).
- **Formule** : événements « form_start » (à documenter dans le plan de tracking).
- **Source** : GA4 (événement) — implémentation humaine hors LOT 1.
- **Fréquence** : hebdomadaire.
- **Objectifs prudents** : base de référence au mois 1.
- **Limites** : dépend de la mesure d'événements côté site.

### 8. Formulaires terminés
- **Définition** : formulaires soumis avec succès.
- **Formule** : soumissions valides (= leads entrants).
- **Source** : GA4 (événement `generer_lead` existant) + CRM.
- **Fréquence** : hebdomadaire.
- **Objectifs prudents** : premiers leads entrants au cours de la Phase 2/3 ;
  progression maîtrisée. *(Volumes modestes attendus, non garantis.)*
- **Limites** : petits volumes très variables.

### 9. Taux de complétion de formulaire
- **Définition** : proportion de formulaires commencés qui sont terminés.
- **Formule** : terminés / commencés.
- **Source** : GA4.
- **Fréquence** : mensuelle.
- **Objectifs prudents** : réduire la friction pour améliorer ce taux au fil des
  optimisations documentées (Phase 3/4).
- **Limites** : nécessite un volume suffisant pour être fiable.

### 10. Demandes de rendez-vous
- **Définition** : demandes explicites de RDV (formulaire, message volontaire).
- **Formule** : somme des demandes de RDV.
- **Source** : CRM + formulaires.
- **Fréquence** : hebdomadaire.
- **Objectifs prudents** : quelques demandes réparties sur le trimestre ; qualité
  avant quantité.
- **Limites** : dépend fortement de la maturité des prospects.

### 11. Leads qualifiés
- **Définition** : leads correspondant à un persona cible et à un besoin réel.
- **Formule** : leads qualifiés / total leads (taux de qualification).
- **Source** : CRM (qualification humaine).
- **Fréquence** : mensuelle.
- **Objectifs prudents** : privilégier la qualification à la volumétrie.
- **Limites** : jugement humain, critères à stabiliser.

### 12. Source du lead
- **Définition** : canal d'origine de chaque lead (LinkedIn, IG, FB, SEO, direct,
  recommandation, flyer/QR…).
- **Formule** : répartition des leads par source (UTM + champ source).
- **Source** : UTM + CRM.
- **Fréquence** : mensuelle.
- **Objectifs prudents** : identifier les 1–2 canaux les plus efficaces pour y
  concentrer l'effort.
- **Limites** : attribution imparfaite (multi-touch, saisie manuelle).

### 13. Taux de conversion
- **Définition** : proportion de visiteurs/prospects franchissant une étape clé.
- **Formule** : ex. leads / sessions ; RDV / leads.
- **Source** : GA4 + CRM.
- **Fréquence** : mensuelle.
- **Objectifs prudents** : établir une base, puis viser une amélioration relative
  via les optimisations.
- **Limites** : petits volumes → prudence d'interprétation.

### 14. Coût par lead (si publicité)
- **Définition** : dépense publicitaire / nombre de leads issus de la pub.
- **Formule** : budget pub / leads pub.
- **Source** : plateforme publicitaire + CRM.
- **Fréquence** : uniquement **si** une campagne est lancée (après validation
  humaine explicite et budget justifié — Phase 3/4).
- **Objectifs prudents** : à définir lors du cadrage du test ; **aucun engagement
  de coût sans validation humaine**.
- **Limites** : non applicable tant qu'aucune pub n'est active.

### 15. Nombre de rendez-vous
- **Définition** : RDV effectivement tenus.
- **Formule** : somme des RDV réalisés.
- **Source** : CRM / agenda.
- **Fréquence** : mensuelle.
- **Objectifs prudents** : quelques RDV sur le trimestre ; suivi qualitatif.
- **Limites** : dépend de la disponibilité et du cycle de décision.

### 16. Contrats conclus (si l'information est disponible)
- **Définition** : contrats signés attribuables à l'action marketing.
- **Formule** : somme des contrats attribuables.
- **Source** : CRM (information humaine).
- **Fréquence** : mensuelle/à la clôture.
- **Objectifs prudents** : indicateur de résultat de long terme ; le cycle de vente
  en assurance dépasse souvent 90 jours. **Aucun résultat commercial garanti.**
- **Limites** : attribution difficile, délais longs, hors du contrôle du seul
  marketing.

---

## Récapitulatif des objectifs (repères prudents, non garantis)

| Horizon | Priorité de lecture |
|---|---|
| **J30** | Établir les **bases de référence** (portée, engagement, clics, premiers leads). |
| **J60** | Identifier les **canaux et formats performants** ; premières conversions ; arbitrages. |
| **J90** | **Croissance régulière** des indicateurs de haut de funnel ; quelques leads qualifiés et RDV ; décisions pour les 90 jours suivants. |

> **Avertissement** : ces objectifs sont des repères de pilotage prudents. Ils ne
> constituent ni une prévision garantie, ni une promesse de résultat commercial.
> Toute communication externe reprenant un chiffre de performance doit être
> vérifiée et validée par un humain.
