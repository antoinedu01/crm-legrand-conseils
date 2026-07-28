// Service métier — socle foyer (Legrand Diagnostic 360, Lot 2).
//
// Isolé de `server/routes/advisoryHouseholds.js` (qui reste un adaptateur
// HTTP fin) pour que la logique métier (transactions, invariants) soit
// testable directement, sur le modèle de `server/scoring.js` /
// `server/commissionCalc.js` (modules de logique + accès DB, au même niveau
// que `server/routes/`, sans sous-dossier — cf. revue `advisory-architect`).

import db from './db.js';
import { assert, isDateStr, inEnum, checkTextFields } from './validate.js';
import { audit } from './audit.js';
import { classifyMatch, compareMatchSeverity } from './advisorySimilarity.js';

export const HOUSEHOLD_STATUSES = ['actif', 'archive'];
export const MEMBER_STATUSES = ['actif', 'archive'];
export const MEMBER_ROLES = ['principal', 'conjoint', 'enfant', 'autre_charge'];
// Rôles que peut reprendre l'ancien principal une fois rétrogradé
// (set-primary) — jamais 'enfant' (incohérent avec un ancien contact
// administratif adulte), jamais 'principal' (ce serait un no-op invalide).
export const DEMOTABLE_ROLES = ['conjoint', 'autre_charge'];

// Erreur métier porteuse d'un code HTTP explicite — distincte de
// `ValidationError` (server/validate.js, toujours 400) : utilisée pour les
// 404/409 que seul ce service peut détecter (existence, conflits
// d'invariants). Les routes restent responsables des 404 « ressource
// introuvable » simples qu'elles peuvent vérifier elles-mêmes directement.
export class AdvisoryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AdvisoryError';
    this.status = status;
  }
}

function displayName(c) {
  if (!c) return null;
  return c.type === 'entreprise'
    ? c.company_name || '(entreprise sans nom)'
    : [c.first_name, c.last_name].filter(Boolean).join(' ') || '(sans nom)';
}

function getClient(clientId) {
  return db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
}

// Foyers actifs (autres que `excludeHouseholdId`) où `clientId` est membre
// actif — utilisé pour l'information « également membre de » (décision GATE
// LOT 1, décision 1, point 7), jamais pour bloquer.
function activeHouseholdsFor(clientId, excludeHouseholdId = null) {
  return db
    .prepare(
      `SELECT h.id, h.label FROM household_members hm
       JOIN households h ON h.id = hm.household_id
       WHERE hm.client_id = ? AND hm.status = 'actif' AND h.status = 'actif'
         AND (? IS NULL OR h.id != ?)`
    )
    .all(clientId, excludeHouseholdId, excludeHouseholdId);
}

function validateHouseholdInput(data) {
  if ('status' in data) assert(inEnum(data.status, HOUSEHOLD_STATUSES), 'Statut de foyer inconnu.');
  checkTextFields(data, ['label'], 200);
}

// Un foyer archivé est figé : plus aucune écriture (foyer ou membres) n'est
// possible tant qu'il reste archivé — aucune procédure de réactivation
// n'existe à ce lot (GATE LOT 2, contrôle ciblé « foyers archivés »), donc
// ce blocage est volontairement total plutôt que partiel.
function assertHouseholdWritable(household) {
  if (household.status === 'archive') {
    throw new AdvisoryError('Ce foyer est archivé : aucune modification n’est possible.', 409);
  }
}

// --- Lecture ---------------------------------------------------------

