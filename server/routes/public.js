import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import db from '../db.js';
import { audit } from '../audit.js';
import { isEmail, normEmail, normPhone } from '../validate.js';
import { resolveLeadAttribution } from '../acquisition-attribution.js';

// Point d'entrée PUBLIC des formulaires du site legrandconseils.ch.
// Protections : origines autorisées uniquement (CORS), limitation de débit,
// champ-piège anti-robots, validation stricte, consentement obligatoire et
// horodaté, détection de doublons, journal d'audit. Aucune donnée santé.

const ALLOWED_ORIGINS = (
  process.env.SITE_ORIGINS || 'https://legrandconseils.ch,https://www.legrandconseils.ch'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const publicRouter = Router();

// CORS restreint aux origines du site
publicRouter.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return res.status(403).json({ error: 'Origine non autorisée.' });
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

publicRouter.use(
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: Number(process.env.PUBLIC_RATE_LIMIT) || 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Trop de demandes. Réessayez plus tard ou appelez-nous directement.' },
  })
);

const MAIN_NEEDS = [
  'LAMal / caisse maladie', 'Complémentaires LCA', 'Prévoyance 3a', 'Prévoyance 3b',
  'Assurance vie', 'Incapacité de gain', 'Risque décès', 'Protection famille',
  'Résiliation / changement d’assurance', 'Bilan de prévoyance complet', 'Autre',
];

// Tracking Acquisition A4.3 : mêmes conventions que le reste de ce fichier
// (troncature systématique via slice, jamais un rejet 400) — appliquées ici
// avec, en plus, une normalisation trim -> chaîne vide/espaces -> null,
// cohérente avec server/acquisition-attribution.js (A4.2). Aucune valeur de
// tracking n'est jamais requise ni cause de rejet : un tracking inconnu ou
// absent ne doit jamais empêcher la création d'un lead.
function normalizeTrackingText(raw, maxLen) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === '') return null;
  return trimmed.slice(0, maxLen);
}

