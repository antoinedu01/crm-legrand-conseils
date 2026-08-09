// Tests du moteur de synthèse Santé pur (SYNTH-BE1, Legrand Diagnostic 360).
// Base de test isolée (CRM_DATA_DIR), jamais data/**. Tout le contenu ici
// est fictif et technique — seed réel `diagnostic-sante-phase1` v2 /
// `regles-sante-phase1` v2 (`server/seed-advisory-health-content.js`),
// provisionné et publié une seule fois pour tout le fichier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-health-synthesis-'));

const { default: db } = await import('../server/db.js');
const { createHousehold, addMember, removeMember } = await import('../server/advisoryHouseholds.js');
const Q = await import('../server/advisoryQuestionnaires.js');
const S = await import('../server/advisorySessions.js');
const R = await import('../server/advisoryRules.js');
const E = await import('../server/advisoryRuleExecutions.js');
const Seed = await import('../server/seed-advisory-health-content.js');
const Synth = await import('../server/advisoryHealthSynthesis.js');

const REQ = { session: { userEmail: 'conseiller-health-synthesis@exemple.ch' } };
db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)')
  .run('conseiller-health-synthesis@exemple.ch', 'Conseiller', 'x');

let clientCounter = 0;
function insertClient() {
  clientCounter += 1;
  return db.prepare('INSERT INTO clients (type, first_name, last_name, status) VALUES (?, ?, ?, ?)')
    .run('particulier', `P${clientCounter}`, 'Test', 'prospect').lastInsertRowid;
}
function buildHousehold() {
  const principalId = insertClient();
  const { id: householdId } = createHousehold({ primary_client_id: principalId }, REQ);
  const principalMemberId = db.prepare("SELECT id FROM household_members WHERE household_id = ? AND member_role = 'principal'").get(householdId).id;
  return { householdId, principalMemberId };
}
function buildTwoMemberHousehold() {
  const { householdId, principalMemberId } = buildHousehold();
  const childClientId = insertClient();
  const { id: childMemberId } = addMember(householdId, { member_role: 'enfant', client_id: childClientId }, REQ);
  return { householdId, principalMemberId, childMemberId };
}
function rev(sessionId) {
  return db.prepare('SELECT revision FROM advisory_sessions WHERE id = ?').get(sessionId).revision;
}
function ensureCompleted(sessionId) {
  const status = db.prepare('SELECT status FROM advisory_sessions WHERE id = ?').get(sessionId).status;
  if (status !== 'completed') S.completeSession(sessionId, rev(sessionId), REQ);
}
function auditTotal() {
  return db.prepare('SELECT COUNT(*) n FROM audit_log').get().n;
}
function tableCount(table) {
  return db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
}

// --- Provisioning + publication (v1 ET v2), une seule fois pour tout le
// fichier — v1 reste consultable (jamais republiée/modifiée) exactement
// comme en production, v2 devient l'ensemble de règles actif à la fin de ce
// bloc (voir fixture VERSION GUARD ci-dessous pour l'ordre exact des
// publications, qui a besoin de v1 publiée AVANT v2).
const seed1 = Seed.seedAdvisoryHealthContent(REQ);
const seed2 = Seed.seedAdvisoryHealthContentV2(REQ);
assert.ok(seed1.created && seed2.created, 'seed v1/v2 attendu neuf sur une base de test isolée');
Q.publishVersion(seed1.versionId, REQ);
Q.publishVersion(seed2.versionId, REQ);
R.publishRuleSet(seed1.ruleSetId, REQ); // v1 devient l'ensemble publié « santé »

function qidV2(stableKey) {
  const detail = Q.getVersionDetail(seed2.versionId);
  for (const section of detail.sections) for (const q of section.questions) if (q.stable_key === stableKey) return q.id;
  throw new Error(`question v2 introuvable : ${stableKey}`);
}
function createV2Session(householdId) {
  const { id: sessionId } = S.createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: seed2.versionId, domain: 'health', module_role: 'domain', display_order: 1 }],
  }, REQ);
  S.startSession(sessionId, rev(sessionId), REQ);
  return sessionId;
}
function createV1Session(householdId) {
  const { id: sessionId } = S.createSession({
    household_id: householdId, domain: 'health',
    questionnaire_versions: [{ questionnaire_version_id: seed1.versionId, domain: 'health', module_role: 'domain', display_order: 1 }],
  }, REQ);
  S.startSession(sessionId, rev(sessionId), REQ);
  return sessionId;
}
function answerV2(sessionId, memberId, pairs) {
  const answers = pairs.map(([key, value, status]) => ({
    question_id: qidV2(key),
    household_member_id: memberId,
    status: status || 'answered',
    value: status === 'unknown' ? undefined : value,
  }));
  S.recordAnswers(sessionId, answers, rev(sessionId), REQ);
}

// -----------------------------------------------------------------------
// Profil déclaratif neutre (§ cadrage) : accident « maintien » propre (sans
// avertissement croisé), franchise « indéterminée » (4 données présentes,
// aucun signal dominant), care model CORE+OPTIONAL répondus, les 6
// complémentaires à « pas_important » — sert de socle à la majorité des
// scénarios, chaque test ne surchargeant que ce qui l'intéresse. Couvre
// TOUTES les questions `required: true` de la v2 (nécessaire pour que
// `completeSession` réussisse), y compris pour les fixtures VERSION GUARD
// ci-dessous.
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
function withOverrides(overrides) {
  const map = new Map(BASELINE_ANSWERS.map(([k, v]) => [k, v]));
  const statusByKey = new Map();
  for (const [k, v, status] of overrides) { map.set(k, v); if (status) statusByKey.set(k, status); }
  return [...map.entries()].map(([k, v]) => [k, v, statusByKey.get(k)]);
}
// `omit` : clés du socle à NE PAS répondre du tout (pour un scénario de
// donnée manquante « jamais répondue », distinct d'une réponse `unknown`).
function buildBaselineSession({ overrides = [], omit = [], execute = true } = {}) {
  const { householdId, principalMemberId: memberId } = buildHousehold();
  const sessionId = createV2Session(householdId);
  const answers = withOverrides(overrides).filter(([k]) => !omit.includes(k));
  answerV2(sessionId, memberId, answers);
  ensureCompleted(sessionId);
  if (execute) E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: seed2.ruleSetId });
  return { sessionId, householdId, memberId };
}

