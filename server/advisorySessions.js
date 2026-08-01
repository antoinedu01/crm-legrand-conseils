// Service métier — sessions de conseil et réponses (Legrand Diagnostic 360,
// Lot 3A). Isolé de `server/routes/advisorySessions.js`, sur le même modèle
// que `server/advisoryHouseholds.js` (Lot 2).

import db from './db.js';
import { assert, isDateStr, inEnum, checkTextFields } from './validate.js';
import { audit } from './audit.js';
import { AdvisoryError, displayName } from './advisoryHouseholds.js';
import { evaluateCondition } from './advisoryConditions.js';
import { getVersionDetail } from './advisoryQuestionnaires.js';

export const SESSION_DOMAINS = ['health', 'life_pension', 'mixed'];
export const SESSION_STATUSES = ['draft', 'in_progress', 'suspended', 'completed', 'cancelled'];
export const LINK_DOMAINS = ['common', 'health', 'life_pension'];
export const MODULE_ROLES = ['core', 'domain'];
export const ANSWER_STATUSES = ['answered', 'unknown', 'not_applicable', 'cleared'];

// Machine d'état explicite, indexée par (statut courant, action) — jamais
// seulement par le statut cible. « draft → in_progress » (démarrage) et
// « suspended → in_progress » (reprise) partagent le même statut cible mais
// sont deux actions distinctes : indexer uniquement par statut cible
// permettrait à tort d'appeler « reprendre » sur une session en brouillon
// (jamais démarrée) — bug détecté et corrigé par un test dédié pendant le
// développement de ce lot. Toute transition hors de cette table est
// refusée avec une erreur métier claire (409).
const TRANSITIONS = {
  draft: { start: 'in_progress', cancel: 'cancelled' },
  in_progress: { suspend: 'suspended', complete: 'completed', cancel: 'cancelled' },
  suspended: { resume: 'in_progress', cancel: 'cancelled' },
  completed: {},
  cancelled: {},
};

function getSession(id) {
  return db.prepare('SELECT * FROM advisory_sessions WHERE id = ?').get(id);
}

function requireSession(id) {
  const session = getSession(id);
  if (!session) throw new AdvisoryError('Session introuvable.', 404);
  return session;
}

function getHousehold(id) {
  return db.prepare('SELECT * FROM households WHERE id = ?').get(id);
}

// Un foyer archivé est figé (server/advisoryHouseholds.js, GATE LOT 2) : plus
// aucune écriture n'est possible tant qu'il reste archivé. Une session créée
// avant l'archivage ne doit pas devenir un moyen détourné de continuer à
// produire de l'activité nouvelle (démarrage, reprise, finalisation,
// réponses, amendements, métadonnées) sur un foyer désormais figé — constat
// confirmé lors du GATE LOT 3A (aucun de ces appels ne vérifiait le statut du
// foyer). Les actions purement fermantes/réductrices (suspendre, annuler) et
// toute lecture restent volontairement autorisées : elles ne créent aucune
// donnée métier nouvelle et permettent de clôturer proprement une session
// orpheline plutôt que de la laisser bloquée sans issue.
function assertHouseholdWritable(householdId) {
  const household = getHousehold(householdId);
  if (household && household.status === 'archive') {
    throw new AdvisoryError('Ce foyer est archivé : aucune nouvelle activité n’est possible sur ses sessions.', 409);
  }
}

function assertTransition(session, action) {
  const next = (TRANSITIONS[session.status] || {})[action];
  if (!next) {
    throw new AdvisoryError(
      `Action « ${action} » impossible depuis le statut « ${session.status} ».`,
      409
    );
  }
  return next;
}

// Contrôle de concurrence optimiste (GATE LOT 3B §2) : toute écriture sur une
// session doit indiquer la révision qu'elle croit modifier. Un simple jeton
// qui ignore une réponse HTTP obsolète côté client ne protège pas la donnée
// persistée elle-même (la requête obsolète peut très bien avoir déjà écrit en
// base avant que sa réponse ne soit ignorée) — cette fonction est donc
// appelée AVANT toute écriture, jamais seulement pour filtrer une réponse
// après coup. Si la révision réelle a changé entre-temps (autre onglet,
// requête concurrente arrivée en premier), on refuse : aucune ligne n'est
// écrite, aucun audit de succès n'est produit, et l'appelant ne reçoit
// qu'une erreur 409 compréhensible.
function assertExpectedRevision(session, expectedRevision) {
  assert(Number.isInteger(expectedRevision), 'expected_revision est requis (entier).');
  if (expectedRevision !== session.revision) {
    throw new AdvisoryError(
      `Cette session a été modifiée ailleurs depuis votre dernière lecture (révision attendue ${expectedRevision}, révision réelle ${session.revision}). Rechargez le workspace avant de réessayer.`,
      409
    );
  }
}

// --- Lecture -----------------------------------------------------------

export function listSessions({ household_id, status, domain, from, to } = {}) {
  let sql = 'SELECT * FROM advisory_sessions WHERE 1=1';
  const params = [];
  if (household_id) { sql += ' AND household_id = ?'; params.push(household_id); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (domain) { sql += ' AND domain = ?'; params.push(domain); }
  if (from) { sql += ' AND (scheduled_at IS NULL OR scheduled_at >= ?)'; params.push(from); }
  if (to) { sql += ' AND (scheduled_at IS NULL OR scheduled_at <= ?)'; params.push(to); }
  sql += ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...params);
}

export function getSessionDetail(id) {
  const session = getSession(id);
  if (!session) return null;
  const links = db
    .prepare('SELECT * FROM advisory_session_questionnaires WHERE session_id = ? ORDER BY display_order')
    .all(id);
  const answerCount = db.prepare(
    "SELECT COUNT(*) AS n FROM advisory_answers WHERE session_id = ? AND superseded_by_answer_id IS NULL AND status = 'answered'"
  ).get(id).n;
  return { ...session, questionnaire_versions: links, answered_count: answerCount };
}

// --- Écriture : création --------------------------------------------------

