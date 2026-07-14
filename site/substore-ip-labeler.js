/**
 * Sub-Store Script Operator for Surge-ability.
 * Add this URL as a Script Operator in Sub-Store, then export the collection
 * as Surge. It does not need a Worker or a separate Surge cron module.
 */
const $ = $substore;
const CACHE_TTL = 24 * 60 * 60 * 1000;
const EXIT_IP_URL = 'https://api.ipify.org';
const INTEL_URL = 'https://ip.net.coffee/api/ip/lookup/';
const concurrency = Math.min(10, Math.max(1, Number($arguments?.limit) || 5));

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

function label(name, ip, intel) {
  const native = value(intel, 'native', 'is_native', 'isNative');
  const residential = value(intel, 'isResidential', 'is_residential', 'residential');
  const crawler = value(intel, 'is_crawler', 'isCrawler', 'crawler');
  return [
    `${String(name).replace(/[\r\n]+/g, ' ').replaceAll('=', '＝').trim()} [${ip}]`,
    score(value(intel, 'trust_score', 'trustScore', 'score')),
    native === true ? '原生IP' : native === false ? '非原生IP' : '原生未知',
    residential === true ? '住宅' : residential === false ? '非住宅' : '住宅未知',
    crawler === true ? '爬虫偏多' : crawler === false ? '人类偏多' : '人类未知',
  ].join(' | ');
}

function failed(name) {
  return `${String(name).replace(/[\r\n]+/g, ' ').replaceAll('=', '＝').trim()} [检测失败] | 评分未知 | 原生未知 | 住宅未知 | 人类未知`;
}

function parseIntel(body) {
  try {
    const parsed = JSON.parse(String(body || ''));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
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
      const response = await $.http.get({ url: `${INTEL_URL}${encodeURIComponent(ip)}`, timeout: 10 });
      const intel = parseIntel(response.body);
      cache.set(key, { expiresAt: Date.now() + CACHE_TTL, intel });
      return intel;
    })();
    pendingIntel.set(ip, task);
    return task;
  }

  async function inspect(proxy) {
    const original = proxy.name || '未命名节点';
    try {
      const descriptor = ProxyUtils.produce([proxy], 'Surge');
      const response = await $.http.get({
        url: EXIT_IP_URL,
        node: descriptor,
        'policy-descriptor': descriptor,
        timeout: 10,
      });
      const ip = String(response.body || '').trim();
      if (!ip) throw new Error('empty exit IP');
      proxy.name = label(original, ip, await getIntel(ip));
    } catch {
      proxy.name = failed(original);
    }
    return proxy;
  }

  const workers = Array.from({ length: Math.min(concurrency, proxies.length) }, async () => {
    while (cursor < proxies.length) await inspect(proxies[cursor++]);
  });
  await Promise.all(workers);
  return proxies;
}