function memberOf(dto, memberId) {
  return dto.members.find((m) => m.household_member_id === memberId);
}
// Rend une réponse manquante APRÈS complétion (via amendAnswer, jamais via
// `omit` à la construction -- `completeSession` refuserait toute session où
// une question requise et visible reste sans réponse, donc la seule façon
// réaliste d'obtenir une donnée requise manquante à l'instant T est un
// amendement ultérieur, cohérent avec le cycle de vie réel d'une session).
function amendToMissing(sessionId, memberId, stableKey) {
  S.amendAnswer(sessionId, {
    question_id: qidV2(stableKey), household_member_id: memberId,
    status: 'unknown', value: undefined,
    amendment_reason: 'Correction fictive de test — donnée rendue manquante après complétion.',
    expected_revision: rev(sessionId),
  }, REQ);
}

// --- Fixture VERSION GUARD : questionnaire v2, dernière exécution Santé
// utilisant le rule_set v1 (scénario réel possible : rien n'empêche
// aujourd'hui d'exécuter un domaine avec un rule_set explicite indépendant
// de la version du questionnaire lié — exactement le cas que ce guard doit
// détecter). Doit être construite pendant que v1 est encore l'ensemble
// PUBLIÉ (première exécution d'un domaine = rule_set publié requis).
const { householdId: vgHouseholdId, principalMemberId: vgMemberId } = buildHousehold();
const v1ExecutionSessionId = createV2Session(vgHouseholdId);
answerV2(v1ExecutionSessionId, vgMemberId, withOverrides([]));
ensureCompleted(v1ExecutionSessionId);
E.executeRuleSetForSession(v1ExecutionSessionId, 'health', rev(v1ExecutionSessionId), REQ, { rule_set_id: seed1.ruleSetId });

R.publishRuleSet(seed2.ruleSetId, REQ); // supersède v1 (même stable_key) -- v2 publié pour tout le reste du fichier

// --- Fixture VERSION GUARD : session dont le questionnaire est v1 (jamais
// exécutée, le refus doit survenir uniquement sur la version du
// questionnaire, sans même regarder l'historique d'exécution).
const { householdId: v1QHouseholdId } = buildHousehold();
const v1QuestionnaireSessionId = createV1Session(v1QHouseholdId);

// =========================================================================
// A. VERSION GUARD
// =========================================================================

test('A — questionnaire Santé v1 : HEALTH_SYNTHESIS_UNSUPPORTED_VERSION (409), jamais un traitement approximatif ou rétroactif', () => {
  assert.throws(
    () => Synth.buildHealthSynthesis({ sessionId: v1QuestionnaireSessionId }),
    (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, Synth.HEALTH_SYNTHESIS_UNSUPPORTED_VERSION);
      assert.deepEqual(err.details, { expected_questionnaire_version: 2, actual_questionnaire_version: 1 });
      return true;
    },
  );
});

test('A — questionnaire Santé v2, dernière exécution Santé utilisant le rule_set v1 : HEALTH_SYNTHESIS_UNSUPPORTED_VERSION (409)', () => {
  assert.throws(
    () => Synth.buildHealthSynthesis({ sessionId: v1ExecutionSessionId }),
    (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, Synth.HEALTH_SYNTHESIS_UNSUPPORTED_VERSION);
      assert.deepEqual(err.details, { expected_rule_set_version: 2, actual_rule_set_version: 1 });
      return true;
    },
  );
});

test('A — questionnaire v2, aucune exécution Santé encore lancée : supporté (analysis_status not_run)', () => {
  const { sessionId } = buildBaselineSession({ execute: false });
  const dto = Synth.buildHealthSynthesis({ sessionId });
  assert.equal(dto.analysis_status, 'not_run');
  assert.equal(dto.requires_reanalysis, true);
});

test('A — questionnaire v2, dernière exécution Santé utilisant le rule_set v2 : supporté (analysis_status current)', () => {
  const { sessionId } = buildBaselineSession();
  const dto = Synth.buildHealthSynthesis({ sessionId });
  assert.equal(dto.analysis_status, 'current');
  assert.equal(dto.requires_reanalysis, false);
});

// =========================================================================
// B. ANALYSIS STATE
// =========================================================================

test('B — état current : mapping exact up_to_date -> current', () => {
  const { sessionId } = buildBaselineSession();
  const dto = Synth.buildHealthSynthesis({ sessionId });
  assert.equal(dto.analysis_status, 'current');
});

test('B — état stale : mapping exact stale -> stale, requires_reanalysis true', () => {
  const { sessionId, memberId } = buildBaselineSession();
  S.amendAnswer(sessionId, {
    question_id: qidV2('tolerance_risque_financier'), household_member_id: memberId,
    status: 'answered', value: 'faible',
    amendment_reason: 'Correction fictive de test — bascule de staleness.',
    expected_revision: rev(sessionId),
  }, REQ);
  const dto = Synth.buildHealthSynthesis({ sessionId });
  assert.equal(dto.analysis_status, 'stale');
  assert.equal(dto.requires_reanalysis, true);
});

test('B — état not_run : mapping exact not_yet_run -> not_run', () => {
  const { sessionId } = buildBaselineSession({ execute: false });
  const dto = Synth.buildHealthSynthesis({ sessionId });
  assert.equal(dto.analysis_status, 'not_run');
});

test('B — stale avec anciens findings encore en base : aucune provenance "finding" nulle part dans le DTO, warnings vidés, orientations dérivées nulles', () => {
  const { sessionId, memberId } = buildBaselineSession({
    overrides: [
      ['couverture_accident_hors_lamal_declaree', 'oui'], ['couverture_accident_laa_employeur_declaree', 'non'],
      ['accident_inclus_lamal_declare', 'oui'],
    ],
  });
  const beforeStale = Synth.buildHealthSynthesis({ sessionId });
  const m0 = memberOf(beforeStale, memberId);
  assert.equal(m0.accident.warnings.length > 0, true, 'précondition : un avertissement doit exister en current pour prouver qu\'il disparaît en stale');

  S.amendAnswer(sessionId, {
    question_id: qidV2('tolerance_risque_financier'), household_member_id: memberId,
    status: 'answered', value: 'faible',
    amendment_reason: 'Correction fictive de test — bascule de staleness avec findings existants.',
    expected_revision: rev(sessionId),
  }, REQ);
  const dto = Synth.buildHealthSynthesis({ sessionId });
  assert.equal(dto.analysis_status, 'stale');
  const m = memberOf(dto, memberId);
  const allFields = [m.accident.orientation, m.franchise.orientation, m.franchise.current_comparison,
    m.care_model.telemedicine, m.care_model.hmo];
  assert.ok(allFields.every((f) => f.provenance !== 'finding'), 'aucun champ ne doit référencer un finding obsolète');
  assert.equal(m.franchise.orientation.value, null);
  assert.equal(m.franchise.current_comparison.value, null);
  assert.equal(m.accident.warnings.length, 0, 'les avertissements dérivés de findings disparaissent en stale');
  assert.equal(m.care_model.warnings.length, 0);
  assert.equal(m.complementary_needs.warnings.length, 0);
});

