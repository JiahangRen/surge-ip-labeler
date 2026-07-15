import test from 'node:test';
import assert from 'node:assert/strict';

import { buildValidationProfile, syncSnapshot } from '../src/local/policy-mirror.js';

test('builds a minimal Surge wrapper for validating policy lines', () => {
  const profile = buildValidationProfile('节点 [203.0.113.8] | 🟢92 = ss, node.example, 443');

  assert.match(profile, /^\[Proxy\]/m);
  assert.match(profile, /节点 \[203\.0\.113\.8\] \| 🟢92 = ss, node\.example, 443/);
  assert.match(profile, /\[Proxy Group\]\n__IP_LABEL_VALIDATION__ = select, DIRECT/);
  assert.match(profile, /\[Rule\]\nFINAL,DIRECT/);
});

test('does not replace the current local policy file when snapshot validation fails', async () => {
  const writes = [];

  await assert.rejects(
    syncSnapshot({
      fetchSnapshot: async () => '节点 = ss, node.example, 443',
      validate: async () => ({ ok: false, error: 'invalid surge config' }),
      writeAtomic: async (...args) => writes.push(args),
      outputPath: '/tmp/ip-labels.conf',
    }),
    /invalid surge config/,
  );

  assert.deepEqual(writes, []);
});

test('atomically replaces local policy only after a non-empty snapshot validates', async () => {
  const writes = [];
  const result = await syncSnapshot({
    fetchSnapshot: async () => '节点 [203.0.113.8] | 🟢92 = ss, node.example, 443\n',
    validate: async (profile) => {
      assert.match(profile, /节点 \[203\.0\.113\.8\]/);
      return { ok: true };
    },
    writeAtomic: async (...args) => writes.push(args),
    outputPath: '/tmp/ip-labels.conf',
  });

  assert.deepEqual(writes, [[
    '/tmp/ip-labels.conf',
    '节点 [203.0.113.8] | 🟢92 = ss, node.example, 443\n',
  ]]);
  assert.deepEqual(result, { policyCount: 1 });
});

test('refuses an empty or non-policy Worker response before validation', async () => {
  let validated = false;

  await assert.rejects(
    syncSnapshot({
      fetchSnapshot: async () => '<html>gateway error</html>',
      validate: async () => { validated = true; return { ok: true }; },
      writeAtomic: async () => {},
      outputPath: '/tmp/ip-labels.conf',
    }),
    /no Surge proxy policies/,
  );

  assert.equal(validated, false);
});
