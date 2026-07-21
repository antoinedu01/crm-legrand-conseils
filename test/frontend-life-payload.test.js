import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPONENT_TYPES,
  INDEXATION_TYPES,
  LIFE_COMPATIBLE_BRANCHES,
  LIFE_INITIAL_FIELDS,
  LifePayloadError,
  buildLifeBlock,
  composeLifePayload,
} from '../client/src/components/contracts/lifePayload.js';
import { buildGenericContractPayload, applySpecializedBlockState } from '../client/src/components/contracts/contractPayload.js';

const EIGHT_KEYS = [
  'component_type', 'insured_death_capital', 'insured_disability_capital', 'insured_rent',
  'surrender_value', 'premium_waiver', 'indexation_type', 'policy_term_years',
];

const VALID_FIELDS = {
  component_type: 'mixte',
  insured_death_capital: '100000',
  insured_disability_capital: '50000',
  insured_rent: '',
  surrender_value: '',
  premium_waiver: false,
  indexation_type: 'aucune',
  policy_term_years: '20',
};

test('buildLifeBlock — construit un bloc valide contenant exactement les huit clés', () => {
  const block = buildLifeBlock(VALID_FIELDS);
  assert.deepEqual(Object.keys(block).sort(), [...EIGHT_KEYS].sort());
});

test('buildLifeBlock — bloc valide, valeurs exactes', () => {
  const block = buildLifeBlock(VALID_FIELDS);
  assert.deepEqual(block, {
    component_type: 'mixte',
    insured_death_capital: 100000,
    insured_disability_capital: 50000,
    insured_rent: null,
    surrender_value: null,
    premium_waiver: false,
    indexation_type: 'aucune',
    policy_term_years: 20,
  });
});

test('buildLifeBlock — valide component_type contre l’enum exacte', () => {
  for (const v of COMPONENT_TYPES) {
    assert.doesNotThrow(() => buildLifeBlock({ ...VALID_FIELDS, component_type: v }));
  }
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, component_type: 'inexistant' }), LifePayloadError);
});

test('COMPONENT_TYPES / INDEXATION_TYPES — copies exactes du backend', () => {
  assert.deepEqual(COMPONENT_TYPES, ['mixte', 'risque_pur', 'capital_differe', 'rente', 'unit_linked', 'autre']);
  assert.deepEqual(INDEXATION_TYPES, ['aucune', 'fixe', 'indice_prix_conso', 'autre']);
});

test('buildLifeBlock — rejette component_type absent (toujours requis dans un bloc complet)', () => {
  const fieldsWithoutType = { ...VALID_FIELDS };
  delete fieldsWithoutType.component_type;
  assert.throws(() => buildLifeBlock(fieldsWithoutType), LifePayloadError);
});

test('buildLifeBlock — rejette component_type null ou vide', () => {
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, component_type: null }), LifePayloadError);
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, component_type: '' }), LifePayloadError);
});

test('buildLifeBlock — convertit chaque champ montant en véritable number décimal', () => {
  const block = buildLifeBlock({ ...VALID_FIELDS, insured_rent: '1234.56' });
  assert.equal(block.insured_rent, 1234.56);
  assert.equal(typeof block.insured_rent, 'number');
});

test('buildLifeBlock — accepte des montants décimaux (pas d’entier strict requis)', () => {
  const block = buildLifeBlock({ ...VALID_FIELDS, insured_death_capital: '100000.50' });
  assert.equal(block.insured_death_capital, 100000.50);
});

test('buildLifeBlock — rejette une chaîne non numérique pour un montant', () => {
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, insured_death_capital: 'abc' }), LifePayloadError);
});

test('buildLifeBlock — rejette un booléen pour un montant', () => {
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, surrender_value: true }), LifePayloadError);
});

test('buildLifeBlock — rejette une valeur négative pour un montant', () => {
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, insured_rent: '-100' }), LifePayloadError);
});

test('buildLifeBlock — préserve 0 comme valeur valide pour un montant', () => {
  const block = buildLifeBlock({ ...VALID_FIELDS, surrender_value: '0' });
  assert.equal(block.surrender_value, 0);
  assert.notEqual(block.surrender_value, null);
});

