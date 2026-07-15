import test from 'node:test';
import assert from 'node:assert/strict';

import { downloadSnapshot } from '../src/local/download.js';

test('never includes a signed subscription URL when curl fails', async () => {
  await assert.rejects(
    downloadSnapshot({
      url: 'https://example.test/v1/subscription?token=secret-value',
      runCurl: async () => { throw new Error('curl --url https://example.test/?token=secret-value timed out'); },
    }),
    (error) => {
      assert.match(error.message, /Worker subscription download failed/);
      assert.doesNotMatch(error.message, /secret-value/);
      return true;
    },
  );
});

test('returns curl standard output on a successful download', async () => {
  const output = await downloadSnapshot({
    url: 'https://example.test/v1/subscription?token=secret-value',
    runCurl: async (args) => {
      assert.equal(args.at(-1), 'https://example.test/v1/subscription?token=secret-value');
      return { stdout: '节点 = ss, host, 443' };
    },
  });

  assert.equal(output, '节点 = ss, host, 443');
});
