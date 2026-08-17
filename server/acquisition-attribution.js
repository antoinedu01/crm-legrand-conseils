// A4.2 — Resolver d'attribution Acquisition, service pur/métier isolé.
//
// Aucun Router Express, aucune dépendance au corps d'une requête HTTP,
// aucun effet de bord à l'import (mêmes conventions que
// server/appointments-pipeline.js, lot A2d1). READ-ONLY DB : aucun INSERT,
// UPDATE ou DELETE — ce module ne crée ni ne modifie jamais
// lead_attribution/lead_details/clients. La persistance sera assurée par un
// lot ultérieur (A4.3), pas ici.
//
// Résout, quand possible, des clés brutes de tracking (campaign_key,
// channel_key) vers des identifiants réels (campaigns.id, channels.id) par
// correspondance EXACTE uniquement (jamais via campaigns.name/channels.name,
// jamais via LIKE) — voir server/routes/campaigns.js / server/db.js
// (migration 17) pour la définition de campaigns.key.
//
// Règle absolue : une clé inconnue ou absente ne déclenche JAMAIS
// d'exception et ne bloque jamais la résolution — seul un identifiant NULL
// en résulte, jamais un rejet. Une véritable erreur technique de la base de
// données (ex. connexion invalide) n'est en revanche jamais avalée : elle
// remonte telle quelle à l'appelant, un "inconnu" métier n'est pas la même
// chose qu'une panne.
//
// Aucun accès à consents, ni à households/advisory_sessions/
// advisory_questionnaires/advisory_answers/advisory_findings/
// advisory_recommendations — aucune donnée Diagnostic 360/santé.
//
// Le fallback métier "site_internet" n'appartient volontairement PAS à ce
// module : il reste un mécanisme de résolution générique et réutisable,
// le choix d'un canal par défaut est la responsabilité du consommateur
// (server/routes/public.js, prévu pour un lot A4.3).

function normalizeKey(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Résout une attribution de lead à partir de clés brutes de tracking.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ campaignKey?: string|null, channelKey?: string|null }} input
 * @returns {{
 *   campaignId: number|null,
 *   channelId: number|null,
 *   rawCampaignKey: string|null,
 *   rawChannelKey: string|null,
 *   campaignMatched: boolean,
 *   channelMatched: boolean,
 *   resolution: 'none'|'campaign'|'channel_only'|'unresolved',
 * }}
 */
export function resolveLeadAttribution(db, input) {
  const rawCampaignKey = normalizeKey(input?.campaignKey);
  const rawChannelKey = normalizeKey(input?.channelKey);

  // Correspondance EXACTE uniquement (campaigns.key/channels.key), jamais
  // via le nom affiché — voir migration 17 (campaigns.key, indépendante de
  // campaigns.name).
  const campaign = rawCampaignKey != null
    ? db.prepare('SELECT id, channel_id FROM campaigns WHERE key = ?').get(rawCampaignKey) || null
    : null;
  const channel = rawChannelKey != null
    ? db.prepare('SELECT id FROM channels WHERE key = ?').get(rawChannelKey) || null
    : null;

  let campaignId = null;
  let channelId = null;
  const campaignMatched = campaign != null;
  let channelMatched = false;

  if (campaignMatched) {
    // Règle de priorité (§6) : une campagne connue est la source de vérité
    // pour le canal — son channel_id l'emporte toujours sur un raw
    // channelKey éventuellement différent, jamais de couple incohérent.
    campaignId = campaign.id;
    if (campaign.channel_id != null) {
      channelId = campaign.channel_id;
      channelMatched = true;
    } else if (channel != null) {
      // Campagne connue mais sans canal propre (§7) : on tente la
      // résolution indépendante du raw channelKey, sans jamais inventer de
      // canal que la campagne ne porte pas elle-même.
      channelId = channel.id;
      channelMatched = true;
    }
  } else if (channel != null) {
    // Campagne absente ou inconnue : le canal se résout indépendamment.
    channelId = channel.id;
    channelMatched = true;
  }

  let resolution;
  if (rawCampaignKey == null && rawChannelKey == null) {
    resolution = 'none';
  } else if (campaignMatched) {
    resolution = 'campaign';
  } else if (channelMatched) {
    resolution = 'channel_only';
  } else {
    resolution = 'unresolved';
  }

  return {
    campaignId,
    channelId,
    rawCampaignKey,
    rawChannelKey,
    campaignMatched,
    channelMatched,
    resolution,
  };
}
