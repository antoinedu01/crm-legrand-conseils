// Tests API — GET /api/advisory/sessions/:id/health-synthesis (SYNTH-API).
// Même convention que test/advisory-rule-executions-api.test.js. Contenu
// réel Diagnostic Santé v2 (server/seed-advisory-health-content.js),
// provisionné et publié DIRECTEMENT (jamais recréé question par question
// via l'API — inutile et hors-scope ici) : seule la route sous test, les
// sessions/réponses/exécutions et les foyers passent par l'API HTTP réelle
// (`supertest`), exactement comme un vrai client. Tout le contenu ici est
// fictif et technique.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-health-synthesis-api-'));
process.env.NODE_ENV = 'test';
process.env.SITE_ORIGINS = 'https://site-de-test.ch';
process.env.PUBLIC_RATE_LIMIT = '100';

const { default: app } = await import('../server/app.js');
const { default: db } = await import('../server/db.js');
const Q = await import('../server/advisoryQuestionnaires.js');
const R = await import('../server/advisoryRules.js');
const Seed = await import('../server/seed-advisory-health-content.js');
const Synth = await import('../server/advisoryHealthSynthesis.js');

const PASSWORD = 'MotDePasseDeTest!42';
let cookie = '';
function auth(req) { return req.set('Cookie', cookie); }

let counter = 0;
function uniqueKey(prefix) {
  counter += 1;
  return `${prefix}-${counter}-${Math.random().toString(36).slice(2)}`;
}
function insertClient(over = {}) {
  const data = { type: 'particulier', first_name: 'Prenom', last_name: 'Nom', status: 'prospect', ...over };
  return db.prepare('INSERT INTO clients (type, first_name, last_name, status) VALUES (?, ?, ?, ?)')
    .run(data.type, data.first_name, data.last_name, data.status).lastInsertRowid;
}
function auditRowsFor(sessionId, action) {
  return db.prepare("SELECT * FROM audit_log WHERE entity = 'advisory_session' AND entity_id = ? AND action = ? ORDER BY id").all(sessionId, action);
}
function tableCount(table) {
  return db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
}

// --- Provisioning + publication v1/v2, une seule fois pour tout le fichier
// (même ordre que test/advisoryHealthSynthesis.test.js : v1 publié EN
// PREMIER pour pouvoir construire la fixture « dernière exécution v1 »
// avant de publier v2, qui supersède alors v1 automatiquement — même
// stable_key).
// Provisionné/publié DANS `before()`, après la création du compte courtier
// via `/api/auth/setup` (§1 ci-dessous) -- jamais avant : `/api/auth/setup`
// refuse (403 « Le compte est déjà configuré ») dès que la table `users`
// contient la moindre ligne, y compris une ligne technique insérée
// directement en base pour les besoins du seed. `REQ_SEED` réutilise donc
// l'utilisateur réellement créé par `/api/auth/setup`.
let seed1;
let seed2;

function qidV2(stableKey) {
  const detail = Q.getVersionDetail(seed2.versionId);
  for (const section of detail.sections) for (const q of section.questions) if (q.stable_key === stableKey) return q.id;
  throw new Error(`question v2 introuvable : ${stableKey}`);
}

// Même socle neutre que test/advisoryHealthSynthesis.test.js (accident
// « maintien » propre, franchise « indéterminée », care model complet, 6
// complémentaires à « pas_important ») — couvre toutes les questions
// `required: true` de la v2.
const BASELINE_ANSWERS = [
  ['couverture_accident_hors_lamal_declaree', 'non'],
  ['accident_inclus_lamal_declare', 'oui'],
  ['franchise_actuelle_niveau_declare', 'moyenne'],
  ['capacite_absorber_depense_annuelle', 'moyenne'],
  ['tolerance_risque_financier', 'moyenne'],
  ['recours_soins_12_mois_declare', 'modere'],
  ['depenses_sante_anticipees_declare', 'probablement_moderees'],
  ['priorite_prime_liberte_declaree', 'equilibre'],
  ['importance_conserver_medecin_declaree', 'indifferent'],
  ['ouverture_telemedecine_declaree', 'accepte'],
  ['ouverture_medecin_famille_declaree', 'accepte'],
  ['ouverture_hmo_reseau_declaree', 'accepte'],
  ['priorite_libre_choix_declaree', 'non_prioritaire'],
  ['interet_complementaire_hospitalisation_declare', 'pas_important'],
  ['interet_medecines_complementaires_declare', 'pas_important'],
  ['interet_complementaire_optique_declare', 'pas_important'],
  ['interet_complementaire_dentaire_declare', 'pas_important'],
  ['interet_prevention_declare', 'pas_important'],
  ['interet_couverture_voyage_declare', 'pas_important'],
];

