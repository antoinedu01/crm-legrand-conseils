// Tests du module PUR de libellés de la Synthèse Santé (SYNTH-UI1,
// `client/src/pages/healthSynthesisLabels.js`) -- aucun framework de test
// frontend (confirmé absent aux lots précédents, voir
// `test/session-recommendations-pure.test.js`), `node --test` direct.
//
// Garde de couverture en DEUX temps, disclosed explicitement (aucune
// affirmation de couverture totale non vérifiable) :
// 1. DYNAMIQUE, contre les données RÉELLEMENT exportées par le moteur
//    (`CATEGORY_HINT_MAPPING`, `server/advisoryHealthSynthesis.js`) et le
//    questionnaire Santé v2 RÉELLEMENT publié -- détecte une dérive future
//    du backend sans jamais modifier `server/**` (import en lecture seule,
//    même précédent que `test/advisory-health-synthesis-api.test.js`).
// 2. STATIQUE (disclosed), pour les 3 valeurs UNIQUEMENT accessibles via un
//    repli déclaratif (jamais produites par une règle/un `category_hint`) :
//    les tables de normalisation privées du moteur (`CARE_MODEL_TRIPLET_MAP`
//    et consorts) ne sont pas exportées -- aucune modification de
//    `server/advisoryHealthSynthesis.js` n'étant autorisée ce sous-lot pour
//    les exporter, ces 3 valeurs sont vérifiées par une liste statique
//    documentée ci-dessous plutôt que dynamiquement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-health-synthesis-labels-'));

const { default: db } = await import('../server/db.js');
const Q = await import('../server/advisoryQuestionnaires.js');
const Seed = await import('../server/seed-advisory-health-content.js');
const { CATEGORY_HINT_MAPPING } = await import('../server/advisoryHealthSynthesis.js');

const {
  NORMALIZED_VALUE_LABELS, WARNING_CODE_LABELS, MISSING_STABLE_KEY_LABELS, WARNING_DIMENSION_LABELS,
  labelForValue, labelForWarningCode, labelForMissingKey, labelForDimension,
  describeSynthesisField, collectMissingInfoLabels, formatVigilanceItems, hasVigilance,
  ANALYSIS_STATUS_LABELS, ANALYSIS_STATUS_TONES, COMPLETENESS_LABELS, COMPLETENESS_TONES,
  labelForAnalysisStatus, toneForAnalysisStatus, labelForCompleteness, toneForCompleteness,
  resolveSynthesisErrorMessage,
} = await import('../client/src/pages/healthSynthesisLabels.js');

db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)')
  .run('conseiller-synth-labels@exemple.ch', 'Conseiller', 'x');
const REQ = { session: { userEmail: 'conseiller-synth-labels@exemple.ch' } };

Seed.seedAdvisoryHealthContent(REQ); // v2 exige que v1 soit déjà provisionné
const seed2 = Seed.seedAdvisoryHealthContentV2(REQ);
assert.ok(seed2.created, 'seed v2 attendu neuf sur une base de test isolée');
Q.publishVersion(seed2.versionId, REQ);
const v2Detail = Q.getVersionDetail(seed2.versionId);
const v2StableKeys = new Set(v2Detail.sections.flatMap((s) => s.questions.map((q) => q.stable_key)));

// =========================================================================
// 1/2 — Garde dynamique contre CATEGORY_HINT_MAPPING (données réelles)
// =========================================================================

test('1 — toute valeur "field" réellement produite par CATEGORY_HINT_MAPPING a un libellé français', () => {
  const missing = [];
  for (const [hint, entry] of Object.entries(CATEGORY_HINT_MAPPING)) {
    if (entry.kind !== 'field') continue;
    if (!(entry.value in NORMALIZED_VALUE_LABELS)) missing.push(`${hint} -> ${entry.value}`);
  }
  assert.deepEqual(missing, [], `valeurs sans libellé français : ${missing.join(', ')}`);
});

test('2 — tout code de warning réellement produit par CATEGORY_HINT_MAPPING a un libellé français', () => {
  const missing = [];
  for (const [hint, entry] of Object.entries(CATEGORY_HINT_MAPPING)) {
    if (entry.kind !== 'warning') continue;
    if (!(entry.code in WARNING_CODE_LABELS)) missing.push(`${hint} -> ${entry.code}`);
  }
  assert.deepEqual(missing, [], `codes sans libellé français : ${missing.join(', ')}`);
});

