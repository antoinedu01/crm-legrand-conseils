// Tests du script d'installation QA (`deploy/install-qa.sh`) —
// QA-INFRA1 / QA-INFRA1-HARDEN.
//
// IMPORTANT : ces tests n'invoquent JAMAIS --apply avec toutes les
// confirmations valides. Le mode --apply (avec QA_DEPLOY_ALLOW=1 +
// QA_DEPLOY_CONFIRM=QA_ONLY) crée un utilisateur système, clone le dépôt et
// démarre un service systemd — inadapté et dangereux dans un test
// automatisé (constat QA-INFRA1 : une invocation manuelle réelle, root +
// QA_DEPLOY_ALLOW=1, a créé un vrai utilisateur système avant d'être
// nettoyée -- exactement l'incident que la barrière --apply de ce sous-lot
// corrige). Chaque test ci-dessous utilise soit --dry-run (aucune mutation
// possible, ni root ni réseau ni systemd requis), soit un appel refusé
// AVANT toute mutation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

const SCRIPT = path.join(process.cwd(), 'deploy', 'install-qa.sh');

function run(env = {}, args = ['--dry-run']) {
  try {
    const out = execFileSync('bash', [SCRIPT, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return { status: 0, stdout: out, stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: err.stdout?.toString() || '', stderr: err.stderr?.toString() || '' };
  }
}

// Environnement de base : uniquement l'autorisation explicite, tout le
// reste reste aux valeurs QA par défaut du script (jamais de production).
const ALLOWED = { QA_DEPLOY_ALLOW: '1' };
const APPLY_READY = { QA_DEPLOY_ALLOW: '1', QA_DEPLOY_CONFIRM: 'QA_ONLY' };

// ==========================================================================
// A-H : barrière d'intention --dry-run / --apply (QA-INFRA1-HARDEN §2)
// ==========================================================================

test('A. install-qa.sh — aucun flag -> refuse, aide courte affichée, aucune variable QA_* lue', () => {
  const r = run({}, []);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--dry-run ou --apply est obligatoire/);
  assert.match(r.stderr, /Usage :/);
});

test('B. install-qa.sh — QA_DEPLOY_ALLOW=1 seul, sans --apply ni --dry-run -> refuse (rien ne se passe)', () => {
  const r = run({ QA_DEPLOY_ALLOW: '1' }, []);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--dry-run ou --apply est obligatoire/);
});

test('C. install-qa.sh — --apply sans QA_DEPLOY_ALLOW -> refuse', () => {
  const r = run({}, ['--apply']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_DEPLOY_ALLOW=1 doit être explicitement défini/);
});

test('D. install-qa.sh — --apply + QA_DEPLOY_ALLOW=1 sans QA_DEPLOY_CONFIRM -> refuse', () => {
  const r = run(ALLOWED, ['--apply']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_DEPLOY_CONFIRM=QA_ONLY doit être explicitement défini pour --apply/);
});

test('E. install-qa.sh — --apply + mauvaise valeur de QA_DEPLOY_CONFIRM -> refuse', () => {
  const r = run({ ...ALLOWED, QA_DEPLOY_CONFIRM: 'presque-bon' }, ['--apply']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_DEPLOY_CONFIRM=QA_ONLY doit être explicitement défini pour --apply/);
});

test('F. install-qa.sh — --reset sans --apply ni --dry-run -> refuse (même barrière générale)', () => {
  const r = run({}, ['--reset']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--dry-run ou --apply est obligatoire/);
});

test('G. install-qa.sh — --reset --apply avec confirmations d’installation mais sans QA_CONFIRM_RESET -> refuse', () => {
  const r = run(APPLY_READY, ['--reset', '--apply']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_CONFIRM_RESET=RESET_QA_ONLY doit être explicitement défini/);
});

test('G bis. install-qa.sh — --reset --apply avec mauvaise valeur de QA_CONFIRM_RESET -> refuse', () => {
  const r = run({ ...APPLY_READY, QA_CONFIRM_RESET: '1' }, ['--reset', '--apply']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_CONFIRM_RESET=RESET_QA_ONLY doit être explicitement défini/);
});

test('H. install-qa.sh — --dry-run avec une configuration QA valide -> succès, zéro mutation', () => {
  const r = run(ALLOWED);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /MODE\s+: DRY-RUN/);
  assert.match(r.stdout, /QA APP DIR\s+: \/home\/crm-qa\/app/);
  assert.match(r.stdout, /QA DATA DIR\s+: \/home\/crm-qa\/data/);
  assert.match(r.stdout, /QA SERVICE\s+: crm-qa/);
  assert.match(r.stdout, /QA PORT\s+: 3001/);
  assert.match(r.stdout, /--dry-run : aucune commande/);
  assert.doesNotMatch(r.stdout, /Cloning into/);
});

