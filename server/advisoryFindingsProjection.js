// Projection de présentation des findings — fonctions PURES, sans accès
// base de données, sans effet de bord (Legrand Diagnostic 360). Objectif
// unique : transformer une liste de findings BRUTS (tels qu'écrits en base,
// jamais modifiés ni supprimés) en une représentation dédupliquée destinée
// au conseiller, où plusieurs findings `missing_information` bloqués par
// EXACTEMENT la même donnée manquante, pour le même membre (ou le même
// foyer), sont regroupés en une seule entrée.
//
// Décision humaine (cadrage LOT 7A, sujet 1, option D retenue explicitement
// contre l'option C) : cette déduplication n'existe JAMAIS au moment de
// l'écriture. `server/advisoryRuleExecutions.js` continue d'écrire un
// finding technique brut par règle bloquée, sans exception, y compris pour
// du contenu déjà publié (v1) — la reproductibilité d'une ré-exécution
// historique reste donc garantie à l'identique. Seule la LECTURE côté
// conseiller passe par `projectFindings` ci-dessous. Toute route qui a
// besoin d'un identifiant de finding RÉEL (écarter un constat, lier un
// constat à une recommandation, consulter l'historique complet) doit
// continuer à lire `advisory_findings` directement, jamais cette
// projection — voir le commentaire d'audit dans
// `getSessionFindingsWorkspace` (server/advisoryRuleExecutions.js).
//
// Réutilisable tel quel par un futur module de synthèse (LOT 7B,
// `advisoryRecommendationSynthesis.js`) : aucune dépendance à Express, à
// SQLite, ni au format exact d'un finding autre que les champs lus
// ci-dessous.

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];

function highestPriority(priorities) {
  for (const p of PRIORITY_ORDER) {
    if (priorities.includes(p)) return p;
  }
  return priorities[0] ?? 'medium';
}

// Signature canonique d'un ensemble de références manquantes — insensible à
// l'ordre (deux règles listant les mêmes données dans un ordre différent
// doivent fusionner), sensible au contenu exact (deux ensembles
// partiellement différents ne fusionnent jamais).
function missingRefKey(ref) {
  return ref && ref.kind === 'contract_branch'
    ? `contract_branch:${ref.contract_branch}`
    : `answer:${ref?.stable_key ?? ''}`;
}
function missingDataSignature(missingData) {
  return [...(missingData || [])].map(missingRefKey).sort().join('|');
}

// Clé de regroupement minimale demandée : portée + membre concerné (ou
// « household » pour une référence de portée foyer) + ensemble canonique
// des données manquantes. Ne fusionne jamais deux membres différents, ni
// deux ensembles de données manquantes différents (la signature complète
// doit correspondre EXACTEMENT, jamais un simple recoupement partiel).
function groupKey(finding) {
  return [
    finding.finding_scope || 'household',
    finding.household_member_id ?? 'household',
    missingDataSignature(finding.missing_data),
  ].join('::');
}

// `describeMissingRef` (optionnel) transforme une référence manquante
// ({kind:'answer', stable_key, ...} ou {kind:'contract_branch', ...}) en
// texte lisible par le conseiller — typiquement `advisor_text` de la
// question réellement manquante, jamais le titre d'une règle. Par défaut,
// retombe sur la clé technique (utile pour les tests unitaires isolés, sans
// jamais dépendre d'un accès base ici).
function defaultDescribe(ref) {
  return ref?.stable_key || ref?.contract_branch || 'donnée inconnue';
}

// Statut projeté du groupe : ACTIF dès qu'au moins un finding brut du
// groupe est encore actif (donnée toujours manquante pour au moins une
// trace technique) — jamais figé. Un groupe entièrement écarté (tous ses
// findings bruts à `dismissed`) est projeté comme écarté, pour ne jamais
// faire réapparaître comme actif un constat que le conseiller a déjà
// traité (constat rules-engine-auditor : un `status` figé à `'active'`
// ferait réapparaître un `missing_information` déjà écarté, et fausserait
// `synthesis.active_findings_count`). Un finding brut sans `status` défini
// (fixture de test isolée) est traité comme actif, conformément au défaut
// réel de la colonne `advisory_findings.status`.
function groupStatus(group) {
  return group.some((f) => (f.status ?? 'active') === 'active') ? 'active' : 'dismissed';
}

// Fonction principale, pure : `findings` (bruts, hydratés ou non — seuls les
// champs `finding_type`/`finding_scope`/`household_member_id`/`missing_data`/
// `priority`/`id`/`member` sont lus) → nouvelle liste, jamais une mutation
// des entrées d'origine. Les findings non `missing_information` traversent
// STRICTEMENT inchangés, dans leur ordre d'origine ; les entrées
// `missing_information` regroupées apparaissent ensuite, triées par
// priorité (la plus haute d'abord parmi le groupe fusionné).
export function projectFindings(findings, { describeMissingRef = defaultDescribe } = {}) {
  const others = [];
  const groups = new Map();

  for (const finding of findings) {
    if (finding.finding_type !== 'missing_information') {
      others.push(finding);
      continue;
    }
    const key = groupKey(finding);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(finding);
  }

  const projectedMissing = [...groups.values()]
    .map((group) => {
      const first = group[0];
      const missingData = first.missing_data || [];
      const labels = missingData.map((ref) => describeMissingRef(ref));
      const title = labels.length <= 1
        ? `Information manquante : ${labels[0] ?? ''}`
        : `Informations manquantes : ${labels.join(' ; ')}`;
      return {
        // Identifiant SYNTHÉTIQUE de la projection — jamais un id réel de
        // `advisory_findings`. Ne jamais utiliser cette valeur pour écarter
        // un constat ou le lier à une recommandation : ces actions exigent
        // un id brut, lu directement depuis `advisory_findings` (voir
        // en-tête de fichier).
        projection_id: `missing:${groupKey(first)}`,
        finding_type: 'missing_information',
        finding_scope: first.finding_scope,
        household_member_id: first.household_member_id ?? null,
        member: first.member ?? null,
        priority: highestPriority(group.map((f) => f.priority)),
        title,
        summary: labels.length <= 1 ? '1 donnée manquante.' : `${labels.length} données manquantes.`,
        missing_data: missingData,
        status: groupStatus(group),
        // Traçabilité : IDs des findings bruts réellement fusionnés dans
        // cette entrée — jamais une garantie d'exhaustivité substitutive à
        // `advisory_findings` lui-même, seulement un raccourci de navigation.
        source_finding_ids: group.map((f) => f.id).filter((id) => id != null),
      };
    })
    .sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority));

  return [...others, ...projectedMissing];
}
