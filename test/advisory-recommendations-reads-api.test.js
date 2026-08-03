// Tests API — couverture DISTINCTE des 3 lectures sensibles du LOT 7A (GATE
// final ciblé §4) : liste, détail, historique. Fichier SÉPARÉ de
// test/advisory-recommendations-api.test.js délibérément, même raison que
// test/advisory-recommendations-writes-api.test.js : processus `node --test`
// distinct = compteur de rate-limiter global `/api` (server/app.js, 600
// requêtes/5 min, une protection de production légitime, jamais désactivée
// pour les tests) indépendant. Le volume de requêtes HTTP de cette suite
// paramétrée (3 lectures × plusieurs scénarios chacune) dépassait la fenêtre
// partagée avec le fichier principal — corrigé en isolant ce fichier.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-recommendations-reads-api-'));
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

async function rev(sessionId) {
  const r = await auth(request(app).get(`/api/advisory/sessions/${sessionId}`));
  return r.body.revision;
}

async function publishBasicRuleSet(domain, questionKey) {
  const rs = await auth(request(app).post('/api/advisory/rule-sets')).send({ stable_key: uniqueKey('rs-reco-reads-api'), domain, name: 'Ensemble API reco (lectures)' });
  await auth(request(app).post(`/api/advisory/rule-sets/${rs.body.id}/rules`)).send({
    stable_key: uniqueKey('TEST-RULE-RECO-READS-API'),
    title: 'Règle technique fictive',
    conditions: { op: 'equals', ref: { answer: questionKey }, value: true },
    required_data: [{ answer: questionKey }],
    result_finding_type: 'detected_need',
    result_payload: { category_hint: 'categorie_reco_reads_api_fictive' },
    priority: 'medium',
    advisor_explanation: 'Explication technique fictive.',
    source: 'Exemple technique fictif — ne constitue pas un conseil d\'assurance.',
    source_reference: 'REF-RECO-READS-API-001',
    effective_from: '2020-01-01',
    sort_order: 1,
  });
  const ownStableKey = db.prepare('SELECT stable_key FROM advisory_rule_sets WHERE id = ?').get(rs.body.id).stable_key;
  const others = db.prepare("SELECT id FROM advisory_rule_sets WHERE domain = ? AND status = 'published' AND stable_key != ?").all(domain, ownStableKey);
  for (const o of others) await auth(request(app).post(`/api/advisory/rule-sets/${o.id}/archive`));
  await auth(request(app).post(`/api/advisory/rule-sets/${rs.body.id}/publish`));
  return rs.body.id;
}

async function createDraftHttp(sessionId, domain = 'health', over = {}) {
  const res = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/recommendations`)).send({
    domain, scope: 'household', title: 'Titre technique fictif', advisor_rationale: 'Justification technique fictive.', ...over,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

// Fixture partagée (questionnaire + rule_set publiés une seule fois pour le
// domaine health) -- même correctif que le fichier -writes-api.test.js pour
// rester sous le plafond du rate-limiter global /api.
let sharedHealthFixture = null;
async function getSharedHealthFixture() {
  if (sharedHealthFixture) return sharedHealthFixture;
  const q = await auth(request(app).post('/api/advisory/questionnaires')).send({ stable_key: uniqueKey('reco-reads-shared-quest'), domain: 'health', name: 'Démo reco partagée (lectures)' });
  const v = await auth(request(app).post(`/api/advisory/questionnaires/${q.body.id}/versions`)).send({});
  const sec = await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/sections`)).send({ stable_key: 's1', title: 'S', sort_order: 1 });
  const questionKey = uniqueKey('q');
  const ques = await auth(request(app).post(`/api/advisory/questionnaires/sections/${sec.body.id}/questions`)).send({ stable_key: questionKey, advisor_text: 'X ?', type: 'boolean', sort_order: 1 });
  await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/publish`)).send({});
  const ruleSetId = await publishBasicRuleSet('health', questionKey);
  sharedHealthFixture = { versionId: v.body.id, questionId: ques.body.id, questionKey, ruleSetId };
  return sharedHealthFixture;
}

// Session COMPLETED avec exactement un finding ACTIF household, en réutilisant
// le questionnaire/rule_set partagés -- seuls le foyer et la session restent
// frais à chaque appel (isolation réelle requise pour les compteurs d'audit).
async function createSessionWithActiveFinding() {
  const { versionId, questionId } = await getSharedHealthFixture();
  const clientId = insertClient({ first_name: `Api${uniqueKey('c')}`, last_name: 'Reco' });
  const house = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: clientId });
  const householdId = house.body.id;
  const session = await auth(request(app).post('/api/advisory/sessions')).send({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: versionId, domain: 'health', module_role: 'domain', display_order: 1 }],
  });
  const sessionId = session.body.id;
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({ expected_revision: await rev(sessionId) });
  await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({
    answers: [{ question_id: questionId, status: 'answered', value: true }],
    expected_revision: await rev(sessionId),
  });
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/complete`)).send({ expected_revision: await rev(sessionId) });
  const analyzeRes = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/analyze`)).send({ expected_revision: await rev(sessionId) });
  assert.equal(analyzeRes.status, 201, JSON.stringify(analyzeRes.body));
  const findingsRes = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/findings`));
  assert.equal(findingsRes.body.findings.length, 1, JSON.stringify(findingsRes.body));
  return { sessionId, householdId, findingId: findingsRes.body.findings[0].id };
}

