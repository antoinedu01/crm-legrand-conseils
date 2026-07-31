// Tests du moteur de conditions d'affichage (Legrand Diagnostic 360, Lot 3A).
// Purement fonctionnel : aucune base de données, aucune dépendance externe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONDITION_OPERATORS, validateConditionFormat, collectDependencies,
  evaluateCondition, detectCycle, findUnknownReferences,
} from '../server/advisoryConditions.js';

test('CONDITION_OPERATORS expose exactement les 12 opérateurs attendus', () => {
  assert.deepEqual(CONDITION_OPERATORS, [
    'equals', 'not_equals', 'in', 'not_in', 'exists', 'not_exists',
    'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal', 'and', 'or',
  ]);
});

// Constat GATE LOT 3A : un JSON and/or imbriqué sur des milliers de niveaux
// faisait déborder la pile d'appel (RangeError non intercepté) avant ce
// correctif — vérifié empiriquement jusqu'à un dépassement réel autour de
// 10 000 niveaux. La profondeur est désormais bornée et rejetée proprement.
test('validateConditionFormat — refuse une profondeur d\'imbrication excessive sans faire déborder la pile', () => {
  function deepAnd(depth) {
    let node = { op: 'equals', ref: { question: 'leaf' }, value: 1 };
    for (let i = 0; i < depth; i++) node = { op: 'and', conditions: [node] };
    return node;
  }
  const shallow = deepAnd(5);
  assert.equal(validateConditionFormat(shallow).valid, true);
  const deep = deepAnd(10000);
  const r = validateConditionFormat(deep);
  assert.equal(r.valid, false);
  assert.match(r.errors[0], /profondeur/);
});

// --- Validation de format --------------------------------------------------

test('validateConditionFormat — accepte une condition equals bien formée', () => {
  const r = validateConditionFormat({ op: 'equals', ref: { question: 'q1' }, value: 'oui' });
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
});

test('validateConditionFormat — refuse un opérateur inconnu (jamais eval/new Function)', () => {
  const r = validateConditionFormat({ op: 'eval', ref: { question: 'q1' } });
  assert.equal(r.valid, false);
  assert.ok(r.errors.length > 0);
});

test('validateConditionFormat — refuse une référence avec deux types à la fois', () => {
  const r = validateConditionFormat({
    op: 'equals', ref: { question: 'q1', session_property: 'domain' }, value: 1,
  });
  assert.equal(r.valid, false);
});

test('validateConditionFormat — refuse une session_property hors liste blanche', () => {
  const r = validateConditionFormat({ op: 'equals', ref: { session_property: 'advisor_user_id' }, value: 1 });
  assert.equal(r.valid, false);
});

test('validateConditionFormat — refuse une member_property hors liste blanche', () => {
  const r = validateConditionFormat({ op: 'equals', ref: { member_property: 'birth_date' }, value: 1 });
  assert.equal(r.valid, false);
});

test('validateConditionFormat — in/not_in exigent un tableau', () => {
  assert.equal(validateConditionFormat({ op: 'in', ref: { question: 'q1' }, value: 'x' }).valid, false);
  assert.equal(validateConditionFormat({ op: 'in', ref: { question: 'q1' }, value: ['x'] }).valid, true);
});

test('validateConditionFormat — exists/not_exists n’exigent aucune valeur', () => {
  assert.equal(validateConditionFormat({ op: 'exists', ref: { question: 'q1' } }).valid, true);
});

test('validateConditionFormat — and/or valident récursivement chaque sous-condition', () => {
  const r = validateConditionFormat({
    op: 'and',
    conditions: [
      { op: 'exists', ref: { question: 'q1' } },
      { op: 'eval', ref: { question: 'q2' } },
    ],
  });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('conditions[1]')));
});

test('validateConditionFormat — and/or refusent une liste vide ou absente', () => {
  assert.equal(validateConditionFormat({ op: 'and', conditions: [] }).valid, false);
  assert.equal(validateConditionFormat({ op: 'or' }).valid, false);
});

// --- Résolution / évaluation -----------------------------------------------

function ctx({ answers = {}, domain, memberRole } = {}) {
  return {
    getAnswer: (k) => answers[k],
    session: { domain },
    member: memberRole ? { member_role: memberRole } : null,
  };
}

test('evaluateCondition — equals vrai/faux selon la valeur', () => {
  const c = ctx({ answers: { q1: { status: 'answered', value: 'oui' } } });
  assert.equal(evaluateCondition({ op: 'equals', ref: { question: 'q1' }, value: 'oui' }, c), true);
  assert.equal(evaluateCondition({ op: 'equals', ref: { question: 'q1' }, value: 'non' }, c), false);
});

