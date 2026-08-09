// Tests d'intégration de la projection de présentation des findings
// (cadrage LOT 7A, sujet 1, option D) via `getSessionFindingsWorkspace` —
// vérifie que la déduplication n'existe QUE dans cette lecture, jamais dans
// ce qui est réellement écrit (`advisory_findings`). Base de test isolée
// (CRM_DATA_DIR), jamais data/**. Tout le contenu ici est fictif et
// technique.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-findings-projection-'));

const { default: db } = await import('../server/db.js');
const { createHousehold, addMember } = await import('../server/advisoryHouseholds.js');
const Q = await import('../server/advisoryQuestionnaires.js');
const S = await import('../server/advisorySessions.js');
const R = await import('../server/advisoryRules.js');
const E = await import('../server/advisoryRuleExecutions.js');

const REQ = { session: { userEmail: 'conseiller-findings-projection@exemple.ch' } };
db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run('conseiller-findings-projection@exemple.ch', 'Conseiller', 'x');

function rev(sessionId) {
  return db.prepare('SELECT revision FROM advisory_sessions WHERE id = ?').get(sessionId).revision;
}
function ensureCompleted(sessionId) {
  const status = db.prepare('SELECT status FROM advisory_sessions WHERE id = ?').get(sessionId).status;
  if (status !== 'completed') S.completeSession(sessionId, rev(sessionId), REQ);
}
function uniqueKey(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}
let clientCounter = 0;
function insertClient() {
  clientCounter += 1;
  return db.prepare('INSERT INTO clients (type, first_name, last_name, status) VALUES (?, ?, ?, ?)')
    .run('particulier', `P${clientCounter}`, 'Test', 'prospect').lastInsertRowid;
}
function findQuestionId(versionId, stableKey) {
  const detail = Q.getVersionDetail(versionId);
  for (const section of detail.sections) for (const q of section.questions) if (q.stable_key === stableKey) return q.id;
  throw new Error('question introuvable');
}
function validRuleData(overrides = {}) {
  return {
    stable_key: uniqueKey('TEST-RULE-PROJECTION'),
    title: 'Règle technique fictive — projection',
    conditions: { op: 'exists', ref: { answer: 'placeholder' } },
    required_data: [],
    result_finding_type: 'solution_category',
    result_payload: { category_hint: 'categorie_projection_fictive' },
    priority: 'medium',
    advisor_explanation: 'Explication technique fictive.',
    source: 'Exemple technique fictif — ne constitue pas un conseil d\'assurance.',
    source_reference: 'REF-PROJECTION-001',
    effective_from: '2020-01-01',
    sort_order: 1,
    ...overrides,
  };
}
function buildTwoMemberHousehold() {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const childClientId = insertClient();
  const { id: childMemberId } = addMember(householdId, { member_role: 'enfant', client_id: childClientId }, REQ);
  const principalMember = db.prepare("SELECT id FROM household_members WHERE household_id = ? AND member_role = 'principal'").get(householdId);
  return { householdId, principalMemberId: principalMember.id, childMemberId };
}
function buildSingleMemberHousehold() {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const principalMember = db.prepare("SELECT id FROM household_members WHERE household_id = ? AND member_role = 'principal'").get(householdId);
  return { householdId, principalMemberId: principalMember.id };
}
// Miroir exact du cas d'usage réel visé (LOT 7A) : une question à choix
// unique (« ouverture_telemedecine_declaree ») et trois règles — compatible/
// préférée/refusée — partageant EXACTEMENT le même required_data.
function buildQuestionnaireAndTrio() {
  const Q_KEY = uniqueKey('ouverture-modele');
  const { id: qid } = Q.createQuestionnaire({ stable_key: uniqueKey('quest-projection'), domain: 'health', name: 'Démo projection' }, REQ);
  const { id: vid } = Q.createDraftVersion(qid, {}, REQ);
  const { id: sid } = Q.upsertSection(vid, { stable_key: 's_membre', title: 'Membre', sort_order: 1, applies_to: 'member' }, REQ);
  const { id: questionId } = Q.upsertQuestion(sid, {
    stable_key: Q_KEY, advisor_text: 'Comment vous positionnez-vous face à ce modèle fictif ?',
    type: 'single_choice', scope: 'member', sort_order: 1,
  }, REQ);
  [['refuse', 'Refusé'], ['accepte', 'Accepté'], ['preferee', 'Préférée']].forEach(([key, label], index) => {
    Q.upsertOption(questionId, { stable_key: key, label, value: key, sort_order: index + 1 }, REQ);
  });
  Q.publishVersion(vid, REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-projection'), domain: 'health', name: 'Ensemble projection fictif' }, REQ);
  for (const [suffix, value] of [['compatible', 'accepte'], ['preferee', 'preferee'], ['refusee', 'refuse']]) {
    R.upsertRule(ruleSetId, validRuleData({
      stable_key: `TEST-RULE-MODELE-${suffix}`,
      conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: Q_KEY }, value } },
      required_data: [{ answer: Q_KEY }],
      finding_scope: 'member',
      result_payload: { category_hint: `modele_${suffix}` },
    }), REQ);
  }
  archiveOtherPublishedForDomain('health', ruleSetId);
  R.publishRuleSet(ruleSetId, REQ);
  return { vid, Q_KEY, ruleSetId };
}
function archiveOtherPublishedForDomain(domain, keepRuleSetId) {
  const keep = db.prepare('SELECT stable_key FROM advisory_rule_sets WHERE id = ?').get(keepRuleSetId);
  const others = db.prepare("SELECT id FROM advisory_rule_sets WHERE domain = ? AND status = 'published' AND stable_key != ?").all(domain, keep.stable_key);
  for (const o of others) R.archiveRuleSet(o.id, REQ);
}
function createAndStartSession(householdId, versionId) {
  const { id: sessionId } = S.createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: versionId, domain: 'health', module_role: 'domain', display_order: 1 }],
  }, REQ);
  S.startSession(sessionId, rev(sessionId), REQ);
  return sessionId;
}
function rawFindingsFor(sessionId) {
  return db.prepare('SELECT * FROM advisory_findings WHERE session_id = ?').all(sessionId);
}

