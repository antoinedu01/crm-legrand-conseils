// Tests du DSL de conditions du moteur de règles (Legrand Diagnostic 360, Lot 4A).
// Purement fonctionnel : aucune base de données, aucune dépendance externe.
// Exemples fictifs uniquement — ne constituent aucun conseil d'assurance réel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RULE_CONDITION_OPERATORS, MAX_RULE_DEPENDENCY_DEPTH,
  validateRuleConditionFormat, collectRuleDependencies, detectRuleCycle,
  maxDependencyDepth, findUnknownRuleReferences, evaluateRuleCondition,
  refKind, resolveRuleRef, collectDirectAnswerKeys, resolveQuantifierMembers,
} from '../server/advisoryRuleConditions.js';

test('RULE_CONDITION_OPERATORS expose exactement les 16 opérateurs attendus', () => {
  assert.deepEqual(RULE_CONDITION_OPERATORS, [
    'equals', 'not_equals', 'in', 'not_in', 'exists', 'not_exists',
    'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal',
    'contains', 'all', 'any', 'and', 'or', 'not',
  ]);
});

// --- Validation de format ----------------------------------------------------

test('validateRuleConditionFormat — accepte une condition equals bien formée sur une réponse', () => {
  const r = validateRuleConditionFormat({ op: 'equals', ref: { answer: 'TEST-Q-AGE' }, value: 42 });
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
});

test('validateRuleConditionFormat — refuse un opérateur inconnu (jamais eval/new Function)', () => {
  const r = validateRuleConditionFormat({ op: 'eval', ref: { answer: 'TEST-Q-AGE' } });
  assert.equal(r.valid, false);
  assert.match(r.errors[0], /opérateur inconnu/);
});

test('validateRuleConditionFormat — refuse une profondeur d\'imbrication excessive sans faire déborder la pile', () => {
  function deepAnd(depth) {
    let node = { op: 'equals', ref: { answer: 'TEST-Q-LEAF' }, value: 1 };
    for (let i = 0; i < depth; i++) node = { op: 'and', conditions: [node] };
    return node;
  }
  assert.equal(validateRuleConditionFormat(deepAnd(5)).valid, true);
  const r = validateRuleConditionFormat(deepAnd(10000));
  assert.equal(r.valid, false);
  assert.match(r.errors[0], /profondeur/);
});

test('validateRuleConditionFormat — refuse une référence avec deux natures à la fois', () => {
  const r = validateRuleConditionFormat({
    op: 'equals', ref: { answer: 'TEST-Q-AGE', session_property: 'domain' }, value: 1,
  });
  assert.equal(r.valid, false);
});

test('validateRuleConditionFormat — refuse une référence vide', () => {
  const r = validateRuleConditionFormat({ op: 'exists', ref: {} });
  assert.equal(r.valid, false);
});

test('validateRuleConditionFormat — session_property : liste blanche domain/status', () => {
  assert.equal(validateRuleConditionFormat({ op: 'equals', ref: { session_property: 'domain' }, value: 'health' }).valid, true);
  assert.equal(validateRuleConditionFormat({ op: 'equals', ref: { session_property: 'status' }, value: 'active' }).valid, true);
  assert.equal(validateRuleConditionFormat({ op: 'equals', ref: { session_property: 'advisor_user_id' }, value: 1 }).valid, false);
});

test('validateRuleConditionFormat — member_property : liste blanche member_role uniquement', () => {
  assert.equal(validateRuleConditionFormat({ op: 'equals', ref: { member_property: 'member_role' }, value: 'enfant' }).valid, true);
  assert.equal(validateRuleConditionFormat({ op: 'equals', ref: { member_property: 'birth_date' }, value: 1 }).valid, false);
});

test('validateRuleConditionFormat — household_property : liste blanche status uniquement', () => {
  assert.equal(validateRuleConditionFormat({ op: 'equals', ref: { household_property: 'status' }, value: 'active' }).valid, true);
  assert.equal(validateRuleConditionFormat({ op: 'equals', ref: { household_property: 'name' }, value: 'x' }).valid, false);
});