test('evaluateCondition — exists vrai seulement si status=answered avec valeur', () => {
  const c = ctx({
    answers: {
      q_answered: { status: 'answered', value: 'x' },
      q_unknown: { status: 'unknown' },
      q_na: { status: 'not_applicable' },
      q_cleared: { status: 'cleared' },
    },
  });
  assert.equal(evaluateCondition({ op: 'exists', ref: { question: 'q_answered' } }, c), true);
  assert.equal(evaluateCondition({ op: 'exists', ref: { question: 'q_unknown' } }, c), false);
  assert.equal(evaluateCondition({ op: 'exists', ref: { question: 'q_na' } }, c), false);
  assert.equal(evaluateCondition({ op: 'exists', ref: { question: 'q_cleared' } }, c), false);
  assert.equal(evaluateCondition({ op: 'exists', ref: { question: 'q_absente' } }, c), false);
});

test('evaluateCondition — toute comparaison (equals ET not_equals) sur une donnée absente est fausse', () => {
  const c = ctx({ answers: { q1: { status: 'unknown' } } });
  assert.equal(evaluateCondition({ op: 'equals', ref: { question: 'q1' }, value: 'x' }, c), false);
  assert.equal(evaluateCondition({ op: 'not_equals', ref: { question: 'q1' }, value: 'x' }, c), false);
  assert.equal(evaluateCondition({ op: 'in', ref: { question: 'q1' }, value: ['x'] }, c), false);
  assert.equal(evaluateCondition({ op: 'greater_than', ref: { question: 'q1' }, value: 0 }, c), false);
});

test('evaluateCondition — in/not_in', () => {
  const c = ctx({ answers: { q1: { status: 'answered', value: 'b' } } });
  assert.equal(evaluateCondition({ op: 'in', ref: { question: 'q1' }, value: ['a', 'b'] }, c), true);
  assert.equal(evaluateCondition({ op: 'not_in', ref: { question: 'q1' }, value: ['a', 'c'] }, c), true);
  assert.equal(evaluateCondition({ op: 'not_in', ref: { question: 'q1' }, value: ['a', 'b'] }, c), false);
});

test('evaluateCondition — comparateurs numériques', () => {
  const c = ctx({ answers: { q1: { status: 'answered', value: 5 } } });
  assert.equal(evaluateCondition({ op: 'greater_than', ref: { question: 'q1' }, value: 3 }, c), true);
  assert.equal(evaluateCondition({ op: 'greater_or_equal', ref: { question: 'q1' }, value: 5 }, c), true);
  assert.equal(evaluateCondition({ op: 'less_than', ref: { question: 'q1' }, value: 5 }, c), false);
  assert.equal(evaluateCondition({ op: 'less_or_equal', ref: { question: 'q1' }, value: 5 }, c), true);
});

test('evaluateCondition — and/or combinent sans court-circuit visible sur le résultat', () => {
  const c = ctx({ answers: { q1: { status: 'answered', value: 'oui' }, q2: { status: 'answered', value: 'non' } } });
  assert.equal(evaluateCondition({
    op: 'and',
    conditions: [{ op: 'equals', ref: { question: 'q1' }, value: 'oui' }, { op: 'equals', ref: { question: 'q2' }, value: 'non' }],
  }, c), true);
  assert.equal(evaluateCondition({
    op: 'or',
    conditions: [{ op: 'equals', ref: { question: 'q1' }, value: 'non' }, { op: 'equals', ref: { question: 'q2' }, value: 'non' }],
  }, c), true);
  assert.equal(evaluateCondition({
    op: 'and',
    conditions: [{ op: 'equals', ref: { question: 'q1' }, value: 'non' }, { op: 'equals', ref: { question: 'q2' }, value: 'non' }],
  }, c), false);
});

test('evaluateCondition — session_property et member_property', () => {
  const c = ctx({ domain: 'mixed', memberRole: 'enfant' });
  assert.equal(evaluateCondition({ op: 'equals', ref: { session_property: 'domain' }, value: 'mixed' }, c), true);
  assert.equal(evaluateCondition({ op: 'equals', ref: { session_property: 'domain' }, value: 'health' }, c), false);
  assert.equal(evaluateCondition({ op: 'equals', ref: { member_property: 'member_role' }, value: 'enfant' }, c), true);
});

test('evaluateCondition — member_property sans membre courant (question de portée non-membre) résout à absent', () => {
  const c = ctx({});
  assert.equal(evaluateCondition({ op: 'exists', ref: { member_property: 'member_role' } }, c), false);
  assert.equal(evaluateCondition({ op: 'not_exists', ref: { member_property: 'member_role' } }, c), true);
});

