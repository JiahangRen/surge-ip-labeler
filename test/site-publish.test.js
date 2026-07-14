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
  assert.match(moduleText, new RegExp(`^surge-ip-labeler = type=cron, cronexp="\\* \\* \\* \\* \\*", script-path=${baseUrl}/surge-ip-labeler\\.js\\?rev=3b39fd8.*argument="%configuration%"`, 'm'));
  assert.doesNotMatch(moduleText, /type=generic/);
  assert.doesNotMatch(scriptText, /^import\s/m);
  assert.match(scriptText, /\$notification\.post\('Surge IP Labeler', '扫描失败', message\)/);
  assert.match(scriptText, /\$notification\.post\('Surge IP Labeler', '开始扫描', '正在拉取订阅并检测出口 IP'\)/);
  assert.match(scriptText, /runInSurge\(\)\.then\(\(\) => \$done\(\)\)\.catch\(\(error\) =>/);
});
