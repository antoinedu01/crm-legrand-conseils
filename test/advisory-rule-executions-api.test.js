// Tests API — /api/advisory/sessions/:id/rule-executions et .../findings
// (Legrand Diagnostic 360, Lot 4A). Même convention que
// test/advisory-sessions-api.test.js. Toutes les règles, questionnaires et
// foyers ici sont fictifs et techniques — aucun ne constitue un conseil
// d'assurance réel.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-rule-exec-api-'));
process.env.NODE_ENV = 'test';
process.env.SITE_ORIGINS = 'https://site-de-test.ch';
process.env.PUBLIC_RATE_LIMIT = '100';

const { default: app } = await import('../server/app.js');
const { default: db } = await import('../server/db.js');

const PASSWORD = 'MotDePasseDeTest!42';
let cookie = '';
function auth(req) { return req.set('Cookie', cookie); }

before(async () => {
  const res = await request(app).post('/api/auth/setup').send({ email: 'test@exemple.ch', name: 'Testeur', password: PASSWORD });
  assert.equal(res.status, 200);
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
});

function insertClient(over = {}) {
  const data = { type: 'particulier', first_name: 'Prenom', last_name: 'Nom', status: 'prospect', ...over };
  return db.prepare('INSERT INTO clients (type, first_name, last_name, status) VALUES (?, ?, ?, ?)')
    .run(data.type, data.first_name, data.last_name, data.status).lastInsertRowid;
}

let counter = 0;
function uniqueKey(prefix) {
  counter += 1;
  return `${prefix}-${counter}-${Math.random().toString(36).slice(2)}`;
}

async function buildHouseholdAndPublishedVersion(domain = 'health') {
  const clientId = insertClient({ first_name: `Api${uniqueKey('c')}`, last_name: 'Exec' });
  const house = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: clientId });
  const q = await auth(request(app).post('/api/advisory/questionnaires')).send({ stable_key: uniqueKey('exec-api-quest'), domain, name: 'Démo exécution' });
  const v = await auth(request(app).post(`/api/advisory/questionnaires/${q.body.id}/versions`)).send({});
  const sec = await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/sections`)).send({ stable_key: 's1', title: 'S', sort_order: 1 });
  const questionKey = uniqueKey('q');
  const ques = await auth(request(app).post(`/api/advisory/questionnaires/sections/${sec.body.id}/questions`)).send({ stable_key: questionKey, advisor_text: 'X ?', type: 'boolean', sort_order: 1 });
  await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/publish`)).send({});
  return { householdId: house.body.id, versionId: v.body.id, questionId: ques.body.id, questionKey };
}

async function rev(sessionId) {
  const r = await auth(request(app).get(`/api/advisory/sessions/${sessionId}`));
  return r.body.revision;
}