// =========================================================================
// C. DÉTERMINISME
// =========================================================================

test('C — deux appels successifs sans écriture DB entre les deux : deepStrictEqual intégral', () => {
  const { sessionId } = buildBaselineSession();
  const dto1 = Synth.buildHealthSynthesis({ sessionId });
  const dto2 = Synth.buildHealthSynthesis({ sessionId });
  assert.deepEqual(dto1, dto2);
});

// =========================================================================
// D. AUDIT
// =========================================================================

test('D — buildHealthSynthesis appelée seule (même deux fois) : ZÉRO nouvelle ligne audit_log', () => {
  const { sessionId } = buildBaselineSession();
  const before = auditTotal();
  Synth.buildHealthSynthesis({ sessionId });
  Synth.buildHealthSynthesis({ sessionId });
  assert.equal(auditTotal(), before);
});

// =========================================================================
// E. MULTI-MEMBRES
// =========================================================================

test('E — deux membres, profils franchise/care model différents : aucune contamination, household_summary reste un rollup factuel', () => {
  const { householdId, principalMemberId, childMemberId } = buildTwoMemberHousehold();
  const sessionId = createV2Session(householdId);
  // Principal : franchise élevée déclarée, prime priorisée.
  answerV2(sessionId, principalMemberId, withOverrides([
    ['capacite_absorber_depense_annuelle', 'elevee'], ['tolerance_risque_financier', 'elevee'],
    ['recours_soins_12_mois_declare', 'faible'], ['depenses_sante_anticipees_declare', 'aucune'],
    ['priorite_prime_liberte_declaree', 'reduire_prime'],
  ]));
  // Enfant : franchise prudente déclarée, liberté maximisée -- foyer mixte,
  // jamais fusionné en une seule conclusion de foyer.
  answerV2(sessionId, childMemberId, withOverrides([
    ['capacite_absorber_depense_annuelle', 'faible'], ['tolerance_risque_financier', 'faible'],
    ['recours_soins_12_mois_declare', 'important'], ['depenses_sante_anticipees_declare', 'probablement_importantes'],
    ['priorite_prime_liberte_declaree', 'maximiser_liberte'],
  ]));
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: seed2.ruleSetId });

  const dto = Synth.buildHealthSynthesis({ sessionId });
  assert.equal(dto.members.length, 2);
  const principal = memberOf(dto, principalMemberId);
  const child = memberOf(dto, childMemberId);
  assert.equal(principal.franchise.orientation.value, 'elevee_potentiellement_adaptee');
  assert.equal(child.franchise.orientation.value, 'prudente_a_examiner');
  assert.equal(principal.care_model.cost_freedom_priority.value, 'reduire_prime');
  assert.equal(child.care_model.cost_freedom_priority.value, 'maximiser_liberte');
  // Aucun id de finding ni de réponse ne traverse d'un membre à l'autre.
  const principalFindingIds = new Set(principal.source_finding_ids_all);
  const childFindingIds = new Set(child.source_finding_ids_all);
  assert.equal([...principalFindingIds].filter((id) => childFindingIds.has(id)).length, 0);
  const principalAnswerIds = new Set(principal.source_answer_ids_used);
  const childAnswerIds = new Set(child.source_answer_ids_used);
  assert.equal([...principalAnswerIds].filter((id) => childAnswerIds.has(id)).length, 0);
  // household_summary : rollup factuel des DEUX valeurs présentes, jamais un choix arbitraire.
  assert.deepEqual(dto.household_summary.franchise_orientations_present, ['elevee_potentiellement_adaptee', 'prudente_a_examiner']);
});

// =========================================================================
// F. FRANCHISE
// =========================================================================

test('F — orientation élevée', () => {
  const { sessionId, memberId } = buildBaselineSession({
    overrides: [
      ['capacite_absorber_depense_annuelle', 'elevee'], ['tolerance_risque_financier', 'elevee'],
      ['recours_soins_12_mois_declare', 'faible'], ['depenses_sante_anticipees_declare', 'aucune'],
    ],
  });
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.franchise.orientation.value, 'elevee_potentiellement_adaptee');
  assert.equal(m.franchise.orientation.provenance, 'finding');
});

test('F — orientation prudente', () => {
  const { sessionId, memberId } = buildBaselineSession({
    overrides: [['capacite_absorber_depense_annuelle', 'faible']],
  });
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.franchise.orientation.value, 'prudente_a_examiner');
});

test('F — orientation indéterminée (socle neutre)', () => {
  const { sessionId, memberId } = buildBaselineSession();
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.franchise.orientation.value, 'indeterminee');
});

test('F — comparaison alignée (élevée déclarée == orientation élevée)', () => {
  const { sessionId, memberId } = buildBaselineSession({
    overrides: [
      ['capacite_absorber_depense_annuelle', 'elevee'], ['tolerance_risque_financier', 'elevee'],
      ['recours_soins_12_mois_declare', 'faible'], ['depenses_sante_anticipees_declare', 'aucune'],
      ['franchise_actuelle_niveau_declare', 'elevee'],
    ],
  });
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.franchise.current_comparison.value, 'alignee');
});

test('F — écart (orientation élevée vs franchise actuelle basse)', () => {
  const { sessionId, memberId } = buildBaselineSession({
    overrides: [
      ['capacite_absorber_depense_annuelle', 'elevee'], ['tolerance_risque_financier', 'elevee'],
      ['recours_soins_12_mois_declare', 'faible'], ['depenses_sante_anticipees_declare', 'aucune'],
      ['franchise_actuelle_niveau_declare', 'basse'],
    ],
  });
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.franchise.current_comparison.value, 'ecart_a_examiner');
});

test('F — à contextualiser (orientation élevée vs franchise actuelle moyenne)', () => {
  const { sessionId, memberId } = buildBaselineSession({
    overrides: [
      ['capacite_absorber_depense_annuelle', 'elevee'], ['tolerance_risque_financier', 'elevee'],
      ['recours_soins_12_mois_declare', 'faible'], ['depenses_sante_anticipees_declare', 'aucune'],
      ['franchise_actuelle_niveau_declare', 'moyenne'],
    ],
  });
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.franchise.current_comparison.value, 'a_contextualiser');
});

