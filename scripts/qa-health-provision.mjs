// QA-E2E1 — provisioning d'une instance LOCALE ÉPHÉMÈRE ISOLÉE pour le test
// intégral Diagnostic Santé v2. Ce script ne doit JAMAIS pouvoir écrire sur
// une base réelle : chaque garde ci-dessous est un refus explicite (jamais
// un repli silencieux vers un chemin par défaut).
//
// N'accède à aucun réseau externe, ne se connecte à aucun serveur SSH, ne
// contient aucun hostname de production. Usage :
//
//   QA_E2E_ALLOW=1 CRM_DATA_DIR=/tmp/xxx QA_MODE=main node scripts/qa-health-provision.mjs
//   QA_E2E_ALLOW=1 CRM_DATA_DIR=/tmp/yyy QA_MODE=v1   node scripts/qa-health-provision.mjs
//
// QA_MODE=main : seed v1+v2, publie UNIQUEMENT diagnostic-sante-phase1 v2 et
//   regles-sante-phase1 v2 — jamais v1 (scénarios A→J).
// QA_MODE=v1   : seed v1 (+ v2 si QA_E2E_SEED_V2=1), publie UNIQUEMENT
//   diagnostic-sante-phase1 v1 ; regles-sante-phase1 v1 seulement si
//   QA_E2E_V1_RULESET=1 est explicitement demandé (scénario K).
//
// QA_PERSISTENT=1 (QA-INFRA1-HARDEN) : bascule le provisioning du compte
// conseiller d'un mot de passe fixe (usage éphémère ci-dessus : base
// temporaire jamais exposée, supprimée après le test) vers un mot de passe
// obligatoirement fourni par QA_ADVISER_PASSWORD -- jamais de secret fixe
// utilisable sur un environnement QA persistant. Voir
// docs/advisory/QA_DEPLOYMENT.md §6 pour la justification complète.

import path from 'path';
import fs from 'fs';
import os from 'os';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const REAL_DATA_DIR = path.resolve(REPO_ROOT, 'data');
const PROD_DATA_DIR = '/home/crm/app/data';
const PROD_APP_DIR = '/home/crm/app';

function refuse(message) {
  console.error(`Refus : ${message}`);
  process.exit(1);
}

// --- Gardes obligatoires (aucun fallback silencieux) ------------------------

if (process.env.QA_E2E_ALLOW !== '1') {
  refuse('QA_E2E_ALLOW=1 doit être explicitement défini pour exécuter ce script.');
}
if (process.env.NODE_ENV === 'production') {
  refuse('NODE_ENV=production — ce script ne doit jamais tourner avec cette variable.');
}
const requested = process.env.CRM_DATA_DIR;
if (!requested || !requested.trim()) {
  refuse('CRM_DATA_DIR est absent ou vide — un répertoire isolé explicite est obligatoire.');
}
if (!path.isAbsolute(requested)) {
  refuse(`CRM_DATA_DIR doit être un chemin absolu (reçu : « ${requested} »).`);
}
const resolvedDataDir = path.resolve(requested);
if (resolvedDataDir === REAL_DATA_DIR) {
  refuse(`CRM_DATA_DIR (${resolvedDataDir}) pointe vers le répertoire de données réel du dépôt (./data).`);
}
if (resolvedDataDir === PROD_DATA_DIR || resolvedDataDir === PROD_APP_DIR || resolvedDataDir.startsWith(`${PROD_APP_DIR}/`)) {
  refuse(`CRM_DATA_DIR (${resolvedDataDir}) pointe vers un chemin de production (${PROD_APP_DIR}).`);
}
if (resolvedDataDir === '/' || resolvedDataDir === REPO_ROOT) {
  refuse(`CRM_DATA_DIR (${resolvedDataDir}) est un chemin manifestement incorrect.`);
}

// Garde-fou anti-erreur-opérateur (constat revue conformité QA-INFRA1-HARDEN
// §3) : le mode par défaut (mot de passe fixe éphémère) ne doit jamais
// pouvoir être invoqué contre un chemin qui SEMBLE destiné à persister --
// sans quoi une simple omission de QA_PERSISTENT=1 lors d'un provisioning
// réel sur le futur VPS QA créerait silencieusement un compte avec le mot
// de passe de test fixe. Fail-closed par défaut : hors du répertoire
// temporaire du système, QA_PERSISTENT=1 (+ QA_ADVISER_PASSWORD) devient
// obligatoire.
const PERSISTENT = process.env.QA_PERSISTENT === '1';
if (!PERSISTENT) {
  const tmpRoot = path.resolve(os.tmpdir());
  const isUnderTmp = resolvedDataDir === tmpRoot || resolvedDataDir.startsWith(`${tmpRoot}${path.sep}`);
  if (!isUnderTmp) {
    refuse(
      `CRM_DATA_DIR (${resolvedDataDir}) n'est pas sous le répertoire temporaire du système (${tmpRoot}). ` +
      `Un chemin hors du dossier temporaire suggère un environnement destiné à persister : ` +
      `QA_PERSISTENT=1 (et QA_ADVISER_PASSWORD) est alors obligatoire -- le mot de passe fixe ` +
      `éphémère est réservé aux bases temporaires supprimées après usage.`
    );
  }
}

