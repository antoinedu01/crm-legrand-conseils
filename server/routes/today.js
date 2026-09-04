import { Router } from 'express';
import db from '../db.js';
import { audit } from '../audit.js';
import { loadRules, computeScore } from '../scoring.js';
import { syncPipelineOnAppointmentBooked } from '../appointments-pipeline.js';

export const todayRouter = Router();

// ------- helpers -------

function displayName(c) {
  return c.type === 'entreprise'
    ? c.company_name || '(entreprise)'
    : [c.first_name, c.last_name].filter(Boolean).join(' ') || '(sans nom)';
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const t = new Date(dateStr.replace(' ', 'T') + (dateStr.length === 10 ? 'T00:00:00Z' : 'Z')).getTime();
  return (Date.now() - t) / 86_400_000;
}

// Une action déjà traitée récemment (journal) n'est pas reproposée pendant `windowDays`
function recentlyLogged(actionKey, windowDays) {
  const row = db
    .prepare(
      `SELECT 1 FROM action_log WHERE action_key = ?
       AND created_at >= datetime('now', ?) LIMIT 1`
    )
    .get(actionKey, `-${windowDays} days`);
  return Boolean(row);
}

// ------- construction du plan d'action du jour -------

todayRouter.get('/', (req, res) => {
  const actions = [];
  const rules = loadRules();
  const todayStr = new Date().toISOString().slice(0, 10);

  // Prospects avec origine + dernière activité
  const prospects = db
    .prepare(
      `SELECT c.id, c.type, c.first_name, c.last_name, c.company_name, c.email, c.phone,
        c.created_at,
        ld.channel_id, ld.referrer_client_id, ld.pipeline_stage, ld.main_need,
        ld.age_range, ld.work_situation, ld.contact_pref, ld.urgent,
        ch.name AS channel_name, ch.key AS channel_key,
        (SELECT MAX(a.created_at) FROM activities a WHERE a.client_id = c.id) AS last_activity_at
       FROM clients c
       LEFT JOIN lead_details ld ON ld.client_id = c.id
       LEFT JOIN channels ch ON ch.id = ld.channel_id
       WHERE c.status = 'prospect'`
    )
    .all();

  for (const p of prospects) {
    const stage = p.pipeline_stage || 'nouveau';
    const name = displayName(p);
    const { score, classement } = computeScore(
      {
        lead: { ...p, pipeline_stage: stage },
        email: p.email, phone: p.phone, last_activity_at: p.last_activity_at,
      },
      rules
    );
    const idle = daysSince(p.last_activity_at);

    if (stage === 'nouveau') {
      const key = `nouveau:${p.id}`;
      if (!recentlyLogged(key, 2)) {
        actions.push({
          key, type: 'nouveau_prospect', priority: score >= 45 || p.urgent ? 'haute' : 'normale',
          date: p.created_at.slice(0, 10), client_id: p.id, client_name: name,
          reason: `Nouveau prospect${p.channel_name ? ` (${p.channel_name})` : ''}${p.main_need ? ` — ${p.main_need}` : ''}`,
          objective: 'Premier contact sous 24 h : se présenter et fixer un rendez-vous',
          contact_pref: p.contact_pref,
        });
      }
    } else if ((classement === 'chaud' || classement === 'prioritaire')
      && ['contacte', 'analyse'].includes(stage) && (idle == null || idle >= 3)) {
      const key = `relance_prioritaire:${p.id}`;
      if (!recentlyLogged(key, 3)) {
        actions.push({
          key, type: 'relance_prioritaire', priority: 'haute',
          date: todayStr, client_id: p.id, client_name: name,
          reason: `Prospect ${classement} (${score} pts) sans échange depuis ${idle == null ? 'le début' : Math.floor(idle) + ' jours'}`,
          objective: 'Relancer pour avancer vers le rendez-vous ou l’analyse',
          contact_pref: p.contact_pref,
        });
      }
    } else if (stage === 'offre' && (idle == null || idle >= 5)) {
      const key = `relance_offre:${p.id}`;
      if (!recentlyLogged(key, 4)) {
        actions.push({
          key, type: 'relance_offre', priority: 'haute',
          date: todayStr, client_id: p.id, client_name: name,
          reason: `Offre envoyée sans réponse${idle != null ? ` depuis ${Math.floor(idle)} jours` : ''}`,
          objective: 'Relancer l’offre : répondre aux questions, lever les hésitations',
          contact_pref: p.contact_pref,
        });
      }
    } else if (stage === 'rdv') {
      const key = `confirmation_rdv:${p.id}`;
      if (!recentlyLogged(key, 3)) {
        actions.push({
          key, type: 'confirmation_rdv', priority: 'normale',
          date: todayStr, client_id: p.id, client_name: name,
          reason: 'Rendez-vous fixé',
          objective: 'Confirmer le rendez-vous et préparer l’entretien (documents, questions)',
        });
      }
    }
  }

  // Tâches en retard et du jour
  const tasks = db
    .prepare(
      `SELECT t.*, c.type, c.first_name, c.last_name, c.company_name
       FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
       WHERE t.status = 'ouverte' AND t.due_date IS NOT NULL AND t.due_date <= ?`
    )
    .all(todayStr);
  for (const t of tasks) {
    const overdue = t.due_date < todayStr;
    actions.push({
      key: `tache:${t.id}`, type: overdue ? 'tache_retard' : 'tache_du_jour',
      priority: overdue || t.priority === 'haute' ? 'haute' : 'normale',
      date: t.due_date, task_id: t.id,
      client_id: t.client_id || null,
      client_name: t.client_id ? displayName(t) : null,
      reason: overdue ? `En retard : ${t.title}` : t.title,
      objective: t.description || 'Terminer cette tâche planifiée',
    });
  }

  // Anniversaires de contrats (21 prochains jours)
  const contracts = db
    .prepare(
      `SELECT ct.id, ct.start_date, ct.branch, ct.policy_number, ct.client_id,
        c.type, c.first_name, c.last_name, c.company_name, co.name AS company_name
       FROM contracts ct
       JOIN clients c ON c.id = ct.client_id
       JOIN companies co ON co.id = ct.company_id
       WHERE ct.status = 'actif' AND ct.start_date IS NOT NULL AND c.status != 'anonymise'`
    )
    .all();
  const now = new Date();
  for (const ct of contracts) {
    const start = new Date(ct.start_date + 'T00:00:00');
    if (Number.isNaN(start.getTime())) continue;
    const anniv = new Date(now.getFullYear(), start.getMonth(), start.getDate());
    if (anniv < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      anniv.setFullYear(anniv.getFullYear() + 1);
    }
    const inDays = (anniv - now) / 86_400_000;
    if (inDays <= 21 && anniv.getFullYear() > start.getFullYear()) {
      const key = `anniversaire:${ct.id}`;
      if (!recentlyLogged(key, 300)) {
        actions.push({
          key, type: 'anniversaire_contrat', priority: 'normale',
          date: anniv.toISOString().slice(0, 10),
          client_id: ct.client_id, client_name: displayName(ct), contract_id: ct.id,
          reason: `Anniversaire du contrat ${ct.policy_number || ct.branch} (${ct.company_name})`,
          objective: 'Message d’anniversaire + proposer la revue annuelle du dossier',
        });
      }
    }
  }

  // Clients sans suivi depuis 6 mois
  const dormant = db
    .prepare(
      `SELECT c.id, c.type, c.first_name, c.last_name, c.company_name,
        (SELECT MAX(a.created_at) FROM activities a WHERE a.client_id = c.id) AS last_activity_at,
        c.created_at
       FROM clients c WHERE c.status = 'client'`
    )
    .all();
  for (const c of dormant) {
    const idle = daysSince(c.last_activity_at || c.created_at);
    if (idle != null && idle >= 180) {
      const key = `prise_nouvelles:${c.id}`;
      if (!recentlyLogged(key, 150)) {
        actions.push({
          key, type: 'prise_nouvelles', priority: 'basse',
          date: todayStr, client_id: c.id, client_name: displayName(c),
          reason: `Client sans contact depuis ${Math.floor(idle / 30)} mois`,
          objective: 'Prendre des nouvelles et vérifier que la situation n’a pas changé',
        });
      }
    }
  }

  // Vente complémentaire : clients actifs sans couverture incapacité de gain
  const crossSell = db
    .prepare(
      `SELECT c.id, c.type, c.first_name, c.last_name, c.company_name
       FROM clients c
       WHERE c.status = 'client' AND c.type = 'particulier'
         AND EXISTS (SELECT 1 FROM contracts ct WHERE ct.client_id = c.id AND ct.status = 'actif')
         AND NOT EXISTS (SELECT 1 FROM contracts ct WHERE ct.client_id = c.id
           AND ct.status = 'actif' AND ct.branch = 'incapacite')`
    )
    .all();
  for (const c of crossSell) {
    const key = `vente_complementaire:${c.id}`;
    if (!recentlyLogged(key, 180)) {
      actions.push({
        key, type: 'vente_complementaire', priority: 'basse',
        date: todayStr, client_id: c.id, client_name: displayName(c),
        reason: 'Client sans couverture incapacité de gain',
        objective: 'Proposer une analyse de la lacune de revenu en cas d’incapacité — après analyse complète des besoins',
      });
    }
  }

  // Développement de portefeuille — mono-produit santé <-> prévoyance
  // (Lot 1, priorisation par seuil ajoutée en Lot 3). Même construction que
  // la « Vente complémentaire » ci-dessus, dans les deux sens, sur les deux
  // groupes de branches LAMal/LCA et vie_3a/vie_3b. `held_premium` est la
  // somme des primes actives du groupe DÉJÀ détenu par le client (pas du
  // groupe manquant) — sert de proxy de valeur/potentiel pour la
  // priorisation, seuils différenciés par branche (décision humaine) :
  // LAMal/LCA >= CHF 1'500/an, vie_3a/vie_3b >= CHF 4'000/an. Au-dessus du
  // seuil -> priorité 'normale' ; en dessous -> 'basse', comme avant ce
  // lot. Jamais 'haute' : réservée aux échéances proches et aux prospects
  // urgents ailleurs dans ce fichier.
  const PREVOYANCE_GAP_PREMIUM_THRESHOLD_CHF = 1500;
  const SANTE_GAP_PREMIUM_THRESHOLD_CHF = 4000;

  const manquePrevoyance = db
    .prepare(
      `SELECT c.id, c.type, c.first_name, c.last_name, c.company_name,
        (SELECT COALESCE(SUM(ct2.annual_premium), 0) FROM contracts ct2
          WHERE ct2.client_id = c.id AND ct2.status = 'actif'
            AND ct2.branch IN ('lamal', 'lca')) AS held_premium
       FROM clients c
       WHERE c.status = 'client' AND c.type = 'particulier'
         AND EXISTS (SELECT 1 FROM contracts ct WHERE ct.client_id = c.id
           AND ct.status = 'actif' AND ct.branch IN ('lamal', 'lca'))
         AND NOT EXISTS (SELECT 1 FROM contracts ct WHERE ct.client_id = c.id
           AND ct.status = 'actif' AND ct.branch IN ('vie_3a', 'vie_3b'))`
    )
    .all();
  for (const c of manquePrevoyance) {
    const key = `manque_prevoyance:${c.id}`;
    if (!recentlyLogged(key, 180)) {
      actions.push({
        key, type: 'manque_prevoyance',
        priority: c.held_premium >= PREVOYANCE_GAP_PREMIUM_THRESHOLD_CHF ? 'normale' : 'basse',
        date: todayStr, client_id: c.id, client_name: displayName(c),
        reason: 'Client avec assurance maladie (LAMal/LCA), sans prévoyance liée ou libre (3a/3b)',
        objective: 'Proposer une analyse de la situation de prévoyance — après analyse complète des besoins',
      });
    }
  }

  const manqueSante = db
    .prepare(
      `SELECT c.id, c.type, c.first_name, c.last_name, c.company_name,
        (SELECT COALESCE(SUM(ct2.annual_premium), 0) FROM contracts ct2
          WHERE ct2.client_id = c.id AND ct2.status = 'actif'
            AND ct2.branch IN ('vie_3a', 'vie_3b')) AS held_premium
       FROM clients c
       WHERE c.status = 'client' AND c.type = 'particulier'
         AND EXISTS (SELECT 1 FROM contracts ct WHERE ct.client_id = c.id
           AND ct.status = 'actif' AND ct.branch IN ('vie_3a', 'vie_3b'))
         AND NOT EXISTS (SELECT 1 FROM contracts ct WHERE ct.client_id = c.id
           AND ct.status = 'actif' AND ct.branch IN ('lamal', 'lca'))`
    )
    .all();
  for (const c of manqueSante) {
    const key = `manque_sante:${c.id}`;
    if (!recentlyLogged(key, 180)) {
      actions.push({
        key, type: 'manque_sante',
        priority: c.held_premium >= SANTE_GAP_PREMIUM_THRESHOLD_CHF ? 'normale' : 'basse',
        date: todayStr, client_id: c.id, client_name: displayName(c),
        reason: 'Client avec prévoyance liée ou libre (3a/3b), sans assurance maladie (LAMal/LCA) chez nous',
        objective: 'Proposer une analyse de la couverture maladie — après analyse complète des besoins',
      });
    }
  }

  // Développement de portefeuille — échéances de contrat actionnables
  // (Lot 2). Même fenêtre de 90 jours que le widget « Échéances sous 90
  // jours » du tableau de bord (server/routes/dashboard.js, inchangé — il
  // reste un coup d'œil informatif) ; ceci en est la version actionnable,
  // dans le plan du jour. Fenêtre de dé-doublonnage volontairement plus
  // courte (30 jours) que les autres règles de ce fichier : sur une
  // échéance à 90 jours, laisser l'action disparaître pendant 180 jours
  // comme `vente_complementaire` la ferait disparaître jusqu'après la date
  // d'échéance elle-même. 30 jours permet à l'action de ressurgir une ou
  // deux fois avant l'échéance réelle si elle n'a pas été résolue entre
  // deux passages. Priorité : `haute` à moins de 30 jours de l'échéance
  // (ou déjà dépassée), `normale` au-delà.
  const expiringContracts = db
    .prepare(
      `SELECT ct.id, ct.end_date, ct.branch, ct.policy_number, ct.client_id,
        c.type, c.first_name, c.last_name, c.company_name, co.name AS company_name
       FROM contracts ct
       JOIN clients c ON c.id = ct.client_id
       JOIN companies co ON co.id = ct.company_id
       WHERE ct.status = 'actif' AND ct.end_date IS NOT NULL
         AND ct.end_date <= date('now', '+90 days') AND c.status != 'anonymise'`
    )
    .all();
  for (const ct of expiringContracts) {
    const key = `echeance:${ct.id}`;
    if (!recentlyLogged(key, 30)) {
      const daysLeft = Math.round(
        (new Date(ct.end_date + 'T00:00:00') - new Date(todayStr + 'T00:00:00')) / 86_400_000
      );
      let reason;
      if (daysLeft < 0) {
        reason = `Échéance du contrat ${ct.policy_number || ct.branch} (${ct.company_name}) dépassée depuis ${Math.abs(daysLeft)} jour${Math.abs(daysLeft) > 1 ? 's' : ''}`;
      } else if (daysLeft === 0) {
        reason = `Échéance du contrat ${ct.policy_number || ct.branch} (${ct.company_name}) aujourd’hui`;
      } else {
        reason = `Échéance du contrat ${ct.policy_number || ct.branch} (${ct.company_name}) dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''}`;
      }
      actions.push({
        key, type: 'echeance_contrat', priority: daysLeft <= 30 ? 'haute' : 'normale',
        date: ct.end_date,
        client_id: ct.client_id, client_name: displayName(ct), contract_id: ct.id,
        reason,
        objective: 'Préparer une révision avant l’échéance plutôt que découvrir un départ après coup',
      });
    }
  }

  // Demandes de recommandation : contrat signé il y a moins de 45 jours
  const freshContracts = db
    .prepare(
      `SELECT DISTINCT c.id, c.type, c.first_name, c.last_name, c.company_name
       FROM contracts ct JOIN clients c ON c.id = ct.client_id
       WHERE ct.status = 'actif' AND ct.created_at >= datetime('now', '-45 days')
         AND c.status = 'client' AND c.consent_data = 1`
    )
    .all();
  for (const c of freshContracts) {
    const key = `recommandation:${c.id}`;
    if (!recentlyLogged(key, 365)) {
      actions.push({
        key, type: 'demande_recommandation', priority: 'normale',
        date: todayStr, client_id: c.id, client_name: displayName(c),
        reason: 'Contrat signé récemment — moment idéal pour une recommandation',
        objective: 'Demander si une personne de son entourage aurait besoin des mêmes conseils (avec son accord)',
      });
    }
  }

  const order = { haute: 0, normale: 1, basse: 2 };
  actions.sort((a, b) => order[a.priority] - order[b.priority] || (a.date < b.date ? -1 : 1));
  res.json(actions.slice(0, 60));
});