test('validateRuleConditionFormat — contract_branch : liste blanche des 8 branches connues', () => {
  assert.equal(validateRuleConditionFormat({ op: 'equals', ref: { contract_branch: 'lamal' }, value: 'active' }).valid, true);
  assert.equal(validateRuleConditionFormat({ op: 'equals', ref: { contract_branch: 'assurance_bateau' }, value: 'active' }).valid, false);
});

test('validateRuleConditionFormat — answer_status : clé stable non vide requise', () => {
  assert.equal(validateRuleConditionFormat({ op: 'equals', ref: { answer_status: 'TEST-Q-AGE' }, value: 'answered' }).valid, true);
  assert.equal(validateRuleConditionFormat({ op: 'equals', ref: { answer_status: '' }, value: 'answered' }).valid, false);
});

test('validateRuleConditionFormat — rule_result : clé stable non vide requise', () => {
  assert.equal(validateRuleConditionFormat({ op: 'equals', ref: { rule_result: 'TEST-RULE-A' }, value: true }).valid, true);
  assert.equal(validateRuleConditionFormat({ op: 'equals', ref: { rule_result: '' }, value: true }).valid, false);
});

test('validateRuleConditionFormat — in/not_in exigent un tableau', () => {
  assert.equal(validateRuleConditionFormat({ op: 'in', ref: { answer: 'q1' }, value: 'x' }).valid, false);
  assert.equal(validateRuleConditionFormat({ op: 'in', ref: { answer: 'q1' }, value: ['x'] }).valid, true);
});

test('validateRuleConditionFormat — exists/not_exists n\'exigent aucune valeur', () => {
  assert.equal(validateRuleConditionFormat({ op: 'exists', ref: { answer: 'q1' } }).valid, true);
  assert.equal(validateRuleConditionFormat({ op: 'not_exists', ref: { answer: 'q1' } }).valid, true);
});

test('validateRuleConditionFormat — contains exige une value mais ne vérifie pas son type ici', () => {
  assert.equal(validateRuleConditionFormat({ op: 'contains', ref: { answer: 'q1' } }).valid, false);
  assert.equal(validateRuleConditionFormat({ op: 'contains', ref: { answer: 'q1' }, value: 'x' }).valid, true);
});

test('validateRuleConditionFormat — comparateurs numériques refusent une chaîne, même numérique (pas de coercition)', () => {
  const r = validateRuleConditionFormat({ op: 'greater_than', ref: { answer: 'q1' }, value: '300' });
  assert.equal(r.valid, false);
  assert.match(r.errors[0], /nombre/);
  assert.equal(validateRuleConditionFormat({ op: 'greater_than', ref: { answer: 'q1' }, value: 300 }).valid, true);
});

test('validateRuleConditionFormat — and/or valident récursivement chaque sous-condition', () => {
  const r = validateRuleConditionFormat({
    op: 'and',
    conditions: [
      { op: 'exists', ref: { answer: 'q1' } },
      { op: 'eval', ref: { answer: 'q2' } },
    ],
  });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('conditions[1]')));
});

test('validateRuleConditionFormat — and/or refusent une liste vide ou absente', () => {
  assert.equal(validateRuleConditionFormat({ op: 'and', conditions: [] }).valid, false);
  assert.equal(validateRuleConditionFormat({ op: 'or' }).valid, false);
});

test('validateRuleConditionFormat — not exige un objet condition unique, jamais un tableau conditions', () => {
  assert.equal(validateRuleConditionFormat({ op: 'not', condition: { op: 'exists', ref: { answer: 'q1' } } }).valid, true);
  assert.equal(validateRuleConditionFormat({ op: 'not', conditions: [{ op: 'exists', ref: { answer: 'q1' } }] }).valid, false);
});