const mode = process.env.QA_MODE;
if (mode !== 'main' && mode !== 'v1') {
  refuse("QA_MODE doit valoir 'main' ou 'v1'.");
}

fs.mkdirSync(resolvedDataDir, { recursive: true });
console.log(`CRM_DATA_DIR vérifié et isolé : ${resolvedDataDir}`);
console.log(`Mode de provisioning : ${mode}`);

// --- Provisioning ------------------------------------------------------------
// db.js honore déjà process.env.CRM_DATA_DIR (jamais réécrit ici) et exécute
// ses migrations automatiquement à l'import — aucun mécanisme séparé requis.

const { default: db } = await import(path.join(REPO_ROOT, 'server', 'db.js'));
const {
  seedAdvisoryHealthContent, seedAdvisoryHealthContentV2,
  QUESTIONNAIRE_STABLE_KEY, RULE_SET_STABLE_KEY,
} = await import(path.join(REPO_ROOT, 'server', 'seed-advisory-health-content.js'));
const { publishVersion } = await import(path.join(REPO_ROOT, 'server', 'advisoryQuestionnaires.js'));
const { publishRuleSet } = await import(path.join(REPO_ROOT, 'server', 'advisoryRules.js'));

const ADVISER_EMAIL = 'conseiller.qa@example.invalid';
const ADVISER_NAME = 'QA Conseiller Test';

let ADVISER_PASSWORD;
if (PERSISTENT) {
  // Environnement QA persistant (potentiellement exposé) : aucun mot de
  // passe fixe n'est acceptable ici -- doit être fourni par l'opérateur,
  // jamais committé, jamais affiché ci-dessous.
  ADVISER_PASSWORD = process.env.QA_ADVISER_PASSWORD;
  if (!ADVISER_PASSWORD || !ADVISER_PASSWORD.trim()) {
    refuse('QA_PERSISTENT=1 exige QA_ADVISER_PASSWORD (mot de passe fourni explicitement, jamais une valeur par défaut pour un environnement persistant).');
  }
} else {
  // Usage éphémère existant (QA-E2E1 et tests automatisés locaux) : base
  // temporaire créée et supprimée dans la même exécution, jamais exposée --
  // mot de passe fixe conservé UNIQUEMENT pour ce cas, pour ne pas casser
  // les flux déjà validés (ex. scripts/qa-health-e2e-playwright.mjs), et
  // explicitement jamais réutilisable sur un environnement persistant
  // (bloqué par la branche QA_PERSISTENT ci-dessus).
  ADVISER_PASSWORD = 'QaE2eTest#2026Local!';
}

const existingUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (existingUsers === 0) {
  const hash = bcrypt.hashSync(ADVISER_PASSWORD, 12);
  db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run(
    ADVISER_EMAIL.toLowerCase(), ADVISER_NAME, hash
  );
  console.log(`Compte conseiller QA créé : ${ADVISER_EMAIL}${PERSISTENT ? ' (mot de passe : fourni via QA_ADVISER_PASSWORD, jamais affiché ici)' : ''}`);
} else {
  console.log('Un compte existe déjà sur cette base isolée — provisioning déjà exécuté, réutilisation.');
}

const r1 = seedAdvisoryHealthContent();
console.log('seedAdvisoryHealthContent (v1) :', JSON.stringify(r1).slice(0, 200));

let r2 = null;
if (mode === 'main' || process.env.QA_E2E_SEED_V2 === '1') {
  r2 = seedAdvisoryHealthContentV2();
  console.log('seedAdvisoryHealthContentV2 (v2) :', JSON.stringify(r2).slice(0, 200));
}

const fakeReq = { session: { userEmail: ADVISER_EMAIL } };