// --- 1. 3 findings bruts identiques pour un même membre → 3 lignes brutes, 1 projetée ---

test('projection — 3 règles partageant required_data, donnée non répondue : 3 lignes BRUTES conservées, 1 entrée PROJETÉE', () => {
  const { householdId, principalMemberId } = buildSingleMemberHousehold();
  const { vid, ruleSetId } = buildQuestionnaireAndTrio();
  const sessionId = createAndStartSession(householdId, vid);
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  const raw = rawFindingsFor(sessionId);
  assert.equal(raw.length, 3, 'les 3 règles écrivent chacune leur ligne technique, sans exception');
  assert.ok(raw.every((f) => f.finding_type === 'missing_information'));

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  const projected = workspace.by_domain.health.findings.filter((f) => f.finding_type === 'missing_information');
  assert.equal(projected.length, 1, 'la projection conseiller fusionne les 3 en 1 seule entrée');
  assert.equal(projected[0].household_member_id, principalMemberId);
  assert.deepEqual(projected[0].source_finding_ids.sort(), raw.map((r) => r.id).sort());
});

// --- 2. Deux membres, même donnée manquante → 2 entrées projetées distinctes ---

test('projection — deux membres avec la même donnée manquante : 2 entrées PROJETÉES distinctes (6 lignes brutes au total)', () => {
  const { householdId, principalMemberId, childMemberId } = buildTwoMemberHousehold();
  const { vid, ruleSetId } = buildQuestionnaireAndTrio();
  const sessionId = createAndStartSession(householdId, vid);
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  const raw = rawFindingsFor(sessionId);
  assert.equal(raw.length, 6, '3 règles × 2 membres, chacune sa ligne technique');

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  const projected = workspace.by_domain.health.findings.filter((f) => f.finding_type === 'missing_information');
  assert.equal(projected.length, 2, 'jamais fusionné entre deux membres différents');
  assert.deepEqual(projected.map((f) => f.household_member_id).sort(), [principalMemberId, childMemberId].sort());
});

