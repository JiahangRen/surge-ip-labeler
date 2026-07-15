import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const siteDirectory = new URL('../site/', import.meta.url);

async function readPublishedArtifacts(directory = siteDirectory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const artifacts = await Promise.all(entries.map(async (entry) => {
    const path = new URL(entry.name, directory);
    if (entry.isDirectory()) return readPublishedArtifacts(new URL(`${entry.name}/`, directory));
    return [{ path: join(directory.pathname, entry.name), content: await readFile(path, 'utf8') }];
  }));
  return artifacts.flat();
}

test('published artifacts contain no credentials or real source subscription URLs', async () => {
  const artifacts = await readPublishedArtifacts();

  assert.ok(artifacts.some(({ path }) => path.endsWith('/index.html')), 'site must provide an index page');
  const subStoreScript = artifacts.find(({ path }) => path.endsWith('/substore-ip-labeler.js'));
  assert.ok(subStoreScript, 'site must publish the Sub-Store operator');
  assert.match(subStoreScript.content, /async function operator\(proxies = \[\]/);
  assert.doesNotMatch(subStoreScript.content, /^import\s/m);
  assert.match(subStoreScript.content, /sync_url/);
  assert.match(subStoreScript.content, /sync_token/);
  assert.match(subStoreScript.content, /ProxyUtils\.produce\(proxies, 'Surge'\)/);
  for (const { path, content } of artifacts) {
    assert.doesNotMatch(
      content,
      /\b(?:password|uuid|token)=(?!%ios_read_token%(?:,|\s|$))/i,
      `${path} exposes a credential parameter`,
    );
    assert.doesNotMatch(
      content,
      /\bsource_url=https?:\/\/(?!example\.com(?:\/|$)|[^/]+\.invalid(?:\/|$))/i,
      `${path} embeds a real source subscription URL`,
    );
  }
});

test('documents the iOS route as an isolated test group without changing macOS mirroring', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, /## iOS 独立测试/);
  assert.match(readme, /IOS_READ_TOKEN/);
  assert.match(readme, /🧪 IP 标签 iOS/);
  assert.match(readme, /不修改 macOS 的本地镜像/);
  assert.match(readme, /https:\/\/jiahangren\.github\.io\/surge-ip-labeler\/ios-ip-labeler\.sgmodule/);
});