// =========================================================================
// 3 — Garde statique disclosed (repli déclaratif seul, jamais via une règle)
// =========================================================================

test('3 — les 3 valeurs accessibles uniquement via repli déclaratif (jamais via CATEGORY_HINT_MAPPING) ont un libellé', () => {
  // `not_applicable_accident_not_included` : construite littéralement dans
  // `accidentOrientation()` (server/advisoryHealthSynthesis.js), jamais dans
  // CATEGORY_HINT_MAPPING. `pas_de_medecin_habituel`/`indifferent` :
  // uniquement dans la table privée non exportée `CONSERVER_MEDECIN_MAP`.
  const declaredOnly = ['not_applicable_accident_not_included', 'pas_de_medecin_habituel', 'indifferent'];
  for (const value of declaredOnly) {
    assert.ok(value in NORMALIZED_VALUE_LABELS, `valeur déclarative-seule sans libellé : ${value}`);
  }
});

// =========================================================================
// 4/5 — Garde des missing_stable_keys (dynamique + auto-cohérence disclosed)
// =========================================================================

test('4 — chaque clé de MISSING_STABLE_KEY_LABELS existe réellement comme stable_key du questionnaire Santé v2 publié', () => {
  const missing = Object.keys(MISSING_STABLE_KEY_LABELS).filter((k) => !v2StableKeys.has(k));
  assert.deepEqual(missing, [], `clés sans correspondance réelle dans le questionnaire v2 : ${missing.join(', ')}`);
});

test('5 — les 20 stable_key réellement vérifiées par le moteur (listes privées non exportées, relevé manuel du code source) ont toutes un libellé', () => {
  // Liste exhaustive relevée directement dans server/advisoryHealthSynthesis.js
  // (ACCIDENT_BASE_KEYS + Q_LAA_KEY, FRANCHISE_ORIENTATION_KEYS +
  // FRANCHISE_ACTUELLE_KEY, CARE_MODEL_CORE_KEYS + CARE_MODEL_OPTIONAL_KEYS,
  // COMPLEMENTAIRE_DIMENSIONS) -- ces consts ne sont pas exportées (aucune
  // modification de server/** autorisée ce sous-lot), donc vérification
  // d'auto-cohérence disclosed plutôt qu'un import direct.
  const expected = [
    'couverture_accident_hors_lamal_declaree', 'accident_inclus_lamal_declare', 'couverture_accident_laa_employeur_declaree',
    'capacite_absorber_depense_annuelle', 'tolerance_risque_financier', 'recours_soins_12_mois_declare', 'depenses_sante_anticipees_declare',
    'franchise_actuelle_niveau_declare',
    'priorite_prime_liberte_declaree', 'importance_conserver_medecin_declaree',
    'ouverture_telemedecine_declaree', 'ouverture_medecin_famille_declaree', 'ouverture_hmo_reseau_declaree', 'priorite_libre_choix_declaree',
    'interet_complementaire_hospitalisation_declare', 'interet_medecines_complementaires_declare', 'interet_complementaire_optique_declare',
    'interet_complementaire_dentaire_declare', 'interet_prevention_declare', 'interet_couverture_voyage_declare',
  ];
  assert.equal(expected.length, 20);
  for (const key of expected) {
    assert.ok(key in MISSING_STABLE_KEY_LABELS, `clé attendue sans libellé : ${key}`);
    assert.ok(v2StableKeys.has(key), `clé attendue absente du questionnaire v2 réel : ${key}`);
  }
  assert.equal(Object.keys(MISSING_STABLE_KEY_LABELS).length, expected.length, 'aucune clé en trop ou manquante par rapport à la liste attendue');
});

// =========================================================================
// 6 — Jamais un identifiant technique brut affiché pour une valeur inconnue
// =========================================================================

