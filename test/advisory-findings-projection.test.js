// Tests unitaires PURS du module de projection (aucun accès base, aucune
// session, aucune fixture CRM_DATA_DIR nécessaire) — cadrage LOT 7A, sujet
// 1, option D (déduplication de PRÉSENTATION uniquement, jamais à
// l'écriture). Tout le contenu ici est fictif et technique.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectFindings } from '../server/advisoryFindingsProjection.js';

function missingFinding(overrides = {}) {
  return {
    id: 1, finding_type: 'missing_information', finding_scope: 'member', household_member_id: 1,
    priority: 'medium', missing_data: [{ kind: 'answer', stable_key: 'q1' }], member: { id: 1, display_name: 'Membre 1' },
    ...overrides,
  };
}
function substantiveFinding(overrides = {}) {
  return {
    id: 100, finding_type: 'solution_category', finding_scope: 'member', household_member_id: 1,
    priority: 'medium', missing_data: null, member: { id: 1, display_name: 'Membre 1' },
    ...overrides,
  };
}

test('projectFindings — 3 findings missing_information identiques (même membre, même donnée) → 1 seule entrée projetée', () => {
  const findings = [
    missingFinding({ id: 1 }),
    missingFinding({ id: 2 }),
    missingFinding({ id: 3 }),
  ];
  const result = projectFindings(findings);
  const missing = result.filter((f) => f.finding_type === 'missing_information');
  assert.equal(missing.length, 1);
  assert.deepEqual(missing[0].source_finding_ids.sort(), [1, 2, 3]);
});

test('projectFindings — deux membres différents avec la même donnée manquante → deux entrées projetées distinctes', () => {
  const findings = [
    missingFinding({ id: 1, household_member_id: 1, member: { id: 1, display_name: 'A' } }),
    missingFinding({ id: 2, household_member_id: 2, member: { id: 2, display_name: 'B' } }),
  ];
  const result = projectFindings(findings);
  const missing = result.filter((f) => f.finding_type === 'missing_information');
  assert.equal(missing.length, 2);
  assert.deepEqual(missing.map((f) => f.household_member_id).sort(), [1, 2]);
});

test('projectFindings — ensembles de missing_data différents → jamais fusionnés', () => {
  const findings = [
    missingFinding({ id: 1, missing_data: [{ kind: 'answer', stable_key: 'q1' }] }),
    missingFinding({ id: 2, missing_data: [{ kind: 'answer', stable_key: 'q2' }] }),
  ];
  const result = projectFindings(findings);
  const missing = result.filter((f) => f.finding_type === 'missing_information');
  assert.equal(missing.length, 2);
});

test('projectFindings — ensemble PARTIELLEMENT recouvrant (2 refs vs 1 ref) → jamais fusionné', () => {
  const findings = [
    missingFinding({ id: 1, missing_data: [{ kind: 'answer', stable_key: 'q1' }, { kind: 'answer', stable_key: 'q2' }] }),
    missingFinding({ id: 2, missing_data: [{ kind: 'answer', stable_key: 'q1' }] }),
  ];
  const result = projectFindings(findings);
  const missing = result.filter((f) => f.finding_type === 'missing_information');
  assert.equal(missing.length, 2, 'un ensemble à 2 éléments et un ensemble à 1 élément ne sont jamais le même ensemble');
});

test('projectFindings — ordre des stable_keys différent, même ensemble logique → fusion correcte après canonicalisation', () => {
  const findings = [
    missingFinding({ id: 1, missing_data: [{ kind: 'answer', stable_key: 'qA' }, { kind: 'answer', stable_key: 'qB' }] }),
    missingFinding({ id: 2, missing_data: [{ kind: 'answer', stable_key: 'qB' }, { kind: 'answer', stable_key: 'qA' }] }),
  ];
  const result = projectFindings(findings);
  const missing = result.filter((f) => f.finding_type === 'missing_information');
  assert.equal(missing.length, 1, 'même ensemble logique {qA, qB} quel que soit l\'ordre de la liste → une seule entrée');
});

test('projectFindings — titre dérivé de advisor_text de la question manquante, jamais du titre d\'une règle', () => {
  const findings = [missingFinding({ missing_data: [{ kind: 'answer', stable_key: 'ouverture_telemedecine_declaree' }] })];
  const result = projectFindings(findings, {
    describeMissingRef: (ref) => (ref.stable_key === 'ouverture_telemedecine_declaree'
      ? 'Comment vous positionnez-vous face à un modèle nécessitant de contacter d\'abord une télémédecine ?'
      : ref.stable_key),
  });
  const [missing] = result.filter((f) => f.finding_type === 'missing_information');
  assert.match(missing.title, /Comment vous positionnez-vous face à un modèle/);
  assert.doesNotMatch(missing.title, /compatible|préférée|refusée/i, 'jamais un intitulé dérivé d\'un état de règle substantif');
});

