import db from './db.js';

// Scoring des prospects : chaque règle active ajoute (ou retire) des points,
// et la liste des raisons est TOUJOURS renvoyée avec le score — le courtier
// voit pourquoi un prospect est classé ainsi. Le score organise le travail,
// il ne prend aucune décision à la place du conseiller.

export function loadRules() {
  return db.prepare('SELECT * FROM scoring_rules ORDER BY sort').all();
}

// p : { lead: {...lead_details, channel_key}, email, phone, last_activity_at }
export function computeScore(p, rules = loadRules()) {
  const reasons = [];
  const lead = p.lead || {};
  const now = Date.now();
  const lastActivity = p.last_activity_at ? new Date(p.last_activity_at.replace(' ', 'T') + 'Z').getTime() : null;
  const daysSince = lastActivity ? (now - lastActivity) / 86_400_000 : null;

  const checks = {
    recommande: () => Boolean(lead.referrer_client_id) || lead.channel_key === 'recommandations',
    besoin_identifie: () => Boolean(lead.main_need),
    urgent: () => Boolean(lead.urgent),
    rdv_fixe: () => lead.pipeline_stage === 'rdv' || lead.pipeline_stage === 'analyse',
    offre_en_cours: () => lead.pipeline_stage === 'offre',
    coordonnees_completes: () => Boolean(p.email) && Boolean(p.phone),
    profil_complet: () => Boolean(lead.age_range) && Boolean(lead.work_situation),
    plage_contact: () => Boolean(lead.contact_pref),
    echange_recent: () => daysSince != null && daysSince <= 14,
    sans_suivi_30j: () => daysSince == null || daysSince > 30,
  };

  let score = 0;
  for (const rule of rules) {
    if (!rule.active) continue;
    const check = checks[rule.key];
    if (check && check()) {
      score += rule.points;
      reasons.push({ label: rule.label, points: rule.points });
    }
  }
  score = Math.max(0, score);

  let classement = 'non_qualifie';
  if (score >= 65) classement = 'prioritaire';
  else if (score >= 45) classement = 'chaud';
  else if (score >= 25) classement = 'tiede';
  else if (score >= 10) classement = 'froid';

  return { score, classement, reasons };
}
