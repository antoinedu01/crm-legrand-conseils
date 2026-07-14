import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from './db.js';
import { audit } from './audit.js';

export const authRouter = Router();

// Le CRM est-il déjà configuré (compte courtier créé) ?
authRouter.get('/status', (req, res) => {
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  res.json({
    setupDone: users > 0,
    authenticated: Boolean(req.session.userId),
    user: req.session.userId
      ? db
          .prepare('SELECT id, email, name, finma_reg, cicero_reg FROM users WHERE id = ?')
          .get(req.session.userId)
      : null,
  });
});

// Premier démarrage : création du compte courtier
authRouter.post('/setup', (req, res) => {
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (users > 0) return res.status(403).json({ error: 'Le compte est déjà configuré.' });
  const { email, name, password, finma_reg, cicero_reg } = req.body || {};
  if (!email || !name || !password || password.length < 10) {
    return res
      .status(400)
      .json({ error: 'E-mail, nom et mot de passe (10 caractères minimum) sont requis.' });
  }
  const hash = bcrypt.hashSync(password, 12);
  const info = db
    .prepare(
      'INSERT INTO users (email, name, password_hash, finma_reg, cicero_reg) VALUES (?, ?, ?, ?, ?)'
    )
    .run(email.trim().toLowerCase(), name.trim(), hash, finma_reg || null, cicero_reg || null);
  req.session.userId = info.lastInsertRowid;
  req.session.userEmail = email.trim().toLowerCase();
  audit(req, 'création du compte courtier', 'user', info.lastInsertRowid);
  res.json({ ok: true });
});

// Anti force brute : verrouillage progressif par e-mail
const attempts = new Map();

authRouter.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const key = String(email || '').trim().toLowerCase();
  const a = attempts.get(key) || { count: 0, until: 0 };
  if (Date.now() < a.until) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(key);
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    a.count += 1;
    if (a.count >= 5) {
      a.until = Date.now() + 5 * 60 * 1000;
      a.count = 0;
    }
    attempts.set(key, a);
    audit(req, 'échec de connexion', 'user', null, key);
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }
  attempts.delete(key);
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Erreur de session.' });
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    audit(req, 'connexion', 'user', user.id);
    res.json({ ok: true });
  });
});

authRouter.post('/logout', (req, res) => {
  audit(req, 'déconnexion', 'user', req.session.userId || null);
  req.session.destroy(() => res.json({ ok: true }));
});

// Mise à jour du profil courtier (nom, n° FINMA/Cicero, mot de passe)
authRouter.put('/profile', requireAuth, (req, res) => {
  const { name, finma_reg, cicero_reg, new_password, current_password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (new_password) {
    if (!current_password || !bcrypt.compareSync(current_password, user.password_hash)) {
      return res.status(400).json({ error: 'Mot de passe actuel incorrect.' });
    }
    if (new_password.length < 10) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit faire 10 caractères minimum.' });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      bcrypt.hashSync(new_password, 12),
      user.id
    );
    audit(req, 'changement de mot de passe', 'user', user.id);
  }
  db.prepare('UPDATE users SET name = ?, finma_reg = ?, cicero_reg = ? WHERE id = ?').run(
    name || user.name,
    finma_reg ?? user.finma_reg,
    cicero_reg ?? user.cicero_reg,
    user.id
  );
  audit(req, 'mise à jour du profil', 'user', user.id);
  res.json({ ok: true });
});

export function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Authentification requise.' });
  next();
}
