import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNDERWRITING_STATUSES,
  RESERVATION_STATUSES,
  EXCLUSION_STATUSES,
  LCA_NEUTRAL_FIELDS,
  LcaPayloadError,
  buildLcaBlock,
  composeLcaPayload,
} from '../client/src/components/contracts/lcaPayload.js';
import { buildGenericContractPayload, applySpecializedBlockState } from '../client/src/components/contracts/contractPayload.js';

const SIX_KEYS = [
  'underwriting_status', 'waiting_period_days', 'administrative_reservation_status',
  'reservation_notes', 'exclusions_status', 'exclusions_notes',
];

const VALID_FIELDS = {
  underwriting_status: 'acceptee',
  waiting_period_days: '30',
  administrative_reservation_status: 'aucune',
  reservation_notes: 'Réserve communiquée par l’assureur',
  exclusions_status: 'aucune',
  exclusions_notes: '',
};

test('buildLcaBlock — construit un bloc complet contenant exactement les six clés', () => {
  const block = buildLcaBlock(VALID_FIELDS);
  assert.deepEqual(Object.keys(block).sort(), [...SIX_KEYS].sort());
});

test('buildLcaBlock — bloc valide complet, valeurs exactes', () => {
  const block = buildLcaBlock(VALID_FIELDS);
  assert.deepEqual(block, {
    underwriting_status: 'acceptee',
    waiting_period_days: 30,
    administrative_reservation_status: 'aucune',
    reservation_notes: 'Réserve communiquée par l’assureur',
    exclusions_status: 'aucune',
    exclusions_notes: null,
  });
});

test('LCA_NEUTRAL_FIELDS — valeurs neutres exactes prévues pour initialisation', () => {
  assert.deepEqual(LCA_NEUTRAL_FIELDS, {
    underwriting_status: 'non_requis',
    waiting_period_days: '',
    administrative_reservation_status: 'aucune',
    reservation_notes: '',
    exclusions_status: 'aucune',
    exclusions_notes: '',
  });
});

test('buildLcaBlock — les valeurs neutres produisent un bloc valide (non_requis/aucune/aucune/null/null/null)', () => {
  const block = buildLcaBlock(LCA_NEUTRAL_FIELDS);
  assert.deepEqual(block, {
    underwriting_status: 'non_requis',
    waiting_period_days: null,
    administrative_reservation_status: 'aucune',
    reservation_notes: null,
    exclusions_status: 'aucune',
    exclusions_notes: null,
  });
});

test('buildLcaBlock — valide underwriting_status contre l’enum exacte', () => {
  for (const v of UNDERWRITING_STATUSES) {
    assert.doesNotThrow(() => buildLcaBlock({ ...VALID_FIELDS, underwriting_status: v }));
  }
  assert.throws(() => buildLcaBlock({ ...VALID_FIELDS, underwriting_status: 'inexistant' }), LcaPayloadError);
});

test('buildLcaBlock — rejette underwriting_status null ou absent (toujours requis dans un bloc complet)', () => {
  assert.throws(() => buildLcaBlock({ ...VALID_FIELDS, underwriting_status: null }), LcaPayloadError);
  const fieldsWithoutStatus = { ...VALID_FIELDS };
  delete fieldsWithoutStatus.underwriting_status;
  assert.throws(() => buildLcaBlock(fieldsWithoutStatus), LcaPayloadError);
});

test('buildLcaBlock — valide administrative_reservation_status contre l’enum exacte', () => {
  for (const v of RESERVATION_STATUSES) {
    assert.doesNotThrow(() => buildLcaBlock({ ...VALID_FIELDS, administrative_reservation_status: v }));
  }
  assert.throws(() => buildLcaBlock({ ...VALID_FIELDS, administrative_reservation_status: 'inexistant' }), LcaPayloadError);
});

test('buildLcaBlock — rejette administrative_reservation_status null', () => {
  assert.throws(() => buildLcaBlock({ ...VALID_FIELDS, administrative_reservation_status: null }), LcaPayloadError);
});

test('buildLcaBlock — valide exclusions_status contre l’enum exacte', () => {
  for (const v of EXCLUSION_STATUSES) {
    assert.doesNotThrow(() => buildLcaBlock({ ...VALID_FIELDS, exclusions_status: v }));
  }
  assert.throws(() => buildLcaBlock({ ...VALID_FIELDS, exclusions_status: 'inexistant' }), LcaPayloadError);
});

test('buildLcaBlock — rejette exclusions_status null', () => {
  assert.throws(() => buildLcaBlock({ ...VALID_FIELDS, exclusions_status: null }), LcaPayloadError);
});

test('UNDERWRITING_STATUSES / RESERVATION_STATUSES / EXCLUSION_STATUSES — copies exactes du backend', () => {
  assert.deepEqual(UNDERWRITING_STATUSES, [
    'non_requis', 'questionnaire_transmis', 'decision_attendue',
    'acceptee', 'acceptee_avec_reserve', 'refusee',
  ]);
  assert.deepEqual(RESERVATION_STATUSES, ['aucune', 'en_cours', 'active', 'levee']);
  assert.deepEqual(EXCLUSION_STATUSES, ['aucune', 'presentes']);
});

