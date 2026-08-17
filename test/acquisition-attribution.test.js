// A4.2 — Tests du resolver d'attribution (server/acquisition-attribution.js).
// Base SQLite temporaire dédiée (CRM_DATA_DIR), jamais data/**, aucune
// donnée client réelle. Même convention d'import que
// test/lead-attribution-migration.test.js (URL de module distincte par
// scénario pour forcer une nouvelle instance de server/db.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const dbModulePath = fileURLToPath(new URL('../server/db.js', import.meta.url));
const resolverModulePath = fileURLToPath(new URL('../server/acquisition-attribution.js', import.meta.url));

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'crm-acquisition-attribution-'));
}

async function importFreshDb(dataDir) {
  process.env.CRM_DATA_DIR = dataDir;
  const url = `${pathToFileURL(dbModulePath).href}?instance=${Date.now()}-${Math.random()}`;
  const mod = await import(url);
  return mod.default;
}

async function importResolver() {
  const url = `${pathToFileURL(resolverModulePath).href}?instance=${Date.now()}-${Math.random()}`;
  const mod = await import(url);
  return mod.resolveLeadAttribution;
}

function insertCampaign(db, { name, key = null, channelId = null }) {
  return db
    .prepare('INSERT INTO campaigns (name, channel_id, status, key) VALUES (?, ?, ?, ?)')
    .run(name, channelId, 'active', key).lastInsertRowid;
}

function countAll(db) {
  return {
    campaigns: db.prepare('SELECT COUNT(*) AS n FROM campaigns').get().n,
    channels: db.prepare('SELECT COUNT(*) AS n FROM channels').get().n,
    clients: db.prepare('SELECT COUNT(*) AS n FROM clients').get().n,
    lead_attribution: db.prepare('SELECT COUNT(*) AS n FROM lead_attribution').get().n,
    lead_details: db.prepare('SELECT COUNT(*) AS n FROM lead_details').get().n,
  };
}

async function setup() {
  const dataDir = tempDir();
  const db = await importFreshDb(dataDir);
  const resolveLeadAttribution = await importResolver();
  const siteInternet = db.prepare("SELECT id FROM channels WHERE key = 'site_internet'").get();
  const campagnesPub = db.prepare("SELECT id FROM channels WHERE key = 'campagnes_pub'").get();
  return { dataDir, db, resolveLeadAttribution, siteInternet, campagnesPub };
}

function cleanup(dataDir) {
  fs.rmSync(dataDir, { recursive: true, force: true });
}

test('1. aucune clé (ni campaign ni channel) : tout NULL, resolution = none, aucune exception', async () => {
  const { dataDir, db, resolveLeadAttribution } = await setup();
  try {
    const result = resolveLeadAttribution(db, {});
    assert.deepEqual(result, {
      campaignId: null, channelId: null,
      rawCampaignKey: null, rawChannelKey: null,
      campaignMatched: false, channelMatched: false,
      resolution: 'none',
    });
  } finally {
    cleanup(dataDir);
  }
});

test('2. campagne connue avec canal lié, aucun raw channelKey fourni : canal de la campagne résolu', async () => {
  const { dataDir, db, resolveLeadAttribution, siteInternet } = await setup();
  try {
    insertCampaign(db, { name: 'Campagne A', key: 'cmp_a', channelId: siteInternet.id });
    const result = resolveLeadAttribution(db, { campaignKey: 'cmp_a' });
    assert.equal(result.campaignMatched, true);
    assert.equal(result.channelMatched, true);
    assert.equal(result.channelId, siteInternet.id);
    assert.equal(result.resolution, 'campaign');
  } finally {
    cleanup(dataDir);
  }
});

test('3. campagne connue + raw channelKey identique au canal de la campagne : cohérent', async () => {
  const { dataDir, db, resolveLeadAttribution, siteInternet } = await setup();
  try {
    insertCampaign(db, { name: 'Campagne A', key: 'cmp_a', channelId: siteInternet.id });
    const result = resolveLeadAttribution(db, { campaignKey: 'cmp_a', channelKey: 'site_internet' });
    assert.equal(result.channelId, siteInternet.id);
    assert.equal(result.rawChannelKey, 'site_internet');
  } finally {
    cleanup(dataDir);
  }
});

