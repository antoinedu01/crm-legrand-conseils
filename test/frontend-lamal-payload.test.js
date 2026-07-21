import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAMAL_CARE_MODELS,
  LAMAL_DEDUCTIBLES,
  SWISS_CANTONS,
  LamalPayloadError,
  buildLamalBlock,
  composeLamalPayload,
} from '../client/src/components/contracts/lamalPayload.js';
import { buildGenericContractPayload } from '../client/src/components/contracts/contractPayload.js';

const VALID_FIELDS = {
  care_model: 'standard',
  deductible: '300',
  accident_coverage: true,
  canton: 'VD',
  tariff_region: '',
};

test('buildLamalBlock — construit un bloc LAMal valide complet', () => {
  const block = buildLamalBlock(VALID_FIELDS);
  assert.deepEqual(block, {
    care_model: 'standard',
    deductible: 300,
    accident_coverage: true,
    canton: 'VD',
    tariff_region: null,
  });
});

test('buildLamalBlock — la franchise est un véritable number', () => {
  const block = buildLamalBlock(VALID_FIELDS);
  assert.equal(typeof block.deductible, 'number');
});

test('buildLamalBlock — préserve accident_coverage: false (jamais confondu avec absent ou true)', () => {
  const block = buildLamalBlock({ ...VALID_FIELDS, accident_coverage: false });
  assert.equal(block.accident_coverage, false);
  // Garde explicite contre un piège `value || true` qui transformerait
  // silencieusement `false` en `true`.
  assert.notEqual(block.accident_coverage, true);
});

test('buildLamalBlock — rejette accident_coverage non booléen', () => {
  assert.throws(() => buildLamalBlock({ ...VALID_FIELDS, accident_coverage: 'oui' }), LamalPayloadError);
  assert.throws(() => buildLamalBlock({ ...VALID_FIELDS, accident_coverage: undefined }), LamalPayloadError);
});

test('buildLamalBlock — rejette un care_model invalide', () => {
  assert.throws(() => buildLamalBlock({ ...VALID_FIELDS, care_model: 'inexistant' }), LamalPayloadError);
});

test('buildLamalBlock — rejette une franchise absente', () => {
  assert.throws(() => buildLamalBlock({ ...VALID_FIELDS, deductible: '' }), LamalPayloadError);
});

test('buildLamalBlock — rejette une franchise décimale', () => {
  assert.throws(() => buildLamalBlock({ ...VALID_FIELDS, deductible: '300.5' }), LamalPayloadError);
});

test('buildLamalBlock — rejette une franchise hors liste métier', () => {
  assert.throws(() => buildLamalBlock({ ...VALID_FIELDS, deductible: '350' }), LamalPayloadError);
});

test('buildLamalBlock — rejette une franchise booléenne', () => {
  assert.throws(() => buildLamalBlock({ ...VALID_FIELDS, deductible: true }), LamalPayloadError);
});

test('buildLamalBlock — rejette une chaîne non numérique pour la franchise', () => {
  assert.throws(() => buildLamalBlock({ ...VALID_FIELDS, deductible: 'abc' }), LamalPayloadError);
});

test('SWISS_CANTONS — copie exacte des 26 codes cantonaux backend', () => {
  assert.deepEqual(SWISS_CANTONS, [
    'AG', 'AI', 'AR', 'BE', 'BL', 'BS', 'FR', 'GE', 'GL', 'GR', 'JU', 'LU', 'NE',
    'NW', 'OW', 'SG', 'SH', 'SO', 'SZ', 'TG', 'TI', 'UR', 'VD', 'VS', 'ZG', 'ZH',
  ]);
  assert.equal(SWISS_CANTONS.length, 26);
});

test('buildLamalBlock — canton vide devient null', () => {
  const block = buildLamalBlock({ ...VALID_FIELDS, canton: '' });
  assert.equal(block.canton, null);
});

test('buildLamalBlock — canton null devient null', () => {
  const block = buildLamalBlock({ ...VALID_FIELDS, canton: null });
  assert.equal(block.canton, null);
});

