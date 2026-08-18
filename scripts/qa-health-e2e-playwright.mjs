// QA-E2E1 — parcours Playwright réel sur l'instance LOCALE ÉPHÉMÈRE QA_MAIN
// (et QA_V1 pour le scénario K). Pilote l'UI exactement comme un conseiller :
// login, foyer, session, questionnaire, analyse, constats, synthèse,
// modification, réanalyse, recommandations.
//
// N'accède à aucun réseau externe, aucun hostname de production. Les seuls
// appels directs DB/service (jamais pour les scénarios principaux
// eux-mêmes) servent à : assertions techniques (audit_log, recommandations,
// findings bruts) et préparation ciblée documentée (ex. lecture du manifeste
// d'IDs de questions déjà produit par qa-health-provision.mjs).
//
// Usage :
//   QA_BASE_URL=http://127.0.0.1:41830 QA_MANIFEST=/tmp/.../qa-manifest.json \
//   QA_DATA_DIR=/tmp/... QA_OUT_DIR=/tmp/.../qa-e2e1-results \
//   NODE_PATH=/opt/node22/lib/node_modules node scripts/qa-health-e2e-playwright.mjs [scenario...]

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const BASE_URL = process.env.QA_BASE_URL;
const MANIFEST_PATH = process.env.QA_MANIFEST;
const DATA_DIR = process.env.QA_DATA_DIR;
const OUT_DIR = process.env.QA_OUT_DIR;
if (!BASE_URL || !MANIFEST_PATH || !DATA_DIR || !OUT_DIR) {
  console.error('QA_BASE_URL, QA_MANIFEST, QA_DATA_DIR et QA_OUT_DIR sont obligatoires.');
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const QIDS = manifest.questionIdsByStableKey;
const ADVISER = manifest.adviser;

function qid(stableKey) {
  const id = QIDS[stableKey];
  if (id == null) throw new Error(`stable_key inconnu dans le manifeste : ${stableKey}`);
  return id;
}

// --- Lecture SQL directe en lecture seule (assertions techniques UNIQUEMENT,
// jamais pour piloter un scénario principal) --------------------------------
function readDb() {
  const dbPath = path.join(DATA_DIR, 'crm.sqlite');
  return new Database(dbPath, { readonly: true });
}

function labelize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).replace(/_/g, ' ');
}

const SECTION_TITLES = {
  'coordination-et-besoins-declares': 'Coordination et besoins déclarés',
  'usage-et-priorites': 'Usage et priorités',
  'modele-de-soins-preferences': 'Modèle de soins — préférences',
  'complementaires-besoins-declares': 'Complémentaires — besoins déclarés',
};
const QUESTION_SECTION = {
  couverture_accident_hors_lamal_declaree: 'coordination-et-besoins-declares',
  couverture_accident_laa_employeur_declaree: 'coordination-et-besoins-declares',
  accident_inclus_lamal_declare: 'coordination-et-besoins-declares',
  franchise_actuelle_niveau_declare: 'coordination-et-besoins-declares',
  capacite_absorber_depense_annuelle: 'coordination-et-besoins-declares',
  tolerance_risque_financier: 'coordination-et-besoins-declares',
  parcours_premier_contact_obligatoire_declare: 'coordination-et-besoins-declares',
  refus_parcours_impose_declare: 'coordination-et-besoins-declares',
  intention_resilier_complementaire_declare: 'coordination-et-besoins-declares',
  acceptation_nouvelle_complementaire_confirmee: 'coordination-et-besoins-declares',
  recours_soins_12_mois_declare: 'usage-et-priorites',
  depenses_sante_anticipees_declare: 'usage-et-priorites',
  priorite_prime_liberte_declaree: 'usage-et-priorites',
  importance_conserver_medecin_declaree: 'modele-de-soins-preferences',
  ouverture_telemedecine_declaree: 'modele-de-soins-preferences',
  ouverture_medecin_famille_declaree: 'modele-de-soins-preferences',
  ouverture_hmo_reseau_declaree: 'modele-de-soins-preferences',
  priorite_libre_choix_declaree: 'modele-de-soins-preferences',
  interet_complementaire_hospitalisation_declare: 'complementaires-besoins-declares',
  interet_medecines_complementaires_declare: 'complementaires-besoins-declares',
  interet_complementaire_optique_declare: 'complementaires-besoins-declares',
  interet_complementaire_dentaire_declare: 'complementaires-besoins-declares',
  interet_prevention_declare: 'complementaires-besoins-declares',
  interet_couverture_voyage_declare: 'complementaires-besoins-declares',
};