test('F — comparaison impossible (orientation indéterminée, socle neutre)', () => {
  const { sessionId, memberId } = buildBaselineSession();
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.franchise.current_comparison.value, 'comparaison_impossible');
});

test('F — stale : orientation et comparaison toutes deux nulles (jamais une conclusion dérivée obsolète)', () => {
  const { sessionId, memberId } = buildBaselineSession({
    overrides: [
      ['capacite_absorber_depense_annuelle', 'elevee'], ['tolerance_risque_financier', 'elevee'],
      ['recours_soins_12_mois_declare', 'faible'], ['depenses_sante_anticipees_declare', 'aucune'],
    ],
  });
  S.amendAnswer(sessionId, {
    question_id: qidV2('franchise_actuelle_niveau_declare'), household_member_id: memberId,
    status: 'answered', value: 'basse',
    amendment_reason: 'Correction fictive de test — bascule de staleness franchise.',
    expected_revision: rev(sessionId),
  }, REQ);
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.franchise.orientation.value, null);
  assert.equal(m.franchise.current_comparison.value, null);
});

// =========================================================================
// G. ACCIDENT
// =========================================================================

test('G — maintien potentiellement adapté (Q_LAA masquée par hors_lamal=non, socle neutre)', () => {
  const { sessionId, memberId } = buildBaselineSession();
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.accident.orientation.value, 'maintien_potentiellement_adapte');
  assert.equal(m.completeness.by_dimension.accident.state, 'complete', 'Q_LAA masquée ne bloque jamais la complétude');
  assert.deepEqual(m.completeness.by_dimension.accident.missing_stable_keys, []);
});

test('G — retrait potentiellement examinable (Q_LAA visible et répondue oui)', () => {
  const { sessionId, memberId } = buildBaselineSession({
    overrides: [
      ['couverture_accident_hors_lamal_declaree', 'oui'],
      ['couverture_accident_laa_employeur_declaree', 'oui'],
      ['accident_inclus_lamal_declare', 'oui'],
    ],
  });
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.accident.orientation.value, 'retrait_potentiellement_examinable');
});

test('G — accident LAMal déjà non inclus : cas déclaratif explicite, prioritaire sur toute conclusion dérivée', () => {
  const { sessionId, memberId } = buildBaselineSession({
    overrides: [['accident_inclus_lamal_declare', 'non']],
  });
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.accident.orientation.value, 'not_applicable_accident_not_included');
  assert.equal(m.accident.orientation.provenance, 'declared_answer');
});

test('G — Q_LAA masquée : jamais listée comme manquante, jamais dans missing_stable_keys', () => {
  const { sessionId, memberId } = buildBaselineSession({
    overrides: [['couverture_accident_hors_lamal_declaree', 'non']],
  });
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.ok(!m.completeness.by_dimension.accident.missing_stable_keys.includes('couverture_accident_laa_employeur_declaree'));
});

test('G — données manquantes (Q_LAA visible mais rendue manquante) : accident bloqué, orientation inconnue', () => {
  const { sessionId, memberId } = buildBaselineSession({
    overrides: [['couverture_accident_hors_lamal_declaree', 'oui'], ['couverture_accident_laa_employeur_declaree', 'oui']],
  });
  amendToMissing(sessionId, memberId, 'couverture_accident_laa_employeur_declaree');
  const dto = Synth.buildHealthSynthesis({ sessionId });
  const m = memberOf(dto, memberId);
  assert.equal(m.completeness.by_dimension.accident.state, 'blocked_by_missing_information');
  assert.deepEqual(m.completeness.by_dimension.accident.missing_stable_keys, ['couverture_accident_laa_employeur_declaree']);
  assert.equal(m.accident.orientation.value, null);
  assert.equal(dto.household_summary.members_with_missing_information.includes(memberId), true);
});

// =========================================================================
// H. CARE MODEL
// =========================================================================

test('H — 6 champs directs présents et corrects (socle neutre, tous "accepte"/"non_prioritaire")', () => {
  const { sessionId, memberId } = buildBaselineSession();
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.care_model.telemedicine.value, 'compatible');
  assert.equal(m.care_model.family_doctor.value, 'compatible');
  assert.equal(m.care_model.hmo.value, 'compatible');
  assert.equal(m.care_model.free_choice.value, 'non_prioritaire');
  assert.equal(m.care_model.preserve_current_doctor.value, 'indifferent'); // aucune règle pour "indifferent" -> valeur déclarée normalisée telle quelle
  assert.equal(m.care_model.cost_freedom_priority.value, 'equilibre');
});

test('H — importance_conserver_medecin_declaree : les 4 valeurs distinctes normalisées correctement (declared_answer, aucune règle sauf "important")', () => {
  const cases = [
    ['important', 'important_a_conserver', 'finding'],
    ['non_important', 'non_prioritaire', 'declared_answer'],
    ['pas_de_medecin_habituel', 'pas_de_medecin_habituel', 'declared_answer'],
    ['indifferent', 'indifferent', 'declared_answer'],
  ];
  for (const [answer, expectedValue, expectedProvenance] of cases) {
    const { sessionId, memberId } = buildBaselineSession({ overrides: [['importance_conserver_medecin_declaree', answer]] });
    const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
    assert.equal(m.care_model.preserve_current_doctor.value, expectedValue, `cas "${answer}"`);
    assert.equal(m.care_model.preserve_current_doctor.provenance, expectedProvenance, `cas "${answer}"`);
  }
});

test('H — une question OPTIONAL manquante : care_model partial (jamais bloqué)', () => {
  const { sessionId, memberId } = buildBaselineSession({ omit: ['priorite_libre_choix_declaree'] });
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.completeness.by_dimension.care_model.state, 'partial');
  assert.deepEqual(m.completeness.by_dimension.care_model.missing_stable_keys, ['priorite_libre_choix_declaree']);
});

test('H — une question CORE manquante : care_model blocked_by_missing_information', () => {
  const { sessionId, memberId } = buildBaselineSession();
  amendToMissing(sessionId, memberId, 'priorite_prime_liberte_declaree');
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.completeness.by_dimension.care_model.state, 'blocked_by_missing_information');
  assert.ok(m.completeness.by_dimension.care_model.missing_stable_keys.includes('priorite_prime_liberte_declaree'));
});

