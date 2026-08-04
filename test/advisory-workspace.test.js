// Tests du service métier « projection du workspace de rendez-vous »
// (Legrand Diagnostic 360, Lot 3B). Base de test isolée (CRM_DATA_DIR),
// jamais data/**. Aucune donnée client réelle, questionnaires fictifs
// uniquement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-workspace-'));

const { default: db } = await import('../server/db.js');
const { createHousehold, addMember, removeMember, AdvisoryError } = await import('../server/advisoryHouseholds.js');
const Q = await import('../server/advisoryQuestionnaires.js');
const {
  createSession, startSession, suspendSession, cancelSession, completeSession,
  recordAnswers, clearAnswer, getSessionWorkspace, listAnswerHistory,
} = await import('../server/advisorySessions.js');

const REQ = { session: { userEmail: 'conseiller@exemple.ch' } };
db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run('conseiller@exemple.ch', 'Conseiller', 'x');

// Lit la révision réelle courante d'une session -- fournit `expected_revision`
// (contrôle de concurrence optimiste, GATE LOT 3B §2) à chaque écriture.
function rev(sessionId) {
  return db.prepare('SELECT revision FROM advisory_sessions WHERE id = ?').get(sessionId).revision;
}

let clientCounter = 0;
function insertClient(over = {}) {
  clientCounter += 1;
  const data = { type: 'particulier', first_name: `P${clientCounter}`, last_name: 'Test', status: 'prospect', ...over };
  return db
    .prepare('INSERT INTO clients (type, first_name, last_name, status) VALUES (?, ?, ?, ?)')
    .run(data.type, data.first_name, data.last_name, data.status).lastInsertRowid;
}

function buildHousehold() {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  return householdId;
}

function addConjoint(householdId) {
  const clientId = insertClient();
  const { id: memberId } = addMember(householdId, { member_role: 'conjoint', client_id: clientId }, REQ);
  return memberId;
}

let questionnaireCounter = 0;
function buildPublishedQuestionnaire(domain, { required = true, memberScope = false, allowsNotApplicable = false, allowsUnknown = true, condition } = {}) {
  questionnaireCounter += 1;
  const { id: qid } = Q.createQuestionnaire({ stable_key: `wk-${domain}-${questionnaireCounter}`, domain, name: `Démo ${domain} ${questionnaireCounter}` }, REQ);
  const { id: vid } = Q.createDraftVersion(qid, {}, REQ);
  const { id: sectionId } = Q.upsertSection(vid, {
    stable_key: 'section1', title: 'Section', sort_order: 1, applies_to: memberScope ? 'member' : 'household',
  }, REQ);
  const { id: questionId } = Q.upsertQuestion(sectionId, {
    stable_key: 'q1', advisor_text: 'Question fictive ?', type: 'boolean', required,
    sort_order: 1, scope: memberScope ? 'member' : 'household',
    allows_not_applicable: allowsNotApplicable, allows_unknown: allowsUnknown,
    display_condition: condition,
  }, REQ);
  Q.publishVersion(vid, REQ);
  return { qid, vid, sectionId, questionId };
}

function createSimpleSession(domain = 'health') {
  const householdId = buildHousehold();
  const { vid, questionId } = buildPublishedQuestionnaire(domain);
  const { id } = createSession({
    household_id: householdId, domain,
    questionnaire_versions: [{ questionnaire_version_id: vid, domain, module_role: 'domain', display_order: 1 }],
  }, REQ);
  return { sessionId: id, questionId, householdId };
}

// --- Domaines --------------------------------------------------------------

test('getSessionWorkspace — expose le nom du conseiller (advisor_name), requis pour l’en-tête du workspace', () => {
  const { sessionId } = createSimpleSession();
  const ws = getSessionWorkspace(sessionId, REQ);
  assert.equal(ws.session.advisor_name, 'Conseiller');
});