const results = [];
function record(scenario, ok, details) {
  results.push({ scenario, ok, details, ts: new Date().toISOString() });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${scenario} — ${details}`);
}

// --- Helpers UI --------------------------------------------------------------

async function login(page) {
  await page.goto(`${BASE_URL}/`);
  await page.getByLabel('Adresse e-mail').fill(ADVISER.email);
  await page.getByLabel('Mot de passe').fill(ADVISER.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(`${BASE_URL}/`);
  await page.locator('.sidebar').first().waitFor({ state: 'visible' });
}

async function createHousehold(page, lastName, firstName) {
  await page.goto(`${BASE_URL}/diagnostic-360/foyers`);
  await page.getByRole('button', { name: '+ Nouveau foyer' }).click();
  await page.getByRole('button', { name: '+ Créer une nouvelle personne' }).click();
  await page.getByLabel('Nom', { exact: true }).fill(lastName);
  if (firstName) await page.getByLabel('Prénom').fill(firstName);
  await page.getByLabel('Date de naissance').fill('1990-01-01');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  // Retour à la modale foyer : créer directement.
  await page.getByRole('button', { name: 'Créer le foyer' }).click();

  // HouseholdCreateForm peut volontairement demander une confirmation
  // intermédiaire lorsque l'API signale already_in_households.
  const detailUrl = /\/diagnostic-360\/foyers\/\d+$/;
  const continueButton = page.getByRole('button', { name: 'Continuer vers le foyer' });

  const outcome = await Promise.race([
    page.waitForURL(detailUrl, { timeout: 10000 }).then(() => 'detail'),
    continueButton.waitFor({ state: 'visible', timeout: 10000 }).then(() => 'continue'),
  ]);

  if (outcome === 'continue') {
    await continueButton.click();
    await page.waitForURL(detailUrl, { timeout: 10000 });
  }

  const url = page.url();
  return Number(url.match(/foyers\/(\d+)$/)[1]);
}

async function addMember(page, householdId, { firstName, lastName, role, birthDate = '1985-06-15' }) {
  await page.goto(`${BASE_URL}/diagnostic-360/foyers/${householdId}`);
  await page.locator('.card').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: '+ Ajouter un membre' }).click();
  await page.getByRole('radio', { name: 'Nouvelle personne (enfant…)' }).click();
  await page.getByLabel('Prénom').fill(firstName);
  await page.getByLabel('Nom', { exact: true }).fill(lastName);
  // Constat QA-E2E1 (défaut découvert, non corrigé ici — voir rapport final) :
  // le serveur (server/advisoryHouseholds.js, assert isDateStr(new_person.birth_date))
  // exige inconditionnellement une date de naissance valide pour une
  // « nouvelle personne », alors que le champ n'est ni marqué requis ni
  // documenté comme obligatoire côté UI (AddMemberForm, Clients.jsx).
  await page.getByLabel('Date de naissance').fill(birthDate);
  await page.getByLabel('Rôle dans le foyer').selectOption(role);
  let respPromise = page.waitForResponse((r) => r.url().includes(`/households/${householdId}/members`) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Ajouter au foyer' }).click();
  let resp = await respPromise;
  if (resp.status() === 409) {
    // Similarité détectée (AddMemberForm) : confirmation explicite qu'il
    // s'agit d'une personne différente, jamais un repli silencieux.
    respPromise = page.waitForResponse((r) => r.url().includes(`/households/${householdId}/members`) && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Confirmer : il s\'agit d\'une personne différente' }).click();
    resp = await respPromise;
  }
  if (resp.status() >= 400) throw new Error(`addMember a échoué (status ${resp.status()}): ${await resp.text().catch(() => '')}`);
  const body = await resp.json().catch(() => ({}));
  await page.waitForTimeout(300);
  return body;
}

async function removeMember(page, householdId, displayNameSubstring) {
  await page.goto(`${BASE_URL}/diagnostic-360/foyers/${householdId}`);
  page.once('dialog', (d) => d.accept());
  await page.locator('tr', { hasText: displayNameSubstring }).getByRole('button', { name: 'Retirer' }).click();
  await page.waitForTimeout(300);
}

async function createSession(page, householdLabel, domain) {
  await page.goto(`${BASE_URL}/diagnostic-360/sessions`);
  await page.getByRole('button', { name: '+ Nouvelle session' }).click();
  await page.getByPlaceholder('Rechercher un foyer (nom, principal)…').fill(householdLabel);
  await page.locator('.modal, [role="dialog"], .card').getByText(householdLabel, { exact: false }).first().click();
  await page.getByLabel('Domaine').selectOption(domain);
  // Sélection EXPLICITE de la version « v2 » -- jamais un premier élément
  // supposé (correction QA-E2E0 §4/§5) : on choisit l'option dont le texte
  // contient exactement « v2 ».
  const healthSelect = page.locator('label.field').filter({ has: page.locator('span', { hasText: /^Assurance Maladie$/ }) }).locator('select');
  await healthSelect.waitFor({ state: 'visible' });
  const options = await healthSelect.locator('option').allTextContents();
  const v2Option = options.find((o) => /—\s*v2\s*$/.test(o.trim()));
  if (!v2Option) throw new Error(`Aucune option de version « v2 » trouvée parmi : ${JSON.stringify(options)}`);
  await healthSelect.selectOption({ label: v2Option });
  await page.getByRole('button', { name: 'Créer la session' }).click();
  await page.waitForURL(/\/diagnostic-360\/sessions\/\d+$/, { timeout: 10000 });
  return Number(page.url().match(/sessions\/(\d+)$/)[1]);
}

async function startSession(page, sessionId) {
  await page.goto(`${BASE_URL}/diagnostic-360/sessions/${sessionId}/workspace`);
  await page.locator('.tiles').first().waitFor({ state: 'visible', timeout: 15000 });
  const startBtn = page.getByRole('button', { name: 'Démarrer' });
  if (await startBtn.count() > 0) {
    await startBtn.click();
    await page.waitForTimeout(400);
  }
}

async function goToSection(page, stableKey) {
  const title = SECTION_TITLES[QUESTION_SECTION[stableKey]];
  await page.locator('.wksp-rail').getByRole('button', { name: title }).click();
  await page.waitForTimeout(150);
}

async function goToMember(page, memberSubstring) {
  const seg = page.locator('.wksp-member-switch .seg');
  if (await seg.isVisible().catch(() => false)) {
    await seg.getByRole('button', { name: new RegExp(memberSubstring) }).click();
    await page.waitForTimeout(150);
  }
}

async function answerOne(page, stableKey, value, memberSubstring) {
  await goToSection(page, stableKey);
  if (memberSubstring) await goToMember(page, memberSubstring);
  const id = qid(stableKey);
  // household ou membre courant -- on résout le household_member_id réel via
  // le DOM (id de la carte question rendue), jamais supposé.
  const card = page.locator(`[id^="question-${id}-"]`).first();
  await card.waitFor({ state: 'visible', timeout: 10000 });
  const label = labelize(value);
  await card.getByRole('radio', { name: label, exact: true }).click();
  await card.locator('.save-state.saved').waitFor({ timeout: 8000 }).catch(() => {});
}

async function answerUnknown(page, stableKey, memberSubstring) {
  await goToSection(page, stableKey);
  if (memberSubstring) await goToMember(page, memberSubstring);
  const id = qid(stableKey);
  const card = page.locator(`[id^="question-${id}-"]`).first();
  await card.waitFor({ state: 'visible', timeout: 10000 });
  await card.getByRole('button', { name: 'Je ne sais pas encore' }).click();
  await page.waitForTimeout(300);
}

async function answerMany(page, answers, memberSubstring) {
  for (const [stableKey, value] of Object.entries(answers)) {
    await answerOne(page, stableKey, value, memberSubstring);
  }
}

async function finalizeSession(page, sessionId) {
  await page.goto(`${BASE_URL}/diagnostic-360/sessions/${sessionId}/workspace`);
  await page.getByRole('button', { name: 'Vérifier avant de finaliser' }).click();
  await page.getByRole('button', { name: 'Finaliser la session' }).click();
  await page.getByRole('button', { name: 'Confirmer la finalisation' }).click();
  await page.waitForTimeout(400);
}

// La liste des domaines d'exécution applicables (advisoryRuleExecutions.js,
// allowedExecutionDomainsForSession) inclut toujours « common » en plus du
// domaine propre de la session -- même sans questionnaire commun rattaché --
// dès qu'au moins un rule_set existe pour ce domaine (même non publié, non
// vérifié ici). L'onglet « Assurance Maladie » n'est donc pas forcément
// l'onglet actif par défaut (le premier de DOMAIN_ORDER = common) : on le
// sélectionne explicitement chaque fois qu'un tablist de domaines existe.
async function goToHealthDomainTab(page) {
  await page.locator('.tiles, .empty').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  const tabs = page.locator('.wksp-modules[role="tablist"]');
  if (await tabs.count() > 0) {
    await tabs.getByRole('tab', { name: 'Assurance Maladie' }).click();
    await page.waitForTimeout(300);
  }
}

async function launchAnalysis(page, sessionId) {
  await page.goto(`${BASE_URL}/diagnostic-360/sessions/${sessionId}/findings`);
  await page.getByRole('button', { name: "Lancer l'analyse" }).waitFor({ state: 'visible', timeout: 15000 });
  const respPromise = page.waitForResponse((r) => r.url().includes(`/sessions/${sessionId}/analyze`) && r.request().method() === 'POST');
  await page.getByRole('button', { name: "Lancer l'analyse" }).click();
  await respPromise;
  await page.waitForTimeout(500);
}

async function openSynthesis(page, sessionId) {
  await page.goto(`${BASE_URL}/diagnostic-360/sessions/${sessionId}/health-synthesis`);
  await page.locator('.synth-status-band, .empty, .alert.error, .alert.warn').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(200);
}

async function amendAnswer(page, sessionId, questionAdvisorTextSubstring, newValue, reason) {
  await page.goto(`${BASE_URL}/diagnostic-360/sessions/${sessionId}/workspace`);
  await page.getByRole('button', { name: 'Corriger une réponse' }).first().click();
  await page.getByPlaceholder('Texte de la question, section, membre…').fill(questionAdvisorTextSubstring);
  await page.locator('.amend-picker').getByText(questionAdvisorTextSubstring, { exact: false }).first().click();
  const label = labelize(newValue);
  await page.locator('label.field', { hasText: 'Nouvelle valeur' }).getByRole('radio', { name: label, exact: true }).click();
  await page.getByPlaceholder('', { exact: false }).last(); // no-op placeholder guard
  await page.locator('textarea').fill(reason);
  await page.getByRole('button', { name: 'Enregistrer la correction' }).click();
  await page.waitForTimeout(400);
}

async function dismissFinding(page, sessionId, reason, titleSubstring) {
  await page.goto(`${BASE_URL}/diagnostic-360/sessions/${sessionId}/findings`);
  await goToHealthDomainTab(page);
  const card = titleSubstring
    ? page.locator('.finding-card:not(.dismissed)', { hasText: titleSubstring }).first()
    : page.locator('.finding-card:not(.dismissed)').filter({ hasNot: page.getByText('Compléter l’information') }).first();
  await card.getByRole('button', { name: 'Écarter ce constat' }).click();
  await page.locator('textarea').fill(reason);
  await page.getByRole('button', { name: 'Écarter' }).click();
  await page.waitForTimeout(400);
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });
}

// --- Assertions DB directes (techniques UNIQUEMENT) -------------------------

function countRecommendations() {
  const db = readDb();
  try { return db.prepare('SELECT COUNT(*) AS n FROM advisory_recommendations').get().n; }
  finally { db.close(); }
}
function countAuditLog(actionLike) {
  const db = readDb();
  try { return db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE ?").get(`%${actionLike}%`).n; }
  finally { db.close(); }
}
function rawAuditRows(actionLike) {
  const db = readDb();
  try { return db.prepare("SELECT id, action, entity, entity_id, details, created_at FROM audit_log WHERE action LIKE ? ORDER BY id").all(`%${actionLike}%`); }
  finally { db.close(); }
}

// --- Scénarios ----------------------------------------------------------------

const scenarioFns = {};

scenarioFns.G = async (page) => {
  const hh = await createHousehold(page, 'QA Nissim NotRun');
  const sid = await createSession(page, 'QA Nissim NotRun', 'health');
  await startSession(page, sid);
  await answerMany(page, {
    couverture_accident_hors_lamal_declaree: 'non', accident_inclus_lamal_declare: 'non',
    franchise_actuelle_niveau_declare: 'moyenne', capacite_absorber_depense_annuelle: 'moyenne',
    tolerance_risque_financier: 'moyenne', recours_soins_12_mois_declare: 'modere',
    depenses_sante_anticipees_declare: 'probablement_faibles', priorite_prime_liberte_declaree: 'equilibre',
    importance_conserver_medecin_declaree: 'non_important',
  });
  await finalizeSession(page, sid);
  // Aucune analyse lancée -- ouverture directe de la synthèse.
  await openSynthesis(page, sid);
  const badge = await page.locator('.synth-status-band .badge').first().textContent();
  const bannerVisible = await page.getByText('Aucune analyse n’est encore été exécutée', { exact: false }).isVisible().catch(() => false)
    || await page.getByText("n'a encore été exécutée", { exact: false }).isVisible().catch(() => false);
  const ok = /non ex[ée]cut[ée]e|not_run|jamais analys[ée]/i.test(badge || '') || bannerVisible;
  record('G-NOT_RUN', ok, `badge="${badge}" bannerVisible=${bannerVisible}`);
  await screenshot(page, 'scenario-G-synthesis');
  return { hh, sid };
};

scenarioFns.D = async (page) => {
  const hh = await createHousehold(page, 'QA Nissim Partial');
  const sid = await createSession(page, 'QA Nissim Partial', 'health');
  await startSession(page, sid);
  await answerMany(page, {
    couverture_accident_hors_lamal_declaree: 'non', accident_inclus_lamal_declare: 'non',
    franchise_actuelle_niveau_declare: 'moyenne', capacite_absorber_depense_annuelle: 'moyenne',
    tolerance_risque_financier: 'moyenne', recours_soins_12_mois_declare: 'modere',
    depenses_sante_anticipees_declare: 'probablement_faibles', priorite_prime_liberte_declaree: 'equilibre',
    importance_conserver_medecin_declaree: 'non_important',
    // Optionnels volontairement laissés sans réponse : ouverture_telemedecine,
    // ouverture_medecin_famille, ouverture_hmo, priorite_libre_choix,
    // les 6 complémentaires.
  });
  await finalizeSession(page, sid);
  await launchAnalysis(page, sid);
  await openSynthesis(page, sid);
  const badge = await page.locator('.synth-status-band .badge').nth(1).textContent();
  const ok = /partiel/i.test(badge || '');
  record('D-PARTIAL', ok, `completeness badge="${badge}"`);
  return { hh, sid };
};

scenarioFns.E = async (page) => {
  const hh = await createHousehold(page, 'QA Nissim Blocked');
  const sid = await createSession(page, 'QA Nissim Blocked', 'health');
  await startSession(page, sid);
  await answerMany(page, {
    couverture_accident_hors_lamal_declaree: 'non', accident_inclus_lamal_declare: 'non',
    franchise_actuelle_niveau_declare: 'moyenne', tolerance_risque_financier: 'moyenne',
    recours_soins_12_mois_declare: 'modere', depenses_sante_anticipees_declare: 'probablement_faibles',
    priorite_prime_liberte_declaree: 'equilibre', importance_conserver_medecin_declaree: 'non_important',
  });
  await answerUnknown(page, 'capacite_absorber_depense_annuelle');
  await finalizeSession(page, sid);
  await launchAnalysis(page, sid);
  await openSynthesis(page, sid);
  const badge = await page.locator('.synth-status-band .badge').nth(1).textContent();
  const missingListVisible = await page.locator('.missing-list li').first().isVisible().catch(() => false);
  const missingText = missingListVisible ? await page.locator('.missing-list li').first().textContent() : null;
  const humanReadable = missingText && !/^capacite_absorber_depense_annuelle$/.test(missingText.trim());
  const ok = /incompl[eè]te|bloqu/i.test(badge || '') && missingListVisible && humanReadable;
  record('E-BLOCKED', ok, `badge="${badge}" missingText="${missingText}"`);
  await screenshot(page, 'scenario-E-synthesis');

  await page.goto(`${BASE_URL}/diagnostic-360/sessions/${sid}/findings`);
  await goToHealthDomainTab(page);
  const findingsMissingVisible = await page.getByText('Information manquante', { exact: false }).first().isVisible().catch(() => false);
  record('E-BLOCKED-findings-projection', findingsMissingVisible, `missing_information projeté visible dans Findings=${findingsMissingVisible}`);
  return { hh, sid };
};

scenarioFns.B = async (page) => {
  const hh = await createHousehold(page, 'QA Nissim Prudente');
  const sid = await createSession(page, 'QA Nissim Prudente', 'health');
  await startSession(page, sid);
  await answerMany(page, {
    couverture_accident_hors_lamal_declaree: 'non', accident_inclus_lamal_declare: 'non',
    franchise_actuelle_niveau_declare: 'moyenne', capacite_absorber_depense_annuelle: 'faible',
    tolerance_risque_financier: 'moyenne', recours_soins_12_mois_declare: 'modere',
    depenses_sante_anticipees_declare: 'probablement_moderees', priorite_prime_liberte_declaree: 'equilibre',
    importance_conserver_medecin_declaree: 'non_important',
  });
  await finalizeSession(page, sid);
  await launchAnalysis(page, sid);
  await openSynthesis(page, sid);
  const orientationText = await page.locator('.card', { hasText: 'Franchise' }).first().locator('.synth-field').first().textContent();
  const ok = /prudente/i.test(orientationText || '');
  record('B-FRANCHISE_PRUDENTE', ok, `franchise.orientation="${orientationText?.trim()}"`);
  return { hh, sid };
};

scenarioFns.C = async (page) => {
  const hh = await createHousehold(page, 'QA Nissim Indeterminee');
  const sid = await createSession(page, 'QA Nissim Indeterminee', 'health');
  await startSession(page, sid);
  await answerMany(page, {
    couverture_accident_hors_lamal_declaree: 'non', accident_inclus_lamal_declare: 'non',
    franchise_actuelle_niveau_declare: 'moyenne', capacite_absorber_depense_annuelle: 'moyenne',
    tolerance_risque_financier: 'moyenne', recours_soins_12_mois_declare: 'modere',
    depenses_sante_anticipees_declare: 'probablement_faibles', priorite_prime_liberte_declaree: 'equilibre',
    importance_conserver_medecin_declaree: 'non_important',
  });
  await finalizeSession(page, sid);
  await launchAnalysis(page, sid);
  await openSynthesis(page, sid);
  const franchiseCard = page.locator('.card', { hasText: 'Franchise' }).first();
  const orientationText = await franchiseCard.locator('.synth-field').nth(0).textContent();
  const comparisonText = await franchiseCard.locator('.synth-field').nth(1).textContent();
  const ok = /ind[ée]termin[ée]e/i.test(orientationText || '') && /comparaison impossible/i.test(comparisonText || '');
  record('C-FRANCHISE_INDETERMINATE', ok, `orientation="${orientationText?.trim()}" comparison="${comparisonText?.trim()}"`);
  return { hh, sid };
};

scenarioFns.A = async (page) => {
  const hh = await createHousehold(page, 'QA Martin Principal');
  const sid = await createSession(page, 'QA Martin Principal', 'health');
  await startSession(page, sid);
  await answerMany(page, {
    couverture_accident_hors_lamal_declaree: 'oui',
  });
  await answerMany(page, {
    couverture_accident_laa_employeur_declaree: 'oui',
    accident_inclus_lamal_declare: 'oui',
    franchise_actuelle_niveau_declare: 'elevee',
    capacite_absorber_depense_annuelle: 'elevee',
    tolerance_risque_financier: 'elevee',
  });
  await answerMany(page, {
    recours_soins_12_mois_declare: 'faible',
    depenses_sante_anticipees_declare: 'aucune',
    priorite_prime_liberte_declaree: 'equilibre',
  });
  await answerMany(page, {
    importance_conserver_medecin_declaree: 'important',
    ouverture_telemedecine_declaree: 'accepte',
    ouverture_medecin_famille_declaree: 'preferee',
    ouverture_hmo_reseau_declaree: 'refuse',
    priorite_libre_choix_declaree: 'prioritaire',
  });
  await answerMany(page, {
    interet_complementaire_hospitalisation_declare: 'important',
    interet_medecines_complementaires_declare: 'pas_important',
    interet_complementaire_optique_declare: 'eventuellement',
    interet_complementaire_dentaire_declare: 'pas_important',
    interet_prevention_declare: 'important',
    interet_couverture_voyage_declare: 'pas_important',
  });
  await finalizeSession(page, sid);
  await launchAnalysis(page, sid);
  await openSynthesis(page, sid);

  const completenessBadge = await page.locator('.synth-status-band .badge').nth(1).textContent();
  const franchiseCard = page.locator('.card', { hasText: 'Franchise' }).first();
  const orientationText = await franchiseCard.locator('.synth-field').nth(0).textContent();
  const comparisonText = await franchiseCard.locator('.synth-field').nth(1).textContent();
  const accidentCard = page.locator('.card', { hasText: 'Accident' }).first();
  const accidentText = await accidentCard.locator('.synth-field').first().textContent();
  const complCard = page.locator('.card', { hasText: 'Complémentaires' }).first();
  const complRowsText = await complCard.locator('.synth-compact-row').allTextContents();
  const hasAExaminer = complRowsText.some((t) => /à examiner/i.test(t));
  const hasNonPrioritaire = complRowsText.some((t) => /non prioritaire/i.test(t));

  const ok = /complet|complèt/i.test(completenessBadge || '')
    && /[ée]lev[ée]e potentiellement adapt[ée]e/i.test(orientationText || '')
    && /align[ée]e/i.test(comparisonText || '')
    && /examinable/i.test(accidentText || '')
    && hasAExaminer && hasNonPrioritaire;
  record('A-COMPLET_CURRENT', ok, `completeness="${completenessBadge}" orientation="${orientationText?.trim()}" comparison="${comparisonText?.trim()}" accident="${accidentText?.trim()}" complementaires=${JSON.stringify(complRowsText)} hasAExaminer=${hasAExaminer} hasNonPrioritaire=${hasNonPrioritaire}`);
  await screenshot(page, 'scenario-A-synthesis-desktop');

  // Checklist humaine + capture iPad (§11/§12)
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.waitForTimeout(200);
  await screenshot(page, 'scenario-A-synthesis-ipad');
  const scrollCheck = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  record('A-RESPONSIVE-ipad-no-hscroll', scrollCheck.scrollWidth <= scrollCheck.clientWidth + 1, JSON.stringify(scrollCheck));
  await page.setViewportSize({ width: 1180, height: 820 });

  return { hh, sid };
};

scenarioFns.F = async (page) => {
  const hh = await createHousehold(page, 'QA Nissim Stale');
  const sid = await createSession(page, 'QA Nissim Stale', 'health');
  await startSession(page, sid);
  await answerMany(page, {
    couverture_accident_hors_lamal_declaree: 'non', accident_inclus_lamal_declare: 'non',
    franchise_actuelle_niveau_declare: 'moyenne', capacite_absorber_depense_annuelle: 'faible',
    tolerance_risque_financier: 'moyenne', recours_soins_12_mois_declare: 'modere',
    depenses_sante_anticipees_declare: 'probablement_moderees', priorite_prime_liberte_declaree: 'equilibre',
    importance_conserver_medecin_declaree: 'non_important',
  });
  await finalizeSession(page, sid);
  await launchAnalysis(page, sid);
  await openSynthesis(page, sid);
  const beforeStatus = await page.locator('.synth-status-band .badge').first().textContent();

  await amendAnswer(page, sid, 'Comment le client évalue-t-il sa capacité financière', 'elevee', 'QA-E2E1 scénario F — modification volontaire pour provoquer un état obsolète.');

  await openSynthesis(page, sid);
  const afterStatus = await page.locator('.synth-status-band .badge').first().textContent();
  const staleBannerVisible = await page.locator('.alert.warn', { hasText: 'Relancez l’analyse' }).isVisible().catch(() => false)
    || await page.locator('.alert.warn', { hasText: "évolué depuis" }).isVisible().catch(() => false);
  const ok = /current|à jour/i.test(beforeStatus || '') && /stale|obsol|relancer/i.test(afterStatus || '') && staleBannerVisible;
  record('F-STALE', ok, `before="${beforeStatus}" after="${afterStatus}" banner=${staleBannerVisible}`);
  await screenshot(page, 'scenario-F-stale');

  // Réanalyse -> retour à current (parcours humain complet §8).
  await launchAnalysis(page, sid);
  await openSynthesis(page, sid);
  const reanalyzedStatus = await page.locator('.synth-status-band .badge').first().textContent();
  record('F-STALE-reanalyzed-to-current', /current|à jour/i.test(reanalyzedStatus || ''), `status après réanalyse="${reanalyzedStatus}"`);

  await page.goto(`${BASE_URL}/diagnostic-360/sessions/${sid}/recommendations`);
  const recoPageOk = await page.locator('h1', { hasText: 'Recommandations' }).first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
  record('F-recommendations-reachable', recoPageOk, `page recommandations atteinte=${recoPageOk}`);

  return { hh, sid };
};

scenarioFns.H = async (page) => {
  const hh = await createHousehold(page, 'QA Multi Principal');
  const m2 = await addMember(page, hh, { firstName: 'Multi', lastName: 'QA Multi Conjoint', role: 'conjoint' });
  const m3 = await addMember(page, hh, { firstName: 'Multi', lastName: 'QA Multi Enfant', role: 'enfant' });
  const sid = await createSession(page, 'QA Multi Principal', 'health');
  await startSession(page, sid);

  const CORE_COMMON = {
    couverture_accident_hors_lamal_declaree: 'non', accident_inclus_lamal_declare: 'non',
    priorite_prime_liberte_declaree: 'equilibre', importance_conserver_medecin_declaree: 'non_important',
  };
  // Principal -> orientation élevée. Conjoint -> prudente. Enfant -> indéterminée
  // -- 3 profils VOLONTAIREMENT différents pour vérifier l'isolation stricte
  // entre membres (aucune contamination croisée, GATE LOT 4A §3).
  const perMember = [
    ['Principal', { franchise_actuelle_niveau_declare: 'elevee', capacite_absorber_depense_annuelle: 'elevee', tolerance_risque_financier: 'elevee', recours_soins_12_mois_declare: 'faible', depenses_sante_anticipees_declare: 'aucune' }, /[ée]lev[ée]e potentiellement adapt[ée]e/i],
    ['Conjoint', { franchise_actuelle_niveau_declare: 'moyenne', capacite_absorber_depense_annuelle: 'faible', tolerance_risque_financier: 'moyenne', recours_soins_12_mois_declare: 'modere', depenses_sante_anticipees_declare: 'probablement_moderees' }, /prudente/i],
    ['Enfant', { franchise_actuelle_niveau_declare: 'moyenne', capacite_absorber_depense_annuelle: 'moyenne', tolerance_risque_financier: 'moyenne', recours_soins_12_mois_declare: 'modere', depenses_sante_anticipees_declare: 'probablement_faibles' }, /ind[ée]termin[ée]e/i],
  ];
  for (const [substr, answers] of perMember) {
    await answerMany(page, { ...CORE_COMMON, ...answers }, substr);
  }

  await finalizeSession(page, sid);
  await launchAnalysis(page, sid);
  await openSynthesis(page, sid);
  const tabsCount = await page.locator('.synth-member-tabs [role="tab"]').count();
  record('H-MULTI_MEMBRES-tabs', tabsCount === 3, `nombre d'onglets membre=${tabsCount} (attendu 3)`);

  let isolationOk = true;
  const isolationDetails = [];
  for (const [substr, , expectedRegex] of perMember) {
    await page.locator('.synth-member-tabs [role="tab"]', { hasText: substr }).click();
    await page.waitForTimeout(200);
    const orientationText = await page.locator('.card', { hasText: 'Franchise' }).first().locator('.synth-field').first().textContent();
    const matches = expectedRegex.test(orientationText || '');
    isolationOk = isolationOk && matches;
    isolationDetails.push(`${substr}: "${orientationText?.trim()}" attendu=${expectedRegex} match=${matches}`);
  }
  record('H-MULTI_MEMBRES-isolation', isolationOk, isolationDetails.join(' | '));
  await screenshot(page, 'scenario-H-multi-membres');
  return { hh, sid, m2, m3 };
};

