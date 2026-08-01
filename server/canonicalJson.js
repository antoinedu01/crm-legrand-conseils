// Canonicalisation JSON partagée — utilisée pour toute empreinte de contenu
// déterministe (content_hash) indépendante des identifiants SQLite, de
// l'ordre physique d'insertion et de l'ordre des clés JSON. Extraite au LOT
// 4A (revue `rules-engine-auditor`) depuis `server/advisoryQuestionnaires.js`
// pour être réutilisée telle quelle par `server/advisoryRules.js`, plutôt que
// dupliquée avec un risque de divergence de comportement entre les deux
// empreintes (questionnaire vs rule set).

// Trie canonique par ordre fonctionnel — jamais par identifiant technique
// SQLite (qui varie entre l'original et un clone, entre deux bases, ou après
// une restauration, sans que le contenu ait changé). `sort_order` prime,
// `stable_key` départage les égalités de façon déterministe et stable dans
// le temps.
export function byCanonicalOrder(a, b) {
  return a.sort_order - b.sort_order || (a.stable_key < b.stable_key ? -1 : a.stable_key > b.stable_key ? 1 : 0);
}

// Canonicalisation récursive d'un objet JSON (condition/validation/résultat) :
// trie les clés d'un objet par ordre alphabétique, conserve l'ordre des
// tableaux (fonctionnellement significatif, ex. une liste de valeurs `in`),
// n'exécute jamais aucun code, ne modifie jamais le contenu stocké en base —
// ce n'est qu'une vue transitoire utilisée uniquement pour le calcul de
// l'empreinte. Aucune dépendance externe : fonction locale minimale.
//
// `Object.create(null)` plutôt que `{}` : une clé JSON littéralement nommée
// `__proto__` affectée par crochets sur un objet héritant d'`Object.prototype`
// réassignerait silencieusement le prototype de `sorted` (l'accesseur hérité
// `__proto__`) au lieu d'y créer une propriété propre — la clé disparaîtrait
// alors silencieusement du résultat. Sans prototype, `sorted.__proto__ = x`
// crée une propriété propre ordinaire comme n'importe quelle autre clé
// (constat vérifié empiriquement pendant le GATE LOT 3A, corrigé par
// prudence).
export function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === 'object') {
    const sorted = Object.create(null);
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalizeJson(value[key]);
    return sorted;
  }
  return value;
}