function validateComposition(sessionDomain, entries) {
  assert(Array.isArray(entries) && entries.length > 0, 'Au moins une version de questionnaire est requise.');
  const byDomain = {};
  entries.forEach((e, i) => {
    assert(e.questionnaire_version_id, `questionnaire_versions[${i}].questionnaire_version_id est requis.`);
    assert(inEnum(e.domain, LINK_DOMAINS) && e.domain != null, `questionnaire_versions[${i}].domain inconnu.`);
    assert(inEnum(e.module_role, MODULE_ROLES) && e.module_role != null, `questionnaire_versions[${i}].module_role inconnu.`);
    const expectedRole = e.domain === 'common' ? 'core' : 'domain';
    assert(e.module_role === expectedRole, `questionnaire_versions[${i}].module_role incohérent avec le domaine « ${e.domain} ».`);
    assert(Number.isInteger(e.display_order), `questionnaire_versions[${i}].display_order doit être un entier.`);
    assert(!byDomain[e.domain], `Une session ne peut contenir qu'une seule version de domaine « ${e.domain} ».`);
    byDomain[e.domain] = e;
  });
  const orders = new Set(entries.map((e) => e.display_order));
  assert(orders.size === entries.length, 'display_order doit être unique pour chaque version rattachée.');

  if (sessionDomain === 'health') {
    assert(byDomain.health, 'Une session « health » doit contenir exactement une version de domaine health.');
    assert(!byDomain.life_pension, 'Une session « health » ne peut pas contenir de version life_pension.');
  } else if (sessionDomain === 'life_pension') {
    assert(byDomain.life_pension, 'Une session « life_pension » doit contenir exactement une version de domaine life_pension.');
    assert(!byDomain.health, 'Une session « life_pension » ne peut pas contenir de version health.');
  } else if (sessionDomain === 'mixed') {
    assert(byDomain.health, 'Une session « mixed » doit contenir une version health.');
    assert(byDomain.life_pension, 'Une session « mixed » doit contenir une version life_pension.');
  }
  return byDomain;
}

export function createSession(data = {}, req) {
  const { household_id, domain, questionnaire_versions, title, scheduled_at } = data;
  assert(household_id, 'Le foyer est requis.');
  const household = getHousehold(household_id);
  if (!household) throw new AdvisoryError('Foyer introuvable.', 400);
  if (household.status === 'archive') {
    throw new AdvisoryError('Ce foyer est archivé : aucune nouvelle session ne peut y être créée.', 409);
  }
  assert(inEnum(domain, SESSION_DOMAINS) && domain != null, 'Domaine de session inconnu.');
  assert(isDateStr(scheduled_at), 'Date prévue invalide (AAAA-MM-JJ).');
  checkTextFields({ title }, ['title'], 200);
  validateComposition(domain, questionnaire_versions || []);

  // Chaque version rattachée doit exister, être publiée, et son domaine
  // réel (celui du questionnaire parent) doit correspondre au domaine
  // déclaré dans le rattachement (contrainte applicative, même principe que
  // advisory_rules.domain dupliqué depuis son rule_set).
  const resolvedVersions = (questionnaire_versions || []).map((e) => {
    const version = db.prepare('SELECT * FROM advisory_questionnaire_versions WHERE id = ?').get(e.questionnaire_version_id);
    if (!version) throw new AdvisoryError(`Version de questionnaire introuvable (id ${e.questionnaire_version_id}).`, 400);
    if (version.status !== 'published') {
      throw new AdvisoryError('Seule une version publiée de questionnaire peut être rattachée à une session.', 409);
    }
    const questionnaire = db.prepare('SELECT * FROM advisory_questionnaires WHERE id = ?').get(version.questionnaire_id);
    assert(questionnaire.domain === e.domain, `Le domaine déclaré (« ${e.domain} ») ne correspond pas au questionnaire réel (« ${questionnaire.domain} »).`);
    return { ...e, version };
  });

  const email = req?.session?.userEmail;
  const advisorUserId = email ? db.prepare('SELECT id FROM users WHERE email = ?').get(email)?.id : null;
  assert(advisorUserId, 'Utilisateur authentifié introuvable.');

  const sessionId = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO advisory_sessions (household_id, advisor_user_id, domain, title, scheduled_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(household_id, advisorUserId, domain, title || null, scheduled_at || null);
    const id = info.lastInsertRowid;
    for (const e of resolvedVersions) {
      db.prepare(
        `INSERT INTO advisory_session_questionnaires (session_id, questionnaire_version_id, domain, module_role, display_order)
         VALUES (?, ?, ?, ?, ?)`
      ).run(id, e.questionnaire_version_id, e.domain, e.module_role, e.display_order);
    }
    return id;
  })();

  audit(req, 'session créée', 'advisory_session', sessionId, domain);
  return { id: sessionId };
}