async function rev(sessionId) {
  const r = await auth(request(app).get(`/api/advisory/sessions/${sessionId}`));
  return r.body.revision;
}
async function createHouseholdHttp() {
  const clientId = insertClient({ first_name: `Api${uniqueKey('c')}`, last_name: 'Synth' });
  const res = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: clientId });
  const memberId = db.prepare("SELECT id FROM household_members WHERE household_id = ? AND member_role = 'principal'").get(res.body.id).id;
  return { householdId: res.body.id, memberId };
}
async function createV2SessionHttp(householdId) {
  const session = await auth(request(app).post('/api/advisory/sessions')).send({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: seed2.versionId, domain: 'health', module_role: 'domain', display_order: 1 }],
  });
  const sessionId = session.body.id;
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({ expected_revision: await rev(sessionId) });
  return sessionId;
}
async function createV1SessionHttp(householdId) {
  const session = await auth(request(app).post('/api/advisory/sessions')).send({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: seed1.versionId, domain: 'health', module_role: 'domain', display_order: 1 }],
  });
  const sessionId = session.body.id;
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({ expected_revision: await rev(sessionId) });
  return sessionId;
}
async function answerBaselineHttp(sessionId, memberId, overrides = []) {
  const map = new Map(BASELINE_ANSWERS.map(([k, v]) => [k, v]));
  for (const [k, v] of overrides) map.set(k, v);
  const answers = [...map.entries()].map(([key, value]) => ({ question_id: qidV2(key), household_member_id: memberId, status: 'answered', value }));
  const res = await auth(request(app).put(`/api/advisory/sessions/${sessionId}/answers`)).send({ answers, expected_revision: await rev(sessionId) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}
async function completeHttp(sessionId) {
  const res = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/complete`)).send({ expected_revision: await rev(sessionId) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}
async function executeHttp(sessionId, ruleSetId) {
  const res = await auth(request(app).post(`/api/advisory/sessions/${sessionId}/rule-executions`))
    .send({ domain: 'health', expected_revision: await rev(sessionId), rule_set_id: ruleSetId });
  assert.equal(res.status, 201, JSON.stringify(res.body));
}
async function buildCurrentSession(overrides = []) {
  const { householdId, memberId } = await createHouseholdHttp();
  const sessionId = await createV2SessionHttp(householdId);
  await answerBaselineHttp(sessionId, memberId, overrides);
  await completeHttp(sessionId);
  await executeHttp(sessionId, seed2.ruleSetId);
  return { sessionId, householdId, memberId };
}

// Questionnaire vie/prévoyance minimal (domaine non santé), pour le
// scénario « session ne contenant ni health ni mixed » — même patron que
// buildHouseholdAndPublishedVersion dans test/advisory-rule-executions-api.test.js.
async function buildLifePensionSessionHttp() {
  const clientId = insertClient({ first_name: `Api${uniqueKey('lp')}`, last_name: 'Vie' });
  const house = await auth(request(app).post('/api/advisory/households')).send({ primary_client_id: clientId });
  const qres = await auth(request(app).post('/api/advisory/questionnaires'))
    .send({ stable_key: uniqueKey('lp-quest'), domain: 'life_pension', name: 'Démo vie/prévoyance' });
  const v = await auth(request(app).post(`/api/advisory/questionnaires/${qres.body.id}/versions`)).send({});
  const sec = await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/sections`))
    .send({ stable_key: 's1', title: 'Section', sort_order: 1 });
  await auth(request(app).post(`/api/advisory/questionnaires/sections/${sec.body.id}/questions`))
    .send({ stable_key: uniqueKey('lp-q'), advisor_text: 'Question fictive ?', type: 'boolean', sort_order: 1 });
  const pub = await auth(request(app).post(`/api/advisory/questionnaires/versions/${v.body.id}/publish`)).send({});
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  const session = await auth(request(app).post('/api/advisory/sessions')).send({
    household_id: house.body.id, domain: 'life_pension',
    questionnaire_versions: [{ questionnaire_version_id: v.body.id, domain: 'life_pension', module_role: 'domain', display_order: 1 }],
  });
  const sessionId = session.body.id;
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/start`)).send({ expected_revision: await rev(sessionId) });
  return sessionId;
}

let v1ExecutionSessionId;
let v1QuestionnaireSessionId;

before(async () => {
  const res = await request(app).post('/api/auth/setup').send({ email: 'test@exemple.ch', name: 'Testeur', password: PASSWORD });
  assert.equal(res.status, 200);
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');

  // Provisioning + publication v1/v2 (même ordre que
  // test/advisoryHealthSynthesis.test.js : v1 publié EN PREMIER pour
  // pouvoir construire la fixture « dernière exécution v1 » avant de
  // publier v2, qui supersède alors v1 automatiquement -- même stable_key).
  const REQ_SEED = { session: { userEmail: 'test@exemple.ch' } };
  seed1 = Seed.seedAdvisoryHealthContent(REQ_SEED);
  seed2 = Seed.seedAdvisoryHealthContentV2(REQ_SEED);
  assert.ok(seed1.created && seed2.created, 'seed v1/v2 attendu neuf sur une base de test isolée');
  Q.publishVersion(seed1.versionId, REQ_SEED);
  Q.publishVersion(seed2.versionId, REQ_SEED);
  R.publishRuleSet(seed1.ruleSetId, REQ_SEED); // v1 devient l'ensemble publié « santé »

  // Fixture VERSION GUARD : questionnaire v2, dernière exécution Santé
  // utilisant le rule_set v1 (encore publié à cet instant précis).
  const { householdId: vgHouseholdId, memberId: vgMemberId } = await createHouseholdHttp();
  v1ExecutionSessionId = await createV2SessionHttp(vgHouseholdId);
  await answerBaselineHttp(v1ExecutionSessionId, vgMemberId);
  await completeHttp(v1ExecutionSessionId);
  await executeHttp(v1ExecutionSessionId, seed1.ruleSetId);

  R.publishRuleSet(seed2.ruleSetId, REQ_SEED); // supersède v1 -- v2 publié pour tout le reste du fichier

  // Fixture VERSION GUARD : session dont le questionnaire est v1.
  const { householdId: v1QHouseholdId } = await createHouseholdHttp();
  v1QuestionnaireSessionId = await createV1SessionHttp(v1QHouseholdId);
});

// =========================================================================
// 1. Authentification requise
// =========================================================================

test('1 — sans cookie de session : 401', async () => {
  const res = await request(app).get('/api/advisory/sessions/1/health-synthesis');
  assert.equal(res.status, 401);
});

// =========================================================================
// 2. Autorisation identique à findings-workspace
// =========================================================================

test('2 — même politique d\'accès en lecture que /findings-workspace : succès avec le même cookie, aucune restriction supplémentaire', async () => {
  const { sessionId } = await buildCurrentSession();
  const findings = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/findings-workspace`));
  const synthesis = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/health-synthesis`));
  assert.equal(findings.status, 200);
  assert.equal(synthesis.status, 200);
});

test('2 — Cache-Control: no-store, private (même convention que /findings-workspace, réponses potentiellement médicales)', async () => {
  const { sessionId } = await buildCurrentSession();
  const res = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/health-synthesis`));
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store, private');
  assert.equal(res.headers.pragma, 'no-cache');
});

