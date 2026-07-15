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
      if (options.url === 'http://ip-api.com/json?fields=status,query') {
        return { body: JSON.stringify({ status: 'success', query: '203.0.113.8' }) };
      }
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
    url: 'http://ip-api.com/json?fields=status,query',
    node: ['descriptor:IPLC 香港 01'],
    'policy-descriptor': ['descriptor:IPLC 香港 01'],
    timeout: 10000,
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
      if (options.url === 'http://ip-api.com/json?fields=status,query') {
        return { body: JSON.stringify({ status: 'success', query: '203.0.113.8' }) };
      }
      intelCalls += 1;
      return { body: JSON.stringify({ trust_score: 80 }) };
    },
  });

  await operator([{ name: 'A' }, { name: 'B' }]);
  assert.equal(intelCalls, 1);
});

test('shows a safe exit-request failure marker instead of hiding the failure source', async () => {
  const operator = createSubStoreOperator({
    produce: () => ['descriptor:bad'],
    cache: new Map(),
    httpGet: async () => { throw new Error('secret proxy descriptor must not appear'); },
  });

  const [proxy] = await operator([{ name: '坏节点' }]);
  assert.equal(proxy.name, '坏节点 [出口请求失败] | 评分未知 | 原生未知 | 住宅未知 | 人类未知');
});

test('shows a safe no-IP marker when the exit endpoint replies without an IP', async () => {
  const operator = createSubStoreOperator({
    produce: () => ['descriptor:ok'],
    cache: new Map(),
    httpGet: async () => ({ body: JSON.stringify({ status: 'fail' }) }),
  });

  const [proxy] = await operator([{ name: '无出口IP' }]);
  assert.equal(proxy.name, '无出口IP [出口响应无IP] | 评分未知 | 原生未知 | 住宅未知 | 人类未知');
});

test('keeps the exit IP when only Net.Coffee fails', async () => {
  const operator = createSubStoreOperator({
    produce: () => ['descriptor:ok'],
    cache: new Map(),
    httpGet: async ({ url }) => {
      if (url === 'http://ip-api.com/json?fields=status,query') {
        return { body: JSON.stringify({ status: 'success', query: '203.0.113.9' }) };
      }
      throw new Error('Net.Coffee unavailable');
    },
  });

  const [proxy] = await operator([{ name: '仅情报失败' }]);
  assert.equal(proxy.name, '仅情报失败 [203.0.113.9] | 评分未知 | 原生未知 | 住宅未知 | 人类未知');
});

test('uploads one complete labelled snapshot after processing every proxy', async () => {
  const uploads = [];
  const operator = createSubStoreOperator({
    produce: ([proxy]) => [`descriptor:${proxy.name}`],
    serialize: (proxies) => proxies.map((proxy) => `${proxy.name} = ss, host, 443`).join('\n'),
    uploadSnapshot: async (snapshot) => uploads.push(snapshot),
    cache: new Map(),
    now: () => 1_000,
    httpGet: async ({ url }) => url.includes('ip-api.com')
      ? { body: '{"status":"success","query":"203.0.113.8"}' }
      : { body: '{"trust_score":92}' },
  });

  await operator([{ name: 'A' }]);

  assert.equal(uploads.length, 1);
  assert.match(uploads[0].content, /A \[203\.0\.113\.8\]/);
  assert.deepEqual(uploads[0].summary, { nodeCount: 1, failedCount: 0 });
  assert.equal(uploads[0].updatedAt, '1970-01-01T00:00:01.000Z');
});