function questionnaireVersionRow(versionNumber) {
  return db.prepare(`
    SELECT v.id, v.version_number, v.status
    FROM advisory_questionnaire_versions v
    JOIN advisory_questionnaires q ON q.id = v.questionnaire_id
    WHERE q.stable_key = ? AND v.version_number = ?
  `).get(QUESTIONNAIRE_STABLE_KEY, versionNumber);
}
function ruleSetRow(versionNumber) {
  return db.prepare(
    'SELECT id, version_number, status FROM advisory_rule_sets WHERE stable_key = ? AND version_number = ?'
  ).get(RULE_SET_STABLE_KEY, versionNumber);
}

if (mode === 'main') {
  const v2 = questionnaireVersionRow(2);
  if (!v2) refuse('Version 2 du questionnaire introuvable après seed — provisioning incohérent.');
  if (v2.status === 'draft') publishVersion(v2.id, fakeReq);

  const rs2 = ruleSetRow(2);
  if (!rs2) refuse('Version 2 du rule_set introuvable après seed — provisioning incohérent.');
  if (rs2.status === 'draft') publishRuleSet(rs2.id, fakeReq);

  const v1After = questionnaireVersionRow(1);
  const v2After = questionnaireVersionRow(2);
  const rs1After = ruleSetRow(1);
  const rs2After = ruleSetRow(2);

  console.log('--- État après publication (QA_MAIN) ---');
  console.log(`questionnaire v1 : ${v1After.status} | v2 : ${v2After.status}`);
  console.log(`rule_set v1 : ${rs1After.status} | v2 : ${rs2After.status}`);

  if (v2After.status !== 'published') refuse('La version 2 du questionnaire devrait être publiée et ne l’est pas.');
  if (rs2After.status !== 'published') refuse('La version 2 du rule_set devrait être publiée et ne l’est pas.');
  if (v1After.status === 'published') refuse('La version 1 du questionnaire est publiée dans QA_MAIN — interdit par le cadrage (correction K).');
  if (rs1After.status === 'published') refuse('La version 1 du rule_set est publiée dans QA_MAIN — interdit par le cadrage (correction K).');
} else {
  const v1 = questionnaireVersionRow(1);
  if (!v1) refuse('Version 1 du questionnaire introuvable après seed — provisioning incohérent.');
  if (v1.status === 'draft') publishVersion(v1.id, fakeReq);

  if (process.env.QA_E2E_V1_RULESET === '1') {
    const rs1 = ruleSetRow(1);
    if (!rs1) refuse('Version 1 du rule_set introuvable après seed — provisioning incohérent.');
    if (rs1.status === 'draft') publishRuleSet(rs1.id, fakeReq);
  }

  const v1After = questionnaireVersionRow(1);
  console.log('--- État après publication (QA_V1) ---');
  console.log(`questionnaire v1 : ${v1After.status}`);
  if (v1After.status !== 'published') refuse('La version 1 du questionnaire devrait être publiée et ne l’est pas.');
}

// --- Manifeste pour le script Playwright : correspondance stable_key -> id
// technique, résolue explicitement par (stable_key de la version SOI-MÊME,
// version_number) -- jamais par un data[0]/« dernière version » supposée
// (correction QA-E2E0 §4).
const targetVersionNumber = mode === 'main' ? 2 : 1;
const targetVersion = questionnaireVersionRow(targetVersionNumber);
const questions = db.prepare(
  'SELECT id, stable_key, sort_order FROM advisory_questions WHERE questionnaire_version_id = ? ORDER BY sort_order'
).all(targetVersion.id);
const questionIdsByStableKey = Object.fromEntries(questions.map((q) => [q.stable_key, q.id]));

// En mode persistant, le manifeste reste sur le disque de l'hôte QA au-delà
// de cette seule exécution : le mot de passe n'y est jamais écrit en clair
// (contrairement au mode éphémère, où le manifeste vit dans un répertoire
// temporaire supprimé par le script Playwright appelant juste après usage).
const manifest = {
  mode,
  dataDir: resolvedDataDir,
  adviser: {
    email: ADVISER_EMAIL,
    password: PERSISTENT ? null : ADVISER_PASSWORD,
    name: ADVISER_NAME,
  },
  questionnaireStableKey: QUESTIONNAIRE_STABLE_KEY,
  ruleSetStableKey: RULE_SET_STABLE_KEY,
  targetVersionNumber,
  targetQuestionnaireVersionId: targetVersion.id,
  questionIdsByStableKey,
};
const manifestPath = path.join(resolvedDataDir, 'qa-manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`Manifeste écrit : ${manifestPath}`);
console.log(`Nombre de questions indexées (v${targetVersionNumber}) : ${questions.length}`);
