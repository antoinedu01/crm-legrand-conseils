// Fonctions PURES extraites de SessionRecommendations.jsx (GATE LOT 7B ciblé
// §9) -- aucune dépendance React/DOM, testables directement via `node
// --test` (test/session-recommendations-pure.test.js) sans framework de
// test frontend. Un seul module réutilisé par le composant ET par les
// tests, jamais une seconde implémentation divergente.

export const CONFLICT_MESSAGE_REC = "Cette recommandation a été modifiée ailleurs (un autre onglet ?) depuis votre dernier chargement — page actualisée.";
export const CONFLICT_MESSAGE_SESSION = 'La session a changé depuis la dernière consultation. Vérifiez les constats avant de valider.';

export function emptyDeclaration() { return { mode: 'unset', text: '', extraText: '' }; }

export function emptyFields() {
  return {
    title: '', advisor_rationale: '', summary: '', expected_benefits: '', limitations: '', warnings: '', reservations: '',
    alternatives: emptyDeclaration(), risks: emptyDeclaration(), missingInfo: emptyDeclaration(),
  };
}

// Détecte une saisie non enregistrée avant de démonter le formulaire
// (constat client-meeting-ux, revues finales Lot 7B) -- compare les champs
// courants à leur état de référence (formulaire vide en création, dernière
// version connue du serveur en édition), jamais un simple drapeau
// approximatif.
export function fieldsAreDirty(fields, baseline) {
  const b = baseline || emptyFields();
  const declDirty = (a, c) => a.mode !== c.mode || a.text !== c.text || a.extraText !== c.extraText;
  return (
    fields.title !== b.title || fields.advisor_rationale !== b.advisor_rationale || fields.summary !== b.summary
    || fields.expected_benefits !== b.expected_benefits || fields.limitations !== b.limitations
    || fields.warnings !== b.warnings || fields.reservations !== b.reservations
    || declDirty(fields.alternatives, b.alternatives) || declDirty(fields.risks, b.risks) || declDirty(fields.missingInfo, b.missingInfo)
  );
}

// Compare deux ensembles de membres ciblés indépendamment de l'ordre (GATE
// LOT 7B ciblé §5) -- `member_ids` n'a jamais de sens ordonné, seule
// l'appartenance à l'ensemble compte.
export function memberIdsEqual(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].map(Number).sort((x, y) => x - y);
  const sb = [...b].map(Number).sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

// Représentation normalisée COMPLÈTE d'un formulaire (GATE LOT 7B ciblé §5)
// : `fieldsAreDirty` seul ne couvrait que les champs narratifs et les trois
// déclarations -- domaine/portée/membres inclus désormais. Si le conseiller
// ramène manuellement toutes les valeurs à leur état initial, le formulaire
// doit redevenir propre -- jamais un booléen basculé définitivement à la
// première frappe.
export function formIsDirty({ fields, domain, scope, memberIds }, baseline) {
  return (
    fieldsAreDirty(fields, baseline.fields)
    || domain !== baseline.domain
    || scope !== baseline.scope
    || !memberIdsEqual(memberIds, baseline.memberIds)
  );
}

export function declarationFromRecommendation(flag, text, extraText) {
  if (flag) return { mode: 'none_identified', text: '', extraText: '' };
  if ((text && text.trim()) || (extraText && extraText.trim())) return { mode: 'described', text: text || '', extraText: extraText || '' };
  return { mode: 'unset', text: '', extraText: '' };
}

// Normalisation formulaire <- recommandation serveur -- jamais un
// préremplissage depuis un finding, uniquement depuis la recommandation
// elle-même (déjà écrite par un humain).
export function fieldsFromRecommendation(rec) {
  return {
    title: rec.title || '', advisor_rationale: rec.advisor_rationale || '', summary: rec.summary || '',
    expected_benefits: rec.expected_benefits || '', limitations: rec.limitations || '',
    warnings: rec.warnings || '', reservations: rec.reservations || '',
    alternatives: declarationFromRecommendation(rec.no_alternatives_identified, rec.alternatives_considered, rec.alternative_rejection_reason),
    risks: declarationFromRecommendation(rec.no_additional_risks_identified, rec.risks, null),
    missingInfo: declarationFromRecommendation(rec.no_missing_information_known, rec.missing_information, null),
  };
}

// Construction du corps de requête <- formulaire -- normalise ('' -> absent)
// pour ne jamais envoyer de chaîne vide là où le serveur attend un champ
// facultatif omis.
export function fieldsToBody(fields) {
  return {
    title: fields.title.trim(),
    advisor_rationale: fields.advisor_rationale.trim(),
    summary: fields.summary.trim() || undefined,
    expected_benefits: fields.expected_benefits.trim() || undefined,
    limitations: fields.limitations.trim() || undefined,
    warnings: fields.warnings.trim() || undefined,
    reservations: fields.reservations.trim() || undefined,
    alternatives_considered: fields.alternatives.text.trim() || undefined,
    alternative_rejection_reason: fields.alternatives.extraText.trim() || undefined,
    no_alternatives_identified: fields.alternatives.mode === 'none_identified',
    risks: fields.risks.text.trim() || undefined,
    no_additional_risks_identified: fields.risks.mode === 'none_identified',
    missing_information: fields.missingInfo.text.trim() || undefined,
    no_missing_information_known: fields.missingInfo.mode === 'none_identified',
  };
}

// Interprétation des codes d'erreur machine stables (GATE LOT 7B ciblé §3)
// -- JAMAIS une correspondance sur le texte français de `err.message`, qui
// n'est pas contractuel. Un code inconnu ou absent retombe sur le message
// serveur brut (jamais un message générique qui masquerait une erreur
// réelle non anticipée).
export function interpretRecommendationError(err) {
  const code = err?.data?.code;
  if (code === 'RECOMMENDATION_REVISION_CONFLICT') return CONFLICT_MESSAGE_REC;
  if (code === 'SESSION_REVISION_CONFLICT') return CONFLICT_MESSAGE_SESSION;
  return err?.message;
}