test('buildLcaBlock — waiting_period_days vide, null ou absent devient null (clé toujours présente)', () => {
  const blockEmpty = buildLcaBlock({ ...VALID_FIELDS, waiting_period_days: '' });
  assert.equal(blockEmpty.waiting_period_days, null);
  assert.equal('waiting_period_days' in blockEmpty, true);

  const blockNull = buildLcaBlock({ ...VALID_FIELDS, waiting_period_days: null });
  assert.equal(blockNull.waiting_period_days, null);

  const fieldsWithoutWaiting = { ...VALID_FIELDS };
  delete fieldsWithoutWaiting.waiting_period_days;
  const blockAbsent = buildLcaBlock(fieldsWithoutWaiting);
  assert.equal(blockAbsent.waiting_period_days, null);
  assert.equal('waiting_period_days' in blockAbsent, true);
});

test('buildLcaBlock — waiting_period_days: 0 est préservé (valeur valide, pas absence)', () => {
  const block = buildLcaBlock({ ...VALID_FIELDS, waiting_period_days: '0' });
  assert.equal(block.waiting_period_days, 0);
  assert.equal(typeof block.waiting_period_days, 'number');
});

test('buildLcaBlock — waiting_period_days entier positif préservé comme véritable number', () => {
  const block = buildLcaBlock({ ...VALID_FIELDS, waiting_period_days: '45' });
  assert.equal(block.waiting_period_days, 45);
  assert.equal(typeof block.waiting_period_days, 'number');
});

test('buildLcaBlock — rejette une valeur décimale pour waiting_period_days', () => {
  assert.throws(() => buildLcaBlock({ ...VALID_FIELDS, waiting_period_days: '30.5' }), LcaPayloadError);
});

test('buildLcaBlock — rejette une valeur négative pour waiting_period_days', () => {
  assert.throws(() => buildLcaBlock({ ...VALID_FIELDS, waiting_period_days: '-5' }), LcaPayloadError);
});

test('buildLcaBlock — rejette une chaîne non numérique pour waiting_period_days', () => {
  assert.throws(() => buildLcaBlock({ ...VALID_FIELDS, waiting_period_days: 'abc' }), LcaPayloadError);
});

test('buildLcaBlock — rejette un booléen pour waiting_period_days', () => {
  assert.throws(() => buildLcaBlock({ ...VALID_FIELDS, waiting_period_days: true }), LcaPayloadError);
});

test('buildLcaBlock — rejette un objet ou un tableau pour waiting_period_days', () => {
  assert.throws(() => buildLcaBlock({ ...VALID_FIELDS, waiting_period_days: {} }), LcaPayloadError);
  assert.throws(() => buildLcaBlock({ ...VALID_FIELDS, waiting_period_days: [30] }), LcaPayloadError);
});

test('buildLcaBlock — rejette NaN et Infinity pour waiting_period_days', () => {
  assert.throws(() => buildLcaBlock({ ...VALID_FIELDS, waiting_period_days: NaN }), LcaPayloadError);
  assert.throws(() => buildLcaBlock({ ...VALID_FIELDS, waiting_period_days: Infinity }), LcaPayloadError);
});

test('buildLcaBlock — reservation_notes vide, null ou absente devient null', () => {
  assert.equal(buildLcaBlock({ ...VALID_FIELDS, reservation_notes: '' }).reservation_notes, null);
  assert.equal(buildLcaBlock({ ...VALID_FIELDS, reservation_notes: null }).reservation_notes, null);
  const fieldsWithoutNotes = { ...VALID_FIELDS };
  delete fieldsWithoutNotes.reservation_notes;
  assert.equal(buildLcaBlock(fieldsWithoutNotes).reservation_notes, null);
});

test('buildLcaBlock — exclusions_notes vide, null ou absente devient null', () => {
  assert.equal(buildLcaBlock({ ...VALID_FIELDS, exclusions_notes: '' }).exclusions_notes, null);
  assert.equal(buildLcaBlock({ ...VALID_FIELDS, exclusions_notes: null }).exclusions_notes, null);
  const fieldsWithoutNotes = { ...VALID_FIELDS };
  delete fieldsWithoutNotes.exclusions_notes;
  assert.equal(buildLcaBlock(fieldsWithoutNotes).exclusions_notes, null);
});

test('buildLcaBlock — accepte une note de 200 caractères exactement', () => {
  const notes = 'x'.repeat(200);
  const block = buildLcaBlock({ ...VALID_FIELDS, reservation_notes: notes });
  assert.equal(block.reservation_notes, notes);
});

test('buildLcaBlock — rejette une note de 201 caractères (reservation_notes)', () => {
  assert.throws(() => buildLcaBlock({ ...VALID_FIELDS, reservation_notes: 'x'.repeat(201) }), LcaPayloadError);
});

test('buildLcaBlock — rejette une note de 201 caractères (exclusions_notes)', () => {
  assert.throws(() => buildLcaBlock({ ...VALID_FIELDS, exclusions_notes: 'x'.repeat(201) }), LcaPayloadError);
});

