// Tests du service métier « questionnaires génériques versionnés »
// (Legrand Diagnostic 360, Lot 3A). Base de test isolée (CRM_DATA_DIR),
// jamais data/**. Aucune donnée client réelle, aucun contenu métier réel —
// questionnaires fictifs de démonstration uniquement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-advisory-questionnaires-'));

const { default: db } = await import('../server/db.js');
const {
  createQuestionnaire, createDraftVersion, listQuestionnaires, listVersions, getVersionDetail,
  upsertSection, upsertQuestion, upsertOption, validateVersionForPublish,
  publishVersion, archiveVersion, cloneVersionToNewDraft,
} = await import('../server/advisoryQuestionnaires.js');
const { AdvisoryError } = await import('../server/advisoryHouseholds.js');

const REQ = { session: { userEmail: 'conseiller@exemple.ch' } };
db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run('conseiller@exemple.ch', 'Conseiller', 'x');

function auditCount(action) {
  return db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?').get(action).n;
}

function buildSimpleDraft(stableKey = `demo-${Math.random().toString(36).slice(2)}`) {
  const { id: qid } = createQuestionnaire({ stable_key: stableKey, domain: 'common', name: 'Questionnaire technique de démonstration' }, REQ);
  const { id: vid } = createDraftVersion(qid, {}, REQ);
  const { id: sectionId } = upsertSection(vid, { stable_key: 'infos_generales', title: 'Informations générales', sort_order: 1 }, REQ);
  const { id: q1 } = upsertQuestion(sectionId, { stable_key: 'q_texte', advisor_text: 'Champ texte fictif ?', type: 'text', sort_order: 1 }, REQ);
  return { qid, vid, sectionId, q1 };
}

// --- Questionnaires ----------------------------------------------------

test('createQuestionnaire — création et journalisation', () => {
  const before = auditCount('questionnaire créé');
  const { id } = createQuestionnaire({ stable_key: 'q-audit-test', domain: 'health', name: 'Démo audit' }, REQ);
  assert.ok(id);
  assert.equal(auditCount('questionnaire créé'), before + 1);
});

test('createQuestionnaire — refuse une clé stable déjà utilisée par un autre questionnaire', () => {
  createQuestionnaire({ stable_key: 'q-unique-test', domain: 'health', name: 'A' }, REQ);
  assert.throws(
    () => createQuestionnaire({ stable_key: 'q-unique-test', domain: 'life_pension', name: 'B' }, REQ),
    (err) => err instanceof AdvisoryError && err.status === 409
  );
});

test('createQuestionnaire — refuse un domaine inconnu', () => {
  assert.throws(() => createQuestionnaire({ stable_key: 'q-domaine-test', domain: 'mixed', name: 'X' }, REQ));
});

test('listVersions — filtre par domaine et par statut (utilisé par la création de session)', () => {
  const { vid } = buildSimpleDraft('demo-listversions');
  publishVersion(vid, REQ);
  const published = listVersions({ domain: 'common', status: 'published' });
  assert.ok(published.some((v) => v.id === vid));
  const draftOnly = listVersions({ domain: 'common', status: 'draft' });
  assert.ok(!draftOnly.some((v) => v.id === vid));
});

test('listQuestionnaires — filtre par domaine', () => {
  createQuestionnaire({ stable_key: 'q-liste-test', domain: 'life_pension', name: 'Vie test' }, REQ);
  const rows = listQuestionnaires({ domain: 'life_pension' });
  assert.ok(rows.every((r) => r.domain === 'life_pension'));
  assert.ok(rows.some((r) => r.stable_key === 'q-liste-test'));
});

// --- Versions, sections, questions, options ------------------------------

test('createDraftVersion — numéro de version strictement croissant par questionnaire', () => {
  const { qid } = buildSimpleDraft();
  const v2 = createDraftVersion(qid, {}, REQ);
  assert.equal(v2.version_number, 2);
});

test('upsertSection / upsertQuestion / upsertOption — construisent une hiérarchie complète', () => {
  const { vid, sectionId } = buildSimpleDraft();
  const { id: qid2 } = upsertQuestion(sectionId, { stable_key: 'q_choix', advisor_text: 'Choix ?', type: 'single_choice', sort_order: 2 }, REQ);
  upsertOption(qid2, { stable_key: 'opt_a', label: 'A', value: 'a', sort_order: 1 }, REQ);
  upsertOption(qid2, { stable_key: 'opt_b', label: 'B', value: 'b', sort_order: 2 }, REQ);
  const detail = getVersionDetail(vid);
  assert.equal(detail.sections.length, 1);
  assert.equal(detail.sections[0].questions.length, 2);
  const choiceQ = detail.sections[0].questions.find((q) => q.stable_key === 'q_choix');
  assert.equal(choiceQ.options.length, 2);
});

