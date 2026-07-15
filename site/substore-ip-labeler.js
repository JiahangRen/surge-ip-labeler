/**
 * Sub-Store Script Operator for Surge-ability.
 * Add this URL as a Script Operator in Sub-Store, then export the collection
 * as Surge. It does not need a Worker or a separate Surge cron module.
 */
const $ = $substore;
const CACHE_TTL = 24 * 60 * 60 * 1000;
const EXIT_IP_URL = 'http://ip-api.com/json?fields=status,query';
const INTEL_URL = 'https://ip.net.coffee/api/ip/lookup/';
const concurrency = Math.min(10, Math.max(1, Number($arguments?.limit) || 5));
const syncUrl = String($arguments?.sync_url || '').trim();
const syncToken = String($arguments?.sync_token || '').trim();

function value(intel, ...keys) {
  for (const key of keys) if (intel?.[key] !== undefined && intel[key] !== null) return intel[key];
  return undefined;
}

function score(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) return '评分未知';
  if (number >= 80) return `🟢${number}`;
  if (number >= 50) return `🟡${number}`;
  return `🔴${number}`;
}

function countryCode(value) {
  return typeof value === 'string' && /^[a-z]{2}$/i.test(value.trim()) ? value.trim().toUpperCase() : '';
}

function nativeLabel(native, intel) {
  if (native === true) return '原生IP';
  if (native === false) return '非原生IP';
  const country = countryCode(value(intel, 'countryCode', 'country_code'));
  const registered = countryCode(value(intel, 'registered_country_code', 'registeredCountryCode'));
  if (country && registered && country !== registered) return `广播IP (${registered})`;
  if (country && country === registered && intel?.isResidential === true && intel?.is_vpn !== true && intel?.is_proxy !== true) return '原生IP';
  return '';
}

function residentialLabel(residential, intel) {
  if (residential === true) return '住宅';
  if (intel?.is_datacenter === true || /^(hosting|datacenter)$/i.test(String(intel?.company_type || ''))) return '机房IP';
  if (residential === false) return '非住宅';
  return '';
}

function abuseHistory(intel) {
  if (intel?.is_abuser === true) return true;
  return ['medium', 'high', 'critical', 'severe'].includes(String(intel?.intelligence?.abuser_level || intel?.abuser_level || '').toLowerCase());
}

function gptScore(intel) {
  const confidence = Number(intel?.ai_verdict?.confidence);
  const verdict = typeof intel?.ai_verdict?.label === 'string' ? intel.ai_verdict.label.trim() : '';
  if (!Number.isFinite(confidence)) return '';
  const display = Number.isInteger(confidence) ? String(confidence) : String(confidence);
  return verdict ? `GPT评分:${display} (${verdict})` : `GPT评分:${display}`;
}

function label(name, ip, intel) {
  const native = value(intel, 'native', 'is_native', 'isNative');
  const residential = value(intel, 'isResidential', 'is_residential', 'residential');
  const crawler = value(intel, 'is_crawler', 'isCrawler', 'crawler');
  const labels = [
    `${String(name).replace(/[\r\n]+/g, ' ').replaceAll('=', '＝').trim()} [${ip}]`,
    score(value(intel, 'trust_score', 'trustScore', 'score')),
    nativeLabel(native, intel),
    residentialLabel(residential, intel),
  ];
  if (abuseHistory(intel)) labels.push('历史滥用');
  labels.push(crawler === true ? '机器偏多' : crawler === false ? '人类偏多' : '');
  labels.push(gptScore(intel));
  return labels.filter(Boolean).join(' | ');
}

function status(name, message) {
  return `${String(name).replace(/[\r\n]+/g, ' ').replaceAll('=', '＝').trim()} [${message}] | 评分未知`;
}

function parseIntel(body) {
  try {
    const parsed = JSON.parse(String(body || ''));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function parseExitIp(body) {
  const text = String(body || '').trim();
  try {
    const parsed = JSON.parse(text);
    return parsed?.status === 'success' && typeof parsed.query === 'string' ? parsed.query.trim() : '';
  } catch {
    return text;
  }
}

async function operator(proxies = []) {
  if (!$.env.isSurge) throw new Error('此操作脚本仅适用于 Sub-Store 的 Surge-ability 模块');

  const cache = scriptResourceCache;
  const pendingIntel = new Map();
  let cursor = 0;

  async function getIntel(ip) {
    if (pendingIntel.has(ip)) return pendingIntel.get(ip);
    const task = (async () => {
      const key = `surge-ip-labeler:intel:${ip}`;
      const cached = cache.get(key);
      if (cached?.expiresAt > Date.now() && cached.intel) return cached.intel;
      const response = await $.http.get({ url: `${INTEL_URL}${encodeURIComponent(ip)}`, timeout: 10000 });
      const intel = parseIntel(response.body);
      cache.set(key, { expiresAt: Date.now() + CACHE_TTL, intel });
      return intel;
    })();
    pendingIntel.set(ip, task);
    return task;
  }

  async function inspect(proxy) {
    const original = proxy.name || '未命名节点';
    let descriptor;
    try {
      descriptor = ProxyUtils.produce([proxy], 'Surge');
    } catch {
      proxy.name = status(original, '节点描述符失败');
      return proxy;
    }
    if (!descriptor) {
      proxy.name = status(original, '节点描述符失败');
      return proxy;
    }

    let response;
    try {
      response = await $.http.get({
        url: EXIT_IP_URL,
        node: descriptor,
        'policy-descriptor': descriptor,
        timeout: 10000,
      });
    } catch {
      proxy.name = status(original, '出口请求失败');
      return proxy;
    }

    const ip = parseExitIp(response?.body);
    if (!ip) {
      proxy.name = status(original, '出口响应无IP');
      return proxy;
    }

    try {
      proxy.name = label(original, ip, await getIntel(ip));
    } catch {
      proxy.name = label(original, ip, {});
    }
    return proxy;
  }

  async function uploadSnapshot() {
    if (!syncUrl && !syncToken) return;
    if (!syncUrl || !syncToken) throw new Error('同步配置不完整');

    const rendered = ProxyUtils.produce(proxies, 'Surge');
    const content = (Array.isArray(rendered) ? rendered.join('\n') : String(rendered || '')).trim();
    if (!content) throw new Error('无法生成 Surge 节点文本');

    const failedCount = proxies.filter((proxy) => /\[(节点描述符失败|出口请求失败|出口响应无IP)\]/.test(String(proxy.name))).length;
    await $.http.post({
      url: syncUrl,
      headers: {
        Authorization: `Bearer ${syncToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content,
        updatedAt: new Date().toISOString(),
        summary: { nodeCount: proxies.length, failedCount },
      }),
      timeout: 10000,
    });
  }

  const workers = Array.from({ length: Math.min(concurrency, proxies.length) }, async () => {
    while (cursor < proxies.length) await inspect(proxies[cursor++]);
  });
  await Promise.all(workers);
  await uploadSnapshot();
  return proxies;
}