// Constat de vérification navigateur : `households.label` est facultatif
// (souvent absent en pratique) ; sans nom de repli, l'en-tête du workspace
// affichait un tiret suivi de rien.
test('getSessionWorkspace — expose primary_display_name pour permettre un repli d’affichage quand le foyer n’a pas de label', () => {
  const { sessionId } = createSimpleSession();
  const ws = getSessionWorkspace(sessionId, REQ);
  assert.equal(ws.household.label, null);
  assert.ok(ws.household.primary_display_name, 'le nom du client principal doit être exposé comme repli d’affichage');
});

test('getSessionWorkspace — session health : un seul module, domaine jamais "mixed"', () => {
  const { sessionId } = createSimpleSession('health');
  const ws = getSessionWorkspace(sessionId, REQ);
  assert.equal(ws.modules.length, 1);
  assert.equal(ws.modules[0].domain, 'health');
  assert.equal(ws.session.domain, 'health');
});

test('getSessionWorkspace — session life_pension : un seul module', () => {
  const { sessionId } = createSimpleSession('life_pension');
  const ws = getSessionWorkspace(sessionId, REQ);
  assert.equal(ws.modules.length, 1);
  assert.equal(ws.modules[0].domain, 'life_pension');
});

test('getSessionWorkspace — session mixed : 3 modules distincts (common/health/life_pension), jamais un module "mixed", ordre respecté', () => {
  const householdId = buildHousehold();
  const common = buildPublishedQuestionnaire('common');
  const health = buildPublishedQuestionnaire('health');
  const life = buildPublishedQuestionnaire('life_pension');
  const { id: sessionId } = createSession({
    household_id: householdId, domain: 'mixed',
    questionnaire_versions: [
      { questionnaire_version_id: common.vid, domain: 'common', module_role: 'core', display_order: 1 },
      { questionnaire_version_id: health.vid, domain: 'health', module_role: 'domain', display_order: 2 },
      { questionnaire_version_id: life.vid, domain: 'life_pension', module_role: 'domain', display_order: 3 },
    ],
  }, REQ);
  const ws = getSessionWorkspace(sessionId, REQ);
  assert.equal(ws.modules.length, 3);
  assert.deepEqual(ws.modules.map((m) => m.domain), ['common', 'health', 'life_pension']);
  assert.ok(ws.modules.every((m) => m.domain !== 'mixed'));
  assert.equal(ws.modules[0].module_role, 'core');
  assert.equal(ws.modules[1].module_role, 'domain');
});

test('getSessionWorkspace — module commun facultatif : une session health sans version common ne montre que le module health', () => {
  const { sessionId } = createSimpleSession('health');
  const ws = getSessionWorkspace(sessionId, REQ);
  assert.ok(!ws.modules.some((m) => m.domain === 'common'), 'aucun module common ne doit être inventé si non rattaché');
});

// --- Visibilité --------------------------------------------------------

test('getSessionWorkspace — question conditionnelle : invisible tant que la condition n’est pas satisfaite, jamais comptée manquante quand masquée', () => {
  const householdId = buildHousehold();
  const { id: qid } = Q.createQuestionnaire({ stable_key: 'wk-cond', domain: 'health', name: 'N' }, REQ);
  const { id: vid } = Q.createDraftVersion(qid, {}, REQ);
  const { id: sec } = Q.upsertSection(vid, { stable_key: 's', title: 'S', sort_order: 1 }, REQ);
  const { id: trigger } = Q.upsertQuestion(sec, { stable_key: 'trigger', advisor_text: 'T?', type: 'boolean', sort_order: 1 }, REQ);
  Q.upsertQuestion(sec, {
    stable_key: 'dependent', advisor_text: 'D?', type: 'boolean', sort_order: 2, required: true,
    display_condition: { op: 'equals', ref: { question: 'trigger' }, value: true },
  }, REQ);
  Q.publishVersion(vid, REQ);
  const { id: sessionId } = createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'domain', display_order: 1 }],
  }, REQ);
  startSession(sessionId, rev(sessionId), REQ);

  let ws = getSessionWorkspace(sessionId, REQ);
  let dep = ws.modules[0].sections[0].instances[0].questions.find((q) => q.stable_key === 'dependent');
  assert.equal(dep.visible, false);
  assert.equal(dep.missing, false, 'une question obligatoire masquée ne doit jamais compter comme manquante');

  recordAnswers(sessionId, [{ question_id: trigger, status: 'answered', value: true }], rev(sessionId), REQ);
  ws = getSessionWorkspace(sessionId, REQ);
  dep = ws.modules[0].sections[0].instances[0].questions.find((q) => q.stable_key === 'dependent');
  assert.equal(dep.visible, true);
  assert.equal(dep.missing, true, 'devenue visible et obligatoire, sans réponse -> manquante');
});

