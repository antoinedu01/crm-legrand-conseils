import { Router } from 'express';
import db from '../db.js';
import { audit } from '../audit.js';
import { assert, isDateStr, isNonNegNumber, inEnum, checkTextFields } from '../validate.js';

export const contractsRouter = Router();

export const BRANCHES = [
  'vie_3a', 'vie_3b', 'lamal', 'lca', 'lpp', 'hypotheque',
  'deces', 'incapacite', 'rc_menage', 'autre',
];
const CONTRACT_STATUSES = ['offre', 'actif', 'suspendu', 'resilie', 'echu'];
const FREQUENCIES = ['mensuelle', 'trimestrielle', 'semestrielle', 'annuelle', 'unique'];

// --- Détails LAMal (contract_lamal, migration v8) ---------------------

// Seule branche compatible avec des détails LAMal, déterminée à partir de
// BRANCHES ci-dessus (aucune liste inventée séparément).
const LAMAL_COMPATIBLE_BRANCHES = ['lamal'];

const CARE_MODELS = ['standard', 'medecin_famille', 'hmo', 'telmed', 'pharmacie', 'autre'];

// Franchises LAMal officielles (OFSP), ensemble combiné adultes + enfants :
// adultes 300/500/1000/1500/2000/2500 ; enfants 0/100/200/300/400/500/600.
// Aucune déduction automatique adulte/enfant : le modèle client actuel ne
// permet pas de déterminer la majorité de façon fiable à la saisie.
const LAMAL_DEDUCTIBLES = [0, 100, 200, 300, 400, 500, 600, 1000, 1500, 2000, 2500];

const SWISS_CANTONS = [
  'AG', 'AI', 'AR', 'BE', 'BL', 'BS', 'FR', 'GE', 'GL', 'GR', 'JU', 'LU', 'NE',
  'NW', 'OW', 'SG', 'SH', 'SO', 'SZ', 'TG', 'TI', 'UR', 'VD', 'VS', 'ZG', 'ZH',
];

// Valide le bloc `lamal` brut de la requête (avant normalisation).
function validateLamalInput(raw) {
  assert(inEnum(raw.care_model, CARE_MODELS) && raw.care_model != null, 'Modèle de soins LAMal invalide.');
  assert(raw.deductible !== undefined && raw.deductible !== null && raw.deductible !== '',
    'La franchise LAMal est requise.');
  const deductible = Number(raw.deductible);
  assert(Number.isInteger(deductible) && LAMAL_DEDUCTIBLES.includes(deductible),
    `Franchise LAMal invalide (valeurs autorisées : ${LAMAL_DEDUCTIBLES.join(', ')}).`);
  assert(
    raw.accident_coverage === undefined || typeof raw.accident_coverage === 'boolean' ||
      raw.accident_coverage === 0 || raw.accident_coverage === 1,
    'Couverture accident invalide (valeur booléenne attendue).'
  );
  assert(
    raw.canton == null || raw.canton === '' || SWISS_CANTONS.includes(String(raw.canton).trim().toUpperCase()),
    'Canton invalide.'
  );
  checkTextFields({ tariff_region: raw.tariff_region }, ['tariff_region'], 20);
}

// Normalise le bloc `lamal` validé pour l'écriture en base.
function normalizeLamal(raw) {
  return {
    care_model: raw.care_model,
    deductible: Number(raw.deductible),
    accident_coverage: raw.accident_coverage === false || raw.accident_coverage === 0 ? 0 : 1,
    canton: raw.canton ? String(raw.canton).trim().toUpperCase() : null,
    tariff_region: raw.tariff_region === '' || raw.tariff_region == null ? null : raw.tariff_region,
  };
}