export function listHouseholds({ q, status } = {}) {
  let sql = `
    SELECT h.*,
      pc.first_name AS principal_first_name, pc.last_name AS principal_last_name,
      pc.company_name AS principal_company_name, pc.type AS principal_type,
      pc.canton AS principal_canton, pc.city AS principal_city,
      (SELECT COUNT(*) FROM household_members m WHERE m.household_id = h.id AND m.status = 'actif') AS active_member_count
    FROM households h
    JOIN clients pc ON pc.id = h.primary_client_id
    WHERE 1=1`;
  const params = [];
  if (status) {
    sql += ' AND h.status = ?';
    params.push(status);
  }
  if (q) {
    sql += ` AND (h.label LIKE ? OR pc.first_name LIKE ? OR pc.last_name LIKE ? OR pc.company_name LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  sql += ' ORDER BY h.updated_at DESC';
  return db.prepare(sql).all(...params).map((r) => ({
    id: r.id,
    label: r.label,
    status: r.status,
    primary_client_id: r.primary_client_id,
    primary_display_name: displayName({
      type: r.principal_type, first_name: r.principal_first_name,
      last_name: r.principal_last_name, company_name: r.principal_company_name,
    }),
    canton: r.principal_canton,
    city: r.principal_city,
    active_member_count: r.active_member_count,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export function getHouseholdDetail(householdId) {
  const household = db.prepare('SELECT * FROM households WHERE id = ?').get(householdId);
  if (!household) return null;
  const members = db
    .prepare(
      `SELECT hm.*, c.type AS client_type, c.first_name, c.last_name, c.company_name,
         c.birth_date, c.email, c.phone, c.canton, c.city,
         rep.first_name AS rep_first_name, rep.last_name AS rep_last_name, rep.company_name AS rep_company_name,
         rep.type AS rep_type
       FROM household_members hm
       JOIN clients c ON c.id = hm.client_id
       LEFT JOIN clients rep ON rep.id = hm.legal_representative_client_id
       WHERE hm.household_id = ?
       ORDER BY (hm.status = 'actif') DESC, hm.member_role = 'principal' DESC, hm.created_at`
    )
    .all(householdId)
    .map((r) => ({
      id: r.id,
      client_id: r.client_id,
      display_name: displayName(r),
      member_role: r.member_role,
      relationship_detail: r.relationship_detail,
      birth_date: r.birth_date,
      email: r.email,
      phone: r.phone,
      legal_representative_client_id: r.legal_representative_client_id,
      legal_representative_display_name: r.legal_representative_client_id
        ? displayName({
            type: r.rep_type, first_name: r.rep_first_name,
            last_name: r.rep_last_name, company_name: r.rep_company_name,
          })
        : null,
      start_date: r.start_date,
      end_date: r.end_date,
      status: r.status,
      other_active_households:
        r.status === 'actif' ? activeHouseholdsFor(r.client_id, householdId) : [],
    }));
  return {
    ...household,
    members,
    // Les sessions de diagnostic n'existent pas encore (Lot 3) : tableau
    // vide réservé, pas une omission — la forme de la réponse est stable.
    sessions: [],
  };
}

// --- Écriture : foyers -------------------------------------------------

// Création atomique du foyer et de son membre principal — jamais l'un sans
// l'autre (invariant « un foyer actif a toujours exactement un principal
// actif »).
export function createHousehold({ primary_client_id, label } = {}, req) {
  assert(primary_client_id, 'Le client principal est requis.');
  const client = getClient(primary_client_id);
  if (!client) throw new AdvisoryError('Client principal introuvable.', 400);
  validateHouseholdInput({ label });

  const alreadyIn = activeHouseholdsFor(primary_client_id);

  const householdId = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO households (label, primary_client_id) VALUES (?, ?)')
      .run(label || null, primary_client_id);
    const id = info.lastInsertRowid;
    db.prepare(
      `INSERT INTO household_members (household_id, client_id, member_role, start_date)
       VALUES (?, ?, 'principal', date('now'))`
    ).run(id, primary_client_id);
    return id;
  })();

  audit(req, 'création foyer', 'household', householdId, displayName(client));
  return { id: householdId, already_in_households: alreadyIn };
}

export function updateHousehold(householdId, data, req) {
  const household = db.prepare('SELECT * FROM households WHERE id = ?').get(householdId);
  if (!household) throw new AdvisoryError('Foyer introuvable.', 404);
  assertHouseholdWritable(household);
  validateHouseholdInput(data);
  const fields = [];
  const params = [];
  if ('label' in data) { fields.push('label = ?'); params.push(data.label || null); }
  if ('status' in data) { fields.push('status = ?'); params.push(data.status); }
  if (fields.length === 0) return { ok: true };
  params.push(householdId);
  db.prepare(`UPDATE households SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params);
  const becameArchived = 'status' in data && data.status === 'archive' && household.status !== 'archive';
  audit(req, becameArchived ? 'archivage foyer' : 'modification foyer', 'household', householdId, data.label || '');
  return { ok: true };
}

// --- Écriture : membres -------------------------------------------------