// =========================================================================
// I. COMPLÉMENTAIRES (représentatif sur les 6 dimensions)
// =========================================================================

const COMPLEMENTAIRE_CASES = [
  ['hospitalisation', 'interet_complementaire_hospitalisation_declare'],
  ['alternative_medicine', 'interet_medecines_complementaires_declare'],
  ['optics', 'interet_complementaire_optique_declare'],
  ['dental', 'interet_complementaire_dentaire_declare'],
  ['prevention', 'interet_prevention_declare'],
  ['travel', 'interet_couverture_voyage_declare'],
];

test('I — les 6 dimensions complémentaires : "important" -> a_examiner (finding)', () => {
  for (const [dim, key] of COMPLEMENTAIRE_CASES) {
    const { sessionId, memberId } = buildBaselineSession({ overrides: [[key, 'important']] });
    const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
    assert.equal(m.complementary_needs[dim].value, 'a_examiner', `dimension ${dim}`);
    assert.equal(m.complementary_needs[dim].provenance, 'finding', `dimension ${dim}`);
  }
});

test('I — "eventuellement" -> a_examiner (finding)', () => {
  const { sessionId, memberId } = buildBaselineSession({ overrides: [['interet_complementaire_optique_declare', 'eventuellement']] });
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.complementary_needs.optics.value, 'a_examiner');
  assert.equal(m.complementary_needs.optics.provenance, 'finding');
});

test('I — "pas_important" -> non_prioritaire (declared_answer, aucune règle ne se déclenche)', () => {
  const { sessionId, memberId } = buildBaselineSession(); // socle neutre : tout "pas_important"
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.complementary_needs.dental.value, 'non_prioritaire');
  assert.equal(m.complementary_needs.dental.provenance, 'declared_answer');
});

test('I — réponse "unknown" -> partial, jamais bloqué', () => {
  const { sessionId, memberId } = buildBaselineSession({ overrides: [['interet_prevention_declare', null, 'unknown']] });
  const dto = Synth.buildHealthSynthesis({ sessionId });
  const m = memberOf(dto, memberId);
  assert.equal(m.completeness.by_dimension.prevention.state, 'partial');
  assert.equal(m.complementary_needs.prevention.value, null);
  assert.equal(m.complementary_needs.prevention.provenance, 'unknown');
});

test('I — jamais répondue -> partial, jamais bloqué', () => {
  const { sessionId, memberId } = buildBaselineSession({ omit: ['interet_couverture_voyage_declare'] });
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.completeness.by_dimension.voyage.state, 'partial');
  assert.deepEqual(m.completeness.by_dimension.voyage.missing_stable_keys, ['interet_couverture_voyage_declare']);
});

// =========================================================================
// J. WARNINGS
// =========================================================================

test('J — accident_coordination -> accident.warnings (doublon_potentiel)', () => {
  const { sessionId, memberId } = buildBaselineSession({
    overrides: [
      ['couverture_accident_hors_lamal_declaree', 'oui'], ['couverture_accident_laa_employeur_declaree', 'non'],
      ['accident_inclus_lamal_declare', 'oui'],
    ],
  });
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.ok(m.accident.warnings.some((w) => w.code === 'doublon_potentiel'));
});

test('J — accident_coverage_gap -> accident.warnings (lacune_couverture)', () => {
  const { sessionId, memberId } = buildBaselineSession({
    overrides: [['couverture_accident_hors_lamal_declaree', 'non'], ['accident_inclus_lamal_declare', 'non']],
  });
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.ok(m.accident.warnings.some((w) => w.code === 'lacune_couverture'));
});

test('J — care_model_compatibility -> care_model.warnings (parcours_impose_vs_refus)', () => {
  const { sessionId, memberId } = buildBaselineSession({
    overrides: [
      ['parcours_premier_contact_obligatoire_declare', 'oui'],
      ['refus_parcours_impose_declare', 'oui'],
    ],
  });
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.ok(m.care_model.warnings.some((w) => w.code === 'parcours_impose_vs_refus'));
});

test('J — lca_coverage_continuity -> complementary_needs.warnings (risque_rupture_couverture)', () => {
  const { sessionId, memberId } = buildBaselineSession({
    overrides: [
      ['intention_resilier_complementaire_declare', 'oui'],
      ['acceptation_nouvelle_complementaire_confirmee', 'non'],
    ],
  });
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.ok(m.complementary_needs.warnings.some((w) => w.code === 'risque_rupture_couverture'));
});

test('J — rollup member.warnings cohérent : contient exactement les avertissements des 3 sous-dimensions, tagués', () => {
  const { sessionId, memberId } = buildBaselineSession({
    overrides: [
      ['couverture_accident_hors_lamal_declaree', 'oui'], ['couverture_accident_laa_employeur_declaree', 'non'],
      ['accident_inclus_lamal_declare', 'oui'],
      ['parcours_premier_contact_obligatoire_declare', 'oui'], ['refus_parcours_impose_declare', 'oui'],
      ['intention_resilier_complementaire_declare', 'oui'], ['acceptation_nouvelle_complementaire_confirmee', 'non'],
    ],
  });
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.warnings.length, 3);
  assert.deepEqual(new Set(m.warnings.map((w) => w.dimension)), new Set(['accident', 'care_model', 'complementary_needs']));
  assert.deepEqual(new Set(m.warnings.map((w) => w.code)), new Set(['doublon_potentiel', 'parcours_impose_vs_refus', 'risque_rupture_couverture']));
});

// =========================================================================
// K. PROVENANCE
// =========================================================================

test('K — resolveProvenance : les 4 valeurs exactes attendues (fonction pure unitaire)', () => {
  assert.equal(Synth.resolveProvenance('answered', true), 'declared_answer');
  assert.equal(Synth.resolveProvenance('unknown', true), 'unknown');
  assert.equal(Synth.resolveProvenance(undefined, true), 'unknown');
  assert.equal(Synth.resolveProvenance('answered', false), 'not_applicable');
  assert.equal(Synth.resolveProvenance('unknown', false), 'not_applicable', 'la visibilité prime toujours sur le statut de réponse');
});

