# Review conformité — SEO-001 — v2

Document interne.
Review conformité ciblée sur la version SEO-001 v2 déjà validée sur le plan SEO.
Cette review ne constitue pas une validation humaine.
Aucune publication n'est autorisée par ce document.

---

## Identification

- **ID :** SEO-001
- **Fichier audité :** `marketing-ai/seo/articles/seo-001-changer-caisse-maladie-v2.md`
- **Version :** v2
- **Statut avant review :** review SEO validée (`seo_review` = validé)
- **Reviewer :** compliance-reviewer
- **Date :** 23/07/2026
- **Base légale/interne de contrôle :** `CLAUDE.md` §4, §6bis, §6ter, §6quater (branche `feature/marketing-ai-90-days`) ; règles éditoriales du brief SEO-001

> **Nature de cette review.** Contrôle de conformité interne au regard des
> règles de communication de Legrand Conseils Sàrl. Ce n'est ni un avis
> juridique, ni une certification ou approbation FINMA.

---

## Tableau des contrôles

| # | Critère | Résultat | Constat | Passage concerné |
|---|---|---|---|---|
| 1 | Ton neutre, pédagogique, fondé sur le conseil | **Conforme** | Registre pratique et pédagogique de bout en bout ; se conclut par une offre d'accompagnement, pas une injonction | Ensemble du texte ; « Quand demander un accompagnement ? » |
| 2 | Aucune compagnie d'assurance dénigrée | **Conforme** | Aucun assureur nommé nulle part dans le texte — uniquement des termes génériques (« votre assureur », « votre caisse ») ; aucun dénigrement possible en l'absence de toute mention nominative | Ensemble du texte |
| 3 | Aucune affirmation présentant une solution comme universellement meilleure | **Conforme** | Aucune formulation de type « meilleur »/« meilleure » ; recherche explicite des formulations interdites déjà effectuée en Phase 2K/2L, aucune occurrence | Ensemble du texte |
| 4 | Aucune promesse de résultat, d'économie ou d'acceptation | **Conforme** | Garanties explicitement écartées à plusieurs reprises : « ne constitue pas... une garantie de continuité de couverture en toutes circonstances », « ne garantit donc pas, en soi, qu'elle parvienne à temps » | l.97-98 (« Inscription parallèle ») ; l.140-142 (« Moyen d'envoi recommandé ») |
| 5 | Aucun chiffre non sourcé ou trompeur | **Conforme** | Toutes les dates citées (30 novembre, 31 octobre, 15 novembre, 1er janvier) et la référence légale (art. 7 LAMal) sont tracées dans la « Traçabilité interne des sources » avec statut Validé ou Validé avec nuance ; aucun chiffre nouveau par rapport à v1 | Section « Traçabilité interne des sources » |
| 6 | Aucune sollicitation assimilable à du démarchage à froid | **Conforme** | Contenu de type « pull » (article consulté volontairement) ; CTA facultatif et non répété de façon insistante (« sans obligation ni engagement de votre part », « sans engagement de souscription ») | « Quand demander un accompagnement ? » ; conclusion |
| 7 | Consentement explicite prévu lorsque des coordonnées sont collectées | **Conforme (sans objet direct)** | Aucun formulaire ni mécanisme de collecte de coordonnées n'est intégré dans l'article lui-même ; le CTA renvoie vers un marqueur `[LIEN INTERNE — page contact]` non finalisé — le consentement relève de la page de contact elle-même, hors périmètre de ce contenu | l.203 |
| 8 | Aucune collecte ou demande de données médicales sensibles | **Conforme** | Interdiction explicite inscrite dans le texte lui-même : « Aucune information de santé ne doit être transmise dans le cadre de la lecture de cet article » | « Sélection ou questionnaire médical », l.171-172 |
| 9 | Aucune formulation trompeuse sur l'indépendance ou le statut de l'intermédiaire | **Conforme (sans objet direct)** | Le texte ne mentionne à aucun moment le statut FINMA, l'indépendance ou une quelconque habilitation — aucune formulation trompeuse possible en l'absence de toute mention. À noter pour une version future : si ce sujet est ajouté, il devra reprendre exactement le libellé prévu par `CLAUDE.md` §6quater | Ensemble du texte (absence de mention) |
| 10 | Première personne du singulier (« je », « mon », « ma ») | **Conforme** | « Je peux vous aider à faire le point... » et « Je peux vous aider à vérifier les délais... » ; aucun « nous »/« notre »/« nos » institutionnel détecté (recherche déjà effectuée en Phase 2I/2K) | l.200-202 ; l.283-284 |
| 11 | Appel à l'action clair, proportionné, non agressif | **Conforme** | CTA unique répété deux fois sous une forme quasi identique, toujours conditionnel et volontaire, jamais pressant | « Quand demander un accompagnement ? » ; conclusion |
| 12 | Aucune formulation laissant penser à une recommandation personnalisée sans analyse individuelle | **Conforme** | C'est le point le plus systématiquement traité du texte : « à titre de précaution pratique plutôt que comme une liste légale exhaustive », « ce point n'est pas traité de façon exhaustive ici et gagne à être vérifié individuellement », « Il n'est pas possible d'affirmer de façon générale comment ces conditions s'appliquent à votre situation », « une analyse propre à votre dossier est préférable à une règle générale » | l.104-106 ; l.160-162 ; l.167-169 ; l.271-272 |
| 13 | Aucune publication automatique | **Conforme** | Bandeau interne : « Publication : interdite sans nouvelle review SEO, review conformité et validation humaine » ; checklist interne, case « aucune publication effectuée » non cochée (exact, conforme à la réalité) | l.6 ; checklist finale |
| 14 | Validation humaine maintenue comme étape obligatoire | **Conforme** | Le bandeau, le journal des corrections et la checklist interne renvoient tous explicitement vers une validation humaine à venir, jamais présentée comme faite | l.6 ; checklist, dernières lignes |

---

## Verdict conformité

**Verdict : conforme**

**Décision : compliance_review = validé.**

**Résumé :** Les 14 points de contrôle sont conformes. Le texte ne mentionne aucun assureur nommément, ne fait aucune promesse de résultat ni d'économie, distingue systématiquement le principe général de la situation individuelle, et refuse explicitement de traiter comme certains les points encore marqués « à compléter » dans la traçabilité SEO (arriérés, distinction LCA complète, sélection médicale, exceptions individuelles). Deux points (7 et 9) sont conformes par absence de toute formulation sur le sujet plutôt que par une formulation active correcte — cela reste une conformité réelle mais mérite d'être revérifié si le contenu final ajoute une mention de contact directe ou une référence au statut FINMA. Aucune non-conformité n'a été trouvée ; aucune correction n'est proposée. Cette review ne remplace pas la validation humaine, qui reste entièrement à faire avant toute publication.