function activeMember(householdId, memberId) {
  return db
    .prepare("SELECT * FROM household_members WHERE id = ? AND household_id = ?")
    .get(memberId, householdId);
}

function assertLegalRepresentativeValid(householdId, repClientId) {
  if (repClientId == null) return;
  const rep = db
    .prepare(
      `SELECT * FROM household_members WHERE household_id = ? AND client_id = ? AND status = 'actif'
         AND member_role IN ('principal', 'conjoint', 'autre_charge')`
    )
    .get(householdId, repClientId);
  assert(rep, 'Le représentant légal doit être un membre actif (principal, conjoint ou autre personne à charge) de ce foyer.');
}

// Détection souple de doublons (décision GATE LOT 1, décision 2 ; LOT 2
// §7). Ne fusionne jamais, ne supprime jamais, ne bloque jamais
// systématiquement — voir server/advisorySimilarity.js.
export function checkSimilarity(householdId, draft, { legalRepresentativeClientId } = {}) {
  const candidates = db
    .prepare("SELECT * FROM clients WHERE status != 'anonymise' AND type = 'particulier'")
    .all();
  const memberIds = new Set(
    db.prepare("SELECT client_id FROM household_members WHERE household_id = ? AND status = 'actif'")
      .all(householdId).map((r) => r.client_id)
  );
  const repIds = legalRepresentativeClientId
    ? new Set(
        db.prepare("SELECT client_id FROM household_members WHERE legal_representative_client_id = ? AND status = 'actif'")
          .all(legalRepresentativeClientId).map((r) => r.client_id)
      )
    : new Set();

  const results = [];
  for (const candidate of candidates) {
    const context = { sameHousehold: memberIds.has(candidate.id), sameRepresentative: repIds.has(candidate.id) };
    const { level, reasons } = classifyMatch(draft, candidate, context);
    if (level === 'no_match') continue;
    results.push({
      client_id: candidate.id,
      display_name: displayName(candidate),
      birth_date: candidate.birth_date,
      match_level: level,
      reasons,
      household_ids: activeHouseholdsFor(candidate.id).map((h) => h.id),
    });
  }
  results.sort((a, b) => compareMatchSeverity({ level: a.match_level }, { level: b.match_level }));
  return results;
}

const STRONG_MATCH_LEVELS = ['exact_match', 'probable_match'];