// --- 3/7. Findings non missing_information : jamais projetés/altérés ---

test('projection — un membre répond (finding substantif) : le finding brut et projeté restent identiques, jamais dédupliqués ni modifiés', () => {
  const { householdId, principalMemberId } = buildSingleMemberHousehold();
  const { vid, Q_KEY, ruleSetId } = buildQuestionnaireAndTrio();
  const sessionId = createAndStartSession(householdId, vid);
  const qId = findQuestionId(vid, Q_KEY);
  S.recordAnswers(sessionId, [{ question_id: qId, household_member_id: principalMemberId, status: 'answered', value: 'accepte' }], rev(sessionId), REQ);
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  const raw = rawFindingsFor(sessionId);
  assert.equal(raw.length, 1, 'une seule règle se déclenche (compatible), les deux autres restent silencieuses (required_data satisfait, condition fausse)');
  assert.equal(raw[0].finding_type, 'solution_category');

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  const findings = workspace.by_domain.health.findings;
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, raw[0].id, 'finding substantif jamais réécrit, jamais fusionné, id réel conservé');
  assert.equal(findings[0].finding_type, 'solution_category');
});

// --- 4. Canonicalisation : ordre différent, même ensemble logique (déjà couvert au niveau unitaire ; ici via un scénario réel à 2 refs) ---

test('projection — deux règles à required_data de 2 éléments, même ensemble logique dans un ordre différent : fusionnées', () => {
  const { householdId, principalMemberId } = buildSingleMemberHousehold();
  const Q1 = uniqueKey('acc-q1');
  const Q2 = uniqueKey('acc-q2');
  const { id: qid } = Q.createQuestionnaire({ stable_key: uniqueKey('quest-order'), domain: 'health', name: 'Démo ordre' }, REQ);
  const { id: vid } = Q.createDraftVersion(qid, {}, REQ);
  const { id: sid } = Q.upsertSection(vid, { stable_key: 's_membre', title: 'Membre', sort_order: 1, applies_to: 'member' }, REQ);
  Q.upsertQuestion(sid, { stable_key: Q1, advisor_text: 'Question 1 fictive ?', type: 'boolean', scope: 'member', sort_order: 1 }, REQ);
  Q.upsertQuestion(sid, { stable_key: Q2, advisor_text: 'Question 2 fictive ?', type: 'boolean', scope: 'member', sort_order: 2 }, REQ);
  Q.publishVersion(vid, REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-order'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-ORDER-A',
    conditions: { op: 'any', over: 'members', condition: { op: 'and', conditions: [{ op: 'equals', ref: { answer: Q1 }, value: true }, { op: 'equals', ref: { answer: Q2 }, value: true }] } },
    required_data: [{ answer: Q1 }, { answer: Q2 }],
    finding_scope: 'member',
  }), REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-ORDER-B',
    conditions: { op: 'any', over: 'members', condition: { op: 'and', conditions: [{ op: 'equals', ref: { answer: Q1 }, value: false }, { op: 'equals', ref: { answer: Q2 }, value: false }] } },
    required_data: [{ answer: Q2 }, { answer: Q1 }], // ordre inversé
    finding_scope: 'member', sort_order: 2,
  }), REQ);
  archiveOtherPublishedForDomain('health', ruleSetId);
  R.publishRuleSet(ruleSetId, REQ);

  const sessionId = createAndStartSession(householdId, vid);
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  const raw = rawFindingsFor(sessionId);
  assert.equal(raw.length, 2, 'deux règles techniques bloquées, chacune sa ligne');

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  const projected = workspace.by_domain.health.findings.filter((f) => f.finding_type === 'missing_information');
  assert.equal(projected.length, 1, 'même ensemble logique {Q1, Q2} malgré l\'ordre inversé du second required_data : fusionné');
  assert.equal(projected[0].household_member_id, principalMemberId);
});

// --- 5. Titre dérivé de advisor_text ---

