import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';

function makeEnv() {
  const values = new Map();
  return {
    SYNC_TOKEN: 'sync-secret',
    READ_TOKEN: 'read-secret',
    IOS_READ_TOKEN: 'ios-read-secret',
    POLICIES: {
      get: async (key, type) => values.get(key) ?? null,
      put: async (key, value) => values.set(key, value),
    },
  };
}

function request(path, init) {
  return new Request(`https://worker.example${path}`, init);
}

test('rejects missing and wrong upload credentials', async () => {
  const env = makeEnv();
  const body = JSON.stringify({ content: 'Node = ss, host, 443', updatedAt: '2026-07-14T00:00:00Z', summary: { nodeCount: 1, failedCount: 0 } });

  assert.equal((await worker.fetch(request('/v1/snapshot', { method: 'POST', body }), env)).status, 401);
  assert.equal((await worker.fetch(request('/v1/snapshot', { method: 'POST', headers: { Authorization: 'Bearer wrong' }, body }), env)).status, 401);
  assert.equal(await env.POLICIES.get('current'), null);
});

test('rejects every upload when the sync secret is missing', async () => {
  const body = JSON.stringify({ content: 'Node = ss, host, 443', updatedAt: '2026-07-14T00:00:00Z', summary: { nodeCount: 1, failedCount: 0 } });

  const env = makeEnv();
  env.SYNC_TOKEN = undefined;

  assert.equal((await worker.fetch(request('/v1/snapshot', {
    method: 'POST',
    headers: { Authorization: 'Bearer undefined', 'Content-Type': 'application/json' },
    body,
  }), env)).status, 401);
  assert.equal((await worker.fetch(request('/v1/snapshot', {
    method: 'POST',
    headers: { Authorization: 'Bearer sync-secret', 'Content-Type': 'application/json' },
    body,
  }), env)).status, 401);
  assert.equal(await env.POLICIES.get('current'), null);
});

test('rejects a matching blank bearer token when the sync secret is empty', async () => {
  const env = makeEnv();
  env.SYNC_TOKEN = '';
  const snapshot = { content: 'Node = ss, host, 443', updatedAt: '2026-07-14T00:00:00Z', summary: { nodeCount: 1, failedCount: 0 } };
  const upload = {
    method: 'POST',
    url: 'https://worker.example/v1/snapshot',
    headers: { get: (name) => name === 'Authorization' ? 'Bearer ' : null },
    json: async () => snapshot,
  };

  assert.equal((await worker.fetch(upload, env)).status, 401);
  assert.equal(await env.POLICIES.get('current'), null);
});

test('stores a valid snapshot and serves it only to a protected subscription request', async () => {
  const env = makeEnv();
  const content = 'Node = trojan, host, 443, password=redacted';
  const snapshot = { content, updatedAt: '2026-07-14T00:00:00Z', summary: { nodeCount: 1, failedCount: 0 } };

  const upload = await worker.fetch(request('/v1/snapshot', {
    method: 'POST',
    headers: { Authorization: 'Bearer sync-secret', 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  }), env);
  assert.equal(upload.status, 204);
  assert.equal(await env.POLICIES.get('current'), content);

  assert.equal((await worker.fetch(request('/v1/subscription'), env)).status, 401);
  assert.equal((await worker.fetch(request('/v1/subscription?token=wrong'), env)).status, 401);

  const subscription = await worker.fetch(request('/v1/subscription?token=read-secret'), env);
  assert.equal(subscription.status, 200);
  assert.equal(subscription.headers.get('Content-Type'), 'text/plain; charset=utf-8');
  assert.equal(subscription.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(subscription.headers.has('Access-Control-Allow-Origin'), false);
  assert.equal(await subscription.text(), content);
});

test('exposes only redacted snapshot status', async () => {
  const env = makeEnv();
  await worker.fetch(request('/v1/snapshot', {
    method: 'POST',
    headers: { Authorization: 'Bearer sync-secret', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: 'Sensitive = vmess, secret-host, uuid=secret',
      updatedAt: '2026-07-14T00:00:00Z',
      summary: { nodeCount: 9, failedCount: 2, sourceUrl: 'https://private.example/feed' },
    }),
  }), env);

  const status = await worker.fetch(request('/v1/status'), env);
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { updatedAt: '2026-07-14T00:00:00Z', nodeCount: 9, failedCount: 2 });
});

test('serves a static iOS policy only with the dedicated iOS secret', async () => {
  const env = makeEnv();
  await env.POLICIES.put('current', 'Node A = ss, example.com, 443');

  assert.equal((await worker.fetch(request('/v1/ios-policy'), env)).status, 401);
  assert.equal((await worker.fetch(request('/v1/ios-policy?token=read-secret'), env)).status, 401);

  const response = await worker.fetch(request('/v1/ios-policy?token=ios-read-secret'), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/plain; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'), 'private, max-age=300');
  assert.equal(await response.text(), 'Node A = ss, example.com, 443');
});

test('does not expose an iOS policy until a completed snapshot exists', async () => {
  const env = makeEnv();
  assert.equal(
    (await worker.fetch(request('/v1/ios-policy?token=ios-read-secret'), env)).status,
    404,
  );
});

test('rejects iOS policy reads when the dedicated secret is absent', async () => {
  const env = makeEnv();
  env.IOS_READ_TOKEN = undefined;
  await env.POLICIES.put('current', 'Node A = ss, example.com, 443');
  assert.equal(
    (await worker.fetch(request('/v1/ios-policy?token=ios-read-secret'), env)).status,
    401,
  );
});