function auditCountFor(action) {
  return db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?').get(action).n;
}

// ============================================================================
// GATE FINAL — les 3 lectures sensibles, une par une (§4)
// ============================================================================

const READS = [
  { key: 'liste', path: (sessionId) => `/api/advisory/sessions/${sessionId}/recommendations`, auditAction: 'consultation recommandations session' },
  { key: 'détail', path: (sessionId, recId) => `/api/advisory/recommendations/${recId}`, auditAction: 'consultation recommandations session' },
  { key: 'historique', path: (sessionId) => `/api/advisory/sessions/${sessionId}/recommendations/history`, auditAction: 'consultation historique recommandations' },
];

for (const r of READS) {
  test(`lecture « ${r.key} » — authentification obligatoire (401)`, async () => {
    const { sessionId } = await createSessionWithActiveFinding();
    const rec = await createDraftHttp(sessionId);
    const res = await request(app).get(r.path(sessionId, rec.id));
    assert.equal(res.status, 401);
  });

  test(`lecture « ${r.key} » — Cache-Control ET Pragma présents`, async () => {
    const { sessionId } = await createSessionWithActiveFinding();
    const rec = await createDraftHttp(sessionId);
    const res = await auth(request(app).get(r.path(sessionId, rec.id)));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.match(res.headers['cache-control'], /no-store/, `« ${r.key} » : Cache-Control manquant`);
    assert.match(res.headers['cache-control'], /private/, `« ${r.key} » : Cache-Control doit inclure private`);
    assert.equal(res.headers['pragma'], 'no-cache', `« ${r.key} » : Pragma: no-cache manquant`);
  });

  test(`lecture « ${r.key} » — audit émis`, async () => {
    const { sessionId } = await createSessionWithActiveFinding();
    const rec = await createDraftHttp(sessionId);
    const before = auditCountFor(r.auditAction);
    await auth(request(app).get(r.path(sessionId, rec.id)));
    assert.ok(auditCountFor(r.auditAction) > before, `« ${r.key} » : aucune entrée d'audit « ${r.auditAction} » journalisée`);
  });

  test(`lecture « ${r.key} » — aucun contenu narratif dans audit_log.details (marqueur distinctif)`, async () => {
    const marker = 'MARQUEUR-LECTURE-' + Math.random().toString(36).slice(2);
    const { sessionId } = await createSessionWithActiveFinding();
    const rec = await createDraftHttp(sessionId, 'health', { title: marker, advisor_rationale: marker, summary: marker });
    const sinceId = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM audit_log').get().id;
    const res = await auth(request(app).get(r.path(sessionId, rec.id)));
    assert.equal(res.status, 200);
    assert.ok(JSON.stringify(res.body).includes(marker), 'sanity : le corps DOIT contenir le marqueur (donnée normale renvoyée au conseiller authentifié)');
    const rows = db.prepare('SELECT details FROM audit_log WHERE id > ?').all(sinceId);
    for (const row of rows) {
      assert.ok(!String(row.details || '').includes(marker), `« ${r.key} » : fuite dans audit_log.details : ${row.details}`);
    }
  });
}

