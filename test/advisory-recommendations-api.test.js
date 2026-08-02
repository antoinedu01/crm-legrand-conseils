// Tests API — /api/advisory/sessions/:id/recommendations et
// /api/advisory/recommendations/:id (Legrand Diagnostic 360, Lot 7A). Même
// convention que test/advisory-rule-executions-api.test.js. Toutes les
// règles, questionnaires et foyers ici sont fictifs et techniques.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-recommendations-api-'));
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
  const clientId = insertClient({ first_name: `Api${uniqueKey('c')}`, last_name: 'Reco' });
  const house = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: clientId });
  const householdId = house.body.id;
  const principalMemberId = db.prepare("SELECT id FROM household_members WHERE household_id = ? AND member_role = 'principal'").get(householdId).id;
  const q = await auth(request(app).post('/api/advisory/questionnaires')).send({ stable_key: uniqueKey('reco-api-quest'), domain, name: 'Démo reco' });
  const v = await auth(request(app).post(`/api/advisory/questionnaires/${q.body.id}/versions`)).send({});
  const sec = await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/sections`)).send({ stable_key: 's1', title: 'S', sort_order: 1 });
  const questionKey = uniqueKey('q');
  const ques = await auth(request(app).post(`/api/advisory/questionnaires/sections/${sec.body.id}/questions`)).send({ stable_key: questionKey, advisor_text: 'X ?', type: 'boolean', sort_order: 1 });
  await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/publish`)).send({});
  return { householdId, principalMemberId, versionId: v.body.id, questionId: ques.body.id, questionKey };
}

async function rev(sessionId) {
  const r = await auth(request(app).get(`/api/advisory/sessions/${sessionId}`));
  return r.body.revision;
}

async function publishBasicRuleSet(domain, questionKey) {
  const rs = await auth(request(app).post('/api/advisory/rule-sets')).send({ stable_key: uniqueKey('rs-reco-api'), domain, name: 'Ensemble API reco' });
  await auth(request(app).post(`/api/advisory/rule-sets/${rs.body.id}/rules`)).send({
    stable_key: uniqueKey('TEST-RULE-RECO-API'),
    title: 'Règle technique fictive',
    conditions: { op: 'equals', ref: { answer: questionKey }, value: true },
    required_data: [{ answer: questionKey }],
    result_finding_type: 'detected_need',
    result_payload: { category_hint: 'categorie_reco_api_fictive' },
    priority: 'medium',
    advisor_explanation: 'Explication technique fictive.',
    source: 'Exemple technique fictif — ne constitue pas un conseil d\'assurance.',
    source_reference: 'REF-RECO-API-001',
    effective_from: '2020-01-01',
    sort_order: 1,
  });
  const ownStableKey = db.prepare('SELECT stable_key FROM advisory_rule_sets WHERE id = ?').get(rs.body.id).stable_key;
  const others = db.prepare("SELECT id FROM advisory_rule_sets WHERE domain = ? AND status = 'published' AND stable_key != ?").all(domain, ownStableKey);
  for (const o of others) await auth(request(app).post(`/api/advisory/rule-sets/${o.id}/archive`));
  await auth(request(app).post(`/api/advisory/rule-sets/${rs.body.id}/publish`));
  return rs.body.id;
}

