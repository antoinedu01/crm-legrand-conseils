// Service métier — questionnaires génériques versionnés (Legrand Diagnostic
// 360, Lot 3A). Isolé de `server/routes/advisoryQuestionnaires.js` (adaptateur
// HTTP fin), sur le même modèle que `server/advisoryHouseholds.js` (Lot 2).

import crypto from 'crypto';
import db from './db.js';
import { assert, inEnum, checkTextFields } from './validate.js';
import { audit } from './audit.js';
import { AdvisoryError } from './advisoryHouseholds.js';
import {
  validateConditionFormat, detectCycle, findUnknownReferences,
} from './advisoryConditions.js';
import { byCanonicalOrder, canonicalizeJson } from './canonicalJson.js';

export const QUESTIONNAIRE_DOMAINS = ['common', 'health', 'life_pension'];
export const QUESTIONNAIRE_STATUSES = ['active', 'archived'];
export const VERSION_STATUSES = ['draft', 'published', 'archived'];
export const SECTION_APPLIES_TO = ['household', 'member'];
export const QUESTION_TYPES = [
  'single_choice', 'multiple_choice', 'text', 'long_text',
  'integer', 'decimal', 'money', 'date', 'boolean',
];
export const QUESTION_SCOPES = ['household', 'member', 'session'];
const CHOICE_TYPES = ['single_choice', 'multiple_choice'];

// --- Lecture ---------------------------------------------------------------