test('evaluateCondition — absence de condition (null/undefined) = toujours visible', () => {
  assert.equal(evaluateCondition(null, {}), true);
  assert.equal(evaluateCondition(undefined, {}), true);
});

test('evaluateCondition — and/or sans « conditions » ne lève jamais (garde défensive, GATE)', () => {
  assert.doesNotThrow(() => evaluateCondition({ op: 'and' }, {}));
  assert.doesNotThrow(() => evaluateCondition({ op: 'or' }, {}));
  assert.equal(evaluateCondition({ op: 'and' }, {}), true, 'and vide = vacuously true (every sur [])');
  assert.equal(evaluateCondition({ op: 'or' }, {}), false, 'or vide = vacuously false (some sur [])');
});

test('evaluateCondition — déterminisme : même condition + même contexte -> même résultat, à répétition', () => {
  const c = ctx({ answers: { q1: { status: 'answered', value: 'oui' } } });
  const cond = { op: 'equals', ref: { question: 'q1' }, value: 'oui' };
  const results = Array.from({ length: 5 }, () => evaluateCondition(cond, c));
  assert.ok(results.every((r) => r === true));
});

// --- Dépendances / cycles / références inconnues ---------------------------

test('collectDependencies — collecte récursivement à travers and/or', () => {
  const deps = collectDependencies({
    op: 'and',
    conditions: [
      { op: 'exists', ref: { question: 'q1' } },
      { op: 'or', conditions: [{ op: 'equals', ref: { question: 'q2' }, value: 1 }, { op: 'equals', ref: { question: 'q3' }, value: 2 }] },
    ],
  });
  assert.deepEqual([...deps].sort(), ['q1', 'q2', 'q3']);
});

test('collectDependencies — ignore les références session_property/member_property (pas des questions)', () => {
  const deps = collectDependencies({ op: 'equals', ref: { session_property: 'domain' }, value: 'mixed' });
  assert.deepEqual([...deps], []);
});

test('detectCycle — aucun cycle sur un graphe simple en chaîne', () => {
  const cycle = detectCycle([
    { key: 'q1', condition: null },
    { key: 'q2', condition: { op: 'exists', ref: { question: 'q1' } } },
    { key: 'q3', condition: { op: 'exists', ref: { question: 'q2' } } },
  ]);
  assert.equal(cycle, null);
});

test('detectCycle — auto-référence détectée (cycle de taille 1)', () => {
  const cycle = detectCycle([{ key: 'q1', condition: { op: 'exists', ref: { question: 'q1' } } }]);
  assert.ok(cycle);
  assert.ok(cycle.includes('q1'));
});

test('detectCycle — cycle direct entre deux questions détecté', () => {
  const cycle = detectCycle([
    { key: 'q1', condition: { op: 'equals', ref: { question: 'q2' }, value: 1 } },
    { key: 'q2', condition: { op: 'equals', ref: { question: 'q1' }, value: 1 } },
  ]);
  assert.ok(cycle);
});

test('detectCycle — cycle indirect à trois questions détecté', () => {
  const cycle = detectCycle([
    { key: 'q1', condition: { op: 'exists', ref: { question: 'q2' } } },
    { key: 'q2', condition: { op: 'exists', ref: { question: 'q3' } } },
    { key: 'q3', condition: { op: 'exists', ref: { question: 'q1' } } },
  ]);
  assert.ok(cycle);
});

test('detectCycle — une condition de section (nœud source) ne crée jamais de cycle à elle seule', () => {
  const cycle = detectCycle([
    { key: 'q1', condition: null },
    { key: 'q2', condition: { op: 'exists', ref: { question: 'q1' } } },
    { key: 'section:s1', condition: { op: 'exists', ref: { question: 'q2' } } },
  ]);
  assert.equal(cycle, null);
});

test('findUnknownReferences — détecte une clé stable inexistante dans la version', () => {
  const unknown = findUnknownReferences(
    [{ key: 'q1', condition: { op: 'exists', ref: { question: 'q_absente' } } }],
    ['q1'],
  );
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].question, 'q_absente');
});

test('findUnknownReferences — aucune fausse alerte quand toutes les références existent', () => {
  const unknown = findUnknownReferences(
    [{ key: 'q1', condition: { op: 'exists', ref: { question: 'q2' } } }, { key: 'q2', condition: null }],
    ['q1', 'q2'],
  );
  assert.deepEqual(unknown, []);
});