test('getSessionWorkspace — section masquée : ses questions ne sont jamais comptées, section marquée visible=false', () => {
  const householdId = buildHousehold();
  const { id: qid } = Q.createQuestionnaire({ stable_key: 'wk-sec-cond', domain: 'health', name: 'N' }, REQ);
  const { id: vid } = Q.createDraftVersion(qid, {}, REQ);
  const { id: sec1 } = Q.upsertSection(vid, { stable_key: 's1', title: 'S1', sort_order: 1 }, REQ);
  Q.upsertQuestion(sec1, { stable_key: 'trigger', advisor_text: 'T?', type: 'boolean', sort_order: 1 }, REQ);
  const { id: sec2 } = Q.upsertSection(vid, {
    stable_key: 's2', title: 'S2', sort_order: 2,
    display_condition: { op: 'equals', ref: { question: 'trigger' }, value: true },
  }, REQ);
  Q.upsertQuestion(sec2, { stable_key: 'q_in_masked', advisor_text: 'Q?', type: 'boolean', sort_order: 1, required: true }, REQ);
  Q.publishVersion(vid, REQ);
  const { id: sessionId } = createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'domain', display_order: 1 }],
  }, REQ);
  startSession(sessionId, rev(sessionId), REQ);
  const ws = getSessionWorkspace(sessionId, REQ);
  const s2 = ws.modules[0].sections.find((s) => s.stable_key === 's2');
  assert.equal(s2.visible, false);
  assert.equal(s2.instances[0].questions.find((q) => q.stable_key === 'q_in_masked').missing, false);
});

// --- Progression -------------------------------------------------------

test('getSessionWorkspace — progression globale et par module correctement agrégées et indépendantes', () => {
  const householdId = buildHousehold();
  const common = buildPublishedQuestionnaire('common');
  const health = buildPublishedQuestionnaire('health');
  const life = buildPublishedQuestionnaire('life_pension');
  const { id: sessionId } = createSession({
    household_id: householdId, domain: 'mixed',
    questionnaire_versions: [
      { questionnaire_version_id: common.vid, domain: 'common', module_role: 'core', display_order: 1 },
      { questionnaire_version_id: health.vid, domain: 'health', module_role: 'domain', display_order: 2 },
      { questionnaire_version_id: life.vid, domain: 'life_pension', module_role: 'domain', display_order: 3 },
    ],
  }, REQ);
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: health.questionId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ws = getSessionWorkspace(sessionId, REQ);
  assert.equal(ws.progress.required_total, 3);
  assert.equal(ws.progress.required_answered, 1);
  const healthMod = ws.modules.find((m) => m.domain === 'health');
  const commonMod = ws.modules.find((m) => m.domain === 'common');
  assert.equal(healthMod.progress.required_answered, 1);
  assert.equal(commonMod.progress.required_answered, 0, 'répondre à health ne doit jamais affecter le progrès de common');
});

// --- Portée membre -------------------------------------------------------

