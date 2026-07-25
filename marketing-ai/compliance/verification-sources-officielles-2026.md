# Vérification des sources officielles — Mission 3 (2026)

> Rédigé le 25/07/2026 dans le cadre de la Mission 3
> (`feature/marketing-source-verification-v1`), à la demande explicite
> d'Antoine Legrand. **Contrôle interne prudentiel — ni un avis juridique, ni
> une validation ou certification de la FINMA, de l'OFSP, de l'OFAS, de l'AFC
> ou de toute autre autorité citée.**
>
> Portée : inventaire et vérification des affirmations sensibles identifiées
> dans `marketing-ai/**` (contenus LOT 1, LOT 2A, SEO-001, posts de lancement).
> Aucune publication, aucune programmation, aucune fusion de branche, aucune
> pull request, aucune modification du CRM ou du site n'a été effectuée dans
> le cadre de ce document.

---

## 1. Méthode et limites — transparence sur les tentatives d'accès

Contrairement au dossier `marketing-ai/research/sources-seo-001-changer-caisse-maladie.md`
(23/07/2026, aucun `WebFetch`/`WebSearch` utilisé — sources fournies par
l'humain) et à la revue `marketing-ai/compliance/revue-conformite-lot-2a.md`
(16/07/2026, extraits de recherche seulement, accès direct bloqué), cette
mission a **tenté un accès direct réel** aux pages officielles via `WebFetch`,
avec repli sur `WebSearch` restreint aux domaines officiels lorsque l'accès
direct échouait, conformément au §11 de la mission.

**Résultat des tentatives d'accès direct (`WebFetch`) le 25/07/2026** :
tous les domaines officiels suisses testés — `fedlex.admin.ch`,
`fedlex.data.admin.ch` (y compris le PDF officiel de la LAMal),
`www.admin.ch`, `priminfo.admin.ch`, `bag.admin.ch` (y compris un PDF
officiel), `ch.ch`, `estv.admin.ch`, `bsv.admin.ch`, `finma.ch` — ont renvoyé
**HTTP 403 Forbidden**, sans exception, malgré plusieurs URL et formats
testés (page HTML, PDF direct, sous-domaine alternatif). Ce blocage
reproduit exactement celui déjà documenté le 16/07/2026 dans
`revue-conformite-lot-2a.md` : il s'agit d'une limitation technique de
l'environnement d'exécution, pas d'un choix de ne pas vérifier.

**Repli sur `WebSearch`** : des recherches restreintes aux domaines
officiels (`site:finma.ch`, `site:bsv.admin.ch`, `site:estv.admin.ch`, et des
recherches ciblées pour `bag.admin.ch`/OFSP et Fedlex) ont produit des
**extraits de résultats de recherche**. Conformément au §6 et au §11 de la
mission : **« un extrait de moteur de recherche ne constitue jamais une
validation »**. Ces extraits sont donc utilisés uniquement comme **éléments
de corroboration non probants**, jamais comme validation finale. Aucune
lecture intégrale d'une page officielle n'a été possible durant cette
mission.

**Conséquence appliquée systématiquement** : aucun statut `statut_sources`
n'est relevé à `Validé` (lecture intégrale) sur la seule base des recherches
du 25/07/2026. Le verdict `Non confirmé` (au sens strict : lecture intégrale
non obtenue) est utilisé pour chaque FACT concerné, avec la classification
adaptée décrite au §11 de la mission — **sauf régression injustifiée** :
lorsqu'un contenu était déjà `Validé avec réserves` ou `Prêt pour validation
humaine` sur la base d'un travail humain antérieur documenté (ex. SEO-001,
statut FINMA confirmé par documents officiels transmis le 17/07/2026), ce
statut est **conservé**, faute de tout élément contraire trouvé — conformément
à la consigne explicite « ne fais pas régresser sans raison ».

---

## 2. Inventaire des affirmations sensibles (FACT-001 à FACT-016)

### FACT-001

- **Identifiant :** FACT-001
- **Niveau de risque :** Moyen
- **Thème :** Prévoyance
- **Affirmation :** Le système suisse de prévoyance repose sur trois piliers : le 1er pilier étatique (AVS/AI, besoins vitaux), le 2e pilier professionnel (LPP, maintien du niveau de vie), le 3e pilier privé et facultatif (complément individuel).
- **Fichiers concernés :** `marketing-ai/lead-magnets/guide-pratique-3e-pilier.md` (§1), `marketing-ai/social-media/linkedin/semaine-17-23-aout-2026.md` (Publication 1), `marketing-ai/social-media/reels/reel-semaine-17-23-aout-2026.md`, `marketing-ai/social-media/instagram/semaine-17-23-aout-2026.md` (slide 2).
- **Content IDs concernés :** SOC-LI-003, SOC-RE-001, SOC-IG-001.
- **Autorité :** Office fédéral des assurances sociales (OFAS/BSV) ; ch.ch (portail officiel des autorités suisses).
- **Titre exact de la page ou du document :** Non consulté intégralement (voir §1). Pages ciblées : « Prévoyance professionnelle et 3e pilier – Aperçu » (bsv.admin.ch/fr/lpp-3e-pilier) ; « La prévoyance vieillesse en Suisse » (ch.ch).
- **URL officielle :** https://www.bsv.admin.ch/fr/lpp-3e-pilier ; https://www.ch.ch/fr/retraite/prevoyance-vieillesse/comment-fonctionne-la-prevoyance-vieillesse/
- **Date de consultation :** 25/07/2026 (tentative d'accès direct — échec HTTP 403 ; extrait de recherche uniquement).
- **Date de mise à jour affichée :** Non disponible (accès direct bloqué).
- **Passage utile :** Extrait de recherche (`site:bsv.admin.ch`) confirmant l'existence d'une page officielle intitulée « Prévoyance professionnelle et 3e pilier — Aperçu » décrivant la structure à trois piliers. Contenu de la page non lu intégralement.
- **Ce que la source dit explicitement :** Non déterminé avec certitude (lecture intégrale non obtenue).
- **Interprétation prudente :** La structure à trois piliers (AVS/LPP/3e pilier facultatif) est une donnée structurelle constante du droit suisse de la prévoyance, déjà corroborée le 16/07/2026 par extraits ch.ch (voir `revue-conformite-lot-2a.md`) et de nouveau par extrait BSV le 25/07/2026. Aucun élément trouvé ne contredit cette présentation, qui reste générale, sans chiffre et sans promesse.
- **Ce que la source ne permet pas d'affirmer :** Aucun détail chiffré (cotisations, seuils, coordination LPP/AVS) — non repris dans les contenus, donc sans objet ici.
- **Verdict :** Non confirmé (lecture intégrale non obtenue — extrait de recherche corroborant, insuffisant pour validation stricte au sens du §6/§11).
- **Correction nécessaire :** Aucune — formulation déjà générale et prudente.
- **Action suivante :** Relecture humaine intégrale des pages BSV/ch.ch avant publication (accès direct actuellement bloqué pour un outil automatisé).

### FACT-002

- **Identifiant :** FACT-002
- **Niveau de risque :** Élevé
- **Thème :** Fiscal / Prévoyance
- **Affirmation :** Le pilier 3a est dit « lié » (cadre légal encadrant versements et conditions de retrait, traitement fiscal particulier/déductibilité) ; le pilier 3b est dit « libre » (cadre fiscal différent de celui du 3a).
- **Fichiers concernés :** `marketing-ai/lead-magnets/guide-pratique-3e-pilier.md` (§3-§5), `marketing-ai/social-media/linkedin/semaine-17-23-aout-2026.md` (Publication 1), `marketing-ai/social-media/instagram/semaine-17-23-aout-2026.md` (slides 3, 5), `marketing-ai/social-media/reels/reel-semaine-17-23-aout-2026.md`.
- **Content IDs concernés :** SOC-LI-003, SOC-IG-001, SOC-RE-001.
- **Autorité :** Administration fédérale des contributions (AFC/ESTV) ; OFAS/BSV.
- **Titre exact de la page ou du document :** Non consulté intégralement. Page ciblée : « Taux d'intérêt / Déductions maximales pilier 3a de l'impôt fédéral direct IFD » (estv.admin.ch).
- **URL officielle :** https://www.estv.admin.ch/fr/taux-interet-deductions-maximales-pilier-3a-impot-federal-direct
- **Date de consultation :** 25/07/2026 (tentative d'accès direct — échec HTTP 403 ; extrait de recherche uniquement).
- **Date de mise à jour affichée :** Non disponible (accès direct bloqué).
- **Passage utile :** Extrait de recherche (`site:estv.admin.ch`) confirmant l'existence d'un régime de déduction fiscale spécifique au pilier 3a (cotisations déductibles, plafonds distincts selon affiliation ou non à une institution de 2e pilier), publié par l'AFC. Aucun chiffre n'est repris dans les contenus marketing (volontairement).
- **Ce que la source dit explicitement :** Non déterminé avec certitude au niveau du détail (lecture intégrale non obtenue) ; le principe d'un régime de déduction propre au 3a est cependant cohérent avec le cadre légal connu (LPP/OPP3) et corroboré par l'extrait officiel.
- **Interprétation prudente :** La distinction « 3a lié / 3b libre » et l'existence d'un « traitement fiscal particulier » du 3a peuvent être maintenues comme affirmations générales, sans aucun chiffre ni promesse d'avantage individuel garanti.
- **Ce que la source ne permet pas d'affirmer :** Aucun montant, aucun taux, aucune garantie d'avantage fiscal individuel ; le traitement fiscal du 3b (cantonal, variable) ne doit jamais être présenté comme uniforme ou favorable par défaut.
- **Verdict :** Non confirmé (lecture intégrale non obtenue — extrait de recherche corroborant).
- **Correction nécessaire :** Voir FACT-003 (nuance sur le caractère « systématiquement plus souple » du 3b).
- **Action suivante :** Relecture humaine intégrale de la page ESTV et d'une source Fedlex/OPP3 avant toute publication ; ne jamais introduire de chiffre sans nouvelle vérification datée.

### FACT-003

- **Identifiant :** FACT-003
- **Niveau de risque :** Moyen
- **Thème :** Prévoyance
- **Affirmation :** Présentation du pilier 3b comme « beaucoup plus souple » que le 3a, sans nuance, dans deux contenus (LinkedIn Publication 1 et script du Reel).
- **Fichiers concernés :** `marketing-ai/social-media/linkedin/semaine-17-23-aout-2026.md` (Publication 1), `marketing-ai/social-media/reels/reel-semaine-17-23-aout-2026.md`.
- **Content IDs concernés :** SOC-LI-003, SOC-RE-001.
- **Autorité :** OFAS/BSV ; AFC/ESTV (cf. FACT-002).
- **Titre exact de la page ou du document :** Non consulté intégralement (voir FACT-002).
- **URL officielle :** https://www.bsv.admin.ch/fr/lpp-3e-pilier ; https://www.estv.admin.ch/fr/taux-interet-deductions-maximales-pilier-3a-impot-federal-direct
- **Date de consultation :** 25/07/2026.
- **Date de mise à jour affichée :** Non disponible.
- **Passage utile :** Le §9.1 de la mission demande explicitement de vérifier « la possibilité ou non de présenter le 3b comme systématiquement plus souple ». Le 3b regroupe des solutions variées (épargne bancaire, assurance-vie, titres) dont certaines comportent elles-mêmes des contraintes contractuelles (par ex. pénalités de rachat en assurance-vie) ; le document `guide-pratique-3e-pilier.md` (§4-5) nuance déjà correctement (« en général », « généralement plus libre »), contrairement aux deux contenus cités.
- **Ce que la source dit explicitement :** Sans objet (correction de prudence rédactionnelle, pas une correction issue d'un texte de loi contredit).
- **Interprétation prudente :** Le 3b est structurellement moins contraint par la loi que le 3a (pas de cadre légal équivalent à l'OPP3), mais cela ne signifie pas que chaque produit 3b est individuellement plus souple — la formulation doit rester une tendance générale, pas une règle absolue.
- **Ce que la source ne permet pas d'affirmer :** Que « tout » 3b est plus souple que « tout » 3a, en toutes circonstances.
- **Verdict :** Confirmé avec reformulation.
- **Correction nécessaire :** Ajout du mot « généralement » avant « plus souple », suppression de l'intensif « beaucoup » qui renforçait le caractère absolu de l'affirmation.
- **Action suivante :** Correction appliquée (voir §4 « Corrections appliquées » ci-dessous et le rapport final).

### FACT-004

- **Identifiant :** FACT-004
- **Niveau de risque :** Faible
- **Thème :** Commercial
- **Affirmation :** Aucun contenu ne présente un avantage fiscal individuel du 3a comme automatique ou garanti.
- **Fichiers concernés :** `marketing-ai/lead-magnets/guide-pratique-3e-pilier.md`, `marketing-ai/social-media/linkedin/semaine-17-23-aout-2026.md`, `marketing-ai/social-media/instagram/semaine-17-23-aout-2026.md`, `marketing-ai/social-media/reels/reel-semaine-17-23-aout-2026.md`.
- **Content IDs concernés :** SOC-LI-003, SOC-IG-001, SOC-RE-001.
- **Autorité :** Sans objet (contrôle rhétorique interne, pas une vérification de source).
- **Titre exact de la page ou du document :** Sans objet.
- **URL officielle :** Sans objet.
- **Date de consultation :** 25/07/2026.
- **Date de mise à jour affichée :** Sans objet.
- **Passage utile :** Relecture complète des quatre fichiers : aucun montant, aucun taux, aucune formule du type « vous économiserez » ou « vous récupérerez » n'est employée.
- **Ce que la source dit explicitement :** Sans objet.
- **Interprétation prudente :** Contrôle satisfait.
- **Ce que la source ne permet pas d'affirmer :** Sans objet.
- **Verdict :** Confirmé.
- **Correction nécessaire :** Aucune.
- **Action suivante :** Aucune.

### FACT-005

- **Identifiant :** FACT-005
- **Niveau de risque :** Élevé
- **Thème :** Prévoyance
- **Affirmation :** « Contrairement à un salarié, l'indépendant ne bénéficie pas automatiquement de toutes les mêmes protections » (couverture perte de gain, prévoyance professionnelle facultative pour l'indépendant).
- **Fichiers concernés :** `marketing-ai/social-media/linkedin/semaine-17-23-aout-2026.md` (Publication 2).
- **Content IDs concernés :** SOC-LI-004.
- **Autorité :** Office fédéral des assurances sociales (OFAS/BSV).
- **Titre exact de la page ou du document :** « À quoi faire attention si vous exercez une activité indépendante » (non consulté intégralement).
- **URL officielle :** https://www.bsv.admin.ch/fr/activite-independante
- **Date de consultation :** 25/07/2026 (tentative d'accès direct — échec HTTP 403 ; extrait de recherche uniquement).
- **Date de mise à jour affichée :** Non disponible.
- **Passage utile :** Extrait de recherche (`site:bsv.admin.ch`) : « Pour les travailleurs indépendants, l'affiliation à la prévoyance professionnelle est facultative » ; possibilité de s'assurer volontairement contre les risques d'invalidité liés à un accident ; recommandation de s'affilier à une institution de 2e pilier et/ou d'ouvrir un compte de pilier 3a pour ne pas dépendre uniquement de l'AVS à la retraite.
- **Ce que la source dit explicitement :** Corroboration (par extrait, non lecture intégrale) que le 2e pilier n'est pas obligatoire pour un indépendant, contrairement à un salarié.
- **Interprétation prudente :** L'affirmation du post (« ne bénéficie pas automatiquement de toutes les mêmes protections ») reste déjà prudente : elle n'affirme pas une absence totale de couverture, mais une absence d'automatisme, ce qui est cohérent avec l'extrait obtenu.
- **Ce que la source ne permet pas d'affirmer :** Aucune généralisation à « tous les indépendants » de façon identique (le post ne le fait pas) ; aucun chiffre de cotisation ou de prestation (le post n'en contient pas).
- **Verdict :** Non confirmé (lecture intégrale non obtenue — extrait de recherche corroborant, cohérent avec la formulation déjà prudente du contenu).
- **Correction nécessaire :** Aucune — la formulation existante est déjà conforme aux nuances requises par le §9.2 de la mission (dépend du statut exact, de l'activité, des couvertures déjà souscrites, de la caisse de pension éventuelle — le post renvoie explicitement à un échange individuel plutôt que d'énoncer une règle générale chiffrée).
- **Action suivante :** Relecture humaine intégrale de la page BSV avant publication.

### FACT-006

- **Identifiant :** FACT-006
- **Niveau de risque :** Élevé
- **Thème :** Assurance-maladie
- **Affirmation :** Après une naissance, il convient de vérifier la couverture maladie du nouveau-né (aucun délai ni règle chiffrée n'est énoncé dans le contenu lui-même).
- **Fichiers concernés :** `marketing-ai/social-media/facebook/semaine-17-23-aout-2026.md`.
- **Content IDs concernés :** SOC-FB-001.
- **Autorité :** Office fédéral de la santé publique (OFSP/BAG).
- **Titre exact de la page ou du document :** Non identifié avec certitude (voir §11 — recherche non conclusive sur une page dédiée unique) ; fiches connexes : « Assurance-maladie : Obligation de s'assurer pour les assurés domiciliés en Suisse ».
- **URL officielle :** https://www.bag.admin.ch/fr/assurance-maladie-obligation-de-sassurer-pour-les-assures-domicilies-en-suisse
- **Date de consultation :** 25/07/2026 (tentative d'accès direct — échec HTTP 403 ; extrait de recherche uniquement, résultat combinant plusieurs sources non exclusivement officielles).
- **Date de mise à jour affichée :** Non disponible.
- **Passage utile :** Extrait de recherche évoquant un délai de trois mois pour affilier un nouveau-né à l'assurance obligatoire des soins, avec effet rétroactif à la naissance si l'affiliation intervient dans ce délai. **Cet extrait n'est pas exclusivement issu d'une page officielle identifiée avec certitude** (résultats mêlés) : il ne peut donc pas être utilisé pour sourcer un chiffre dans un contenu public.
- **Ce que la source dit explicitement :** Non déterminé avec la certitude requise pour publier un délai chiffré.
- **Interprétation prudente :** Le contenu Facebook actuel ne cite aucun délai ni aucune règle chiffrée — il se limite à recommander une vérification générale (« pour s'assurer que tout est bien en ordre dès le départ »). Cette formulation reste donc publiable en l'état sur ce point précis, sans qu'aucun chiffre n'ait besoin d'être sourcé.
- **Ce que la source ne permet pas d'affirmer :** Aucun délai précis (« 3 mois ») ne doit être ajouté au contenu tant qu'une page officielle unique n'a pas été lue intégralement et datée.
- **Verdict :** Non confirmé (lecture intégrale non obtenue) — sans conséquence sur le contenu actuel, qui ne reprend aucun chiffre.
- **Correction nécessaire :** Aucune sur le contenu actuel. **Mise en garde** : si un délai chiffré devait être ajouté ultérieurement, une nouvelle vérification humaine sur une page OFSP identifiée avec certitude serait obligatoire au préalable.
- **Action suivante :** Relecture humaine intégrale d'une page OFSP dédiée à l'affiliation des nouveau-nés avant tout ajout de délai chiffré au contenu.

### FACT-007

- **Identifiant :** FACT-007
- **Niveau de risque :** Élevé
- **Thème :** Juridique
- **Affirmation :** La résiliation de l'assurance de base (LAMal) n'entraîne pas automatiquement celle des assurances complémentaires (LCA), qui suivent leurs propres conditions, y compris d'éventuelles conditions d'admission propres à chaque assureur.
- **Fichiers concernés :** `marketing-ai/social-media/facebook/semaine-17-23-aout-2026.md`, `marketing-ai/seo/articles/seo-001-changer-caisse-maladie-v3.md`.
- **Content IDs concernés :** SOC-FB-001, SEO-001.
- **Autorité :** Fedlex (LAMal/LCA) ; OFSP.
- **Titre exact de la page ou du document :** Voir FACT-014/FACT-015 (SEO-001, dossier de recherche déjà existant).
- **URL officielle :** https://www.fedlex.admin.ch/eli/cc/1995/1328_1328_1328/fr
- **Date de consultation :** 25/07/2026 (échec HTTP 403, voir §1).
- **Date de mise à jour affichée :** Non disponible.
- **Passage utile :** Voir dossier `marketing-ai/research/sources-seo-001-changer-caisse-maladie.md` (A08 : « à vérifier manuellement », non couvert par le lot S01-S06).
- **Ce que la source dit explicitement :** Non déterminé (point déjà identifié comme non couvert par les sources disponibles).
- **Interprétation prudente :** Le principe général — LAMal et LCA sont deux régimes distincts, la résiliation de l'un n'emporte pas automatiquement celle de l'autre — est un principe juridique suisse largement établi (deux lois distinctes, deux types de contrats). Les contenus actuels (SEO-001 v3, Facebook) le présentent déjà de façon prudente, sans détailler les mécanismes fins de sélection médicale.
- **Ce que la source ne permet pas d'affirmer :** Aucun détail sur les conditions d'admission ou de résiliation propres à un assureur donné.
- **Verdict :** Non confirmé (lecture intégrale non obtenue) — cohérent avec le statut déjà attribué à A07/A08 dans le dossier de recherche SEO-001 et jugé « conforme avec nuance » par la review conformité v3 du 24/07/2026.
- **Correction nécessaire :** Aucune — statut conservé sans régression.
- **Action suivante :** Relecture humaine intégrale de la LAMal/LCA sur Fedlex si ce point devait être développé davantage dans un futur contenu (par ex. SEO-003).

### FACT-008

- **Identifiant :** FACT-008
- **Niveau de risque :** Élevé
- **Thème :** FINMA
- **Affirmation :** « Legrand conseils Sàrl est inscrite au registre public de la FINMA comme intermédiaire d'assurance non lié pour les branches assurance-maladie complémentaire et assurance-vie. »
- **Fichiers concernés :** `marketing-ai/social-media/linkedin/post-lancement-officiel.md` (Versions 1 et 2), `marketing-ai/flyers/flyer-bilan-assurances-prevoyance.md`, `marketing-ai/lead-magnets/guide-pratique-3e-pilier.md` (§10).
- **Content IDs concernés :** SOC-LI-001, SOC-LI-002.
- **Autorité :** FINMA (Autorité fédérale de surveillance des marchés financiers).
- **Titre exact de la page ou du document :** Documents officiels transmis directement par le dirigeant (extrait du registre public FINMA), déjà confirmés le 17/07/2026 — voir `marketing-ai/compliance/sources-officielles-a-verifier.md`, point 9.
- **URL officielle :** Registre public FINMA (recherche directe non accessible depuis cet environnement le 25/07/2026 — HTTP 403 sur https://www.finma.ch/en/authorisation/insurance-intermediaries/registersuche/ ; non nécessaire ici car confirmation déjà obtenue par documents officiels directs, source plus forte qu'une consultation web).
- **Date de consultation :** 17/07/2026 (confirmation d'origine, documents officiels transmis par le dirigeant) ; nouvelle tentative de re-vérification web le 25/07/2026 (échec technique, sans incidence sur le statut déjà confirmé).
- **Date de mise à jour affichée :** 1re inscription au registre le 22/06/2026 (donnée du document officiel transmis).
- **Passage utile :** « Legrand conseils Sàrl », n° FINMA F01569363, et Antoine Legrand, n° FINMA F01569355, tous deux intermédiaires d'assurance non liés, branches assurance-maladie complémentaire et assurance-vie, UID CHE-376.900.357.
- **Ce que la source dit explicitement :** Statut confirmé par documents officiels directs (pas une extrapolation).
- **Interprétation prudente :** La formulation utilisée dans les deux versions du post de lancement reprend **mot pour mot** la formulation autorisée. Aucune mention interdite (« certifié / agréé / approuvé FINMA ») n'est présente.
- **Ce que la source ne permet pas d'affirmer :** Que cette inscription couvre toutes les activités d'assurance ou constitue un agrément pour l'assurance obligatoire LAMal — non affirmé dans les contenus, conforme.
- **Verdict :** Confirmé (statut d'origine du 17/07/2026, non remis en cause).
- **Correction nécessaire :** Aucune sur le fond de cette affirmation. Voir FACT-016 pour la correction de l'URL LinkedIn associée dans le même document.
- **Action suivante :** **Ne pas modifier** les numéros FINMA sans nouvelle consultation directe d'une source officielle — règle strictement respectée dans ce document.

### FACT-009

- **Identifiant :** FACT-009
- **Niveau de risque :** Moyen
- **Thème :** Commercial / Intermédiation
- **Affirmation :** « Je compare plusieurs assureurs, car je ne suis lié à aucun » (SOC-LI-002) ; « examiner les différentes solutions auxquelles j'ai accès » (SOC-LI-001).
- **Fichiers concernés :** `marketing-ai/social-media/linkedin/post-lancement-officiel.md`.
- **Content IDs concernés :** SOC-LI-001, SOC-LI-002.
- **Autorité :** Sans objet (contrôle rhétorique de conformité interne, pas une vérification de source officielle).
- **Titre exact de la page ou du document :** Sans objet.
- **URL officielle :** Sans objet.
- **Date de consultation :** 25/07/2026.
- **Date de mise à jour affichée :** Sans objet.
- **Passage utile :** Aucune des deux formulations n'emploie « tout le marché », « tous les assureurs » ou un équivalent laissant entendre une comparaison exhaustive.
- **Ce que la source dit explicitement :** Sans objet.
- **Interprétation prudente :** Formulations conformes à la règle du §9.4 de la mission (interdiction de laisser entendre que Legrand Conseils compare automatiquement toutes les compagnies ou tout le marché).
- **Ce que la source ne permet pas d'affirmer :** Sans objet.
- **Verdict :** Confirmé.
- **Correction nécessaire :** Aucune.
- **Action suivante :** Aucune.

### FACT-010

- **Identifiant :** FACT-010
- **Niveau de risque :** Élevé
- **Thème :** Juridique
- **Affirmation :** Pour un changement d'assurance de base au 1er janvier, la résiliation doit être **reçue** par l'assureur actuel au plus tard le 30 novembre (base légale : art. 7 LAMal).
- **Fichiers concernés :** `marketing-ai/seo/articles/seo-001-changer-caisse-maladie-v3.md`.
- **Content IDs concernés :** SEO-001.
- **Autorité :** Fedlex ; Office fédéral de la santé publique (OFSP) / Priminfo.
- **Titre exact de la page ou du document :** Loi fédérale sur l'assurance-maladie (LAMal), art. 7 ; « Changement d'assurance-maladie » (Priminfo).
- **URL officielle :** https://www.fedlex.admin.ch/eli/cc/1995/1328_1328_1328/fr ; https://www.priminfo.admin.ch/fr/zahlen-und-fakten/wechsel
- **Date de consultation :** 23/07/2026 (sources transmises par l'humain, dossier de recherche) ; nouvelle tentative de re-vérification indépendante le 25/07/2026 (échec HTTP 403 sur les deux URL et sur le PDF officiel Fedlex).
- **Date de mise à jour affichée :** Non disponible (accès direct bloqué lors des deux tentatives).
- **Passage utile :** Voir `marketing-ai/research/sources-seo-001-changer-caisse-maladie.md`, affirmation A02 (« validé », sources S01/S02/S05).
- **Ce que la source dit explicitement :** Selon le dossier transmis par l'humain le 23/07/2026 (non remis en cause par cette nouvelle tentative) : délai de réception au 30 novembre pour un changement au 1er janvier.
- **Interprétation prudente :** Affirmation déjà validée par un humain sur la base de sources officielles transmises directement (Priminfo, OFSP), reprise fidèlement dans l'article v3, déjà compliance-validée (24/07/2026) et humainement validée (24/07/2026).
- **Ce que la source ne permet pas d'affirmer :** Les exceptions et cas particuliers de l'art. 7 LAMal non couverts par le lot (voir A12) — l'article ne les détaille pas et renvoie explicitement à une vérification individuelle, ce qui est conforme.
- **Verdict :** Non confirmé par une nouvelle lecture intégrale automatisée (HTTP 403 persistant) — **statut historique conservé sans régression**, conformément à la consigne explicite du §9.5 de la mission (« Ne fais pas régresser SEO-001 sans raison. Si toutes les affirmations sont toujours correctes, conserve son statut actuel »). Aucun élément trouvé le 25/07/2026 ne contredit cette affirmation.
- **Correction nécessaire :** Aucune.
- **Action suivante :** Aucune — SEO-001 conserve sa validation humaine du 24/07/2026 (Antoine Legrand), non remise en cause.

### FACT-011

- **Identifiant :** FACT-011
- **Niveau de risque :** Élevé
- **Thème :** Juridique
- **Affirmation :** C'est la date de **réception** de la résiliation par l'assureur qui est déterminante, pas la date d'envoi ni le cachet postal.
- **Fichiers concernés :** `marketing-ai/seo/articles/seo-001-changer-caisse-maladie-v3.md`.
- **Content IDs concernés :** SEO-001.
- **Autorité :** Priminfo (OFSP).
- **Titre exact de la page ou du document :** Voir dossier A01/A03 (`sources-seo-001-changer-caisse-maladie.md`), sources S01, S02.
- **URL officielle :** https://www.priminfo.admin.ch/fr/zahlen-und-fakten/wechsel ; https://www.priminfo.admin.ch/fr/faq
- **Date de consultation :** 23/07/2026 (lot transmis) ; re-tentative 25/07/2026 (HTTP 403).
- **Date de mise à jour affichée :** Non disponible.
- **Passage utile :** A03 : « validé » (S01, S02).
- **Ce que la source dit explicitement :** Voir dossier de recherche existant, non remis en cause.
- **Interprétation prudente :** Statut conservé.
- **Ce que la source ne permet pas d'affirmer :** La mécanique précise d'un délai tombant un samedi/dimanche/jour férié n'est pas détaillée dans l'article (signalé comme non traité dans le dossier de recherche, §7) — l'article n'en fait pas mention, ce qui est cohérent.
- **Verdict :** Non confirmé par nouvelle lecture intégrale (HTTP 403) — statut conservé sans régression.
- **Correction nécessaire :** Aucune.
- **Action suivante :** Aucune.

### FACT-012

- **Identifiant :** FACT-012
- **Niveau de risque :** Moyen
- **Thème :** Juridique
- **Affirmation :** L'assureur communique la nouvelle prime au plus tard le 31 octobre ; le changement au 1er janvier n'est pas conditionné à une hausse de prime.
- **Fichiers concernés :** `marketing-ai/seo/articles/seo-001-changer-caisse-maladie-v3.md`.
- **Content IDs concernés :** SEO-001.
- **Autorité :** Priminfo / OFSP.
- **Titre exact de la page ou du document :** Voir A02/A04 du dossier de recherche.
- **URL officielle :** https://www.priminfo.admin.ch/fr/zahlen-und-fakten/wechsel
- **Date de consultation :** 23/07/2026 (lot transmis) ; re-tentative 25/07/2026 (HTTP 403).
- **Date de mise à jour affichée :** Non disponible.
- **Passage utile :** Voir §6 du dossier de recherche.
- **Ce que la source dit explicitement :** Voir dossier existant, non remis en cause.
- **Interprétation prudente :** Statut conservé.
- **Ce que la source ne permet pas d'affirmer :** Sans objet supplémentaire.
- **Verdict :** Non confirmé par nouvelle lecture intégrale — statut conservé sans régression.
- **Correction nécessaire :** Aucune.
- **Action suivante :** Aucune.

### FACT-013

- **Identifiant :** FACT-013
- **Niveau de risque :** Faible
- **Thème :** Juridique
- **Affirmation :** L'OFSP recommande un envoi recommandé ou A Plus avant le 15 novembre — recommandation pratique, pas le délai légal lui-même.
- **Fichiers concernés :** `marketing-ai/seo/articles/seo-001-changer-caisse-maladie-v3.md`.
- **Content IDs concernés :** SEO-001.
- **Autorité :** OFSP / Priminfo.
- **Titre exact de la page ou du document :** Voir A11 du dossier de recherche.
- **URL officielle :** https://www.priminfo.admin.ch/fr/zahlen-und-fakten/wechsel
- **Date de consultation :** 23/07/2026 (lot transmis) ; re-tentative 25/07/2026 (HTTP 403).
- **Date de mise à jour affichée :** Non disponible.
- **Passage utile :** Voir §7 du dossier de recherche — déjà correctement distingué de la date légale.
- **Ce que la source dit explicitement :** Voir dossier existant.
- **Interprétation prudente :** Statut conservé — l'article distingue déjà correctement recommandation pratique et délai légal.
- **Ce que la source ne permet pas d'affirmer :** Que le 15 novembre serait lui-même une date légale — l'article ne le fait pas.
- **Verdict :** Non confirmé par nouvelle lecture intégrale — statut conservé sans régression.
- **Correction nécessaire :** Aucune.
- **Action suivante :** Aucune.

### FACT-014

- **Identifiant :** FACT-014
- **Niveau de risque :** Élevé
- **Thème :** Juridique
- **Affirmation :** Si, au 31 décembre, les primes arriérées, participations aux coûts arriérées, intérêts moratoires et frais de poursuite concernés — ayant fait l'objet d'un rappel au plus tard le 30 novembre — n'ont pas été réglés intégralement, le changement d'assureur ne peut, en principe, pas prendre effet.
- **Fichiers concernés :** `marketing-ai/seo/articles/seo-001-changer-caisse-maladie-v3.md`.
- **Content IDs concernés :** SEO-001.
- **Autorité :** Priminfo (OFSP) — confirmée par vérification manuelle externe le 24/07/2026 (déjà documentée).
- **Titre exact de la page ou du document :** Voir A05 du dossier de recherche, source S01/S02 (Priminfo), S06 (BAG, contexte de procédure).
- **URL officielle :** https://www.priminfo.admin.ch/fr/zahlen-und-fakten/wechsel ; https://www.priminfo.admin.ch/fr/faq ; https://www.bag.admin.ch/fr/assurance-maladie-primes-arrierees
- **Date de consultation :** 24/07/2026 (vérification manuelle externe documentée) ; re-tentative automatisée 25/07/2026 (HTTP 403 sur les trois URL, y compris le PDF officiel `PG26-FB-Versichererwechsel_FR.pdf`).
- **Date de mise à jour affichée :** Non disponible pour la tentative du 25/07/2026.
- **Passage utile :** Voir §7 du dossier de recherche — règle déjà nuancée (rappel exigé, exceptions pour cas contestés/récents non couverts par une règle générale).
- **Ce que la source dit explicitement :** Voir dossier existant, confirmé par review humaine externe du 24/07/2026, non remis en cause.
- **Interprétation prudente :** Statut conservé — c'est l'affirmation la plus sensible de l'article et elle est déjà la mieux nuancée (renvoi systématique vers une vérification individuelle pour les cas particuliers).
- **Ce que la source ne permet pas d'affirmer :** Une généralisation à tous les cas de dette contestée ou récente — l'article l'exclut déjà explicitement.
- **Verdict :** Non confirmé par nouvelle lecture intégrale automatisée — statut conservé sans régression (déjà « validé » via review humaine externe du 24/07/2026, source la plus forte disponible).
- **Correction nécessaire :** Aucune.
- **Action suivante :** Aucune.

### FACT-015

- **Identifiant :** FACT-015
- **Niveau de risque :** Moyen
- **Thème :** Juridique
- **Affirmation :** Une assurance complémentaire (LCA) ne suit pas automatiquement un changement d'assurance de base (LAMal) et peut être soumise à des conditions d'admission propres à chaque assureur.
- **Fichiers concernés :** `marketing-ai/seo/articles/seo-001-changer-caisse-maladie-v3.md`.
- **Content IDs concernés :** SEO-001.
- **Autorité :** Fedlex (LAMal/LCA).
- **Titre exact de la page ou du document :** Voir A07/A08/A09 du dossier de recherche — déjà signalés « à vérifier manuellement », non couverts par le lot S01-S06.
- **URL officielle :** https://www.fedlex.admin.ch/eli/cc/1995/1328_1328_1328/fr
- **Date de consultation :** 25/07/2026 (échec HTTP 403).
- **Date de mise à jour affichée :** Non disponible.
- **Passage utile :** Voir la review conformité v3 (`compliance-validation-seo-001-v3.md`) : ces points sont jugés « conformes avec nuance » précisément parce que le texte reste général et renvoie vers une vérification individuelle plutôt que d'affirmer un mécanisme juridique précis.
- **Ce que la source dit explicitement :** Non déterminé (point déjà identifié comme non couvert).
- **Interprétation prudente :** Statut conservé — formulation déjà prudente et jugée non bloquante par la review conformité v3 du 24/07/2026.
- **Ce que la source ne permet pas d'affirmer :** Le détail des conditions d'admission d'un assureur complémentaire précis.
- **Verdict :** Non confirmé par nouvelle lecture intégrale — statut conservé sans régression.
- **Correction nécessaire :** Aucune.
- **Action suivante :** Relecture humaine intégrale de la LAMal/LCA si ce point est développé dans un futur contenu (SEO-003).

### FACT-016

- **Identifiant :** FACT-016
- **Niveau de risque :** Moyen
- **Thème :** Commercial
- **Affirmation :** URL officielle de la page LinkedIn entreprise de Legrand conseils Sàrl — divergence constatée entre une variante accentuée (`legrand-conseils-s%C3%A0rl`) et une variante non accentuée (`legrand-conseils-sarl`).
- **Fichiers concernés :** `marketing-ai/strategy/identite-et-canaux-officiels.md`, `marketing-ai/social-media/checklist-creation-pages-linkedin-facebook.md`, `marketing-ai/social-media/linkedin/post-lancement-officiel.md`, `marketing-ai/social-media/linkedin/semaine-17-23-aout-2026.md`.
- **Content IDs concernés :** SOC-LI-001, SOC-LI-002, SOC-LI-003, SOC-LI-004.
- **Autorité :** Sans objet — décision éditoriale humaine explicite (Antoine Legrand), pas une vérification de source officielle au sens du §6 de la mission.
- **Titre exact de la page ou du document :** Sans objet.
- **URL officielle :** https://www.linkedin.com/company/legrand-conseils-s%C3%A0rl/ (retenue comme confirmée, sur instruction explicite de la Mission 3, §14).
- **Date de consultation :** Sans objet (décision humaine, pas une consultation de source officielle).
- **Date de mise à jour affichée :** Sans objet.
- **Passage utile :** §14 de la Mission 3 : « conserve comme URL officielle confirmée : https://www.linkedin.com/company/legrand-conseils-s%C3%A0rl/. La variante suivante ne doit plus être présentée comme URL active : https://www.linkedin.com/company/legrand-conseils-sarl/. »
- **Ce que la source dit explicitement :** Sans objet.
- **Interprétation prudente :** Cette correction ne repose pas sur une vérification technique de la page LinkedIn elle-même (hors périmètre des sources officielles suisses de la mission, et hors accès de cet environnement), mais sur une instruction humaine explicite et datée, reçue dans le cadre de cette mission.
- **Ce que la source ne permet pas d'affirmer :** Que la variante non accentuée est nécessairement inactive au sens technique — seulement qu'elle ne doit plus être présentée comme telle dans les contenus internes, sur décision humaine.
- **Verdict :** Confirmé avec reformulation (résolution éditoriale, pas une vérification de source officielle au sens strict du §6/§11).
- **Correction nécessaire :** Remplacement de la variante non accentuée par la variante accentuée dans les quatre fichiers listés ; conservation d'une note historique dans `checklist-creation-pages-linkedin-facebook.md`.
- **Action suivante :** Correction appliquée (voir §4 ci-dessous).

---

## 3. Synthèse chiffrée

| Élément | Valeur |
|---|---|
| Affirmations inventoriées (FACT-001 à FACT-016) | 16 |
| Confirmé | 3 (FACT-004, FACT-008, FACT-009) |
| Confirmé avec reformulation | 2 (FACT-003, FACT-016) |
| Non confirmé (lecture intégrale non obtenue, statut conservé sans régression ou classé selon §11) | 11 (FACT-001, 002, 005, 006, 007, 010, 011, 012, 013, 014, 015) |
| Contredit | 0 |
| Bloqué — source officielle insuffisante | 0 (aucun contenu ne repose sur une affirmation chiffrée non sourcée nécessitant un blocage ; tout contenu concerné reste déjà encadré par une mention `Vérification humaine obligatoire` existante) |

---

## 4. Corrections appliquées

| # | FACT | Fichier | Ancien texte | Nouveau texte | Motif |
|---|---|---|---|---|---|
| 1 | FACT-003 | `marketing-ai/social-media/linkedin/semaine-17-23-aout-2026.md` (Publication 1) | « Il est beaucoup plus souple, aussi bien sur les montants que sur la disponibilité de l'argent. » | « Il est généralement plus souple, aussi bien sur les montants que sur la disponibilité de l'argent. » | Éviter de présenter la souplesse du 3b comme une règle absolue (§9.1 de la mission) ; alignement avec la nuance déjà présente dans `guide-pratique-3e-pilier.md`. |
| 2 | FACT-003 | `marketing-ai/social-media/reels/reel-semaine-17-23-aout-2026.md` | « Le 3b, lui, est “libre” : beaucoup plus souple, avec ses propres règles. » | « Le 3b, lui, est “libre” : généralement plus souple, avec ses propres règles. » | Idem. |
| 3 | FACT-016 | `marketing-ai/strategy/identite-et-canaux-officiels.md` | Divergence non résolue, à réconcilier humainement | Divergence résolue par décision humaine explicite (Mission 3, §14) ; URL accentuée confirmée | Résolution éditoriale demandée explicitement par Antoine Legrand. |
| 4 | FACT-016 | `marketing-ai/social-media/checklist-creation-pages-linkedin-facebook.md` | URL non accentuée présentée comme « confirmée » / « active et finalisée » | URL accentuée ; ancienne variante conservée en note historique | Idem — cohérence avec la source de vérité `identite-et-canaux-officiels.md`. |
| 5 | FACT-016 | `marketing-ai/social-media/linkedin/post-lancement-officiel.md` | URL non accentuée en en-tête | URL accentuée | Idem. |
| 6 | FACT-016 | `marketing-ai/social-media/linkedin/semaine-17-23-aout-2026.md` | URL non accentuée (en-tête + notes de production) | URL accentuée | Idem. |

Aucune autre modification n'a été apportée à un contenu marketing dans le cadre de cette mission. Aucune affirmation, source, URL ou validation humaine n'a été inventée.