test('projection — le titre est dérivé de advisor_text de la question réellement manquante, jamais du titre d\'une règle', () => {
  const { householdId } = buildSingleMemberHousehold();
  const { vid, ruleSetId } = buildQuestionnaireAndTrio();
  const sessionId = createAndStartSession(householdId, vid);
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  const [projected] = workspace.by_domain.health.findings.filter((f) => f.finding_type === 'missing_information');
  assert.match(projected.title, /Comment vous positionnez-vous face à ce modèle fictif/);
  assert.doesNotMatch(projected.title, /compatible|préférée|refusée|Règle technique/i);
});

// --- 6. Priorité projetée = la plus haute du groupe ---

test('projection — priorité projetée = la priorité la plus haute parmi les règles fusionnées', () => {
  const { householdId } = buildSingleMemberHousehold();
  const Q_KEY = uniqueKey('prio-q');
  const { id: qid } = Q.createQuestionnaire({ stable_key: uniqueKey('quest-prio'), domain: 'health', name: 'Démo priorité' }, REQ);
  const { id: vid } = Q.createDraftVersion(qid, {}, REQ);
  const { id: sid } = Q.upsertSection(vid, { stable_key: 's_membre', title: 'Membre', sort_order: 1, applies_to: 'member' }, REQ);
  Q.upsertQuestion(sid, { stable_key: Q_KEY, advisor_text: 'Question priorité fictive ?', type: 'boolean', scope: 'member', sort_order: 1 }, REQ);
  Q.publishVersion(vid, REQ);

  const { id: ruleSetId } = R.createRuleSet({ stable_key: uniqueKey('rs-prio'), domain: 'health', name: 'X' }, REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-PRIO-LOW', priority: 'low',
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: Q_KEY }, value: true } },
    required_data: [{ answer: Q_KEY }], finding_scope: 'member',
  }), REQ);
  R.upsertRule(ruleSetId, validRuleData({
    stable_key: 'TEST-RULE-PRIO-CRITICAL', priority: 'critical', sort_order: 2,
    conditions: { op: 'any', over: 'members', condition: { op: 'equals', ref: { answer: Q_KEY }, value: false } },
    required_data: [{ answer: Q_KEY }], finding_scope: 'member',
  }), REQ);
  archiveOtherPublishedForDomain('health', ruleSetId);
  R.publishRuleSet(ruleSetId, REQ);

  const sessionId = createAndStartSession(householdId, vid);
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  const [projected] = workspace.by_domain.health.findings.filter((f) => f.finding_type === 'missing_information');
  assert.equal(projected.priority, 'critical');
});

// --- 8. Sessions/rule_sets historiques : lignes brutes toujours exactement conservées ---

test('projection — aucune ligne brute n\'est jamais supprimée ni modifiée par la lecture projetée (relecture répétée)', () => {
  const { householdId } = buildSingleMemberHousehold();
  const { vid, ruleSetId } = buildQuestionnaireAndTrio();
  const sessionId = createAndStartSession(householdId, vid);
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  const before = rawFindingsFor(sessionId);
  // Deux lectures successives de la projection ne doivent jamais altérer les lignes brutes.
  E.getSessionFindingsWorkspace(sessionId, REQ);
  E.getSessionFindingsWorkspace(sessionId, REQ);
  const after = rawFindingsFor(sessionId);
  assert.deepEqual(before, after, 'lecture pure : aucune écriture, aucune suppression, aucun UPDATE');

  // La voie d'accès brute reste pleinement disponible et complète.
  const executions = E.listExecutions(sessionId, {}, REQ);
  const detail = E.getExecutionDetail(sessionId, executions[0].id, REQ);
  assert.equal(detail.findings.length, 3, 'getExecutionDetail (voie technique) affiche toujours les 3 lignes brutes, jamais la vue dédupliquée');
});

// --- 9. dismissFinding sur une ligne BRUTE fusionnée : ne doit jamais faire
// réapparaître le groupe comme actif à tort, ni le figer comme écarté tant
// qu'une trace brute reste active (constat des revues rules-engine-auditor
// et advisory-architect sur le correctif initial) ---