// Ajoute un membre existant, ou crée rapidement une nouvelle personne
// (`new_person`) puis l'ajoute — dans les deux cas, jamais `member_role
// = 'principal'` (réservé à la création du foyer / à set-primary).
// Atomique lorsque `new_person` est fourni (création client + adhésion).
export function addMember(householdId, body = {}, req) {
  const household = db.prepare('SELECT * FROM households WHERE id = ?').get(householdId);
  if (!household) throw new AdvisoryError('Foyer introuvable.', 404);
  assertHouseholdWritable(household);

  const { member_role, relationship_detail, legal_representative_client_id, new_person, client_id, confirmed_despite_match } = body;
  assert(inEnum(member_role, MEMBER_ROLES) && member_role != null, 'Rôle de membre inconnu.');
  if (member_role === 'principal') {
    throw new AdvisoryError(
      'Le rôle principal ne peut être défini qu’à la création du foyer ou via le changement de membre principal.',
      400
    );
  }
  checkTextFields({ relationship_detail }, ['relationship_detail'], 200);

  let matches = [];
  const writeMember = db.transaction((resolvedClientId) => {
    assertLegalRepresentativeValid(householdId, legal_representative_client_id ?? null);
    const existingActive = db
      .prepare("SELECT id FROM household_members WHERE household_id = ? AND client_id = ? AND status = 'actif'")
      .get(householdId, resolvedClientId);
    if (existingActive) throw new AdvisoryError('Cette personne est déjà membre actif de ce foyer.', 409);

    const info = db
      .prepare(
        `INSERT INTO household_members
           (household_id, client_id, member_role, relationship_detail, legal_representative_client_id, start_date)
         VALUES (?, ?, ?, ?, ?, date('now'))`
      )
      .run(householdId, resolvedClientId, member_role, relationship_detail || null, legal_representative_client_id || null);
    return info.lastInsertRowid;
  });

  let resolvedClientId = client_id;
  let memberId;

  if (new_person) {
    assert(new_person.first_name || new_person.last_name, 'Un nom est requis pour créer une personne.');
    assert(isDateStr(new_person.birth_date), 'Date de naissance invalide (AAAA-MM-JJ).');
    checkTextFields(new_person, ['first_name', 'last_name'], 200);

    matches = checkSimilarity(
      householdId,
      { first_name: new_person.first_name, last_name: new_person.last_name, birth_date: new_person.birth_date },
      { legalRepresentativeClientId: legal_representative_client_id ?? null }
    );
    const strongMatch = matches.find((m) => STRONG_MATCH_LEVELS.includes(m.match_level));
    if (strongMatch && !confirmed_despite_match) {
      const err = new AdvisoryError(
        'Une personne très similaire existe déjà. Confirmez explicitement pour créer quand même une nouvelle fiche.',
        409
      );
      err.matches = matches;
      throw err;
    }

    const created = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO clients (type, first_name, last_name, birth_date, status)
           VALUES ('particulier', ?, ?, ?, 'prospect')`
        )
        .run(new_person.first_name || null, new_person.last_name || null, new_person.birth_date || null);
      const clientId = info.lastInsertRowid;
      // Audit de création de personne à l'intérieur de la transaction : si
      // l'ajout au foyer qui suit (writeMember) échoue et fait tout
      // annuler, cette entrée d'audit disparaît avec le reste — jamais un
      // audit qui affirmerait une création réussie alors que la transaction
      // a échoué (contrôle ciblé, vérifié par un test de rollback dédié).
      // Réutilise l'action existante `création client` (server/routes/clients.js)
      // plutôt que d'inventer une nouvelle convention ; détails minimaux,
      // jamais le nom de la personne créée (contrairement à la convention
      // standard qui journalise le nom affiché — ici volontairement omis).
      audit(req, 'création client', 'client', clientId, `particulier — origine module foyer — foyer #${householdId}`);
      const mId = writeMember(clientId);
      return { clientId, mId };
    })();
    resolvedClientId = created.clientId;
    memberId = created.mId;
  } else {
    assert(client_id, 'Une personne (client_id) ou une nouvelle personne (new_person) est requise.');
    const client = getClient(client_id);
    if (!client) throw new AdvisoryError('Client introuvable.', 400);
    memberId = writeMember(client_id);
  }

  const alreadyIn = activeHouseholdsFor(resolvedClientId, householdId);
  audit(req, 'ajout membre foyer', 'household', householdId, `${member_role} — client #${resolvedClientId}`);
  if (new_person && confirmed_despite_match) {
    const strongMatch = matches.find((m) => STRONG_MATCH_LEVELS.includes(m.match_level));
    if (strongMatch) {
      audit(
        req,
        'création malgré correspondance détectée',
        'household',
        householdId,
        `${strongMatch.match_level} — client existant #${strongMatch.client_id}`
      );
    }
  }
  return { id: memberId, client_id: resolvedClientId, already_in_households: alreadyIn };
}