async function createStartedSessionWithAnswer(domain = 'health') {
  const { householdId, versionId, questionId, questionKey } = await buildHouseholdAndPublishedVersion(domain);
  const session = await auth(request(app).post('/api/advisory/sessions')).send({
    household_id: householdId, domain,
    questionnaire_versions: [{ questionnaire_version_id: versionId, domain, module_role: 'domain', display_order: 1 }],
  });
  const sessionId = session.body.id;
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({ expected_revision: await rev(sessionId) });
  await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({
    answers: [{ question_id: questionId, status: 'answered', value: true }],
    expected_revision: await rev(sessionId),
  });
  // Une exécution finale n'est possible que sur une session `completed`
  // (GATE LOT 4A §9, décision humaine confirmée) -- jamais `in_progress`.
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/complete`)).send({ expected_revision: await rev(sessionId) });
  return { sessionId, questionId, questionKey, householdId };
}

async function publishBasicRuleSet(domain, questionKey) {
  const rs = await auth(request(app).post('/api/advisory/rule-sets')).send({ stable_key: uniqueKey('rs-exec-api'), domain, name: 'Ensemble API exécution' });
  await auth(request(app).post(`/api/advisory/rule-sets/${rs.body.id}/rules`)).send({
    stable_key: uniqueKey('TEST-RULE-EXEC-API'),
    title: 'Règle technique fictive',
    conditions: { op: 'equals', ref: { answer: questionKey }, value: true },
    required_data: [{ answer: questionKey }],
    result_finding_type: 'detected_need',
    result_payload: { category_hint: 'categorie_exec_api_fictive' },
    priority: 'medium',
    advisor_explanation: 'Explication technique fictive.',
    source: 'Exemple technique fictif — ne constitue pas un conseil d\'assurance.',
    source_reference: 'REF-EXEC-API-001',
    effective_from: '2020-01-01',
    sort_order: 1,
  });
  // Politique « un seul rule_set publié par domaine » (GATE LOT 4A, §2) :
  // archive toute AUTRE famille déjà publiée pour ce domaine avant de
  // publier celle-ci, pour que chaque test reste isolé des précédents.
  const ownStableKey = db.prepare('SELECT stable_key FROM advisory_rule_sets WHERE id = ?').get(rs.body.id).stable_key;
  const others = db.prepare("SELECT id FROM advisory_rule_sets WHERE domain = ? AND status = 'published' AND stable_key != ?").all(domain, ownStableKey);
  for (const o of others) await auth(request(app).post(`/api/advisory/rule-sets/${o.id}/archive`));
  await auth(request(app).post(`/api/advisory/rule-sets/${rs.body.id}/publish`));
  return rs.body.id;
}

// Archive TOUT rule_set publié pour ce domaine, sans exception -- utilisé
// par les tests LOT 4B qui veulent constater un état "sans aucun ensemble
// publié" indépendamment de ce qu'un test précédent de ce même fichier a pu
// laisser publié (la base est partagée entre tous les tests de ce fichier,
// exécutés séquentiellement).
async function archiveAllPublishedRuleSets(domain) {
  const rows = db.prepare("SELECT id FROM advisory_rule_sets WHERE domain = ? AND status = 'published'").all(domain);
  for (const row of rows) await auth(request(app).post(`/api/advisory/rule-sets/${row.id}/archive`));
}

// --- Authentification / CSRF ------------------------------------------------

test('GET .../rule-executions sans session est refusé (401)', async () => {
  const res = await request(app).get('/api/advisory/sessions/1/rule-executions');
  assert.equal(res.status, 401);
});

test('POST .../rule-executions intersite est bloqué (CSRF, 403)', async () => {
  const { sessionId, questionKey } = await createStartedSessionWithAnswer();
  const ruleSetId = await publishBasicRuleSet('health', questionKey);
  const res = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/rule-executions`))
    .set('Origin', 'https://site-malveillant.example')
    .send({ domain: 'health', expected_revision: await rev(sessionId), rule_set_id: ruleSetId });
  assert.equal(res.status, 403);
});

// --- Cache / no-store --------------------------------------------------

test('GET .../rule-executions et .../findings — Cache-Control: no-store, private', async () => {
  const { sessionId } = await createStartedSessionWithAnswer();
  const execList = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/rule-executions`));
  assert.match(execList.headers['cache-control'], /no-store/);
  const findings = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/findings`));
  assert.match(findings.headers['cache-control'], /no-store/);
});

