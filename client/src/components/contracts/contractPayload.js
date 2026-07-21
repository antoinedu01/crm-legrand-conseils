// Miroir exact de FIELDS dans server/routes/contracts.js — toute divergence
// avec le backend doit être corrigée ici, jamais devinée.
export const GENERIC_CONTRACT_FIELDS = [
  'client_id', 'company_id', 'branch', 'policy_number', 'product_name', 'annual_premium',
  'payment_frequency', 'start_date', 'end_date', 'status',
  'acq_commission_rate', 'rec_commission_rate', 'notes',
];

export const SPECIALIZED_BLOCK_KEYS = ['lamal', 'lca', 'life', 'income_protection', 'lpp_ijm'];

const BLOCK_STATES = ['absent', 'value', 'removed'];

// Ne retient que les champs génériques whitelistés présents sur formState :
// exclut systématiquement les 5 clés de bloc spécialisé et toute autre
// propriété (id, created_at, client_name, commissions_*, ...) renvoyée par
// l'API. Ne transforme jamais la valeur d'un champ générique conservé.
export function buildGenericContractPayload(formState) {
  const payload = {};
  for (const field of GENERIC_CONTRACT_FIELDS) {
    if (field in (formState || {})) payload[field] = formState[field];
  }
  return payload;
}

export function hasAnySpecializedBlock(contractRow) {
  return SPECIALIZED_BLOCK_KEYS.some((key) => (contractRow || {})[key] != null);
}

// state: 'absent' (clé jamais ajoutée) | 'value' (payload[blockKey] = value)
// | 'removed' (payload[blockKey] = null). Ne mute jamais le payload d'origine.
export function applySpecializedBlockState(payload, blockKey, state, value) {
  if (!BLOCK_STATES.includes(state)) {
    throw new Error(`État de bloc spécialisé inconnu : "${state}".`);
  }
  if (state === 'absent') return { ...payload };
  if (state === 'removed') return { ...payload, [blockKey]: null };
  return { ...payload, [blockKey]: value };
}
