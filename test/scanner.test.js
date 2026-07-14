import test from 'node:test';
import assert from 'node:assert/strict';

import { runScan } from '../src/surge/ip-labeler.js';

function mockDeps({ descriptors = ['a'], exitIps = ['1.1.1.1'], lookupStatus = 200, cache = new Map(), calls = [] } = {}) {
  let exitIndex = 0;
  const store = {
    get(key) { return cache.get(key); },
    set(key, value) { cache.set(key, value); },
  };

  return {
    sourceUrl: 'https://source.invalid/feed',
    store,
    calls,
    now: () => 1_000_000,
    random: () => 0,
    sleep: async (milliseconds) => calls.push(`sleep:${milliseconds}`),
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (url === 'https://source.invalid/feed') {
        return { status: 200, body: descriptors.map((descriptor, index) => `Node ${index} = ${descriptor}`).join('\n') };
      }
      if (url === 'https://api.ipify.org') {
        return { status: 200, body: exitIps[exitIndex++] };
      }
      if (url.includes('/api/ip/lookup/')) {
        return { status: lookupStatus, body: JSON.stringify({ trust_score: 90, native: true, isResidential: true, is_crawler: false }) };
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  };
}

test('queries each unique exit IP once, serially, and skips cached intelligence', async () => {
  const calls = [];
  const result = await runScan(mockDeps({ descriptors: ['a', 'b', 'c'], exitIps: ['1.1.1.1', '1.1.1.1', '2.2.2.2'], calls }));

  assert.equal(calls.filter((call) => typeof call === 'object' && call.url.includes('/api/ip/lookup/')).length, 2);
  assert.deepEqual(calls.filter((call) => typeof call === 'string'), ['sleep:3000', 'sleep:3000']);
  assert.equal(result.lines.length, 3);

  const cachedCalls = [];
  const cache = new Map([['ip:1.1.1.1', { expiresAt: 1_100_000, intel: { trust_score: 90 } }]]);
  await runScan(mockDeps({ descriptors: ['a'], exitIps: ['1.1.1.1'], cache, calls: cachedCalls }));
  assert.equal(cachedCalls.filter((call) => typeof call === 'object' && call.url.includes('/api/ip/lookup/')).length, 0);
  assert.equal(cachedCalls.includes('sleep:3000'), false);
});

test('uses policy descriptors for exit-IP discovery', async () => {
  const calls = [];
  await runScan(mockDeps({ descriptors: ['trojan, host, 443, password=x'], calls }));

  const echo = calls.find((call) => typeof call === 'object' && call.url === 'https://api.ipify.org');
  assert.deepEqual(echo.options, { 'policy-descriptor': ' trojan, host, 443, password=x', timeout: 10 });
});

test('opens a 24-hour circuit breaker on rate limiting and does not upload partial output', async () => {
  const deps = mockDeps({ lookupStatus: 429 });
  deps.upload = async () => { throw new Error('should not upload'); };

  await assert.rejects(() => runScan(deps), /rate limited/);
  assert.equal(deps.store.get('blockedUntil'), 1_000_000 + 86_400_000);
});

test('uses the published Net.Coffee endpoint and uploads Worker-compatible summary', async () => {
  const calls = [];
  let uploaded;
  const deps = mockDeps({ descriptors: ['a', 'b'], exitIps: ['1.1.1.1', '2.2.2.2'], calls });
  deps.upload = async (content, result) => { uploaded = { content, result }; };

  await runScan(deps);

  assert.equal(calls.filter((call) => typeof call === 'object' && call.url.startsWith('https://ip.net.coffee/api/ip/lookup/')).length, 2);
  assert.deepEqual(uploaded.result.summary, { nodeCount: 2, failedCount: 0 });
});