test('lecture « détail » — identifiant inexistant : 404 neutre, jamais un 500', async () => {
  const res = await auth(request(app).get('/api/advisory/recommendations/999999999'));
  assert.equal(res.status, 404);
});

test('lecture « liste »/« historique » — session inexistante : 404 neutre, jamais un 500', async () => {
  const list = await auth(request(app).get('/api/advisory/sessions/999999999/recommendations'));
  assert.equal(list.status, 404);
  const history = await auth(request(app).get('/api/advisory/sessions/999999999/recommendations/history'));
  assert.equal(history.status, 404);
});

test('IDOR — une recommandation d’une session A n’apparaît jamais dans l’historique d’une AUTRE session B', async () => {
  // Corrige un écart relevé par la revue ciblée finale : seule la route
  // liste avait ce test explicite (test/advisory-recommendations-api.test.js),
  // aucun n'existait pour la route historique alors qu'elle utilise la même
  // clause `WHERE session_id = ?` (getSessionRecommendationsHistory).
  const { sessionId: sessionA } = await createSessionWithActiveFinding();
  const { sessionId: sessionB } = await createSessionWithActiveFinding();
  await createDraftHttp(sessionA);
  const historyB = await auth(request(app).get(`/api/advisory/sessions/${sessionB}/recommendations/history`));
  assert.equal(historyB.status, 200);
  assert.equal(historyB.body.recommendations.length, 0, 'la recommandation de la session A ne doit jamais apparaître dans l’historique de la session B');
});

test('IDOR — lecture « détail » d’une recommandation existante via /recommendations/:id fonctionne quel que soit le session_id d’origine (dérivé, jamais pris pour argent comptant)', async () => {
  const { sessionId } = await createSessionWithActiveFinding();
  const rec = await createDraftHttp(sessionId);
  // La route directe /api/advisory/recommendations/:id dérive elle-même le
  // session_id réel (findRecommendationSessionId) -- confirme qu'elle
  // retourne bien LA recommandation demandée, jamais une autre.
  const detail = await auth(request(app).get(`/api/advisory/recommendations/${rec.id}`));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.id, rec.id);
  assert.equal(detail.body.session_id, sessionId);
});

// ============================================================================
// Correctif final avant commit — validation stricte du paramètre `domain`
// des routes de lecture liste/historique (common | health | life_pension
// uniquement, validation centralisée `assertValidDomainFilter`,
// server/advisoryRecommendations.js). Corrige un point signalé par la revue
// ciblée `compliance-privacy-reviewer` : le paramètre n'était pas validé
// avant d'être utilisé en SQL et en audit.
// ============================================================================

const DOMAIN_FILTER_ROUTES = [
  { key: 'liste', path: (sessionId, domain) => `/api/advisory/sessions/${sessionId}/recommendations${domain !== undefined ? `?domain=${encodeURIComponent(domain)}` : ''}` },
  { key: 'historique', path: (sessionId, domain) => `/api/advisory/sessions/${sessionId}/recommendations/history${domain !== undefined ? `?domain=${encodeURIComponent(domain)}` : ''}` },
];