// Crée, met à jour ou supprime la ligne contract_lamal selon lamalBody :
// null → suppression ; objet → upsert. Doit être appelée après validation
// et à l'intérieur d'une transaction (relation stricte 1:1 par contract_id).
function writeLamal(contractId, lamalBody) {
  const existing = db.prepare('SELECT contract_id FROM contract_lamal WHERE contract_id = ?').get(contractId);
  if (lamalBody === null) {
    if (!existing) return null;
    db.prepare('DELETE FROM contract_lamal WHERE contract_id = ?').run(contractId);
    return { action: 'deleted' };
  }
  const norm = normalizeLamal(lamalBody);
  if (existing) {
    db.prepare(
      `UPDATE contract_lamal SET care_model = ?, deductible = ?, accident_coverage = ?, canton = ?,
        tariff_region = ?, updated_at = datetime('now') WHERE contract_id = ?`
    ).run(norm.care_model, norm.deductible, norm.accident_coverage, norm.canton, norm.tariff_region, contractId);
    return { action: 'updated', data: norm };
  }
  db.prepare(
    `INSERT INTO contract_lamal (contract_id, care_model, deductible, accident_coverage, canton, tariff_region)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(contractId, norm.care_model, norm.deductible, norm.accident_coverage, norm.canton, norm.tariff_region);
  return { action: 'created', data: norm };
}

function serializeLamal(row) {
  if (row.lamal_care_model == null) return null;
  return {
    care_model: row.lamal_care_model,
    deductible: row.lamal_deductible,
    accident_coverage: Boolean(row.lamal_accident_coverage),
    canton: row.lamal_canton,
    tariff_region: row.lamal_tariff_region,
  };
}

// --- Détails LCA (contract_lca, migration v8) --------------------------

// Seule branche compatible avec des détails LCA. Disjointe de
// LAMAL_COMPATIBLE_BRANCHES : aucune branche n'est jamais compatible avec
// les deux à la fois, ce qui rejette naturellement (via l'un ou l'autre des
// contrôles ci-dessous) toute requête combinant lamal et lca sur une
// branche qui ne peut satisfaire les deux.
const LCA_COMPATIBLE_BRANCHES = ['lca'];

const UNDERWRITING_STATUSES = [
  'non_requis', 'questionnaire_transmis', 'decision_attendue',
  'acceptee', 'acceptee_avec_reserve', 'refusee',
];
const RESERVATION_STATUSES = ['aucune', 'en_cours', 'active', 'levee'];
const EXCLUSION_STATUSES = ['aucune', 'presentes'];

// Valide le bloc `lca` brut de la requête (avant normalisation). Les champs
// texte (*_notes) sont volontairement courts et ne doivent contenir qu'un
// statut administratif — jamais de diagnostic, de pathologie, de résultat
// médical ni de contenu de questionnaire de santé.
function validateLcaInput(raw) {
  assert(
    raw.underwriting_status === undefined || inEnum(raw.underwriting_status, UNDERWRITING_STATUSES),
    'Statut de souscription LCA invalide.'
  );
  assert(
    raw.waiting_period_days === undefined || raw.waiting_period_days === null ||
      (Number.isInteger(Number(raw.waiting_period_days)) && Number(raw.waiting_period_days) >= 0),
    'Délai d’attente invalide (entier non négatif attendu).'
  );
  assert(
    raw.administrative_reservation_status === undefined ||
      inEnum(raw.administrative_reservation_status, RESERVATION_STATUSES),
    'Statut de réserve administrative invalide.'
  );
  assert(
    raw.exclusions_status === undefined || inEnum(raw.exclusions_status, EXCLUSION_STATUSES),
    'Statut d’exclusion invalide.'
  );
  checkTextFields(
    { reservation_notes: raw.reservation_notes, exclusions_notes: raw.exclusions_notes },
    ['reservation_notes', 'exclusions_notes'],
    200
  );
}

// Normalise le bloc `lca` validé pour l'écriture en base. Les champs absents
// du payload conservent leur valeur par défaut SQL (création) ou existante
// (mise à jour), gérées via COALESCE dans writeLca.
function normalizeLca(raw) {
  return {
    underwriting_status: raw.underwriting_status ?? null,
    waiting_period_days: raw.waiting_period_days === '' || raw.waiting_period_days == null
      ? null : Number(raw.waiting_period_days),
    administrative_reservation_status: raw.administrative_reservation_status ?? null,
    reservation_notes: raw.reservation_notes === '' ? null : (raw.reservation_notes ?? null),
    exclusions_status: raw.exclusions_status ?? null,
    exclusions_notes: raw.exclusions_notes === '' ? null : (raw.exclusions_notes ?? null),
  };
}

// Crée, met à jour ou supprime la ligne contract_lca selon lcaBody : null →
// suppression ; objet → upsert (COALESCE conserve les valeurs par défaut
// SQL/existantes pour les champs non fournis). Doit être appelée après
// validation et à l'intérieur d'une transaction (relation stricte 1:1).
function writeLca(contractId, lcaBody) {
  const existing = db.prepare('SELECT * FROM contract_lca WHERE contract_id = ?').get(contractId);
  if (lcaBody === null) {
    if (!existing) return null;
    db.prepare('DELETE FROM contract_lca WHERE contract_id = ?').run(contractId);
    return { action: 'deleted' };
  }
  const norm = normalizeLca(lcaBody);
  if (existing) {
    db.prepare(
      `UPDATE contract_lca SET
        underwriting_status = COALESCE(?, underwriting_status),
        waiting_period_days = CASE WHEN ? THEN ? ELSE waiting_period_days END,
        administrative_reservation_status = COALESCE(?, administrative_reservation_status),
        reservation_notes = CASE WHEN ? THEN ? ELSE reservation_notes END,
        exclusions_status = COALESCE(?, exclusions_status),
        exclusions_notes = CASE WHEN ? THEN ? ELSE exclusions_notes END,
        updated_at = datetime('now')
       WHERE contract_id = ?`
    ).run(
      norm.underwriting_status,
      'waiting_period_days' in lcaBody ? 1 : 0, norm.waiting_period_days,
      norm.administrative_reservation_status,
      'reservation_notes' in lcaBody ? 1 : 0, norm.reservation_notes,
      norm.exclusions_status,
      'exclusions_notes' in lcaBody ? 1 : 0, norm.exclusions_notes,
      contractId
    );
    return { action: 'updated', data: { ...existing, ...norm } };
  }
  db.prepare(
    `INSERT INTO contract_lca (
      contract_id, underwriting_status, waiting_period_days,
      administrative_reservation_status, reservation_notes, exclusions_status, exclusions_notes
    ) VALUES (?, COALESCE(?, 'non_requis'), ?, COALESCE(?, 'aucune'), ?, COALESCE(?, 'aucune'), ?)`
  ).run(
    contractId, norm.underwriting_status, norm.waiting_period_days,
    norm.administrative_reservation_status, norm.reservation_notes,
    norm.exclusions_status, norm.exclusions_notes
  );
  const created = db.prepare('SELECT * FROM contract_lca WHERE contract_id = ?').get(contractId);
  return { action: 'created', data: created };
}

function serializeLca(row) {
  if (row.lca_underwriting_status == null) return null;
  return {
    underwriting_status: row.lca_underwriting_status,
    waiting_period_days: row.lca_waiting_period_days,
    administrative_reservation_status: row.lca_administrative_reservation_status,
    reservation_notes: row.lca_reservation_notes,
    exclusions_status: row.lca_exclusions_status,
    exclusions_notes: row.lca_exclusions_notes,
  };
}

function validateContract(data) {
  assert(inEnum(data.status, CONTRACT_STATUSES), 'Statut de contrat inconnu.');
  assert(inEnum(data.payment_frequency, FREQUENCIES), 'Fréquence de paiement inconnue.');
  assert(isNonNegNumber(data.annual_premium), 'La prime annuelle doit être un nombre positif.');
  assert(isNonNegNumber(data.acq_commission_rate), 'Le taux d’acquisition doit être un nombre positif.');
  assert(isNonNegNumber(data.rec_commission_rate), 'Le taux récurrent doit être un nombre positif.');
  assert(Number(data.acq_commission_rate || 0) <= 100 && Number(data.rec_commission_rate || 0) <= 100,
    'Un taux de commission ne peut pas dépasser 100 %.');
  assert(isDateStr(data.start_date), 'Date de début invalide (AAAA-MM-JJ).');
  assert(isDateStr(data.end_date), 'Date d’échéance invalide (AAAA-MM-JJ).');
  checkTextFields(data, ['policy_number', 'product_name'], 200);
  checkTextFields(data, ['notes'], 5000);
}

const FIELDS = [
  'client_id', 'company_id', 'branch', 'policy_number', 'product_name', 'annual_premium',
  'payment_frequency', 'start_date', 'end_date', 'status',
  'acq_commission_rate', 'rec_commission_rate', 'notes',
];

function pick(body) {
  const out = {};
  for (const f of FIELDS) if (f in (body || {})) out[f] = body[f] === '' ? null : body[f];
  return out;
}

contractsRouter.get('/', (req, res) => {
  const { client_id, company_id, status, branch, q } = req.query;
  let sql = `
    SELECT ct.*, co.name AS company_name,
      cl.first_name, cl.last_name, cl.company_name AS client_company, cl.type AS client_type,
      (SELECT COALESCE(SUM(amount), 0) FROM commissions WHERE contract_id = ct.id AND status = 'payee') AS commissions_paid,
      (SELECT COALESCE(SUM(amount), 0) FROM commissions WHERE contract_id = ct.id AND status = 'attendue') AS commissions_pending,
      lam.care_model AS lamal_care_model, lam.deductible AS lamal_deductible,
      lam.accident_coverage AS lamal_accident_coverage, lam.canton AS lamal_canton,
      lam.tariff_region AS lamal_tariff_region,
      lca.underwriting_status AS lca_underwriting_status, lca.waiting_period_days AS lca_waiting_period_days,
      lca.administrative_reservation_status AS lca_administrative_reservation_status,
      lca.reservation_notes AS lca_reservation_notes, lca.exclusions_status AS lca_exclusions_status,
      lca.exclusions_notes AS lca_exclusions_notes
    FROM contracts ct
    JOIN companies co ON co.id = ct.company_id
    JOIN clients cl ON cl.id = ct.client_id
    LEFT JOIN contract_lamal lam ON lam.contract_id = ct.id
    LEFT JOIN contract_lca lca ON lca.contract_id = ct.id
    WHERE 1=1`;
  const params = [];
  if (client_id) { sql += ' AND ct.client_id = ?'; params.push(client_id); }
  if (company_id) { sql += ' AND ct.company_id = ?'; params.push(company_id); }
  if (status) { sql += ' AND ct.status = ?'; params.push(status); }
  if (branch) { sql += ' AND ct.branch = ?'; params.push(branch); }
  if (q) {
    sql += ` AND (ct.policy_number LIKE ? OR ct.product_name LIKE ? OR co.name LIKE ?
             OR cl.first_name LIKE ? OR cl.last_name LIKE ? OR cl.company_name LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like);
  }
  sql += ' ORDER BY ct.created_at DESC';
  res.json(
    db.prepare(sql).all(...params).map((r) => {
      const {
        lamal_care_model, lamal_deductible, lamal_accident_coverage, lamal_canton, lamal_tariff_region,
        lca_underwriting_status, lca_waiting_period_days, lca_administrative_reservation_status,
        lca_reservation_notes, lca_exclusions_status, lca_exclusions_notes,
        ...rest
      } = r;
      return {
        ...rest,
        client_name:
          r.client_type === 'entreprise'
            ? r.client_company
            : [r.first_name, r.last_name].filter(Boolean).join(' '),
        lamal: serializeLamal(r),
        lca: serializeLca(r),
      };
    })
  );
});