test('validateRuleConditionFormat — all/any exigent over=members et un condition unique', () => {
  const base = { op: 'equals', ref: { member_property: 'member_role' }, value: 'enfant' };
  assert.equal(validateRuleConditionFormat({ op: 'all', over: 'members', condition: base }).valid, true);
  assert.equal(validateRuleConditionFormat({ op: 'any', over: 'members', condition: base }).valid, true);
  assert.equal(validateRuleConditionFormat({ op: 'all', condition: base }).valid, false, 'over manquant');
  assert.equal(validateRuleConditionFormat({ op: 'all', over: 'contracts', condition: base }).valid, false, 'collection non supportée');
  assert.equal(validateRuleConditionFormat({ op: 'all', over: 'members' }).valid, false, 'condition manquante');
});

// --- Résolution / évaluation -------------------------------------------------

function ctx({
  answers = {}, domain, status, householdStatus, memberRole, members, contractBranches = {}, ruleResults = {},
} = {}) {
  return {
    getAnswer: (k) => answers[k],
    session: (domain != null || status != null) ? { domain, status } : undefined,
    household: householdStatus != null ? { status: householdStatus } : undefined,
    member: memberRole ? { member_role: memberRole } : null,
    members: members || [],
    getContractBranchStatus: (b) => contractBranches[b],
    getRuleResult: (k) => ruleResults[k],
  };
}

test('evaluateRuleCondition — equals/not_equals sur une réponse', () => {
  const c = ctx({ answers: { q1: { status: 'answered', value: 'oui' } } });
  assert.equal(evaluateRuleCondition({ op: 'equals', ref: { answer: 'q1' }, value: 'oui' }, c), true);
  assert.equal(evaluateRuleCondition({ op: 'not_equals', ref: { answer: 'q1' }, value: 'oui' }, c), false);
});

test('evaluateRuleCondition — exists vrai seulement si status=answered avec valeur', () => {
  const c = ctx({
    answers: {
      q_answered: { status: 'answered', value: 'x' },
      q_unknown: { status: 'unknown' },
      q_na: { status: 'not_applicable' },
    },
  });
  assert.equal(evaluateRuleCondition({ op: 'exists', ref: { answer: 'q_answered' } }, c), true);
  assert.equal(evaluateRuleCondition({ op: 'exists', ref: { answer: 'q_unknown' } }, c), false);
  assert.equal(evaluateRuleCondition({ op: 'exists', ref: { answer: 'q_na' } }, c), false);
  assert.equal(evaluateRuleCondition({ op: 'exists', ref: { answer: 'q_absente' } }, c), false);
  assert.equal(evaluateRuleCondition({ op: 'not_exists', ref: { answer: 'q_absente' } }, c), true);
});

test('evaluateRuleCondition — answer_status expose le statut explicite, toujours présent, "absent" si aucune ligne', () => {
  const c = ctx({ answers: { q1: { status: 'not_applicable' } } });
  assert.equal(evaluateRuleCondition({ op: 'equals', ref: { answer_status: 'q1' }, value: 'not_applicable' }, c), true);
  assert.equal(evaluateRuleCondition({ op: 'equals', ref: { answer_status: 'q_absente' }, value: 'absent' }, c), true);
});

test('evaluateRuleCondition — toute comparaison sur une donnée absente est fausse, jamais de vérité par défaut', () => {
  const c = ctx({ answers: { q1: { status: 'unknown' } } });
  assert.equal(evaluateRuleCondition({ op: 'equals', ref: { answer: 'q1' }, value: 'x' }, c), false);
  assert.equal(evaluateRuleCondition({ op: 'not_equals', ref: { answer: 'q1' }, value: 'x' }, c), false);
  assert.equal(evaluateRuleCondition({ op: 'in', ref: { answer: 'q1' }, value: ['x'] }, c), false);
  assert.equal(evaluateRuleCondition({ op: 'greater_than', ref: { answer: 'q1' }, value: 0 }, c), false);
  assert.equal(evaluateRuleCondition({ op: 'contains', ref: { answer: 'q1' }, value: 'x' }, c), false);
});