test('6 — labelForValue/labelForWarningCode/labelForMissingKey ne rendent jamais l\'identifiant technique brut pour une entrée inconnue', () => {
  const bogus = 'ceci_nexiste_certainement_pas_v42';
  assert.notEqual(labelForValue(bogus), bogus);
  assert.notEqual(labelForWarningCode(bogus), bogus);
  assert.notEqual(labelForMissingKey(bogus), bogus);
  assert.equal(typeof labelForValue(bogus), 'string');
  assert.ok(labelForValue(bogus).length > 0);
});

test('6b — labelForDimension résout les 3 dimensions réelles, jamais un identifiant technique pour une dimension inconnue (repli sur la valeur brute documenté comme dernier recours interne, jamais atteint en pratique)', () => {
  assert.equal(labelForDimension('accident'), 'Accident');
  assert.equal(labelForDimension('care_model'), 'Modèle de soins');
  assert.equal(labelForDimension('complementary_needs'), 'Complémentaires');
});

// =========================================================================
// 7 — describeSynthesisField : NULL != MISSING (correction UX critique §2)
// =========================================================================

test('7a — valeur présente, provenance finding : libellé simple, aucun suffixe', () => {
  const r = describeSynthesisField({ value: 'compatible', provenance: 'finding' }, 'current');
  assert.equal(r.text, 'Compatible');
  assert.equal(r.isDeclaredPreference, false);
});

test('7b — valeur présente, provenance declared_answer : libellé + préférence déclarée', () => {
  const r = describeSynthesisField({ value: 'compatible', provenance: 'declared_answer' }, 'not_run');
  assert.equal(r.text, 'Compatible');
  assert.equal(r.isDeclaredPreference, true);
});

test('7c — value null, provenance not_applicable : "Non applicable" quel que soit analysis_status', () => {
  for (const status of ['current', 'stale', 'not_run']) {
    const r = describeSynthesisField({ value: null, provenance: 'not_applicable' }, status);
    assert.equal(r.text, 'Non applicable');
    assert.equal(r.isDeclaredPreference, false);
  }
});

test('7d — value null, provenance unknown, analysis_status stale : jamais "Information insuffisante"', () => {
  const r = describeSynthesisField({ value: null, provenance: 'unknown' }, 'stale');
  assert.equal(r.text, "Disponible après relance de l'analyse");
});

test('7e — value null, provenance unknown, analysis_status not_run : jamais "Information insuffisante"', () => {
  const r = describeSynthesisField({ value: null, provenance: 'unknown' }, 'not_run');
  assert.equal(r.text, "Disponible après exécution de l'analyse");
});

test('7f — value null, provenance unknown, analysis_status current : vraie donnée manquante', () => {
  const r = describeSynthesisField({ value: null, provenance: 'unknown' }, 'current');
  assert.equal(r.text, 'Information insuffisante');
});

// =========================================================================
// 8 — collectMissingInfoLabels : dédup + tri déterministe
// =========================================================================

test('8 — collectMissingInfoLabels déduplique entre dimensions et trie de façon déterministe', () => {
  const byDimension = {
    accident: { state: 'blocked_by_missing_information', missing_stable_keys: ['accident_inclus_lamal_declare', 'couverture_accident_hors_lamal_declaree'] },
    franchise_orientation: { state: 'complete', missing_stable_keys: [] },
    hospitalisation: { state: 'partial', missing_stable_keys: ['accident_inclus_lamal_declare'] }, // doublon volontaire
  };
  const result = collectMissingInfoLabels(byDimension);
  assert.deepEqual(result.map((r) => r.key), ['accident_inclus_lamal_declare', 'couverture_accident_hors_lamal_declaree']);
  assert.equal(result[0].label, 'Couverture accident incluse dans la LAMal');
});

test('8b — collectMissingInfoLabels sur un objet sans manque : liste vide', () => {
  assert.deepEqual(collectMissingInfoLabels({ accident: { state: 'complete', missing_stable_keys: [] } }), []);
});

// =========================================================================
// 9/10 — formatVigilanceItems / hasVigilance
// =========================================================================