test('buildLifeBlock — préserve premium_waiver: false explicitement (jamais confondu avec true)', () => {
  const block = buildLifeBlock({ ...VALID_FIELDS, premium_waiver: false });
  assert.equal(block.premium_waiver, false);
  assert.notEqual(block.premium_waiver, true);
});

test('buildLifeBlock — préserve premium_waiver: true', () => {
  const block = buildLifeBlock({ ...VALID_FIELDS, premium_waiver: true });
  assert.equal(block.premium_waiver, true);
});

test('buildLifeBlock — rejette une valeur non booléenne pour premium_waiver', () => {
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, premium_waiver: 'oui' }), LifePayloadError);
});

test('buildLifeBlock — champs montants vides, null ou absents deviennent null (clé toujours présente)', () => {
  const blockEmpty = buildLifeBlock({ ...VALID_FIELDS, insured_rent: '' });
  assert.equal(blockEmpty.insured_rent, null);
  assert.equal('insured_rent' in blockEmpty, true);

  const blockNull = buildLifeBlock({ ...VALID_FIELDS, insured_rent: null });
  assert.equal(blockNull.insured_rent, null);

  const fieldsWithoutRent = { ...VALID_FIELDS };
  delete fieldsWithoutRent.insured_rent;
  const blockAbsent = buildLifeBlock(fieldsWithoutRent);
  assert.equal(blockAbsent.insured_rent, null);
  assert.equal('insured_rent' in blockAbsent, true);
});

test('buildLifeBlock — valide indexation_type contre l’enum exacte', () => {
  for (const v of INDEXATION_TYPES) {
    assert.doesNotThrow(() => buildLifeBlock({ ...VALID_FIELDS, indexation_type: v }));
  }
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, indexation_type: 'inexistant' }), LifePayloadError);
});

test('buildLifeBlock — rejette indexation_type null', () => {
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, indexation_type: null }), LifePayloadError);
});

test('buildLifeBlock — policy_term_years accepte un entier strictement positif', () => {
  const block = buildLifeBlock({ ...VALID_FIELDS, policy_term_years: '15' });
  assert.equal(block.policy_term_years, 15);
});

test('buildLifeBlock — rejette policy_term_years égal à 0 (doit être strictement positif)', () => {
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, policy_term_years: '0' }), LifePayloadError);
});

test('buildLifeBlock — rejette policy_term_years négatif', () => {
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, policy_term_years: '-5' }), LifePayloadError);
});

test('buildLifeBlock — rejette policy_term_years décimal', () => {
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, policy_term_years: '15.5' }), LifePayloadError);
});

test('buildLifeBlock — policy_term_years vide, null ou absent devient null', () => {
  assert.equal(buildLifeBlock({ ...VALID_FIELDS, policy_term_years: '' }).policy_term_years, null);
  assert.equal(buildLifeBlock({ ...VALID_FIELDS, policy_term_years: null }).policy_term_years, null);
  const fieldsWithoutTerm = { ...VALID_FIELDS };
  delete fieldsWithoutTerm.policy_term_years;
  assert.equal(buildLifeBlock(fieldsWithoutTerm).policy_term_years, null);
});

test('composeLifePayload — mode "unchanged" → clé life absente', () => {
  const base = buildGenericContractPayload({ branch: 'vie_3a', status: 'actif' });
  const payload = composeLifePayload(base, { mode: 'unchanged', branch: 'vie_3a', block: undefined });
  assert.equal('life' in payload, false);
});

test('composeLifePayload — mode "absent" → clé life absente', () => {
  const base = buildGenericContractPayload({ branch: 'vie_3a', status: 'actif' });
  const payload = composeLifePayload(base, { mode: 'absent', branch: 'vie_3a', block: undefined });
  assert.equal('life' in payload, false);
});

test('composeLifePayload — mode "value" → bloc conforme à huit clés', () => {
  const base = buildGenericContractPayload({ branch: 'vie_3a', status: 'actif' });
  const block = buildLifeBlock(VALID_FIELDS);
  const payload = composeLifePayload(base, { mode: 'value', branch: 'vie_3a', block });
  assert.deepEqual(payload.life, block);
  assert.deepEqual(Object.keys(payload.life).sort(), [...EIGHT_KEYS].sort());
});