// ------- résultat d'une action → journal + prochaine étape automatique -------

const RESULTS = {
  fait: 'Fait',
  rdv_pris: 'Rendez-vous pris',
  pas_joint: 'Pas joint',
  a_relancer: 'À relancer plus tard',
  sans_suite: 'Sans suite / refus',
};

todayRouter.post('/result', (req, res) => {
  const { action_key, action_type, client_id, contract_id, task_id, result, note } = req.body || {};
  if (!action_key || !RESULTS[result]) {
    return res.status(400).json({ error: 'Action et résultat valide requis.' });
  }
  const client = client_id ? db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id) : null;
  const name = client ? displayName(client) : null;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO action_log (action_key, action_type, client_id, contract_id, result, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(action_key, action_type || null, client_id || null, contract_id || null, result, note || null);

    // Lot 2 — développement de portefeuille : horodate la dernière fois
    // qu'un contrat proche de l'échéance a été traité depuis le plan du
    // jour, uniquement pour ce type d'action précis et uniquement quand un
    // résultat est explicitement logué ici par le conseiller (quel que
    // soit le résultat choisi). Ne touche jamais review_next_date : aucune
    // cadence ni planification automatique n'est introduite par ce lot.
    if (action_type === 'echeance_contrat' && contract_id) {
      db.prepare(
        "UPDATE contracts SET review_last_date = date('now'), updated_at = datetime('now') WHERE id = ?"
      ).run(contract_id);
    }

    if (client) {
      db.prepare('INSERT INTO activities (client_id, type, content) VALUES (?, ?, ?)').run(
        client.id, 'note',
        `Action commerciale — résultat : ${RESULTS[result]}${note ? ` · ${note}` : ''}`
      );
    }
    if (task_id && result === 'fait') {
      db.prepare("UPDATE tasks SET status = 'terminee', completed_at = datetime('now') WHERE id = ?").run(task_id);
    }

    let next = 'Action enregistrée.';
    const due = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    if (result === 'pas_joint' && client) {
      db.prepare('INSERT INTO tasks (title, due_date, priority, client_id) VALUES (?, ?, ?, ?)').run(
        `Rappeler ${name}`, due(2), 'normale', client.id);
      next = `Pas de réponse — une tâche « Rappeler ${name} » a été créée pour dans 2 jours.`;
    } else if (result === 'rdv_pris' && client) {
      db.prepare('INSERT INTO tasks (title, due_date, priority, client_id) VALUES (?, ?, ?, ?)').run(
        `Préparer et confirmer le RDV avec ${name}`, due(1), 'haute', client.id);
      // Unique autorité pour cette règle (voir server/appointments-pipeline.js) :
      // nouveau/contacte -> rdv ; jamais de régression depuis
      // analyse/offre/signe/perdu ; lead_details absent -> créé avec rdv.
      // Ne crée aucun appointment réel : today.js ne dispose d'aucune date
      // ni heure pour ce "rendez-vous pris" déclaratif.
      syncPipelineOnAppointmentBooked(db, client.id);
      next = `Bravo ! Le prospect passe à l'étape « RDV fixé » et une tâche de préparation a été créée pour demain.`;
    } else if (result === 'a_relancer' && client) {
      db.prepare('INSERT INTO tasks (title, due_date, priority, client_id) VALUES (?, ?, ?, ?)').run(
        `Relancer ${name}`, due(7), 'normale', client.id);
      next = `Une tâche « Relancer ${name} » a été créée pour dans 7 jours.`;
    } else if (result === 'sans_suite') {
      next = 'Noté. Si le dossier est définitivement clos, passez le prospect à l’étape « Perdu » dans le pipeline.';
    } else if (result === 'fait') {
      next = 'Parfait, action terminée. ✅';
    }
    return next;
  });
  const next = tx();
  audit(req, 'résultat action commerciale', 'client', client_id || null, `${action_type || action_key} → ${result}`);
  res.json({ ok: true, next });
});