scenarioFns.I = async (page) => {
  const hh = await createHousehold(page, 'QA Historique Principal');
  const m2 = await addMember(page, hh, { firstName: 'Sortant', lastName: 'QA Historique Conjoint', role: 'conjoint' });
  const sid = await createSession(page, 'QA Historique Principal', 'health');
  await startSession(page, sid);
  const coreAnswers = {
    couverture_accident_hors_lamal_declaree: 'non', accident_inclus_lamal_declare: 'non',
    franchise_actuelle_niveau_declare: 'moyenne', capacite_absorber_depense_annuelle: 'moyenne',
    tolerance_risque_financier: 'moyenne', recours_soins_12_mois_declare: 'modere',
    depenses_sante_anticipees_declare: 'probablement_faibles', priorite_prime_liberte_declaree: 'equilibre',
    importance_conserver_medecin_declaree: 'non_important',
  };
  // Les deux membres doivent répondre (question scope=member) pour que la
  // session puisse être finalisée -- le retrait n'intervient qu'ensuite.
  await answerMany(page, coreAnswers, 'Principal');
  await answerMany(page, coreAnswers, 'Conjoint');
  await finalizeSession(page, sid);
  await launchAnalysis(page, sid);

  await removeMember(page, hh, 'QA Historique Conjoint');

  await openSynthesis(page, sid);
  const historicalTabVisible = await page.locator('.synth-member-tabs [role="tab"]', { hasText: 'retiré du foyer' }).isVisible().catch(() => false);
  record('I-MEMBRE_HISTORIQUE', historicalTabVisible, `onglet « · retiré du foyer » visible=${historicalTabVisible}`);
  await screenshot(page, 'scenario-I-historique');
  return { hh, sid, m2 };
};