test('composeLifePayload — mode "removed" → life: null', () => {
  const base = buildGenericContractPayload({ branch: 'vie_3a', status: 'actif' });
  const payload = composeLifePayload(base, { mode: 'removed', branch: 'vie_3a', block: undefined });
  assert.equal(payload.life, null);
});

test('composeLifePayload — fonctionne pour vie_3a ET vie_3b (deux branches compatibles)', () => {
  const block = buildLifeBlock(VALID_FIELDS);
  for (const branch of ['vie_3a', 'vie_3b']) {
    const base = buildGenericContractPayload({ branch });
    const payload = composeLifePayload(base, { mode: 'value', branch, block });
    assert.deepEqual(payload.life, block);
  }
});

test('composeLifePayload — branche incompatible avec état résiduel (stale state) → clé absente', () => {
  const base = buildGenericContractPayload({ branch: 'lamal', status: 'actif' });
  const staleBlock = buildLifeBlock(VALID_FIELDS);
  const payload = composeLifePayload(base, { mode: 'value', branch: 'lamal', block: staleBlock });
  assert.equal('life' in payload, false);
});

test('composeLifePayload — modification d’un seul champ → bloc conforme au backend renvoyé', () => {
  const modifiedFields = { ...VALID_FIELDS, surrender_value: '5000' };
  const block = buildLifeBlock(modifiedFields);
  const base = buildGenericContractPayload({ branch: 'vie_3a' });
  const payload = composeLifePayload(base, { mode: 'value', branch: 'vie_3a', block });
  assert.equal(payload.life.surrender_value, 5000);
  assert.equal(payload.life.component_type, 'mixte');
  assert.deepEqual(Object.keys(payload.life).sort(), [...EIGHT_KEYS].sort());
});

test('un champ vidé (insured_rent) ne produit jamais automatiquement life: null', () => {
  const block = buildLifeBlock({ ...VALID_FIELDS, insured_rent: '' });
  const base = buildGenericContractPayload({ branch: 'vie_3a' });
  const payload = composeLifePayload(base, { mode: 'value', branch: 'vie_3a', block });
  assert.notEqual(payload.life, null);
  assert.equal(payload.life.insured_rent, null);
});

test('composeLifePayload — un bloc lamal déjà présent dans le payload d’entrée reste intact', () => {
  const lamalBlock = { care_model: 'standard', deductible: 300, accident_coverage: true, canton: 'VD', tariff_region: null };
  const baseWithLamal = applySpecializedBlockState(
    buildGenericContractPayload({ branch: 'vie_3a' }),
    'lamal', 'value', lamalBlock
  );
  const lifeBlock = buildLifeBlock(VALID_FIELDS);
  const payload = composeLifePayload(baseWithLamal, { mode: 'value', branch: 'vie_3a', block: lifeBlock });
  assert.deepEqual(payload.lamal, lamalBlock);
  assert.deepEqual(payload.life, lifeBlock);
});

test('composeLifePayload — un bloc lca déjà présent dans le payload d’entrée reste intact', () => {
  const lcaBlock = {
    underwriting_status: 'non_requis', waiting_period_days: null,
    administrative_reservation_status: 'aucune', reservation_notes: null,
    exclusions_status: 'aucune', exclusions_notes: null,
  };
  const baseWithLca = applySpecializedBlockState(
    buildGenericContractPayload({ branch: 'vie_3a' }),
    'lca', 'value', lcaBlock
  );
  const lifeBlock = buildLifeBlock(VALID_FIELDS);
  const payload = composeLifePayload(baseWithLca, { mode: 'value', branch: 'vie_3a', block: lifeBlock });
  assert.deepEqual(payload.lca, lcaBlock);
  assert.deepEqual(payload.life, lifeBlock);
});

test('buildLifeBlock — aucune propriété médicale ou inattendue n’est jamais ajoutée au bloc', () => {
  const block = buildLifeBlock(VALID_FIELDS);
  for (const key of Object.keys(block)) {
    assert.ok(EIGHT_KEYS.includes(key), `clé inattendue : ${key}`);
  }
});

test('composeLifePayload — un mode inconnu lève une erreur contrôlée', () => {
  const base = buildGenericContractPayload({ branch: 'vie_3a' });
  assert.throws(() => composeLifePayload(base, { mode: 'cleared', branch: 'vie_3a', block: undefined }));
});

