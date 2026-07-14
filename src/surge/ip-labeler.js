import { formatLabel, parsePolicyFeed, renderPolicyLine } from '../shared/policy.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const IP_ECHO_URL = 'https://api.ipify.org';
const NET_COFFEE_URL = 'https://ip.net.coffee/api/ip/lookup/';

function parseStoredValue(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function getStoreValue(store, key) {
  return parseStoredValue(store.get(key));
}

function setStoreValue(store, key, value) {
  store.set(key, value);
}

function responseBody(response) {
  return typeof response?.body === 'string' ? response.body : '';
}

function isBreakerResponse(status) {
  return status === 403 || status === 429 || (status >= 500 && status <= 599);
}

function breakerError(status) {
  if (status === 429) return new Error('rate limited by Net.Coffee');
  if (status === 403) return new Error('blocked by Net.Coffee');
  return new Error('Net.Coffee service unavailable');
}

function parseIntel(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function isTimeout(error) {
  return error?.name === 'TimeoutError' || /timeout/i.test(String(error?.message || error));
}

async function lookupIntel(deps, ip) {
  await deps.sleep(3000 + Math.floor(deps.random() * 1000));
  return deps.fetch(`${NET_COFFEE_URL}${encodeURIComponent(ip)}`, { timeout: 10 });
}

function failedLabel(node) {
  return `${node.name} [检测失败] | 评分未知 | 原生未知 | 住宅未知 | 人类未知`;
}

/**
 * Scan a Surge policy feed using injected dependencies.
 *
 * Required dependencies: sourceUrl, fetch(url, options), store.get/set, sleep,
 * now, and random. An optional upload(content, result) runs only after a fully
 * completed scan.
 */
export async function runScan(dependencies) {
  const deps = { ipEchoUrl: IP_ECHO_URL, ...dependencies };
  if (!deps.sourceUrl) throw new Error('source_url is required');
  if (Number(getStoreValue(deps.store, 'blockedUntil')) > deps.now()) {
    throw new Error('scan deferred by circuit breaker');
  }

  const source = await deps.fetch(deps.sourceUrl, { timeout: 30 });
  if (source.status < 200 || source.status >= 300) throw new Error('unable to fetch source feed');

  const nodes = parsePolicyFeed(responseBody(source));
  const intelByIp = new Map();
  let consecutiveTimeouts = 0;
  const lines = [];
  let failedCount = 0;

  for (const node of nodes) {
    if (node.type !== 'policy') {
      lines.push(renderPolicyLine(node, ''));
      continue;
    }

    let ip;
    try {
      const echo = await deps.fetch(deps.ipEchoUrl, { 'policy-descriptor': node.descriptor.trim(), timeout: 10 });
      ip = echo.status >= 200 && echo.status < 300 ? responseBody(echo).trim() : '';
    } catch {
      failedCount += 1;
      lines.push(renderPolicyLine(node, failedLabel(node)));
      continue;
    }

    if (!ip) {
      failedCount += 1;
      lines.push(renderPolicyLine(node, failedLabel(node)));
      continue;
    }

    let intel = intelByIp.get(ip);
    if (intel === undefined) {
      const cached = getStoreValue(deps.store, `ip:${ip}`);
      if (cached?.expiresAt > deps.now() && cached.intel && typeof cached.intel === 'object') {
        intel = cached.intel;
      } else {
        try {
          const lookup = await lookupIntel(deps, ip);
          if (isBreakerResponse(lookup.status)) {
            setStoreValue(deps.store, 'blockedUntil', deps.now() + DAY_MS);
            throw breakerError(lookup.status);
          }
          intel = lookup.status >= 200 && lookup.status < 300 ? parseIntel(responseBody(lookup)) : {};
          consecutiveTimeouts = 0;
          setStoreValue(deps.store, `ip:${ip}`, { expiresAt: deps.now() + DAY_MS, intel });
        } catch (error) {
          if (isBreakerResponse(error?.status)) {
            setStoreValue(deps.store, 'blockedUntil', deps.now() + DAY_MS);
          }
          if (isTimeout(error)) consecutiveTimeouts += 1;
          if (consecutiveTimeouts >= 2) {
            setStoreValue(deps.store, 'blockedUntil', deps.now() + DAY_MS);
            throw new Error('repeated Net.Coffee timeout');
          }
          if (error?.message && /rate limited|blocked by|service unavailable/.test(error.message)) throw error;
          intel = {};
        }
      }
      intelByIp.set(ip, intel);
    }

    lines.push(renderPolicyLine(node, formatLabel(node.name, ip, intel)));
  }

  const result = {
    lines,
    content: lines.join('\n'),
    summary: { nodeCount: nodes.filter((node) => node.type === 'policy').length, failedCount },
  };
  if (deps.upload) await deps.upload(result.content, result);
  return result;
}

/**
 * Run a scan only when the local six-hour schedule is due. The module invokes
 * this every minute so a newly installed configuration starts promptly.
 */
export async function runScheduledScan(dependencies) {
  const { store, now } = dependencies;
  if (Number(getStoreValue(store, 'nextScanAt')) > now()) return { skipped: true };

  try {
    return await runScan(dependencies);
  } finally {
    setStoreValue(store, 'nextScanAt', now() + SIX_HOURS_MS);
  }
}

export function formatScanError(error) {
  const message = String(error?.message || '');
  if (message === 'unable to fetch source feed') return '无法拉取 Sub-Store 订阅';
  if (message === 'upload failed') return '无法上传结果：请检查 SYNC_TOKEN';
  if (/rate limited|blocked by|service unavailable|repeated Net\.Coffee timeout/.test(message)) {
    return 'Net.Coffee 暂时限流，已暂停扫描';
  }
  return '扫描未完成，请查看 Surge 日志';
}

function notifyScanError(error) {
  const message = formatScanError(error);
  console.log(`[Surge IP Labeler] ${message}`);
  if (typeof $notification !== 'undefined') $notification.post('Surge IP Labeler', '扫描失败', message);
}

function surgeGet(url, options) {
  return new Promise((resolve, reject) => {
    $httpClient.get({ url, ...options }, (error, response, body) => {
      if (error) return reject(error);
      resolve({ status: response.status, body });
    });
  });
}

function surgeStore() {
  return {
    get(key) { return parseStoredValue($persistentStore.read(key)); },
    set(key, value) { return $persistentStore.write(JSON.stringify(value), key); },
  };
}

function parseArguments(argument) {
  return String(argument || '').split('&').reduce((values, pair) => {
    const [key, ...parts] = pair.split('=');
    if (key) values[decodeURIComponent(key)] = decodeURIComponent(parts.join('='));
    return values;
  }, {});
}

export async function runInSurge(argument = $argument) {
  const args = parseArguments(argument);
  const store = surgeStore();
  return runScheduledScan({
    sourceUrl: args.source_url,
    store,
    fetch: surgeGet,
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now: () => Date.now(),
    random: Math.random,
    upload: args.upload_url && args.upload_token ? async (content, result) => {
      await new Promise((resolve, reject) => {
        $httpClient.post({
          url: args.upload_url,
          headers: { Authorization: `Bearer ${args.upload_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, updatedAt: new Date().toISOString(), summary: result.summary }),
        }, (error, response) => error || response.status < 200 || response.status >= 300 ? reject(error || new Error('upload failed')) : resolve());
      });
    } : undefined,
  });
}

if (typeof $httpClient !== 'undefined') {
  runInSurge().then(() => $done()).catch((error) => {
    notifyScanError(error);
    $done();
  });
}