// Constat GATE LOT 4A §7 : une des 4 routes de lecture (`GET .../rule-
// executions`) ne transmettait pas `req` au service, attribuant à tort
// l'audit « consultation findings sensibles » à un utilisateur générique
// « système » plutôt qu'au conseiller réellement authentifié. Corrigé sur
// cette route ; vérifié ici sur les 4 routes de lecture concernées (une
// session DÉDIÉE par route pour éviter toute déduplication croisée de 15
// minutes entre les vérifications, constat revue compliance-privacy-reviewer
// GATE LOT 4A §12 : la couverture initiale ne testait cette attribution
// qu'au niveau HTTP pour `listExecutions`, jamais pour les 3 autres routes).
async function expectSensitiveConsultationByRealUser(readFn) {
  const { sessionId, questionKey } = await createStartedSessionWithAnswer();
  const ruleSetId = await publishBasicRuleSet('health', questionKey);
  db.prepare('UPDATE advisory_questions SET sensitive = 1 WHERE stable_key = ?').run(questionKey);
  const exec = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/rule-executions`))
    .send({ domain: 'health', expected_revision: await rev(sessionId), rule_set_id: ruleSetId });

  const before = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'consultation findings sensibles'").get().n;
  const res = await readFn(sessionId, exec.body.execution_id);
  assert.equal(res.status, 200);

  const rows = db.prepare("SELECT user_email FROM audit_log WHERE action = 'consultation findings sensibles' ORDER BY id DESC LIMIT 1").all();
  const after = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'consultation findings sensibles'").get().n;
  assert.equal(after, before + 1, 'la route GET doit transmettre req au service pour que la consultation sensible soit journalisée');
  assert.equal(rows[0].user_email, 'test@exemple.ch');
}

test('GET .../rule-executions — journalise « consultation findings sensibles » avec le VRAI utilisateur authentifié (jamais un générique « système », constat GATE LOT 4A §7)', async () => {
  await expectSensitiveConsultationByRealUser((sessionId) => auth(request(app).get(`/api/advisory/sessions/${sessionId}/rule-executions`)));
});

test('GET .../rule-executions/:executionId — même attribution au vrai utilisateur (GATE LOT 4A §12)', async () => {
  await expectSensitiveConsultationByRealUser((sessionId, executionId) => auth(request(app).get(`/api/advisory/sessions/${sessionId}/rule-executions/${executionId}`)));
});

test('GET .../findings — même attribution au vrai utilisateur (GATE LOT 4A §12)', async () => {
  await expectSensitiveConsultationByRealUser((sessionId) => auth(request(app).get(`/api/advisory/sessions/${sessionId}/findings`)));
});

test('GET .../findings/history — même attribution au vrai utilisateur (GATE LOT 4A §12)', async () => {
  await expectSensitiveConsultationByRealUser((sessionId) => auth(request(app).get(`/api/advisory/sessions/${sessionId}/findings/history`)));
});

// --- Exécution -----------------------------------------------------------

test('Cycle complet : exécution -> lecture -> findings actifs -> écartement', async () => {
  const { sessionId, questionKey } = await createStartedSessionWithAnswer();
  const ruleSetId = await publishBasicRuleSet('health', questionKey);

  const exec = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/rule-executions`))
    .send({ domain: 'health', expected_revision: await rev(sessionId), rule_set_id: ruleSetId });
  assert.equal(exec.status, 201);
  assert.equal(exec.body.findings_count, 1);

  const detail = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/rule-executions/${exec.body.execution_id}`));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.findings.length, 1);

  const active = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/findings`));
  assert.equal(active.status, 200);
  assert.equal(active.body.findings.length, 1);

  const findingId = active.body.findings[0].id;
  const dismiss = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/findings/${findingId}/dismiss`))
    .send({ dismiss_reason: 'Non pertinent (fictif, test API).', expected_revision: await rev(sessionId) });
  assert.equal(dismiss.status, 200);

  const afterDismiss = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/findings`));
  assert.equal(afterDismiss.body.findings.length, 0);

  const history = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/findings/history`));
  assert.equal(history.body.findings.length, 1);
  assert.equal(history.body.findings[0].status, 'dismissed');
});

test('POST .../rule-executions — 400 si rule_set_id manquant à la première exécution', async () => {
  const { sessionId } = await createStartedSessionWithAnswer();
  const res = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/rule-executions`))
    .send({ domain: 'health', expected_revision: await rev(sessionId) });
  assert.equal(res.status, 400);
});

test('POST .../rule-executions — 409 sur révision attendue obsolète', async () => {
  const { sessionId, questionKey } = await createStartedSessionWithAnswer();
  const ruleSetId = await publishBasicRuleSet('health', questionKey);
  const res = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/rule-executions`))
    .send({ domain: 'health', expected_revision: (await rev(sessionId)) + 42, rule_set_id: ruleSetId });
  assert.equal(res.status, 409);
});

test('GET .../rule-executions/:executionId — 404 si l\'exécution appartient à une autre session (IDOR)', async () => {
  const { sessionId, questionKey } = await createStartedSessionWithAnswer();
  const ruleSetId = await publishBasicRuleSet('health', questionKey);
  const exec = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/rule-executions`))
    .send({ domain: 'health', expected_revision: await rev(sessionId), rule_set_id: ruleSetId });

  const other = await createStartedSessionWithAnswer();
  const res = await auth(request(app).get(`/api/advisory/sessions/${other.sessionId}/rule-executions/${exec.body.execution_id}`));
  assert.equal(res.status, 404);
});

