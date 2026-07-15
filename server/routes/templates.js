import { Router } from 'express';
import db from '../db.js';
import { audit } from '../audit.js';
import { checkTextFields } from '../validate.js';

export const templatesRouter = Router();

// Bibliothèque de modèles de messages : le CRM n'envoie jamais rien lui-même.
// Vous copiez, personnalisez et envoyez depuis votre messagerie — validation humaine à 100 %.
templatesRouter.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM templates ORDER BY id').all());
});

templatesRouter.put('/:id', (req, res) => {
  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!template) return res.status(404).json({ error: 'Modèle introuvable.' });
  const { name, content } = req.body || {};
  checkTextFields({ name }, ['name'], 200);
  checkTextFields({ content }, ['content'], 5000);
  db.prepare(
    "UPDATE templates SET name = COALESCE(?, name), content = COALESCE(?, content), updated_at = datetime('now') WHERE id = ?"
  ).run(name || null, content || null, template.id);
  audit(req, 'modification modèle de message', 'template', template.id, template.key);
  res.json({ ok: true });
});
