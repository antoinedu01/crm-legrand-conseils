# Checklist préflight — 11 septembre 2026 (matin)

> À dérouler par Antoine Legrand lui-même, directement dans l'interface Meta
> Ads Manager, GTM/GA4 et sur le site public — **aucun point de cette
> checklist n'a été vérifié par Claude Code**, qui n'a pas accès au compte
> Meta. Objectif : confirmer que tout est prêt avant le lancement simultané
> des deux campagnes le 14/09/2026 à 08:00. Cocher chaque ligne au fur et à
> mesure ; tout point non coché ou douteux doit être résolu avant le 14/09,
> pas le jour même.

---

## 1. Campagne « Santé 2027 »

- [ ] Nom exact dans Meta Ads Manager : `LC │ SANTE 2027 │ PROSPECTION │
      VD-GE │ SEP26`
- [ ] Statut : **Programmé** (pas « Actif » avant l'heure prévue, pas
      « Brouillon »)
- [ ] Budget : **30 CHF/jour**
- [ ] Date/heure de début : **14/09/2026, 08:00** (fuseau du compte à
      vérifier — doit correspondre à l'heure suisse)
- [ ] `campaign_key` associé : `cmp_35840ff5627849a084acac6f7f60f262` (si
      visible dans les paramètres/UTM de l'annonce)
- [ ] Landing page cible : `legrandconseils.ch/comparateur-lamal/` — page
      accessible publiquement, sans erreur (tester l'URL directement dans un
      navigateur, y compris depuis un mobile)
- [ ] **CTA du bouton d'annonce** : relever le texte exact affiché dans
      l'interface (divergence connue entre deux documents internes : « En
      savoir plus » vs « Voir les détails » — voir
      `marketing-ai/compliance/verifications-phase2-30-aout-2026.md` § 2).
      Confirmer le texte réellement configuré.
- [ ] ⚠️ **Point de conformité prioritaire, à ne pas lancer sans réponse** :
      la landing page de cette campagne est le comparateur LAMal — voir
      `marketing-ai/compliance/perimetre-finma-vs-lamal-site-public.md`.
      Confirmer qu'une réponse (même provisoire) a été obtenue de l'organe
      de surveillance ou d'un juriste LSA sur le périmètre FINMA vs LAMal
      avant d'activer cette campagne précise.

## 2. Campagne « Prévoyance 3a/3b »

- [ ] Nom exact dans Meta Ads Manager : `LC │ PREVOYANCE 3A-3B │
      PROSPECTION │ VD-GE │ SEP26`
- [ ] Statut : **Programmé**
- [ ] Budget : **30 CHF/jour**
- [ ] Date/heure de début : **14/09/2026, 08:00**
- [ ] `campaign_key` associé : `cmp_3ef0fdfd034642549857d7ed65503126`
- [ ] Landing page cible : `legrandconseils.ch/bilan-prevoyance-3a/` —
      accessible publiquement, sans erreur, y compris mobile
- [ ] CTA du bouton d'annonce : relever le texte exact configuré

## 3. Compte Meta (niveau global)

- [ ] Budget combiné visible et cohérent : **60 CHF/jour** pour les deux
      campagnes ensemble
- [ ] Score d'opportunité / restrictions : aucune restriction bloquante sur
      le compte
- [ ] Moyen de paiement : valide, devise **CHF**, solde suffisant pour
      couvrir au moins les premiers jours de diffusion
- [ ] Aucune alerte ou notification Meta non résolue sur le compte

## 4. Pixel / Dataset et événement de conversion

- [ ] Pixel/Dataset actif : **« Legrand Conseils │ Site Web »**, ID
      `1061776782934109`
- [ ] Événement de conversion configuré sur les deux campagnes :
      **Prospect**
- [ ] Le Pixel se déclenche uniquement **après consentement marketing**
      (`cmplz_marketing=allow`) — vérifier qu'aucune version cassée du
      bandeau de consentement n'a été déployée depuis le dernier test
- [ ] Diagnostic des événements Meta (Test Events / Events Manager) :
      envoyer un lead de test sur chacune des deux landing pages et
      confirmer la réception de l'événement **Prospect** côté Meta

## 5. Formulaires et remontée CRM

- [ ] Formulaire de la page `comparateur-lamal/` : soumission testée de
      bout en bout (formulaire → CRM)
- [ ] Formulaire de la page `bilan-prevoyance-3a/` : soumission testée de
      bout en bout
- [ ] Chaque soumission de test crée bien une fiche **Prospect** dans le
      CRM (`crm.legrandconseils.ch`), avec l'attribution first-touch
      correcte (campagne d'origine visible sur la fiche)
- [ ] **Nettoyage après test** : les fiches de test créées à cette occasion
      sont supprimées ou clairement marquées comme test avant le lancement
      réel (cf. nettoyage du 22/08 pour les prospects « TEST SANTE QA »)

## 6. Tracking GTM/GA4

- [ ] Conteneur GTM `GTM-PFMFCTMP` publié en version live (pas seulement en
      aperçu/preview)
- [ ] Propriété GA4 `G-V4HZ4NWN05` reçoit bien les événements de test
      déclenchés au point 4
- [ ] ⚠️ Vérifier directement dans l'interface GTM/GA4 le nom réel de
      l'événement de conversion configuré comme objectif — un événement
      nommé `generer_lead` est documenté dans plusieurs fichiers internes,
      mais le code du site ne pousse que `lead_form_open` et `lead_submit`
      dans `dataLayer` (voir
      `marketing-ai/compliance/verifications-phase2-30-aout-2026.md` § 1).
      Confirmer que l'objectif de conversion GA4 pointe bien vers
      l'événement réellement déclenché.

## 7. Dernière vérification avant le 14/09

- [ ] Les deux campagnes sont **toutes les deux** au statut « Programmé »,
      avec la même date/heure de démarrage (14/09/2026, 08:00) — pas de
      décalage entre elles
- [ ] Personne n'est prévue d'absence le 14/09 pour traiter les premiers
      leads (cadence cible : premier appel sous 5–15 min en heures
      ouvrées)
- [ ] Rappel des repères CPL une fois les campagnes actives : < 40 CHF très
      bon, 40–70 CHF acceptable, > 70 CHF à investiguer

---

*Ce document ne remplace pas une vérification dans l'interface Meta —
il en fixe la liste. Aucune case n'a été cochée par Claude Code.*