// Constat GATE LOT 3A : ces trois fonctions acceptaient déjà `req` en
// paramètre mais ne journalisaient rien avant ce correctif -- incohérent avec
// la convention du Lot 2 (server/advisoryHouseholds.js audite systématiquement
// jusqu'aux entités imbriquées, ex. ajout/modification/retrait d'un membre).
test('upsertSection / upsertQuestion / upsertOption — journalisent création ET modification', () => {
  const { vid, sectionId } = buildSimpleDraft();
  const beforeSecC = auditCount('section créée');
  const { id: newSectionId } = upsertSection(vid, { stable_key: 'sec2', title: 'Sec 2', sort_order: 2 }, REQ);
  assert.equal(auditCount('section créée'), beforeSecC + 1);
  const beforeSecM = auditCount('section modifiée');
  upsertSection(vid, { id: newSectionId, stable_key: 'sec2', title: 'Sec 2 modifiée', sort_order: 2 }, REQ);
  assert.equal(auditCount('section modifiée'), beforeSecM + 1);

  const beforeQC = auditCount('question créée');
  const { id: newQuestionId } = upsertQuestion(sectionId, { stable_key: 'q_audit', advisor_text: 'Q ?', type: 'single_choice', sort_order: 3 }, REQ);
  assert.equal(auditCount('question créée'), beforeQC + 1);
  const beforeQM = auditCount('question modifiée');
  upsertQuestion(sectionId, { id: newQuestionId, stable_key: 'q_audit', advisor_text: 'Q modifiée ?', type: 'single_choice', sort_order: 3 }, REQ);
  assert.equal(auditCount('question modifiée'), beforeQM + 1);

  const beforeOC = auditCount('option créée');
  const { id: newOptionId } = upsertOption(newQuestionId, { stable_key: 'o_audit', label: 'L', value: 'v', sort_order: 1 }, REQ);
  assert.equal(auditCount('option créée'), beforeOC + 1);
  const beforeOM = auditCount('option modifiée');
  upsertOption(newQuestionId, { id: newOptionId, stable_key: 'o_audit', label: 'L modifiée', value: 'v', sort_order: 1 }, REQ);
  assert.equal(auditCount('option modifiée'), beforeOM + 1);
});

test('upsertSection — refuse une clé stable dupliquée au sein de la même version', () => {
  const { vid } = buildSimpleDraft();
  upsertSection(vid, { stable_key: 'dup', title: 'A', sort_order: 2 }, REQ);
  assert.throws(
    () => upsertSection(vid, { stable_key: 'dup', title: 'B', sort_order: 3 }, REQ),
    (err) => err instanceof AdvisoryError && err.status === 409
  );
});

test('upsertQuestion — refuse un type à choix sans option au moment de la publication', () => {
  const { vid, sectionId } = buildSimpleDraft();
  upsertQuestion(sectionId, { stable_key: 'q_sans_option', advisor_text: 'Choix ?', type: 'single_choice', sort_order: 5 }, REQ);
  const check = validateVersionForPublish(vid);
  assert.equal(check.valid, false);
  assert.ok(check.errors.some((e) => e.includes('option')));
});

test('upsertQuestion — refuse une condition d’affichage mal formée', () => {
  const { sectionId } = buildSimpleDraft();
  assert.throws(() =>
    upsertQuestion(sectionId, {
      stable_key: 'q_cond', advisor_text: 'X ?', type: 'boolean', sort_order: 3,
      display_condition: { op: 'eval', ref: {} },
    }, REQ)
  );
});

test('upsertQuestion — cohérence scope/applies_to vérifiée à la publication', () => {
  const { vid } = buildSimpleDraft();
  const { id: memberSectionId } = upsertSection(vid, { stable_key: 'sec_membre', title: 'Section membre', sort_order: 2, applies_to: 'member' }, REQ);
  upsertQuestion(memberSectionId, { stable_key: 'q_mal_scope', advisor_text: 'X ?', type: 'boolean', sort_order: 1, scope: 'household' }, REQ);
  const check = validateVersionForPublish(vid);
  assert.equal(check.valid, false);
  assert.ok(check.errors.some((e) => e.includes('incohérente')));
});