test('buildLamalBlock — canton absent devient null', () => {
  const fieldsWithoutCanton = { ...VALID_FIELDS };
  delete fieldsWithoutCanton.canton;
  const block = buildLamalBlock(fieldsWithoutCanton);
  assert.equal(block.canton, null);
});

test('buildLamalBlock — canton valide en minuscules normalisé en majuscules (comme le backend)', () => {
  const block = buildLamalBlock({ ...VALID_FIELDS, canton: 'ge' });
  assert.equal(block.canton, 'GE');
});

test('buildLamalBlock — canton entouré d’espaces nettoyé', () => {
  const block = buildLamalBlock({ ...VALID_FIELDS, canton: '  vd  ' });
  assert.equal(block.canton, 'VD');
});

test('buildLamalBlock — canton valide en majuscules conservé', () => {
  const block = buildLamalBlock({ ...VALID_FIELDS, canton: 'ZH' });
  assert.equal(block.canton, 'ZH');
});

test('buildLamalBlock — rejette un canton invalide', () => {
  assert.throws(() => buildLamalBlock({ ...VALID_FIELDS, canton: 'XX' }), LamalPayloadError);
});

test('buildLamalBlock — rejette une chaîne arbitraire de deux caractères non cantonale', () => {
  assert.throws(() => buildLamalBlock({ ...VALID_FIELDS, canton: 'ZZ' }), LamalPayloadError);
});

test('buildLamalBlock — tariff_region vide devient null', () => {
  const block = buildLamalBlock({ ...VALID_FIELDS, tariff_region: '' });
  assert.equal(block.tariff_region, null);
});

test('buildLamalBlock — rejette tariff_region au-delà de 20 caractères', () => {
  assert.throws(
    () => buildLamalBlock({ ...VALID_FIELDS, tariff_region: '123456789012345678901' }),
    LamalPayloadError
  );
});

test('LAMAL_CARE_MODELS — copie exacte de l’enum backend', () => {
  assert.deepEqual(LAMAL_CARE_MODELS, ['standard', 'medecin_famille', 'hmo', 'telmed', 'pharmacie', 'autre']);
});

test('LAMAL_DEDUCTIBLES — copie exacte de la liste backend', () => {
  assert.deepEqual(LAMAL_DEDUCTIBLES, [0, 100, 200, 300, 400, 500, 600, 1000, 1500, 2000, 2500]);
});

test('composeLamalPayload — mode "unchanged" (bloc existant non touché) → clé lamal absente', () => {
  const base = buildGenericContractPayload({ branch: 'lamal', status: 'actif' });
  const payload = composeLamalPayload(base, { mode: 'unchanged', branch: 'lamal', block: undefined });
  assert.equal('lamal' in payload, false);
});

test('composeLamalPayload — mode "absent" → clé lamal absente', () => {
  const base = buildGenericContractPayload({ branch: 'lamal', status: 'actif' });
  const payload = composeLamalPayload(base, { mode: 'absent', branch: 'lamal', block: undefined });
  assert.equal('lamal' in payload, false);
});

test('composeLamalPayload — mode "value" → objet complet', () => {
  const base = buildGenericContractPayload({ branch: 'lamal', status: 'actif' });
  const block = buildLamalBlock(VALID_FIELDS);
  const payload = composeLamalPayload(base, { mode: 'value', branch: 'lamal', block });
  assert.deepEqual(payload.lamal, block);
});

test('composeLamalPayload — mode "removed" → null', () => {
  const base = buildGenericContractPayload({ branch: 'lamal', status: 'actif' });
  const payload = composeLamalPayload(base, { mode: 'removed', branch: 'lamal', block: undefined });
  assert.equal(payload.lamal, null);
});

test('composeLamalPayload — branche différente de lamal avec état "value" résiduel (stale state) → clé absente', () => {
  // Simule : l'utilisateur a saisi des données LAMal en mode 'value', puis a
  // changé la branche vers vie_3a avant l'enregistrement. La composition
  // doit forcer 'absent' dès lors que branch !== 'lamal', quel que soit le
  // mode ou le contenu du bloc en mémoire.
  const base = buildGenericContractPayload({ branch: 'vie_3a', status: 'actif' });
  const staleBlock = buildLamalBlock(VALID_FIELDS);
  const payload = composeLamalPayload(base, { mode: 'value', branch: 'vie_3a', block: staleBlock });
  assert.equal('lamal' in payload, false);
});

