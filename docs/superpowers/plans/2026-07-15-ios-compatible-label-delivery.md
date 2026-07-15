# iOS Compatible Label Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a private, static Surge iOS policy resource and an isolated installable iOS test module without changing any macOS Worker route, Keychain item, local mirror script, LaunchAgent, or existing Surge policy group.

**Architecture:** The existing Sub-Store scan continues to upload one completed snapshot to `POLICIES/current`. A new Worker read-only route, authenticated with an independent `IOS_READ_TOKEN`, returns that same stored text with Surge policy-resource headers. A new module creates only `🧪 IP 标签 iOS`; the user may test it separately before manually choosing to use it in any production group.

**Tech Stack:** Cloudflare Workers JavaScript, Cloudflare KV, Surge `.sgmodule`, Node.js built-in test runner, GitHub Pages static artifacts.

## Global Constraints

- Do not modify `GET /v1/subscription`, `POST /v1/snapshot`, or `GET /v1/status` behavior.
- Do not modify `scripts/sync-local-policy-file.mjs`, macOS Keychain usage, LaunchAgent files, or any user Surge profile.
- Do not alter upstream subscriptions, Sub-Store collection settings, or scan cadence.
- The iOS route must only read `POLICIES/current`; it must not scan IPs, invoke Sub-Store, or write KV.
- Use a new Worker secret named `IOS_READ_TOKEN`; never store its value in source, tests, module files, documentation, logs, or command output.
- Use `https://ip-labeler.renjiahang1201.xyz` as the published custom-domain origin.
- The module must add only `🧪 IP 标签 iOS`; it must not override `🔄 手动切换` or other policy groups.
- Keep iOS resource polling at `update-interval=3600` seconds.
- Public files must contain only `REQUIRED_IOS_READ_TOKEN`, never a real token.

---

## File Structure

- Modify `worker/src/index.js`: add a narrowly scoped `iosPolicy(url, env)` read handler and route dispatcher branch.
- Modify `worker/test/worker.test.js`: add authentication, no-snapshot, response-header, and static-read tests for the new route.
- Create `src/surge/ios-ip-labeler.sgmodule`: source installable test module using an argument placeholder.
- Create `site/ios-ip-labeler.sgmodule`: GitHub Pages publication artifact with the custom-domain URL.
- Modify `test/module-metadata.test.js`: validate the source iOS module syntax and isolation guarantee.
- Modify `test/site-publish.test.js`: validate the Pages iOS module URL and no write-side script declaration.
- Modify `README.md`: document iOS installation, separate-secret provisioning, safe validation, and rollback without changing macOS instructions.

## Task 1: Add and test the iOS Worker read route

**Files:**
- Modify: `worker/test/worker.test.js`
- Modify: `worker/src/index.js`

**Interfaces:**
- Consumes: `env.POLICIES.get('current')`, `env.IOS_READ_TOKEN`, and URL query parameter `token`.
- Produces: `GET /v1/ios-policy?token=<IOS_READ_TOKEN>` returning `Response` with stored policy text.
- Preserves: `subscription(url, env)` and all existing routes exactly as they are.

- [ ] **Step 1: Write failing Worker tests**

Add `IOS_READ_TOKEN: 'ios-read-secret'` to `makeEnv()`, then add these tests:

```js
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
```

- [ ] **Step 2: Run the Worker tests to verify failure**

Run: `node --test worker/test/worker.test.js`

Expected: the three new tests fail with `404` because `/v1/ios-policy` is not dispatched yet.

- [ ] **Step 3: Implement the minimal read-only handler**

Add this function below `subscription` in `worker/src/index.js`:

```js
async function iosPolicy(url, env) {
  if (!env.IOS_READ_TOKEN || url.searchParams.get('token') !== env.IOS_READ_TOKEN) return unauthorized();

  const content = await env.POLICIES.get('current');
  if (content === null) return new Response('Not Found', { status: 404 });
  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
    },
  });
}
```

Then add this exact branch before the existing `/v1/status` branch:

```js
if (request.method === 'GET' && url.pathname === '/v1/ios-policy') return iosPolicy(url, env);
```

- [ ] **Step 4: Run Worker tests to verify success**

Run: `node --test worker/test/worker.test.js`

Expected: all Worker tests pass; existing subscription tests still require `READ_TOKEN`, while the iOS test requires only `IOS_READ_TOKEN`.

- [ ] **Step 5: Commit the isolated Worker route**

```bash
git add worker/src/index.js worker/test/worker.test.js
git commit -m "feat: add protected iOS policy endpoint"
```

## Task 2: Publish an isolated iOS Surge module and test its safety boundary

**Files:**
- Create: `src/surge/ios-ip-labeler.sgmodule`
- Create: `site/ios-ip-labeler.sgmodule`
- Modify: `test/module-metadata.test.js`
- Modify: `test/site-publish.test.js`