test('getSessionWorkspace — portée membre : une instance par membre actif, réponses strictement isolées', () => {
  const householdId = buildHousehold();
  const conjointId = addConjoint(householdId);
  const { vid, questionId } = buildPublishedQuestionnaire('health', { memberScope: true });
  const { id: sessionId } = createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'domain', display_order: 1 }],
  }, REQ);
  startSession(sessionId, rev(sessionId), REQ);
  const ws0 = getSessionWorkspace(sessionId, REQ);
  const sec = ws0.modules[0].sections[0];
  assert.equal(sec.instances.length, 2, 'principal + conjoint');
  const principalInstance = sec.instances.find((i) => i.member.member_role === 'principal');
  const conjointInstance = sec.instances.find((i) => i.household_member_id === conjointId);
  assert.ok(principalInstance && conjointInstance);

  recordAnswers(sessionId, [{ question_id: questionId, household_member_id: principalInstance.household_member_id, status: 'answered', value: true }], rev(sessionId), REQ);
  const ws1 = getSessionWorkspace(sessionId, REQ);
  const sec1 = ws1.modules[0].sections[0];
  const principalAfter = sec1.instances.find((i) => i.household_member_id === principalInstance.household_member_id);
  const conjointAfter = sec1.instances.find((i) => i.household_member_id === conjointId);
  assert.equal(principalAfter.questions[0].answer.value, true);
  assert.equal(conjointAfter.questions[0].answer, null, 'la réponse du principal ne doit jamais apparaître pour le conjoint');
});

test('getSessionWorkspace — aucune fuite de membre d’un autre foyer', () => {
  const householdA = buildHousehold();
  const householdB = buildHousehold();
  addConjoint(householdB);
  const { vid, questionId } = buildPublishedQuestionnaire('health');
  const { id: sessionId } = createSession({
    household_id: householdA, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'domain', display_order: 1 }],
  }, REQ);
  assert.ok(questionId);
  const ws = getSessionWorkspace(sessionId, REQ);
  assert.equal(ws.household.members.length, 1, 'seuls les membres du foyer A doivent apparaître');
});

// --- Statuts de réponse --------------------------------------------------

test('getSessionWorkspace — unknown satisfait une question obligatoire quand autorisé, apparaît dans answer.status', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'unknown' }], rev(sessionId), REQ);
  const ws = getSessionWorkspace(sessionId, REQ);
  const q = ws.modules[0].sections[0].instances[0].questions[0];
  assert.equal(q.answer.status, 'unknown');
  assert.equal(q.missing, false);
});

test('getSessionWorkspace — not_applicable satisfait une question obligatoire uniquement quand autorisé', () => {
  const householdId = buildHousehold();
  const { vid, questionId } = buildPublishedQuestionnaire('health', { allowsNotApplicable: true });
  const { id: sessionId } = createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'domain', display_order: 1 }],
  }, REQ);
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'not_applicable' }], rev(sessionId), REQ);
  const ws = getSessionWorkspace(sessionId, REQ);
  const q = ws.modules[0].sections[0].instances[0].questions[0];
  assert.equal(q.answer.status, 'not_applicable');
  assert.equal(q.missing, false);
});

test('getSessionWorkspace — cleared ne satisfait jamais une question obligatoire, réapparaît comme manquante', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], rev(sessionId), REQ);
  let ws = getSessionWorkspace(sessionId, REQ);
  assert.equal(ws.modules[0].sections[0].instances[0].questions[0].missing, false);
  clearAnswer(sessionId, questionId, null, rev(sessionId), REQ);
  ws = getSessionWorkspace(sessionId, REQ);
  const q = ws.modules[0].sections[0].instances[0].questions[0];
  assert.equal(q.answer.status, 'cleared');
  assert.equal(q.missing, true, 'cleared ne satisfait jamais une question obligatoire');
});

// --- Statuts de session --------------------------------------------------

test('getSessionWorkspace — session annulée : actions toutes désactivées sauf lecture', () => {
  const { sessionId } = createSimpleSession();
  cancelSession(sessionId, rev(sessionId), REQ);
  const ws = getSessionWorkspace(sessionId, REQ);
  assert.equal(ws.session.status, 'cancelled');
  assert.deepEqual(ws.actions, {
    can_start: false, can_suspend: false, can_resume: false, can_cancel: false,
    can_complete: false, can_record_answers: false, can_amend: false,
  });
});