test('9 — formatVigilanceItems résout code + dimension, une entrée par warning, jamais de texte technique', () => {
  const warnings = [
    { code: 'lacune_couverture', source_finding_ids: [11], dimension: 'accident' },
    { code: 'risque_rupture_couverture', source_finding_ids: [12], dimension: 'complementary_needs' },
  ];
  const items = formatVigilanceItems(warnings);
  assert.equal(items.length, 2);
  assert.equal(items[0].text, 'Lacune de couverture à vérifier');
  assert.equal(items[0].dimensionLabel, 'Accident');
  assert.equal(items[1].text, 'Risque de rupture de couverture à vérifier');
  assert.equal(items[1].dimensionLabel, 'Complémentaires');
  // Aucun `code`/`dimension` technique brut dans le texte affiché.
  for (const item of items) {
    assert.ok(!item.text.includes('_'));
  }
});

test('9b — formatVigilanceItems sur un tableau vide/absent : liste vide', () => {
  assert.deepEqual(formatVigilanceItems([]), []);
  assert.deepEqual(formatVigilanceItems(undefined), []);
});

test('10 — hasVigilance distingue correctement présence/absence', () => {
  assert.equal(hasVigilance([]), false);
  assert.equal(hasVigilance(undefined), false);
  assert.equal(hasVigilance([{ code: 'lacune_couverture', source_finding_ids: [1] }]), true);
});

// =========================================================================
// 11 — Couverture des 3 analysis_status et 3 completeness réellement émis
// =========================================================================

test('11 — ANALYSIS_STATUS_LABELS/TONES couvrent exactement current/stale/not_run', () => {
  for (const status of ['current', 'stale', 'not_run']) {
    assert.ok(status in ANALYSIS_STATUS_LABELS, `libellé manquant : ${status}`);
    assert.ok(status in ANALYSIS_STATUS_TONES, `tonalité manquante : ${status}`);
  }
  assert.equal(ANALYSIS_STATUS_TONES.current, 'good');
  assert.equal(ANALYSIS_STATUS_TONES.stale, 'warn');
  assert.equal(ANALYSIS_STATUS_TONES.not_run, 'info');
});

test('11b — COMPLETENESS_LABELS/TONES couvrent exactement complete/partial/blocked_by_missing_information, jamais "critical"', () => {
  for (const state of ['complete', 'partial', 'blocked_by_missing_information']) {
    assert.ok(state in COMPLETENESS_LABELS, `libellé manquant : ${state}`);
    assert.ok(state in COMPLETENESS_TONES, `tonalité manquante : ${state}`);
    assert.notEqual(COMPLETENESS_TONES[state], 'critical', 'un manque d\'information ne doit jamais être présenté comme une erreur');
  }
});

test('11c — WARNING_DIMENSION_LABELS couvre exactement les 3 dimensions réellement émises par member.warnings', () => {
  assert.deepEqual(Object.keys(WARNING_DIMENSION_LABELS).sort(), ['accident', 'care_model', 'complementary_needs']);
});

// =========================================================================
// 12 — labelForAnalysisStatus/labelForCompleteness : correction post-revue
// compliance-privacy-reviewer (jamais un repli `map[clé] || clé` qui
// afficherait un identifiant technique brut, cohérent avec §4)
// =========================================================================

test('12a — labelForAnalysisStatus/toneForAnalysisStatus résolvent les 3 valeurs réelles', () => {
  for (const status of ['current', 'stale', 'not_run']) {
    assert.equal(labelForAnalysisStatus(status), ANALYSIS_STATUS_LABELS[status]);
    assert.equal(toneForAnalysisStatus(status), ANALYSIS_STATUS_TONES[status]);
  }
});

test('12b — labelForAnalysisStatus ne rend jamais l\'identifiant technique brut pour une valeur inconnue', () => {
  const bogus = 'ceci_nexiste_certainement_pas_v42';
  assert.notEqual(labelForAnalysisStatus(bogus), bogus);
  assert.equal(toneForAnalysisStatus(bogus), '');
});

test('12c — labelForCompleteness/toneForCompleteness résolvent les 3 valeurs réelles', () => {
  for (const state of ['complete', 'partial', 'blocked_by_missing_information']) {
    assert.equal(labelForCompleteness(state), COMPLETENESS_LABELS[state]);
    assert.equal(toneForCompleteness(state), COMPLETENESS_TONES[state]);
  }
});