export function listQuestionnaires({ domain, status } = {}) {
  let sql = 'SELECT * FROM advisory_questionnaires WHERE 1=1';
  const params = [];
  if (domain) { sql += ' AND domain = ?'; params.push(domain); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY name';
  return db.prepare(sql).all(...params);
}

// Liste des versions (toutes familles confondues), utilisée par l'écran de
// création de session pour proposer les versions publiées disponibles par
// domaine — sans cette lecture, aucune sélection réelle n'est possible côté
// interface (l'unique lecture existante, `getVersionDetail`, exige déjà de
// connaître l'identifiant précis d'une version).
export function listVersions({ domain, status } = {}) {
  let sql = `
    SELECT v.*, q.stable_key AS questionnaire_stable_key, q.name AS questionnaire_name, q.domain AS questionnaire_domain
    FROM advisory_questionnaire_versions v
    JOIN advisory_questionnaires q ON q.id = v.questionnaire_id
    WHERE 1=1`;
  const params = [];
  if (domain) { sql += ' AND q.domain = ?'; params.push(domain); }
  if (status) { sql += ' AND v.status = ?'; params.push(status); }
  sql += ' ORDER BY q.name, v.version_number DESC';
  return db.prepare(sql).all(...params);
}

function getQuestionnaire(id) {
  return db.prepare('SELECT * FROM advisory_questionnaires WHERE id = ?').get(id);
}

function getVersion(versionId) {
  return db.prepare('SELECT * FROM advisory_questionnaire_versions WHERE id = ?').get(versionId);
}

function getSectionsWithQuestions(versionId) {
  const sections = db
    .prepare('SELECT * FROM advisory_sections WHERE questionnaire_version_id = ? ORDER BY sort_order, id')
    .all(versionId);
  const questions = db
    .prepare('SELECT * FROM advisory_questions WHERE questionnaire_version_id = ? ORDER BY sort_order, id')
    .all(versionId);
  const options = db
    .prepare(
      `SELECT o.* FROM advisory_question_options o
       JOIN advisory_questions q ON q.id = o.question_id
       WHERE q.questionnaire_version_id = ? ORDER BY o.sort_order, o.id`
    )
    .all(versionId);
  const optionsByQuestion = new Map();
  for (const o of options) {
    if (!optionsByQuestion.has(o.question_id)) optionsByQuestion.set(o.question_id, []);
    optionsByQuestion.get(o.question_id).push(o);
  }
  const questionsBySection = new Map();
  for (const q of questions) {
    if (!questionsBySection.has(q.section_id)) questionsBySection.set(q.section_id, []);
    questionsBySection.get(q.section_id).push({ ...q, options: optionsByQuestion.get(q.id) || [] });
  }
  return sections.map((s) => ({ ...s, questions: questionsBySection.get(s.id) || [] }));
}

export function getVersionDetail(versionId) {
  const version = getVersion(versionId);
  if (!version) return null;
  const questionnaire = getQuestionnaire(version.questionnaire_id);
  return { ...version, questionnaire, sections: getSectionsWithQuestions(versionId) };
}

// --- Écriture : questionnaires et versions ---------------------------------

export function createQuestionnaire({ stable_key, domain, name, description } = {}, req) {
  assert(stable_key, 'La clé stable est requise.');
  assert(inEnum(domain, QUESTIONNAIRE_DOMAINS) && domain != null, 'Domaine de questionnaire inconnu.');
  assert(name, 'Le nom est requis.');
  checkTextFields({ stable_key, name, description }, ['stable_key', 'name'], 200);
  checkTextFields({ description }, ['description'], 2000);
  const existing = db.prepare('SELECT id FROM advisory_questionnaires WHERE stable_key = ?').get(stable_key);
  if (existing) throw new AdvisoryError('Cette clé stable est déjà utilisée par un autre questionnaire.', 409);
  const info = db
    .prepare('INSERT INTO advisory_questionnaires (stable_key, domain, name, description) VALUES (?, ?, ?, ?)')
    .run(stable_key, domain, name, description || null);
  audit(req, 'questionnaire créé', 'advisory_questionnaire', info.lastInsertRowid, `${domain} — ${stable_key}`);
  return { id: info.lastInsertRowid };
}

export function createDraftVersion(questionnaireId, { notes } = {}, req) {
  const questionnaire = getQuestionnaire(questionnaireId);
  if (!questionnaire) throw new AdvisoryError('Questionnaire introuvable.', 404);
  checkTextFields({ notes }, ['notes'], 2000);
  const last = db
    .prepare('SELECT MAX(version_number) AS n FROM advisory_questionnaire_versions WHERE questionnaire_id = ?')
    .get(questionnaireId);
  const versionNumber = (last.n || 0) + 1;
  const info = db
    .prepare('INSERT INTO advisory_questionnaire_versions (questionnaire_id, version_number, notes) VALUES (?, ?, ?)')
    .run(questionnaireId, versionNumber, notes || null);
  audit(req, 'version créée', 'advisory_questionnaire_version', info.lastInsertRowid, `${questionnaire.stable_key} v${versionNumber}`);
  return { id: info.lastInsertRowid, version_number: versionNumber };
}

function assertVersionDraft(version) {
  if (!version) throw new AdvisoryError('Version de questionnaire introuvable.', 404);
  if (version.status !== 'draft') {
    throw new AdvisoryError('Seule une version en brouillon peut être modifiée.', 409);
  }
}

// --- Écriture : structure d'une version brouillon (sections/questions/options)

export function upsertSection(versionId, data = {}, req) {
  const version = getVersion(versionId);
  assertVersionDraft(version);
  const { id, stable_key, title, description, sort_order, applies_to, display_condition, status } = data;
  assert(stable_key, 'La clé stable de section est requise.');
  assert(title, 'Le titre de section est requis.');
  assert(Number.isInteger(sort_order), 'sort_order doit être un entier.');
  assert(inEnum(applies_to || 'household', SECTION_APPLIES_TO), 'Portée de section inconnue.');
  assert(inEnum(status || 'active', ['active', 'archived']), 'Statut de section inconnu.');
  checkTextFields({ stable_key, title }, ['stable_key', 'title'], 200);
  checkTextFields({ description }, ['description'], 2000);
  if (display_condition != null) {
    const r = validateConditionFormat(display_condition);
    assert(r.valid, `Condition d'affichage invalide : ${r.errors.join('; ')}`);
  }
  const conditionJson = display_condition != null ? JSON.stringify(display_condition) : null;

  if (id) {
    const existing = db.prepare('SELECT * FROM advisory_sections WHERE id = ? AND questionnaire_version_id = ?').get(id, versionId);
    if (!existing) throw new AdvisoryError('Section introuvable dans cette version.', 404);
    const dup = db
      .prepare('SELECT id FROM advisory_sections WHERE questionnaire_version_id = ? AND stable_key = ? AND id != ?')
      .get(versionId, stable_key, id);
    if (dup) throw new AdvisoryError('Cette clé stable est déjà utilisée par une autre section de la version.', 409);
    db.prepare(
      `UPDATE advisory_sections SET stable_key=?, title=?, description=?, sort_order=?, applies_to=?,
       display_condition=?, status=?, updated_at=datetime('now') WHERE id=?`
    ).run(stable_key, title, description || null, sort_order, applies_to || 'household', conditionJson, status || 'active', id);
    audit(req, 'section modifiée', 'advisory_questionnaire_version', versionId, stable_key);
    return { id };
  }
  const dup = db.prepare('SELECT id FROM advisory_sections WHERE questionnaire_version_id = ? AND stable_key = ?').get(versionId, stable_key);
  if (dup) throw new AdvisoryError('Cette clé stable est déjà utilisée par une autre section de la version.', 409);
  const info = db
    .prepare(
      `INSERT INTO advisory_sections (questionnaire_version_id, stable_key, title, description, sort_order, applies_to, display_condition, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(versionId, stable_key, title, description || null, sort_order, applies_to || 'household', conditionJson, status || 'active');
  audit(req, 'section créée', 'advisory_questionnaire_version', versionId, stable_key);
  return { id: info.lastInsertRowid };
}

export function upsertQuestion(sectionId, data = {}, req) {
  const section = db.prepare('SELECT * FROM advisory_sections WHERE id = ?').get(sectionId);
  if (!section) throw new AdvisoryError('Section introuvable.', 404);
  const version = getVersion(section.questionnaire_version_id);
  assertVersionDraft(version);
  const {
    id, stable_key, advisor_text, client_text, type, scope, required, allows_unknown, allows_not_applicable,
    sort_order, help_text, display_condition, validation_rule, sensitive, status,
  } = data;
  assert(stable_key, 'La clé stable de question est requise.');
  assert(advisor_text, 'Le texte conseiller est requis.');
  assert(inEnum(type, QUESTION_TYPES) && type != null, 'Type de question inconnu.');
  assert(inEnum(scope || 'household', QUESTION_SCOPES), 'Portée de question inconnue.');
  assert(Number.isInteger(sort_order), 'sort_order doit être un entier.');
  assert(inEnum(status || 'active', ['active', 'archived']), 'Statut de question inconnu.');
  checkTextFields({ stable_key, advisor_text, client_text, help_text }, ['stable_key', 'advisor_text', 'client_text', 'help_text'], 500);
  if (display_condition != null) {
    const r = validateConditionFormat(display_condition);
    assert(r.valid, `Condition d'affichage invalide : ${r.errors.join('; ')}`);
  }
  if (validation_rule != null) {
    assert(typeof validation_rule === 'object' && !Array.isArray(validation_rule), 'validation_rule doit être un objet JSON.');
  }
  // allows_not_applicable : distinct de allows_unknown (« ne s'applique pas
  // à ce foyer » n'est pas « je ne sais pas »). Contrairement à
  // allows_unknown/required/sensitive (coercition tolérante déjà en usage),
  // ce champ exige explicitement un booléen strict ou son absence — une
  // valeur invalide est refusée plutôt que silencieusement coercée, pour
  // qu'un concepteur de questionnaire ne l'active jamais par accident.
  assert(
    allows_not_applicable === undefined || typeof allows_not_applicable === 'boolean',
    'allows_not_applicable doit être un booléen.'
  );
  const conditionJson = display_condition != null ? JSON.stringify(display_condition) : null;
  const validationJson = validation_rule != null ? JSON.stringify(validation_rule) : null;
  const requiredFlag = required ? 1 : 0;
  const allowsUnknownFlag = allows_unknown === false ? 0 : 1;
  const allowsNotApplicableFlag = allows_not_applicable === true ? 1 : 0;
  const sensitiveFlag = sensitive ? 1 : 0;
  const versionId = section.questionnaire_version_id;

  if (id) {
    const existing = db.prepare('SELECT * FROM advisory_questions WHERE id = ? AND section_id = ?').get(id, sectionId);
    if (!existing) throw new AdvisoryError('Question introuvable dans cette section.', 404);
    const dup = db
      .prepare('SELECT id FROM advisory_questions WHERE questionnaire_version_id = ? AND stable_key = ? AND id != ?')
      .get(versionId, stable_key, id);
    if (dup) throw new AdvisoryError('Cette clé stable est déjà utilisée par une autre question de la version.', 409);
    db.prepare(
      `UPDATE advisory_questions SET stable_key=?, advisor_text=?, client_text=?, type=?, scope=?, required=?,
       allows_unknown=?, allows_not_applicable=?, sort_order=?, help_text=?, display_condition=?, validation_rule=?, sensitive=?, status=?,
       updated_at=datetime('now') WHERE id=?`
    ).run(
      stable_key, advisor_text, client_text || null, type, scope || 'household', requiredFlag,
      allowsUnknownFlag, allowsNotApplicableFlag, sort_order, help_text || null, conditionJson, validationJson, sensitiveFlag, status || 'active', id
    );
    audit(req, 'question modifiée', 'advisory_questionnaire_version', versionId, stable_key);
    return { id };
  }
  const dup = db.prepare('SELECT id FROM advisory_questions WHERE questionnaire_version_id = ? AND stable_key = ?').get(versionId, stable_key);
  if (dup) throw new AdvisoryError('Cette clé stable est déjà utilisée par une autre question de la version.', 409);
  const info = db
    .prepare(
      `INSERT INTO advisory_questions
        (section_id, questionnaire_version_id, stable_key, advisor_text, client_text, type, scope, required,
         allows_unknown, allows_not_applicable, sort_order, help_text, display_condition, validation_rule, sensitive, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      sectionId, versionId, stable_key, advisor_text, client_text || null, type, scope || 'household', requiredFlag,
      allowsUnknownFlag, allowsNotApplicableFlag, sort_order, help_text || null, conditionJson, validationJson, sensitiveFlag, status || 'active'
    );
  audit(req, 'question créée', 'advisory_questionnaire_version', versionId, stable_key);
  return { id: info.lastInsertRowid };
}

export function upsertOption(questionId, data = {}, req) {
  const question = db.prepare('SELECT * FROM advisory_questions WHERE id = ?').get(questionId);
  if (!question) throw new AdvisoryError('Question introuvable.', 404);
  assert(CHOICE_TYPES.includes(question.type), 'Les options ne s’appliquent qu’aux questions à choix simple ou multiple.');
  const version = getVersion(question.questionnaire_version_id);
  assertVersionDraft(version);
  const { id, stable_key, label, value, sort_order, status } = data;
  assert(stable_key, 'La clé stable d’option est requise.');
  assert(label, 'Le libellé est requis.');
  assert(value != null && value !== '', 'La valeur logique est requise.');
  assert(Number.isInteger(sort_order), 'sort_order doit être un entier.');
  assert(inEnum(status || 'active', ['active', 'archived']), 'Statut d’option inconnu.');
  checkTextFields({ stable_key, label, value: String(value) }, ['stable_key', 'label', 'value'], 200);

  if (id) {
    const existing = db.prepare('SELECT * FROM advisory_question_options WHERE id = ? AND question_id = ?').get(id, questionId);
    if (!existing) throw new AdvisoryError('Option introuvable pour cette question.', 404);
    const dup = db
      .prepare('SELECT id FROM advisory_question_options WHERE question_id = ? AND stable_key = ? AND id != ?')
      .get(questionId, stable_key, id);
    if (dup) throw new AdvisoryError('Cette clé stable est déjà utilisée par une autre option de la question.', 409);
    db.prepare(
      `UPDATE advisory_question_options SET stable_key=?, label=?, value=?, sort_order=?, status=?, updated_at=datetime('now') WHERE id=?`
    ).run(stable_key, label, String(value), sort_order, status || 'active', id);
    audit(req, 'option modifiée', 'advisory_questionnaire_version', question.questionnaire_version_id, stable_key);
    return { id };
  }
  const dup = db.prepare('SELECT id FROM advisory_question_options WHERE question_id = ? AND stable_key = ?').get(questionId, stable_key);
  if (dup) throw new AdvisoryError('Cette clé stable est déjà utilisée par une autre option de la question.', 409);
  const info = db
    .prepare(
      'INSERT INTO advisory_question_options (question_id, stable_key, label, value, sort_order, status) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(questionId, stable_key, label, String(value), sort_order, status || 'active');
  audit(req, 'option créée', 'advisory_questionnaire_version', question.questionnaire_version_id, stable_key);
  return { id: info.lastInsertRowid };
}

// --- Validation de version avant publication --------------------------------

// Fonction pure de validation (ne modifie rien) — utilisée par publishVersion
// et exposée séparément pour être testée indépendamment de l'écriture.
export function validateVersionForPublish(versionId) {
  const sections = getSectionsWithQuestions(versionId);
  const errors = [];
  const conditionNodes = [];
  const questionKeys = [];

  for (const section of sections) {
    if (section.display_condition) {
      const parsed = JSON.parse(section.display_condition);
      const r = validateConditionFormat(parsed);
      if (!r.valid) errors.push(`Section « ${section.stable_key} » : condition invalide (${r.errors.join('; ')})`);
      conditionNodes.push({ key: `section:${section.stable_key}`, condition: parsed });
    }
    for (const question of section.questions) {
      questionKeys.push(question.stable_key);
      let parsedQ = null;
      if (question.display_condition) {
        parsedQ = JSON.parse(question.display_condition);
        const r = validateConditionFormat(parsedQ);
        if (!r.valid) errors.push(`Question « ${question.stable_key} » : condition invalide (${r.errors.join('; ')})`);
      }
      conditionNodes.push({ key: question.stable_key, condition: parsedQ });
      if (CHOICE_TYPES.includes(question.type) && question.options.length === 0) {
        errors.push(`Question « ${question.stable_key} » : au moins une option est requise pour un type à choix.`);
      }
      if (!CHOICE_TYPES.includes(question.type) && question.options.length > 0) {
        errors.push(`Question « ${question.stable_key} » : les options ne s'appliquent qu'aux types à choix.`);
      }
      // Cohérence section.applies_to / question.scope : une section
      // « member » (répétée par personne) n'a de sens que pour des
      // questions de portée « member » ; une section « household » ne peut
      // contenir de question de portée « member » (aucun membre courant à
      // résoudre). Détecté à la publication plutôt que laissé comme un bug
      // silencieux à l'exécution (constat vérifié par test end-to-end).
      if (section.applies_to === 'member' && question.scope !== 'member') {
        errors.push(`Question « ${question.stable_key} » : portée « ${question.scope} » incohérente avec sa section « ${section.stable_key} » (applies_to=member).`);
      }
      if (section.applies_to === 'household' && question.scope === 'member') {
        errors.push(`Question « ${question.stable_key} » : portée « member » incohérente avec sa section « ${section.stable_key} » (applies_to=household).`);
      }
    }
  }

  if (sections.length === 0) errors.push('La version ne contient aucune section.');

  const unknown = findUnknownReferences(conditionNodes, questionKeys);
  for (const u of unknown) {
    errors.push(`« ${u.from} » référence une question inconnue de cette version : « ${u.question} ».`);
  }
  const cycle = detectCycle(conditionNodes);
  if (cycle) errors.push(`Dépendance circulaire détectée entre conditions d'affichage : ${cycle.join(' → ')}.`);

  return { valid: errors.length === 0, errors };
}

// Empreinte technique d'intégrité du CONTENU FONCTIONNEL d'une version —
// jamais une signature cryptographique ni une preuve juridique (voir
// QUESTIONNAIRE_ENGINE.md). Volontairement indépendante de tout identifiant
// technique SQLite, date, auteur, statut ou numéro de version : deux
// structures identiques doivent produire le même hash, que l'une soit
// l'original et l'autre un clone (identifiants différents), et quel que soit
// l'ordre physique d'insertion en base (seul l'ordre fonctionnel — sort_order
// puis stable_key — détermine l'ordre de sérialisation).
function computeContentHash(versionId) {
  const sections = getSectionsWithQuestions(versionId)
    .slice()
    .sort(byCanonicalOrder)
    .map((s) => ({
      stable_key: s.stable_key,
      title: s.title,
      description: s.description ?? null,
      sort_order: s.sort_order,
      applies_to: s.applies_to,
      display_condition: s.display_condition ? canonicalizeJson(JSON.parse(s.display_condition)) : null,
      questions: s.questions
        .slice()
        .sort(byCanonicalOrder)
        .map((q) => ({
          stable_key: q.stable_key,
          advisor_text: q.advisor_text,
          client_text: q.client_text ?? null,
          help_text: q.help_text ?? null,
          type: q.type,
          scope: q.scope,
          required: !!q.required,
          allows_unknown: !!q.allows_unknown,
          allows_not_applicable: !!q.allows_not_applicable,
          sort_order: q.sort_order,
          display_condition: q.display_condition ? canonicalizeJson(JSON.parse(q.display_condition)) : null,
          validation_rule: q.validation_rule ? canonicalizeJson(JSON.parse(q.validation_rule)) : null,
          options: q.options
            .slice()
            .sort(byCanonicalOrder)
            .map((o) => ({ stable_key: o.stable_key, label: o.label, value: o.value, sort_order: o.sort_order })),
        })),
    }));
  return crypto.createHash('sha256').update(JSON.stringify(sections)).digest('hex');
}

export function publishVersion(versionId, req) {
  const version = getVersion(versionId);
  if (!version) throw new AdvisoryError('Version de questionnaire introuvable.', 404);
  if (version.status !== 'draft') throw new AdvisoryError('Seule une version en brouillon peut être publiée.', 409);
  const check = validateVersionForPublish(versionId);
  if (!check.valid) {
    const err = new AdvisoryError('La version contient des erreurs et ne peut pas être publiée.', 409);
    err.errors = check.errors;
    throw err;
  }
  const hash = computeContentHash(versionId);
  const email = req?.session?.userEmail;
  const userId = email ? db.prepare('SELECT id FROM users WHERE email = ?').get(email)?.id : null;
  db.prepare(
    `UPDATE advisory_questionnaire_versions
     SET status = 'published', content_hash = ?, published_by_user_id = ?, published_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`
  ).run(hash, userId || null, versionId);
  const questionnaire = getQuestionnaire(version.questionnaire_id);
  audit(req, 'version publiée', 'advisory_questionnaire_version', versionId, `${questionnaire.stable_key} v${version.version_number}`);
  return { ok: true, content_hash: hash };
}

export function archiveVersion(versionId, req) {
  const version = getVersion(versionId);
  if (!version) throw new AdvisoryError('Version de questionnaire introuvable.', 404);
  if (version.status === 'archived') return { ok: true };
  db.prepare("UPDATE advisory_questionnaire_versions SET status = 'archived', updated_at = datetime('now') WHERE id = ?").run(versionId);
  const questionnaire = getQuestionnaire(version.questionnaire_id);
  audit(req, 'version archivée', 'advisory_questionnaire_version', versionId, `${questionnaire.stable_key} v${version.version_number}`);
  return { ok: true };
}

// Clone une version publiée vers un nouveau brouillon (même questionnaire) —
// permet de faire évoluer un contenu déjà publié sans jamais le modifier en
// place. Les clés stables sont préservées (continuité entre versions).
export function cloneVersionToNewDraft(versionId, req) {
  const source = getVersion(versionId);
  if (!source) throw new AdvisoryError('Version de questionnaire introuvable.', 404);
  if (source.status !== 'published') throw new AdvisoryError('Seule une version publiée peut être clonée.', 409);
  const sections = getSectionsWithQuestions(versionId);

  const newVersionId = db.transaction(() => {
    const last = db
      .prepare('SELECT MAX(version_number) AS n FROM advisory_questionnaire_versions WHERE questionnaire_id = ?')
      .get(source.questionnaire_id);
    const versionNumber = (last.n || 0) + 1;
    const info = db
      .prepare('INSERT INTO advisory_questionnaire_versions (questionnaire_id, version_number, notes) VALUES (?, ?, ?)')
      .run(source.questionnaire_id, versionNumber, `Cloné depuis la version ${source.version_number}`);
    const newVersionId = info.lastInsertRowid;
    for (const section of sections) {
      const sInfo = db
        .prepare(
          `INSERT INTO advisory_sections (questionnaire_version_id, stable_key, title, description, sort_order, applies_to, display_condition, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(newVersionId, section.stable_key, section.title, section.description, section.sort_order, section.applies_to, section.display_condition, section.status);
      const newSectionId = sInfo.lastInsertRowid;
      for (const question of section.questions) {
        const qInfo = db
          .prepare(
            `INSERT INTO advisory_questions
              (section_id, questionnaire_version_id, stable_key, advisor_text, client_text, type, scope, required,
               allows_unknown, allows_not_applicable, sort_order, help_text, display_condition, validation_rule, sensitive, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            newSectionId, newVersionId, question.stable_key, question.advisor_text, question.client_text, question.type,
            question.scope, question.required, question.allows_unknown, question.allows_not_applicable, question.sort_order, question.help_text,
            question.display_condition, question.validation_rule, question.sensitive, question.status
          );
        const newQuestionId = qInfo.lastInsertRowid;
        for (const option of question.options) {
          db.prepare(
            'INSERT INTO advisory_question_options (question_id, stable_key, label, value, sort_order, status) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(newQuestionId, option.stable_key, option.label, option.value, option.sort_order, option.status);
        }
      }
    }
    return newVersionId;
  })();

  const questionnaire = getQuestionnaire(source.questionnaire_id);
  audit(req, 'version clonée', 'advisory_questionnaire_version', newVersionId, `${questionnaire.stable_key} — depuis v${source.version_number}`);
  return { id: newVersionId };
}