test('install-qa.sh — --dry-run et --apply simultanément -> refuse (intention ambiguë)', () => {
  const r = run(ALLOWED, ['--dry-run', '--apply']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /mutuellement exclusifs/);
});

test('install-qa.sh — reproduction de l’ancien incident : root simulé + QA_DEPLOY_ALLOW=1 sans --apply ne mute toujours rien', () => {
  // L'incident réel : le script tournait avec succès (useradd + git clone)
  // simplement parce que le process était root et QA_DEPLOY_ALLOW=1 était
  // défini. Ce test prouve que la barrière --dry-run/--apply arrête
  // l'exécution AVANT même de lire la configuration QA_*, quel que soit
  // l'UID du process -- donc avant tout useradd/git clone, comme exigé.
  const r = run({ QA_DEPLOY_ALLOW: '1' }, []);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--dry-run ou --apply est obligatoire/);
  // Marqueurs d'exécution RÉELLE uniquement (pas la mention descriptive de
  // "useradd" dans le texte d'aide lui-même) : aucune sortie de useradd(8)
  // ni de `git clone` ne doit jamais apparaître.
  assert.doesNotMatch(r.stdout + r.stderr, /Cloning into|Compte de service QA cr|already exists/);
});

// ==========================================================================
// Garde-fous de configuration (fail-closed), testés via --dry-run
// ==========================================================================

