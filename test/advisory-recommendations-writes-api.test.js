// Tests API — couverture DISTINCTE auth/CSRF pour les 10 écritures du LOT 7A
// (GATE final ciblé §3). Fichier SÉPARÉ de test/advisory-recommendations-api.test.js
// délibérément : processus `node --test` distinct = compteur de
// rate-limiter global `/api` (server/app.js, 600 requêtes/5 min, une
// protection de production légitime, jamais désactivée pour les tests)
// indépendant. Le volume de requêtes HTTP de cette suite paramétrée (30
// scénarios × plusieurs appels chacun) dépassait la fenêtre partagée avec
// le fichier principal — corrigé en isolant ce fichier, jamais en touchant
// au rate-limiter serveur lui-même.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-recommendations-writes-api-'));
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
  const rs = await auth(request(app).post('/api/advisory/rule-sets')).send({ stable_key: uniqueKey('rs-reco-writes-api'), domain, name: 'Ensemble API reco (écritures)' });
  await auth(request(app).post(`/api/advisory/rule-sets/${rs.body.id}/rules`)).send({
    stable_key: uniqueKey('TEST-RULE-RECO-WRITES-API'),
    title: 'Règle technique fictive',
    conditions: { op: 'equals', ref: { answer: questionKey }, value: true },
    required_data: [{ answer: questionKey }],
    result_finding_type: 'detected_need',
    result_payload: { category_hint: 'categorie_reco_writes_api_fictive' },
    priority: 'medium',
    advisor_explanation: 'Explication technique fictive.',
    source: 'Exemple technique fictif — ne constitue pas un conseil d\'assurance.',
    source_reference: 'REF-RECO-WRITES-API-001',
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

// ============================================================================
// GATE FINAL — couverture auth/CSRF DISTINCTE pour les 10 écritures (§3)
// ============================================================================

// Fixture partagée (construite une seule fois, réutilisée par les 30
// scénarios ci-dessous) : un questionnaire ET un rule_set publiés une seule
// fois pour le domaine health -- corrige un dépassement RÉEL du
// rate-limiter global /api (600 requêtes/5 min, server/app.js, une
// protection de production légitime, jamais désactivée pour les tests)
// déclenché par le volume de requêtes HTTP de cette suite paramétrée.
// Sûr : aucun autre test de ce fichier n'exécute plus PublishBasicRuleSet
// pour 'health' après le début de cette suite (elle est placée en toute fin
// de fichier), donc ce rule_set partagé reste publié, jamais archivé
// entre-temps par un autre scénario.
let sharedHealthFixture = null;
async function getSharedHealthFixture() {
  if (sharedHealthFixture) return sharedHealthFixture;
  const q = await auth(request(app).post('/api/advisory/questionnaires')).send({ stable_key: uniqueKey('reco-shared-quest'), domain: 'health', name: 'Démo reco partagée' });
  const v = await auth(request(app).post(`/api/advisory/questionnaires/${q.body.id}/versions`)).send({});
  const sec = await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/sections`)).send({ stable_key: 's1', title: 'S', sort_order: 1 });
  const questionKey = uniqueKey('q');
  const ques = await auth(request(app).post(`/api/advisory/questionnaires/sections/${sec.body.id}/questions`)).send({ stable_key: questionKey, advisor_text: 'X ?', type: 'boolean', sort_order: 1 });
  await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/publish`)).send({});
  const ruleSetId = await publishBasicRuleSet('health', questionKey);
  sharedHealthFixture = { versionId: v.body.id, questionId: ques.body.id, questionKey, ruleSetId };
  return sharedHealthFixture;
}

// Version allégée de createSessionWithActiveFindingHttp : réutilise le
// questionnaire/rule_set partagés au lieu d'en recréer un à chaque scénario
// (household et session restent, eux, toujours FRAIS -- isolation réelle
// requise pour les compteurs de mutation). `extraMembers` (0 par défaut) :
// nombre de membres supplémentaires ajoutés AU FOYER AVANT le démarrage de
// la session -- indispensable pour qu'ils entrent dans le household_snapshot
// figé (un membre ajouté APRÈS le démarrage n'est jamais ciblable, invariant
// déjà vérifié ailleurs ; les scénarios linkMember/unlinkMember ont donc
// besoin d'un second membre PRÉ-EXISTANT, jamais ajouté après coup).
async function createSessionOnSharedFixture({ extraMembers = 0 } = {}) {
  const { versionId, questionId } = await getSharedHealthFixture();
  const clientId = insertClient({ first_name: `Api${uniqueKey('c')}`, last_name: 'Reco' });
  const house = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: clientId });
  const householdId = house.body.id;
  const principalMemberId = db.prepare("SELECT id FROM household_members WHERE household_id = ? AND member_role = 'principal'").get(householdId).id;
  const extraMemberIds = [];
  for (let i = 0; i < extraMembers; i += 1) {
    const extraClientId = insertClient({ first_name: `Second${i}`, last_name: 'Membre' });
    const extra = await auth(request(app).post(`/api/advisory/households/${householdId}/members`)).send({ member_role: 'conjoint', client_id: extraClientId });
    extraMemberIds.push(extra.body.id);
  }
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
  return { sessionId, householdId, principalMemberId, extraMemberIds, findingId: findingsRes.body.findings[0].id };
}