test('getSessionWorkspace — session finalisée : lecture seule + amendement uniquement', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], rev(sessionId), REQ);
  completeSession(sessionId, rev(sessionId), REQ);
  const ws = getSessionWorkspace(sessionId, REQ);
  assert.equal(ws.progress.complete, true);
  assert.equal(ws.actions.can_amend, true);
  assert.equal(ws.actions.can_record_answers, false);
});

test('getSessionWorkspace — session suspendue : lecture seule (reprendre/annuler uniquement), aucune nouvelle réponse tant que resume n’a pas été appelé', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], rev(sessionId), REQ);
  suspendSession(sessionId, rev(sessionId), REQ);
  const ws = getSessionWorkspace(sessionId, REQ);
  assert.equal(ws.actions.can_resume, true);
  assert.equal(ws.actions.can_cancel, true);
  assert.equal(ws.actions.can_suspend, false);
  // GATE LOT 3B §4 (décision humaine) : une session suspendue est réellement
  // mise en pause -- elle n'accepte plus aucune réponse avant reprise
  // explicite. Comportement du Lot 3A (suspended acceptait encore des
  // réponses) volontairement corrigé, voir advisorySessions.js
  // assertSessionAcceptsAnswers.
  assert.equal(ws.actions.can_record_answers, false);
  // La réponse déjà enregistrée avant la suspension reste bien conservée et
  // lisible -- seule la NOUVELLE saisie est bloquée.
  assert.equal(ws.progress.required_answered, 1);
  assert.throws(
    () => recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: false }], rev(sessionId), REQ),
    (err) => err.status === 409
  );
  assert.throws(
    () => clearAnswer(sessionId, questionId, null, rev(sessionId), REQ),
    (err) => err.status === 409
  );
});

// --- Foyer archivé / version archivée -----------------------------------

test('getSessionWorkspace — foyer archivé après création : la session reste lisible en projection', () => {
  const { sessionId, householdId } = createSimpleSession();
  db.prepare("UPDATE households SET status = 'archive' WHERE id = ?").run(householdId);
  const ws = getSessionWorkspace(sessionId, REQ);
  assert.equal(ws.household.status, 'archive');
  assert.ok(ws.modules.length > 0, 'la projection reste lisible malgré le foyer archivé');
});

test('getSessionWorkspace — version de questionnaire archivée après usage : la session historique reste projetable à l’identique', () => {
  const { sessionId, vid } = (() => {
    const householdId = buildHousehold();
    const { vid, questionId } = buildPublishedQuestionnaire('health');
    const { id: sessionId } = createSession({
      household_id: householdId, domain: 'health',
      questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'domain', display_order: 1 }],
    }, REQ);
    return { sessionId, vid, questionId };
  })();
  Q.archiveVersion(vid, REQ);
  const ws = getSessionWorkspace(sessionId, REQ);
  assert.equal(ws.modules.length, 1, 'la version archivée reste projetable pour une session historique');
});

// --- Erreurs -------------------------------------------------------------

test('getSessionWorkspace — session introuvable -> 404', () => {
  assert.throws(() => getSessionWorkspace(999999), (err) => err instanceof AdvisoryError && err.status === 404);
});

// --- Minimisation --------------------------------------------------------

test('getSessionWorkspace — ne retourne jamais de SQL brut ni de propriétés internes hors périmètre', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], rev(sessionId), REQ);
  const ws = getSessionWorkspace(sessionId, REQ);
  const json = JSON.stringify(ws);
  assert.ok(!/SELECT|INSERT|UPDATE|FROM advisory_/i.test(json), 'aucune trace de requête SQL ne doit apparaître dans la projection');
});