test('LIFE_COMPATIBLE_BRANCHES — exactement vie_3a et vie_3b', () => {
  assert.deepEqual(LIFE_COMPATIBLE_BRANCHES, ['vie_3a', 'vie_3b']);
});

test('LIFE_INITIAL_FIELDS — valeurs d’interface neutres, component_type jamais présélectionné', () => {
  assert.equal(LIFE_INITIAL_FIELDS.component_type, '');
  assert.equal(LIFE_INITIAL_FIELDS.premium_waiver, false);
  assert.equal(LIFE_INITIAL_FIELDS.indexation_type, 'aucune');
  assert.equal(COMPONENT_TYPES.includes(LIFE_INITIAL_FIELDS.component_type), false);
});

test('buildLifeBlock — rejette NaN et Infinity pour un montant', () => {
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, insured_death_capital: NaN }), LifePayloadError);
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, insured_death_capital: Infinity }), LifePayloadError);
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, surrender_value: -Infinity }), LifePayloadError);
});

test('buildLifeBlock — rejette un objet ou un tableau pour un montant', () => {
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, insured_rent: { amount: 100 } }), LifePayloadError);
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, insured_rent: [100] }), LifePayloadError);
});

test('buildLifeBlock — aucune clé de pourcentage ou de taux d’indexation n’existe jamais', () => {
  const block = buildLifeBlock(VALID_FIELDS);
  assert.equal('indexation_rate' in block, false);
  assert.equal('indexation_percent' in block, false);
  assert.equal('rate' in block, false);
});

test('buildLifeBlock — rejette premium_waiver absent ou undefined (jamais normalisé silencieusement à false)', () => {
  const fieldsWithoutWaiver = { ...VALID_FIELDS };
  delete fieldsWithoutWaiver.premium_waiver;
  assert.throws(() => buildLifeBlock(fieldsWithoutWaiver), LifePayloadError);
});

test('buildLifeBlock — rejette premium_waiver numérique (0/1), le frontend exige un booléen strict même si le backend tolère 0/1', () => {
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, premium_waiver: 0 }), LifePayloadError);
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, premium_waiver: 1 }), LifePayloadError);
});

test('buildLifeBlock — rejette NaN/Infinity/objet/tableau pour chaque champ montant (symétrie sur les quatre)', () => {
  for (const field of ['insured_death_capital', 'insured_disability_capital', 'insured_rent', 'surrender_value']) {
    assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, [field]: NaN }), LifePayloadError, `${field} devrait rejeter NaN`);
    assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, [field]: Infinity }), LifePayloadError, `${field} devrait rejeter Infinity`);
    assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, [field]: {} }), LifePayloadError, `${field} devrait rejeter un objet`);
    assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, [field]: [1] }), LifePayloadError, `${field} devrait rejeter un tableau`);
  }
});

test('buildLifeBlock — rejette indexation_type: "" (chaîne vide, hors énumération)', () => {
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, indexation_type: '' }), LifePayloadError);
});

test('buildLifeBlock — rejette component_type non-string (nombre, objet)', () => {
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, component_type: 42 }), LifePayloadError);
  assert.throws(() => buildLifeBlock({ ...VALID_FIELDS, component_type: {} }), LifePayloadError);
});

test('buildLifeBlock — lève une erreur contrôlée si fields est undefined ou null', () => {
  assert.throws(() => buildLifeBlock(undefined), LifePayloadError);
  assert.throws(() => buildLifeBlock(null), LifePayloadError);
});

test('composeLifePayload — transition vie_3a → vie_3b avec un bloc déjà rempli (mode "value" conservé, pas de reset)', () => {
  const block = buildLifeBlock({ ...VALID_FIELDS, insured_rent: '4200' });
  const onVie3a = composeLifePayload(buildGenericContractPayload({ branch: 'vie_3a' }), { mode: 'value', branch: 'vie_3a', block });
  const onVie3b = composeLifePayload(buildGenericContractPayload({ branch: 'vie_3b' }), { mode: 'value', branch: 'vie_3b', block });
  assert.deepEqual(onVie3a.life, block);
  assert.deepEqual(onVie3b.life, block);
});
