import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const modulePath = new URL('../site/module.sgmodule', import.meta.url);
const scriptPath = new URL('../site/surge-ip-labeler.js', import.meta.url);
const baseUrl = 'https://jiahangren.github.io/surge-ip-labeler';

test('publishes a self-contained Surge module and script at the GitHub Pages URLs', async () => {
  const [moduleText, scriptText] = await Promise.all([
    readFile(modulePath, 'utf8'),
    readFile(scriptPath, 'utf8'),
  ]);

  assert.match(moduleText, /^#!arguments=configuration=REQUIRED_CONFIGURATION$/m);
  assert.match(moduleText, new RegExp(`^surge-ip-labeler = .*script-path=${baseUrl}/surge-ip-labeler\\.js\\?rev=20e5e01.*argument="%configuration%"`, 'm'));
  assert.doesNotMatch(scriptText, /^import\s/m);
  assert.match(scriptText, /runInSurge\(\)\.then\(\(\) => \$done\(\)\)\.catch\(\(\) => \$done\(\)\)/);
});