test('projectFindings — titre à plusieurs données manquantes liste chaque libellé', () => {
  const findings = [missingFinding({
    missing_data: [{ kind: 'answer', stable_key: 'q1' }, { kind: 'answer', stable_key: 'q2' }],
  })];
  const result = projectFindings(findings, { describeMissingRef: (ref) => `Texte de ${ref.stable_key}` });
  const [missing] = result.filter((f) => f.finding_type === 'missing_information');
  assert.match(missing.title, /Texte de q1/);
  assert.match(missing.title, /Texte de q2/);
});

test('projectFindings — priorité projetée = la plus haute du groupe fusionné', () => {
  const findings = [
    missingFinding({ id: 1, priority: 'low' }),
    missingFinding({ id: 2, priority: 'critical' }),
    missingFinding({ id: 3, priority: 'medium' }),
  ];
  const result = projectFindings(findings);
  const [missing] = result.filter((f) => f.finding_type === 'missing_information');
  assert.equal(missing.priority, 'critical');
});

test('projectFindings — statut projeté = actif dès qu\'au moins un finding brut du groupe est encore actif (même si un autre est écarté)', () => {
  const findings = [
    missingFinding({ id: 1, status: 'dismissed' }),
    missingFinding({ id: 2, status: 'active' }),
    missingFinding({ id: 3, status: 'dismissed' }),
  ];
  const result = projectFindings(findings);
  const [missing] = result.filter((f) => f.finding_type === 'missing_information');
  assert.equal(missing.status, 'active', 'tant qu\'une trace brute du groupe reste active, le groupe reste actif');
});

test('projectFindings — statut projeté = écarté seulement si TOUS les findings bruts du groupe sont écartés (jamais réactivé à tort)', () => {
  const findings = [
    missingFinding({ id: 1, status: 'dismissed' }),
    missingFinding({ id: 2, status: 'dismissed' }),
  ];
  const result = projectFindings(findings);
  const [missing] = result.filter((f) => f.finding_type === 'missing_information');
  assert.equal(missing.status, 'dismissed', 'un constat déjà écarté ne doit jamais réapparaître comme actif dans la projection');
});

test('projectFindings — les findings non missing_information traversent strictement inchangés (même référence, même ordre relatif)', () => {
  const a = substantiveFinding({ id: 101 });
  const b = substantiveFinding({ id: 102 });
  const findings = [a, missingFinding({ id: 1 }), b];
  const result = projectFindings(findings);
  const others = result.filter((f) => f.finding_type !== 'missing_information');
  assert.equal(others.length, 2);
  assert.equal(others[0], a, 'référence strictement identique, aucune copie/mutation');
  assert.equal(others[1], b);
});

test('projectFindings — portée household vs member ne fusionnent jamais, même donnée manquante', () => {
  const findings = [
    missingFinding({ id: 1, finding_scope: 'member', household_member_id: 1 }),
    missingFinding({ id: 2, finding_scope: 'household', household_member_id: null }),
  ];
  const result = projectFindings(findings);
  const missing = result.filter((f) => f.finding_type === 'missing_information');
  assert.equal(missing.length, 2);
});

test('projectFindings — projection_id est synthétique, jamais un id réel de finding', () => {
  const findings = [missingFinding({ id: 42 })];
  const result = projectFindings(findings);
  const [missing] = result.filter((f) => f.finding_type === 'missing_information');
  assert.notEqual(missing.projection_id, 42);
  assert.match(missing.projection_id, /^missing:/);
});

test('projectFindings — une entrée missing_information projetée n\'a JAMAIS de champ `id` (décision humaine : jamais de faux id, seul `projection_id` identifie une entrée fusionnée)', () => {
  const findings = [missingFinding({ id: 7 }), missingFinding({ id: 8 })];
  const [missing] = projectFindings(findings).filter((f) => f.finding_type === 'missing_information');
  assert.equal('id' in missing, false, 'aucun champ id, même hérité du premier finding brut du groupe');
  assert.equal(typeof missing.projection_id, 'string');
});

test('projectFindings — projection_id est STABLE : deux appels sur le même groupe logique produisent le même projection_id (recalculable, jamais un identifiant aléatoire)', () => {
  const findings = [missingFinding({ id: 1 }), missingFinding({ id: 2 })];
  const first = projectFindings(findings).filter((f) => f.finding_type === 'missing_information')[0];
  const second = projectFindings(findings).filter((f) => f.finding_type === 'missing_information')[0];
  assert.equal(first.projection_id, second.projection_id);
});

test('projectFindings — liste vide → liste vide, sans erreur', () => {
  assert.deepEqual(projectFindings([]), []);
});

test('projectFindings — describeMissingRef par défaut retombe sur la clé technique (aucun accès base requis)', () => {
  const findings = [missingFinding({ missing_data: [{ kind: 'answer', stable_key: 'q_technique' }] })];
  const [missing] = projectFindings(findings).filter((f) => f.finding_type === 'missing_information');
  assert.match(missing.title, /q_technique/);
});
