import test from 'node:test';
import assert from 'node:assert/strict';

import { createSubStoreOperator } from '../src/substore/ip-labeler.js';

test('labels Sub-Store proxies by querying each proxy exit and Net.Coffee', async () => {
  const calls = [];
  const operator = createSubStoreOperator({
    produce: ([proxy]) => [`descriptor:${proxy.name}`],
    cache: new Map(),
    now: () => 1_000,
    httpGet: async (options) => {
      calls.push(options);
      if (options.url === 'https://api.ipify.org') return { body: '203.0.113.8' };
      if (options.url === 'https://ip.net.coffee/api/ip/lookup/203.0.113.8') {
        return { body: JSON.stringify({ trust_score: 92, native: true, isResidential: true, is_crawler: false }) };
      }
      throw new Error('unexpected URL');
    },
  });
  const proxies = [{ name: 'IPLC 香港 01', server: 'node.example', port: 443 }];

  const result = await operator(proxies);

  assert.equal(result[0].name, 'IPLC 香港 01 [203.0.113.8] | 🟢92 | 原生IP | 住宅 | 人类偏多');
  assert.deepEqual(calls[0], {
    url: 'https://api.ipify.org',
    'policy-descriptor': 'descriptor:IPLC 香港 01',
    timeout: 10,
  });
  assert.equal(calls.length, 2);
});

test('uses one cached intelligence lookup for duplicate exit IPs', async () => {
  let intelCalls = 0;
  const operator = createSubStoreOperator({
    produce: ([proxy]) => [`descriptor:${proxy.name}`],
    cache: new Map(),
    now: () => 1_000,
    httpGet: async (options) => {
      if (options.url === 'https://api.ipify.org') return { body: '203.0.113.8' };
      intelCalls += 1;
      return { body: JSON.stringify({ trust_score: 80 }) };
    },
  });

  await operator([{ name: 'A' }, { name: 'B' }]);
  assert.equal(intelCalls, 1);
});
