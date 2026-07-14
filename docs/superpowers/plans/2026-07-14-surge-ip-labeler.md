# Surge IP Labeler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Surge module that reads a Sub-Store Surge feed, safely labels each node with its own exit-IP intelligence, and publishes a protected external policy feed for Surge.

**Architecture:** The Surge cron script runs on the user's device and uses `$httpClient` with `policy-descriptor` to discover each node's egress IP. It applies a persistent 24-hour cache and a serial, rate-limited Net.Coffee lookup queue before uploading transformed policy lines to a Cloudflare Worker/KV private feed. GitHub Pages hosts only the module, documentation, and a credential-free status page.

**Tech Stack:** Surge JavaScript API, Node.js 22 built-in test runner, Cloudflare Worker + KV, static GitHub Pages.

## Global Constraints

- Keep the Sub-Store source URL read-only; never commit it.
- Never log proxy descriptors, credentials, source URLs, or access tokens.
- Query Net.Coffee one at a time, wait at least 3 seconds plus jitter, de-duplicate exit IPs, and cache for 24 hours.
- On `403`, `429`, any `5xx`, or repeated timeout, stop the scan and defer for 24 hours.
- Name scores `80–100 🟢`, `50–79 🟡`, `0–49 🔴`; do not invent bot percentages.
- Only the private Worker endpoint may store the transformed Surge policy lines.

---

### Task 1: Create tested policy parsing and label formatting library

**Files:**
- Create: `package.json`
- Create: `src/shared/policy.js`
- Create: `test/policy.test.js`

**Interfaces:**
- Produces `parsePolicyFeed(text)`, `formatLabel(name, exitIp, intel)`, and `renderPolicyLine(node, label)`.

- [ ] **Step 1: Write failing parsing and preservation tests**

```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { parsePolicyFeed, formatLabel, renderPolicyLine } from '../src/shared/policy.js';
test('preserves descriptor exactly while replacing only name', () => {
  const [node] = parsePolicyFeed('HK 01 = trojan, host, 443, password=x, sni=a');
  assert.equal(renderPolicyLine(node, 'HK 01 [1.1.1.1] 🟢92 | 原生IP | 住宅 | 人类偏多'), 'HK 01 [1.1.1.1] 🟢92 | 原生IP | 住宅 | 人类偏多 = trojan, host, 443, password=x, sni=a');
});
test('uses required score thresholds and unknown fallbacks', () => {
  assert.match(formatLabel('HK 01', '1.1.1.1', { trust_score: 80, isResidential: true, native: true, is_crawler: false }), /🟢80/);
  assert.match(formatLabel('HK 01', null, {}), /IP:未知/);
});
```

- [ ] **Step 2: Run `npm test` and verify failure**
- [ ] **Step 3: Implement line splitting, comment/blank-line preservation, name escaping, score/type/human labels, and descriptor retention in `src/shared/policy.js`**
- [ ] **Step 4: Run `npm test`; expected: all Task 1 tests pass**
- [ ] **Step 5: Commit `feat: add policy label formatting`**

### Task 2: Build the rate-safe Surge scanner module

**Files:**
- Create: `src/surge/ip-labeler.js`
- Create: `src/surge/ip-labeler.sgmodule`
- Create: `test/scanner.test.js`

**Interfaces:**
- Consumes `parsePolicyFeed`, `formatLabel`, `renderPolicyLine`.
- Produces `runScan(dependencies)` and a deployable cron module.

- [ ] **Step 1: Write mock-based tests for serial requests, IP de-duplication, 24-hour cache, and 24-hour circuit breaker**

```js
test('queries unique exit IPs serially with cached results skipped', async () => {
  const calls = []; const result = await runScan(mockDeps({ descriptors: ['a', 'b'], exitIps: ['1.1.1.1', '1.1.1.1'], calls }));
  assert.equal(calls.filter(x => x.includes('/api/ip/lookup/')).length, 1);
  assert.equal(result.lines.length, 2);
});
test('opens breaker on 429', async () => {
  const deps = mockDeps({ lookupStatus: 429 }); await assert.rejects(() => runScan(deps), /rate limited/);
  assert.equal(deps.store.get('blockedUntil') > Date.now(), true);
});
```

