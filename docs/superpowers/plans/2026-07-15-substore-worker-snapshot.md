# Sub-Store Worker Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish completed Sub-Store labels to the existing private Worker so Surge can load them without a local `sub.store` interception.

**Architecture:** The operator uses optional local-only `sync_url` and `sync_token` arguments. After all nodes are labelled, it serializes the proxy list as Surge text and posts one complete snapshot to the Worker. The Worker remains protected by `SYNC_TOKEN` for writes and `READ_TOKEN` for reads.

**Tech Stack:** JavaScript ES modules, Node.js test runner, Sub-Store Script Operator, Cloudflare Workers KV.

## Global Constraints

- Never commit subscription URLs, passwords, UUIDs, or tokens.
- Upload only after every proxy inspection has finished.
- Without both sync arguments, the operator remains preview-only.
- Keep the Worker subscription response private and non-cacheable.

---

### Task 1: Add a testable complete-snapshot upload hook

**Files:**
- Modify: `src/substore/ip-labeler.js`
- Modify: `test/substore-operator.test.js`

**Interfaces:**
- Consumes: optional `serialize(proxies)` and `uploadSnapshot(snapshot)` dependencies.
- Produces: `{ content, updatedAt, summary }` only after the final proxy is labelled.

- [ ] **Step 1: Write the failing test**

```js
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
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `node --test test/substore-operator.test.js`

Expected: FAIL because no snapshot upload hook exists.

- [ ] **Step 3: Implement the optional hook after `mapLimit` completes**

```js
if (uploadSnapshot && serialize) {
  await uploadSnapshot({
    content: serialize(result),
    updatedAt: new Date(now()).toISOString(),
    summary: { nodeCount: result.length, failedCount: 0 },
  });
}
```

- [ ] **Step 4: Run focused tests**

Run: `node --test test/substore-operator.test.js`

Expected: PASS.

### Task 2: Wire local-only Worker upload into the published operator

**Files:**
- Modify: `site/substore-ip-labeler.js`
- Modify: `test/published-artifacts.test.js`

**Interfaces:**
- Consumes: `$arguments.sync_url`, `$arguments.sync_token`, `ProxyUtils.produce(proxies, 'Surge')`.
- Produces: one authenticated POST to Worker `/v1/snapshot` after the operator completes.

- [ ] **Step 1: Write an artifact test**

```js
assert.match(subStoreScript, /sync_url/);
assert.match(subStoreScript, /sync_token/);
assert.match(subStoreScript, /ProxyUtils\.produce\(proxies, 'Surge'\)/);
```

- [ ] **Step 2: Run and verify it fails**

Run: `node --test test/published-artifacts.test.js`

Expected: FAIL because the public operator has no sync arguments.

- [ ] **Step 3: Implement opt-in upload after all workers finish**

```js
const syncUrl = String($arguments?.sync_url || '').trim();
const syncToken = String($arguments?.sync_token || '').trim();
if (syncUrl && syncToken) {
  const output = ProxyUtils.produce(proxies, 'Surge');
  const content = Array.isArray(output) ? output.join('\n') : String(output || '');
  await $.http.post({
    url: syncUrl,
    headers: { Authorization: `Bearer ${syncToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, updatedAt: new Date().toISOString(), summary: { nodeCount: proxies.length, failedCount: 0 } }),
    timeout: 10000,
  });
}
```

- [ ] **Step 4: Run all tests**

Run: `npm test`

Expected: PASS.

### Task 3: Document and publish the remote handoff

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: local Sub-Store script arguments and the existing Worker secrets.
- Produces: an exact Worker `policy-path` replacement without embedding a secret in public code.

- [ ] **Step 1: Document local-only script arguments and the Worker subscription URL form**

```text
...substore-ip-labeler.js#limit=20&sync_url=https%3A%2F%2Fsurge-ip-labeler.jiahangren-surge.workers.dev%2Fv1%2Fsnapshot&sync_token=SYNC_TOKEN
policy-path=https://surge-ip-labeler.jiahangren-surge.workers.dev/v1/subscription?token=READ_TOKEN
```

- [ ] **Step 2: Verify, commit, push to `main`, and wait for Pages**

Run: `npm test && git diff --check && git push origin HEAD:main && gh run watch --exit-status`

Expected: tests pass and GitHub Pages deployment succeeds.
