# Formulaire — Téléchargement du « Guide pratique : 3e pilier 3A et 3B »

> Brouillon marketing (LOT 2A). **Brouillon IA — validation humaine requise.**
> Rédigé le 16/07/2026. Producteur : `lead-magnet-creator` /
> `conversion-funnel-designer` · Contrôle : `compliance-reviewer`.
> Legrand Conseils Sàrl — Vaud / Genève.
> **Spécification uniquement** : aucune modification du site ni des formulaires
> existants. La mise en place technique est une **action humaine ultérieure**
> (respect nLPD, hébergement, événements Analytics). `URL cible à confirmer`.

---

## Principe

Collecte **minimale**, consentement **clair**, aucune donnée sensible. Le
téléchargement du guide **n'inscrit jamais** automatiquement à une newsletter.

## Champs du formulaire

| Champ | Type | Obligatoire | Remarque |
|---|---|---|---|
| Prénom | texte | Oui | Pour personnaliser l'envoi. |
| Nom | texte | Oui | |
| Adresse e-mail | e-mail | Oui | Pour envoyer le guide. |
| Canton | liste (VD, GE, autre) | **Facultatif** | Seulement si réellement utile pour orienter l'accompagnement ; sinon, retirer ce champ. |

**Ne jamais demander** : données médicales ou de santé, revenus détaillés, numéro
AVS, documents, contrats, données financières précises.

## Consentements

Deux cases **distinctes** et **séparées** :

1. **Consentement nécessaire à l'envoi du guide** (obligatoire pour recevoir le
   document) :
   > ☐ J'accepte que Legrand Conseils Sàrl utilise mon adresse e-mail **pour
   > m'envoyer le guide demandé**.
   *(Non pré-coché. Finalité limitée à l'envoi du guide.)*

2. **Consentement marketing — séparé, explicite, facultatif, non pré-coché,
   révocable** :
   > ☐ *(facultatif)* J'accepte de recevoir occasionnellement des informations et
   > conseils de Legrand Conseils Sàrl. Je peux me désinscrire à tout moment.

**Règles impératives** :
- La case 2 est **facultative** : cocher (ou non) la case 2 **ne conditionne pas**
  la réception du guide.
- **Aucune** case n'est pré-cochée.
- **Aucune** inscription automatique à une newsletter via le téléchargement.
- Lien vers la **politique de confidentialité** (finalités, durée de conservation,
  droits d'accès/rectification/suppression, responsable du traitement).
  `Vérification humaine obligatoire` (contenu de la politique).

---

## Texte de confirmation (à l'écran, après envoi du formulaire)

> **Merci !** Votre guide est en route vers votre boîte e-mail 📩
> S'il n'apparaît pas d'ici quelques minutes, pensez à vérifier vos courriers
> indésirables.

## Texte de la page de remerciement

> ### Merci pour votre confiance 🙏
> Votre **Guide pratique du 3e pilier** vous a été envoyé par e-mail.
>
> Nous espérons qu'il vous aidera à y voir plus clair. Prenez le temps de le lire —
> il est fait pour ça.
>
> *Une question après votre lecture ? Vous pouvez nous écrire quand vous le
> souhaitez, sans engagement.*
> *(Lien de contact à insérer —* `URL cible à confirmer`.*)*

## E-mail transactionnel d'envoi du guide

- **Objet** : « Votre Guide pratique du 3e pilier 📘 »
- **Corps** :
  > Bonjour {{Prénom}},
  >
  > Merci de votre intérêt ! Comme demandé, voici votre **Guide pratique :
  > comprendre le 3e pilier 3A et 3B en Suisse**.
  >
  > 👉 [Lien de téléchargement du guide] *(`URL cible à confirmer`)*
  >
  > Ce guide est volontairement clair et sans jargon. Il donne des repères
  > généraux ; pour votre situation précise, un échange reste le plus utile.
  >
  > Belle lecture,
  > L'équipe **Legrand Conseils Sàrl**
  > *Courtier indépendant — Vaud & Genève*
  >
  > *Vous recevez cet e-mail car vous avez demandé ce guide. Cet envoi concerne
  > uniquement votre demande.*

  *(E-mail purement transactionnel : il ne s'agit pas d'un e-mail marketing.
  N'ajouter du contenu promotionnel que si la case 2 a été cochée, dans un envoi
  distinct.)*

## Invitation facultative à prendre rendez-vous

À placer **en bas** de la page de remerciement et/ou en **fin** d'e-mail, de façon
non intrusive :

> *Si vous préférez en parler de vive voix, vous pouvez proposer un moment qui vous
> arrange. C'est sans engagement.*
> *(Lien de prise de contact / rendez-vous à insérer —* `URL cible à confirmer`.*)*

---

## Actions humaines à réaliser (hors périmètre de ce lot)
- Créer/configurer le formulaire sur le site (nLPD, minimisation, cases non
  pré-cochées).
- Héberger le PDF du guide et générer l'URL de téléchargement.
- Configurer l'e-mail transactionnel et, séparément, l'éventuelle liste marketing
  (double opt-in recommandé).
- Mettre en place la mesure (événements `form_start` / `generer_lead`, UTM) —
  **sans modifier le CRM ni les événements existants dans ce lot**.

**Statut** : `Brouillon IA — validation humaine requise`.