test('evaluateRuleCondition — in/not_in', () => {
  const c = ctx({ answers: { q1: { status: 'answered', value: 'b' } } });
  assert.equal(evaluateRuleCondition({ op: 'in', ref: { answer: 'q1' }, value: ['a', 'b'] }, c), true);
  assert.equal(evaluateRuleCondition({ op: 'not_in', ref: { answer: 'q1' }, value: ['a', 'b'] }, c), false);
});

test('evaluateRuleCondition — comparateurs numériques stricts', () => {
  const c = ctx({ answers: { q1: { status: 'answered', value: 5 } } });
  assert.equal(evaluateRuleCondition({ op: 'greater_than', ref: { answer: 'q1' }, value: 3 }, c), true);
  assert.equal(evaluateRuleCondition({ op: 'greater_or_equal', ref: { answer: 'q1' }, value: 5 }, c), true);
  assert.equal(evaluateRuleCondition({ op: 'less_than', ref: { answer: 'q1' }, value: 5 }, c), false);
  assert.equal(evaluateRuleCondition({ op: 'less_or_equal', ref: { answer: 'q1' }, value: 5 }, c), true);
});

test('evaluateRuleCondition — comparateurs numériques : défense en profondeur, valeur non numérique -> false sans exception', () => {
  const c = ctx({ answers: { q1: { status: 'answered', value: 'cinq' } } });
  assert.doesNotThrow(() => evaluateRuleCondition({ op: 'greater_than', ref: { answer: 'q1' }, value: 3 }, c));
  assert.equal(evaluateRuleCondition({ op: 'greater_than', ref: { answer: 'q1' }, value: 3 }, c), false);
});

test('evaluateRuleCondition — contains sur tableau et sur chaîne', () => {
  const cArr = ctx({ answers: { q1: { status: 'answered', value: ['a', 'b'] } } });
  assert.equal(evaluateRuleCondition({ op: 'contains', ref: { answer: 'q1' }, value: 'b' }, cArr), true);
  assert.equal(evaluateRuleCondition({ op: 'contains', ref: { answer: 'q1' }, value: 'z' }, cArr), false);
  const cStr = ctx({ answers: { q1: { status: 'answered', value: 'bonjour' } } });
  assert.equal(evaluateRuleCondition({ op: 'contains', ref: { answer: 'q1' }, value: 'jour' }, cStr), true);
});

test('evaluateRuleCondition — and/or/not', () => {
  const c = ctx({ answers: { q1: { status: 'answered', value: 'oui' }, q2: { status: 'answered', value: 'non' } } });
  assert.equal(evaluateRuleCondition({
    op: 'and',
    conditions: [{ op: 'equals', ref: { answer: 'q1' }, value: 'oui' }, { op: 'equals', ref: { answer: 'q2' }, value: 'non' }],
  }, c), true);
  assert.equal(evaluateRuleCondition({
    op: 'or',
    conditions: [{ op: 'equals', ref: { answer: 'q1' }, value: 'non' }, { op: 'equals', ref: { answer: 'q2' }, value: 'non' }],
  }, c), true);
  assert.equal(evaluateRuleCondition({ op: 'not', condition: { op: 'equals', ref: { answer: 'q1' }, value: 'oui' } }, c), false);
});

test('evaluateRuleCondition — and vide vacuously true, or vide vacuously false', () => {
  assert.equal(evaluateRuleCondition({ op: 'and' }, {}), true);
  assert.equal(evaluateRuleCondition({ op: 'or' }, {}), false);
});

