import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePolicyFeed, formatLabel, renderPolicyLine } from '../src/shared/policy.js';

test('preserves descriptor exactly while replacing only name', () => {
  const [node] = parsePolicyFeed('HK 01 = trojan, host, 443, password=x, sni=a');

  assert.equal(
    renderPolicyLine(node, 'HK 01 [1.1.1.1] 🟢92 | 原生IP | 住宅 | 人类偏多'),
    'HK 01 [1.1.1.1] 🟢92 | 原生IP | 住宅 | 人类偏多 = trojan, host, 443, password=x, sni=a',
  );
});

test('uses required score thresholds and unknown fallbacks', () => {
  assert.match(
    formatLabel('HK 01', '1.1.1.1', {
      trust_score: 80,
      isResidential: true,
      native: true,
      is_crawler: false,
    }),
    /🟢80/,
  );
  assert.match(formatLabel('HK 01', null, {}), /IP:未知/);
});

test('uses unknown fallbacks when intelligence data is null', () => {
  assert.equal(
    formatLabel('HK 01', null, null),
    'HK 01 [IP:未知] | 评分未知 | 原生未知 | 住宅未知 | 人类未知',
  );
});

test('uses green, yellow, and red score bands without inventing a percentage', () => {
  assert.match(formatLabel('A', '1.1.1.1', { trust_score: 100 }), /🟢100/);
  assert.match(formatLabel('A', '1.1.1.1', { trust_score: 79 }), /🟡79/);
  assert.match(formatLabel('A', '1.1.1.1', { trust_score: 49 }), /🔴49/);
  assert.doesNotMatch(formatLabel('A', '1.1.1.1', {}), /%/);
});

test('maps Net.Coffee datacenter, abuse, crawler, and country-origin signals without inventing data', () => {
  assert.equal(
    formatLabel('IDC', '200.58.105.45', {
      trust_score: 81,
      countryCode: 'ar',
      registered_country_code: 'us',
      is_datacenter: true,
      isResidential: false,
      is_abuser: true,
      is_crawler: true,
    }),
    'IDC [200.58.105.45] | 🟢81 | 广播IP (US) | 机房IP | 历史滥用 | 机器偏多',
  );
  assert.equal(
    formatLabel('住宅', '118.140.56.81', {
      trust_score: 100,
      countryCode: 'hk',
      registered_country_code: 'hk',
      isResidential: true,
      is_vpn: false,
      is_proxy: false,
      is_crawler: false,
    }),
    '住宅 [118.140.56.81] | 🟢100 | 原生IP | 住宅 | 人类偏多',
  );
});

test('preserves blank lines and comments unchanged', () => {
  const nodes = parsePolicyFeed('# curated nodes\n\nHK = ss, host, 443, encrypt-method=aes-128-gcm, password=x');

  assert.equal(renderPolicyLine(nodes[0], 'ignored'), '# curated nodes');
  assert.equal(renderPolicyLine(nodes[1], 'ignored'), '');
  assert.equal(renderPolicyLine(nodes[2], 'HK [1.1.1.1] 🟡60'), 'HK [1.1.1.1] 🟡60 = ss, host, 443, encrypt-method=aes-128-gcm, password=x');
});

test('escapes line breaks in labels so names cannot inject policy lines', () => {
  const [node] = parsePolicyFeed('HK = trojan, host, 443, password=x');

  assert.equal(renderPolicyLine(node, 'HK\nInjected'), 'HK Injected = trojan, host, 443, password=x');
});

test('escapes equals signs in labels so they cannot become policy delimiters', () => {
  const [node] = parsePolicyFeed('HK = trojan, host, 443, password=x');

  assert.equal(renderPolicyLine(node, 'HK=Injected'), 'HK＝Injected = trojan, host, 443, password=x');
});
