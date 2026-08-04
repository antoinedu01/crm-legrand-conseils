// Tests du proxy de développement Vite (`vite.config.js`) et de son
// interaction avec le contrôle anti-CSRF du backend (`server/app.js`).
// Avant correction, `changeOrigin` par défaut réécrivait le Host transmis
// au backend vers la cible du proxy (localhost:3000), alors que l'Origin
// envoyée par le navigateur restait celle de Vite (localhost:5173) : le
// contrôle Origin === Host (server/app.js) rejetait alors à tort toute
// requête de modification passée par ce proxy. `changeOrigin: false`
// préserve le Host d'origine, qui redevient alors cohérent avec l'Origin
// réelle du navigateur. Base de test isolée (CRM_DATA_DIR), jamais data/**.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

process.env.CRM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-vite-proxy-'));
process.env.NODE_ENV = 'test';
process.env.SITE_ORIGINS = 'https://site-de-test.ch';
process.env.PUBLIC_RATE_LIMIT = '100';

const { default: app } = await import('../server/app.js');
const { default: viteConfig } = await import('../vite.config.js');

const PASSWORD = 'MotDePasseDeTest!42';
let backendServer;
let backendPort;
let viteServer;
let viteBaseUrl;

before(async () => {
  backendServer = http.createServer(app);
  await new Promise((resolve) => backendServer.listen(0, '127.0.0.1', resolve));
  backendPort = backendServer.address().port;

  // Configuration de proxy RÉELLEMENT utilisée par le serveur de
  // développement Vite (`vite.config.js`), avec uniquement la cible
  // substituée par le backend de test ci-dessus (port éphémère) — jamais
  // une reconstruction indépendante qui pourrait diverger silencieusement
  // du fichier de configuration réel sans faire échouer ce test.
  const realApiProxy = viteConfig.server.proxy['/api'];
  const testProxy = { ...realApiProxy, target: `http://127.0.0.1:${backendPort}` };

  viteServer = await createViteServer({
    configFile: false,
    root: fileURLToPath(new URL('../client', import.meta.url)),
    server: { port: 0, host: '127.0.0.1', proxy: { '/api': testProxy }, strictPort: false },
    logLevel: 'silent',
  });
  await viteServer.listen();
  const addr = viteServer.httpServer.address();
  viteBaseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await viteServer?.close();
  await new Promise((resolve) => backendServer.close(resolve));
});

// --- (a) La configuration réellement livrée est celle attendue ---

test('vite.config.js — le proxy /api préserve le Host original (changeOrigin: false)', () => {
  const proxy = viteConfig.server.proxy['/api'];
  assert.equal(proxy.changeOrigin, false);
  assert.equal(proxy.target, 'http://localhost:3000');
});

test('vite.config.js — aucune configuration CORS générique ni wildcard n\'est introduite', () => {
  const raw = JSON.stringify(viteConfig);
  assert.ok(!raw.includes('"*"'), 'aucune valeur "*" ne doit apparaître dans la configuration Vite');
  assert.equal(viteConfig.server.cors, undefined, 'aucune option CORS globale ne doit être activée sur le serveur Vite');
});

test('vite.config.js — le réglage ne modifie jamais la configuration de build (production)', () => {
  assert.ok(!('proxy' in viteConfig.build), 'build ne doit référencer aucune option de proxy');
  assert.ok(!('changeOrigin' in viteConfig.build), 'build ne doit référencer aucune option changeOrigin');
});

// --- (b) Comportement RÉEL à travers le proxy Vite démarré ci-dessus ---