test('evaluateRuleCondition — session_property (domain ET status), household_property, member_property', () => {
  const c = ctx({ domain: 'mixed', status: 'in_progress', householdStatus: 'active', memberRole: 'enfant' });
  assert.equal(evaluateRuleCondition({ op: 'equals', ref: { session_property: 'domain' }, value: 'mixed' }, c), true);
  assert.equal(evaluateRuleCondition({ op: 'equals', ref: { session_property: 'status' }, value: 'in_progress' }, c), true);
  assert.equal(evaluateRuleCondition({ op: 'equals', ref: { household_property: 'status' }, value: 'active' }, c), true);
  assert.equal(evaluateRuleCondition({ op: 'equals', ref: { member_property: 'member_role' }, value: 'enfant' }, c), true);
});

test('evaluateRuleCondition — member_property sans membre courant résout à absent', () => {
  const c = ctx({});
  assert.equal(evaluateRuleCondition({ op: 'exists', ref: { member_property: 'member_role' } }, c), false);
  assert.equal(evaluateRuleCondition({ op: 'not_exists', ref: { member_property: 'member_role' } }, c), true);
});

test('evaluateRuleCondition — contract_branch : projection minimale (status uniquement), absente si aucun contrat', () => {
  const c = ctx({ contractBranches: { lamal: 'active' } });
  assert.equal(evaluateRuleCondition({ op: 'equals', ref: { contract_branch: 'lamal' }, value: 'active' }, c), true);
  assert.equal(evaluateRuleCondition({ op: 'exists', ref: { contract_branch: 'lca' } }, c), false);
});

test('evaluateRuleCondition — rule_result référence le résultat booléen d\'une autre règle', () => {
  const c = ctx({ ruleResults: { 'TEST-RULE-A': true } });
  assert.equal(evaluateRuleCondition({ op: 'equals', ref: { rule_result: 'TEST-RULE-A' }, value: true }, c), true);
  assert.equal(evaluateRuleCondition({ op: 'exists', ref: { rule_result: 'TEST-RULE-INCONNUE' } }, c), false);
});

test('evaluateRuleCondition — all : vrai si tous les membres satisfont, vacuously vrai si aucun membre', () => {
  const condition = { op: 'all', over: 'members', condition: { op: 'equals', ref: { member_property: 'member_role' }, value: 'enfant' } };
  assert.equal(evaluateRuleCondition(condition, ctx({ members: [{ member_role: 'enfant' }, { member_role: 'enfant' }] })), true);
  assert.equal(evaluateRuleCondition(condition, ctx({ members: [{ member_role: 'enfant' }, { member_role: 'conjoint' }] })), false);
  assert.equal(evaluateRuleCondition(condition, ctx({ members: [] })), true, 'all sur collection vide = vacuously true');
});

test('evaluateRuleCondition — all/any : getAnswer reçoit le membre courant, permet une réponse de portée membre différente par membre', () => {
  // Simule une question de portée « member » : deux membres, deux réponses distinctes.
  const answersByMember = { 1: { status: 'answered', value: true }, 2: { status: 'answered', value: false } };
  const c = {
    getAnswer: (key, member) => (key === 'a_un_probleme' && member ? answersByMember[member.id] : undefined),
    members: [{ id: 1, member_role: 'principal' }, { id: 2, member_role: 'conjoint' }],
  };
  const condition = { op: 'all', over: 'members', condition: { op: 'equals', ref: { answer: 'a_un_probleme' }, value: true } };
  assert.equal(evaluateRuleCondition(condition, c), false, 'un membre a la valeur false, all doit échouer');
  const anyCondition = { ...condition, op: 'any' };
  assert.equal(evaluateRuleCondition(anyCondition, c), true, 'au moins un membre (id 1) a la valeur true');
});