test('composeLamalPayload — branche différente de lamal avec état "removed" résiduel → clé absente (pas de null non plus)', () => {
  const base = buildGenericContractPayload({ branch: 'vie_3a', status: 'actif' });
  const payload = composeLamalPayload(base, { mode: 'removed', branch: 'vie_3a', block: undefined });
  assert.equal('lamal' in payload, false);
});

test('composeLamalPayload — retour déterministe sur la branche lamal après un changement temporaire : le mode "value" restauré redonne l’objet complet', () => {
  // Étape 1 : utilisateur sur lamal, saisit un bloc valide (mode 'value').
  const block = buildLamalBlock(VALID_FIELDS);
  // Étape 2 : bascule temporaire vers vie_3a — aucune donnée envoyée.
  const duringOtherBranch = composeLamalPayload(
    buildGenericContractPayload({ branch: 'vie_3a' }),
    { mode: 'value', branch: 'vie_3a', block }
  );
  assert.equal('lamal' in duringOtherBranch, false);
  // Étape 3 : retour sur lamal, mode et bloc conservés en mémoire (règle
  // déterministe : rien n'est perdu tant que la modale reste ouverte) →
  // le bloc complet redevient envoyable à l'identique.
  const afterReturn = composeLamalPayload(
    buildGenericContractPayload({ branch: 'lamal' }),
    { mode: 'value', branch: 'lamal', block }
  );
  assert.deepEqual(afterReturn.lamal, block);
});

test('composeLamalPayload — création LAMal → objet complet inclus avec les champs génériques', () => {
  const form = { branch: 'lamal', status: 'offre', client_id: 1, company_id: 1, annual_premium: 3600 };
  const base = buildGenericContractPayload(form);
  const block = buildLamalBlock(VALID_FIELDS);
  const payload = composeLamalPayload(base, { mode: 'value', branch: 'lamal', block });
  assert.deepEqual(payload.lamal, block);
  assert.equal(payload.branch, 'lamal');
  assert.equal(payload.client_id, 1);
});

test('composeLamalPayload — édition générique d’un contrat LAMal existant, section non touchée → bloc absent', () => {
  const form = { branch: 'lamal', notes: 'texte modifié' };
  const base = buildGenericContractPayload(form);
  const payload = composeLamalPayload(base, { mode: 'unchanged', branch: 'lamal', block: undefined });
  assert.equal('lamal' in payload, false);
  assert.equal(payload.notes, 'texte modifié');
});

test('composeLamalPayload — modification d’un seul champ LAMal → bloc complet envoyé', () => {
  const modifiedFields = { ...VALID_FIELDS, canton: 'GE' };
  const block = buildLamalBlock(modifiedFields);
  const base = buildGenericContractPayload({ branch: 'lamal' });
  const payload = composeLamalPayload(base, { mode: 'value', branch: 'lamal', block });
  assert.equal(payload.lamal.canton, 'GE');
  assert.equal(payload.lamal.care_model, 'standard');
  assert.equal(payload.lamal.deductible, 300);
});

test('un champ vidé (tariff_region) ne produit jamais automatiquement lamal: null', () => {
  const block = buildLamalBlock({ ...VALID_FIELDS, tariff_region: '' });
  const base = buildGenericContractPayload({ branch: 'lamal' });
  const payload = composeLamalPayload(base, { mode: 'value', branch: 'lamal', block });
  assert.notEqual(payload.lamal, null);
  assert.equal(payload.lamal.tariff_region, null);
});

test('composeLamalPayload — un mode inconnu lève une erreur contrôlée', () => {
  const base = buildGenericContractPayload({ branch: 'lamal' });
  assert.throws(() => composeLamalPayload(base, { mode: 'cleared', branch: 'lamal', block: undefined }));
});