for (const r of DOMAIN_FILTER_ROUTES) {
  test(`filtre domain « ${r.key} » — common/health/life_pension acceptés (200), filtre appliqué correctement`, async () => {
    const { sessionId } = await createSessionWithActiveFinding();
    await createDraftHttp(sessionId, 'health');

    const healthRes = await auth(request(app).get(r.path(sessionId, 'health')));
    assert.equal(healthRes.status, 200, JSON.stringify(healthRes.body));
    assert.equal(healthRes.body.recommendations.length, 1, `« ${r.key} » : domain=health doit inclure la recommandation health`);

    const commonRes = await auth(request(app).get(r.path(sessionId, 'common')));
    assert.equal(commonRes.status, 200, JSON.stringify(commonRes.body));
    assert.equal(commonRes.body.recommendations.length, 0, `« ${r.key} » : domain=common ne doit jamais inclure une recommandation health`);

    const lifePensionRes = await auth(request(app).get(r.path(sessionId, 'life_pension')));
    assert.equal(lifePensionRes.status, 200, JSON.stringify(lifePensionRes.body));
    assert.equal(lifePensionRes.body.recommendations.length, 0, `« ${r.key} » : domain=life_pension ne doit jamais inclure une recommandation health`);
  });

  test(`filtre domain « ${r.key} » — absent : requête autorisée, résultats non filtrés`, async () => {
    const { sessionId } = await createSessionWithActiveFinding();
    await createDraftHttp(sessionId, 'health');
    const res = await auth(request(app).get(r.path(sessionId, undefined)));
    assert.equal(res.status, 200);
    assert.equal(res.body.recommendations.length, 1, `« ${r.key} » : domain absent ne doit jamais filtrer`);
  });

  test(`filtre domain « ${r.key} » — valeur invalide refusée (400), aucune donnée retournée, aucune erreur SQL exposée`, async () => {
    const { sessionId } = await createSessionWithActiveFinding();
    await createDraftHttp(sessionId, 'health');
    const res = await auth(request(app).get(r.path(sessionId, 'invalid')));
    assert.equal(res.status, 400);
    assert.equal(res.body.recommendations, undefined, `« ${r.key} » : aucune donnée de recommandation ne doit être retournée après un refus`);
    assert.ok(!/SQL|SQLITE|stack/i.test(JSON.stringify(res.body)), `« ${r.key} » : aucune fuite de détail SQL/technique`);
  });

  test(`filtre domain « ${r.key} » — marqueur arbitraire dans une valeur invalide : jamais journalisé, aucun audit de consultation réussie`, async () => {
    const marker = 'MARQUEUR-DOMAIN-' + Math.random().toString(36).slice(2);
    const { sessionId } = await createSessionWithActiveFinding();
    await createDraftHttp(sessionId, 'health');
    const sinceId = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM audit_log').get().id;
    const beforeSessionView = auditCountFor('consultation recommandations session');
    const beforeHistoryView = auditCountFor('consultation historique recommandations');
    const res = await auth(request(app).get(r.path(sessionId, marker)));
    assert.equal(res.status, 400);
    assert.equal(auditCountFor('consultation recommandations session'), beforeSessionView, `« ${r.key} » : aucun audit de consultation réussie après un refus`);
    assert.equal(auditCountFor('consultation historique recommandations'), beforeHistoryView, `« ${r.key} » : aucun audit d'historique après un refus`);
    const rows = db.prepare('SELECT details FROM audit_log WHERE id > ?').all(sinceId);
    for (const row of rows) {
      assert.ok(!String(row.details || '').includes(marker), `« ${r.key} » : le marqueur ne doit jamais apparaître dans audit_log.details : ${row.details}`);
    }
  });

  test(`filtre domain « ${r.key} » — authentification toujours requise (401), même avec un domain valide`, async () => {
    const { sessionId } = await createSessionWithActiveFinding();
    const res = await request(app).get(r.path(sessionId, 'health'));
    assert.equal(res.status, 401);
  });

  test(`filtre domain « ${r.key} » — Cache-Control ET Pragma toujours présents, même avec un domain valide`, async () => {
    const { sessionId } = await createSessionWithActiveFinding();
    const res = await auth(request(app).get(r.path(sessionId, 'health')));
    assert.equal(res.status, 200);
    assert.match(res.headers['cache-control'], /no-store/, `« ${r.key} » : Cache-Control manquant`);
    assert.match(res.headers['cache-control'], /private/, `« ${r.key} » : Cache-Control doit inclure private`);
    assert.equal(res.headers['pragma'], 'no-cache', `« ${r.key} » : Pragma: no-cache manquant`);
  });
}

test('filtre domain — IDOR toujours conforme : une recommandation de la session A n’apparaît jamais dans la liste filtrée d’une AUTRE session B', async () => {
  const { sessionId: sessionA } = await createSessionWithActiveFinding();
  const { sessionId: sessionB } = await createSessionWithActiveFinding();
  await createDraftHttp(sessionA, 'health');
  const listB = await auth(request(app).get(`/api/advisory/sessions/${sessionB}/recommendations?domain=health`));
  assert.equal(listB.status, 200);
  assert.equal(listB.body.recommendations.length, 0, 'la recommandation de la session A ne doit jamais apparaître dans la liste filtrée de la session B');
});
