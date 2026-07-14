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
  for (const { path, content } of artifacts) {
    assert.doesNotMatch(content, /\b(?:password|uuid|token)=/i, `${path} exposes a credential parameter`);
    assert.doesNotMatch(
      content,
      /\bsource_url=https?:\/\/(?!example\.com(?:\/|$)|[^/]+\.invalid(?:\/|$))/i,
      `${path} embeds a real source subscription URL`,
    );
  }
});