// Session COMPLETED avec exactement un finding ACTIF household -- via HTTP
// uniquement (mêmes conventions que createStartedSessionWithAnswer, Lot 4A).
async function createSessionWithActiveFindingHttp(domain = 'health') {
  const { householdId, principalMemberId, versionId, questionId, questionKey } = await buildHouseholdAndPublishedVersion(domain);
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
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/complete`)).send({ expected_revision: await rev(sessionId) });
  const ruleSetId = await publishBasicRuleSet(domain, questionKey);
  const analyzeRes = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/analyze`)).send({ expected_revision: await rev(sessionId) });
  assert.equal(analyzeRes.status, 201);
  const findingsRes = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/findings`));
  assert.equal(findingsRes.body.findings.length, 1);
  return { sessionId, householdId, principalMemberId, findingId: findingsRes.body.findings[0].id, ruleSetId };
}

async function createDraftHttp(sessionId, domain = 'health', over = {}) {
  const res = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/recommendations`)).send({
    domain, scope: 'household', title: 'Titre technique fictif', advisor_rationale: 'Justification technique fictive.', ...over,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

// --- Authentification / CSRF ------------------------------------------------

test('GET .../sessions/:id/recommendations sans session est refusé (401)', async () => {
  const res = await request(app).get('/api/advisory/sessions/1/recommendations');
  assert.equal(res.status, 401);
});

test('POST .../sessions/:id/recommendations intersite est bloqué (CSRF, 403)', async () => {
  const { sessionId } = await createSessionWithActiveFindingHttp();
  const res = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/recommendations`))
    .set('Origin', 'https://site-malveillant.example')
    .send({ domain: 'health', scope: 'household', title: 'T', advisor_rationale: 'R' });
  assert.equal(res.status, 403);
});

test('POST /api/advisory/recommendations/:id/validate intersite est bloqué (CSRF, 403)', async () => {
  const { sessionId } = await createSessionWithActiveFindingHttp();
  const rec = await createDraftHttp(sessionId);
  const res = await auth(request(app).post(`/api/advisory/recommendations/${rec.id}/validate`))
    .set('Origin', 'https://site-malveillant.example')
    .send({ expected_recommendation_revision: rec.revision, expected_session_revision: await rev(sessionId) });
  assert.equal(res.status, 403);
});

// --- Cache / no-store --------------------------------------------------

test('GET .../recommendations et GET .../recommendations/:id portent Cache-Control: no-store, private', async () => {
  const { sessionId } = await createSessionWithActiveFindingHttp();
  const rec = await createDraftHttp(sessionId);
  const list = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/recommendations`));
  assert.match(list.headers['cache-control'], /no-store/);
  const detail = await auth(request(app).get(`/api/advisory/recommendations/${rec.id}`));
  assert.match(detail.headers['cache-control'], /no-store/);
});

// --- Cycle de vie complet via HTTP ------------------------------------------

test('cycle complet — création, liste, détail, modification, lien finding, validation', async () => {
  const { sessionId, findingId } = await createSessionWithActiveFindingHttp();
  const created = await createDraftHttp(sessionId);
  assert.equal(created.status, 'draft');

  const list = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/recommendations`));
  assert.equal(list.status, 200);
  assert.equal(list.body.recommendations.length, 1);

  const detail = await auth(request(app).get(`/api/advisory/recommendations/${created.id}`));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.id, created.id);

  const updated = await auth(request(app).put(`/api/advisory/recommendations/${created.id}`)).send({
    summary: 'Résumé technique fictif.', expected_recommendation_revision: created.revision,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.revision, created.revision + 1);

  const linked = await auth(request(app).post(`/api/advisory/recommendations/${created.id}/findings`)).send({
    finding_id: findingId, expected_recommendation_revision: updated.body.revision,
  });
  assert.equal(linked.status, 201);
  assert.deepEqual(linked.body.finding_ids, [findingId]);

  const validated = await auth(request(app).post(`/api/advisory/recommendations/${created.id}/validate`)).send({
    expected_recommendation_revision: linked.body.revision, expected_session_revision: await rev(sessionId),
  });
  assert.equal(validated.status, 200);
  assert.equal(validated.body.recommendation.status, 'validated');
});

test('cycle — écartement d’un brouillon', async () => {
  const { sessionId } = await createSessionWithActiveFindingHttp();
  const rec = await createDraftHttp(sessionId);
  const dismissed = await auth(request(app).post(`/api/advisory/recommendations/${rec.id}/dismiss`)).send({
    dismiss_reason: 'motif fictif', expected_recommendation_revision: rec.revision,
  });
  assert.equal(dismissed.status, 200);
  assert.equal(dismissed.body.status, 'dismissed');
});

test('cycle — retrait d’une recommandation validée', async () => {
  const { sessionId, findingId } = await createSessionWithActiveFindingHttp();
  const rec = await createDraftHttp(sessionId, 'health', { summary: 'S' });
  const linked = await auth(request(app).post(`/api/advisory/recommendations/${rec.id}/findings`)).send({ finding_id: findingId, expected_recommendation_revision: rec.revision });
  const validated = await auth(request(app).post(`/api/advisory/recommendations/${rec.id}/validate`)).send({
    expected_recommendation_revision: linked.body.revision, expected_session_revision: await rev(sessionId),
  });
  const withdrawn = await auth(request(app).post(`/api/advisory/recommendations/${rec.id}/withdraw`)).send({
    withdraw_reason: 'motif fictif', expected_recommendation_revision: validated.body.recommendation.revision,
  });
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.body.status, 'withdrawn');
});

test('cycle — remplacement d’une recommandation validée', async () => {
  const { sessionId, findingId } = await createSessionWithActiveFindingHttp();
  const rec = await createDraftHttp(sessionId, 'health', { summary: 'S' });
  const linked = await auth(request(app).post(`/api/advisory/recommendations/${rec.id}/findings`)).send({ finding_id: findingId, expected_recommendation_revision: rec.revision });
  const validated = await auth(request(app).post(`/api/advisory/recommendations/${rec.id}/validate`)).send({
    expected_recommendation_revision: linked.body.revision, expected_session_revision: await rev(sessionId),
  });
  const source = validated.body.recommendation;

  const replacement = await auth(request(app).post(`/api/advisory/recommendations/${source.id}/replacement`)).send({
    expected_source_recommendation_revision: source.revision, title: 'Version corrigée', advisor_rationale: 'R2', scope: 'household',
  });
  assert.equal(replacement.status, 201);
  assert.equal(replacement.body.supersedes_recommendation_id, source.id);

  const historyBefore = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/recommendations/history`));
  assert.ok(historyBefore.body.recommendations.some((r) => r.id === replacement.body.id));
});