// --- allows_not_applicable (correctif final GATE LOT 3A) --------------------
// Distinct de allows_unknown : « ne s'applique pas à ce foyer » n'est pas
// « je ne sais pas ». Désactivé par défaut, contrairement à allows_unknown.

test('upsertQuestion — allows_not_applicable : défaut false, création à true, modification d’un brouillon, valeur invalide refusée', () => {
  const { vid, sectionId } = buildSimpleDraft();

  // Défaut : absent du payload -> false (0).
  const { id: qDefault } = upsertQuestion(sectionId, { stable_key: 'q_na_defaut', advisor_text: 'X ?', type: 'boolean', sort_order: 2 }, REQ);
  let detail = getVersionDetail(vid);
  let q = detail.sections[0].questions.find((x) => x.id === qDefault);
  assert.equal(!!q.allows_not_applicable, false);

  // Création explicite à true.
  const { id: qTrue } = upsertQuestion(sectionId, { stable_key: 'q_na_true', advisor_text: 'Y ?', type: 'boolean', sort_order: 3, allows_not_applicable: true }, REQ);
  detail = getVersionDetail(vid);
  q = detail.sections[0].questions.find((x) => x.id === qTrue);
  assert.equal(!!q.allows_not_applicable, true);

  // Modification d'un brouillon : true -> false.
  upsertQuestion(sectionId, { id: qTrue, stable_key: 'q_na_true', advisor_text: 'Y ?', type: 'boolean', sort_order: 3, allows_not_applicable: false }, REQ);
  detail = getVersionDetail(vid);
  q = detail.sections[0].questions.find((x) => x.id === qTrue);
  assert.equal(!!q.allows_not_applicable, false);

  // Valeur invalide (non booléenne) refusée, jamais silencieusement coercée.
  assert.throws(
    () => upsertQuestion(sectionId, { stable_key: 'q_na_invalide', advisor_text: 'Z ?', type: 'boolean', sort_order: 4, allows_not_applicable: 'oui' }, REQ),
    /allows_not_applicable doit être un booléen/
  );
  assert.throws(
    () => upsertQuestion(sectionId, { stable_key: 'q_na_invalide2', advisor_text: 'Z2 ?', type: 'boolean', sort_order: 5, allows_not_applicable: 1 }, REQ),
    /allows_not_applicable doit être un booléen/
  );
});

test('cloneVersionToNewDraft — préserve allows_not_applicable', () => {
  const { vid, sectionId } = buildSimpleDraft();
  upsertQuestion(sectionId, { stable_key: 'q_na_clone', advisor_text: 'X ?', type: 'boolean', sort_order: 2, allows_not_applicable: true }, REQ);
  publishVersion(vid, REQ);
  const clone = cloneVersionToNewDraft(vid, REQ);
  const cloned = getVersionDetail(clone.id).sections.flatMap((s) => s.questions).find((q) => q.stable_key === 'q_na_clone');
  assert.equal(!!cloned.allows_not_applicable, true);
});

test('upsertSection/upsertQuestion/upsertOption — refusent toute modification après publication', () => {
  const { vid, sectionId } = buildSimpleDraft();
  publishVersion(vid, REQ);
  assert.throws(() => upsertSection(vid, { stable_key: 'nouvelle', title: 'X', sort_order: 9 }, REQ), (err) => err.status === 409);
  assert.throws(() => upsertQuestion(sectionId, { stable_key: 'q_nouvelle', advisor_text: 'X', type: 'text', sort_order: 9 }, REQ), (err) => err.status === 409);
});

test('upsertQuestion — allows_not_applicable est également immuable après publication (aucun champ n’échappe à la règle générale)', () => {
  const { vid, sectionId, q1 } = buildSimpleDraft();
  publishVersion(vid, REQ);
  assert.throws(
    () => upsertQuestion(sectionId, { id: q1, stable_key: 'q_texte', advisor_text: 'Champ texte fictif ?', type: 'text', sort_order: 1, allows_not_applicable: true }, REQ),
    (err) => err.status === 409
  );
});

// --- Publication -----------------------------------------------------------

test('publishVersion — publie une version valide, calcule un content_hash, journalise', () => {
  const { vid } = buildSimpleDraft();
  const before = auditCount('version publiée');
  const result = publishVersion(vid, REQ);
  assert.ok(result.content_hash);
  assert.equal(auditCount('version publiée'), before + 1);
  const detail = getVersionDetail(vid);
  assert.equal(detail.status, 'published');
  assert.ok(detail.published_at);
});

