import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import db from '../db.js';
import { audit } from '../audit.js';
import { isEmail, normEmail, normPhone } from '../validate.js';

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

  if (!first || !last) return res.status(400).json({ error: 'Prénom et nom sont requis.' });
  if (!email && !phone) return res.status(400).json({ error: 'Indiquez un e-mail ou un téléphone.' });
  if (email && !isEmail(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
  if (!b.consent) {
    return res.status(400).json({ error: 'Votre accord pour être recontacté est nécessaire.' });
  }

  // Canal « Formulaires du site internet »
  const channel = db.prepare("SELECT id FROM channels WHERE key = 'site_internet'").get();

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

  const tx = db.transaction(() => {
    let clientId;
    if (existing) {
      clientId = existing.id;
      db.prepare('INSERT INTO tasks (title, due_date, priority, client_id) VALUES (?, ?, ?, ?)').run(
        `Recontacter ${[existing.first_name, existing.last_name].filter(Boolean).join(' ') || existing.company_name} — nouvelle demande via le site`,
        today, 'haute', clientId
      );
    } else {
      const info = db
        .prepare(
          `INSERT INTO clients (type, first_name, last_name, email, phone, canton, status, consent_data, consent_date)
           VALUES ('particulier', ?, ?, ?, ?, ?, 'prospect', 1, ?)`
        )
        .run(first, last, email || null, phone || null, canton, today);
      clientId = info.lastInsertRowid;
      db.prepare(
        `INSERT INTO lead_details (client_id, channel_id, pipeline_stage, main_need, contact_pref)
         VALUES (?, ?, 'nouveau', ?, ?)`
      ).run(clientId, channel ? channel.id : null, mainNeed, contactPref);
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