export function updateSessionMetadata(id, data = {}, req) {
  const session = requireSession(id);
  assertHouseholdWritable(session.household_id);
  assertExpectedRevision(session, data.expected_revision);
  const { title, scheduled_at } = data;
  checkTextFields({ title }, ['title'], 200);
  assert(isDateStr(scheduled_at), 'Date prévue invalide (AAAA-MM-JJ).');
  const fields = [];
  const params = [];
  if ('title' in data) { fields.push('title = ?'); params.push(title || null); }
  if ('scheduled_at' in data) { fields.push('scheduled_at = ?'); params.push(scheduled_at || null); }
  if (fields.length === 0) return { ok: true, revision: session.revision };
  const newRevision = session.revision + 1;
  fields.push('revision = ?');
  params.push(newRevision);
  params.push(id);
  db.prepare(`UPDATE advisory_sessions SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params);
  // Jamais la valeur du titre (texte libre, potentiellement sensible) dans
  // l'audit — uniquement les noms des champs modifiés, même principe que
  // `modification client` (server/routes/clients.js) qui journalise
  // `fields.join(', ')`, jamais les valeurs (constat corrigé, revue
  // compliance-privacy-reviewer, Lot 3A).
  const changedFields = [];
  if ('title' in data) changedFields.push('title');
  if ('scheduled_at' in data) changedFields.push('scheduled_at');
  audit(req, 'session modifiée', 'advisory_session', id, changedFields.join(', '));
  return { ok: true, revision: newRevision };
}

// --- Transitions -----------------------------------------------------------

// Ordre explicite et déterministe (constat GATE LOT 4A §12, revue
// rules-engine-auditor) : sans `ORDER BY`, l'ordre renvoyé par SQLite pour
// cette requête n'est garanti par aucun contrat — il se trouve coïncider
// aujourd'hui avec l'ordre d'insertion, mais rien ne l'impose. Comme ce
// snapshot est ensuite relu tel quel par `sessionMembersFor` pour fournir
// `context.members` au moteur de règles (`server/advisoryRuleExecutions.js`),
// et que l'ordre des findings `finding_scope = member` doit être
// déterministe (§3.6), l'ordre est désormais imposé explicitement — même
// convention que `activeMembersFor` ci-dessous (principal en tête, puis id).
function buildHouseholdSnapshot(householdId) {
  const household = getHousehold(householdId);
  const members = db
    .prepare(
      `SELECT hm.id, hm.client_id, hm.member_role, hm.relationship_detail, hm.status
       FROM household_members hm WHERE hm.household_id = ?
       ORDER BY (hm.member_role = 'principal') DESC, hm.id`
    )
    .all(householdId);
  return JSON.stringify({ household_id: householdId, label: household.label, members });
}

export function startSession(id, expectedRevision, req) {
  const session = requireSession(id);
  assertHouseholdWritable(session.household_id);
  assertTransition(session, 'start');
  assertExpectedRevision(session, expectedRevision);
  const newRevision = session.revision + 1;
  const snapshot = buildHouseholdSnapshot(session.household_id);
  db.prepare(
    `UPDATE advisory_sessions SET status = 'in_progress', started_at = datetime('now'),
     last_activity_at = datetime('now'), household_snapshot = ?, revision = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(snapshot, newRevision, id);
  audit(req, 'session démarrée', 'advisory_session', id, '');
  return { ok: true, revision: newRevision };
}

export function suspendSession(id, expectedRevision, req) {
  const session = requireSession(id);
  assertTransition(session, 'suspend');
  assertExpectedRevision(session, expectedRevision);
  const newRevision = session.revision + 1;
  db.prepare(
    "UPDATE advisory_sessions SET status = 'suspended', suspended_at = datetime('now'), revision = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(newRevision, id);
  audit(req, 'session suspendue', 'advisory_session', id, '');
  return { ok: true, revision: newRevision };
}

export function resumeSession(id, expectedRevision, req) {
  const session = requireSession(id);
  assertHouseholdWritable(session.household_id);
  assertTransition(session, 'resume');
  assertExpectedRevision(session, expectedRevision);
  const newRevision = session.revision + 1;
  db.prepare(
    "UPDATE advisory_sessions SET status = 'in_progress', last_activity_at = datetime('now'), revision = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(newRevision, id);
  audit(req, 'session reprise', 'advisory_session', id, '');
  return { ok: true, revision: newRevision };
}

export function cancelSession(id, expectedRevision, req) {
  const session = requireSession(id);
  assertTransition(session, 'cancel');
  assertExpectedRevision(session, expectedRevision);
  const newRevision = session.revision + 1;
  db.prepare("UPDATE advisory_sessions SET status = 'cancelled', revision = ?, updated_at = datetime('now') WHERE id = ?").run(newRevision, id);
  audit(req, 'session annulée', 'advisory_session', id, '');
  return { ok: true, revision: newRevision };
}

export function completeSession(id, expectedRevision, req) {
  const session = requireSession(id);
  assertHouseholdWritable(session.household_id);
  assertTransition(session, 'complete');
  assertExpectedRevision(session, expectedRevision);
  const validation = validateSessionForCompletion(id);
  if (!validation.valid) {
    const err = new AdvisoryError('Des réponses obligatoires visibles sont manquantes ou invalides.', 409);
    err.missing = validation.byLink;
    throw err;
  }
  const newRevision = session.revision + 1;
  db.prepare(
    "UPDATE advisory_sessions SET status = 'completed', completed_at = datetime('now'), revision = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(newRevision, id);
  audit(req, 'session finalisée', 'advisory_session', id, '');
  return { ok: true, revision: newRevision };
}

// --- Validation de finalisation (deux niveaux) ------------------------------

function buildAnswerIndex(sessionId) {
  const rows = db
    .prepare('SELECT * FROM advisory_answers WHERE session_id = ? AND superseded_by_answer_id IS NULL')
    .all(sessionId);
  const index = new Map(); // key: `${question_id}|${household_member_id ?? 'household'}`
  for (const r of rows) {
    index.set(`${r.question_id}|${r.household_member_id ?? 'household'}`, r);
  }
  return index;
}

// Exportée (Lot 4A) : réutilisée telle quelle par `server/
// advisoryRuleExecutions.js` pour résoudre la valeur d'une réponse au
// moment de construire le contexte d'exécution du moteur de règles — jamais
// réimplémentée séparément, pour ne pas risquer de diverger sur la
// résolution des colonnes value_text/value_number/value_boolean/value_date/
// value_json.
export function answerValueFor(row) {
  if (!row) return undefined;
  if (row.value_text != null) return row.value_text;
  if (row.value_number != null) return row.value_number;
  if (row.value_boolean != null) return !!row.value_boolean;
  if (row.value_date != null) return row.value_date;
  if (row.value_json != null) return JSON.parse(row.value_json);
  return undefined;
}

// Validation par lien (une version rattachée à la session) — jamais de
// référence croisée entre versions (chaque display_condition ne peut
// référencer qu'une question de SA PROPRE version, décision explicite du
// Lot 3A limitant la complexité et garantissant le déterminisme).
function validateLinkForCompletion(session, link, answerIndex, activeMembers) {
  const detail = getVersionDetail(link.questionnaire_version_id);
  const byStableKey = new Map();
  for (const section of detail.sections) {
    for (const q of section.questions) byStableKey.set(q.stable_key, q);
  }
  function householdGetAnswer(stableKey) {
    const q = byStableKey.get(stableKey);
    if (!q) return undefined;
    const row = answerIndex.get(`${q.id}|household`);
    if (!row) return undefined;
    return { status: row.status, value: answerValueFor(row) };
  }
  function memberGetAnswer(memberId) {
    return (stableKey) => {
      const q = byStableKey.get(stableKey);
      if (!q) return undefined;
      const row = answerIndex.get(`${q.id}|${memberId}`);
      if (!row) return undefined;
      return { status: row.status, value: answerValueFor(row) };
    };
  }

  const missing = [];
  for (const section of detail.sections) {
    if (section.status !== 'active') continue;
    const sectionCondition = section.display_condition ? JSON.parse(section.display_condition) : null;
    const sectionVisible = evaluateCondition(sectionCondition, { session: { domain: session.domain }, getAnswer: householdGetAnswer, member: null });
    if (!sectionVisible) continue;

    if (section.applies_to === 'household') {
      for (const q of section.questions) {
        if (q.status !== 'active') continue;
        const cond = q.display_condition ? JSON.parse(q.display_condition) : null;
        const visible = evaluateCondition(cond, { session: { domain: session.domain }, getAnswer: householdGetAnswer, member: null });
        if (!visible || !q.required) continue;
        const row = answerIndex.get(`${q.id}|household`);
        if (!row || row.status === 'cleared') missing.push({ question_id: q.id, stable_key: q.stable_key });
      }
    } else {
      for (const member of activeMembers) {
        const getAnswer = memberGetAnswer(member.id);
        for (const q of section.questions) {
          if (q.status !== 'active') continue;
          const cond = q.display_condition ? JSON.parse(q.display_condition) : null;
          const visible = evaluateCondition(cond, { session: { domain: session.domain }, getAnswer, member: { member_role: member.member_role } });
          if (!visible || !q.required) continue;
          const row = answerIndex.get(`${q.id}|${member.id}`);
          if (!row || row.status === 'cleared') {
            missing.push({ question_id: q.id, stable_key: q.stable_key, household_member_id: member.id });
          }
        }
      }
    }
  }
  return missing;
}

export function validateSessionForCompletion(sessionId) {
  const session = requireSession(sessionId);
  const links = db
    .prepare('SELECT * FROM advisory_session_questionnaires WHERE session_id = ? ORDER BY display_order')
    .all(sessionId);
  // Périmètre figé (GATE LOT 3B §5) : mêmes membres que ceux affichés par
  // getSessionWorkspace, jamais recalculés séparément sur les membres vivants
  // -- y compris les membres historisés (`can_answer: false`), pour ne
  // jamais réduire silencieusement la portée d'une exigence déjà en vigueur
  // au démarrage simplement parce qu'un membre a été retiré depuis.
  const members = sessionMembersFor(session);
  const answerIndex = buildAnswerIndex(sessionId);

  const byLink = links.map((link) => ({
    domain: link.domain,
    questionnaire_version_id: link.questionnaire_version_id,
    missing: validateLinkForCompletion(session, link, answerIndex, members),
  }));
  const valid = byLink.every((l) => l.missing.length === 0);
  return { valid, byLink };
}

// --- Projection du workspace (Lot 3B) ---------------------------------------

function activeMembersFor(householdId) {
  return db
    .prepare(
      `SELECT hm.id, hm.client_id, hm.member_role, c.type, c.first_name, c.last_name, c.company_name
       FROM household_members hm JOIN clients c ON c.id = hm.client_id
       WHERE hm.household_id = ? AND hm.status = 'actif'
       ORDER BY (hm.member_role = 'principal') DESC, hm.id`
    )
    .all(householdId)
    .map((r) => ({ id: r.id, client_id: r.client_id, member_role: r.member_role, display_name: displayName(r) }));
}

// Résout les membres de RÉFÉRENCE d'une session (GATE LOT 3B §5, décision
// humaine remplaçant le choix initial du Lot 3B qui utilisait toujours les
// membres vivants). Une session encore `draft` (jamais démarrée) reflète les
// membres actuellement actifs, puisqu'aucun `household_snapshot` n'a encore
// été figé. Dès `in_progress` et pour toujours ensuite (suspended/completed/
// cancelled), le snapshot figé au démarrage devient la référence exclusive :
// - un membre ajouté au foyer après le démarrage n'apparaît jamais
//   rétroactivement dans cette session ;
// - un membre retiré depuis reste visible (jamais silencieusement
//   supprimé), marqué `historical`/`no_longer_active`, avec `can_answer:
//   false` -- son historique de réponses reste pleinement lisible, mais
//   aucune nouvelle réponse ne peut lui être associée ;
// - la validation de finalisation (`validateSessionForCompletion`) utilise
//   la MÊME liste, pour que ce qu'affiche le workspace corresponde toujours
//   exactement à ce que la finalisation validera réellement.
// Exportée (Lot 4A) : réutilisée telle quelle par `server/
// advisoryRuleExecutions.js` pour bâtir la liste de membres du contexte
// d'exécution (quantificateurs `all`/`any` du DSL de règles) — mêmes
// membres de référence, historisés inclus, que ceux affichés par le
// workspace et validés par `validateSessionForCompletion`, jamais une
// troisième résolution divergente des membres d'une session.
export function sessionMembersFor(session) {
  if (session.status === 'draft' || !session.household_snapshot) {
    return activeMembersFor(session.household_id).map((m) => ({
      ...m, historical: false, no_longer_active: false, current_status: 'actif', can_answer: true,
    }));
  }
  const snapshot = JSON.parse(session.household_snapshot);
  const liveStatusById = new Map(
    db.prepare('SELECT id, status FROM household_members WHERE household_id = ?').all(session.household_id)
      .map((r) => [r.id, r.status])
  );
  return snapshot.members.map((m) => {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(m.client_id) || {};
    const currentStatus = liveStatusById.get(m.id) ?? null; // null = supprimé entre-temps (rare)
    const stillActive = currentStatus === 'actif';
    return {
      id: m.id,
      client_id: m.client_id,
      member_role: m.member_role,
      display_name: displayName(client),
      historical: !stillActive,
      no_longer_active: !stillActive,
      current_status: currentStatus,
      can_answer: stillActive,
    };
  });
}

// Fenêtre de déduplication pour l'audit de consultation du workspace (GATE
// LOT 3B §6) : la projection est rechargée automatiquement après chaque
// écriture (§2), ce qui produirait des centaines de lignes d'audit
// quasi-identiques sans intérêt de traçabilité réel. Une seule action
// identique par utilisateur et par session sur cette fenêtre est conservée.
// Constante documentée, facilement modifiable ; aucune nouvelle table
// requise (réutilise `audit_log` existant). Politique à reconfirmer par le
// responsable protection des données avant toute mise en production avec
// des données réelles (voir SECURITY_PRIVACY.md).
const WORKSPACE_VIEW_DEDUP_MINUTES = 15;

// N'enregistre jamais de valeur de réponse, de texte de question, de montant,
// de date médicale, de détail de membre ni de condition JSON — uniquement
// l'identifiant de session, l'utilisateur, la révision et le statut.
function auditWorkspaceView(req, sessionId, revision, status) {
  const email = req?.session?.userEmail || 'système';
  const recent = db
    .prepare(
      `SELECT id FROM audit_log WHERE user_email = ? AND action = 'consultation workspace session'
       AND entity = 'advisory_session' AND entity_id = ? AND created_at >= datetime('now', ?)
       ORDER BY id DESC LIMIT 1`
    )
    .get(email, sessionId, `-${WORKSPACE_VIEW_DEDUP_MINUTES} minutes`);
  if (recent) return;
  audit(req, 'consultation workspace session', 'advisory_session', sessionId, `révision ${revision} — ${status}`);
}

// Dérivées directement de TRANSITIONS/assertSessionAcceptsAnswers — jamais
// une seconde source de vérité que le frontend pourrait laisser diverger de
// la machine d'état réelle (server/advisorySessions.js).
function allowedActions(status) {
  const acts = TRANSITIONS[status] || {};
  return {
    can_start: !!acts.start,
    can_suspend: !!acts.suspend,
    can_resume: !!acts.resume,
    can_cancel: !!acts.cancel,
    can_complete: !!acts.complete,
    can_record_answers: ['draft', 'in_progress'].includes(status),
    can_amend: status === 'completed',
  };
}

// Projection complète et prête à afficher d'une session, pour le workspace
// React du Lot 3B (GET /api/advisory/sessions/:id/workspace). Réutilise
// entièrement le moteur existant — `evaluateCondition`, `getVersionDetail`,
// `buildAnswerIndex`/`answerValueFor`, et le résultat déjà calculé de
// `validateSessionForCompletion` pour la détermination des éléments
// manquants — n'invente aucune nouvelle règle de visibilité, de validation
// de réponse, de portée ou de complétude. Reste volontairement une fonction
// SÉPARÉE de `validateLinkForCompletion` (Lot 3A, déjà testée et publiée)
// plutôt qu'une refactorisation en base commune : les deux réutilisent les
// mêmes briques pures (`evaluateCondition` au premier chef, jamais
// réimplémenté ailleurs), ce qui est le point de non-duplication réellement
// exigé — construire en plus l'arbre de rendu (options, aide, réponse
// courante par membre) est un besoin distinct de la simple liste des
// manques, qui n'a pas sa place dans la fonction de validation existante.
// Portée membre : résolue sur les membres ACTIFS EN BASE au moment de
// l'appel (comme `validateSessionForCompletion`), jamais sur
// `household_snapshot` figé au démarrage — pour que ce que le conseiller
// voit corresponde exactement à ce que `POST .../complete` validera
// réellement (incohérence potentielle sinon, relevée en revue
// d'architecture pré-implémentation).
export function getSessionWorkspace(sessionId, req) {
  const session = requireSession(sessionId);
  const household = getHousehold(session.household_id);
  if (!household) throw new AdvisoryError('Foyer introuvable.', 404);
  const members = sessionMembersFor(session);
  const links = db
    .prepare('SELECT * FROM advisory_session_questionnaires WHERE session_id = ? ORDER BY display_order')
    .all(sessionId);
  const answerIndex = buildAnswerIndex(sessionId);
  const completion = validateSessionForCompletion(sessionId);
  const missingByVersion = new Map(
    completion.byLink.map((l) => [l.questionnaire_version_id, new Set(l.missing.map((m) => `${m.question_id}|${m.household_member_id ?? 'household'}`))])
  );
  // Nombre total de lignes (actives + historisées) par clé — sert
  // uniquement à indiquer qu'un historique existe (`history_available`),
  // jamais à en dévoiler le contenu ici.
  const historyCounts = new Map(
    db
      .prepare('SELECT question_id, household_member_id, COUNT(*) AS n FROM advisory_answers WHERE session_id = ? GROUP BY question_id, household_member_id')
      .all(sessionId)
      .map((r) => [`${r.question_id}|${r.household_member_id ?? 'household'}`, r.n])
  );

  let globalRequiredTotal = 0;
  let globalRequiredAnswered = 0;

  const modules = links.map((link) => {
    const detail = getVersionDetail(link.questionnaire_version_id);
    const missingSet = missingByVersion.get(link.questionnaire_version_id) || new Set();
    const byStableKey = new Map();
    for (const section of detail.sections) for (const q of section.questions) byStableKey.set(q.stable_key, q);

    function householdGetAnswer(stableKey) {
      const q = byStableKey.get(stableKey);
      if (!q) return undefined;
      const row = answerIndex.get(`${q.id}|household`);
      if (!row) return undefined;
      return { status: row.status, value: answerValueFor(row) };
    }
    function memberGetAnswer(memberId) {
      return (stableKey) => {
        const q = byStableKey.get(stableKey);
        if (!q) return undefined;
        const row = answerIndex.get(`${q.id}|${memberId}`);
        if (!row) return undefined;
        return { status: row.status, value: answerValueFor(row) };
      };
    }

    let moduleRequiredTotal = 0;
    let moduleRequiredAnswered = 0;

    function projectQuestion(q, getAnswer, memberContext, memberId, sectionVisible) {
      if (q.status !== 'active') return null;
      const cond = q.display_condition ? JSON.parse(q.display_condition) : null;
      const visible = sectionVisible && evaluateCondition(cond, { session: { domain: session.domain }, getAnswer, member: memberContext });
      const key = `${q.id}|${memberId ?? 'household'}`;
      const row = memberId != null ? answerIndex.get(`${q.id}|${memberId}`) : answerIndex.get(`${q.id}|household`);
      const answer = row ? { status: row.status, value: answerValueFor(row) } : null;
      const missing = visible && q.required && missingSet.has(key);
      if (visible && q.required) {
        moduleRequiredTotal += 1;
        globalRequiredTotal += 1;
        if (!missing) { moduleRequiredAnswered += 1; globalRequiredAnswered += 1; }
      }
      return {
        id: q.id,
        stable_key: q.stable_key,
        advisor_text: q.advisor_text,
        client_text: q.client_text,
        help_text: q.help_text,
        type: q.type,
        scope: q.scope,
        required: !!q.required,
        allows_unknown: !!q.allows_unknown,
        allows_not_applicable: !!q.allows_not_applicable,
        sensitive: !!q.sensitive,
        sort_order: q.sort_order,
        options: (q.options || []).map((o) => ({ stable_key: o.stable_key, label: o.label, value: o.value, sort_order: o.sort_order, status: o.status })),
        household_member_id: memberId ?? null,
        visible,
        answer,
        missing,
        history_available: (historyCounts.get(key) || 0) > 1,
      };
    }

    const sections = [];
    for (const section of detail.sections) {
      if (section.status !== 'active') continue;
      const sectionCondition = section.display_condition ? JSON.parse(section.display_condition) : null;
      const sectionVisible = evaluateCondition(sectionCondition, { session: { domain: session.domain }, getAnswer: householdGetAnswer, member: null });

      let instances;
      if (section.applies_to === 'household') {
        const questions = section.questions.map((q) => projectQuestion(q, householdGetAnswer, null, null, sectionVisible)).filter(Boolean);
        instances = [{ household_member_id: null, member: null, questions }];
      } else {
        instances = members.map((member) => ({
          household_member_id: member.id,
          member: {
            id: member.id,
            display_name: member.display_name,
            member_role: member.member_role,
            historical: member.historical,
            no_longer_active: member.no_longer_active,
            current_status: member.current_status,
            can_answer: member.can_answer,
          },
          questions: section.questions
            .map((q) => projectQuestion(q, memberGetAnswer(member.id), { member_role: member.member_role }, member.id, sectionVisible))
            .filter(Boolean),
        }));
      }
      sections.push({
        stable_key: section.stable_key,
        title: section.title,
        applies_to: section.applies_to,
        sort_order: section.sort_order,
        visible: sectionVisible,
        instances,
      });
    }

    return {
      domain: link.domain,
      module_role: link.module_role,
      questionnaire_version_id: link.questionnaire_version_id,
      display_order: link.display_order,
      progress: { required_total: moduleRequiredTotal, required_answered: moduleRequiredAnswered },
      sections,
    };
  });

  const advisor = db.prepare('SELECT name FROM users WHERE id = ?').get(session.advisor_user_id);
  const primaryClient = db.prepare('SELECT * FROM clients WHERE id = ?').get(household.primary_client_id);

  auditWorkspaceView(req, sessionId, session.revision, session.status);

  return {
    session: {
      id: session.id,
      status: session.status,
      domain: session.domain,
      title: session.title,
      scheduled_at: session.scheduled_at,
      started_at: session.started_at,
      suspended_at: session.suspended_at,
      completed_at: session.completed_at,
      last_activity_at: session.last_activity_at,
      revision: session.revision,
      advisor_name: advisor ? advisor.name : null,
    },
    household: {
      id: household.id,
      label: household.label,
      primary_display_name: displayName(primaryClient),
      status: household.status,
      members,
    },
    progress: { required_total: globalRequiredTotal, required_answered: globalRequiredAnswered, complete: completion.valid },
    modules,
    missing: completion.byLink,
    actions: allowedActions(session.status),
  };
}

// --- Réponses ----------------------------------------------------------

// « suspended » exclu délibérément (GATE LOT 3B §4, décision humaine) : une
// session suspendue est réellement mise en pause -- elle reste lisible,
// consultable, annulable et reprenable, mais n'accepte plus aucune nouvelle
// réponse tant que « resume » n'a pas été appelé explicitement. Avant cette
// décision, une session suspendue acceptait encore des réponses (LOT 3A),
// ce qui contredisait la sémantique attendue d'une pause.
function assertSessionAcceptsAnswers(session) {
  if (!['draft', 'in_progress'].includes(session.status)) {
    throw new AdvisoryError(
      `Aucune réponse ne peut être enregistrée sur une session « ${session.status} ».`,
      409
    );
  }
  assertHouseholdWritable(session.household_id);
}

// Un membre historisé (retiré du foyer depuis le démarrage de la session,
// GATE LOT 3B §5) ne doit plus recevoir de NOUVELLE réponse -- son historique
// reste lisible, mais la saisie active se limite aux membres réellement
// actifs aujourd'hui. Ne s'applique jamais à l'amendement (correction d'un
// enregistrement historique, valide indépendamment du statut actuel du
// membre).
function assertMemberCanAnswer(householdMemberId) {
  if (householdMemberId == null) return;
  const member = db.prepare('SELECT status FROM household_members WHERE id = ?').get(householdMemberId);
  if (!member || member.status !== 'actif') {
    throw new AdvisoryError('Ce membre n’est plus actif dans le foyer : aucune nouvelle réponse ne peut lui être associée.', 409);
  }
}

function getQuestionForSession(sessionId, questionId) {
  const question = db.prepare('SELECT * FROM advisory_questions WHERE id = ?').get(questionId);
  if (!question) throw new AdvisoryError('Question introuvable.', 400);
  const link = db
    .prepare('SELECT id FROM advisory_session_questionnaires WHERE session_id = ? AND questionnaire_version_id = ?')
    .get(sessionId, question.questionnaire_version_id);
  if (!link) throw new AdvisoryError('Cette question n’appartient à aucune version rattachée à cette session.', 400);
  return question;
}

// Invariant de confidentialité critique (revue compliance-privacy-reviewer,
// Lot 3A) : un membre référencé dans une réponse doit appartenir au MÊME
// foyer que la session — jamais un membre d'un autre foyer, même si ce
// household_member_id existe bel et bien en base. Même principe que
// `assertLegalRepresentativeValid` (server/advisoryHouseholds.js).
function assertMemberBelongsToSession(session, householdMemberId) {
  if (householdMemberId == null) return;
  const member = db.prepare('SELECT * FROM household_members WHERE id = ?').get(householdMemberId);
  assert(member && member.household_id === session.household_id, 'Ce membre n’appartient pas au foyer de cette session.');
}

const TEXT_TYPES = { text: 200, long_text: 5000 };

function validateAnswerValue(question, status, value) {
  assert(inEnum(status, ANSWER_STATUSES) && status != null, 'Statut de réponse inconnu.');
  if (status === 'unknown') {
    assert(question.allows_unknown, 'Cette question n’autorise pas la réponse « inconnue ».');
  }
  // allows_not_applicable : distinct de allows_unknown, désactivé par défaut
  // (correctif final GATE LOT 3A) — sans ce contrôle, « not_applicable »
  // pouvait satisfaire n'importe quelle question obligatoire sans que le
  // concepteur du questionnaire ne l'ait jamais autorisé.
  if (status === 'not_applicable') {
    assert(question.allows_not_applicable, 'Cette question n’autorise pas la réponse « non applicable ».');
  }
  if (status !== 'answered') {
    assert(value == null, `Aucune valeur ne doit être fournie pour le statut « ${status} ».`);
    return {};
  }
  assert(value != null, 'Une valeur est requise pour le statut « answered ».');
  const rule = question.validation_rule ? JSON.parse(question.validation_rule) : {};
  switch (question.type) {
    case 'text':
    case 'long_text': {
      assert(typeof value === 'string' && value.length > 0, 'Valeur texte invalide.');
      const max = rule.max_length || TEXT_TYPES[question.type];
      assert(value.length <= max, `Le texte dépasse la longueur maximale (${max} caractères).`);
      return { value_text: value };
    }
    case 'integer': {
      assert(Number.isInteger(value), 'Valeur entière invalide.');
      if (rule.min != null) assert(value >= rule.min, `Valeur inférieure au minimum (${rule.min}).`);
      if (rule.max != null) assert(value <= rule.max, `Valeur supérieure au maximum (${rule.max}).`);
      return { value_number: value };
    }
    case 'decimal':
    case 'money': {
      assert(typeof value === 'number' && Number.isFinite(value), 'Valeur numérique invalide.');
      if (rule.min != null) assert(value >= rule.min, `Valeur inférieure au minimum (${rule.min}).`);
      if (rule.max != null) assert(value <= rule.max, `Valeur supérieure au maximum (${rule.max}).`);
      return { value_number: value };
    }
    case 'date': {
      assert(isDateStr(value) && value, 'Date invalide (AAAA-MM-JJ).');
      return { value_date: value };
    }
    case 'boolean': {
      assert(typeof value === 'boolean', 'Valeur booléenne invalide.');
      return { value_boolean: value ? 1 : 0 };
    }
    case 'single_choice': {
      const option = db
        .prepare("SELECT * FROM advisory_question_options WHERE question_id = ? AND value = ? AND status = 'active'")
        .get(question.id, String(value));
      assert(option, 'Option inconnue ou inactive pour cette question.');
      return { value_text: String(value) };
    }
    case 'multiple_choice': {
      assert(Array.isArray(value) && value.length > 0, 'Une liste de valeurs est requise pour un choix multiple.');
      const unique = new Set(value.map(String));
      assert(unique.size === value.length, 'Doublon interdit dans un choix multiple.');
      for (const v of unique) {
        const option = db
          .prepare("SELECT * FROM advisory_question_options WHERE question_id = ? AND value = ? AND status = 'active'")
          .get(question.id, v);
        assert(option, `Option inconnue ou inactive : « ${v} ».`);
      }
      return { value_json: JSON.stringify([...unique]) };
    }
    default:
      throw new AdvisoryError('Type de question non pris en charge.', 400);
  }
}

// SQLite vérifie les contraintes UNIQUE (y compris les index partiels)
// immédiatement à chaque instruction, jamais différées à la validation
// (COMMIT) — insérer la nouvelle ligne active avant d'avoir retiré
// l'ancienne violerait donc transitoirement l'unicité (les deux lignes
// auraient `superseded_by_answer_id IS NULL` en même temps). On retire
// d'abord l'ancienne ligne avec une référence temporaire à elle-même (seul
// identifiant déjà connu), puis on la corrige avec le véritable identifiant
// une fois la nouvelle ligne insérée — vérifié par un test de bout en bout
// (l'ordre naïf « insérer puis retirer » a été détecté en échec pendant le
// développement de ce lot).
function retireActiveAnswer(existing) {
  if (!existing) return;
  db.prepare('UPDATE advisory_answers SET superseded_by_answer_id = ? WHERE id = ?').run(existing.id, existing.id);
}

function findActiveAnswerRow(sessionId, questionId, householdMemberId) {
  if (householdMemberId != null) {
    return db
      .prepare(
        `SELECT * FROM advisory_answers WHERE session_id = ? AND question_id = ? AND household_member_id = ?
         AND superseded_by_answer_id IS NULL`
      )
      .get(sessionId, questionId, householdMemberId);
  }
  return db
    .prepare(
      `SELECT * FROM advisory_answers WHERE session_id = ? AND question_id = ? AND household_member_id IS NULL
       AND superseded_by_answer_id IS NULL`
    )
    .get(sessionId, questionId);
}

// Écriture par lot (§8.3) — chaque entrée insère toujours une nouvelle
// ligne et rattache l'ancienne active via superseded_by_answer_id, jamais
// d'écrasement. Une seule incrémentation de `revision` par appel (pas par
// réponse individuelle du lot).
export function recordAnswers(sessionId, answers = [], expectedRevision, req) {
  const session = requireSession(sessionId);
  assertSessionAcceptsAnswers(session);
  assertExpectedRevision(session, expectedRevision);
  assert(Array.isArray(answers) && answers.length > 0, 'Au moins une réponse est requise.');

  let created = 0;
  let replaced = 0;
  const results = db.transaction(() => {
    const newRevision = session.revision + 1;
    const out = [];
    for (const entry of answers) {
      const { question_id, household_member_id, status, value } = entry;
      const question = getQuestionForSession(sessionId, question_id);
      assertMemberBelongsToSession(session, household_member_id ?? null);
      assertMemberCanAnswer(household_member_id ?? null);
      if (question.scope === 'member') {
        assert(household_member_id != null, 'household_member_id est requis pour une question de portée « member ».');
      } else {
        assert(household_member_id == null, 'household_member_id ne doit pas être fourni pour cette portée de question.');
      }
      const typed = validateAnswerValue(question, status, value);
      const existing = findActiveAnswerRow(sessionId, question_id, household_member_id ?? null);
      retireActiveAnswer(existing);
      const info = db
        .prepare(
          `INSERT INTO advisory_answers
            (session_id, question_id, household_member_id, status, value_text, value_number, value_boolean, value_date, value_json, revision, answered_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          sessionId, question_id, household_member_id ?? null, status,
          typed.value_text ?? null, typed.value_number ?? null, typed.value_boolean ?? null, typed.value_date ?? null, typed.value_json ?? null,
          newRevision, session.advisor_user_id
        );
      if (existing) {
        db.prepare('UPDATE advisory_answers SET superseded_by_answer_id = ? WHERE id = ?').run(info.lastInsertRowid, existing.id);
        replaced += 1;
      } else {
        created += 1;
      }
      out.push({ id: info.lastInsertRowid, question_id, household_member_id: household_member_id ?? null });
    }
    db.prepare(
      "UPDATE advisory_sessions SET revision = ?, last_activity_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(newRevision, sessionId);
    return out;
  })();

  if (created > 0) audit(req, 'réponse enregistrée', 'advisory_session', sessionId, `${created} nouvelle(s)`);
  if (replaced > 0) audit(req, 'réponse remplacée', 'advisory_session', sessionId, `${replaced} remplacée(s)`);
  return { answers: results, revision: session.revision + 1 };
}

export function clearAnswer(sessionId, questionId, householdMemberId, expectedRevision, req) {
  const session = requireSession(sessionId);
  assertSessionAcceptsAnswers(session);
  assertExpectedRevision(session, expectedRevision);
  getQuestionForSession(sessionId, questionId);
  assertMemberBelongsToSession(session, householdMemberId ?? null);
  assertMemberCanAnswer(householdMemberId ?? null);
  const existing = findActiveAnswerRow(sessionId, questionId, householdMemberId ?? null);
  const newRevision = session.revision + 1;
  const answerId = db.transaction(() => {
    retireActiveAnswer(existing);
    const info = db
      .prepare(
        `INSERT INTO advisory_answers (session_id, question_id, household_member_id, status, revision, answered_by_user_id)
         VALUES (?, ?, ?, 'cleared', ?, ?)`
      )
      .run(sessionId, questionId, householdMemberId ?? null, newRevision, session.advisor_user_id);
    if (existing) db.prepare('UPDATE advisory_answers SET superseded_by_answer_id = ? WHERE id = ?').run(info.lastInsertRowid, existing.id);
    db.prepare(
      "UPDATE advisory_sessions SET revision = ?, last_activity_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(newRevision, sessionId);
    return info.lastInsertRowid;
  })();
  audit(req, 'réponse effacée', 'advisory_session', sessionId, `question #${questionId}`);
  return { id: answerId, revision: newRevision };
}

// Amendement après finalisation (§8.4) — seule route pouvant modifier une
// session déjà `completed`. Motif obligatoire, jamais de retour en arrière
// du statut de la session. Contrairement à recordAnswers/clearAnswer,
// n'appelle jamais assertMemberCanAnswer : corriger un enregistrement
// historique reste valide même si le membre concerné n'est plus actif
// aujourd'hui (GATE LOT 3B §5).
export function amendAnswer(sessionId, { question_id, household_member_id, status, value, amendment_reason, expected_revision } = {}, req) {
  const session = requireSession(sessionId);
  if (session.status !== 'completed') {
    throw new AdvisoryError('L’amendement n’est possible que sur une session finalisée (utilisez l’enregistrement normal sinon).', 409);
  }
  assertHouseholdWritable(session.household_id);
  assertExpectedRevision(session, expected_revision);
  assert(amendment_reason && amendment_reason.trim(), 'Le motif de correction est obligatoire.');
  checkTextFields({ amendment_reason }, ['amendment_reason'], 2000);
  const question = getQuestionForSession(sessionId, question_id);
  assertMemberBelongsToSession(session, household_member_id ?? null);
  const typed = validateAnswerValue(question, status, value);
  const existing = findActiveAnswerRow(sessionId, question_id, household_member_id ?? null);
  const newRevision = session.revision + 1;

  const answerId = db.transaction(() => {
    retireActiveAnswer(existing);
    const info = db
      .prepare(
        `INSERT INTO advisory_answers
          (session_id, question_id, household_member_id, status, value_text, value_number, value_boolean, value_date, value_json,
           is_amendment, amendment_reason, revision, answered_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .run(
        sessionId, question_id, household_member_id ?? null, status,
        typed.value_text ?? null, typed.value_number ?? null, typed.value_boolean ?? null, typed.value_date ?? null, typed.value_json ?? null,
        amendment_reason, newRevision, session.advisor_user_id
      );
    if (existing) db.prepare('UPDATE advisory_answers SET superseded_by_answer_id = ? WHERE id = ?').run(info.lastInsertRowid, existing.id);
    db.prepare("UPDATE advisory_sessions SET revision = ?, updated_at = datetime('now') WHERE id = ?").run(newRevision, sessionId);
    return info.lastInsertRowid;
  })();
  audit(req, 'réponse amendée', 'advisory_session', sessionId, `question #${question_id}`);
  return { id: answerId, revision: newRevision };
}

export function listActiveAnswers(sessionId) {
  requireSession(sessionId);
  return db
    .prepare('SELECT * FROM advisory_answers WHERE session_id = ? AND superseded_by_answer_id IS NULL ORDER BY id')
    .all(sessionId)
    .map((r) => ({ ...r, value: answerValueFor(r) }));
}

export function listAnswerHistory(sessionId, questionId, householdMemberId, req) {
  requireSession(sessionId);
  audit(
    req, 'consultation historique réponse', 'advisory_session', sessionId,
    `question #${questionId}${householdMemberId != null ? ` — membre #${householdMemberId}` : ''}`
  );
  let sql = 'SELECT * FROM advisory_answers WHERE session_id = ? AND question_id = ?';
  const params = [sessionId, questionId];
  if (householdMemberId != null) {
    sql += ' AND household_member_id = ?';
    params.push(householdMemberId);
  } else {
    sql += ' AND household_member_id IS NULL';
  }
  sql += ' ORDER BY created_at, id';
  return db.prepare(sql).all(...params).map((r) => ({ ...r, value: answerValueFor(r) }));
}