test('POST .../findings/:findingId/dismiss — 404 si le finding appartient à une autre session (IDOR)', async () => {
  const { sessionId, questionKey } = await createStartedSessionWithAnswer();
  const ruleSetId = await publishBasicRuleSet('health', questionKey);
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/rule-executions`))
    .send({ domain: 'health', expected_revision: await rev(sessionId), rule_set_id: ruleSetId });
  const active = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/findings`));
  const findingId = active.body.findings[0].id;

  const other = await createStartedSessionWithAnswer();
  const res = await auth(request(app).post(`/api/advisory/sessions/${other.sessionId}/findings/${findingId}/dismiss`))
    .send({ dismiss_reason: 'X', expected_revision: await rev(other.sessionId) });
  assert.equal(res.status, 404);
});

test('POST .../rule-executions — refuse un domaine incompatible avec la session (409)', async () => {
  const { sessionId, questionKey } = await createStartedSessionWithAnswer('health');
  const ruleSetId = await publishBasicRuleSet('health', questionKey);
  const res = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/rule-executions`))
    .send({ domain: 'life_pension', expected_revision: await rev(sessionId), rule_set_id: ruleSetId });
  assert.equal(res.status, 409);
});

// --- Espace conseiller des findings (Lot 4B) --------------------------------

test('GET .../findings-workspace sans session est refusé (401)', async () => {
  const res = await request(app).get('/api/advisory/sessions/1/findings-workspace');
  assert.equal(res.status, 401);
});

test('GET .../findings-workspace — Cache-Control: no-store, private', async () => {
  const { sessionId } = await createStartedSessionWithAnswer();
  const res = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/findings-workspace`));
  assert.equal(res.status, 200);
  assert.match(res.headers['cache-control'], /no-store/);
});

test('GET .../findings-workspace — 404 si la session est introuvable', async () => {
  const res = await auth(request(app).get('/api/advisory/sessions/999999/findings-workspace'));
  assert.equal(res.status, 404);
});

test('GET .../findings-workspace — journalise « consultation findings sensibles » avec le VRAI utilisateur authentifié (GATE LOT 4B, même exigence que les 4 routes Lot 4A, §12)', async () => {
  await expectSensitiveConsultationByRealUser((sessionId) => auth(request(app).get(`/api/advisory/sessions/${sessionId}/findings-workspace`)));
});

test('GET .../findings-workspace — structure PAR DOMAINE, jamais fusionnée : "no_rule_set_available"/"not_yet_run" avant analyse, "up_to_date" après, findings hydratés (source, texte de question)', async () => {
  const { sessionId, questionKey } = await createStartedSessionWithAnswer('health');
  // Isolé de tout ensemble health laissé publié par un test précédent de ce
  // même fichier (base partagée, tests séquentiels) -- ce test veut
  // constater précisément l'état "rien n'est encore publié".
  await archiveAllPublishedRuleSets('health');
  const before = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/findings-workspace`));
  assert.equal(before.status, 200);
  assert.deepEqual(Object.keys(before.body.by_domain).sort(), ['common', 'health']);
  assert.equal(before.body.by_domain.common.state, 'no_rule_set_available');
  assert.equal(before.body.by_domain.common.can_launch, false);
  assert.equal(before.body.by_domain.common.findings.length, 0);
  assert.equal(before.body.by_domain.health.state, 'no_rule_set_available', 'aucun ensemble de règles health publié pour le moment : un état normal, jamais une erreur');
  assert.equal(before.body.by_domain.health.can_launch, false);
  assert.equal(before.body.by_domain.health.findings.length, 0);
  assert.equal(before.body.actions.can_launch_analysis, true);
  assert.equal(before.body.actions.can_dismiss_findings, true);

  // Un ensemble de règles est publié pour health, mais AUCUNE exécution n'a
  // encore eu lieu -- distinct de "no_rule_set_available" : un lancement
  // est désormais possible.
  const ruleSetId = await publishBasicRuleSet('health', questionKey);
  const notYetRun = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/findings-workspace`));
  assert.equal(notYetRun.body.by_domain.health.state, 'not_yet_run');
  assert.equal(notYetRun.body.by_domain.health.can_launch, true);
  assert.equal(notYetRun.body.by_domain.health.last_execution, null);

  const exec = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/rule-executions`))
    .send({ domain: 'health', expected_revision: await rev(sessionId), rule_set_id: ruleSetId });
  assert.equal(exec.status, 201);

  const after = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/findings-workspace`));
  assert.equal(after.body.by_domain.health.state, 'up_to_date');
  assert.equal(after.body.by_domain.health.can_launch, true);
  assert.equal(after.body.by_domain.health.last_execution.id, exec.body.execution_id);
  assert.equal(after.body.by_domain.health.findings.length, 1);
  // Domaines toujours SÉPARÉS -- l'exécution de health ne doit jamais faire
  // apparaître un finding ou changer l'état de common.
  assert.equal(after.body.by_domain.common.state, 'no_rule_set_available');
  assert.equal(after.body.by_domain.common.findings.length, 0);

  const finding = after.body.by_domain.health.findings[0];
  assert.equal(finding.source, 'Exemple technique fictif — ne constitue pas un conseil d\'assurance.');
  assert.equal(finding.source_reference, 'REF-EXEC-API-001');
  assert.equal(finding.effective_from, '2020-01-01');
  assert.equal(finding.member, null, 'portée household : aucun membre attribué');
  const answerRef = finding.used_inputs_ref.find((r) => r.kind === 'answer');
  assert.ok(answerRef);
  assert.equal(answerRef.stable_key, questionKey);
  assert.ok(answerRef.advisor_text, 'le texte de la question doit être hydraté pour le panneau de traçabilité, jamais seulement un identifiant technique');
});

