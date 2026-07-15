#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { buildValidationProfile, syncSnapshot } from '../src/local/policy-mirror.js';
import { downloadSnapshot } from '../src/local/download.js';

const execFileAsync = promisify(execFile);
const DEFAULT_ENDPOINT = 'https://ip-labeler.renjiahang1201.xyz/v1/subscription';
const DEFAULT_SERVICE = 'surge-ip-labeler-read-token';

function usage() {
  return `Usage: node scripts/sync-local-policy-file.mjs --output <ip-labels.conf> [options]

Options:
  --endpoint <url>       Worker subscription endpoint (default: ${DEFAULT_ENDPOINT})
  --keychain-service <s> macOS Keychain service (default: ${DEFAULT_SERVICE})
  --surge-cli <path>     surge-cli executable (default: /opt/homebrew/bin/surge-cli)
`;
}

function readArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--help' || key === '-h') args.help = true;
    else if (key.startsWith('--')) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`missing value for ${key}`);
      args[key.slice(2)] = value;
      index += 1;
    } else throw new Error(`unexpected argument: ${key}`);
  }
  return args;
}

async function keychainToken(service) {
  const { stdout } = await execFileAsync('/usr/bin/security', [
    'find-generic-password',
    '-a', process.env.USER || process.env.LOGNAME || '',
    '-s', service,
    '-w',
  ]);
  const token = stdout.trim();
  if (!token) throw new Error(`no token found in macOS Keychain service: ${service}`);
  return token;
}

async function validateWithSurge(surgeCli, profile) {
  const dir = await mkdtemp(join(tmpdir(), 'surge-ip-labeler-'));
  const candidate = join(dir, 'validate.conf');
  try {
    await writeFile(candidate, profile, { encoding: 'utf8', mode: 0o600 });
    await execFileAsync(surgeCli, ['--check', candidate], { maxBuffer: 1024 * 1024 });
    return { ok: true };
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || 'unknown validation error').trim();
    return { ok: false, error: `surge-cli validation failed: ${detail}` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeAtomic(outputPath, content) {
  const dir = dirname(outputPath);
  const temp = join(dir, `.${outputPath.split('/').pop()}.new-${process.pid}`);
  await writeFile(temp, content, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, outputPath);
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  if (!args.output) throw new Error('--output is required');

  const endpoint = args.endpoint || DEFAULT_ENDPOINT;
  const surgeCli = args['surge-cli'] || '/opt/homebrew/bin/surge-cli';
  const token = await keychainToken(args['keychain-service'] || DEFAULT_SERVICE);
  const url = new URL(endpoint);
  url.searchParams.set('token', token);

  const result = await syncSnapshot({
    fetchSnapshot: async () => {
      return downloadSnapshot({
        url: url.toString(),
        runCurl: (curlArgs) => execFileAsync('/usr/bin/curl', curlArgs, { maxBuffer: 16 * 1024 * 1024 }),
      });
    },
    validate: async (profile) => validateWithSurge(surgeCli, profile),
    writeAtomic,
    outputPath: args.output,
  });
  process.stdout.write(`Updated ${args.output} with ${result.policyCount} labelled policies.\n`);
}

main().catch((error) => {
  process.stderr.write(`IP label mirror failed: ${error.message}\n`);
  process.exitCode = 1;
});

export { buildValidationProfile, readArgs, validateWithSurge, writeAtomic };