test('evaluateRuleCondition — any : vrai si au moins un membre satisfait, vacuously faux si aucun membre', () => {
  const condition = { op: 'any', over: 'members', condition: { op: 'equals', ref: { member_property: 'member_role' }, value: 'enfant' } };
  assert.equal(evaluateRuleCondition(condition, ctx({ members: [{ member_role: 'conjoint' }, { member_role: 'enfant' }] })), true);
  assert.equal(evaluateRuleCondition(condition, ctx({ members: [{ member_role: 'conjoint' }] })), false);
  assert.equal(evaluateRuleCondition(condition, ctx({ members: [] })), false, 'any sur collection vide = vacuously false');
});

test('evaluateRuleCondition — absence de condition (null/undefined) = toujours vraie', () => {
  assert.equal(evaluateRuleCondition(null, {}), true);
  assert.equal(evaluateRuleCondition(undefined, {}), true);
});

test('evaluateRuleCondition — déterminisme : même condition + même contexte -> même résultat, à répétition', () => {
  const c = ctx({ answers: { q1: { status: 'answered', value: 'oui' } } });
  const cond = { op: 'equals', ref: { answer: 'q1' }, value: 'oui' };
  const results = Array.from({ length: 5 }, () => evaluateRuleCondition(cond, c));
  assert.ok(results.every((r) => r === true));
});

// --- refKind / resolveRuleRef (exportés pour server/advisoryRules.js) -------

test('refKind — identifie chacune des 7 natures de référence, null si mal formée', () => {
  assert.equal(refKind({ answer: 'q1' }), 'answer');
  assert.equal(refKind({ answer_status: 'q1' }), 'answer_status');
  assert.equal(refKind({ session_property: 'domain' }), 'session_property');
  assert.equal(refKind({ member_property: 'member_role' }), 'member_property');
  assert.equal(refKind({ household_property: 'status' }), 'household_property');
  assert.equal(refKind({ contract_branch: 'lamal' }), 'contract_branch');
  assert.equal(refKind({ rule_result: 'TEST-RULE-A' }), 'rule_result');
  assert.equal(refKind({ answer: 'q1', rule_result: 'TEST-RULE-A' }), null);
  assert.equal(refKind({}), null);
  assert.equal(refKind(null), null);
});

test('resolveRuleRef — résout une référence answer présente/absente, identique à evaluateRuleCondition en interne', () => {
  const context = { getAnswer: (k) => (k === 'q1' ? { status: 'answered', value: 42 } : undefined) };
  assert.deepEqual(resolveRuleRef({ answer: 'q1' }, context), { present: true, value: 42 });
  assert.deepEqual(resolveRuleRef({ answer: 'q_absente' }, context), { present: false, value: undefined });
});

// --- resolveQuantifierMembers (GATE LOT 4A §3, finding_scope = member) -----

test('resolveQuantifierMembers — any : retourne exactement les membres qui satisfont, ni plus ni moins', () => {
  const condition = { op: 'any', over: 'members', condition: { op: 'equals', ref: { member_property: 'member_role' }, value: 'enfant' } };
  const members = [{ id: 1, member_role: 'principal' }, { id: 2, member_role: 'enfant' }, { id: 3, member_role: 'enfant' }];
  const matches = resolveQuantifierMembers(condition, { members });
  assert.deepEqual(matches.map((m) => m.id), [2, 3]);
});

test('resolveQuantifierMembers — all : si TOUS satisfont, retourne tous les membres (chacun est un match)', () => {
  const condition = { op: 'all', over: 'members', condition: { op: 'equals', ref: { member_property: 'member_role' }, value: 'enfant' } };
  const members = [{ id: 1, member_role: 'enfant' }, { id: 2, member_role: 'enfant' }];
  const matches = resolveQuantifierMembers(condition, { members });
  assert.deepEqual(matches.map((m) => m.id), [1, 2]);
});

test('resolveQuantifierMembers — all : si un seul membre échoue, AUCUN match (jamais une attribution partielle)', () => {
  const condition = { op: 'all', over: 'members', condition: { op: 'equals', ref: { member_property: 'member_role' }, value: 'enfant' } };
  const members = [{ id: 1, member_role: 'enfant' }, { id: 2, member_role: 'principal' }];
  const matches = resolveQuantifierMembers(condition, { members });
  assert.deepEqual(matches, []);
});