**Interfaces:**
- Consumes: locally supplied `ios_read_token` module argument.
- Produces: one `Proxy Group` named `🧪 IP 标签 iOS` with `policy-path` at the dedicated custom-domain endpoint.
- Does not produce: scripts, cron jobs, `🔄 手动切换`, source subscription URLs, or write credentials.

- [ ] **Step 1: Write failing module artifact tests**

In `test/published-artifacts.test.js`, replace the credential assertion inside the artifact loop with this placeholder-aware version before adding the new module:

```js
const sensitiveAssignment = /\b(?:password|uuid|token)=(?!%ios_read_token%(?:,|\s|$))/i;
assert.doesNotMatch(content, sensitiveAssignment, `${path} exposes a credential parameter`);
```

This permits exactly the inert module placeholder `token=%ios_read_token%` and continues to reject every real token assignment.

Append this source-module test in `test/module-metadata.test.js`:

```js
const iosModulePath = new URL('../src/surge/ios-ip-labeler.sgmodule', import.meta.url);

test('defines an isolated iOS policy test group with a local token placeholder', async () => {
  const moduleText = await readFile(iosModulePath, 'utf8');

  assert.match(moduleText, /^#!arguments=ios_read_token=REQUIRED_IOS_READ_TOKEN$/m);
  assert.match(moduleText, /^\[Proxy Group\]$/m);
  assert.match(
    moduleText,
    /^🧪 IP 标签 iOS = select, policy-path=https:\/\/WORKER\/v1\/ios-policy\?token=%ios_read_token%, update-interval=3600$/m,
  );
  assert.doesNotMatch(moduleText, /🔄 手动切换|\[Script\]|SYNC_TOKEN|READ_TOKEN/);
});
```

Append this Pages artifact test in `test/site-publish.test.js`:

```js
test('publishes an isolated iOS test module through the custom domain', async () => {
  const iosModule = await readFile(new URL('../site/ios-ip-labeler.sgmodule', import.meta.url), 'utf8');

  assert.match(iosModule, /^#!arguments=ios_read_token=REQUIRED_IOS_READ_TOKEN$/m);
  assert.match(
    iosModule,
    /^🧪 IP 标签 iOS = select, policy-path=https:\/\/ip-labeler\.renjiahang1201\.xyz\/v1\/ios-policy\?token=%ios_read_token%, update-interval=3600$/m,
  );
  assert.doesNotMatch(iosModule, /\[Script\]|🔄 手动切换|SYNC_TOKEN|READ_TOKEN/);
});
```

- [ ] **Step 2: Run module publication tests to verify failure**

Run: `node --test test/module-metadata.test.js test/site-publish.test.js`

Expected: FAIL with `ENOENT` for the two new module files.

- [ ] **Step 3: Create the source module**

Create `src/surge/ios-ip-labeler.sgmodule` with exactly:

```ini
#!name=Surge IP Labeler iOS
#!desc=Adds an isolated IP-labelled policy group for Surge iOS testing.
#!arguments=ios_read_token=REQUIRED_IOS_READ_TOKEN

[Proxy Group]
🧪 IP 标签 iOS = select, policy-path=https://WORKER/v1/ios-policy?token=%ios_read_token%, update-interval=3600
```

- [ ] **Step 4: Create the Pages module**

Create `site/ios-ip-labeler.sgmodule` with exactly:

```ini
#!name=Surge IP Labeler iOS
#!desc=Adds an isolated IP-labelled policy group for Surge iOS testing.
#!arguments=ios_read_token=REQUIRED_IOS_READ_TOKEN

[Proxy Group]
🧪 IP 标签 iOS = select, policy-path=https://ip-labeler.renjiahang1201.xyz/v1/ios-policy?token=%ios_read_token%, update-interval=3600
```

- [ ] **Step 5: Run module publication tests to verify success**

Run: `node --test test/module-metadata.test.js test/site-publish.test.js test/published-artifacts.test.js`

Expected: PASS. The credential scanner accepts only the literal placeholder but finds no real query token value or source subscription URL.

- [ ] **Step 6: Commit the iOS module artifacts**

```bash
git add src/surge/ios-ip-labeler.sgmodule site/ios-ip-labeler.sgmodule test/module-metadata.test.js test/site-publish.test.js test/published-artifacts.test.js
git commit -m "feat: publish isolated iOS label module"
```

## Task 3: Document provisioning, validation, rollback, and macOS non-impact

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: deployed Worker secret `IOS_READ_TOKEN`, published module URL, and the user-entered local module argument.
- Produces: instructions that let the user test iOS without editing macOS resources or primary policy groups.

- [ ] **Step 1: Add a failing documentation coverage assertion**

Append this test to `test/published-artifacts.test.js`:

```js
test('documents the iOS route as an isolated test group without changing macOS mirroring', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, /## iOS 独立测试/);
  assert.match(readme, /IOS_READ_TOKEN/);
  assert.match(readme, /🧪 IP 标签 iOS/);
  assert.match(readme, /不修改 macOS 的本地镜像/);
  assert.match(readme, /https:\/\/jiahangren\.github\.io\/surge-ip-labeler\/ios-ip-labeler\.sgmodule/);
});
```