- [ ] **Step 2: Run `npm test -- test/scanner.test.js` and verify failure**
- [ ] **Step 3: Implement one-at-a-time async queue; use `$httpClient.get({url: IP_ECHO_URL, 'policy-descriptor': descriptor, timeout: 10}, ...)`; wait `3000 + Math.floor(Math.random()*1000)` ms only before uncached Net.Coffee requests**
- [ ] **Step 4: Store `{expiresAt, intel}` by exit-IP and `blockedUntil` using `$persistentStore`; upload no data until all safe work is complete**
- [ ] **Step 5: Add module metadata, blank `source_url`, `upload_url`, and `upload_token` arguments, plus `type=cron`, `cronexp="0 */6 * * *"`, `timeout=300`, and `script-update-interval=86400`**
- [ ] **Step 6: Run all tests and commit `feat: add rate-safe Surge scanner`**

### Task 3: Implement protected Cloudflare subscription storage

**Files:**
- Create: `worker/src/index.js`
- Create: `worker/wrangler.toml`
- Create: `worker/test/worker.test.js`

**Interfaces:**
- `POST /v1/snapshot` accepts a JSON body `{content, updatedAt, summary}` with `Authorization: Bearer <SYNC_TOKEN>`.
- `GET /v1/subscription?token=<READ_TOKEN>` returns `text/plain; charset=utf-8`.
- `GET /v1/status` returns only `{updatedAt,nodeCount,failedCount}`.

- [ ] **Step 1: Write Worker tests for rejected missing/wrong tokens, valid upload, protected download, and redacted status**
- [ ] **Step 2: Run `npm test -- worker/test/worker.test.js` and verify failure**
- [ ] **Step 3: Implement routes; write content to `POLICIES` KV key `current` and metadata to `status`; set `Cache-Control: private, no-store` for subscription and no CORS wildcard for it**
- [ ] **Step 4: Set only binding declarations in `wrangler.toml`; document `SYNC_TOKEN` and `READ_TOKEN` as Worker secrets, never values**
- [ ] **Step 5: Run all tests and commit `feat: add protected subscription worker`**

### Task 4: Produce GitHub Pages artifacts and Surge patch template

**Files:**
- Create: `site/index.html`
- Create: `site/module.sgmodule`
- Create: `patches/policy-path.template.diff`
- Create: `.github/workflows/pages.yml`
- Create: `README.md`

- [ ] **Step 1: Write a test that scans published artifacts for `password=`, `uuid=`, `token=`, and a real source URL pattern; expected only documented placeholders pass**
- [ ] **Step 2: Implement a static status page that reads only `/v1/status` after the user supplies their Worker base URL locally; do not show policy content**
- [ ] **Step 3: Publish `module.sgmodule` and its script; template the replacement as `policy-path=https://WORKER/v1/subscription?token=READ_TOKEN, update-interval=3600` while preserving each existing regex filter and group mode**
- [ ] **Step 4: Configure Pages workflow to deploy `site/` on `main` and run tests before deployment**
- [ ] **Step 5: Document Worker creation, KV binding, secret commands, module argument entry, original URL retention, and safe rollback to the original `policy-path`**
- [ ] **Step 6: Run `npm test`, inspect the built site, and commit `feat: publish Surge IP labeler assets`**

### Task 5: Validate against realistic fixture and hand off

**Files:**
- Create: `test/fixtures/mixed-proxies.surge`
- Create: `docs/validation.md`

- [ ] **Step 1: Add redacted HTTP, SOCKS5, SS, VMess, and Trojan fixture lines**
- [ ] **Step 2: Test exact descriptor preservation, duplicate exits, unknown intelligence, circuit breaker, and Worker access protection**
- [ ] **Step 3: Run `npm test` and `npx wrangler deploy --dry-run`; expected: all tests pass and no secret appears in output**
- [ ] **Step 4: Record exact manual Surge validation: install module, set arguments, run once, replace one `policy-path`, reload profile, confirm label and latency appear in the native selection list**
- [ ] **Step 5: Commit `test: validate Surge IP labeler workflow`**
