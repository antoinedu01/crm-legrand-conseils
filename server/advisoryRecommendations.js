// Service métier — recommandations humaines génériques (Legrand Diagnostic
// 360, Lot 7A). Isolé de `server/advisoryRules.js`/`server/
// advisoryRuleExecutions.js` exactement comme ces deux modules sont isolés
// l'un de l'autre : ce module ne modifie JAMAIS `advisory_rule_sets`/
// `advisory_rules`/`advisory_rule_executions`/`advisory_findings` — il les
// LIT uniquement, pour justifier une recommandation créée par un humain.
// Aucune fonction de ce fichier ne peut être atteinte depuis le moteur de
// règles (aucun import réciproque) : une recommandation est TOUJOURS créée
// par une route authentifiée appelée par un conseiller, jamais par
// `executeRuleSetForSession`/`executeApplicableRuleSetsForSession`/
// `dismissFinding`.

import db from './db.js';
import { assert, inEnum } from './validate.js';
import { audit } from './audit.js';
import { AdvisoryError } from './advisoryHouseholds.js';
import { sessionMembersFor } from './advisorySessions.js';

export const RECOMMENDATION_DOMAINS = ['common', 'health', 'life_pension'];
export const RECOMMENDATION_SCOPES = ['session', 'household', 'member'];
export const RECOMMENDATION_STATUSES = ['draft', 'validated', 'dismissed', 'superseded', 'withdrawn'];

// Machine d'état stricte, une seule direction par action — même convention
// que TRANSITIONS dans server/advisorySessions.js. `superseded` n'a
// volontairement AUCUNE action directe : ce n'est jamais qu'une conséquence
// dérivée de la validation atomique d'un remplacement (voir
// validateRecommendation ci-dessous), jamais une route à part.
const TRANSITIONS = {
  draft: { validate: 'validated', dismiss: 'dismissed' },
  validated: { withdraw: 'withdrawn' },
  dismissed: {},
  superseded: {},
  withdrawn: {},
};

const NARRATIVE_FIELDS = [
  'title', 'summary', 'advisor_rationale', 'expected_benefits', 'limitations', 'risks',
  'alternatives_considered', 'alternative_rejection_reason', 'missing_information', 'warnings', 'reservations',
];
const FLAG_FIELDS = ['no_alternatives_identified', 'no_additional_risks_identified', 'no_missing_information_known'];

