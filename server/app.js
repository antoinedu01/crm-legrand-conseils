import express from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import db from './db.js';
import { SqliteSessionStore } from './session-store.js';
import { validationErrors } from './validate.js';
import { authRouter, requireAuth } from './auth.js';
import { clientsRouter } from './routes/clients.js';
import { companiesRouter } from './routes/companies.js';
import { contractsRouter } from './routes/contracts.js';
import { commissionsRouter } from './routes/commissions.js';
import { tasksRouter } from './routes/tasks.js';
import { dashboardRouter } from './routes/dashboard.js';
import { complianceRouter } from './routes/compliance.js';
import { channelsRouter } from './routes/channels.js';
import { prospectsRouter } from './routes/prospects.js';
import { todayRouter } from './routes/today.js';
import { publicRouter } from './routes/public.js';
import { advisoryHouseholdsRouter } from './routes/advisoryHouseholds.js';
import { advisoryQuestionnairesRouter } from './routes/advisoryQuestionnaires.js';
import { advisorySessionsRouter } from './routes/advisorySessions.js';
import { advisoryRulesRouter } from './routes/advisoryRules.js';
import { sessionScopedRecommendationsRouter, recommendationsRouter } from './routes/advisoryRecommendations.js';
import { audit } from './audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.CRM_DATA_DIR || path.join(__dirname, '..', 'data');

// Secret de session persistant (généré au premier démarrage)
const secretFile = path.join(DATA_DIR, '.session-secret');
let secret = process.env.SESSION_SECRET;
if (!secret) {
  if (fs.existsSync(secretFile)) {
    secret = fs.readFileSync(secretFile, 'utf8');
  } else {
    secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  }
}

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 heures

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // derrière Caddy/nginx : l'IP réelle sert au rate limiting
app.use(express.json({ limit: '1mb' }));
app.use(
  session({
    secret,
    store: new SqliteSessionStore({ ttlMs: SESSION_TTL_MS }),
    resave: false,
    saveUninitialized: false,
    name: 'crm.sid',
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
      maxAge: SESSION_TTL_MS,
    },
  })
);

// En-têtes de sécurité
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
      "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
  next();
});

// Formulaires publics du site (CORS restreint + protections dédiées) —
// monté AVANT le contrôle anti-CSRF interne, car les requêtes viennent du site.
app.use('/api/public', publicRouter);

// Anti-CSRF : toute requête de modification doit provenir de notre propre origine.
// (Complète SameSite=Lax : même un navigateur ancien ne peut pas poster depuis un autre site.)
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const secFetch = req.headers['sec-fetch-site'];
  if (secFetch && secFetch !== 'same-origin' && secFetch !== 'none') {
    audit(req, 'requête intersite bloquée (CSRF)', 'security', null, `${req.method} ${req.path}`);
    return res.status(403).json({ error: 'Requête intersite refusée.' });
  }
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        audit(req, 'requête intersite bloquée (CSRF)', 'security', null, `${req.method} ${req.path}`);
        return res.status(403).json({ error: 'Requête intersite refusée.' });
      }
    } catch {
      return res.status(403).json({ error: 'Origine invalide.' });
    }
  }
  next();
});

// Limitation de débit globale sur l'API
app.use(
  '/api',
  rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Trop de requêtes. Réessayez dans quelques minutes.' },
  })
);

// Limitation stricte sur l'authentification (complète le verrouillage par compte)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/setup', authLimiter);

app.use('/api/auth', authRouter);
app.use('/api/clients', requireAuth, clientsRouter);
app.use('/api/companies', requireAuth, companiesRouter);
app.use('/api/contracts', requireAuth, contractsRouter);
app.use('/api/commissions', requireAuth, commissionsRouter);
app.use('/api/tasks', requireAuth, tasksRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);
app.use('/api/compliance', requireAuth, complianceRouter);
app.use('/api/channels', requireAuth, channelsRouter);
app.use('/api/prospects', requireAuth, prospectsRouter);
app.use('/api/today', requireAuth, todayRouter);
app.use('/api/advisory/households', requireAuth, advisoryHouseholdsRouter);
app.use('/api/advisory/questionnaires', requireAuth, advisoryQuestionnairesRouter);
app.use('/api/advisory/sessions', requireAuth, advisorySessionsRouter);
app.use('/api/advisory/sessions', requireAuth, sessionScopedRecommendationsRouter);
app.use('/api/advisory/rule-sets', requireAuth, advisoryRulesRouter);
app.use('/api/advisory/recommendations', requireAuth, recommendationsRouter);

// Sauvegarde complète de la base (copie cohérente via l'API backup de SQLite)
app.get('/api/backup', requireAuth, async (req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(DATA_DIR, `sauvegarde-${stamp}-${Date.now()}.sqlite`);
  try {
    await db.backup(file);
    audit(req, 'téléchargement de sauvegarde', 'system', null, path.basename(file));
    res.download(file, `crm-sauvegarde-${stamp}.sqlite`, () => {
      fs.unlink(file, () => {});
    });
  } catch (err) {
    console.error(err);
    fs.unlink(file, () => {});
    res.status(500).json({ error: 'La sauvegarde a échoué.' });
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue.' }));

// Sert l'interface compilée si elle existe
const distDir = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.use(validationErrors);

// Gestion d'erreurs : ne jamais divulguer de détails internes
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

export default app;