// =========================================================================
// 3. Session inexistante -> 404
// =========================================================================

test('3 — session inexistante : 404', async () => {
  const res = await auth(request(app).get('/api/advisory/sessions/9999999/health-synthesis'));
  assert.equal(res.status, 404);
});

// =========================================================================
// 4. Domaine non health/mixed -> 400
// =========================================================================

test('4 — session de domaine life_pension (ni health ni mixed) : 400 explicite', async () => {
  const sessionId = await buildLifePensionSessionHttp();
  const res = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/health-synthesis`));
  assert.equal(res.status, 400);
});

// =========================================================================
// 5/6/7. current / stale / not_run -> toujours 200
// =========================================================================

test('5 — current : 200, requires_reanalysis false', async () => {
  const { sessionId } = await buildCurrentSession();
  const res = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/health-synthesis`));
  assert.equal(res.status, 200);
  assert.equal(res.body.analysis_status, 'current');
  assert.equal(res.body.requires_reanalysis, false);
});

test('6 — stale : 200, requires_reanalysis true (jamais transformé en erreur HTTP)', async () => {
  const { sessionId, memberId } = await buildCurrentSession();
  await auth(request(app).post(`/api/advisory/sessions/${sessionId}/answers/amend`)).send({
    question_id: qidV2('tolerance_risque_financier'), household_member_id: memberId,
    status: 'answered', value: 'faible',
    amendment_reason: 'Correction fictive de test API — bascule de staleness.',
    expected_revision: await rev(sessionId),
  });
  const res = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/health-synthesis`));
  assert.equal(res.status, 200);
  assert.equal(res.body.analysis_status, 'stale');
  assert.equal(res.body.requires_reanalysis, true);
});

test('7 — not_run (aucune exécution) : 200, analysis_status not_run, requires_reanalysis true, jamais de relance automatique', async () => {
  const { householdId, memberId } = await createHouseholdHttp();
  const sessionId = await createV2SessionHttp(householdId);
  await answerBaselineHttp(sessionId, memberId);
  await completeHttp(sessionId);
  const beforeExecutions = tableCount('advisory_rule_executions');
  const res = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/health-synthesis`));
  assert.equal(res.status, 200);
  assert.equal(res.body.analysis_status, 'not_run');
  assert.equal(res.body.requires_reanalysis, true);
  assert.equal(tableCount('advisory_rule_executions'), beforeExecutions, 'la route ne doit jamais relancer l\'analyse automatiquement');
});