test('history — liste tous les statuts, jamais dédupliquée à l’audit', async () => {
  const { sessionId } = await createSessionWithActiveFindingHttp();
  await createDraftHttp(sessionId);
  const first = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/recommendations/history`));
  const before = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'consultation historique recommandations'").get().n;
  const second = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/recommendations/history`));
  const after = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'consultation historique recommandations'").get().n;
  assert.equal(after, before + 1, 'deux lectures rapprochées de l’historique doivent produire DEUX entrées, jamais dédupliquées');
  void first; void second;
});

// --- Validation (400) -----------------------------------------------------

test('POST .../recommendations sans title est refusé (400)', async () => {
  const { sessionId } = await createSessionWithActiveFindingHttp();
  const res = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/recommendations`)).send({ domain: 'health', scope: 'household', title: '', advisor_rationale: 'R' });
  assert.equal(res.status, 400);
});

// --- Concurrence (409) -----------------------------------------------------

test('PUT .../recommendations/:id avec expected_recommendation_revision obsolète refusé (409)', async () => {
  const { sessionId } = await createSessionWithActiveFindingHttp();
  const rec = await createDraftHttp(sessionId);
  const res = await auth(request(app).put(`/api/advisory/recommendations/${rec.id}`)).send({ title: 'X', expected_recommendation_revision: rec.revision + 9 });
  assert.equal(res.status, 409);
});

test('double requête concurrente : la seconde écriture avec la même révision obsolète échoue (409), la première réussit', async () => {
  const { sessionId } = await createSessionWithActiveFindingHttp();
  const rec = await createDraftHttp(sessionId);
  const first = await auth(request(app).put(`/api/advisory/recommendations/${rec.id}`)).send({ title: 'Première', expected_recommendation_revision: rec.revision });
  assert.equal(first.status, 200);
  const second = await auth(request(app).put(`/api/advisory/recommendations/${rec.id}`)).send({ title: 'Seconde', expected_recommendation_revision: rec.revision });
  assert.equal(second.status, 409, 'la seconde requête utilise encore l’ancienne révision, doit échouer');
  const finalDetail = await auth(request(app).get(`/api/advisory/recommendations/${rec.id}`));
  assert.equal(finalDetail.body.title, 'Première');
});

// --- IDOR / 404 -------------------------------------------------------------

test('IDOR — recommandation adressée directement par id inexistant : 404 neutre', async () => {
  const res = await auth(request(app).get('/api/advisory/recommendations/999999999'));
  assert.equal(res.status, 404);
  assert.ok(!/SQL|SQLITE|stack/i.test(JSON.stringify(res.body)), 'aucune fuite de détail SQL/technique');
});

test('IDOR — validate sur un id inexistant : 404 neutre, jamais un 500', async () => {
  const res = await auth(request(app).post('/api/advisory/recommendations/999999999/validate')).send({ expected_recommendation_revision: 1, expected_session_revision: 1 });
  assert.equal(res.status, 404);
});

// --- Minimisation / audit ---------------------------------------------------

test('audit — recommandation créée via HTTP attribue le vrai utilisateur', async () => {
  const { sessionId } = await createSessionWithActiveFindingHttp();
  const before = db.prepare("SELECT MAX(id) AS id FROM audit_log").get().id;
  await createDraftHttp(sessionId);
  const rows = db.prepare("SELECT * FROM audit_log WHERE action = 'recommandation créée' AND id > ? ORDER BY id ASC").all(before);
  assert.ok(rows.length >= 1);
  assert.equal(rows[rows.length - 1].user_email, 'test@exemple.ch');
});

test('minimisation — le corps de réponse d’une erreur 409 ne contient jamais de contenu narratif d’un autre enregistrement', async () => {
  const { sessionId } = await createSessionWithActiveFindingHttp();
  const rec = await createDraftHttp(sessionId, 'health', { advisor_rationale: 'CONTENU-SENSIBLE-NE-DOIT-JAMAIS-FUITER' });
  const res = await auth(request(app).put(`/api/advisory/recommendations/${rec.id}`)).send({ title: 'X', expected_recommendation_revision: rec.revision + 5 });
  assert.equal(res.status, 409);
  assert.ok(!JSON.stringify(res.body).includes('CONTENU-SENSIBLE-NE-DOIT-JAMAIS-FUITER'));
});

test('payload — la réponse de chaque écriture retourne la nouvelle révision', async () => {
  const { sessionId } = await createSessionWithActiveFindingHttp();
  const rec = await createDraftHttp(sessionId);
  const updated = await auth(request(app).put(`/api/advisory/recommendations/${rec.id}`)).send({ title: 'Y', expected_recommendation_revision: rec.revision });
  assert.equal(typeof updated.body.revision, 'number');
  assert.equal(updated.body.revision, rec.revision + 1);
});

// ============================================================================
// Correctifs (revue finale backend-test-auditor) — couverture étendue
// ============================================================================

// CSRF : la revue finale a relevé que seules create/validate avaient un test
// dédié parmi les 7 routes d'écriture -- corrigé en couvrant les 5 restantes.
test('CSRF — PUT/findings/members/dismiss/withdraw/replacement sont tous bloqués en intersite (403)', async () => {
  const { sessionId, findingId } = await createSessionWithActiveFindingHttp();
  const rec = await createDraftHttp(sessionId, 'health', { summary: 'S' });

  const put = await auth(request(app).put(`/api/advisory/recommendations/${rec.id}`)).set('Origin', 'https://site-malveillant.example').send({ title: 'X', expected_recommendation_revision: rec.revision });
  assert.equal(put.status, 403);

  const linkFinding = await auth(request(app).post(`/api/advisory/recommendations/${rec.id}/findings`)).set('Origin', 'https://site-malveillant.example').send({ finding_id: findingId, expected_recommendation_revision: rec.revision });
  assert.equal(linkFinding.status, 403);

  const linkMember = await auth(request(app).post(`/api/advisory/recommendations/${rec.id}/members`)).set('Origin', 'https://site-malveillant.example').send({ household_member_id: 1, expected_recommendation_revision: rec.revision });
  assert.equal(linkMember.status, 403);

  const dismiss = await auth(request(app).post(`/api/advisory/recommendations/${rec.id}/dismiss`)).set('Origin', 'https://site-malveillant.example').send({ dismiss_reason: 'motif', expected_recommendation_revision: rec.revision });
  assert.equal(dismiss.status, 403);

  const linked = await auth(request(app).post(`/api/advisory/recommendations/${rec.id}/findings`)).send({ finding_id: findingId, expected_recommendation_revision: rec.revision });
  const validated = await auth(request(app).post(`/api/advisory/recommendations/${rec.id}/validate`)).send({ expected_recommendation_revision: linked.body.revision, expected_session_revision: await rev(sessionId) });

  const withdraw = await auth(request(app).post(`/api/advisory/recommendations/${rec.id}/withdraw`)).set('Origin', 'https://site-malveillant.example').send({ withdraw_reason: 'motif', expected_recommendation_revision: validated.body.recommendation.revision });
  assert.equal(withdraw.status, 403);

  const replacement = await auth(request(app).post(`/api/advisory/recommendations/${rec.id}/replacement`)).set('Origin', 'https://site-malveillant.example').send({ expected_source_recommendation_revision: validated.body.recommendation.revision, title: 'X', advisor_rationale: 'R', scope: 'household' });
  assert.equal(replacement.status, 403);
});

// IDOR : le cas classique Lot 4A (recommandation EXISTANTE, adressée avec le
// mauvais session_id dans l'URL imbriquée) n'était testé que côté service --
// corrigé en l'ajoutant côté HTTP, sur la route de liste imbriquée sous session.
test('IDOR — une recommandation existante n’apparaît jamais dans la liste d’une AUTRE session', async () => {
  const { sessionId: sessionA } = await createSessionWithActiveFindingHttp();
  const { sessionId: sessionB } = await createSessionWithActiveFindingHttp();
  await createDraftHttp(sessionA);
  const listB = await auth(request(app).get(`/api/advisory/sessions/${sessionB}/recommendations`));
  assert.equal(listB.body.recommendations.length, 0, 'la recommandation de la session A ne doit jamais apparaître dans la liste de la session B');
});

test('cache — GET .../recommendations/history porte aussi Cache-Control: no-store, private', async () => {
  const { sessionId } = await createSessionWithActiveFindingHttp();
  const history = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/recommendations/history`));
  assert.match(history.headers['cache-control'], /no-store/);
});