test('composeLcaPayload — mode "unchanged" → clé lca absente', () => {
  const base = buildGenericContractPayload({ branch: 'lca', status: 'actif' });
  const payload = composeLcaPayload(base, { mode: 'unchanged', branch: 'lca', block: undefined });
  assert.equal('lca' in payload, false);
});

test('composeLcaPayload — mode "absent" → clé lca absente', () => {
  const base = buildGenericContractPayload({ branch: 'lca', status: 'actif' });
  const payload = composeLcaPayload(base, { mode: 'absent', branch: 'lca', block: undefined });
  assert.equal('lca' in payload, false);
});

test('composeLcaPayload — mode "value" → bloc complet à six clés', () => {
  const base = buildGenericContractPayload({ branch: 'lca', status: 'actif' });
  const block = buildLcaBlock(VALID_FIELDS);
  const payload = composeLcaPayload(base, { mode: 'value', branch: 'lca', block });
  assert.deepEqual(payload.lca, block);
  assert.deepEqual(Object.keys(payload.lca).sort(), [...SIX_KEYS].sort());
});

test('composeLcaPayload — mode "removed" → lca: null', () => {
  const base = buildGenericContractPayload({ branch: 'lca', status: 'actif' });
  const payload = composeLcaPayload(base, { mode: 'removed', branch: 'lca', block: undefined });
  assert.equal(payload.lca, null);
});

test('composeLcaPayload — branche différente de lca avec état résiduel (stale state) → clé absente', () => {
  const base = buildGenericContractPayload({ branch: 'vie_3a', status: 'actif' });
  const staleBlock = buildLcaBlock(VALID_FIELDS);
  const payload = composeLcaPayload(base, { mode: 'value', branch: 'vie_3a', block: staleBlock });
  assert.equal('lca' in payload, false);
});

test('composeLcaPayload — retour déterministe sur la branche lca après un changement temporaire', () => {
  const block = buildLcaBlock(VALID_FIELDS);
  const duringOtherBranch = composeLcaPayload(
    buildGenericContractPayload({ branch: 'vie_3a' }),
    { mode: 'value', branch: 'vie_3a', block }
  );
  assert.equal('lca' in duringOtherBranch, false);
  const afterReturn = composeLcaPayload(
    buildGenericContractPayload({ branch: 'lca' }),
    { mode: 'value', branch: 'lca', block }
  );
  assert.deepEqual(afterReturn.lca, block);
});

test('composeLcaPayload — modification d’un seul champ → bloc complet à six clés envoyé', () => {
  const modifiedFields = { ...VALID_FIELDS, exclusions_status: 'presentes', exclusions_notes: 'Exclusion mentionnée dans la décision de l’assureur' };
  const block = buildLcaBlock(modifiedFields);
  const base = buildGenericContractPayload({ branch: 'lca' });
  const payload = composeLcaPayload(base, { mode: 'value', branch: 'lca', block });
  assert.equal(payload.lca.exclusions_status, 'presentes');
  assert.equal(payload.lca.underwriting_status, 'acceptee');
  assert.deepEqual(Object.keys(payload.lca).sort(), [...SIX_KEYS].sort());
});

test('un champ vidé (reservation_notes) ne produit jamais automatiquement lca: null — seulement null sur ce champ', () => {
  const block = buildLcaBlock({ ...VALID_FIELDS, reservation_notes: '' });
  const base = buildGenericContractPayload({ branch: 'lca' });
  const payload = composeLcaPayload(base, { mode: 'value', branch: 'lca', block });
  assert.notEqual(payload.lca, null);
  assert.equal(payload.lca.reservation_notes, null);
});

test('composeLcaPayload — un bloc lamal déjà présent dans le payload d’entrée reste intact', () => {
  const lamalBlock = { care_model: 'standard', deductible: 300, accident_coverage: true, canton: 'VD', tariff_region: null };
  const baseWithLamal = applySpecializedBlockState(
    buildGenericContractPayload({ branch: 'lca' }),
    'lamal',
    'value',
    lamalBlock
  );
  const lcaBlock = buildLcaBlock(VALID_FIELDS);
  const payload = composeLcaPayload(baseWithLamal, { mode: 'value', branch: 'lca', block: lcaBlock });
  assert.deepEqual(payload.lamal, lamalBlock);
  assert.deepEqual(payload.lca, lcaBlock);
});

test('buildLcaBlock — aucune propriété médicale ou inattendue n’est jamais ajoutée au bloc', () => {
  const block = buildLcaBlock(VALID_FIELDS);
  for (const key of Object.keys(block)) {
    assert.ok(SIX_KEYS.includes(key), `clé inattendue : ${key}`);
  }
});

test('composeLcaPayload — un mode inconnu lève une erreur contrôlée', () => {
  const base = buildGenericContractPayload({ branch: 'lca' });
  assert.throws(() => composeLcaPayload(base, { mode: 'cleared', branch: 'lca', block: undefined }));
});