scenarioFns.J = async (page) => {
  const hh = await createHousehold(page, 'QA Nissim Dismissed');
  const sid = await createSession(page, 'QA Nissim Dismissed', 'health');
  await startSession(page, sid);
  await answerMany(page, {
    couverture_accident_hors_lamal_declaree: 'oui', couverture_accident_laa_employeur_declaree: 'oui',
    accident_inclus_lamal_declare: 'oui',
    franchise_actuelle_niveau_declare: 'moyenne', capacite_absorber_depense_annuelle: 'moyenne',
    tolerance_risque_financier: 'moyenne', recours_soins_12_mois_declare: 'modere',
    depenses_sante_anticipees_declare: 'probablement_faibles', priorite_prime_liberte_declaree: 'equilibre',
    importance_conserver_medecin_declaree: 'non_important',
  });
  await finalizeSession(page, sid);
  await launchAnalysis(page, sid);
  await openSynthesis(page, sid);
  const accidentBefore = await page.locator('.card', { hasText: 'Accident' }).first().locator('.synth-field').first().textContent();

  await dismissFinding(page, sid, 'QA-E2E1 scénario J — écartement volontaire pour vérifier la non-réutilisation en synthèse.', 'Retrait');

  await openSynthesis(page, sid);
  const accidentAfter = await page.locator('.card', { hasText: 'Accident' }).first().locator('.synth-field').first().textContent();
  const changed = (accidentBefore || '').trim() !== (accidentAfter || '').trim();

  await page.goto(`${BASE_URL}/diagnostic-360/sessions/${sid}/findings`);
  await goToHealthDomainTab(page);
  await page.locator('.chip', { hasText: 'Écartés' }).click();
  const dismissedVisible = await page.locator('.finding-card.dismissed').first().isVisible().catch(() => false);

  const ok = changed && dismissedVisible;
  record('J-FINDING_DISMISSED', ok, `accidentBefore="${accidentBefore?.trim()}" accidentAfter="${accidentAfter?.trim()}" changed=${changed} dismissedStillVisibleInHistory=${dismissedVisible}`);
  return { hh, sid };
};