function nonEmpty(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function toFlag(v) {
  return v ? 1 : 0;
}

// --- Lecture bas niveau -------------------------------------------------

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

function getRecommendation(id) {
  return db.prepare('SELECT * FROM advisory_recommendations WHERE id = ?').get(id);
}

// Même principe anti-IDOR que `getExecutionDetail`/`dismissFinding` (Lot
// 4A) : jamais un identifiant technique consultable indépendamment de son
// rattachement réel à la session demandée dans l'URL, même si la ligne
// existe bel et bien en base sous un autre `session_id`.
function requireRecommendationForSession(sessionId, recId) {
  const rec = getRecommendation(recId);
  if (!rec || rec.session_id !== Number(sessionId)) throw new AdvisoryError('Recommandation introuvable pour cette session.', 404);
  return rec;
}

// Utilisée par les routes adressées directement par id de recommandation
// (`/api/advisory/recommendations/:id/...`, sans session dans l'URL) pour
// dériver le `session_id` réel AVANT d'appeler les fonctions de service
// ci-dessous, qui re-vérifient ensuite systématiquement ce rattachement
// (défense en profondeur, même garantie IDOR quelle que soit la route
// d'entrée). Retourne `null` si la recommandation n'existe pas — jamais
// d'exception ici, c'est à l'appelant (route HTTP) de traduire en 404.
export function findRecommendationSessionId(recId) {
  const rec = getRecommendation(recId);
  return rec ? rec.session_id : null;
}

function currentUserId(req) {
  const email = req?.session?.userEmail;
  return email ? db.prepare('SELECT id FROM users WHERE email = ?').get(email)?.id || null : null;
}

// --- Gardes communes ------------------------------------------------------

// Une recommandation ne peut être créée ou modifiée que sur une session déjà
// `completed` (recommandation forte de la revue préalable advisory-architect,
// LOT 7A) : une session `draft`/`in_progress`/`suspended` peut encore être
// `cancel`-ée, ce qui laisserait une recommandation orpheline sur une session
// jamais menée à terme — la même garantie structurelle que celle qui
// s'applique déjà aux findings (`ELIGIBLE_SESSION_STATUSES`, Lot 4A) : un
// finding ne peut, par construction, exister que sur une session `completed`.
function assertSessionWritable(session, household) {
  if (session.status !== 'completed') {
    throw new AdvisoryError(
      `Aucune recommandation ne peut être créée ou modifiée sur une session « ${session.status} » (seule une session finalisée le permet).`,
      409
    );
  }
  if (household && household.status === 'archive') {
    throw new AdvisoryError('Ce foyer est archivé : aucune nouvelle activité n’est possible sur ses sessions.', 409);
  }
}

// Verrou de concurrence optimiste PROPRE à la ligne recommandation (grain
// nouveau dans ce dépôt, distinct de `advisory_sessions.revision` — décision
// humaine explicite, cadrage LOT 7A §6/§9 : `session.revision` seul ne sert
// jamais de verrou pour les écritures sur un brouillon de recommandation).
function assertExpectedRecommendationRevision(recommendation, expectedRevision) {
  assert(Number.isInteger(expectedRevision), 'expected_recommendation_revision est requis (entier).');
  if (expectedRevision !== recommendation.revision) {
    throw new AdvisoryError(
      `Cette recommandation a été modifiée ailleurs depuis votre dernière lecture (révision attendue ${expectedRevision}, révision réelle ${recommendation.revision}). Rechargez avant de réessayer.`,
      409
    );
  }
}

function assertExpectedSessionRevision(session, expectedRevision) {
  assert(Number.isInteger(expectedRevision), 'expected_session_revision est requis (entier).');
  if (expectedRevision !== session.revision) {
    throw new AdvisoryError(
      `Cette session a été modifiée ailleurs depuis votre dernière lecture (révision attendue ${expectedRevision}, révision réelle ${session.revision}). Rechargez avant de réessayer.`,
      409
    );
  }
}

function assertAction(recommendation, action) {
  const next = (TRANSITIONS[recommendation.status] || {})[action];
  if (!next) {
    throw new AdvisoryError(`Action « ${action} » impossible depuis le statut « ${recommendation.status} ».`, 409);
  }
  return next;
}

// Seul un brouillon reste mutable (contenu narratif, portée, membres,
// findings liés) — une fois `validated`, la ligne est intégralement
// immuable pour ces aspects ; seules les transitions contrôlées (withdraw,
// bascule vers superseded) peuvent encore toucher au statut et à la
// révision (jamais au contenu narratif).
function assertDraftMutable(recommendation) {
  if (recommendation.status !== 'draft') {
    throw new AdvisoryError(`Cette recommandation n'est plus modifiable (statut « ${recommendation.status} »).`, 409);
  }
}

// --- Validation des entrées narratives ------------------------------------

function assertNarrativeCoherence(fields) {
  if (fields.no_alternatives_identified && (nonEmpty(fields.alternatives_considered) || nonEmpty(fields.alternative_rejection_reason))) {
    throw new AdvisoryError('« Aucune alternative identifiée » est incompatible avec un texte renseigné dans les champs alternatives.', 400);
  }
  if (fields.no_additional_risks_identified && nonEmpty(fields.risks)) {
    throw new AdvisoryError('« Aucun risque complémentaire identifié » est incompatible avec un texte renseigné dans « risks ».', 400);
  }
  if (fields.no_missing_information_known && nonEmpty(fields.missing_information)) {
    throw new AdvisoryError('« Aucune information manquante connue » est incompatible avec un texte renseigné dans « missing_information ».', 400);
  }
}

// --- Cohérence portée / membres / findings --------------------------------

function assertValidScopeAndMembers(scope, memberIds) {
  assert(inEnum(scope, RECOMMENDATION_SCOPES) && scope != null, `scope doit être l'une des valeurs : ${RECOMMENDATION_SCOPES.join(', ')}.`);
  const ids = Array.isArray(memberIds) ? memberIds : [];
  if (scope === 'member') {
    assert(ids.length > 0, 'scope = member exige au moins un membre ciblé (member_ids).');
  } else {
    assert(ids.length === 0, `scope = ${scope} n'accepte aucun membre ciblé (member_ids doit être explicitement vide).`);
  }
  return ids;
}

function assertMembersInSnapshot(session, memberIds) {
  const valid = new Set(sessionMembersFor(session).map((m) => m.id));
  for (const id of memberIds) {
    assert(valid.has(Number(id)), `Le membre #${id} n'appartient pas au périmètre figé de cette session.`);
  }
}

// Une référence de finding de portée `member`, liée à une recommandation
// `scope = member`, doit concerner l'un des membres explicitement ciblés
// (jamais un finding individuel concernant une autre personne que celles
// visées par la recommandation -- cas interdit explicite : recommandation
// pour Alice citant un finding sur Bob). Les findings `household`/`session`
// restent toujours autorisés, quelle que soit la portée. Prend en paramètre
// l'ensemble des membres qui SERONT liés après l'opération en cours (jamais
// l'état déjà persistant seul), pour ne jamais valider un état intermédiaire
// transitoire incohérent.
function assertFindingMemberCoherence(scope, memberIdsAfter, findingRows) {
  if (scope !== 'member') return;
  const targeted = new Set(memberIdsAfter.map(Number));
  for (const f of findingRows) {
    if (f.finding_scope === 'member' && !targeted.has(f.household_member_id)) {
      throw new AdvisoryError(
        `Le finding #${f.id} concerne un membre non ciblé par cette recommandation (portée « member » incohérente).`,
        409
      );
    }
  }
}

function currentLinkedFindingRows(recId) {
  return db
    .prepare(
      `SELECT f.* FROM advisory_findings f
       JOIN advisory_recommendation_findings link ON link.finding_id = f.id
       WHERE link.recommendation_id = ?`
    )
    .all(recId);
}

function currentLinkedMemberIds(recId) {
  return db.prepare('SELECT household_member_id FROM advisory_recommendation_members WHERE recommendation_id = ?').all(recId).map((r) => r.household_member_id);
}

// --- Findings : lecture et cohérence de domaine ---------------------------

function getFinding(id) {
  return db.prepare('SELECT * FROM advisory_findings WHERE id = ?').get(id);
}

function requireFindingForRecommendation(sessionId, domain, findingId) {
  const finding = getFinding(findingId);
  if (!finding || finding.session_id !== Number(sessionId)) {
    throw new AdvisoryError('Finding introuvable pour cette session.', 404);
  }
  if (finding.domain !== domain) {
    throw new AdvisoryError(
      `Ce finding appartient au domaine « ${finding.domain} », incompatible avec le domaine « ${domain} » de la recommandation.`,
      409
    );
  }
  return finding;
}

function findingSensitivityFlag(findingRow) {
  if (!findingRow.used_inputs_ref) return false;
  const refs = JSON.parse(findingRow.used_inputs_ref);
  return refs.some((ref) => ref.kind === 'answer' && ref.sensitivity_at_execution === true);
}

// --- Audit : consultation, avec déduplication (même politique que
// `consultation espace constats session`, fenêtre distincte) -------------

const RECOMMENDATIONS_VIEW_DEDUP_MINUTES = 15;

function auditRecommendationsViewIfNeeded(req, sessionId) {
  const email = req?.session?.userEmail || 'système';
  const recent = db
    .prepare(
      `SELECT id FROM audit_log WHERE user_email = ? AND action = 'consultation recommandations session'
       AND entity = 'advisory_session' AND entity_id = ? AND created_at >= datetime('now', ?) ORDER BY id DESC LIMIT 1`
    )
    .get(email, sessionId, `-${RECOMMENDATIONS_VIEW_DEDUP_MINUTES} minutes`);
  if (!recent) audit(req, 'consultation recommandations session', 'advisory_session', sessionId, null);
}

function auditSensitiveRecommendationsViewIfNeeded(req, sessionId, hasSensitive) {
  if (!hasSensitive) return;
  const email = req?.session?.userEmail || 'système';
  const recent = db
    .prepare(
      `SELECT id FROM audit_log WHERE user_email = ? AND action = 'consultation recommandations sensibles'
       AND entity = 'advisory_session' AND entity_id = ? AND created_at >= datetime('now', ?) ORDER BY id DESC LIMIT 1`
    )
    .get(email, sessionId, `-${RECOMMENDATIONS_VIEW_DEDUP_MINUTES} minutes`);
  if (!recent) audit(req, 'consultation recommandations sensibles', 'advisory_session', sessionId, null);
}

// Une recommandation citant, même indirectement, un finding dont la
// sensibilité a été figée à l'exécution reste sensible quel que soit le
// statut COURANT de ce finding (actif, écarté, supersédé) -- la sensibilité
// est une propriété historique de la donnée effectivement consultée à
// l'exécution, jamais réévaluée (même principe que Lot 4A §4, revue
// compliance-privacy-reviewer, cadrage LOT 7A préalable).
function recommendationHasSensitiveFinding(recId) {
  return currentLinkedFindingRows(recId).some(findingSensitivityFlag);
}

// --- Obsolescence dérivée (jamais stockée) --------------------------------

function getExecution(id) {
  return db.prepare('SELECT * FROM advisory_rule_executions WHERE id = ?').get(id);
}

// `potentially_stale` : calculé exclusivement à la lecture, jamais une
// colonne stockée -- signale qu'une recommandation validated/withdrawn/
// superseded s'appuie potentiellement sur des données depuis modifiées.
// Une recommandation encore `draft`/`dismissed` n'a pas de notion
// d'obsolescence (jamais validée, rien à comparer).
function computeStaleness(recommendation, session) {
  if (!['validated', 'withdrawn', 'superseded'].includes(recommendation.status)) return false;
  if (recommendation.validated_session_revision !== session.revision) return true;
  for (const f of currentLinkedFindingRows(recommendation.id)) {
    if (f.status !== 'active') return true;
    const exec = getExecution(f.rule_execution_id);
    if (!exec || exec.status !== 'completed' || exec.superseded_by_execution_id != null || exec.session_revision !== session.revision) {
      return true;
    }
  }
  return false;
}

function toDetail(recommendation, session) {
  return {
    ...recommendation,
    no_alternatives_identified: !!recommendation.no_alternatives_identified,
    no_additional_risks_identified: !!recommendation.no_additional_risks_identified,
    no_missing_information_known: !!recommendation.no_missing_information_known,
    finding_ids: currentLinkedFindingRows(recommendation.id).map((f) => f.id),
    member_ids: currentLinkedMemberIds(recommendation.id),
    potentially_stale: computeStaleness(recommendation, session),
  };
}

// --- Création ---------------------------------------------------------

// Champs narratifs optionnels acceptés dès la création (au-delà de l'entrée
// minimale title/advisor_rationale) -- aucun n'est jamais renseigné
// automatiquement, ils ne sont acceptés QUE s'ils sont explicitement
// transmis par l'appelant humain.
function extractOptionalNarrativeFields(data) {
  const out = {};
  for (const f of NARRATIVE_FIELDS) if (data[f] !== undefined) out[f] = data[f];
  for (const f of FLAG_FIELDS) if (data[f] !== undefined) out[f] = toFlag(data[f]);
  return out;
}

export function createRecommendation(sessionId, data = {}, req) {
  const session = requireSession(sessionId);
  const household = getHousehold(session.household_id);
  assertSessionWritable(session, household);

  const { domain, scope, title, advisor_rationale, member_ids, finding_ids } = data;
  assert(inEnum(domain, RECOMMENDATION_DOMAINS) && domain != null, `domain doit être l'une des valeurs : ${RECOMMENDATION_DOMAINS.join(', ')}.`);
  assert(nonEmpty(title), 'title est obligatoire.');
  assert(nonEmpty(advisor_rationale), 'advisor_rationale est obligatoire.');
  const memberIds = assertValidScopeAndMembers(scope, member_ids);
  if (memberIds.length) assertMembersInSnapshot(session, memberIds);

  const findingIds = Array.isArray(finding_ids) ? [...new Set(finding_ids.map(Number))] : [];
  const findingRows = findingIds.map((id) => requireFindingForRecommendation(sessionId, domain, id));
  assertFindingMemberCoherence(scope, memberIds, findingRows);

  const optional = extractOptionalNarrativeFields(data);
  delete optional.title;
  delete optional.advisor_rationale;
  assertNarrativeCoherence({ ...optional, title, advisor_rationale });

  const userId = currentUserId(req);
  const recId = db.transaction(() => {
    const columns = ['session_id', 'domain', 'scope', 'status', 'revision', 'title', 'advisor_rationale', 'created_by_user_id', ...Object.keys(optional)];
    const placeholders = ['?', '?', '?', "'draft'", '1', '?', '?', '?', ...Object.keys(optional).map(() => '?')];
    const values = [sessionId, domain, scope, title.trim(), advisor_rationale.trim(), userId, ...Object.values(optional)];
    const insert = db.prepare(`INSERT INTO advisory_recommendations (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`).run(...values);
    const newId = insert.lastInsertRowid;
    for (const mId of memberIds) {
      db.prepare('INSERT INTO advisory_recommendation_members (recommendation_id, household_member_id, created_by_user_id) VALUES (?, ?, ?)').run(newId, mId, userId);
    }
    for (const fId of findingIds) {
      db.prepare('INSERT INTO advisory_recommendation_findings (recommendation_id, finding_id, created_by_user_id) VALUES (?, ?, ?)').run(newId, fId, userId);
    }
    return newId;
  })();

  audit(req, 'recommandation créée', 'advisory_session', sessionId, `domain=${domain} scope=${scope}`);
  return toDetail(getRecommendation(recId), session);
}

// --- Lecture ------------------------------------------------------------

// Filtre `domain` optionnel des routes de lecture (liste/historique) --
// validation commune et centralisée, fondée sur LA MÊME énumération que la
// création (`RECOMMENDATION_DOMAINS`), jamais dupliquée/redéfinie par route.
// Absent = non filtré. Une valeur invalide est rejetée (400) AVANT toute
// utilisation en SQL, en projection ou en audit -- jamais une normalisation
// silencieuse vers « absent », jamais une chaîne arbitraire journalisée
// (correctif GATE final ciblé, point signalé par `compliance-privacy-reviewer`).
function assertValidDomainFilter(domain) {
  assert(inEnum(domain, RECOMMENDATION_DOMAINS), `domain doit être l'une des valeurs : ${RECOMMENDATION_DOMAINS.join(', ')}.`);
}

export function getSessionRecommendationsList(sessionId, { domain, status } = {}, req) {
  const session = requireSession(sessionId);
  assertValidDomainFilter(domain);
  let sql = 'SELECT * FROM advisory_recommendations WHERE session_id = ?';
  const params = [sessionId];
  if (domain) { sql += ' AND domain = ?'; params.push(domain); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY id DESC';
  const rows = db.prepare(sql).all(...params);
  const details = rows.map((r) => toDetail(r, session));
  auditRecommendationsViewIfNeeded(req, sessionId);
  auditSensitiveRecommendationsViewIfNeeded(req, sessionId, rows.some((r) => recommendationHasSensitiveFinding(r.id)));
  return details;
}

export function getSessionRecommendationsHistory(sessionId, { domain } = {}, req) {
  const session = requireSession(sessionId);
  assertValidDomainFilter(domain);
  let sql = 'SELECT * FROM advisory_recommendations WHERE session_id = ?';
  const params = [sessionId];
  if (domain) { sql += ' AND domain = ?'; params.push(domain); }
  sql += ' ORDER BY id DESC';
  const rows = db.prepare(sql).all(...params);
  // Toujours journalisé, jamais dédupliqué -- même convention que
  // GET .../findings/history (Lot 4A). `domain` est déjà validé ci-dessus :
  // seule une valeur de l'énumération, ou '', atteint jamais `details`.
  audit(req, 'consultation historique recommandations', 'advisory_session', sessionId, domain || '');
  return rows.map((r) => toDetail(r, session));
}

export function getRecommendationDetail(sessionId, recId, req) {
  const session = requireSession(sessionId);
  const rec = requireRecommendationForSession(sessionId, recId);
  auditRecommendationsViewIfNeeded(req, sessionId);
  auditSensitiveRecommendationsViewIfNeeded(req, sessionId, recommendationHasSensitiveFinding(recId));
  return toDetail(rec, session);
}

// --- Modification du brouillon (narratif + portée/membres + domaine,
// atomiquement en un seul appel, une seule incrémentation de révision) ---

export function updateRecommendationDraft(sessionId, recId, data = {}, req) {
  const session = requireSession(sessionId);
  const household = getHousehold(session.household_id);
  const rec = requireRecommendationForSession(sessionId, recId);
  assertSessionWritable(session, household);
  assertDraftMutable(rec);
  assertExpectedRecommendationRevision(rec, data.expected_recommendation_revision);

  const nextDomain = data.domain !== undefined ? data.domain : rec.domain;
  const nextScope = data.scope !== undefined ? data.scope : rec.scope;
  const scopeOrMembersChanging = data.scope !== undefined || data.member_ids !== undefined;
  let nextMemberIds = currentLinkedMemberIds(recId);
  if (scopeOrMembersChanging) {
    assert(data.scope !== undefined && data.member_ids !== undefined, 'Un changement de portée doit toujours transmettre explicitement member_ids (jamais un retrait implicite).');
    nextMemberIds = assertValidScopeAndMembers(nextScope, data.member_ids).map(Number);
    if (nextMemberIds.length) assertMembersInSnapshot(session, nextMemberIds);
  }

  if (data.domain !== undefined) {
    assert(inEnum(nextDomain, RECOMMENDATION_DOMAINS) && nextDomain != null, `domain doit être l'une des valeurs : ${RECOMMENDATION_DOMAINS.join(', ')}.`);
    if (nextDomain !== rec.domain) {
      const stillLinked = currentLinkedFindingRows(recId);
      assert(stillLinked.length === 0, 'Impossible de changer de domaine tant que des findings sont liés (retirez-les d’abord).');
    }
  }

  const linkedFindings = currentLinkedFindingRows(recId);
  assertFindingMemberCoherence(nextScope, nextMemberIds, linkedFindings);

  const merged = { ...rec };
  for (const f of NARRATIVE_FIELDS) if (data[f] !== undefined) merged[f] = data[f];
  for (const f of FLAG_FIELDS) if (data[f] !== undefined) merged[f] = toFlag(data[f]);
  if (data.title !== undefined) assert(nonEmpty(data.title), 'title ne peut pas être vide.');
  if (data.advisor_rationale !== undefined) assert(nonEmpty(data.advisor_rationale), 'advisor_rationale ne peut pas être vide.');
  assertNarrativeCoherence(merged);

  db.transaction(() => {
    const userId = currentUserId(req);
    const setClauses = [];
    const params = [];
    for (const f of [...NARRATIVE_FIELDS, ...FLAG_FIELDS]) {
      if (data[f] !== undefined) {
        setClauses.push(`${f} = ?`);
        params.push(FLAG_FIELDS.includes(f) ? toFlag(data[f]) : data[f]);
      }
    }
    if (data.domain !== undefined) { setClauses.push('domain = ?'); params.push(nextDomain); }
    if (data.scope !== undefined) { setClauses.push('scope = ?'); params.push(nextScope); }
    setClauses.push('revision = revision + 1', "updated_at = datetime('now')");
    db.prepare(`UPDATE advisory_recommendations SET ${setClauses.join(', ')} WHERE id = ?`).run(...params, recId);

    if (scopeOrMembersChanging) {
      db.prepare('DELETE FROM advisory_recommendation_members WHERE recommendation_id = ?').run(recId);
      for (const mId of nextMemberIds) {
        db.prepare('INSERT INTO advisory_recommendation_members (recommendation_id, household_member_id, created_by_user_id) VALUES (?, ?, ?)').run(recId, mId, userId);
      }
    }
  })();

  audit(req, 'recommandation modifiée', 'advisory_session', sessionId, `#${recId}`);
  return toDetail(getRecommendation(recId), session);
}

// --- Liens findings / membres unitaires -----------------------------------

export function linkFinding(sessionId, recId, findingId, expectedRevision, req) {
  const session = requireSession(sessionId);
  const household = getHousehold(session.household_id);
  const rec = requireRecommendationForSession(sessionId, recId);
  assertSessionWritable(session, household);
  assertDraftMutable(rec);
  assertExpectedRecommendationRevision(rec, expectedRevision);

  const finding = requireFindingForRecommendation(sessionId, rec.domain, findingId);
  const nextMemberIds = currentLinkedMemberIds(recId);
  assertFindingMemberCoherence(rec.scope, nextMemberIds, [...currentLinkedFindingRows(recId), finding]);

  const userId = currentUserId(req);
  db.transaction(() => {
    db.prepare(
      'INSERT OR IGNORE INTO advisory_recommendation_findings (recommendation_id, finding_id, created_by_user_id) VALUES (?, ?, ?)'
    ).run(recId, findingId, userId);
    db.prepare("UPDATE advisory_recommendations SET revision = revision + 1, updated_at = datetime('now') WHERE id = ?").run(recId);
  })();
  audit(req, 'finding lié', 'advisory_session', sessionId, `recommandation #${recId} <- finding #${findingId}`);
  return toDetail(getRecommendation(recId), session);
}

export function unlinkFinding(sessionId, recId, findingId, expectedRevision, req) {
  const session = requireSession(sessionId);
  const household = getHousehold(session.household_id);
  const rec = requireRecommendationForSession(sessionId, recId);
  assertSessionWritable(session, household);
  assertDraftMutable(rec);
  assertExpectedRecommendationRevision(rec, expectedRevision);

  db.transaction(() => {
    db.prepare('DELETE FROM advisory_recommendation_findings WHERE recommendation_id = ? AND finding_id = ?').run(recId, findingId);
    db.prepare("UPDATE advisory_recommendations SET revision = revision + 1, updated_at = datetime('now') WHERE id = ?").run(recId);
  })();
  audit(req, 'finding délié', 'advisory_session', sessionId, `recommandation #${recId} -> finding #${findingId}`);
  return toDetail(getRecommendation(recId), session);
}

export function linkMember(sessionId, recId, memberId, expectedRevision, req) {
  const session = requireSession(sessionId);
  const household = getHousehold(session.household_id);
  const rec = requireRecommendationForSession(sessionId, recId);
  assertSessionWritable(session, household);
  assertDraftMutable(rec);
  assertExpectedRecommendationRevision(rec, expectedRevision);
  assert(rec.scope === 'member', 'Ajouter un membre ciblé n’a de sens que pour une recommandation scope = member.');
  assertMembersInSnapshot(session, [memberId]);

  const userId = currentUserId(req);
  db.transaction(() => {
    db.prepare(
      'INSERT OR IGNORE INTO advisory_recommendation_members (recommendation_id, household_member_id, created_by_user_id) VALUES (?, ?, ?)'
    ).run(recId, memberId, userId);
    db.prepare("UPDATE advisory_recommendations SET revision = revision + 1, updated_at = datetime('now') WHERE id = ?").run(recId);
  })();
  audit(req, 'membre lié', 'advisory_session', sessionId, `recommandation #${recId} <- membre #${memberId}`);
  return toDetail(getRecommendation(recId), session);
}

export function unlinkMember(sessionId, recId, memberId, expectedRevision, req) {
  const session = requireSession(sessionId);
  const household = getHousehold(session.household_id);
  const rec = requireRecommendationForSession(sessionId, recId);
  assertSessionWritable(session, household);
  assertDraftMutable(rec);
  assertExpectedRecommendationRevision(rec, expectedRevision);
  assert(rec.scope === 'member', 'Retirer un membre ciblé n’a de sens que pour une recommandation scope = member.');

  const remaining = currentLinkedMemberIds(recId).filter((id) => id !== Number(memberId));
  assert(remaining.length > 0, 'Impossible de retirer le dernier membre ciblé (scope = member exige au moins un membre).');
  assertFindingMemberCoherence(rec.scope, remaining, currentLinkedFindingRows(recId));

  db.transaction(() => {
    db.prepare('DELETE FROM advisory_recommendation_members WHERE recommendation_id = ? AND household_member_id = ?').run(recId, memberId);
    db.prepare("UPDATE advisory_recommendations SET revision = revision + 1, updated_at = datetime('now') WHERE id = ?").run(recId);
  })();
  audit(req, 'membre délié', 'advisory_session', sessionId, `recommandation #${recId} -> membre #${memberId}`);
  return toDetail(getRecommendation(recId), session);
}

// --- Écartement / retrait --------------------------------------------------

export function dismissRecommendation(sessionId, recId, { dismiss_reason, expected_recommendation_revision } = {}, req) {
  const session = requireSession(sessionId);
  const household = getHousehold(session.household_id);
  const rec = requireRecommendationForSession(sessionId, recId);
  assertSessionWritable(session, household);
  assertAction(rec, 'dismiss');
  assertExpectedRecommendationRevision(rec, expected_recommendation_revision);
  assert(nonEmpty(dismiss_reason), 'dismiss_reason est obligatoire.');
  assert(dismiss_reason.length <= 2000, 'dismiss_reason dépasse 2000 caractères.');

  const userId = currentUserId(req);
  db.prepare(
    `UPDATE advisory_recommendations SET status = 'dismissed', dismiss_reason = ?, dismissed_by_user_id = ?,
     dismissed_at = datetime('now'), revision = revision + 1, updated_at = datetime('now') WHERE id = ?`
  ).run(dismiss_reason.trim(), userId, recId);
  audit(req, 'recommandation écartée', 'advisory_session', sessionId, `#${recId}`);
  return toDetail(getRecommendation(recId), session);
}

export function withdrawRecommendation(sessionId, recId, { withdraw_reason, expected_recommendation_revision } = {}, req) {
  const session = requireSession(sessionId);
  const household = getHousehold(session.household_id);
  const rec = requireRecommendationForSession(sessionId, recId);
  assertSessionWritable(session, household);
  assertAction(rec, 'withdraw');
  assertExpectedRecommendationRevision(rec, expected_recommendation_revision);
  assert(nonEmpty(withdraw_reason), 'withdraw_reason est obligatoire.');
  assert(withdraw_reason.length <= 2000, 'withdraw_reason dépasse 2000 caractères.');

  const userId = currentUserId(req);
  db.prepare(
    `UPDATE advisory_recommendations SET status = 'withdrawn', withdraw_reason = ?, withdrawn_by_user_id = ?,
     withdrawn_at = datetime('now'), revision = revision + 1, updated_at = datetime('now') WHERE id = ?`
  ).run(withdraw_reason.trim(), userId, recId);
  audit(req, 'recommandation retirée', 'advisory_session', sessionId, `#${recId}`);
  return toDetail(getRecommendation(recId), session);
}

// --- Validation --------------------------------------------------------

const ACTIVE_FINDING_STATUS = 'active';
const COMPLETED_EXECUTION_STATUS = 'completed';

function assertFindingsValidForValidation(recId, session, domain) {
  const rows = currentLinkedFindingRows(recId);
  assert(rows.length > 0, 'Au moins un finding source est obligatoire pour valider une recommandation.');
  for (const f of rows) {
    if (f.session_id !== session.id || f.domain !== domain) {
      throw new AdvisoryError(`Le finding #${f.id} n'appartient plus à la session ou au domaine de cette recommandation.`, 409);
    }
    if (f.status !== ACTIVE_FINDING_STATUS) {
      throw new AdvisoryError(`Le finding #${f.id} n'est plus actif (statut « ${f.status} ») : relancez l'analyse et mettez à jour les findings liés avant de valider.`, 409);
    }
    const exec = getExecution(f.rule_execution_id);
    if (!exec || exec.status !== COMPLETED_EXECUTION_STATUS || exec.superseded_by_execution_id != null) {
      throw new AdvisoryError(`Le finding #${f.id} provient d'une exécution qui n'est plus la référence courante.`, 409);
    }
    if (exec.session_revision !== session.revision) {
      throw new AdvisoryError(`Le finding #${f.id} provient d'une révision de session obsolète : relancez l'analyse avant de valider.`, 409);
    }
  }
  return rows;
}

export function validateRecommendation(sessionId, recId, { expected_recommendation_revision, expected_session_revision } = {}, req) {
  const session = requireSession(sessionId);
  const household = getHousehold(session.household_id);
  const rec = requireRecommendationForSession(sessionId, recId);
  assertSessionWritable(session, household);
  assertAction(rec, 'validate');
  assertExpectedRecommendationRevision(rec, expected_recommendation_revision);
  assertExpectedSessionRevision(session, expected_session_revision);

  assert(nonEmpty(rec.title), 'title est obligatoire pour valider.');
  assert(nonEmpty(rec.summary), 'summary est obligatoire pour valider.');
  assert(nonEmpty(rec.advisor_rationale), 'advisor_rationale est obligatoire pour valider.');
  const memberIds = currentLinkedMemberIds(recId);
  assertValidScopeAndMembers(rec.scope, memberIds);
  const findingRows = assertFindingsValidForValidation(recId, session, rec.domain);
  assertFindingMemberCoherence(rec.scope, memberIds, findingRows);

  let source = null;
  if (rec.supersedes_recommendation_id != null) {
    source = getRecommendation(rec.supersedes_recommendation_id);
    if (!source || source.status !== 'validated' || source.session_id !== session.id || source.domain !== rec.domain) {
      throw new AdvisoryError('La recommandation remplacée n’est plus disponible pour ce remplacement (déjà retirée, remplacée ou modifiée).', 409);
    }
  }

  const userId = currentUserId(req);
  db.transaction(() => {
    if (source) {
      db.prepare("UPDATE advisory_recommendations SET status = 'superseded', revision = revision + 1, updated_at = datetime('now') WHERE id = ?").run(source.id);
    }
    db.prepare(
      `UPDATE advisory_recommendations SET status = 'validated', validated_by_user_id = ?, validated_at = datetime('now'),
       validated_session_revision = ?, revision = revision + 1, updated_at = datetime('now') WHERE id = ?`
    ).run(userId, session.revision, recId);
  })();

  audit(req, 'recommandation validée', 'advisory_session', sessionId, `#${recId}`);
  if (source) audit(req, 'recommandation remplacée', 'advisory_session', sessionId, `#${source.id} -> #${recId}`);
  return {
    recommendation: toDetail(getRecommendation(recId), session),
    supersedes: source ? toDetail(getRecommendation(source.id), session) : null,
  };
}

// --- Remplacement --------------------------------------------------------

export function createReplacement(sessionId, sourceRecId, data = {}, req) {
  const session = requireSession(sessionId);
  const household = getHousehold(session.household_id);
  assertSessionWritable(session, household);
  const source = requireRecommendationForSession(sessionId, sourceRecId);
  assert(source.status === 'validated', 'Seule une recommandation validated peut être remplacée.');
  assertExpectedRecommendationRevision(source, data.expected_source_recommendation_revision);

  const existingSuccessor = db
    .prepare("SELECT id FROM advisory_recommendations WHERE supersedes_recommendation_id = ? AND status <> 'dismissed'")
    .get(sourceRecId);
  if (existingSuccessor) {
    throw new AdvisoryError(`Cette recommandation a déjà un remplacement actif en cours (#${existingSuccessor.id}).`, 409);
  }

  const { title, advisor_rationale, scope, member_ids } = data;
  assert(nonEmpty(title), 'title est obligatoire.');
  assert(nonEmpty(advisor_rationale), 'advisor_rationale est obligatoire.');
  const memberIds = assertValidScopeAndMembers(scope, member_ids);
  if (memberIds.length) assertMembersInSnapshot(session, memberIds);

  const optional = extractOptionalNarrativeFields(data);
  delete optional.title;
  delete optional.advisor_rationale;
  assertNarrativeCoherence({ ...optional, title, advisor_rationale });

  const userId = currentUserId(req);
  let newId;
  try {
    newId = db.transaction(() => {
      const columns = ['session_id', 'domain', 'scope', 'status', 'revision', 'title', 'advisor_rationale', 'created_by_user_id', 'supersedes_recommendation_id', ...Object.keys(optional)];
      const placeholders = ['?', '?', '?', "'draft'", '1', '?', '?', '?', '?', ...Object.keys(optional).map(() => '?')];
      const values = [sessionId, source.domain, scope, title.trim(), advisor_rationale.trim(), userId, sourceRecId, ...Object.values(optional)];
      const result = db.prepare(`INSERT INTO advisory_recommendations (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`).run(...values);
      const recId = result.lastInsertRowid;
      for (const mId of memberIds) {
        db.prepare('INSERT INTO advisory_recommendation_members (recommendation_id, household_member_id, created_by_user_id) VALUES (?, ?, ?)').run(recId, mId, userId);
      }
      return recId;
    })();
  } catch (err) {
    // Filet de sécurité SQLite (index unique partiel) contre une course
    // entre la vérification applicative ci-dessus et cette insertion --
    // traduit en 409 propre, jamais de fuite de détail SQL (même
    // convention que server/advisoryRules.js pour l'index de publication).
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new AdvisoryError('Cette recommandation a déjà un remplacement actif en cours (conflit de concurrence détecté).', 409);
    }
    throw err;
  }

  audit(req, 'recommandation créée', 'advisory_session', sessionId, `remplacement de #${sourceRecId}`);
  return toDetail(getRecommendation(newId), session);
}