function recRow(recId) {
  return db.prepare('SELECT revision, status FROM advisory_recommendations WHERE id = ?').get(recId);
}
function linkedFindingCount(recId) {
  return db.prepare('SELECT COUNT(*) AS n FROM advisory_recommendation_findings WHERE recommendation_id = ?').get(recId).n;
}
function linkedMemberCount(recId) {
  return db.prepare('SELECT COUNT(*) AS n FROM advisory_recommendation_members WHERE recommendation_id = ?').get(recId).n;
}
function recCountForSession(sessionId) {
  return db.prepare('SELECT COUNT(*) AS n FROM advisory_recommendations WHERE session_id = ?').get(sessionId).n;
}
function auditCountFor(action) {
  return db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?').get(action).n;
}

// Construit un scénario FRAIS pour chacune des 10 écritures -- chaque appel
// crée sa propre session/recommandation, jamais partagée entre les 3 tests
// (401/403/conforme) d'une même écriture, pour que l'ordre d'exécution ne
// puisse jamais fausser un résultat.
async function buildWriteFixture(key) {
  switch (key) {
    case 'create': {
      const { sessionId } = await createSessionOnSharedFixture();
      return {
        method: 'post', path: `/api/advisory/sessions/${sessionId}/recommendations`,
        body: { domain: 'health', scope: 'household', title: 'T', advisor_rationale: 'R' },
        successStatus: 201, auditAction: 'recommandation créée',
        snapshotBefore: () => recCountForSession(sessionId),
        snapshotAfter: () => recCountForSession(sessionId),
      };
    }
    case 'update': {
      const { sessionId } = await createSessionOnSharedFixture();
      const rec = await createDraftHttp(sessionId);
      return {
        method: 'put', path: `/api/advisory/recommendations/${rec.id}`,
        body: { title: 'X', expected_recommendation_revision: rec.revision },
        successStatus: 200, auditAction: 'recommandation modifiée',
        snapshotBefore: () => recRow(rec.id), snapshotAfter: () => recRow(rec.id),
      };
    }
    case 'linkFinding': {
      const { sessionId, findingId } = await createSessionOnSharedFixture();
      const rec = await createDraftHttp(sessionId);
      return {
        method: 'post', path: `/api/advisory/recommendations/${rec.id}/findings`,
        body: { finding_id: findingId, expected_recommendation_revision: rec.revision },
        successStatus: 201, auditAction: 'finding lié',
        snapshotBefore: () => linkedFindingCount(rec.id), snapshotAfter: () => linkedFindingCount(rec.id),
      };
    }
    case 'unlinkFinding': {
      const { sessionId, findingId } = await createSessionOnSharedFixture();
      const rec = await createDraftHttp(sessionId);
      const linked = await auth(request(app).post(`/api/advisory/recommendations/${rec.id}/findings`)).send({ finding_id: findingId, expected_recommendation_revision: rec.revision });
      return {
        method: 'delete', path: `/api/advisory/recommendations/${rec.id}/findings/${findingId}`,
        body: { expected_recommendation_revision: linked.body.revision },
        successStatus: 200, auditAction: 'finding délié',
        snapshotBefore: () => linkedFindingCount(rec.id), snapshotAfter: () => linkedFindingCount(rec.id),
      };
    }
    case 'linkMember': {
      const { sessionId, principalMemberId, extraMemberIds } = await createSessionOnSharedFixture({ extraMembers: 1 });
      const rec = await createDraftHttp(sessionId, 'health', { scope: 'member', member_ids: [principalMemberId] });
      return {
        method: 'post', path: `/api/advisory/recommendations/${rec.id}/members`,
        body: { household_member_id: extraMemberIds[0], expected_recommendation_revision: rec.revision },
        successStatus: 201, auditAction: 'membre lié',
        snapshotBefore: () => linkedMemberCount(rec.id), snapshotAfter: () => linkedMemberCount(rec.id),
      };
    }
    case 'unlinkMember': {
      const { sessionId, principalMemberId, extraMemberIds } = await createSessionOnSharedFixture({ extraMembers: 1 });
      const rec = await createDraftHttp(sessionId, 'health', { scope: 'member', member_ids: [principalMemberId] });
      const linked = await auth(request(app).post(`/api/advisory/recommendations/${rec.id}/members`)).send({ household_member_id: extraMemberIds[0], expected_recommendation_revision: rec.revision });
      assert.equal(linked.status, 201, JSON.stringify(linked.body));
      return {
        method: 'delete', path: `/api/advisory/recommendations/${rec.id}/members/${extraMemberIds[0]}`,
        body: { expected_recommendation_revision: linked.body.revision },
        successStatus: 200, auditAction: 'membre délié',
        snapshotBefore: () => linkedMemberCount(rec.id), snapshotAfter: () => linkedMemberCount(rec.id),
      };
    }
    case 'validate': {
      const { sessionId, findingId } = await createSessionOnSharedFixture();
      const rec = await createDraftHttp(sessionId, 'health', { summary: 'S', finding_ids: [findingId] });
      return {
        method: 'post', path: `/api/advisory/recommendations/${rec.id}/validate`,
        body: { expected_recommendation_revision: rec.revision, expected_session_revision: await rev(sessionId) },
        successStatus: 200, auditAction: 'recommandation validée',
        snapshotBefore: () => recRow(rec.id), snapshotAfter: () => recRow(rec.id),
      };
    }
    case 'dismiss': {
      const { sessionId } = await createSessionOnSharedFixture();
      const rec = await createDraftHttp(sessionId);
      return {
        method: 'post', path: `/api/advisory/recommendations/${rec.id}/dismiss`,
        body: { dismiss_reason: 'motif fictif', expected_recommendation_revision: rec.revision },
        successStatus: 200, auditAction: 'recommandation écartée',
        snapshotBefore: () => recRow(rec.id), snapshotAfter: () => recRow(rec.id),
      };
    }
    case 'withdraw': {
      const { sessionId, findingId } = await createSessionOnSharedFixture();
      const rec = await createDraftHttp(sessionId, 'health', { summary: 'S', finding_ids: [findingId] });
      const validated = await auth(request(app).post(`/api/advisory/recommendations/${rec.id}/validate`)).send({ expected_recommendation_revision: rec.revision, expected_session_revision: await rev(sessionId) });
      return {
        method: 'post', path: `/api/advisory/recommendations/${rec.id}/withdraw`,
        body: { withdraw_reason: 'motif fictif', expected_recommendation_revision: validated.body.recommendation.revision },
        successStatus: 200, auditAction: 'recommandation retirée',
        snapshotBefore: () => recRow(rec.id), snapshotAfter: () => recRow(rec.id),
      };
    }
    case 'replacement': {
      const { sessionId, findingId } = await createSessionOnSharedFixture();
      const rec = await createDraftHttp(sessionId, 'health', { summary: 'S', finding_ids: [findingId] });
      const validated = await auth(request(app).post(`/api/advisory/recommendations/${rec.id}/validate`)).send({ expected_recommendation_revision: rec.revision, expected_session_revision: await rev(sessionId) });
      const source = validated.body.recommendation;
      return {
        method: 'post', path: `/api/advisory/recommendations/${source.id}/replacement`,
        body: { expected_source_recommendation_revision: source.revision, title: 'X', advisor_rationale: 'R', scope: 'household' },
        successStatus: 201, auditAction: 'recommandation créée',
        snapshotBefore: () => recCountForSession(sessionId), snapshotAfter: () => recCountForSession(sessionId),
      };
    }
    default:
      throw new Error(`clé inconnue : ${key}`);
  }
}