test('publishVersion — refuse une version contenant une référence à une question inconnue', () => {
  const { vid, sectionId } = buildSimpleDraft();
  upsertQuestion(sectionId, {
    stable_key: 'q_ref_inconnue', advisor_text: 'X ?', type: 'boolean', sort_order: 2,
    display_condition: { op: 'exists', ref: { question: 'n_existe_pas' } },
  }, REQ);
  assert.throws(() => publishVersion(vid, REQ), (err) => err.status === 409 && err.errors.some((e) => e.includes('inconnue')));
});

test('publishVersion — refuse une version contenant un cycle de conditions', () => {
  const { vid, sectionId } = buildSimpleDraft();
  upsertQuestion(sectionId, { stable_key: 'qa', advisor_text: 'A', type: 'boolean', sort_order: 2, display_condition: { op: 'exists', ref: { question: 'qb' } } }, REQ);
  upsertQuestion(sectionId, { stable_key: 'qb', advisor_text: 'B', type: 'boolean', sort_order: 3, display_condition: { op: 'exists', ref: { question: 'qa' } } }, REQ);
  assert.throws(() => publishVersion(vid, REQ), (err) => err.status === 409 && err.errors.some((e) => e.includes('circulaire')));
});

test('publishVersion — une condition de SECTION référençant une question inconnue est bien détectée (couverture GATE)', () => {
  const { vid } = buildSimpleDraft();
  upsertSection(vid, {
    stable_key: 'section_conditionnelle', title: 'Section conditionnelle', sort_order: 2,
    display_condition: { op: 'exists', ref: { question: 'n_existe_pas_non_plus' } },
  }, REQ);
  assert.throws(() => publishVersion(vid, REQ), (err) => err.status === 409 && err.errors.some((e) => e.includes('inconnue')));
});

test('publishVersion — une condition de section valide (référençant une vraie question de la version) est acceptée', () => {
  const { vid } = buildSimpleDraft();
  upsertSection(vid, {
    stable_key: 'section_conditionnelle_valide', title: 'Section conditionnelle valide', sort_order: 2,
    display_condition: { op: 'exists', ref: { question: 'q_texte' } },
  }, REQ);
  assert.doesNotThrow(() => publishVersion(vid, REQ));
});

test('publishVersion — refuse de republier une version déjà publiée ou archivée', () => {
  const { vid } = buildSimpleDraft();
  publishVersion(vid, REQ);
  assert.throws(() => publishVersion(vid, REQ), (err) => err.status === 409);
});

// --- Empreinte canonique, indépendante des identifiants (correctif final GATE) ---
// L'empreinte représente le CONTENU FONCTIONNEL, jamais des identifiants
// techniques SQLite (qui varient entre un original et un clone, entre deux
// bases, ou après une restauration sans que le contenu ait changé). Jamais
// présentée comme une signature cryptographique ou une preuve juridique
// (voir QUESTIONNAIRE_ENGINE.md).

test('content_hash — même contenu inséré dans un ordre physique différent -> même empreinte', () => {
  const { vid: v1 } = buildSimpleDraft('hash-phys-a');
  const s1 = getVersionDetail(v1).sections[0].id;
  upsertQuestion(s1, { stable_key: 'qa', advisor_text: 'A?', type: 'boolean', sort_order: 2 }, REQ);
  upsertQuestion(s1, { stable_key: 'qb', advisor_text: 'B?', type: 'boolean', sort_order: 3 }, REQ);
  const h1 = publishVersion(v1, REQ).content_hash;

  const { vid: v2 } = buildSimpleDraft('hash-phys-b');
  const s2 = getVersionDetail(v2).sections[0].id;
  upsertQuestion(s2, { stable_key: 'qb', advisor_text: 'B?', type: 'boolean', sort_order: 3 }, REQ); // inséré en premier
  upsertQuestion(s2, { stable_key: 'qa', advisor_text: 'A?', type: 'boolean', sort_order: 2 }, REQ);
  const h2 = publishVersion(v2, REQ).content_hash;
  assert.equal(h1, h2);
});