test('404 neutre — dismiss/withdraw/replacement/findings sur un id inexistant, jamais un 500', async () => {
  const dismiss = await auth(request(app).post('/api/advisory/recommendations/999999999/dismiss')).send({ dismiss_reason: 'motif', expected_recommendation_revision: 1 });
  assert.equal(dismiss.status, 404);
  const withdraw = await auth(request(app).post('/api/advisory/recommendations/999999999/withdraw')).send({ withdraw_reason: 'motif', expected_recommendation_revision: 1 });
  assert.equal(withdraw.status, 404);
  const replacement = await auth(request(app).post('/api/advisory/recommendations/999999999/replacement')).send({ expected_source_recommendation_revision: 1, title: 'X', advisor_rationale: 'R', scope: 'household' });
  assert.equal(replacement.status, 404);
  const linkFinding = await auth(request(app).post('/api/advisory/recommendations/999999999/findings')).send({ finding_id: 1, expected_recommendation_revision: 1 });
  assert.equal(linkFinding.status, 404);
});

test('validation 400 — advisor_rationale vide et domain=mixed refusés via HTTP', async () => {
  const { sessionId } = await createSessionWithActiveFindingHttp();
  const noRationale = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/recommendations`)).send({ domain: 'health', scope: 'household', title: 'T', advisor_rationale: '' });
  assert.equal(noRationale.status, 400);
  const mixedDomain = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/recommendations`)).send({ domain: 'mixed', scope: 'household', title: 'T', advisor_rationale: 'R' });
  assert.equal(mixedDomain.status, 400);
});