// =========================================================================
// 8. VERSION GUARD -> 409 HEALTH_SYNTHESIS_UNSUPPORTED_VERSION
// =========================================================================

test('8.D — questionnaire Santé v1 : 409, code HEALTH_SYNTHESIS_UNSUPPORTED_VERSION', async () => {
  const res = await auth(request(app).get(`/api/advisory/sessions/${v1QuestionnaireSessionId}/health-synthesis`));
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'HEALTH_SYNTHESIS_UNSUPPORTED_VERSION');
});

test('8.E — questionnaire v2, dernière exécution Santé utilisant le rule_set v1 : 409, même code', async () => {
  const res = await auth(request(app).get(`/api/advisory/sessions/${v1ExecutionSessionId}/health-synthesis`));
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'HEALTH_SYNTHESIS_UNSUPPORTED_VERSION');
});

test('8.F — la réponse d\'erreur conserve les details techniques produits par le moteur (jamais reconstruits par la route)', async () => {
  const resQ = await auth(request(app).get(`/api/advisory/sessions/${v1QuestionnaireSessionId}/health-synthesis`));
  assert.deepEqual(resQ.body.details, { expected_questionnaire_version: 2, actual_questionnaire_version: 1 });

  const resR = await auth(request(app).get(`/api/advisory/sessions/${v1ExecutionSessionId}/health-synthesis`));
  assert.deepEqual(resR.body.details, { expected_rule_set_version: 2, actual_rule_set_version: 1 });
});

// =========================================================================
// 9. DTO transmis sans transformation métier
// =========================================================================

test('9 — le corps HTTP est structurellement identique au DTO retourné par buildHealthSynthesis appelée directement (aucune transformation)', async () => {
  const { sessionId } = await buildCurrentSession();
  const res = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/health-synthesis`));
  const direct = Synth.buildHealthSynthesis({ sessionId });
  assert.deepEqual(res.body, direct);
  // Champs du contrat technique explicitement exigés, jamais retirés.
  for (const key of ['synthesis_version', 'session_id', 'domain', 'analysis_status', 'requires_reanalysis', 'source_state_at', 'members', 'household_summary']) {
    assert.ok(key in res.body, `clé attendue absente : ${key}`);
  }
});

// =========================================================================
// 10. historical/no_longer_active présents
// =========================================================================

test('10 — historical/no_longer_active présents et corrects pour un membre retiré du foyer après le démarrage de la session', async () => {
  const { householdId, memberId: principalMemberId } = await createHouseholdHttp();
  const childClientId = insertClient({ first_name: `Api${uniqueKey('child')}`, last_name: 'Enfant' });
  const addRes = await auth(request(app).post(`/api/advisory/households/${householdId}/members`))
    .send({ client_id: childClientId, member_role: 'enfant' });
  const childMemberId = addRes.body.id;

  const sessionId = await createV2SessionHttp(householdId);
  await answerBaselineHttp(sessionId, principalMemberId);
  await answerBaselineHttp(sessionId, childMemberId);
  await completeHttp(sessionId);
  await executeHttp(sessionId, seed2.ruleSetId);

  await auth(request(app).delete(`/api/advisory/households/${householdId}/members/${childMemberId}`)).send({ end_date: '2026-08-09' });

  const res = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/health-synthesis`));
  assert.equal(res.status, 200);
  const principal = res.body.members.find((m) => m.household_member_id === principalMemberId);
  const child = res.body.members.find((m) => m.household_member_id === childMemberId);
  assert.equal(principal.historical, false);
  assert.equal(principal.no_longer_active, false);
  assert.equal(child.historical, true);
  assert.equal(child.no_longer_active, true);
});

