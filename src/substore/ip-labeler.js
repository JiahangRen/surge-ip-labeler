import { formatLabel } from '../shared/policy.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const IP_ECHO_URL = 'http://ip-api.com/json?fields=status,query';
const NET_COFFEE_URL = 'https://ip.net.coffee/api/ip/lookup/';
const CHATGPT_TRACE_URL = 'https://chatgpt.com/cdn-cgi/trace';
const GPT_RISK_URL = 'https://ip.net.coffee/api/iprisk/';

function parseIntel(body) {
  try {
    const intel = JSON.parse(String(body || ''));
    return intel && typeof intel === 'object' ? intel : {};
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

function parseTraceIp(body) {
  const matched = String(body || '').match(/^ip=([^\r\n]+)$/m);
  return matched ? matched[1].trim() : '';
}

function statusLabel(name, status) {
  return `${name} [${status}] | 评分未知`;
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

export function createSubStoreOperator({ httpGet, produce, serialize, uploadSnapshot, cache, now = () => Date.now(), concurrency = 5 }) {
  const intelByIp = new Map();
  const gptRiskByIp = new Map();

  async function getIntel(ip) {
    if (intelByIp.has(ip)) return intelByIp.get(ip);
    const task = (async () => {
      const cacheKey = `surge-ip-labeler:intel:${ip}`;
      const cached = cache.get(cacheKey);
      if (cached?.expiresAt > now() && cached.intel) return cached.intel;

      const response = await httpGet({ url: `${NET_COFFEE_URL}${encodeURIComponent(ip)}`, timeout: 10000 });
      const intel = parseIntel(response.body);
      cache.set(cacheKey, { expiresAt: now() + DAY_MS, intel });
      return intel;
    })();
    intelByIp.set(ip, task);
    return task;
  }

  async function getGptIntel(descriptor) {
    let trace;
    try {
      trace = await httpGet({
        url: CHATGPT_TRACE_URL,
        node: descriptor,
        'policy-descriptor': descriptor,
        timeout: 10000,
      });
    } catch {
      return {};
    }
    const chatgptExitIp = parseTraceIp(trace?.body);
    if (!chatgptExitIp) return {};
    if (!gptRiskByIp.has(chatgptExitIp)) {
      gptRiskByIp.set(chatgptExitIp, (async () => {
        const cacheKey = `surge-ip-labeler:gpt-risk:${chatgptExitIp}`;
        const cached = cache.get(cacheKey);
        if (cached?.expiresAt > now() && cached.intel) return cached.intel;
        try {
          const response = await httpGet({ url: `${GPT_RISK_URL}${encodeURIComponent(chatgptExitIp)}`, timeout: 10000 });
          const score = Number(parseIntel(response.body).trust_score);
          const intel = Number.isFinite(score) && score >= 0 && score <= 100 ? { gpt_trust_score: score } : {};
          cache.set(cacheKey, { expiresAt: now() + DAY_MS, intel });
          return intel;
        } catch {
          return {};
        }
      })());
    }
    return gptRiskByIp.get(chatgptExitIp);
  }

  return async function operator(proxies = []) {
    const result = await mapLimit(proxies, concurrency, async (proxy) => {
      const originalName = String(proxy.name || '未命名节点');
      let descriptor;
      try {
        descriptor = produce([proxy]);
      } catch {
        proxy.name = statusLabel(originalName, '节点描述符失败');
        return proxy;
      }
      if (!descriptor) {
        proxy.name = statusLabel(originalName, '节点描述符失败');
        return proxy;
      }

      let response;
      try {
        response = await httpGet({
          url: IP_ECHO_URL,
          node: descriptor,
          'policy-descriptor': descriptor,
          timeout: 10000,
        });
      } catch {
        proxy.name = statusLabel(originalName, '出口请求失败');
        return proxy;
      }

      const ip = parseExitIp(response?.body);
      if (!ip) {
        proxy.name = statusLabel(originalName, '出口响应无IP');
        return proxy;
      }

      const [intelResult, gptResult] = await Promise.allSettled([getIntel(ip), getGptIntel(descriptor)]);
      const intel = intelResult.status === 'fulfilled' ? intelResult.value : {};
      const gptIntel = gptResult.status === 'fulfilled' ? gptResult.value : {};
      proxy.name = formatLabel(originalName, ip, { ...intel, ...gptIntel });
      return proxy;
    });

    if (serialize && uploadSnapshot) {
      const failedCount = result.filter((proxy) => /\[(节点描述符失败|出口请求失败|出口响应无IP)\]/.test(String(proxy.name))).length;
      await uploadSnapshot({
        content: serialize(result),
        updatedAt: new Date(now()).toISOString(),
        summary: { nodeCount: result.length, failedCount },
      });
    }
    return result;
  };
}
