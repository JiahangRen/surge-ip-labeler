import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveKeychainAccount } from '../src/local/keychain.js';

test('uses explicitly configured keychain account before environment defaults', () => {
  assert.equal(
    resolveKeychainAccount({ explicitAccount: 'jeffereyreng', environment: { USER: 'wrong-user' } }),
    'jeffereyreng',
  );
});

test('uses the interactive user environment when no explicit account is supplied', () => {
  assert.equal(resolveKeychainAccount({ environment: { USER: 'jeffereyreng' } }), 'jeffereyreng');
});