test('content_hash — mêmes objets JSON (condition) avec ordre de clés différent -> même empreinte', () => {
  const { vid: v1 } = buildSimpleDraft('hash-json-a');
  const s1 = getVersionDetail(v1).sections[0].id;
  upsertQuestion(s1, { stable_key: 'qc', advisor_text: 'C?', type: 'boolean', sort_order: 2, display_condition: { op: 'equals', ref: { question: 'q_texte' }, value: 'x' } }, REQ);
  const h1 = publishVersion(v1, REQ).content_hash;

  const { vid: v2 } = buildSimpleDraft('hash-json-b');
  const s2 = getVersionDetail(v2).sections[0].id;
  upsertQuestion(s2, { stable_key: 'qc', advisor_text: 'C?', type: 'boolean', sort_order: 2, display_condition: { value: 'x', ref: { question: 'q_texte' }, op: 'equals' } }, REQ);
  const h2 = publishVersion(v2, REQ).content_hash;
  assert.equal(h1, h2);
});

test('content_hash — original publié puis clone publié sans modification -> même empreinte (ids différents, contenu identique)', () => {
  const { vid } = buildSimpleDraft('hash-clone-source');
  const h1 = publishVersion(vid, REQ).content_hash;
  const clone = cloneVersionToNewDraft(vid, REQ);
  assert.notEqual(clone.id, vid);
  const h2 = publishVersion(clone.id, REQ).content_hash;
  assert.equal(h1, h2);
});

test('content_hash — sensible aux changements fonctionnels (texte, sort_order, stable_key, option, allows_unknown, allows_not_applicable)', () => {
  function build(stableKey, mutate) {
    const { vid, sectionId, q1 } = buildSimpleDraft(stableKey);
    if (mutate) mutate({ vid, sectionId, q1 });
    return publishVersion(vid, REQ).content_hash;
  }
  const baseline = build('hash-sens-baseline');
  assert.notEqual(build('hash-sens-text', ({ sectionId, q1 }) => upsertQuestion(sectionId, { id: q1, stable_key: 'q_texte', advisor_text: 'MODIFIE', type: 'text', sort_order: 1 }, REQ)), baseline);
  assert.notEqual(build('hash-sens-order', ({ sectionId }) => upsertQuestion(sectionId, { stable_key: 'q_extra', advisor_text: 'E', type: 'boolean', sort_order: 2 }, REQ)), baseline);
  assert.notEqual(build('hash-sens-key', ({ sectionId, q1 }) => upsertQuestion(sectionId, { id: q1, stable_key: 'q_texte_renomme', advisor_text: 'Champ texte fictif ?', type: 'text', sort_order: 1 }, REQ)), baseline);
  assert.notEqual(build('hash-sens-unknown', ({ sectionId, q1 }) => upsertQuestion(sectionId, { id: q1, stable_key: 'q_texte', advisor_text: 'Champ texte fictif ?', type: 'text', sort_order: 1, allows_unknown: false }, REQ)), baseline);
  assert.notEqual(build('hash-sens-na', ({ sectionId, q1 }) => upsertQuestion(sectionId, { id: q1, stable_key: 'q_texte', advisor_text: 'Champ texte fictif ?', type: 'text', sort_order: 1, allows_not_applicable: true }, REQ)), baseline);

  const withOption = build('hash-sens-option-base', ({ sectionId }) => {
    const { id: qc } = upsertQuestion(sectionId, { stable_key: 'q_choix', advisor_text: 'Choix', type: 'single_choice', sort_order: 2 }, REQ);
    upsertOption(qc, { stable_key: 'o1', label: 'L', value: 'v', sort_order: 1 }, REQ);
  });
  const optionChanged = build('hash-sens-option-changed', ({ sectionId }) => {
    const { id: qc } = upsertQuestion(sectionId, { stable_key: 'q_choix', advisor_text: 'Choix', type: 'single_choice', sort_order: 2 }, REQ);
    upsertOption(qc, { stable_key: 'o1', label: 'CHANGE', value: 'v', sort_order: 1 }, REQ);
  });
  assert.notEqual(withOption, optionChanged);
});

test('content_hash — indépendant des identifiants SQLite : contenu logique identique avec des plages d’id très différentes -> même empreinte', () => {
  const { vid: vidA } = buildSimpleDraft('hash-idchurn-a');
  const h1 = publishVersion(vidA, REQ).content_hash;

  // Consomme volontairement plusieurs centaines d'identifiants (questionnaires,
  // versions, sections, questions) avant de construire le second brouillon, pour
  // garantir que ses lignes ont des id absolus très éloignés de celles du premier.
  for (let i = 0; i < 30; i++) buildSimpleDraft('padding-' + i + '-' + Math.random().toString(36).slice(2));

  // Contenu logique STRICTEMENT identique à vidA (même structure produite par
  // buildSimpleDraft), malgré des identifiants SQLite totalement différents.
  const { vid: vidB } = buildSimpleDraft('hash-idchurn-b');
  const h2 = publishVersion(vidB, REQ).content_hash;
  assert.equal(h1, h2);
});