publicRouter.post('/lead', (req, res) => {
  const b = req.body || {};

  // Champ-piège : un humain ne le remplit jamais (invisible) — on répond ok sans rien créer
  if (b.website) {
    audit(req, 'lead public écarté (anti-robot)', 'security', null, String(b.source_page || '').slice(0, 120));
    return res.json({ ok: true });
  }

  const first = String(b.first_name || '').trim().slice(0, 100);
  const last = String(b.last_name || '').trim().slice(0, 100);
  const email = b.email ? String(b.email).trim().slice(0, 200) : '';
  const phone = b.phone ? String(b.phone).trim().slice(0, 50) : '';
  const canton = b.canton ? String(b.canton).trim().slice(0, 2).toUpperCase() : null;
  const mainNeed = MAIN_NEEDS.includes(b.main_need) ? b.main_need : (b.main_need ? 'Autre' : null);
  const contactPref = b.contact_pref ? String(b.contact_pref).trim().slice(0, 100) : null;
  const details = b.details ? String(b.details).trim().slice(0, 2000) : '';
  const tool = b.tool ? String(b.tool).trim().slice(0, 100) : 'formulaire';
  const sourcePage = b.source_page ? String(b.source_page).trim().slice(0, 300) : '';
  const consentVersion = String(b.consent_text_version || 'v1').slice(0, 50);

  // Tracking A4.3 — tous facultatifs, jamais requis, jamais cause de rejet.
  const campaignKeyRaw = normalizeTrackingText(b.campaign_key, 200);
  const channelKeyRaw = normalizeTrackingText(b.channel_key, 200);
  const utmSource = normalizeTrackingText(b.utm_source, 300);
  const utmMedium = normalizeTrackingText(b.utm_medium, 300);
  const utmCampaign = normalizeTrackingText(b.utm_campaign, 300);
  const utmContent = normalizeTrackingText(b.utm_content, 300);
  const utmTerm = normalizeTrackingText(b.utm_term, 300);
  const gclid = normalizeTrackingText(b.gclid, 500);
  const fbclid = normalizeTrackingText(b.fbclid, 500);

  if (!first || !last) return res.status(400).json({ error: 'Prénom et nom sont requis.' });
  if (!email && !phone) return res.status(400).json({ error: 'Indiquez un e-mail ou un téléphone.' });
  if (email && !isEmail(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
  if (!b.consent) {
    return res.status(400).json({ error: 'Votre accord pour être recontacté est nécessaire.' });
  }

  // Canal « Formulaires du site internet » — fallback historique, conservé
  // tel quel (A4.3 ne fait qu'ajouter une résolution AVANT ce fallback,
  // jamais à sa place — voir server/acquisition-attribution.js pour le
  // choix explicite de garder ce fallback hors du resolver générique).
  const channel = db.prepare("SELECT id FROM channels WHERE key = 'site_internet'").get();

  // Résolution attribution (A4.2) : READ-ONLY, jamais de rejet pour un
  // tracking inconnu. Le canal final retombe sur site_internet uniquement
  // si ni la campagne ni le canal brut n'ont permis de résoudre un canal.
  const attribution = resolveLeadAttribution(db, { campaignKey: campaignKeyRaw, channelKey: channelKeyRaw });
  const resolvedChannelId = attribution.channelId ?? (channel ? channel.id : null);

  // Doublon ? On rattache la demande au dossier existant plutôt que d'en créer un deuxième
  const nEmail = normEmail(email);
  const nPhone = normPhone(phone);
  const existing = db
    .prepare("SELECT id, type, first_name, last_name, company_name, email, phone FROM clients WHERE status != 'anonymise'")
    .all()
    .find((r) => (nEmail && normEmail(r.email) === nEmail) || (nPhone && normPhone(r.phone) === nPhone));

  const summary =
    `Demande via le site (${tool})` +
    (mainNeed ? ` — besoin : ${mainNeed}` : '') +
    (contactPref ? ` — à rappeler : ${contactPref}` : '') +
    (details ? `\n${details}` : '') +
    (sourcePage ? `\nPage : ${sourcePage}` : '');

  const today = new Date().toISOString().slice(0, 10);

  const insertLeadAttribution = (clientId) => {
    db.prepare(
      `INSERT INTO lead_attribution (
         client_id, campaign_id, channel_id, raw_campaign_key, raw_channel_key,
         utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      clientId, attribution.campaignId, resolvedChannelId, attribution.rawCampaignKey, attribution.rawChannelKey,
      utmSource, utmMedium, utmCampaign, utmContent, utmTerm, gclid, fbclid
    );
  };

  const tx = db.transaction(() => {
    let clientId;
    if (existing) {
      clientId = existing.id;
      db.prepare('INSERT INTO tasks (title, due_date, priority, client_id) VALUES (?, ?, ?, ?)').run(
        `Recontacter ${[existing.first_name, existing.last_name].filter(Boolean).join(' ') || existing.company_name} — nouvelle demande via le site`,
        today, 'haute', clientId
      );
      // Mono-touch first-touch (A4.3) : un dossier existant ne perd jamais
      // son attribution déjà connue au profit d'une resoumission ultérieure
      // — seule l'ABSENCE totale d'attribution justifie d'en créer une ici,
      // avec le tracking de cette soumission comme premier tracking connu.
      const hasAttribution = db.prepare('SELECT 1 FROM lead_attribution WHERE client_id = ?').get(clientId);
      if (!hasAttribution) insertLeadAttribution(clientId);
    } else {
      const info = db
        .prepare(
          `INSERT INTO clients (type, first_name, last_name, email, phone, canton, status, consent_data, consent_date)
           VALUES ('particulier', ?, ?, ?, ?, ?, 'prospect', 1, ?)`
        )
        .run(first, last, email || null, phone || null, canton, today);
      clientId = info.lastInsertRowid;
      db.prepare(
        `INSERT INTO lead_details (client_id, channel_id, campaign_id, pipeline_stage, main_need, contact_pref)
         VALUES (?, ?, ?, 'nouveau', ?, ?)`
      ).run(clientId, resolvedChannelId, attribution.campaignId, mainNeed, contactPref);
      insertLeadAttribution(clientId);
    }
    db.prepare('INSERT INTO activities (client_id, type, content) VALUES (?, ?, ?)').run(
      clientId, 'email', summary
    );
    db.prepare(
      `INSERT INTO consents (client_id, kind, granted, text_version, source)
       VALUES (?, 'site_form', 1, ?, ?)`
    ).run(clientId, consentVersion, `${tool}${sourcePage ? ` (${sourcePage})` : ''}`);
    return clientId;
  });
  const clientId = tx();
  audit(req, existing ? 'lead public — dossier existant mis à jour' : 'lead public — prospect créé',
    'client', clientId, tool);
  res.status(201).json({ ok: true });
});