// =========================================================================
// 11. Aucun generated_at ajouté
// =========================================================================

test('11 — aucun "generated_at" n\'apparaît dans la réponse HTTP', async () => {
  const { sessionId } = await buildCurrentSession();
  const res = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/health-synthesis`));
  assert.equal(res.status, 200);
  assert.ok(!('generated_at' in res.body));
  assert.ok(!JSON.stringify(res.body).includes('generated_at'));
});

// =========================================================================
// 12/13. Audit créé sur GET réussi, déduplication 15 minutes
// =========================================================================

test('12 — un GET réussi journalise exactement "consultation synthèse santé session"', async () => {
  const { sessionId } = await buildCurrentSession();
  assert.equal(auditRowsFor(sessionId, 'consultation synthèse santé session').length, 0);
  const res = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/health-synthesis`));
  assert.equal(res.status, 200);
  const rows = auditRowsFor(sessionId, 'consultation synthèse santé session');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_email, 'test@exemple.ch');
  // Détails strictement minimisés (jamais une valeur franchise/care model/complémentaire/texte de finding).
  assert.match(rows[0].details, /^domaine health — synthesis_version \d+ — analysis_status current — requires_reanalysis false$/);
});

test('13 — deux GET successifs rapprochés sur la même synthèse/session/utilisateur : une seule entrée d\'audit (déduplication 15 minutes)', async () => {
  const { sessionId } = await buildCurrentSession();
  await auth(request(app).get(`/api/advisory/sessions/${sessionId}/health-synthesis`));
  await auth(request(app).get(`/api/advisory/sessions/${sessionId}/health-synthesis`));
  await auth(request(app).get(`/api/advisory/sessions/${sessionId}/health-synthesis`));
  assert.equal(auditRowsFor(sessionId, 'consultation synthèse santé session').length, 1);
});

// =========================================================================
// 14. Aucun audit sur erreur
// =========================================================================

test('14 — aucun audit "consultation synthèse santé session" créé sur une erreur (404, 400, 409)', async () => {
  // La fixture (foyer/questionnaire/session vie-prévoyance) est construite
  // AVANT le relevé -- elle produit ses propres audits légitimes (création
  // de foyer/session, etc.), sans rapport avec l'action sous test ; seuls
  // les 3 appels GET qui suivent doivent produire ZÉRO ligne d'audit,
  // puisque les 3 échouent avant toute construction réussie de la synthèse.
  const lp = await buildLifePensionSessionHttp();
  const before = tableCount('audit_log');

  const r404 = await auth(request(app).get('/api/advisory/sessions/8888888/health-synthesis'));
  assert.equal(r404.status, 404);
  const r400 = await auth(request(app).get(`/api/advisory/sessions/${lp}/health-synthesis`));
  assert.equal(r400.status, 400);
  const r409 = await auth(request(app).get(`/api/advisory/sessions/${v1QuestionnaireSessionId}/health-synthesis`));
  assert.equal(r409.status, 409);

  assert.equal(tableCount('audit_log'), before, 'aucune nouvelle ligne audit_log, quel que soit le type d\'erreur');
  assert.equal(auditRowsFor(8888888, 'consultation synthèse santé session').length, 0);
  assert.equal(auditRowsFor(lp, 'consultation synthèse santé session').length, 0);
  assert.equal(auditRowsFor(v1QuestionnaireSessionId, 'consultation synthèse santé session').length, 0);
});

// =========================================================================
// 15/16. Aucun effet de bord métier, aucune exécution automatique
// =========================================================================