test('resolveQuantifierMembers — zéro membre dans le contexte -> toujours un tableau vide (any comme all)', () => {
  const anyCondition = { op: 'any', over: 'members', condition: { op: 'equals', ref: { member_property: 'member_role' }, value: 'enfant' } };
  const allCondition = { op: 'all', over: 'members', condition: { op: 'equals', ref: { member_property: 'member_role' }, value: 'enfant' } };
  assert.deepEqual(resolveQuantifierMembers(anyCondition, { members: [] }), []);
  assert.deepEqual(resolveQuantifierMembers(allCondition, { members: [] }), []);
});

// --- collectDirectAnswerKeys (GATE LOT 4A, revue rules-engine-auditor) -----

test('collectDirectAnswerKeys — collecte une référence directe, hors de tout quantificateur', () => {
  const keys = collectDirectAnswerKeys({
    op: 'and',
    conditions: [
      { op: 'exists', ref: { answer: 'q1' } },
      { op: 'not', condition: { op: 'equals', ref: { answer_status: 'q2' }, value: 'answered' } },
    ],
  });
  assert.deepEqual([...keys].sort(), ['q1', 'q2']);
});

test('collectDirectAnswerKeys — exclut toute référence sous all/any, y compris imbriquée', () => {
  const keys = collectDirectAnswerKeys({
    op: 'and',
    conditions: [
      { op: 'exists', ref: { answer: 'direct' } },
      { op: 'all', over: 'members', condition: { op: 'and', conditions: [{ op: 'exists', ref: { answer: 'sous_quantificateur' } }] } },
    ],
  });
  assert.deepEqual([...keys], ['direct']);
});

test('collectDirectAnswerKeys — une référence rule_result n\'est jamais collectée (pas une clé de question)', () => {
  const keys = collectDirectAnswerKeys({ op: 'equals', ref: { rule_result: 'TEST-RULE-A' }, value: true });
  assert.deepEqual([...keys], []);
});

// --- Dépendances (questions ET règles) ---------------------------------------

test('collectRuleDependencies — sépare questionKeys et ruleKeys, collecte récursivement à travers and/or/not/all/any', () => {
  const deps = collectRuleDependencies({
    op: 'and',
    conditions: [
      { op: 'exists', ref: { answer: 'q1' } },
      { op: 'not', condition: { op: 'equals', ref: { answer_status: 'q2' }, value: 'answered' } },
      { op: 'all', over: 'members', condition: { op: 'equals', ref: { rule_result: 'TEST-RULE-A' }, value: true } },
      { op: 'or', conditions: [{ op: 'equals', ref: { rule_result: 'TEST-RULE-B' }, value: true }] },
    ],
  });
  assert.deepEqual([...deps.questionKeys].sort(), ['q1', 'q2']);
  assert.deepEqual([...deps.ruleKeys].sort(), ['TEST-RULE-A', 'TEST-RULE-B']);
});

test('collectRuleDependencies — ignore les références session_property/member_property/household_property/contract_branch', () => {
  const deps = collectRuleDependencies({ op: 'equals', ref: { session_property: 'domain' }, value: 'mixed' });
  assert.deepEqual([...deps.questionKeys], []);
  assert.deepEqual([...deps.ruleKeys], []);
});

// --- Cycles et profondeur -----------------------------------------------------

test('detectRuleCycle — aucun cycle sur un graphe en chaîne', () => {
  const cycle = detectRuleCycle([
    { key: 'TEST-RULE-A', ruleKeys: [] },
    { key: 'TEST-RULE-B', ruleKeys: ['TEST-RULE-A'] },
    { key: 'TEST-RULE-C', ruleKeys: ['TEST-RULE-B'] },
  ]);
  assert.equal(cycle, null);
});