async function runScenarioK(browser) {
  const manifestV1Path = process.env.QA_V1_MANIFEST;
  const baseUrlV1 = process.env.QA_V1_BASE_URL;
  if (!manifestV1Path || !baseUrlV1) {
    record('K-VERSION_V1', false, 'QA_V1_MANIFEST / QA_V1_BASE_URL non fournis — scénario non exécuté.');
    return;
  }
  const manifestV1 = JSON.parse(fs.readFileSync(manifestV1Path, 'utf8'));
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
  await page.goto(`${baseUrlV1}/`);
  await page.getByLabel('Adresse e-mail').fill(manifestV1.adviser.email);
  await page.getByLabel('Mot de passe').fill(manifestV1.adviser.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(`${baseUrlV1}/`);

  await page.goto(`${baseUrlV1}/diagnostic-360/foyers`);
  await page.getByRole('button', { name: '+ Nouveau foyer' }).click();
  await page.getByRole('button', { name: '+ Créer une nouvelle personne' }).click();
  await page.getByLabel('Nom', { exact: true }).fill('QA Nissim VersionV1');
  await page.getByLabel('Date de naissance').fill('1990-01-01');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByRole('button', { name: 'Créer le foyer' }).click();
  await page.waitForURL(/\/diagnostic-360\/foyers\/\d+$/);
  const hhId = Number(page.url().match(/foyers\/(\d+)$/)[1]);

  await page.goto(`${baseUrlV1}/diagnostic-360/sessions`);
  await page.getByRole('button', { name: '+ Nouvelle session' }).click();
  await page.getByPlaceholder('Rechercher un foyer (nom, principal)…').fill('QA Nissim VersionV1');
  await page.locator('.modal, [role="dialog"], .card').getByText('QA Nissim VersionV1', { exact: false }).first().click();
  await page.getByLabel('Domaine').selectOption('health');
  const healthSelect = page.locator('label.field').filter({ has: page.locator('span', { hasText: /^Assurance Maladie$/ }) }).locator('select');
  await healthSelect.waitFor({ state: 'visible' });
  const options = await healthSelect.locator('option').allTextContents();
  const v1Option = options.find((o) => /—\s*v1\s*$/.test(o.trim()));
  if (!v1Option) throw new Error(`Aucune option de version « v1 » trouvée parmi : ${JSON.stringify(options)}`);
  await healthSelect.selectOption({ label: v1Option });
  await page.getByRole('button', { name: 'Créer la session' }).click();
  await page.waitForURL(/\/diagnostic-360\/sessions\/\d+$/);
  const sid = Number(page.url().match(/sessions\/(\d+)$/)[1]);

  const apiResp = await page.request.get(`${baseUrlV1}/api/advisory/sessions/${sid}/health-synthesis`);
  const status = apiResp.status();
  const body = await apiResp.json().catch(() => ({}));

  await page.goto(`${baseUrlV1}/diagnostic-360/sessions/${sid}/health-synthesis`);
  await page.waitForTimeout(300);
  const errorAlertText = await page.locator('.alert.error').first().textContent().catch(() => null);
  const leaksRaw = errorAlertText && /SQLITE|stack|internal|\.js:\d+/i.test(errorAlertText);

  const ok = status === 409 && body.code === 'HEALTH_SYNTHESIS_UNSUPPORTED_VERSION' && !!errorAlertText && !leaksRaw;
  record('K-VERSION_V1', ok, `status=${status} code=${body.code} details=${JSON.stringify(body.details)} uiMessage="${errorAlertText}" leaksRaw=${leaksRaw}`);
  await page.screenshot({ path: path.join(OUT_DIR, 'scenario-K-version-v1.png'), fullPage: true });
  await page.close();
}

// --- Main ----------------------------------------------------------------

async function main() {
  const only = process.argv.slice(2);
  const wanted = (key) => only.length === 0 || only.includes(key);

  const recoBefore = countRecommendations();
  record('INVARIANT-recommendations-baseline', true, `count avant A→J = ${recoBefore}`);

  const browser = await chromium.launch({ headless: true });

  const order = ['G', 'D', 'E', 'B', 'C', 'A', 'F', 'H', 'I', 'J'];
  for (const key of order) {
    if (!wanted(key)) continue;

    const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
    try {
      await login(page);
      await scenarioFns[key](page);
    } catch (err) {
      record(key, false, `EXCEPTION: ${err.message}`);
      console.error(err);
    } finally {
      await page.close().catch(() => {});
    }

    const recoNow = countRecommendations();
    if (recoNow !== recoBefore) {
      record(`INVARIANT-recommendations-after-${key}`, false, `count=${recoNow} attendu=${recoBefore}`);
    } else {
      record(`INVARIANT-recommendations-after-${key}`, true, `count inchangé=${recoNow}`);
    }
  }

  const findingsAuditCount = countAuditLog('consultation espace constats session');
  const synthAuditCount = countAuditLog('consultation synthèse santé session');
  const sensitiveAuditCount = countAuditLog('consultation findings sensibles');
  record('AUDIT-findings-open-count', findingsAuditCount > 0, `occurrences="consultation espace constats session" = ${findingsAuditCount}`);
  record('AUDIT-synthesis-open-count', synthAuditCount > 0, `occurrences="consultation synthèse santé session" = ${synthAuditCount}`);
  record('AUDIT-sensitive-derived-count', true, `occurrences="consultation findings sensibles" = ${sensitiveAuditCount} (informatif)`);

  const rows = rawAuditRows('synthèse santé').concat(rawAuditRows('constats session'));
  const rawLeak = rows.some((r) => /oui|non|elevee|faible|moyenne|probablement/i.test(r.details || ''));
  record('AUDIT-no-raw-answer-values', !rawLeak, `lignes inspectées=${rows.length}, fuite détectée=${rawLeak}`);

  if (wanted('K')) await runScenarioK(browser);

  await browser.close();

  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length} assertions, ${fails.length} échec(s) ===`);
  for (const f of fails) console.log(`FAIL: ${f.scenario} — ${f.details}`);
  process.exit(fails.length > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