test('projection — écarter UNE SEULE des 3 lignes brutes fusionnées : le groupe projeté reste actif (les 2 autres traces sont toujours actives)', () => {
  const { householdId } = buildSingleMemberHousehold();
  const { vid, ruleSetId } = buildQuestionnaireAndTrio();
  const sessionId = createAndStartSession(householdId, vid);
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  const raw = rawFindingsFor(sessionId);
  assert.equal(raw.length, 3);
  E.dismissFinding(sessionId, raw[0].id, { dismiss_reason: 'Motif technique fictif de test.', expected_revision: rev(sessionId) }, REQ);

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  const [projected] = workspace.by_domain.health.findings.filter((f) => f.finding_type === 'missing_information');
  assert.equal(projected.status, 'active', 'deux traces brutes du groupe restent actives : le groupe entier reste actif');
  assert.equal(workspace.synthesis.active_findings_count, 1, 'le groupe compte pour 1 seul constat actif dans la synthèse conseiller');
});

test('projection — écarter les 3 lignes brutes fusionnées : le groupe projeté devient écarté et ne compte plus comme actif', () => {
  const { householdId } = buildSingleMemberHousehold();
  const { vid, ruleSetId } = buildQuestionnaireAndTrio();
  const sessionId = createAndStartSession(householdId, vid);
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  const raw = rawFindingsFor(sessionId);
  assert.equal(raw.length, 3);
  for (const r of raw) {
    E.dismissFinding(sessionId, r.id, { dismiss_reason: 'Motif technique fictif de test.', expected_revision: rev(sessionId) }, REQ);
  }

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  const [projected] = workspace.by_domain.health.findings.filter((f) => f.finding_type === 'missing_information');
  assert.equal(projected.status, 'dismissed', 'un constat entièrement écarté ne doit jamais réapparaître comme actif dans la projection');
  assert.equal(workspace.synthesis.active_findings_count, 0, 'un groupe entièrement écarté ne compte plus dans la synthèse conseiller');

  const rawAfter = rawFindingsFor(sessionId);
  assert.ok(rawAfter.every((f) => f.status === 'dismissed'), 'les 3 lignes brutes restent individuellement tracées comme écartées, jamais fusionnées ni supprimées en base');
});

// --- 10. synthesis.raw_active_findings_count : compteur technique additif,
// distinct de synthesis.active_findings_count (décision humaine explicite,
// suite au correctif Option D) ---

test('projection — synthesis.raw_active_findings_count compte les LIGNES BRUTES actives, distinct de active_findings_count (entrées PROJETÉES)', () => {
  const { householdId } = buildSingleMemberHousehold();
  const { vid, ruleSetId } = buildQuestionnaireAndTrio();
  const sessionId = createAndStartSession(householdId, vid);
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.synthesis.active_findings_count, 1, '1 seule carte visible par le conseiller (3 lignes brutes fusionnées)');
  assert.equal(workspace.synthesis.raw_active_findings_count, 3, 'le compteur technique reflète les 3 lignes advisory_findings réellement actives, avant projection');
});

test('projection — synthesis.raw_active_findings_count reste exact après écartement PARTIEL du groupe (2 lignes brutes actives, 1 carte projetée)', () => {
  const { householdId } = buildSingleMemberHousehold();
  const { vid, ruleSetId } = buildQuestionnaireAndTrio();
  const sessionId = createAndStartSession(householdId, vid);
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: ruleSetId });

  const raw = rawFindingsFor(sessionId);
  E.dismissFinding(sessionId, raw[0].id, { dismiss_reason: 'Motif technique fictif de test.', expected_revision: rev(sessionId) }, REQ);

  const workspace = E.getSessionFindingsWorkspace(sessionId, REQ);
  assert.equal(workspace.synthesis.active_findings_count, 1, 'le groupe compte toujours pour 1 seule carte active (2 lignes brutes encore actives)');
  assert.equal(workspace.synthesis.raw_active_findings_count, 2, 'seules 2 des 3 lignes brutes sont encore actives après un écartement individuel');
});
