const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Use a random high port so tests don't collide with a running server
const TEST_PORT = 0; // Let OS pick an available port
let server;
let baseUrl;

// ── Helper: make HTTP requests ────────────────────────────────────
function request(path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { ...headers },
    };
    if (body) {
      const payload = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Server lifecycle ──────────────────────────────────────────────
before(async () => {
  // Clear env vars that would cause side-effects
  delete process.env.BIRDMUG_JWT_SECRET;
  delete process.env.SSH_HOST;
  delete process.env.MATTERMOST_WEBHOOK_URL;
  process.env.NODE_ENV = 'test';
  // These tests exercise the no-auth dev-mode path; server.js now requires an
  // explicit opt-in so an unconfigured prod deploy can't silently open auth.
  process.env.DEV_UNSAFE_OPEN_AUTH = '1';

  // Require the app module — server.js starts listening on require,
  // so we need to override PORT to use a dynamic port.
  // We'll re-create the app by loading server.js after setting PORT=0.
  // Since server.js calls app.listen(PORT), we set PORT and require it.
  process.env.PORT = '0';

  // server.js assigns to `const server = app.listen(...)` and exports nothing,
  // so we need to grab the server from the module's side-effect.
  // We'll patch this by reading the server from the require cache.
  require('../server');

  // The server is the last http.Server created — find it via listening sockets
  // Actually, server.js stores server in module scope but doesn't export it.
  // We can find it by looking at the require cache or by waiting briefly.
  // Simpler approach: server.js logs the port, and we can get it from the
  // internal Node http server list. Let's use a small workaround.

  // Actually, the simplest approach: we know server.js does app.listen(PORT).
  // With PORT=0, Node picks a random port. We need to find that server.
  // We can iterate over open handles.

  // Even simpler: require returns the module.exports. server.js doesn't export
  // anything, but we can access the app through the require cache.
  // Let's just wait a tick and find the listening server.

  await new Promise((resolve) => setTimeout(resolve, 100));

  // Find the server by checking connections — look for express app
  const cached = require.cache[require.resolve('../server')];
  // server.js doesn't export, so we need another approach.
  // Let's just try connecting to find what port was assigned.
  // We'll scan the Node process's active handles.
  const servers = process._getActiveHandles().filter(
    (h) => h instanceof http.Server && h.listening
  );
  if (servers.length === 0) throw new Error('No listening server found');
  server = servers[servers.length - 1];
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ── Tests ─────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with {"status":"ok"}', async () => {
    const res = await request('/health');
    assert.equal(res.status, 200);
    assert.deepStrictEqual(res.body, { status: 'ok' });
  });

  it('sets security headers', async () => {
    const res = await request('/health');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
  });
});

describe('GET /', () => {
  it('returns 200', async () => {
    const res = await request('/');
    assert.equal(res.status, 200);
  });

  it('returns HTML content', async () => {
    const res = await request('/');
    assert.ok(res.headers['content-type'].includes('text/html'));
  });
});

describe('GET /api/apps', () => {
  it('returns JSON with apps array and ts', async () => {
    // Docker is not running in test, so this will return 503
    // which is still a valid response shape
    const res = await request('/api/apps');
    // Either 200 (docker available) or 503 (docker unavailable)
    assert.ok([200, 503].includes(res.status));
    assert.ok(Array.isArray(res.body.apps));
    assert.ok(typeof res.body.ts === 'number');
  });
});

describe('GET /api/status (auth required)', () => {
  it('allows access when JWT_SECRET is empty (dev mode)', async () => {
    // In dev mode (no JWT_SECRET), requireAuth calls next() — auth is bypassed.
    // But the route itself calls Docker commands which will fail.
    const res = await request('/api/status');
    // Auth passes (dev mode), but Docker commands fail → 503
    assert.ok([200, 503].includes(res.status));
  });
});

describe('GET /api/bugs (auth required)', () => {
  it('returns reports array shape even when Bug Fairy is unreachable', async () => {
    const res = await request('/api/bugs');
    // Auth passes (dev mode), Bug Fairy unreachable → fallback response
    assert.ok(Array.isArray(res.body.reports));
    assert.ok(typeof res.body.total === 'number');
  });
});

describe('POST /api/request-access', () => {
  it('returns 400 when name and contact are missing', async () => {
    const res = await request('/api/request-access', {
      method: 'POST',
      body: {},
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('returns 400 when only name is provided', async () => {
    const res = await request('/api/request-access', {
      method: 'POST',
      body: { name: 'Test User' },
    });
    assert.equal(res.status, 400);
  });

  it('returns 200 with valid name and contact', async () => {
    const res = await request('/api/request-access', {
      method: 'POST',
      body: { name: 'Test User', contact: 'test@example.com', reason: 'Testing' },
    });
    assert.equal(res.status, 200);
    assert.deepStrictEqual(res.body, { ok: true });
  });
});