test('4. campagne connue + raw channelKey DIFFÉRENT : le canal de la campagne gagne (aucun couple incohérent)', async () => {
  const { dataDir, db, resolveLeadAttribution, siteInternet, campagnesPub } = await setup();
  try {
    const campaignId = insertCampaign(db, { name: 'Campagne A', key: 'cmp_a', channelId: siteInternet.id });
    const result = resolveLeadAttribution(db, { campaignKey: 'cmp_a', channelKey: 'campagnes_pub' });
    assert.equal(result.campaignId, campaignId);
    assert.equal(result.channelId, siteInternet.id, 'le canal de la campagne doit gagner, pas campagnes_pub');
    assert.notEqual(result.channelId, campagnesPub.id);
    assert.equal(result.rawChannelKey, 'campagnes_pub', 'le raw reçu reste préservé même non retenu pour la résolution');
  } finally {
    cleanup(dataDir);
  }
});

test('5. campagne connue SANS canal propre + raw channelKey connu : résolution indépendante du canal', async () => {
  const { dataDir, db, resolveLeadAttribution, campagnesPub } = await setup();
  try {
    insertCampaign(db, { name: 'Campagne Sans Canal', key: 'cmp_sans_canal', channelId: null });
    const result = resolveLeadAttribution(db, { campaignKey: 'cmp_sans_canal', channelKey: 'campagnes_pub' });
    assert.equal(result.campaignMatched, true);
    assert.equal(result.channelMatched, true);
    assert.equal(result.channelId, campagnesPub.id);
    assert.equal(result.resolution, 'campaign');
  } finally {
    cleanup(dataDir);
  }
});

test('6. campagne connue SANS canal propre + raw channelKey inconnu : channelId NULL, aucune invention', async () => {
  const { dataDir, db, resolveLeadAttribution } = await setup();
  try {
    insertCampaign(db, { name: 'Campagne Sans Canal', key: 'cmp_sans_canal_2', channelId: null });
    const result = resolveLeadAttribution(db, { campaignKey: 'cmp_sans_canal_2', channelKey: 'canal-inconnu-xyz' });
    assert.equal(result.campaignMatched, true);
    assert.equal(result.channelId, null);
    assert.equal(result.channelMatched, false);
    assert.equal(result.rawChannelKey, 'canal-inconnu-xyz');
  } finally {
    cleanup(dataDir);
  }
});

test('7. campagne inconnue + channel connu : campaignId NULL, channel résolu indépendamment', async () => {
  const { dataDir, db, resolveLeadAttribution, siteInternet } = await setup();
  try {
    const result = resolveLeadAttribution(db, { campaignKey: 'cmp_inexistante', channelKey: 'site_internet' });
    assert.equal(result.campaignId, null);
    assert.equal(result.campaignMatched, false);
    assert.equal(result.channelId, siteInternet.id);
    assert.equal(result.channelMatched, true);
    assert.equal(result.rawCampaignKey, 'cmp_inexistante');
    assert.equal(result.resolution, 'channel_only');
  } finally {
    cleanup(dataDir);
  }
});

test('8. campagne inconnue + channel inconnu : tout NULL, resolution = unresolved, aucune exception', async () => {
  const { dataDir, db, resolveLeadAttribution } = await setup();
  try {
    const result = resolveLeadAttribution(db, { campaignKey: 'cmp_inexistante', channelKey: 'canal-inexistant' });
    assert.equal(result.campaignId, null);
    assert.equal(result.channelId, null);
    assert.equal(result.rawCampaignKey, 'cmp_inexistante');
    assert.equal(result.rawChannelKey, 'canal-inexistant');
    assert.equal(result.resolution, 'unresolved');
  } finally {
    cleanup(dataDir);
  }
});

test('9. campaignKey absente (undefined) + channel connu : campagne jamais tentée, channel résolu', async () => {
  const { dataDir, db, resolveLeadAttribution, siteInternet } = await setup();
  try {
    const result = resolveLeadAttribution(db, { channelKey: 'site_internet' });
    assert.equal(result.rawCampaignKey, null);
    assert.equal(result.campaignId, null);
    assert.equal(result.channelId, siteInternet.id);
    assert.equal(result.resolution, 'channel_only');
  } finally {
    cleanup(dataDir);
  }
});

test('10. campaignKey absente + channelKey inconnu : tout NULL', async () => {
  const { dataDir, db, resolveLeadAttribution } = await setup();
  try {
    const result = resolveLeadAttribution(db, { channelKey: 'canal-inexistant' });
    assert.equal(result.campaignId, null);
    assert.equal(result.channelId, null);
    assert.equal(result.resolution, 'unresolved');
  } finally {
    cleanup(dataDir);
  }
});

