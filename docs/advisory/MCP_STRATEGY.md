# Stratégie MCP future — Legrand Diagnostic 360

> Proposition de stratégie uniquement. **Aucun serveur MCP n'est configuré
> ou installé par ce document ou par le LOT 1.** Rien ici n'active quoi que
> ce soit.

## 1. Cas d'usage autorisés (futurs, conditionnels)

- **MCP documentaire, lecture seule** : consultation d'un catalogue interne
  de catégories de produits déjà validé par le conseiller/l'entreprise (Lot
  11 puis 12), pour enrichir l'affichage d'une catégorie de solution — sans
  jamais écrire dans un dossier client.
- Consultation de références réglementaires internes déjà validées
  (documentation interne, pas une recherche web ouverte).

## 2. Cas d'usage interdits

- Tout MCP qui écrirait, modifierait ou supprimerait une donnée d'un dossier
  client, d'une session, d'un consentement ou d'une recommandation.
- Tout MCP qui déciderait ou validerait une recommandation à la place du
  conseiller.
- Tout MCP recevant des données personnelles non filtrées/non
  pseudonymisées d'un foyer.
- Tout MCP activé par défaut, sans liste blanche, sans validation humaine.

## 3. Lecture seule par défaut

Tout connecteur MCP futur démarre en lecture seule. Un accès en écriture,
s'il devait un jour exister pour un usage précis, serait une décision
séparée, documentée et validée indépendamment — jamais une extension
implicite d'un accès en lecture déjà accordé.

## 4. Liste blanche de connecteurs

Aucun connecteur n'est autorisé par défaut. Une liste blanche explicite
(nom, portée, données accessibles, finalité) devra être tenue et versionnée
avant toute activation réelle (Lot 12).

## 5. Validation humaine

Toute activation d'un connecteur MCP pour une session ou un foyer donné
nécessite une action humaine explicite du conseiller (jamais une activation
globale silencieuse), sur le même modèle que le double verrou déjà défini
pour l'assistance IA (`SECURITY_PRIVACY.md` §14, `DATA_MODEL.md` §6.1).

## 6. Journalisation

Tout appel MCP, une fois activé, doit être journalisé dans `audit_log`
existant : connecteur utilisé, finalité, nature des données transmises (pas
leur contenu intégral), horodatage. Aucun appel silencieux.

## 7. Filtrage des données

Avant tout appel à un MCP externe, les données transmises doivent passer par
la même fonction de projection filtrée que le mode présentation client
(`ARCHITECTURE.md` §9, `UX_AND_CLIENT_MODE.md` §1.11) — un seul point de
vérité pour « ce qui peut sortir du système », réutilisé plutôt que
dupliqué.

## 8. Pseudonymisation

Quand la finalité le permet, les identités doivent être remplacées par des
rôles (« le conjoint », « l'enfant aîné ») avant transmission — voir
`SECURITY_PRIVACY.md` §15. À concevoir précisément au moment de
l'implémentation réelle, pas ici.

## 9. Gestion des secrets

Toute clé ou jeton d'accès à un connecteur MCP suit la convention déjà en
place dans ce dépôt (`.env.example`, jamais en dur dans le code, jamais
committée). Aucun secret n'est introduit par ce document.

## 10. Risque d'injection

Un contenu documentaire lu via un MCP (ex. un catalogue) est une donnée
externe non fiable au sens de l'injection de prompt — elle ne doit jamais
être interprétée comme une instruction (ni par le moteur de règles
déterministe, qui ne lit de toute façon jamais de contenu MCP directement,
ni par une éventuelle couche IA en aval). Toute future intégration doit
traiter le contenu MCP comme donnée à afficher, jamais comme instruction à
exécuter.

## 11. Validation des sources

Un catalogue consulté via MCP documentaire doit lui-même être une source
interne déjà validée (Lot 11) — ce module ne consulte jamais une source
externe non validée pour construire un constat ou une recommandation.

## 12. Coupure d'urgence

Un mécanisme de désactivation immédiate de tout accès MCP (kill switch),
indépendant de la configuration fine par connecteur, doit exister avant
toute activation réelle en production (Lot 12) — a minima une variable
d'environnement ou un drapeau global vérifié avant tout appel sortant.

## 13. Mécanisme d'activation

Proposition : un drapeau explicite par foyer/session (cohérent avec le
double verrou IA), jamais une activation globale par défaut de
l'application entière.

## 14. Séparation MCP documentaire / action métier

Un MCP documentaire (lecture d'un catalogue) et un éventuel futur MCP
« action métier » (qui agirait sur un système tiers, ex. un extranet
compagnie) sont deux catégories strictement séparées, avec des permissions,
une liste blanche et une journalisation indépendantes. Ce document ne
prévoit, pour l'instant, que la première catégorie ; la seconde n'est même
pas esquissée — elle nécessiterait une stratégie dédiée et une validation
spécifique le moment venu.

## 15. Ce que cette stratégie ne fait pas

- Ne configure aucun serveur MCP réel.
- Ne choisit aucun connecteur nommé.
- N'active aucune assistance IA.
- Ne modifie aucune route existante.