test('K — provenance "finding" uniquement en current, ids/clés correctement triés', () => {
  const { sessionId, memberId } = buildBaselineSession({
    overrides: [
      ['capacite_absorber_depense_annuelle', 'elevee'], ['tolerance_risque_financier', 'elevee'],
      ['recours_soins_12_mois_declare', 'faible'], ['depenses_sante_anticipees_declare', 'aucune'],
    ],
  });
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.franchise.orientation.provenance, 'finding');
  assert.equal(m.franchise.orientation.source_finding_ids.length, 1);
  const ids = m.franchise.orientation.source_answer_ids;
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  const keys = m.franchise.orientation.source_answer_keys;
  assert.deepEqual(keys, [...keys].sort());
  assert.deepEqual(keys, ['capacite_absorber_depense_annuelle', 'depenses_sante_anticipees_declare', 'recours_soins_12_mois_declare', 'tolerance_risque_financier']);
});

test('K — provenance "declared_answer" et "unknown" corrects sur un champ complémentaire', () => {
  const { sessionId: sid1, memberId: m1 } = buildBaselineSession(); // pas_important -> declared_answer
  const declared = memberOf(Synth.buildHealthSynthesis({ sessionId: sid1 }), m1);
  assert.equal(declared.complementary_needs.dental.provenance, 'declared_answer');
  assert.equal(declared.complementary_needs.dental.source_answer_keys.length, 1);

  const { sessionId: sid2, memberId: m2 } = buildBaselineSession({ overrides: [['interet_complementaire_dentaire_declare', null, 'unknown']] });
  const unknown = memberOf(Synth.buildHealthSynthesis({ sessionId: sid2 }), m2);
  assert.equal(unknown.complementary_needs.dental.provenance, 'unknown');
  assert.equal(unknown.complementary_needs.dental.source_answer_ids.length, 1, 'une ligne de réponse "unknown" existe réellement, référencée pour l\'audit');
});

// =========================================================================
// L. COMPLÉTUDE (overall)
// =========================================================================

test('L — overall complete (socle neutre entièrement répondu)', () => {
  const { sessionId, memberId } = buildBaselineSession();
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.completeness.overall, 'complete');
});

test('L — overall partial (une seule complémentaire "unknown", aucune dimension CORE bloquée)', () => {
  const { sessionId, memberId } = buildBaselineSession({ overrides: [['interet_prevention_declare', null, 'unknown']] });
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.completeness.overall, 'partial');
});

test('L — overall blocked_by_missing_information (une dimension CORE bloquée)', () => {
  const { sessionId, memberId } = buildBaselineSession();
  amendToMissing(sessionId, memberId, 'tolerance_risque_financier');
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.completeness.by_dimension.franchise_orientation.state, 'blocked_by_missing_information');
  assert.equal(m.completeness.overall, 'blocked_by_missing_information');
});

// =========================================================================
// M. MAPPING COVERAGE GUARD
// =========================================================================

test('M — CATEGORY_HINT_MAPPING couvre exhaustivement les category_hint réels de regles-sante-phase1 v2 (jamais un id hardcodé)', () => {
  const ruleSetRow = R.listRuleSets({ stable_key: Seed.RULE_SET_STABLE_KEY }).find((rs) => rs.version_number === 2);
  assert.ok(ruleSetRow, 'rule_set v2 introuvable via listRuleSets({stable_key, version_number}) -- jamais un id hardcodé');
  const detail = R.getRuleSetDetail(ruleSetRow.id);
  const activeHints = new Set(detail.rules.filter((r) => r.status === 'active').map((r) => r.result_payload.category_hint));

  for (const hint of activeHints) {
    const known = hint in Synth.CATEGORY_HINT_MAPPING || Synth.IGNORED_CATEGORY_HINTS.includes(hint);
    assert.ok(known, `category_hint inconnu dans le mapping : "${hint}"`);
  }
  const inBoth = [...activeHints].filter((h) => (h in Synth.CATEGORY_HINT_MAPPING) && Synth.IGNORED_CATEGORY_HINTS.includes(h));
  assert.deepEqual(inBoth, [], 'un hint ne doit jamais être à la fois mappé et ignoré');
  assert.deepEqual(Synth.IGNORED_CATEGORY_HINTS, []);
  assert.deepEqual([...activeHints].sort(), Object.keys(Synth.CATEGORY_HINT_MAPPING).sort(), 'couverture bidirectionnelle exacte -- aucune entrée du mapping ne doit être orpheline (hint qui n\'existe plus dans les règles réelles)');
});

// =========================================================================
// N. ARCHITECTURAL SAFETY
// =========================================================================

test('N — aucun effet de bord : recommandations/findings/réponses/audit inchangés après buildHealthSynthesis', () => {
  const { sessionId } = buildBaselineSession();
  const before = {
    recommendations: tableCount('advisory_recommendations'),
    findings: tableCount('advisory_findings'),
    answers: tableCount('advisory_answers'),
    audit: auditTotal(),
  };
  Synth.buildHealthSynthesis({ sessionId });
  assert.equal(tableCount('advisory_recommendations'), before.recommendations);
  assert.equal(tableCount('advisory_findings'), before.findings);
  assert.equal(tableCount('advisory_answers'), before.answers);
  assert.equal(auditTotal(), before.audit);
});

// =========================================================================
// O. AUCUN CONTENU HORS PÉRIMÈTRE
// =========================================================================

function collectKeys(obj, acc = new Set()) {
  if (obj && typeof obj === 'object') {
    if (Array.isArray(obj)) { for (const v of obj) collectKeys(v, acc); } else {
      for (const [k, v] of Object.entries(obj)) { acc.add(k); collectKeys(v, acc); }
    }
  }
  return acc;
}

test('O — le DTO ne contient jamais de clé évoquant un contrat, un assureur, un produit, une prime ou un tarif', () => {
  const { sessionId } = buildBaselineSession();
  const dto = Synth.buildHealthSynthesis({ sessionId });
  const keys = [...collectKeys(dto)].map((k) => k.toLowerCase());
  const forbidden = ['assureur', 'insurer', 'produit', 'product', 'tarif', 'contract', 'contrat_lamal', 'contrat_lca', 'montant', 'prime'];
  for (const term of forbidden) {
    assert.ok(!keys.some((k) => k.includes(term)), `clé interdite détectée contenant "${term}" (clés : ${keys.join(', ')})`);
  }
});

// =========================================================================
// P. HISTORIQUE
// =========================================================================

test('P — une session v1 est refusée proprement, sans jamais muter la moindre donnée historique', () => {
  const beforeQuestions = tableCount('advisory_questions');
  const beforeRules = tableCount('advisory_rules');
  const beforeAnswers = tableCount('advisory_answers');
  assert.throws(() => Synth.buildHealthSynthesis({ sessionId: v1QuestionnaireSessionId }));
  assert.equal(tableCount('advisory_questions'), beforeQuestions);
  assert.equal(tableCount('advisory_rules'), beforeRules);
  assert.equal(tableCount('advisory_answers'), beforeAnswers);
});