test('getSessionWorkspace — options et statut d’option exposés pour un type à choix', () => {
  const householdId = buildHousehold();
  const { id: qid } = Q.createQuestionnaire({ stable_key: 'wk-choice', domain: 'health', name: 'N' }, REQ);
  const { id: vid } = Q.createDraftVersion(qid, {}, REQ);
  const { id: sec } = Q.upsertSection(vid, { stable_key: 's', title: 'S', sort_order: 1 }, REQ);
  const { id: question } = Q.upsertQuestion(sec, { stable_key: 'q1', advisor_text: 'Q?', type: 'single_choice', sort_order: 1 }, REQ);
  Q.upsertOption(question, { stable_key: 'o1', label: 'Oui', value: 'yes', sort_order: 1 }, REQ);
  Q.upsertOption(question, { stable_key: 'o2', label: 'Non', value: 'no', sort_order: 2 }, REQ);
  Q.publishVersion(vid, REQ);
  const { id: sessionId } = createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'domain', display_order: 1 }],
  }, REQ);
  const ws = getSessionWorkspace(sessionId, REQ);
  const q = ws.modules[0].sections[0].instances[0].questions[0];
  assert.equal(q.options.length, 2);
  assert.deepEqual(q.options.map((o) => o.value), ['yes', 'no']);
});

test('getSessionWorkspace — history_available reflète l’historique réel (false puis true après remplacement)', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], rev(sessionId), REQ);
  let ws = getSessionWorkspace(sessionId, REQ);
  assert.equal(ws.modules[0].sections[0].instances[0].questions[0].history_available, false);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: false }], rev(sessionId), REQ);
  ws = getSessionWorkspace(sessionId, REQ);
  assert.equal(ws.modules[0].sections[0].instances[0].questions[0].history_available, true);
});

// --- Snapshot des membres (GATE LOT 3B §5) ----------------------------------

function createMemberScopedSession() {
  const householdId = buildHousehold();
  const conjointId = addConjoint(householdId);
  const principalId = db.prepare("SELECT id FROM household_members WHERE household_id = ? AND member_role = 'principal'").get(householdId).id;
  const { vid, questionId } = buildPublishedQuestionnaire('health', { memberScope: true, required: true });
  const { id: sessionId } = createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'domain', display_order: 1 }],
  }, REQ);
  return { sessionId, questionId, householdId, conjointId, principalId };
}

test('getSessionWorkspace — draft : un membre ajouté avant le démarrage apparaît (aucun snapshot encore figé)', () => {
  const householdId = buildHousehold();
  const { vid, questionId } = buildPublishedQuestionnaire('health', { memberScope: true });
  const { id: sessionId } = createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: vid, domain: 'health', module_role: 'domain', display_order: 1 }],
  }, REQ);
  addConjoint(householdId);
  const ws = getSessionWorkspace(sessionId, REQ);
  assert.equal(ws.household.members.length, 2, 'draft : reflète les membres actifs actuels');
  void questionId;
});

test('getSessionWorkspace — membre retiré du foyer APRÈS le démarrage : reste visible, marqué historical/no_longer_active, can_answer=false, historique lisible', () => {
  const { sessionId, questionId, householdId, conjointId } = createMemberScopedSession();
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, household_member_id: conjointId, status: 'answered', value: true }], rev(sessionId), REQ);
  removeMember(householdId, conjointId, {}, REQ);

  const ws = getSessionWorkspace(sessionId, REQ);
  assert.equal(ws.household.members.length, 2, 'le membre retiré ne doit jamais disparaître silencieusement');
  const conjointMember = ws.household.members.find((m) => m.id === conjointId);
  assert.equal(conjointMember.historical, true);
  assert.equal(conjointMember.no_longer_active, true);
  assert.equal(conjointMember.can_answer, false);

  const section = ws.modules[0].sections[0];
  const instance = section.instances.find((i) => i.household_member_id === conjointId);
  assert.equal(instance.member.historical, true);
  assert.equal(instance.member.can_answer, false);
  assert.equal(instance.questions[0].answer.value, true, 'la réponse historique du membre retiré reste lisible');

  assert.throws(
    () => recordAnswers(sessionId, [{ question_id: questionId, household_member_id: conjointId, status: 'answered', value: false }], rev(sessionId), REQ),
    (err) => err.status === 409
  );
  assert.throws(
    () => clearAnswer(sessionId, questionId, conjointId, rev(sessionId), REQ),
    (err) => err.status === 409
  );
});