test('15/16 — l\'appel HTTP ne crée/modifie aucune recommendation, aucun finding, aucune réponse, et ne déclenche aucune exécution de règles', async () => {
  const { sessionId } = await buildCurrentSession();
  const before = {
    recommendations: tableCount('advisory_recommendations'),
    findings: tableCount('advisory_findings'),
    answers: tableCount('advisory_answers'),
    executions: tableCount('advisory_rule_executions'),
  };
  const res = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/health-synthesis`));
  assert.equal(res.status, 200);
  assert.equal(tableCount('advisory_recommendations'), before.recommendations);
  assert.equal(tableCount('advisory_findings'), before.findings);
  assert.equal(tableCount('advisory_answers'), before.answers);
  assert.equal(tableCount('advisory_rule_executions'), before.executions);
});

// =========================================================================
// 17. buildHealthSynthesis appelée directement reste sans audit
// =========================================================================

test('17 — buildHealthSynthesis appelée directement (hors HTTP) ne journalise jamais "consultation synthèse santé session" ni aucun autre audit', async () => {
  const { sessionId } = await buildCurrentSession();
  const before = tableCount('audit_log');
  Synth.buildHealthSynthesis({ sessionId });
  Synth.buildHealthSynthesis({ sessionId });
  assert.equal(tableCount('audit_log'), before);
  assert.equal(auditRowsFor(sessionId, 'consultation synthèse santé session').length, 0);
});

// =========================================================================
// 18-21. Audit dérivé "consultation findings sensibles" (correction post-
// revue compliance-privacy-reviewer) — la synthèse Santé expose un contenu
// dérivé des mêmes findings que /findings-workspace/listActiveFindings, qui
// appliquent déjà ce même audit dérivé dès qu'un finding référence une
// réponse marquée sensible au moment de l'exécution (`sensitivity_at_execution`
// figé dans `used_inputs_ref`) — même précédent que les Lots 4A/4B/7A.
// =========================================================================

test('18 — audit dérivé "consultation findings sensibles" journalisé après un GET réussi référençant des réponses sensibles figées', async () => {
  const { sessionId } = await buildCurrentSession();
  assert.equal(auditRowsFor(sessionId, 'consultation findings sensibles').length, 0);
  const res = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/health-synthesis`));
  assert.equal(res.status, 200);
  const rows = auditRowsFor(sessionId, 'consultation findings sensibles');
  assert.equal(rows.length, 1, 'le socle neutre BASELINE_ANSWERS répond aux questions sensibles franchise (sensitive: true, server/seed-advisory-health-content.js), une exécution complète doit donc produire au moins une référence figée sensible');
  assert.equal(rows[0].user_email, 'test@exemple.ch');
  assert.equal(rows[0].details, 'health');
});

test('19 — audit dérivé "consultation findings sensibles" dédupliqué (même fenêtre 15 minutes que le mécanisme existant)', async () => {
  const { sessionId } = await buildCurrentSession();
  await auth(request(app).get(`/api/advisory/sessions/${sessionId}/health-synthesis`));
  await auth(request(app).get(`/api/advisory/sessions/${sessionId}/health-synthesis`));
  await auth(request(app).get(`/api/advisory/sessions/${sessionId}/health-synthesis`));
  assert.equal(auditRowsFor(sessionId, 'consultation findings sensibles').length, 1);
});

test('20 — aucun audit dérivé "consultation findings sensibles" créé sur une erreur (404, 400, 409)', async () => {
  const lp = await buildLifePensionSessionHttp();
  const r404 = await auth(request(app).get('/api/advisory/sessions/7777777/health-synthesis'));
  assert.equal(r404.status, 404);
  const r400 = await auth(request(app).get(`/api/advisory/sessions/${lp}/health-synthesis`));
  assert.equal(r400.status, 400);
  const r409 = await auth(request(app).get(`/api/advisory/sessions/${v1QuestionnaireSessionId}/health-synthesis`));
  assert.equal(r409.status, 409);

  assert.equal(auditRowsFor(7777777, 'consultation findings sensibles').length, 0);
  assert.equal(auditRowsFor(lp, 'consultation findings sensibles').length, 0);
  assert.equal(auditRowsFor(v1QuestionnaireSessionId, 'consultation findings sensibles').length, 0);
});

test('21 — pas d\'audit dérivé "consultation findings sensibles" quand aucune exécution n\'a eu lieu (not_run, aucun finding donc aucune référence sensible)', async () => {
  const { householdId, memberId } = await createHouseholdHttp();
  const sessionId = await createV2SessionHttp(householdId);
  await answerBaselineHttp(sessionId, memberId);
  await completeHttp(sessionId);
  const res = await auth(request(app).get(`/api/advisory/sessions/${sessionId}/health-synthesis`));
  assert.equal(res.status, 200);
  assert.equal(res.body.analysis_status, 'not_run');
  assert.equal(auditRowsFor(sessionId, 'consultation findings sensibles').length, 0);
});