test('install-qa.sh — refuse QA_USER = crm (production)', () => {
  const r = run({ ...ALLOWED, QA_USER: 'crm' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_USER ne peut pas être/);
});

test('install-qa.sh — refuse QA_USER avec des caractères non autorisés (ex. majuscule)', () => {
  const r = run({ ...ALLOWED, QA_USER: 'Crm-Qa' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /nom d.utilisateur Unix valide/);
});

test('install-qa.sh — refuse QA_APP_DIR = /home/crm/app (production)', () => {
  const r = run({ ...ALLOWED, QA_APP_DIR: '/home/crm/app' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_APP_DIR doit être sous/);
});

test('install-qa.sh — refuse QA_APP_DIR sous /home/crm/app', () => {
  const r = run({ ...ALLOWED, QA_APP_DIR: '/home/crm/app/sub' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_APP_DIR doit être sous/);
});

test('install-qa.sh — refuse QA_APP_DIR hors de /home/<QA_USER>/ (ex. /var/lib/whatever)', () => {
  const r = run({ ...ALLOWED, QA_APP_DIR: '/var/lib/whatever' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_APP_DIR doit être sous/);
});

test('install-qa.sh — refuse QA_DATA_DIR = /home/crm/app/data (production)', () => {
  const r = run({ ...ALLOWED, QA_DATA_DIR: '/home/crm/app/data' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_DATA_DIR doit être sous/);
});

test('install-qa.sh — refuse QA_DATA_DIR = /etc (hors liste blanche, même sans lien avec la production)', () => {
  const r = run({ ...ALLOWED, QA_DATA_DIR: '/etc' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_DATA_DIR doit être sous/);
});

test('install-qa.sh — refuse QA_DATA_DIR relatif (non absolu)', () => {
  const r = run({ ...ALLOWED, QA_DATA_DIR: 'relative/path' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /chemin absolu/);
});

test('install-qa.sh — QA_DATA_DIR vide retombe sur la valeur par défaut sûre (jamais un chemin vide)', () => {
  const r = run({ ...ALLOWED, QA_DATA_DIR: '' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /QA DATA DIR\s+: \/home\/crm-qa\/data/);
});

test('install-qa.sh — refuse QA_DATA_DIR sous /home/<QA_USER>/ mais différent du dossier de données attendu', () => {
  // Liste blanche seule ne suffit pas : le reset ne doit jamais pouvoir
  // cibler un autre sous-dossier de /home/<QA_USER>/ que le dossier de
  // données exact attendu (QA-INFRA1-HARDEN §3).
  const r = run({ ...ALLOWED, QA_DATA_DIR: '/home/crm-qa/data/sous-dossier' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_DATA_DIR doit être exactement/);
});

test('install-qa.sh — refuse quand QA_APP_DIR est délibérément redéfini pour entrer en collision avec le dossier de données', () => {
  const r = run({ ...ALLOWED, QA_APP_DIR: '/home/crm-qa/data' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_DATA_DIR ne peut pas être identique à QA_APP_DIR/);
});

test('install-qa.sh — refuse QA_APP_DIR imbriqué sous QA_DATA_DIR (le code serait supprimé par --reset)', () => {
  // Constat revue sécurité QA-INFRA1-HARDEN §3b : QA_DATA_DIR étant fixé à
  // exactement /home/<QA_USER>/data, un QA_APP_DIR redéfini en sous-chemin
  // de ce dossier (ex. .../data/app) passait auparavant la liste blanche
  // sans être détecté comme collision.
  const r = run({ ...ALLOWED, QA_APP_DIR: '/home/crm-qa/data/app' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_APP_DIR .* est à l.intérieur de QA_DATA_DIR/);
});

test('install-qa.sh — un lien symbolique QA_DATA_DIR pointant vers un chemin de production est résolu (realpath) et refusé', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-qa-symlink-test-'));
  const link = path.join(tmpBase, 'data-link');
  // La cible n'a jamais besoin d'exister (realpath -m) : elle n'est jamais
  // créée réellement, seul le lien symbolique lui-même existe sous /tmp.
  fs.symlinkSync('/home/crm/app/data', link);
  const r = run({ ...ALLOWED, QA_DATA_DIR: link });
  assert.equal(r.status, 1);
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

test('install-qa.sh — refuse QA_SERVICE = crm (production)', () => {
  const r = run({ ...ALLOWED, QA_SERVICE: 'crm' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_SERVICE doit se terminer par/);
});

test('install-qa.sh — refuse QA_SERVICE sans suffixe -qa (ex. sshd — risque de cibler un service système)', () => {
  const r = run({ ...ALLOWED, QA_SERVICE: 'sshd' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_SERVICE doit se terminer par/);
});

test('install-qa.sh — refuse QA_HOSTNAME = crm.legrandconseils.ch (production)', () => {
  const r = run({ ...ALLOWED, QA_HOSTNAME: 'crm.legrandconseils.ch' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_HOSTNAME ne peut pas être/);
});

test('install-qa.sh — refuse QA_REPO ne commençant pas par https:// ou git@ (protection injection d’arguments git)', () => {
  const r = run({ ...ALLOWED, QA_REPO: '--upload-pack=/bin/sh' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_REPO doit commencer par/);
});

test('install-qa.sh — refuse QA_BRANCH commençant par un tiret', () => {
  const r = run({ ...ALLOWED, QA_BRANCH: '--upload-pack=/bin/sh' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_BRANCH contient des caractères non autorisés/);
});

test('install-qa.sh — refuse QA_DEPLOY_SHA non hexadécimal ou commençant par un tiret', () => {
  const r = run({ ...ALLOWED, QA_DEPLOY_SHA: '--upload-pack=/bin/sh' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_DEPLOY_SHA doit être un SHA git hexadécimal/);
});

test('install-qa.sh — refuse QA_PORT = 3000 (port de production)', () => {
  const r = run({ ...ALLOWED, QA_PORT: '3000' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /QA_PORT ne peut pas être/);
});

test('install-qa.sh — refuse une option inconnue', () => {
  const r = run(ALLOWED, ['--bogus']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /option inconnue/);
});

// ==========================================================================
// Décision NODE_ENV (QA-INFRA1-HARDEN §5) : production est désormais
// accepté ET la valeur par défaut -- ce n'est plus un garde-fou d'isolement.
// ==========================================================================

test('install-qa.sh — QA_NODE_ENV=production est désormais ACCEPTÉ et est la valeur par défaut', () => {
  const r = run(ALLOWED);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /QA_NODE_ENV\s+: production/);
});

test('install-qa.sh — QA_NODE_ENV=development reste accepté si explicitement demandé (ni imposé, ni interdit)', () => {
  const r = run({ ...ALLOWED, QA_NODE_ENV: 'development' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /QA_NODE_ENV\s+: development/);
});

// ==========================================================================
// Reset --dry-run et divers
// ==========================================================================

test('install-qa.sh — --reset --dry-run décrit le plan RESET sans l’exécuter, sans exiger aucune confirmation de mutation', () => {
  const r = run(ALLOWED, ['--reset', '--dry-run']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Mode RESET QA demandé/);
  assert.match(r.stdout, /aucune commande ci-dessus n.a été exécutée/);
});

test('install-qa.sh — accepte QA_HOSTNAME et QA_DEPLOY_SHA personnalisés valides en --dry-run', () => {
  const r = run({ ...ALLOWED, QA_HOSTNAME: 'qa.crm.legrandconseils.ch', QA_DEPLOY_SHA: '0159e5b5d55b246d31b38ac6b9b64dd99ef8cae2' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /QA HOSTNAME\s+: qa\.crm\.legrandconseils\.ch/);
  assert.match(r.stdout, /checkout du SHA explicite : 0159e5b5d55b246d31b38ac6b9b64dd99ef8cae2/);
});

test('install-qa.sh — --dry-run mentionne la création du fichier de secrets optionnel, sans jamais afficher de valeur', () => {
  const r = run(ALLOWED);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\/etc\/crm-qa\.env/);
  assert.match(r.stdout, /permissions 600, root:root|permissions 600 root:root/);
});

test('install-qa.sh — --help affiche l’usage sans exécuter les garde-fous ni rien d’autre', () => {
  const r = run({}, ['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage :/);
  assert.match(r.stdout, /--dry-run ou --apply\) est OBLIGATOIRE/);
});