test('getSessionWorkspace — membre ajouté APRÈS le démarrage n’apparaît jamais rétroactivement dans une session déjà démarrée', () => {
  const { sessionId, householdId } = createMemberScopedSession();
  startSession(sessionId, rev(sessionId), REQ);
  const before = getSessionWorkspace(sessionId, REQ).household.members.length;
  addConjoint(householdId); // second conjoint ajouté APRÈS le démarrage
  const after = getSessionWorkspace(sessionId, REQ);
  assert.equal(after.household.members.length, before, 'le nouveau membre ne doit pas apparaître');
});

// Correctif d'intégrité de la complétude de session (§3) : un membre
// historisé (retiré du foyer APRÈS le démarrage) ne peut plus jamais
// répondre (`assertMemberCanAnswer`) -- exiger indéfiniment sa réponse
// bloquerait la session sans recours opérationnel. Avant ce correctif, ce
// test documentait le comportement inverse (blocage permanent) ; il valide
// désormais l'exclusion du membre historisé du calcul de complétude, tout
// en vérifiant que le principal (toujours actif) continue, lui, de bloquer
// normalement s'il n'a pas répondu.
test('validateSessionForCompletion (via missing) — un membre historisé jamais répondu ne bloque plus la complétude, le membre actif reste lui pleinement exigé', () => {
  const { sessionId, questionId, householdId, conjointId, principalId } = createMemberScopedSession();
  startSession(sessionId, rev(sessionId), REQ);
  removeMember(householdId, conjointId, {}, REQ); // jamais répondu, puis retiré

  // Tant que le principal (toujours actif) n'a pas répondu, la session reste
  // incomplète pour SA propre réponse -- l'exclusion du membre historisé ne
  // doit jamais réduire la portée d'un membre réellement actif.
  const wsBeforePrincipalAnswer = getSessionWorkspace(sessionId, REQ);
  assert.equal(wsBeforePrincipalAnswer.progress.complete, false);
  const missingForConjointBefore = wsBeforePrincipalAnswer.missing[0].missing.find((m) => m.household_member_id === conjointId && m.question_id === questionId);
  assert.equal(missingForConjointBefore, undefined, 'le membre historisé ne doit plus jamais apparaître comme manquant');
  const missingForPrincipal = wsBeforePrincipalAnswer.missing[0].missing.find((m) => m.household_member_id === principalId && m.question_id === questionId);
  assert.ok(missingForPrincipal, 'le principal, lui, reste pleinement exigé');

  recordAnswers(sessionId, [{ question_id: questionId, household_member_id: principalId, status: 'answered', value: true }], rev(sessionId), REQ);
  const wsAfter = getSessionWorkspace(sessionId, REQ);
  assert.equal(wsAfter.progress.complete, true, 'une fois le principal répondu, plus rien ne doit bloquer la finalisation malgré la réponse à jamais absente du membre historisé');
  assert.doesNotThrow(() => completeSession(sessionId, rev(sessionId), REQ), 'la finalisation doit réellement réussir, jamais seulement le calcul de complétude');
});