// Création d'un contrat : les commissions attendues sont générées automatiquement
contractsRouter.post('/', (req, res) => {
  const data = pick(req.body);
  if (!data.client_id || !data.company_id || !data.branch) {
    return res.status(400).json({ error: 'Client, compagnie et branche sont requis.' });
  }
  if (!BRANCHES.includes(data.branch)) {
    return res.status(400).json({ error: 'Branche inconnue.' });
  }
  validateContract(data);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(data.client_id);
  if (!client) return res.status(400).json({ error: 'Client introuvable.' });

  // Détails LAMal optionnels : `lamal` absent du corps → aucune écriture ;
  // `lamal: null` n'a pas de sens à la création (rien n'existe encore) et
  // est traité comme une absence ; `lamal: {...}` → création après
  // validation stricte, uniquement si la branche est compatible.
  const lamalProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'lamal');
  const lamalBody = lamalProvided ? req.body.lamal : undefined;
  if (lamalProvided && lamalBody !== null) {
    assert(LAMAL_COMPATIBLE_BRANCHES.includes(data.branch),
      'Les détails LAMal ne peuvent être associés qu’à une branche LAMal.');
    validateLamalInput(lamalBody);
  }

  // Détails LCA optionnels : mêmes règles de présence/validation que LAMal.
  const lcaProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'lca');
  const lcaBody = lcaProvided ? req.body.lca : undefined;
  if (lcaProvided && lcaBody !== null) {
    assert(LCA_COMPATIBLE_BRANCHES.includes(data.branch),
      'Les détails LCA ne peuvent être associés qu’à une branche LCA.');
    validateLcaInput(lcaBody);
  }

  // Garde-fou conformité : pas de contrat actif sans mandat ni information LSA
  const warnings = [];
  if (!client.mandate_signed) warnings.push('Le mandat de courtage n’est pas signé.');
  if (!client.info_lsa_date) warnings.push('L’information selon l’art. 45 LSA n’a pas été remise.');
  if (!client.consent_data) warnings.push('Le consentement nLPD au traitement des données n’est pas enregistré.');

  const premium = Number(data.annual_premium) || 0;
  const acqRate = Number(data.acq_commission_rate) || 0;

  const { contractId, lamalResult, lcaResult } = db.transaction(() => {
    const fields = Object.keys(data);
    const info = db
      .prepare(`INSERT INTO contracts (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`)
      .run(...fields.map((f) => data[f]));
    const id = info.lastInsertRowid;
    // Commission d'acquisition générée automatiquement
    if (premium > 0 && acqRate > 0) {
      db.prepare(
        `INSERT INTO commissions (contract_id, type, label, amount, due_date, status)
         VALUES (?, 'acquisition', 'Commission d''acquisition', ?, ?, 'attendue')`
      ).run(id, Math.round(premium * acqRate) / 100, data.start_date || null);
    }
    const lamal = lamalProvided && lamalBody !== null ? writeLamal(id, lamalBody) : null;
    const lca = lcaProvided && lcaBody !== null ? writeLca(id, lcaBody) : null;
    return { contractId: id, lamalResult: lamal, lcaResult: lca };
  })();
  audit(req, 'création contrat', 'contract', contractId, `${data.branch} — client #${data.client_id}`);
  if (lamalResult?.action === 'created') {
    audit(req, 'création détails LAMal', 'contract', contractId, `franchise ${lamalResult.data.deductible}`);
  }
  if (lcaResult?.action === 'created') {
    audit(req, 'création détails LCA', 'contract', contractId, `statut ${lcaResult.data.underwriting_status}`);
  }
  res.status(201).json({ id: contractId, warnings });
});

