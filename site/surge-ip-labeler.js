function isPolicyLine(line) {
  const trimmed = line.trim();
  return trimmed.length > 0 && !trimmed.startsWith('#') && !trimmed.startsWith(';');
}

function sanitizeName(value) {
  return String(value).replace(/[\r\n]+/g, ' ').replaceAll('=', '＝').trim();
}

function getIntelValue(intel, ...keys) {
  for (const key of keys) {
    if (intel[key] !== undefined && intel[key] !== null) return intel[key];
  }
  return undefined;
}

function formatScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 100) return '评分未知';
  if (score >= 80) return `🟢${score}`;
  if (score >= 50) return `🟡${score}`;
  return `🔴${score}`;
}

function formatNative(value) {
  if (value === true) return '原生IP';
  if (value === false) return '非原生IP';
  return '原生未知';
}

function formatResidential(value) {
  if (value === true) return '住宅';
  if (value === false) return '非住宅';
  return '住宅未知';
}

function formatHuman(value) {
  if (value === true) return '爬虫偏多';
  if (value === false) return '人类偏多';
  return '人类未知';
}

function parsePolicyFeed(text) {
  return String(text).split(/\r\n|\n|\r/).map((line) => {
    if (!isPolicyLine(line)) return { type: 'preserved', line };
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) return { type: 'preserved', line };
    const originalName = line.slice(0, separatorIndex).trim();
    const descriptor = line.slice(separatorIndex + 1);
    if (!originalName || !descriptor.trim()) return { type: 'preserved', line };
    const nameStart = line.indexOf(originalName);
    return { type: 'policy', name: originalName, descriptor, separator: line.slice(nameStart + originalName.length, separatorIndex + 1) };
  });
}

function formatLabel(name, exitIp, intel = {}) {
  const ip = typeof exitIp === 'string' && exitIp.trim() ? exitIp.trim() : 'IP:未知';
  const intelData = intel !== null && typeof intel === 'object' ? intel : {};
  return [
    `${sanitizeName(name)} [${ip}]`,
    formatScore(getIntelValue(intelData, 'trust_score', 'trustScore', 'score')),
    formatNative(getIntelValue(intelData, 'native', 'is_native', 'isNative')),
    formatResidential(getIntelValue(intelData, 'isResidential', 'is_residential', 'residential')),
    formatHuman(getIntelValue(intelData, 'is_crawler', 'isCrawler', 'crawler')),
  ].join(' | ');
}

function renderPolicyLine(node, label) {
  if (node.type !== 'policy') return node.line;
  return `${sanitizeName(label)}${node.separator}${node.descriptor}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const IP_ECHO_URL = 'https://api.ipify.org';
const NET_COFFEE_URL = 'https://ip.net.coffee/api/ip/lookup/';

function parseStoredValue(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return undefined; }
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
  } catch { return {}; }
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

async function runScan(dependencies) {
  const deps = { ipEchoUrl: IP_ECHO_URL, ...dependencies };
  if (!deps.sourceUrl) throw new Error('source_url is required');
  if (Number(deps.store.get('blockedUntil')) > deps.now()) throw new Error('scan deferred by circuit breaker');

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
      const cached = parseStoredValue(deps.store.get(`ip:${ip}`));
      if (cached?.expiresAt > deps.now() && cached.intel && typeof cached.intel === 'object') {
        intel = cached.intel;
      } else {
        try {
          const lookup = await lookupIntel(deps, ip);
          if (isBreakerResponse(lookup.status)) {
            deps.store.set('blockedUntil', deps.now() + DAY_MS);
            throw breakerError(lookup.status);
          }
          intel = lookup.status >= 200 && lookup.status < 300 ? parseIntel(responseBody(lookup)) : {};
          consecutiveTimeouts = 0;
          deps.store.set(`ip:${ip}`, { expiresAt: deps.now() + DAY_MS, intel });
        } catch (error) {
          if (isTimeout(error)) consecutiveTimeouts += 1;
          if (consecutiveTimeouts >= 2) {
            deps.store.set('blockedUntil', deps.now() + DAY_MS);
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

async function runInSurge(argument = $argument) {
  const args = parseArguments(argument);
  return runScan({
    sourceUrl: args.source_url,
    store: surgeStore(),
    fetch: surgeGet,
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now: () => Date.now(),
    random: Math.random,
    upload: args.upload_url && args.upload_token ? async (content, result) => new Promise((resolve, reject) => {
      $httpClient.post({
        url: args.upload_url,
        headers: { Authorization: `Bearer ${args.upload_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, updatedAt: new Date().toISOString(), summary: result.summary }),
      }, (error, response) => error || response.status < 200 || response.status >= 300 ? reject(error || new Error('upload failed')) : resolve());
    }) : undefined,
  });
}

if (typeof $httpClient !== 'undefined') {
  runInSurge().then(() => $done()).catch(() => $done());
}
