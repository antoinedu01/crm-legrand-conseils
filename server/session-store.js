import { Store } from 'express-session';
import db from './db.js';

// Stockage des sessions dans SQLite : elles survivent aux redémarrages du serveur
// et restent sur le disque local (aucun service externe).
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    expire INTEGER NOT NULL,
    sess TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);
`);

const stmts = {
  get: db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expire > ?'),
  set: db.prepare('INSERT OR REPLACE INTO sessions (sid, expire, sess) VALUES (?, ?, ?)'),
  destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
  touch: db.prepare('UPDATE sessions SET expire = ? WHERE sid = ?'),
  cleanup: db.prepare('DELETE FROM sessions WHERE expire <= ?'),
};

export class SqliteSessionStore extends Store {
  constructor({ ttlMs = 8 * 60 * 60 * 1000 } = {}) {
    super();
    this.ttlMs = ttlMs;
    // Purge des sessions expirées toutes les 30 minutes
    this.timer = setInterval(() => stmts.cleanup.run(Date.now()), 30 * 60 * 1000);
    this.timer.unref();
  }

  #expiry(sess) {
    const fromCookie = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : null;
    return fromCookie || Date.now() + this.ttlMs;
  }

  get(sid, cb) {
    try {
      const row = stmts.get.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      stmts.set.run(sid, this.#expiry(sess), JSON.stringify(sess));
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  destroy(sid, cb) {
    try {
      stmts.destroy.run(sid);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      stmts.touch.run(this.#expiry(sess), sid);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }
}
