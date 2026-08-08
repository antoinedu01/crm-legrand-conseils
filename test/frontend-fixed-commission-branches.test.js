import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXED_ONLY_BRANCHES as FRONTEND_FIXED_ONLY_BRANCHES } from '../client/src/components/contracts/fixedCommissionBranches.js';
import { FIXED_ONLY_BRANCHES as BACKEND_FIXED_ONLY_BRANCHES } from '../server/commissionCalc.js';

test('FIXED_ONLY_BRANCHES (frontend) — identique au miroir backend (pas de liste dupliquée divergente)', () => {
  assert.deepEqual(FRONTEND_FIXED_ONLY_BRANCHES, BACKEND_FIXED_ONLY_BRANCHES);
  assert.deepEqual(FRONTEND_FIXED_ONLY_BRANCHES, ['lamal', 'lca']);
});
