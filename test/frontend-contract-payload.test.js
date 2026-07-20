import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GENERIC_CONTRACT_FIELDS,
  SPECIALIZED_BLOCK_KEYS,
  buildGenericContractPayload,
  hasAnySpecializedBlock,
  applySpecializedBlockState,
} from '../client/src/components/contracts/contractPayload.js';

const FULL_CONTRACT_ROW = {
  id: 123,
  client_id: 42,
  company_id: 3,
  branch: 'lamal',
  policy_number: 'POL-1',
  product_name: 'Produit test',
  annual_premium: 3600,
  payment_frequency: 'annuelle',
  start_date: '2026-01-01',
  end_date: null,
  status: 'actif',
  acq_commission_rate: 10,
  rec_commission_rate: 5,
  notes: 'note fictive',
  created_at: '2026-01-01 00:00:00',
  updated_at: '2026-01-01 00:00:00',
  client_name: 'Client fictif',
  company_name: 'Compagnie fictive',
  commissions_paid: 0,
  commissions_pending: 100,
  lamal: { care_model: 'standard', deductible: 300, accident_coverage: true, canton: 'VD', tariff_region: null },
  lca: null,
  life: null,
  income_protection: null,
  lpp_ijm: null,
};

test('buildGenericContractPayload — un contrat chargé avec lamal ne renvoie pas lamal', () => {
  const payload = buildGenericContractPayload(FULL_CONTRACT_ROW);
  assert.equal('lamal' in payload, false);
});

test('buildGenericContractPayload — exclut lca même si présent (null ou objet)', () => {
  const withLca = { ...FULL_CONTRACT_ROW, lca: { underwriting_status: 'acceptee' } };
  const payload = buildGenericContractPayload(withLca);
  assert.equal('lca' in payload, false);
});

test('buildGenericContractPayload — exclut life', () => {
  const withLife = { ...FULL_CONTRACT_ROW, life: { component_type: 'mixte' } };
  const payload = buildGenericContractPayload(withLife);
  assert.equal('life' in payload, false);
});

test('buildGenericContractPayload — exclut income_protection', () => {
  const withIp = { ...FULL_CONTRACT_ROW, income_protection: { benefit_type: 'rente' } };
  const payload = buildGenericContractPayload(withIp);
  assert.equal('income_protection' in payload, false);
});

test('buildGenericContractPayload — exclut lpp_ijm', () => {
  const withLppIjm = { ...FULL_CONTRACT_ROW, lpp_ijm: { product_type: 'lpp' } };
  const payload = buildGenericContractPayload(withLppIjm);
  assert.equal('lpp_ijm' in payload, false);
});

test('buildGenericContractPayload — exclut les propriétés inconnues renvoyées par l’API', () => {
  const payload = buildGenericContractPayload(FULL_CONTRACT_ROW);
  for (const unknownKey of ['id', 'created_at', 'updated_at', 'client_name', 'company_name', 'commissions_paid', 'commissions_pending']) {
    assert.equal(unknownKey in payload, false, `la clé inconnue "${unknownKey}" ne doit pas être présente`);
  }
});

test('buildGenericContractPayload — conserve exactement les 13 champs génériques whitelistés', () => {
  const payload = buildGenericContractPayload(FULL_CONTRACT_ROW);
  for (const field of GENERIC_CONTRACT_FIELDS) {
    assert.equal(field in payload, true, `le champ générique "${field}" doit être présent`);
    assert.equal(payload[field], FULL_CONTRACT_ROW[field]);
  }
  assert.equal(Object.keys(payload).length, GENERIC_CONTRACT_FIELDS.length);
});

test('buildGenericContractPayload — ne transforme pas silencieusement une valeur générique', () => {
  const raw = { ...FULL_CONTRACT_ROW, annual_premium: '3600', acq_commission_rate: '10' };
  const payload = buildGenericContractPayload(raw);
  assert.equal(payload.annual_premium, '3600');
  assert.equal(payload.acq_commission_rate, '10');
});

test('GENERIC_CONTRACT_FIELDS — miroir exact de la liste blanche backend (FIELDS)', () => {
  assert.deepEqual(GENERIC_CONTRACT_FIELDS, [
    'client_id', 'company_id', 'branch', 'policy_number', 'product_name', 'annual_premium',
    'payment_frequency', 'start_date', 'end_date', 'status',
    'acq_commission_rate', 'rec_commission_rate', 'notes',
  ]);
});

test('SPECIALIZED_BLOCK_KEYS — les 5 clés spécialisées exactes', () => {
  assert.deepEqual(SPECIALIZED_BLOCK_KEYS, ['lamal', 'lca', 'life', 'income_protection', 'lpp_ijm']);
});

test('hasAnySpecializedBlock — true si au moins un bloc non nul', () => {
  assert.equal(hasAnySpecializedBlock(FULL_CONTRACT_ROW), true);
});

test('hasAnySpecializedBlock — false si tous les blocs sont null ou absents', () => {
  const noBlocks = { ...FULL_CONTRACT_ROW, lamal: null };
  assert.equal(hasAnySpecializedBlock(noBlocks), false);
  assert.equal(hasAnySpecializedBlock({}), false);
});

test('applySpecializedBlockState — état "absent" : la clé n’est jamais ajoutée', () => {
  const payload = applySpecializedBlockState({ notes: 'x' }, 'lamal', 'absent');
  assert.equal('lamal' in payload, false);
  assert.deepEqual(payload, { notes: 'x' });
});

test('applySpecializedBlockState — état "value" : le payload contient { [blockKey]: blockValue }', () => {
  const value = { care_model: 'standard', deductible: 300 };
  const payload = applySpecializedBlockState({}, 'lamal', 'value', value);
  assert.equal('lamal' in payload, true);
  assert.deepEqual(payload.lamal, value);
});

test('applySpecializedBlockState — état "removed" : le payload contient { [blockKey]: null }', () => {
  const payload = applySpecializedBlockState({}, 'lamal', 'removed');
  assert.equal('lamal' in payload, true);
  assert.equal(payload.lamal, null);
});

test('applySpecializedBlockState — un état inconnu provoque une erreur contrôlée', () => {
  assert.throws(() => applySpecializedBlockState({}, 'lamal', 'cleared'));
});

test('applySpecializedBlockState — ne mute pas le payload d’origine', () => {
  const original = { notes: 'x' };
  applySpecializedBlockState(original, 'lamal', 'removed');
  assert.equal('lamal' in original, false);
});

test('un simple vidage de champ ne produit jamais automatiquement un bloc null (contrôle d’intégration)', () => {
  // Simule un formulaire où l'utilisateur vide un champ générique (notes) sans jamais
  // avoir touché au bloc spécialisé : buildGenericContractPayload ne doit renvoyer
  // aucune des 5 clés de bloc, quel que soit le contenu de formState.
  const formState = { ...FULL_CONTRACT_ROW, notes: '' };
  const payload = buildGenericContractPayload(formState);
  for (const blockKey of SPECIALIZED_BLOCK_KEYS) {
    assert.equal(blockKey in payload, false);
  }
});