test('GET .../findings-workspace — devient "stale" après un amendement de réponse ; les findings affichés restent ceux de la dernière exécution réussie tant que le conseiller n\'a pas relancé (§7.5)', async () => {
  const { sessionId, questionId, questionKey } = await createStartedSessionWithAnswer('health');
  const ruleSetId = await publishBasicRuleSet('health', questionKey);
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/rule-executions`))
    .send({ domain: 'health', expected_revision: await rev(sessionId), rule_set_id: ruleSetId });

  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/answers/amend`)).send({
    question_id: questionId, status: 'answered', value: true,
    amendment_reason: 'Correction technique fictive (test API).',
    expected_revision: await rev(sessionId),
  });

  const after = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/findings-workspace`));
  assert.equal(after.body.by_domain.health.state, 'stale');
  assert.equal(after.body.by_domain.health.findings.length, 1, 'les findings de la dernière analyse restent affichés, jamais recalculés silencieusement');
});

// --- Lancement groupé de l'analyse (POST .../analyze, Lot 4B) --------------

test('POST .../analyze sans session est refusé (401)', async () => {
  const res = await request(app).post('/api/advisory/sessions/1/analyze').send({ expected_revision: 1 });
  assert.equal(res.status, 401);
});

test('POST .../analyze intersite est bloqué (CSRF, 403)', async () => {
  const { sessionId, questionKey } = await createStartedSessionWithAnswer();
  await publishBasicRuleSet('health', questionKey);
  const res = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/analyze`))
    .set('Origin', 'https://site-malveillant.example')
    .send({ expected_revision: await rev(sessionId) });
  assert.equal(res.status, 403);
});

test('POST .../analyze — lance tous les domaines applicables en un seul appel conseiller, résultat structuré PAR DOMAINE, jamais fusionné', async () => {
  const { sessionId, questionKey } = await createStartedSessionWithAnswer('health');
  await publishBasicRuleSet('health', questionKey);

  const res = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/analyze`)).send({ expected_revision: await rev(sessionId) });
  assert.equal(res.status, 201);
  const byDomain = Object.fromEntries(res.body.results.map((r) => [r.domain, r]));
  assert.deepEqual(Object.keys(byDomain).sort(), ['common', 'health']);
  assert.equal(byDomain.health.status, 'completed');
  assert.ok(Number.isInteger(byDomain.health.execution_id));
  assert.equal(byDomain.common.status, 'skipped_no_published_rule_set', 'absence d\'ensemble de règles common : un état normal, jamais une erreur');

  const workspace = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/findings-workspace`));
  assert.equal(workspace.body.by_domain.health.state, 'up_to_date');
  assert.equal(workspace.body.by_domain.health.findings.length, 1);
  assert.equal(workspace.body.by_domain.common.state, 'no_rule_set_available');
});