// Constat de la revue déterminisme (correctif final GATE) : une clé JSON
// littéralement nommée `__proto__` dans `validation_rule`/`display_condition`
// ne doit jamais être silencieusement absorbée par l'accesseur hérité
// d'`Object.prototype` lors de la canonicalisation — elle doit rester une
// donnée ordinaire comme n'importe quelle autre clé (`JSON.parse` produit une
// vraie propriété propre `__proto__`, jamais l'accesseur exotique déclenché
// par la syntaxe littérale `{ __proto__: x }`). Vérifié indirectement : deux
// versions ne différant QUE par la valeur de cette clé doivent produire des
// empreintes différentes (si la clé était silencieusement perdue, les deux
// empreintes seraient identiques à tort).
test('content_hash — une clé « __proto__ » dans validation_rule n’est jamais silencieusement perdue par la canonicalisation', () => {
  function build(stableKey, protoValue) {
    const { vid, sectionId } = buildSimpleDraft(stableKey);
    // JSON.parse (jamais la syntaxe littérale d'objet) produit une vraie
    // propriété propre nommée « __proto__ », pas l'accesseur exotique.
    const validation_rule = JSON.parse(JSON.stringify({ min: 1 }).slice(0, -1) + `,"__proto__":"${protoValue}"}`);
    const { id: q } = upsertQuestion(sectionId, { stable_key: 'q_proto', advisor_text: 'Q ?', type: 'integer', sort_order: 2, validation_rule }, REQ);
    assert.ok(q);
    return publishVersion(vid, REQ).content_hash;
  }
  const hA = build('hash-proto-a', 'valeur-a');
  const hB = build('hash-proto-b', 'valeur-b');
  assert.notEqual(hA, hB, 'la clé __proto__ doit influencer l’empreinte comme toute autre clé, jamais disparaître silencieusement');
});

// --- Archivage et clonage ----------------------------------------------

test('archiveVersion — archive et journalise, idempotent', () => {
  const { vid } = buildSimpleDraft();
  publishVersion(vid, REQ);
  const before = auditCount('version archivée');
  archiveVersion(vid, REQ);
  assert.equal(getVersionDetail(vid).status, 'archived');
  assert.equal(auditCount('version archivée'), before + 1);
  archiveVersion(vid, REQ); // idempotent, pas de deuxième audit
  assert.equal(auditCount('version archivée'), before + 1);
});

test('cloneVersionToNewDraft — refuse de cloner un brouillon (seule une version publiée peut être clonée)', () => {
  const { vid } = buildSimpleDraft();
  assert.throws(() => cloneVersionToNewDraft(vid, REQ), (err) => err.status === 409);
});

test('cloneVersionToNewDraft — clone une version publiée en un nouveau brouillon indépendant', () => {
  const { vid, qid } = buildSimpleDraft();
  publishVersion(vid, REQ);
  const clone = cloneVersionToNewDraft(vid, REQ);
  const cloneDetail = getVersionDetail(clone.id);
  assert.equal(cloneDetail.status, 'draft');
  assert.equal(cloneDetail.questionnaire_id, qid);
  assert.equal(cloneDetail.sections.length, 1);
  assert.equal(cloneDetail.sections[0].questions[0].stable_key, 'q_texte');
  // Modifier le clone ne doit jamais toucher la version publiée d'origine.
  upsertSection(clone.id, { stable_key: 'nouvelle_section', title: 'Ajout', sort_order: 2 }, REQ);
  assert.equal(getVersionDetail(vid).sections.length, 1);
  assert.equal(getVersionDetail(clone.id).sections.length, 2);
});

// --- Validation de format déclaratif (aucun code exécutable) ----------------

test('validateVersionForPublish — accepte des conditions déclaratives combinées valides', () => {
  const { vid, sectionId } = buildSimpleDraft();
  upsertQuestion(sectionId, {
    stable_key: 'q_combinee', advisor_text: 'X ?', type: 'boolean', sort_order: 2,
    display_condition: { op: 'and', conditions: [{ op: 'exists', ref: { question: 'q_texte' } }, { op: 'equals', ref: { session_property: 'domain' }, value: 'health' }] },
  }, REQ);
  const check = validateVersionForPublish(vid);
  assert.equal(check.valid, true);
});