- [ ] **Step 2: Run the documentation test to verify failure**

Run: `node --test test/published-artifacts.test.js`

Expected: FAIL because the README has no `iOS 独立测试` section.

- [ ] **Step 3: Add the iOS documentation section**

Insert this section before `## 旧 Worker 方案` in `README.md`:

```markdown
## iOS 独立测试

此流程不修改 macOS 的本地镜像、Keychain、`ip-labels.conf` 或任何现有策略组。

1. 在 Worker 项目目录执行 `wrangler secret put IOS_READ_TOKEN`，为 iPhone 创建一个新的随机读取令牌。不要复用 `READ_TOKEN`，也不要把令牌发到聊天、截图或仓库。
2. 在 Surge iOS 通过 URL 安装模块：`https://jiahangren.github.io/surge-ip-labeler/ios-ip-labeler.sgmodule`。
3. 安装时仅填写 `ios_read_token=你的_iOS_读取令牌`，然后应用模块。模块只创建 `🧪 IP 标签 iOS`，不会改动“手动切换”、自动选优或原订阅。
4. 打开 `🧪 IP 标签 iOS` 并更新外部资源，确认节点名称、完整 IP、评分和延迟测试正常。资源每小时只下载一次已完成快照；不会触发新的 IP 扫描。
5. 若要回退，禁用或删除该模块即可。原有 macOS 本地镜像和策略组不受影响。
```

- [ ] **Step 4: Run all repository tests**

Run: `npm test`

Expected: PASS for all tests, including Worker, module, artifact, scanner, Sub-Store operator, and macOS local-mirror tests.

- [ ] **Step 5: Commit documentation and tests**

```bash
git add README.md test/published-artifacts.test.js
git commit -m "docs: explain isolated iOS label testing"
```

## Task 4: Deploy and perform non-destructive acceptance checks

**Files:**
- Modify: none in the user’s Surge profile, Keychain, LaunchAgent, or macOS mirror files.
- Deploy: `worker/src/index.js` through `wrangler deploy`.
- Publish: GitHub Pages `site/ios-ip-labeler.sgmodule` through the repository’s existing Pages deployment.

**Interfaces:**
- Consumes: a locally configured Worker secret `IOS_READ_TOKEN` entered interactively by the user.
- Produces: the deployed `/v1/ios-policy` route and installable Pages module.

- [ ] **Step 1: Set the Worker iOS-only secret interactively**

Run from `worker/`:

```bash
wrangler secret put IOS_READ_TOKEN
```

Expected: Wrangler prompts for a value. Enter a newly generated secret locally; do not paste it into chat or any file.

- [ ] **Step 2: Deploy the Worker**

Run from `worker/`:

```bash
wrangler deploy
```

Expected: deployment lists the existing `POLICIES` KV binding and succeeds without printing a secret.

- [ ] **Step 3: Deploy Pages artifacts using the existing repository process**

Run:

```bash
git push origin codex/surge-ip-labeler
```

Expected: the existing Pages workflow publishes `site/ios-ip-labeler.sgmodule` at the documented URL. Verify with a browser request to the module URL; do not add a real iOS token to the URL.

- [ ] **Step 4: Verify endpoint behavior without exposing a token**

On the local machine, use a shell variable set only for the current shell:

```bash
read -s IOS_READ_TOKEN; echo
curl --fail --silent --show-error --noproxy '*' \
  "https://ip-labeler.renjiahang1201.xyz/v1/ios-policy?token=${IOS_READ_TOKEN}" \
  -o /private/tmp/surge-ip-labeler-ios-policy.conf
node --input-type=module -e 'import { readFile, writeFile } from "node:fs/promises"; import { buildValidationProfile } from "./src/local/policy-mirror.js"; const content = await readFile("/private/tmp/surge-ip-labeler-ios-policy.conf", "utf8"); await writeFile("/private/tmp/surge-ip-labeler-ios-validation.conf", buildValidationProfile(content));'
surge-cli --check /private/tmp/surge-ip-labeler-ios-validation.conf
unset IOS_READ_TOKEN
```

Expected: curl stores a non-empty policy snapshot and validation succeeds. If validation fails, do not install the iOS module and do not change any macOS file.

- [ ] **Step 5: Install only the iOS test module and verify rollback**

On Surge iOS, install the documented module URL and enter the iOS-only token in the argument prompt. Confirm `🧪 IP 标签 iOS` is present and that existing groups, especially `🔄 手动切换`, are unchanged. Disable the module once to confirm its removal leaves macOS and existing iOS groups untouched; then re-enable it for ongoing testing.

- [ ] **Step 6: Commit final deployment notes only if documentation changed**

```bash
git status --short
```

Expected: no tracked implementation files changed after deployment. Do not commit generated Worker state such as `worker/.wrangler/`.
