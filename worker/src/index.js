const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

function unauthorized() {
  return new Response('Unauthorized', { status: 401 });
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: jsonHeaders });
}

function validSnapshot(snapshot) {
  return snapshot
    && typeof snapshot.content === 'string'
    && typeof snapshot.updatedAt === 'string'
    && snapshot.summary
    && Number.isFinite(snapshot.summary.nodeCount)
    && Number.isFinite(snapshot.summary.failedCount);
}

async function storeSnapshot(request, env) {
  if (request.headers.get('Authorization') !== `Bearer ${env.SYNC_TOKEN}`) return unauthorized();

  let snapshot;
  try {
    snapshot = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  if (!validSnapshot(snapshot)) return json({ error: 'invalid snapshot' }, 400);

  await env.POLICIES.put('current', snapshot.content);
  await env.POLICIES.put('status', JSON.stringify({
    updatedAt: snapshot.updatedAt,
    nodeCount: snapshot.summary.nodeCount,
    failedCount: snapshot.summary.failedCount,
  }));
  return new Response(null, { status: 204 });
}

async function subscription(url, env) {
  if (url.searchParams.get('token') !== env.READ_TOKEN) return unauthorized();

  const content = await env.POLICIES.get('current');
  if (content === null) return new Response('Not Found', { status: 404 });
  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });
}

async function status(env) {
  const savedStatus = await env.POLICIES.get('status');
  if (savedStatus === null) return json({ updatedAt: null, nodeCount: 0, failedCount: 0 });
  return json(JSON.parse(savedStatus));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/v1/snapshot') return storeSnapshot(request, env);
    if (request.method === 'GET' && url.pathname === '/v1/subscription') return subscription(url, env);
    if (request.method === 'GET' && url.pathname === '/v1/status') return status(env);
    return new Response('Not Found', { status: 404 });
  },
};