async function proxied(pathAndMethod, { method = 'GET', origin, cookie, body } = {}) {
  const res = await fetch(`${viteBaseUrl}${pathAndMethod}`, {
    method,
    headers: {
      ...(origin ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  return res;
}
function cookieFrom(res) {
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

test('proxy Vite dev (Origin=Host=localhost du proxy) — le compte fictif se crée sans 403 CSRF', async () => {
  const res = await proxied('/api/auth/setup', {
    method: 'POST', origin: viteBaseUrl,
    body: { email: 'conseiller-proxy-fictif@exemple.ch', name: 'Conseiller Fictif', password: PASSWORD },
  });
  assert.notEqual(res.status, 403, 'la requête légitime via le proxy Vite ne doit jamais être bloquée en CSRF');
  assert.equal(res.status, 200);
});

let sessionCookie = '';

test('proxy Vite dev — la connexion réussit et la session persiste (cookies inchangés)', async () => {
  const res = await proxied('/api/auth/login', {
    method: 'POST', origin: viteBaseUrl,
    body: { email: 'conseiller-proxy-fictif@exemple.ch', password: PASSWORD },
  });
  assert.equal(res.status, 200);
  sessionCookie = cookieFrom(res);
  assert.ok(sessionCookie.includes('crm.sid='), 'le cookie de session standard doit toujours être posé');

  const status = await proxied('/api/auth/status', { cookie: sessionCookie });
  const body = await status.json();
  assert.equal(body.authenticated, true);
});

test('proxy Vite dev — une requête POST mutative authentifiée aboutit (pas de 403 CSRF)', async () => {
  const res = await proxied('/api/clients', {
    method: 'POST', origin: viteBaseUrl, cookie: sessionCookie,
    body: { type: 'particulier', first_name: 'Fictif', last_name: 'ProxyTest', status: 'prospect' },
  });
  assert.equal(res.status, 201);
});

test('proxy Vite dev — GET non mutatif reste inchangé même avec une origine externe fictive', async () => {
  const res = await proxied('/api/auth/status', { origin: 'https://origine-externe-fictive.example', cookie: sessionCookie });
  assert.equal(res.status, 200, 'les requêtes GET ne sont jamais soumises au contrôle anti-CSRF (inchangé)');
});

test('proxy Vite dev — une origine externe fictive reste rejetée en 403 sur une requête mutative', async () => {
  const res = await proxied('/api/clients', {
    method: 'POST', origin: 'https://origine-externe-fictive.example', cookie: sessionCookie,
    body: { type: 'particulier', first_name: 'Intrus', last_name: 'Externe', status: 'prospect' },
  });
  assert.equal(res.status, 403);
  const payload = await res.json();
  assert.equal(payload.error, 'Requête intersite refusée.');
});

test('proxy Vite dev — aucune réponse ne renvoie un Access-Control-Allow-Origin générique ("*")', async () => {
  const res = await proxied('/api/clients', {
    method: 'POST', origin: viteBaseUrl, cookie: sessionCookie,
    body: { type: 'particulier', first_name: 'Fictif2', last_name: 'ProxyTest2', status: 'prospect' },
  });
  assert.notEqual(res.headers.get('access-control-allow-origin'), '*');
});

// --- Comportement direct (hors proxy Vite) : chemin de production inchangé ---

test('accès direct au backend (sans proxy, chemin de production) — une origine mismatched reste bloquée exactement comme avant', async () => {
  const res = await fetch(`http://127.0.0.1:${backendPort}/api/clients`, {
    method: 'POST',
    headers: { Origin: 'https://origine-externe-fictive.example', 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify({ type: 'particulier', first_name: 'Intrus', last_name: 'Direct', status: 'prospect' }),
  });
  assert.equal(res.status, 403);
});

test('accès direct au backend (sans proxy, chemin de production) — une requête same-origin réelle reste acceptée exactement comme avant', async () => {
  const res = await fetch(`http://127.0.0.1:${backendPort}/api/clients`, {
    method: 'POST',
    headers: { Origin: `http://127.0.0.1:${backendPort}`, 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify({ type: 'particulier', first_name: 'Fictif3', last_name: 'Direct', status: 'prospect' }),
  });
  assert.equal(res.status, 201);
});