test('detectRuleCycle — auto-référence détectée (cycle de taille 1)', () => {
  const cycle = detectRuleCycle([{ key: 'TEST-RULE-A', ruleKeys: ['TEST-RULE-A'] }]);
  assert.ok(cycle);
  assert.ok(cycle.includes('TEST-RULE-A'));
});

test('detectRuleCycle — cycle direct entre deux règles détecté', () => {
  const cycle = detectRuleCycle([
    { key: 'TEST-RULE-A', ruleKeys: ['TEST-RULE-B'] },
    { key: 'TEST-RULE-B', ruleKeys: ['TEST-RULE-A'] },
  ]);
  assert.ok(cycle);
});

test('detectRuleCycle — cycle indirect à trois règles détecté', () => {
  const cycle = detectRuleCycle([
    { key: 'TEST-RULE-A', ruleKeys: ['TEST-RULE-B'] },
    { key: 'TEST-RULE-B', ruleKeys: ['TEST-RULE-C'] },
    { key: 'TEST-RULE-C', ruleKeys: ['TEST-RULE-A'] },
  ]);
  assert.ok(cycle);
});

test('detectRuleCycle — référence vers une règle inconnue n\'est pas confondue avec un cycle', () => {
  const cycle = detectRuleCycle([{ key: 'TEST-RULE-A', ruleKeys: ['TEST-RULE-INCONNUE'] }]);
  assert.equal(cycle, null);
});

test('maxDependencyDepth — chaîne de longueur N a une profondeur N', () => {
  const nodes = [
    { key: 'TEST-RULE-A', ruleKeys: [] },
    { key: 'TEST-RULE-B', ruleKeys: ['TEST-RULE-A'] },
    { key: 'TEST-RULE-C', ruleKeys: ['TEST-RULE-B'] },
  ];
  assert.equal(maxDependencyDepth(nodes), 2);
});

test('maxDependencyDepth — sans dépendance, profondeur 0', () => {
  assert.equal(maxDependencyDepth([{ key: 'TEST-RULE-A', ruleKeys: [] }]), 0);
});

test(`maxDependencyDepth — signale une chaîne dépassant MAX_RULE_DEPENDENCY_DEPTH (${MAX_RULE_DEPENDENCY_DEPTH})`, () => {
  const n = MAX_RULE_DEPENDENCY_DEPTH + 2;
  const nodes = Array.from({ length: n }, (_, i) => ({
    key: `TEST-RULE-${i}`,
    ruleKeys: i === 0 ? [] : [`TEST-RULE-${i - 1}`],
  }));
  assert.ok(maxDependencyDepth(nodes) > MAX_RULE_DEPENDENCY_DEPTH);
});

test('maxDependencyDepth — ne boucle jamais sur un graphe cyclique (le cycle est signalé séparément par detectRuleCycle)', () => {
  const nodes = [
    { key: 'TEST-RULE-A', ruleKeys: ['TEST-RULE-B'] },
    { key: 'TEST-RULE-B', ruleKeys: ['TEST-RULE-A'] },
  ];
  assert.doesNotThrow(() => maxDependencyDepth(nodes));
});

test('findUnknownRuleReferences — détecte une clé de règle inexistante dans le rule_set', () => {
  const unknown = findUnknownRuleReferences(
    [{ key: 'TEST-RULE-A', ruleKeys: ['TEST-RULE-INCONNUE'] }],
    ['TEST-RULE-A'],
  );
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].rule, 'TEST-RULE-INCONNUE');
});

test('findUnknownRuleReferences — aucune fausse alerte quand toutes les références existent', () => {
  const unknown = findUnknownRuleReferences(
    [{ key: 'TEST-RULE-A', ruleKeys: ['TEST-RULE-B'] }, { key: 'TEST-RULE-B', ruleKeys: [] }],
    ['TEST-RULE-A', 'TEST-RULE-B'],
  );
  assert.deepEqual(unknown, []);
});
