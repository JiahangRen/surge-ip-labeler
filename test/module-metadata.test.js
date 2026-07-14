import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const modulePath = new URL('../src/surge/ip-labeler.sgmodule', import.meta.url);

test('wires Surge module arguments into the cron script invocation', async () => {
  const moduleText = await readFile(modulePath, 'utf8');

  assert.match(moduleText, /^#!arguments=source_url=REQUIRED_SOURCE_URL&upload_url=REQUIRED_UPLOAD_URL&upload_token=REQUIRED_SYNC_TOKEN$/m);
  assert.match(
    moduleText,
    /^surge-ip-labeler = .*script-path=https:\/\/WORKER\/surge-ip-labeler\.js.*argument="source_url=%source_url%&upload_url=%upload_url%&upload_token=%upload_token%"/m,
  );
  assert.doesNotMatch(moduleText, /^\[Argument\]$/m);
  assert.doesNotMatch(moduleText, /^#!system=/m);
});