test('P — v1 (questionnaire + rule_set) reste intact et distinct de v2 (stable_key partagée, version_number jamais confondue)', () => {
  const v1RuleSet = db.prepare('SELECT * FROM advisory_rule_sets WHERE id = ?').get(seed1.ruleSetId);
  const v2RuleSet = db.prepare('SELECT * FROM advisory_rule_sets WHERE id = ?').get(seed2.ruleSetId);
  assert.equal(v1RuleSet.stable_key, v2RuleSet.stable_key);
  assert.equal(v1RuleSet.version_number, 1);
  assert.equal(v2RuleSet.version_number, 2);
  assert.notEqual(v1RuleSet.id, v2RuleSet.id);
});

// =========================================================================
// Q. CORRECTIONS POST-REVUE (advisory-architect, rules-engine-auditor)
// =========================================================================

test('Q — correction advisory-architect (défaut confirmé, majeur) : un finding écarté par le conseiller n\'alimente plus aucune conclusion ni avertissement', () => {
  const { sessionId, memberId } = buildBaselineSession(); // accident "maintien" (hors_lamal=non, accident_inclus=oui)
  const before = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(before.accident.orientation.value, 'maintien_potentiellement_adapte');
  assert.equal(before.accident.orientation.provenance, 'finding');
  const findingId = before.accident.orientation.source_finding_ids[0];

  E.dismissFinding(sessionId, findingId, {
    dismiss_reason: 'Motif fictif de test — écartement volontaire du conseiller.',
    expected_revision: rev(sessionId),
  }, REQ);

  const dtoAfter = Synth.buildHealthSynthesis({ sessionId });
  assert.equal(dtoAfter.analysis_status, 'current', 'écarter un finding ne crée jamais de nouvelle exécution ni ne modifie la révision de session');
  const after = memberOf(dtoAfter, memberId);
  assert.equal(after.accident.orientation.value, null, 'un finding écarté ne doit plus jamais alimenter une conclusion dérivée');
  assert.equal(after.accident.orientation.provenance, 'unknown');
  assert.ok(!after.source_finding_ids_all.includes(findingId), 'le finding écarté ne doit plus apparaître dans les ids agrégés du membre');
});

test('Q — correction advisory-architect : un avertissement dont l\'unique finding source est écarté disparaît de accident.warnings', () => {
  const { sessionId, memberId } = buildBaselineSession({
    overrides: [
      ['couverture_accident_hors_lamal_declaree', 'oui'], ['couverture_accident_laa_employeur_declaree', 'non'],
      ['accident_inclus_lamal_declare', 'oui'],
    ],
  });
  const before = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  const warning = before.accident.warnings.find((w) => w.code === 'doublon_potentiel');
  assert.ok(warning, 'précondition : l\'avertissement doit exister avant écartement');

  E.dismissFinding(sessionId, warning.source_finding_ids[0], {
    dismiss_reason: 'Motif fictif de test — écartement volontaire du conseiller.',
    expected_revision: rev(sessionId),
  }, REQ);

  const after = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.ok(!after.accident.warnings.some((w) => w.code === 'doublon_potentiel'));
});

// --- Correction rules-engine-auditor (lacune de couverture, non bloquante) :
// les issues "preferee"/"refusee" des 3 triplets care_model et "prioritaire"
// du libre choix n'étaient exercées par aucun test -- ajoutées ici, sur le
// modèle du test H déjà existant ("accepte" -> "compatible").
const CARE_MODEL_TRIPLET_CASES = [
  ['telemedicine', 'ouverture_telemedecine_declaree'],
  ['family_doctor', 'ouverture_medecin_famille_declaree'],
  ['hmo', 'ouverture_hmo_reseau_declaree'],
];

test('Q — correction rules-engine-auditor : les 3 triplets modèle de soins couvrent aussi "preferee" -> preferee et "refuse" -> refusee', () => {
  for (const [dim, key] of CARE_MODEL_TRIPLET_CASES) {
    const { sessionId: sidP, memberId: midP } = buildBaselineSession({ overrides: [[key, 'preferee']] });
    const preferred = memberOf(Synth.buildHealthSynthesis({ sessionId: sidP }), midP);
    assert.equal(preferred.care_model[dim].value, 'preferee', `dimension ${dim}, cas "preferee"`);
    assert.equal(preferred.care_model[dim].provenance, 'finding', `dimension ${dim}, cas "preferee"`);

    const { sessionId: sidR, memberId: midR } = buildBaselineSession({ overrides: [[key, 'refuse']] });
    const refused = memberOf(Synth.buildHealthSynthesis({ sessionId: sidR }), midR);
    assert.equal(refused.care_model[dim].value, 'refusee', `dimension ${dim}, cas "refuse"`);
    assert.equal(refused.care_model[dim].provenance, 'finding', `dimension ${dim}, cas "refuse"`);
  }
});

test('Q — correction rules-engine-auditor : libre choix "prioritaire" -> prioritaire (finding), pas seulement le repli "non_prioritaire" du socle neutre', () => {
  const { sessionId, memberId } = buildBaselineSession({ overrides: [['priorite_libre_choix_declaree', 'prioritaire']] });
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.care_model.free_choice.value, 'prioritaire');
  assert.equal(m.care_model.free_choice.provenance, 'finding');
});

