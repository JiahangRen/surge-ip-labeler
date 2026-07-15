import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const modulePath = new URL('../src/surge/ip-labeler.sgmodule', import.meta.url);
const iosModulePath = new URL('../src/surge/ios-ip-labeler.sgmodule', import.meta.url);

test('wires Surge module arguments into the cron script invocation', async () => {
  const moduleText = await readFile(modulePath, 'utf8');

  assert.match(moduleText, /^#!arguments=configuration=REQUIRED_CONFIGURATION$/m);
  assert.match(
    moduleText,
    /^surge-ip-labeler = .*script-path=https:\/\/WORKER\/surge-ip-labeler\.js.*argument="%configuration%"/m,
  );
  assert.doesNotMatch(moduleText, /^\[Argument\]$/m);
  assert.doesNotMatch(moduleText, /^#!system=/m);
});

test('defines an isolated iOS policy test group with a local token placeholder', async () => {
  const moduleText = await readFile(iosModulePath, 'utf8');

  assert.match(moduleText, /^#!arguments=ios_read_token=REQUIRED_IOS_READ_TOKEN$/m);
  assert.match(moduleText, /^\[Proxy Group\]$/m);
  assert.match(
    moduleText,
    /^🧪 IP 标签 iOS = select, policy-path=https:\/\/WORKER\/v1\/ios-policy\?token=%ios_read_token%, update-interval=3600$/m,
  );
  assert.doesNotMatch(moduleText, /🔄 手动切换|\[Script\]|SYNC_TOKEN|(?<!IOS_)READ_TOKEN/);
});
