// Service métier isolé (Acquisition OS, lot A2d1) — synchronisation minimale
// entre un rendez-vous réservé et le pipeline commercial (lead_details).
//
// Aucune dépendance à Express (pas de req/res/Router/middleware) : ce
// fichier reçoit explicitement ses dépendances (db) et retourne un objet
// descriptif, jamais une réponse HTTP. Il n'est appelé par AUCUNE route à
// ce stade (ni appointments.js, ni today.js) — brique non branchée.
//
// Règle métier unique reproduite (et volontairement corrigée sur un point
// précis, voir plus bas) à partir de POST /api/today/result,
// result = 'rdv_pris' (server/routes/today.js) :
// « Lorsqu'un rendez-vous réel est réservé pour un client qui est encore
// un prospect, son lead_details.pipeline_stage peut passer à 'rdv'. »
//
// Fidèlement repris de today.js :
// - seul un client au statut 'prospect' est concerné ; tout autre statut
//   (client, ancien, anonymise) laisse pipeline_stage intact ;
// - si lead_details n'existe pas encore pour ce client, une nouvelle ligne
//   est créée avec pipeline_stage = 'rdv' (comportement réel de today.js,
//   non une extension).
//
// Différence assumée par rapport à today.js (validée explicitement avant
// implémentation, cf. rapport A2d1) : today.js écrase aujourd'hui
// pipeline_stage vers 'rdv' sans jamais vérifier la valeur actuelle — un
// prospect déjà à 'analyse'/'offre'/'signe'/'perdu' y recule vers 'rdv'.
// Ce service applique au contraire une règle anti-régression : un
// prospect déjà plus avancé que 'rdv' n'y retourne jamais automatiquement.
//
// Ce que ce service NE fait PAS (hors périmètre du lot A2d1) : aucune
// tâche, aucune activity, aucun action_log, aucun audit() — ces effets
// resteront la responsabilité de la route/orchestration qui appellera ce
// service, pas de la brique métier elle-même.

// Stages considérés comme plus avancés que 'rdv' : un rendez-vous qui vient
// d'être réservé ne doit jamais faire reculer un prospect déjà rendu là.
const ADVANCED_STAGES = ['analyse', 'offre', 'signe', 'perdu'];

/**
 * Synchronise lead_details.pipeline_stage suite à la réservation d'un
 * rendez-vous réel pour un client. Ne modifie jamais tasks, activities,
 * action_log, ni aucun autre champ de clients/lead_details que
 * pipeline_stage (et updated_at). Idempotent : un second appel dans le
 * même état ne produit aucun changement supplémentaire.
 *
 * Une seule instruction SQL (INSERT xor UPDATE) est exécutée par appel :
 * aucune transaction dédiée n'est nécessaire, SQLite garantissant déjà
 * l'atomicité d'une instruction unique.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} clientId
 * @returns {{ changed: boolean, previousStage: string|null, nextStage: string|null, reason: string }}
 */
export function syncPipelineOnAppointmentBooked(db, clientId) {
  const client = db.prepare('SELECT id, status FROM clients WHERE id = ?').get(clientId);
  if (!client) {
    return { changed: false, previousStage: null, nextStage: null, reason: 'client introuvable' };
  }
  if (client.status !== 'prospect') {
    return {
      changed: false,
      previousStage: null,
      nextStage: null,
      reason: `client non prospect (status = ${client.status})`,
    };
  }

  const lead = db.prepare('SELECT pipeline_stage FROM lead_details WHERE client_id = ?').get(clientId);
  // Un client sans lead_details est déjà traité comme 'nouveau' partout
  // ailleurs dans le projet (voir prospects.js, today.js : `pipeline_stage
  // || 'nouveau'`) — même convention reprise ici.
  const previousStage = lead ? lead.pipeline_stage : 'nouveau';

  if (ADVANCED_STAGES.includes(previousStage)) {
    return {
      changed: false,
      previousStage,
      nextStage: previousStage,
      reason: 'stage déjà plus avancé que rdv — aucune régression automatique',
    };
  }

  if (previousStage === 'rdv') {
    return { changed: false, previousStage, nextStage: 'rdv', reason: 'déjà au stage rdv (idempotent)' };
  }

  // previousStage ∈ {'nouveau', 'contacte'} → passage à 'rdv', reproduisant
  // exactement l'écriture de POST /api/today/result (result = 'rdv_pris').
  if (lead) {
    db.prepare("UPDATE lead_details SET pipeline_stage = 'rdv', updated_at = datetime('now') WHERE client_id = ?").run(clientId);
  } else {
    db.prepare("INSERT INTO lead_details (client_id, pipeline_stage) VALUES (?, 'rdv')").run(clientId);
  }
  return {
    changed: true,
    previousStage,
    nextStage: 'rdv',
    reason: 'rendez-vous réservé — passage automatique au stage rdv',
  };
}
