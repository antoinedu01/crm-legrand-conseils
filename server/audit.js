import db from './db.js';

const insert = db.prepare(
  'INSERT INTO audit_log (user_email, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)'
);

// Journal d'audit exigé par le principe de traçabilité (nLPD art. 8, sécurité des données)
export function audit(req, action, entity = null, entityId = null, details = null) {
  const email = req.session?.userEmail || 'système';
  insert.run(email, action, entity, entityId, details ? String(details).slice(0, 500) : null);
}