export function updateMember(householdId, memberId, data, req) {
  const household = db.prepare('SELECT * FROM households WHERE id = ?').get(householdId);
  if (!household) throw new AdvisoryError('Foyer introuvable.', 404);
  assertHouseholdWritable(household);
  const member = activeMember(householdId, memberId);
  if (!member) throw new AdvisoryError('Membre introuvable dans ce foyer.', 404);
  assert(!('member_role' in data), 'Le rôle de membre ne peut pas être modifié ici — utilisez le changement de principal.');
  checkTextFields(data, ['relationship_detail'], 200);
  assert(isDateStr(data.end_date), 'Date de sortie invalide (AAAA-MM-JJ).');
  assert(
    !data.end_date || !member.start_date || data.end_date >= member.start_date,
    'La date de sortie ne peut pas être antérieure à la date d’entrée.'
  );
  if ('legal_representative_client_id' in data) {
    assertLegalRepresentativeValid(householdId, data.legal_representative_client_id || null);
  }
  const fields = [];
  const params = [];
  if ('relationship_detail' in data) { fields.push('relationship_detail = ?'); params.push(data.relationship_detail || null); }
  if ('legal_representative_client_id' in data) {
    fields.push('legal_representative_client_id = ?');
    params.push(data.legal_representative_client_id || null);
  }
  if ('end_date' in data) { fields.push('end_date = ?'); params.push(data.end_date || null); }
  if (fields.length === 0) return { ok: true };
  params.push(memberId);
  db.prepare(`UPDATE household_members SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params);
  audit(req, 'modification membre foyer', 'household', householdId, `membre #${memberId}`);
  return { ok: true };
}

// Sortie/désactivation d'un membre : jamais le principal (doit d'abord être
// remplacé via setPrimaryMember). Historise (status='archive' + end_date),
// ne supprime jamais physiquement.
export function removeMember(householdId, memberId, { end_date } = {}, req) {
  const household = db.prepare('SELECT * FROM households WHERE id = ?').get(householdId);
  if (!household) throw new AdvisoryError('Foyer introuvable.', 404);
  assertHouseholdWritable(household);
  const member = activeMember(householdId, memberId);
  if (!member) throw new AdvisoryError('Membre introuvable dans ce foyer.', 404);
  if (member.status !== 'actif') return { ok: true };
  if (member.member_role === 'principal') {
    throw new AdvisoryError(
      'Le membre principal doit d’abord être remplacé (changement de principal) avant de pouvoir être retiré.',
      400
    );
  }
  assert(isDateStr(end_date), 'Date de sortie invalide (AAAA-MM-JJ).');
  assert(
    !end_date || !member.start_date || end_date >= member.start_date,
    'La date de sortie ne peut pas être antérieure à la date d’entrée.'
  );
  db.prepare(
    `UPDATE household_members SET status = 'archive', end_date = COALESCE(?, date('now')), updated_at = datetime('now')
     WHERE id = ?`
  ).run(end_date || null, memberId);
  audit(req, 'retrait membre foyer', 'household', householdId, `membre #${memberId}`);
  return { ok: true };
}

// Changement atomique du membre principal — jamais un simple UPDATE de
// member_role. Ordre impératif (confirmé par la revue advisory-architect) :
// rétrograder l'ancien AVANT de promouvoir le nouveau, car l'index unique
// partiel `idx_household_members_one_active_principal` est vérifié
// immédiatement (non différé) — promouvoir avant rétrogradation violerait
// transitoirement la contrainte et ferait échouer la transaction.
export function setPrimaryMember(householdId, memberId, previousPrimaryNewRole, req) {
  const household = db.prepare('SELECT * FROM households WHERE id = ?').get(householdId);
  if (!household) throw new AdvisoryError('Foyer introuvable.', 404);
  assertHouseholdWritable(household);
  assert(inEnum(previousPrimaryNewRole, DEMOTABLE_ROLES) && previousPrimaryNewRole != null,
    'Le rôle de repli de l’ancien principal doit être « conjoint » ou « autre_charge ».');

  const newPrincipal = activeMember(householdId, memberId);
  if (!newPrincipal) throw new AdvisoryError('Membre introuvable dans ce foyer.', 404);
  if (newPrincipal.member_role === 'principal') {
    throw new AdvisoryError('Ce membre est déjà le principal du foyer.', 409);
  }

  const currentPrincipals = db
    .prepare("SELECT * FROM household_members WHERE household_id = ? AND status = 'actif' AND member_role = 'principal'")
    .all(householdId);
  if (currentPrincipals.length !== 1) {
    throw new AdvisoryError('Le foyer ne possède pas exactement un principal actif — incohérence à corriger avant tout changement.', 409);
  }
  const oldPrincipal = currentPrincipals[0];

  db.transaction(() => {
    // Rétrogradation d'abord (voir commentaire ci-dessus sur l'ordre).
    db.prepare("UPDATE household_members SET member_role = ?, updated_at = datetime('now') WHERE id = ?")
      .run(previousPrimaryNewRole, oldPrincipal.id);
    db.prepare("UPDATE household_members SET member_role = 'principal', updated_at = datetime('now') WHERE id = ?")
      .run(newPrincipal.id);
    db.prepare("UPDATE households SET primary_client_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(newPrincipal.client_id, householdId);
  })();

  audit(
    req,
    'changement de membre principal',
    'household',
    householdId,
    `ancien #${oldPrincipal.client_id} → nouveau #${newPrincipal.client_id}`
  );
  return { ok: true };
}