const WRITE_KEYS = ['create', 'update', 'linkFinding', 'unlinkFinding', 'linkMember', 'unlinkMember', 'validate', 'dismiss', 'withdraw', 'replacement'];

for (const key of WRITE_KEYS) {
  test(`écriture « ${key} » — non authentifié refusé (401), aucune mutation, aucun audit de succès`, async () => {
    const fx = await buildWriteFixture(key);
    const before = fx.snapshotBefore();
    const beforeAudit = auditCountFor(fx.auditAction);
    const res = await request(app)[fx.method](fx.path).send(fx.body);
    assert.equal(res.status, 401);
    assert.deepEqual(fx.snapshotAfter(), before, `« ${key} » : une mutation a eu lieu malgré le refus 401`);
    assert.equal(auditCountFor(fx.auditAction), beforeAudit, `« ${key} » : un audit de succès a été journalisé malgré le refus 401`);
  });

  test(`écriture « ${key} » — CSRF intersite refusé (403), aucune mutation, aucun audit de succès`, async () => {
    const fx = await buildWriteFixture(key);
    const before = fx.snapshotBefore();
    const beforeAudit = auditCountFor(fx.auditAction);
    const res = await auth(request(app)[fx.method](fx.path)).set('Origin', 'https://site-malveillant.example').send(fx.body);
    assert.equal(res.status, 403);
    assert.deepEqual(fx.snapshotAfter(), before, `« ${key} » : une mutation a eu lieu malgré le refus CSRF 403`);
    assert.equal(auditCountFor(fx.auditAction), beforeAudit, `« ${key} » : un audit de succès a été journalisé malgré le refus CSRF 403`);
  });

  test(`écriture « ${key} » — requête conforme n'est jamais bloquée par le middleware de sécurité`, async () => {
    const fx = await buildWriteFixture(key);
    const res = await auth(request(app)[fx.method](fx.path)).send(fx.body);
    assert.equal(res.status, fx.successStatus, `« ${key} » : requête légitime bloquée à tort (corps : ${JSON.stringify(res.body)})`);
  });
}