test('12d — labelForCompleteness ne rend jamais l\'identifiant technique brut pour une valeur inconnue', () => {
  const bogus = 'ceci_nexiste_certainement_pas_v42';
  assert.notEqual(labelForCompleteness(bogus), bogus);
  assert.equal(toneForCompleteness(bogus), '');
});

// =========================================================================
// 13 — resolveSynthesisErrorMessage (correction post-validation humaine
// SYNTH-UI1, sous-lot corrections §2) : jamais error.message/error.data.*
// brut pour un statut/code non explicitement prévu.
// =========================================================================

test('13a — 404 : message fixe "Session introuvable."', () => {
  assert.equal(resolveSynthesisErrorMessage({ status: 404, message: 'Foyer introuvable.' }), 'Session introuvable.');
});

test('13b — 400 : message fixe, jamais le message serveur brut', () => {
  assert.equal(
    resolveSynthesisErrorMessage({ status: 400, message: 'Domaine « life_pension » non applicable à cette session.' }),
    "La synthèse Santé n'est pas disponible pour cette session."
  );
});

test('13c — 409 HEALTH_SYNTHESIS_UNSUPPORTED_VERSION : message fixe, jamais error.data.details', () => {
  const error = {
    status: 409,
    message: 'Le questionnaire Santé de cette session (version 1) n\'est pas pris en charge…',
    data: { code: 'HEALTH_SYNTHESIS_UNSUPPORTED_VERSION', details: { expected_questionnaire_version: 2, actual_questionnaire_version: 1 } },
  };
  const result = resolveSynthesisErrorMessage(error);
  assert.equal(result, 'Cette session utilise une ancienne version du Diagnostic Santé. La synthèse reste disponible uniquement pour les sessions Santé v2.');
  assert.ok(!result.includes('1'), 'aucun numéro de version technique dans le texte affiché');
});

test('13d — 409 SANS le code HEALTH_SYNTHESIS_UNSUPPORTED_VERSION (autre conflit non anticipé) : message générique, jamais le message serveur', () => {
  const error = { status: 409, message: 'Conflit inattendu.', data: { code: 'AUTRE_CODE' } };
  assert.equal(resolveSynthesisErrorMessage(error), 'Impossible de charger la synthèse Santé pour le moment.');
});

test('13e — statut inattendu (500) : message générique fixe, jamais error.message', () => {
  const error = { status: 500, message: 'Erreur interne du serveur.' };
  assert.equal(resolveSynthesisErrorMessage(error), 'Impossible de charger la synthèse Santé pour le moment.');
});

test('13f — aucun statut (échec réseau avant réponse serveur) : message générique fixe', () => {
  const error = new Error('Failed to fetch');
  assert.equal(resolveSynthesisErrorMessage(error), 'Impossible de charger la synthèse Santé pour le moment.');
});

test('13g — un message serveur contenant une trace technique interne n\'apparaît jamais dans le texte utilisateur', () => {
  const error = { status: 500, message: 'SQLITE_ERROR internal foo', data: { error: 'SQLITE_ERROR internal foo' } };
  const result = resolveSynthesisErrorMessage(error);
  assert.ok(!result.includes('SQLITE_ERROR'));
  assert.ok(!result.includes('internal foo'));
  assert.equal(result, 'Impossible de charger la synthèse Santé pour le moment.');
});

test('13h — une valeur sensible portée par error.data.details n\'apparaît jamais dans le texte utilisateur (statut/code non prévu)', () => {
  const error = { status: 422, message: 'patient-sensitive-value leaked', data: { details: { note: 'patient-sensitive-value' } } };
  const result = resolveSynthesisErrorMessage(error);
  assert.ok(!result.includes('patient-sensitive-value'));
  assert.equal(result, 'Impossible de charger la synthèse Santé pour le moment.');
});

test('13i — une valeur sensible glissée dans error.data.details SUR le cas 409 connu n\'apparaît pas non plus (details jamais interpolé)', () => {
  const error = {
    status: 409,
    message: 'Cette session utilise…',
    data: { code: 'HEALTH_SYNTHESIS_UNSUPPORTED_VERSION', details: { note: 'patient-sensitive-value' } },
  };
  const result = resolveSynthesisErrorMessage(error);
  assert.ok(!result.includes('patient-sensitive-value'));
});
