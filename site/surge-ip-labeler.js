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

function normalizedCountryCode(value) {
  return typeof value === 'string' && /^[a-z]{2}$/i.test(value.trim()) ? value.trim().toUpperCase() : '';
}

function formatNative(value, intel) {
  if (value === true) return '原生IP';
  if (value === false) return '非原生IP';
  const country = normalizedCountryCode(getIntelValue(intel, 'countryCode', 'country_code'));
  const registered = normalizedCountryCode(getIntelValue(intel, 'registered_country_code', 'registeredCountryCode'));
  if (country && registered && country !== registered) return `广播IP (${registered})`;
  if (country && country === registered && intel.isResidential === true && intel.is_vpn !== true && intel.is_proxy !== true) return '原生IP';
  return '';
}

function formatResidential(value, intel) {
  if (value === true) return '住宅';
  if (intel.is_datacenter === true || /^(hosting|datacenter)$/i.test(String(intel.company_type || ''))) return '机房IP';
  if (value === false) return '非住宅';
  return '';
}

function formatHuman(value) {
  if (value === true) return '机器偏多';
  if (value === false) return '人类偏多';
  return '';
}

function hasAbuseHistory(intel) {
  if (intel.is_abuser === true) return true;
  return ['medium', 'high', 'critical', 'severe'].includes(String(intel.intelligence?.abuser_level || intel.abuser_level || '').toLowerCase());
}

function formatGptScore(intel) {
  const verdict = intel.ai_verdict;
  if (!verdict || typeof verdict !== 'object') return '';
  const confidence = Number(verdict.confidence);
  const label = typeof verdict.label === 'string' ? verdict.label.trim() : '';
  if (!Number.isFinite(confidence)) return '';
  const display = Number.isInteger(confidence) ? String(confidence) : String(confidence);
  return label ? `GPT评分:${display} (${label})` : `GPT评分:${display}`;
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
  const labels = [
    `${sanitizeName(name)} [${ip}]`,
    formatScore(getIntelValue(intelData, 'trust_score', 'trustScore', 'score')),
    formatNative(getIntelValue(intelData, 'native', 'is_native', 'isNative'), intelData),
    formatResidential(getIntelValue(intelData, 'isResidential', 'is_residential', 'residential'), intelData),
  ];
  if (hasAbuseHistory(intelData)) labels.push('历史滥用');
  labels.push(formatHuman(getIntelValue(intelData, 'is_crawler', 'isCrawler', 'crawler')));
  labels.push(formatGptScore(intelData));
  return labels.filter(Boolean).join(' | ');
}

function renderPolicyLine(node, label) {
  if (node.type !== 'policy') return node.line;
  return `${sanitizeName(label)}${node.separator}${node.descriptor}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const SCHEDULE_KEY = 'nextScanAt:v2';
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
  await deps.sleep(500 + Math.floor(deps.random() * 250));
  return deps.fetch(`${NET_COFFEE_URL}${encodeURIComponent(ip)}`, { timeout: 10 });
}

function failedLabel(node) {
  return `${node.name} [检测失败] | 评分未知`;
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

async function runScheduledScan(dependencies) {
  const { store, now } = dependencies;
  if (Number(store.get(SCHEDULE_KEY)) > now()) return { skipped: true };

  try {
    dependencies.onStart?.();
    const result = await runScan(dependencies);
    store.set(SCHEDULE_KEY, now() + SIX_HOURS_MS);
    return result;
  } catch (error) {
    store.set(SCHEDULE_KEY, now() + RETRY_MS);
    throw error;
  }
}

function formatScanError(error) {
  const message = String(error?.message || '');
  if (message === 'source_url is required') return '未读取到模块 configuration';
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

function notifyScanStart() {
  console.log('[Surge IP Labeler] 开始扫描');
  if (typeof $notification !== 'undefined') $notification.post('Surge IP Labeler', '开始扫描', '正在拉取订阅并检测出口 IP');
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
  return runScheduledScan({
    sourceUrl: args.source_url,
    store: surgeStore(),
    fetch: surgeGet,
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now: () => Date.now(),
    random: Math.random,
    onStart: notifyScanStart,
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
  runInSurge().then(() => $done()).catch((error) => {
    notifyScanError(error);
    $done();
  });
}
