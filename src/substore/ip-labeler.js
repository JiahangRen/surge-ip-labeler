import { formatLabel } from '../shared/policy.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const IP_ECHO_URL = 'https://api.ipify.org';
const NET_COFFEE_URL = 'https://ip.net.coffee/api/ip/lookup/';

function parseIntel(body) {
  try {
    const intel = JSON.parse(String(body || ''));
    return intel && typeof intel === 'object' ? intel : {};
  } catch {
    return {};
  }
}

function failedLabel(name) {
  return `${name} [检测失败] | 评分未知 | 原生未知 | 住宅未知 | 人类未知`;
}

async function mapLimit(items, limit, task) {
  const result = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      result[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return result;
}

export function createSubStoreOperator({ httpGet, produce, cache, now = () => Date.now(), concurrency = 5 }) {
  const intelByIp = new Map();

  async function getIntel(ip) {
    if (intelByIp.has(ip)) return intelByIp.get(ip);
    const task = (async () => {
      const cacheKey = `surge-ip-labeler:intel:${ip}`;
      const cached = cache.get(cacheKey);
      if (cached?.expiresAt > now() && cached.intel) return cached.intel;

      const response = await httpGet({ url: `${NET_COFFEE_URL}${encodeURIComponent(ip)}`, timeout: 10 });
      const intel = parseIntel(response.body);
      cache.set(cacheKey, { expiresAt: now() + DAY_MS, intel });
      return intel;
    })();
    intelByIp.set(ip, task);
    return task;
  }

  return async function operator(proxies = []) {
    return mapLimit(proxies, concurrency, async (proxy) => {
      const originalName = String(proxy.name || '未命名节点');
      try {
        const descriptor = produce([proxy]);
        const response = await httpGet({
          url: IP_ECHO_URL,
          node: descriptor,
          'policy-descriptor': descriptor,
          timeout: 10,
        });
        const ip = String(response.body || '').trim();
        if (!ip) throw new Error('empty exit IP');
        proxy.name = formatLabel(originalName, ip, await getIntel(ip));
      } catch {
        proxy.name = failedLabel(originalName);
      }
      return proxy;
    });
  };
}