test('POST .../analyze — 409 sur révision attendue obsolète, rejeté avant même de tenter un domaine', async () => {
  const { sessionId, questionKey } = await createStartedSessionWithAnswer();
  await publishBasicRuleSet('health', questionKey);
  const res = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/analyze`))
    .send({ expected_revision: (await rev(sessionId)) + 42 });
  assert.equal(res.status, 409);

  // Aucune exécution, même partielle, ne doit avoir été produite pour un
  // appel entièrement rejeté (préconditions vérifiées avant tout domaine).
  const executions = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/rule-executions`));
  assert.equal(executions.body.executions.length, 0);
});

// --- GATE LOT 4B §5 : contrat exact des deux routes -------------------------

test('POST .../analyze — expected_revision manquant est refusé (400), jamais silencieusement accepté', async () => {
  const { sessionId, questionKey } = await createStartedSessionWithAnswer();
  await publishBasicRuleSet('health', questionKey);
  const res = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/analyze`)).send({});
  assert.equal(res.status, 400);
});

test('GET .../findings-workspace et POST .../analyze — Pragma: no-cache présent en plus de Cache-Control (réponses potentiellement médicales/financières)', async () => {
  const { sessionId, questionKey } = await createStartedSessionWithAnswer();
  await publishBasicRuleSet('health', questionKey);
  const workspace = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/findings-workspace`));
  assert.equal(workspace.headers.pragma, 'no-cache');
  const analyze = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/analyze`)).send({ expected_revision: await rev(sessionId) });
  assert.equal(analyze.status, 201); // la route d'écriture elle-même ne fixe pas de cache -- vérifie seulement que la lecture qui suit reste protégée
  const after = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/findings-workspace`));
  assert.equal(after.headers['cache-control'].includes('no-store'), true);
  assert.equal(after.headers.pragma, 'no-cache');
});

test('GET .../findings-workspace — n\'expose jamais le snapshot COMPLET d\'exécution (inputs_snapshot) ni le contenu brut des conditions de règle (DSL) : seule getExecutionDetail expose le snapshot, jamais cette projection-ci', async () => {
  const { sessionId, questionKey } = await createStartedSessionWithAnswer('health');
  await publishBasicRuleSet('health', questionKey);
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/analyze`)).send({ expected_revision: await rev(sessionId) });

  const res = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/findings-workspace`));
  const raw = JSON.stringify(res.body);
  assert.ok(!raw.includes('inputs_snapshot'), 'la projection espace conseiller des findings ne doit jamais exposer le snapshot complet d\'une exécution');
  assert.ok(!raw.includes('"conditions"'), 'le contenu brut (DSL) des conditions de règle ne doit jamais apparaître dans cette projection');
});

test('POST .../analyze — un domaine en échec (erreur interne) ne renvoie jamais de détail brut, et n\'audite jamais un succès pour CE domaine (seuls les domaines réellement complétés le sont)', async () => {
  const { sessionId, questionKey } = await createStartedSessionWithAnswer('health');
  const ruleSetId = await publishBasicRuleSet('health', questionKey);
  const rules = db.prepare('SELECT id, stable_key FROM advisory_rules WHERE rule_set_id = ?').all(ruleSetId);
  db.prepare('UPDATE advisory_rules SET conditions = ? WHERE id = ?')
    .run(JSON.stringify({ op: 'equals', ref: { rule_result: rules[0].stable_key }, value: true }), rules[0].id);

  const before = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'exécution lancée' AND entity_id = ?").get(sessionId).n;
  const res = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/analyze`)).send({ expected_revision: await rev(sessionId) });
  assert.equal(res.status, 201, 'la route reste 201 (résultat structuré par domaine dans le corps) -- jamais interprétée comme "tout a réussi" sans lire results[]');
  const byDomain = Object.fromEntries(res.body.results.map((r) => [r.domain, r]));
  assert.equal(byDomain.health.status, 'failed');
  assert.ok(byDomain.health.error);
  assert.ok(!/SQLITE|constraint|advisory_rules|Cycle inattendu/i.test(JSON.stringify(res.body)), 'jamais de détail interne brut exposé dans la réponse HTTP');

  const after = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'exécution lancée' AND entity_id = ?").get(sessionId).n;
  assert.equal(after, before, 'aucun audit "exécution lancée" (succès) ne doit être écrit pour un domaine qui a échoué');
});