test('11. espaces en trop trimés avant résolution', async () => {
  const { dataDir, db, resolveLeadAttribution, siteInternet } = await setup();
  try {
    insertCampaign(db, { name: 'Campagne Trim', key: 'cmp_trim', channelId: siteInternet.id });
    const result = resolveLeadAttribution(db, { campaignKey: '  cmp_trim  ', channelKey: '  site_internet  ' });
    assert.equal(result.campaignMatched, true);
    assert.equal(result.rawCampaignKey, 'cmp_trim');
    assert.equal(result.rawChannelKey, 'site_internet');
  } finally {
    cleanup(dataDir);
  }
});

test('12. chaînes vides ou uniquement des espaces normalisées en null', async () => {
  const { dataDir, db, resolveLeadAttribution } = await setup();
  try {
    const result = resolveLeadAttribution(db, { campaignKey: '', channelKey: '   ' });
    assert.equal(result.rawCampaignKey, null);
    assert.equal(result.rawChannelKey, null);
    assert.equal(result.resolution, 'none');
  } finally {
    cleanup(dataDir);
  }
});

test('13. la casse n\'est jamais normalisée silencieusement (comparaison sensible à la casse)', async () => {
  const { dataDir, db, resolveLeadAttribution } = await setup();
  try {
    insertCampaign(db, { name: 'Campagne Casse', key: 'cmp_casse_exacte', channelId: null });
    const result = resolveLeadAttribution(db, { campaignKey: 'CMP_CASSE_EXACTE' });
    assert.equal(result.campaignMatched, false, 'aucun lowercase/uppercase automatique — la clé doit correspondre EXACTEMENT');
    assert.equal(result.campaignId, null);
    assert.equal(result.rawCampaignKey, 'CMP_CASSE_EXACTE', 'la valeur brute reçue est préservée telle quelle, casse incluse');
  } finally {
    cleanup(dataDir);
  }
});

test('14. aucune mutation DB : les compteurs de toutes les tables restent identiques avant/après', async () => {
  const { dataDir, db, resolveLeadAttribution, siteInternet } = await setup();
  try {
    insertCampaign(db, { name: 'Campagne Stable', key: 'cmp_stable', channelId: siteInternet.id });
    const before = countAll(db);
    resolveLeadAttribution(db, { campaignKey: 'cmp_stable', channelKey: 'site_internet' });
    resolveLeadAttribution(db, { campaignKey: 'inconnu', channelKey: 'inconnu' });
    resolveLeadAttribution(db, {});
    const after = countAll(db);
    assert.deepEqual(after, before);
  } finally {
    cleanup(dataDir);
  }
});

test('cohérence : campagne A liée au canal X, raw channelKey Y différent — résolution reste cohérente avec A, raw Y préservé', async () => {
  const { dataDir, db, resolveLeadAttribution, siteInternet, campagnesPub } = await setup();
  try {
    const campaignAId = insertCampaign(db, { name: 'Campagne A', key: 'cmp_coherence_a', channelId: siteInternet.id });
    const result = resolveLeadAttribution(db, { campaignKey: 'cmp_coherence_a', channelKey: 'campagnes_pub' });
    assert.equal(result.campaignId, campaignAId);
    assert.equal(result.channelId, siteInternet.id);
    assert.notEqual(result.channelId, campagnesPub.id);
    assert.equal(result.rawChannelKey, 'campagnes_pub');
  } finally {
    cleanup(dataDir);
  }
});

test('préservation raw : une clé inconnue trimée reste conservée telle quelle, campaignId NULL', async () => {
  const { dataDir, db, resolveLeadAttribution } = await setup();
  try {
    const result = resolveLeadAttribution(db, { campaignKey: ' unknown-123 ' });
    assert.equal(result.rawCampaignKey, 'unknown-123');
    assert.equal(result.campaignId, null);
  } finally {
    cleanup(dataDir);
  }
});

test('aucune exception levée pour une campagne et un canal totalement inconnus', async () => {
  const { dataDir, db, resolveLeadAttribution } = await setup();
  try {
    assert.doesNotThrow(() => {
      resolveLeadAttribution(db, { campaignKey: 'totalement-inconnu', channelKey: 'totalement-inconnu-aussi' });
    });
  } finally {
    cleanup(dataDir);
  }
});

test('une vraie erreur technique DB n\'est jamais masquée en "inconnu" métier', async () => {
  const { dataDir, db, resolveLeadAttribution } = await setup();
  try {
    db.close();
    // La connexion est fermée : toute tentative de requête doit lever une
    // vraie exception better-sqlite3, jamais être avalée silencieusement en
    // un résultat "campaignId: null" qui masquerait une panne réelle.
    assert.throws(() => {
      resolveLeadAttribution(db, { campaignKey: 'peu-importe' });
    }, /database connection is not open|Error/);
  } finally {
    cleanup(dataDir);
  }
});