contractsRouter.put('/:id', (req, res) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contrat introuvable.' });
  const data = pick(req.body);
  if ('branch' in data && !BRANCHES.includes(data.branch)) {
    return res.status(400).json({ error: 'Branche inconnue.' });
  }
  validateContract(data);

  // Détails LAMal optionnels : `lamal` absent du corps → aucune écriture
  // (règle 7) ; `lamal: null` → suppression explicite (règle 8) ;
  // `lamal: {...}` → création ou mise à jour après validation stricte.
  const lamalProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'lamal');
  const lamalBody = lamalProvided ? req.body.lamal : undefined;
  const lcaProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'lca');
  const lcaBody = lcaProvided ? req.body.lca : undefined;

  if (Object.keys(data).length === 0 && !lamalProvided && !lcaProvided) return res.json({ ok: true });

  const finalBranch = 'branch' in data ? data.branch : contract.branch;

  if (lamalProvided && lamalBody !== null) {
    assert(LAMAL_COMPATIBLE_BRANCHES.includes(finalBranch),
      'Les détails LAMal ne peuvent être associés qu’à une branche LAMal.');
    validateLamalInput(lamalBody);
  }
  if (lcaProvided && lcaBody !== null) {
    assert(LCA_COMPATIBLE_BRANCHES.includes(finalBranch),
      'Les détails LCA ne peuvent être associés qu’à une branche LCA.');
    validateLcaInput(lcaBody);
  }

  // Changement de branche vers une branche incompatible alors qu'une ligne
  // contract_lamal ou contract_lca existe déjà : refusé, sauf suppression
  // explicite du bloc concerné dans la même requête (lamal/lca: null).
  if ('branch' in data && !LAMAL_COMPATIBLE_BRANCHES.includes(finalBranch)) {
    const existingLamal = db.prepare('SELECT contract_id FROM contract_lamal WHERE contract_id = ?').get(contract.id);
    const explicitlyCleared = lamalProvided && lamalBody === null;
    if (existingLamal && !explicitlyCleared) {
      return res.status(400).json({
        error: 'Ce contrat a des détails LAMal enregistrés ; supprimez-les explicitement (lamal: null) avant de changer de branche.',
      });
    }
  }
  if ('branch' in data && !LCA_COMPATIBLE_BRANCHES.includes(finalBranch)) {
    const existingLca = db.prepare('SELECT contract_id FROM contract_lca WHERE contract_id = ?').get(contract.id);
    const explicitlyCleared = lcaProvided && lcaBody === null;
    if (existingLca && !explicitlyCleared) {
      return res.status(400).json({
        error: 'Ce contrat a des détails LCA enregistrés ; supprimez-les explicitement (lca: null) avant de changer de branche.',
      });
    }
  }

  const fields = Object.keys(data);
  const { lamalResult, lcaResult } = db.transaction(() => {
    if (fields.length > 0) {
      db.prepare(
        `UPDATE contracts SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`
      ).run(...fields.map((f) => data[f]), contract.id);
    }
    return {
      lamalResult: lamalProvided ? writeLamal(contract.id, lamalBody) : null,
      lcaResult: lcaProvided ? writeLca(contract.id, lcaBody) : null,
    };
  })();

  if (fields.length > 0) audit(req, 'modification contrat', 'contract', contract.id, fields.join(', '));
  if (lamalResult?.action === 'created') {
    audit(req, 'création détails LAMal', 'contract', contract.id, `franchise ${lamalResult.data.deductible}`);
  } else if (lamalResult?.action === 'updated') {
    audit(req, 'modification détails LAMal', 'contract', contract.id, `franchise ${lamalResult.data.deductible}`);
  } else if (lamalResult?.action === 'deleted') {
    audit(req, 'suppression détails LAMal', 'contract', contract.id);
  }
  if (lcaResult?.action === 'created') {
    audit(req, 'création détails LCA', 'contract', contract.id, `statut ${lcaResult.data.underwriting_status}`);
  } else if (lcaResult?.action === 'updated') {
    audit(req, 'modification détails LCA', 'contract', contract.id, `statut ${lcaResult.data.underwriting_status}`);
  } else if (lcaResult?.action === 'deleted') {
    audit(req, 'suppression détails LCA', 'contract', contract.id);
  }
  res.json({ ok: true });
});

contractsRouter.delete('/:id', (req, res) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contrat introuvable.' });
  const paid = db
    .prepare("SELECT COUNT(*) AS n FROM commissions WHERE contract_id = ? AND status = 'payee'")
    .get(contract.id).n;
  if (paid > 0) {
    return res.status(400).json({
      error: 'Des commissions payées sont liées à ce contrat (conservation comptable 10 ans, art. 958f CO). Passez-le en « résilié » plutôt que de le supprimer.',
    });
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM commissions WHERE contract_id = ?').run(contract.id);
    db.prepare('DELETE FROM tasks WHERE contract_id = ?').run(contract.id);
    db.prepare('DELETE FROM contracts WHERE id = ?').run(contract.id);
  });
  tx();
  audit(req, 'suppression contrat', 'contract', contract.id, contract.policy_number || '');
  res.json({ ok: true });
});
