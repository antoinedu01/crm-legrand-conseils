import express from 'express';
import session from 'express-session';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import './db.js';
import { authRouter, requireAuth } from './auth.js';
import { clientsRouter } from './routes/clients.js';
import { companiesRouter } from './routes/companies.js';
import { contractsRouter } from './routes/contracts.js';
import { commissionsRouter } from './routes/commissions.js';
import { tasksRouter } from './routes/tasks.js';
import { dashboardRouter } from './routes/dashboard.js';
import { complianceRouter } from './routes/compliance.js';

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

const app = express();
const isProd = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(
  session({
    secret,
    resave: false,
    saveUninitialized: false,
    name: 'crm.sid',
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
      maxAge: 8 * 60 * 60 * 1000, // 8 heures
    },
  })
);

// En-têtes de sécurité de base
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use('/api/auth', authRouter);
app.use('/api/clients', requireAuth, clientsRouter);
app.use('/api/companies', requireAuth, companiesRouter);
app.use('/api/contracts', requireAuth, contractsRouter);
app.use('/api/commissions', requireAuth, commissionsRouter);
app.use('/api/tasks', requireAuth, tasksRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);
app.use('/api/compliance', requireAuth, complianceRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue.' }));

// En production, sert l'interface compilée
const distDir = path.join(__dirname, '..', 'client', 'dist');
if (isProd || fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

// Gestion d'erreurs : ne jamais divulguer de détails internes
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CRM Legrand Conseils — API démarrée sur http://localhost:${PORT}`);
});