test('getSessionWorkspace — session terminée : tous les membres du snapshot (y compris historisés) restent affichables et leurs réponses consultables', () => {
  const { sessionId, questionId, householdId, conjointId, principalId } = createMemberScopedSession();
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [
    { question_id: questionId, household_member_id: conjointId, status: 'answered', value: true },
    { question_id: questionId, household_member_id: principalId, status: 'answered', value: true },
  ], rev(sessionId), REQ);
  completeSession(sessionId, rev(sessionId), REQ);
  removeMember(householdId, conjointId, {}, REQ);
  const ws = getSessionWorkspace(sessionId, REQ);
  assert.equal(ws.session.status, 'completed');
  assert.ok(ws.household.members.some((m) => m.id === conjointId));
  const instance = ws.modules[0].sections[0].instances.find((i) => i.household_member_id === conjointId);
  assert.equal(instance.questions[0].answer.value, true);
});

// --- Audit (GATE LOT 3B §6) --------------------------------------------------

test('getSessionWorkspace — consultation auditée, dédupliquée sur la fenêtre de 15 minutes', () => {
  const { sessionId } = createSimpleSession();
  const before = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'consultation workspace session' AND entity_id = ?").get(sessionId).n;
  getSessionWorkspace(sessionId, REQ);
  getSessionWorkspace(sessionId, REQ);
  getSessionWorkspace(sessionId, REQ);
  const afterRepeated = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'consultation workspace session' AND entity_id = ?").get(sessionId).n;
  assert.equal(afterRepeated, before + 1, 'trois lectures rapprochées ne doivent produire qu’une seule ligne d’audit');

  // Simule l’expiration de la fenêtre de déduplication en reculant l’horodatage
  // de la ligne existante -- aucune API d’horloge n’est manipulée, uniquement
  // la donnée déjà écrite par ce test.
  db.prepare(
    "UPDATE audit_log SET created_at = datetime('now', '-20 minutes') WHERE action = 'consultation workspace session' AND entity_id = ?"
  ).run(sessionId);
  getSessionWorkspace(sessionId, REQ);
  const afterExpiry = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'consultation workspace session' AND entity_id = ?").get(sessionId).n;
  assert.equal(afterExpiry, before + 2, 'une nouvelle ligne doit apparaître une fois la fenêtre expirée');

  const rows = db.prepare("SELECT details FROM audit_log WHERE action = 'consultation workspace session' AND entity_id = ?").all(sessionId);
  for (const r of rows) {
    assert.ok(!/true|false|bonjour/i.test(r.details || ''), 'aucune valeur de réponse dans les détails d’audit de consultation');
  }
});

test('getSessionWorkspace — la déduplication est bien PAR utilisateur : un autre conseiller produit sa propre ligne d’audit', () => {
  db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run('autre@exemple.ch', 'Autre conseiller', 'x');
  const OTHER_REQ = { session: { userEmail: 'autre@exemple.ch' } };
  const { sessionId } = createSimpleSession();
  getSessionWorkspace(sessionId, REQ);
  getSessionWorkspace(sessionId, OTHER_REQ);
  const rows = db.prepare("SELECT user_email FROM audit_log WHERE action = 'consultation workspace session' AND entity_id = ?").all(sessionId);
  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map((r) => r.user_email)), new Set(['conseiller@exemple.ch', 'autre@exemple.ch']));
});

test('listAnswerHistory — consultation de l’historique auditée distinctement, sans valeur de réponse dans les détails', () => {
  const { sessionId, questionId } = createSimpleSession();
  startSession(sessionId, rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: true }], rev(sessionId), REQ);
  recordAnswers(sessionId, [{ question_id: questionId, status: 'answered', value: false }], rev(sessionId), REQ);
  const before = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'consultation historique réponse'").get().n;
  listAnswerHistory(sessionId, questionId, null, REQ);
  const after = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'consultation historique réponse'").get().n;
  assert.equal(after, before + 1);
  const row = db.prepare("SELECT * FROM audit_log WHERE action = 'consultation historique réponse' ORDER BY id DESC LIMIT 1").get();
  assert.equal(row.entity, 'advisory_session');
  assert.equal(row.entity_id, sessionId);
  assert.ok(!/true|false/i.test(row.details || ''), 'aucune valeur de réponse dans les détails d’audit d’historique');
});