test('Q — renforcement finding dismissed : n\'alimente ni orientation, ni current_comparison ; absent de TOUS les source_finding_ids (par champ et agrégé) ; ligne DB brute inchangée (juste marquée dismissed)', () => {
  const { sessionId, memberId } = buildBaselineSession({
    overrides: [
      ['capacite_absorber_depense_annuelle', 'elevee'], ['tolerance_risque_financier', 'elevee'],
      ['recours_soins_12_mois_declare', 'faible'], ['depenses_sante_anticipees_declare', 'aucune'],
      ['franchise_actuelle_niveau_declare', 'elevee'],
    ],
  });
  const before = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(before.franchise.orientation.value, 'elevee_potentiellement_adaptee');
  assert.equal(before.franchise.current_comparison.value, 'alignee');
  const orientationFindingId = before.franchise.orientation.source_finding_ids[0];
  const comparisonFindingId = before.franchise.current_comparison.source_finding_ids[0];
  assert.notEqual(orientationFindingId, comparisonFindingId, 'précondition : deux règles distinctes (orientation vs comparaison), donc deux findings distincts');
  assert.equal(db.prepare('SELECT status FROM advisory_findings WHERE id = ?').get(orientationFindingId).status, 'active');

  E.dismissFinding(sessionId, orientationFindingId, {
    dismiss_reason: 'Motif fictif de test — écartement volontaire du conseiller.',
    expected_revision: rev(sessionId),
  }, REQ);

  const after = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(after.franchise.orientation.value, null, 'orientation écartée -> plus jamais alimentée');
  assert.equal(after.franchise.orientation.provenance, 'unknown');
  assert.equal(after.franchise.current_comparison.value, 'alignee', 'un finding DISTINCT non écarté reste inchangé -- aucune contamination croisée');

  const fieldObjects = [
    after.accident.orientation, after.franchise.orientation, after.franchise.current_comparison,
    after.care_model.cost_freedom_priority, after.care_model.preserve_current_doctor, after.care_model.telemedicine,
    after.care_model.family_doctor, after.care_model.hmo, after.care_model.free_choice,
    after.complementary_needs.hospitalisation, after.complementary_needs.alternative_medicine, after.complementary_needs.optics,
    after.complementary_needs.dental, after.complementary_needs.prevention, after.complementary_needs.travel,
  ];
  for (const field of fieldObjects) {
    assert.ok(!field.source_finding_ids.includes(orientationFindingId), 'aucun champ synthétisé ne doit référencer le finding écarté');
  }
  const allWarnings = [...after.accident.warnings, ...after.care_model.warnings, ...after.complementary_needs.warnings];
  for (const w of allWarnings) {
    assert.ok(!w.source_finding_ids.includes(orientationFindingId));
  }
  assert.ok(!after.source_finding_ids_all.includes(orientationFindingId));
  assert.ok(after.source_finding_ids_all.includes(comparisonFindingId), 'le finding non écarté, lui, reste bien référencé');

  const rawAfter = db.prepare('SELECT status, dismiss_reason FROM advisory_findings WHERE id = ?').get(orientationFindingId);
  assert.equal(rawAfter.status, 'dismissed', 'la ligne brute existe toujours (historique jamais supprimé), seul son statut change');
  assert.equal(rawAfter.dismiss_reason, 'Motif fictif de test — écartement volontaire du conseiller.');
});

// =========================================================================
// R. MEMBRES HISTORIQUES (décision humaine post-revue advisory-architect)
// =========================================================================

test('R — A. membre normal : historical/no_longer_active reflètent correctement l\'état attendu (false/false)', () => {
  const { sessionId, memberId } = buildBaselineSession();
  const m = memberOf(Synth.buildHealthSynthesis({ sessionId }), memberId);
  assert.equal(m.historical, false);
  assert.equal(m.no_longer_active, false);
});

test('R — B. membre devenu historique après le démarrage de la session : toujours présent dans members[], flags corrects, conclusions/réponses/complétude/analysis_status inchangés, aucune contamination avec l\'autre membre', () => {
  const { householdId, principalMemberId, childMemberId } = buildTwoMemberHousehold();
  const sessionId = createV2Session(householdId);
  answerV2(sessionId, principalMemberId, withOverrides([]));
  answerV2(sessionId, childMemberId, withOverrides([
    ['capacite_absorber_depense_annuelle', 'elevee'], ['tolerance_risque_financier', 'elevee'],
    ['recours_soins_12_mois_declare', 'faible'], ['depenses_sante_anticipees_declare', 'aucune'],
  ]));
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: seed2.ruleSetId });

  const before = Synth.buildHealthSynthesis({ sessionId });
  const childBefore = memberOf(before, childMemberId);
  assert.equal(childBefore.historical, false);
  assert.equal(childBefore.no_longer_active, false);
  assert.equal(childBefore.franchise.orientation.value, 'elevee_potentiellement_adaptee');

  // Retire le membre enfant du foyer (jamais le principal -- removeMember l'interdit).
  removeMember(householdId, childMemberId, { end_date: '2026-08-09' }, REQ);

  const after = Synth.buildHealthSynthesis({ sessionId });
  assert.equal(after.members.length, 2, 'un membre historique reste présent dans members[], jamais supprimé du DTO');
  const childAfter = memberOf(after, childMemberId);
  assert.equal(childAfter.historical, true);
  assert.equal(childAfter.no_longer_active, true);
  // Conclusions/réponses de CETTE session inchangées par le passage historique.
  assert.equal(childAfter.franchise.orientation.value, 'elevee_potentiellement_adaptee');
  assert.deepEqual(childAfter.completeness, childBefore.completeness, 'la complétude n\'est jamais affectée par le passage historique d\'un membre');
  assert.equal(after.analysis_status, before.analysis_status, 'analysis_status jamais affecté par le retrait d\'un membre du foyer');
  assert.equal(after.session_id, before.session_id, 'la session elle-même n\'est jamais modifiée rétroactivement');
  // Aucune contamination : le principal reste normal.
  const principalAfter = memberOf(after, principalMemberId);
  assert.equal(principalAfter.historical, false);
  assert.equal(principalAfter.no_longer_active, false);
  // household_summary continue de représenter les membres de CETTE session --
  // le membre historique n'est jamais filtré silencieusement.
  assert.ok(after.household_summary.franchise_orientations_present.includes('elevee_potentiellement_adaptee'));
});

test('R — C. deux appels identiques après passage historique : historical/no_longer_active inclus dans le deepStrictEqual déterministe', () => {
  const { householdId, principalMemberId, childMemberId } = buildTwoMemberHousehold();
  const sessionId = createV2Session(householdId);
  answerV2(sessionId, principalMemberId, withOverrides([]));
  answerV2(sessionId, childMemberId, withOverrides([]));
  ensureCompleted(sessionId);
  E.executeRuleSetForSession(sessionId, 'health', rev(sessionId), REQ, { rule_set_id: seed2.ruleSetId });
  removeMember(householdId, childMemberId, { end_date: '2026-08-09' }, REQ);

  const dto1 = Synth.buildHealthSynthesis({ sessionId });
  const dto2 = Synth.buildHealthSynthesis({ sessionId });
  assert.deepEqual(dto1, dto2);
  const child1 = memberOf(dto1, childMemberId);
  assert.equal(child1.historical, true);
  assert.equal(child1.no_longer_active, true);
});
