# First Scan Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run an initial label scan within one minute of module installation, then at most once every six hours.

**Architecture:** The published module wakes the script each minute. `runInSurge` gates `runScan` using a persistent `nextScanAt` timestamp, so non-due invocations make no network calls. A successful scan and circuit-breaker deferral schedule the next allowed scan six hours later.

**Tech Stack:** Surge JavaScript runtime, Node.js built-in test runner, GitHub Pages.

## Global Constraints

- Keep Net.Coffee lookups serial with the existing 3-second-plus-jitter delay.
- Do not modify the source subscription.
- Do not make any network request when a scan is not due.
- Actual scans remain separated by six hours.

---

### Task 1: Add scan-due scheduling

**Files:**
- Modify: `src/surge/ip-labeler.js`
- Modify: `test/scanner.test.js`
- Modify: `site/surge-ip-labeler.js`
- Modify: `site/module.sgmodule`

**Interfaces:**
- Consumes: `runScan(dependencies)` and Surge `$persistentStore`.
- Produces: `runInSurge(argument)` which returns `{ skipped: true }` before `nextScanAt`, otherwise uploads one completed snapshot and writes `nextScanAt` six hours ahead.

- [ ] **Step 1: Write the failing tests**

```js
test('skips all network activity until the next scheduled scan', async () => {
  const result = await runInSurgeWithDependencies({ now: () => 1000, nextScanAt: 1001 });
  assert.deepEqual(result, { skipped: true });
  assert.equal(fetchCalls.length, 0);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test test/scanner.test.js`

Expected: FAIL because the schedule gate does not exist.

- [ ] **Step 3: Implement the smallest schedule gate**

```js
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
if (Number(getStoreValue(store, 'nextScanAt')) > now()) return { skipped: true };
const result = await runScan(deps);
setStoreValue(store, 'nextScanAt', now() + SIX_HOURS_MS);
return result;
```

Update the module cron expression to `* * * * *`, and regenerate the self-contained `site/surge-ip-labeler.js` from the source change.

- [ ] **Step 4: Run the full suite and verify it passes**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 5: Commit and publish**

```bash
git add src/surge/ip-labeler.js test/scanner.test.js site/surge-ip-labeler.js site/module.sgmodule docs/superpowers
git commit -m "feat: trigger initial scan promptly"
git push origin HEAD:main
```