test('erreur SQLite non exposée — un second remplacement concurrent (409) ne fuite jamais de détail SQL', async () => {
  const { sessionId, findingId } = await createSessionWithActiveFindingHttp();
  const rec = await createDraftHttp(sessionId, 'health', { summary: 'S' });
  const linked = await auth(request(app).post(`/api/advisory/recommendations/${rec.id}/findings`)).send({ finding_id: findingId, expected_recommendation_revision: rec.revision });
  const validated = await auth(request(app).post(`/api/advisory/recommendations/${rec.id}/validate`)).send({ expected_recommendation_revision: linked.body.revision, expected_session_revision: await rev(sessionId) });
  const source = validated.body.recommendation;

  const first = await auth(request(app).post(`/api/advisory/recommendations/${source.id}/replacement`)).send({ expected_source_recommendation_revision: source.revision, title: 'A', advisor_rationale: 'R', scope: 'household' });
  assert.equal(first.status, 201);
  const second = await auth(request(app).post(`/api/advisory/recommendations/${source.id}/replacement`)).send({ expected_source_recommendation_revision: source.revision, title: 'B', advisor_rationale: 'R', scope: 'household' });
  assert.equal(second.status, 409);
  assert.ok(!/SQLITE|SQL_CONSTRAINT|stack/i.test(JSON.stringify(second.body)), 'aucune fuite de détail SQL dans la réponse 409');
});
