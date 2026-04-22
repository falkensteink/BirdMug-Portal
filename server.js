const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { logger, requestLogger } = require('./json-logger');

const app = express();
app.set('trust proxy', 1);
app.use(requestLogger);
const PORT = process.env.PORT || 3080;
const JWT_SECRET = process.env.BIRDMUG_JWT_SECRET || '';
const BUGFAIRY_URL = process.env.BUGFAIRY_URL || 'https://bugs.birdmug.com';
const MATTERMOST_WEBHOOK_URL = process.env.MATTERMOST_WEBHOOK_URL || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

// Fail hard if JWT secret is missing in production
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  logger.error('BIRDMUG_JWT_SECRET is required in production');
  process.exit(1);
}

// SSH prefix for local dev (run commands on Toshi remotely)
const SSH_HOST = process.env.SSH_HOST;
if (SSH_HOST && !/^[\w.@-]+$/.test(SSH_HOST)) {
  logger.error('SSH_HOST contains invalid characters');
  process.exit(1);
}
const SSH_PREFIX = SSH_HOST
  ? `ssh -o ConnectTimeout=5 -o BatchMode=yes ${SSH_HOST} `
  : '';

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection', { exc: String(err) });
});

// ── App Registry ──────────────────────────────────────────────────
// Single source of truth for all BirdMug services.
// "primary" is the main container to check for status (ignoring cloudflared sidecars).
const APP_REGISTRY = {
  spellstorm: {
    name: 'Spellstorm',
    description: 'Multiplayer trick-taking card game',
    url: 'https://spellstorm.birdmug.com',
    itch: 'https://falkensteink.itch.io/spellstorm',
    category: 'app',
    containers: ['spellstorm_server', 'spellstorm_cloudflared'],
    primary: 'spellstorm_server',
  },
  scs: {
    name: 'Sports Credit Score',
    description: 'Sports betting credit score platform',
    url: 'https://scs.birdmug.com',
    category: 'app',
    containers: ['scs_db', 'scs_api', 'scs_web', 'scs_nginx', 'scs_cloudflared'],
    primary: 'scs_api',
  },
  dod: {
    name: 'Dice of Domains',
    description: 'Jujutsu Kaisen dice battle game',
    url: 'https://falkensteink.itch.io/dice-of-domains',
    itch: 'https://falkensteink.itch.io/dice-of-domains',
    category: 'app',
    containers: ['dod_relay', 'dod_cloudflared'],
    primary: 'dod_relay',
  },
  npcpm: {
    name: 'NPC-PM',
    description: 'Project management command center',
    url: 'https://pm.birdmug.com',
    category: 'app',
    containers: ['npcpm-backend-prod', 'npcpm-postgres-prod', 'npcpm-cloudflared'],
    primary: 'npcpm-backend-prod',
  },
  uptime_kuma: {
    name: 'Uptime Kuma',
    description: 'Service monitoring dashboard',
    url: 'https://status.birdmug.com',
    category: 'infra',
    containers: ['uptime_kuma', 'uptime_kuma_cloudflared'],
    primary: 'uptime_kuma',
  },
  mattermost: {
    name: 'Mattermost',
    description: 'Team chat',
    url: 'https://chat.birdmug.com',
    category: 'infra',
    containers: ['mattermost', 'mattermost_db', 'mattermost_cloudflared'],
    primary: 'mattermost',
  },
  immich: {
    name: 'Immich',
    description: 'Self-hosted photo library',
    url: 'https://photos.birdmug.com',
    category: 'infra',
    containers: ['immich_server', 'immich_machine_learning', 'immich_redis', 'immich_postgres', 'immich_cloudflared'],
    primary: 'immich_server',
  },
  home_assistant: {
    name: 'Home Assistant',
    description: 'Home automation',
    url: 'https://ha.birdmug.com',
    category: 'infra',
    containers: ['homeassistant', 'ha_cloudflared'],
    primary: 'homeassistant',
  },
  bugfairy: {
    name: 'Bug Fairy',
    description: 'Cross-project bug tracker',
    url: 'https://bugs.birdmug.com',
    category: 'infra',
    containers: ['bug-fairy', 'bugfairy_cloudflared'],
    primary: 'bug-fairy',
  },
  birdmug_auth: {
    name: 'BirdMug Auth',
    description: 'Central authentication service',
    url: 'https://accounts.birdmug.com',
    category: 'auth',
    containers: ['birdmug_auth_server', 'birdmug_auth_cloudflared'],
    primary: 'birdmug_auth_server',
  },
};

// ── Security ──────────────────────────────────────────────────────

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; " +
    "img-src 'self' data:; connect-src 'self' https://accounts.birdmug.com; " +
    "font-src 'self'; frame-ancestors 'none';"
  );
  next();
});

// Rate limiting
const publicLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
app.use('/api/', apiLimiter);
app.use('/', publicLimiter);
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// ── Auth middleware ────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (!JWT_SECRET) return next(); // Auth disabled in dev (production exits at startup)
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
    || req.query.token || '';
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    // Portal accepts any logged-in BirdMug user — every token carries the
    // auth service itself in its aud array, so audience='accounts.birdmug.com'
    // is the "valid BirdMug session" check without needing an app_id of our own.
    req.user = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      audience: 'accounts.birdmug.com',
      issuer: 'accounts.birdmug.com',
    });
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Shell helper ──────────────────────────────────────────────────

function run(cmd) {
  const full = SSH_PREFIX ? `${SSH_PREFIX}"${cmd}"` : cmd;
  return new Promise((resolve, reject) => {
    exec(full, { timeout: 10000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

// ── Docker status helper ──────────────────────────────────────────

async function getContainerMap() {
  const raw = await run("docker ps --format '{{.Names}}|{{.Status}}'");
  const map = {};
  raw.split('\n').filter(Boolean).forEach(line => {
    const [name, ...statusParts] = line.split('|');
    map[name.trim()] = statusParts.join('|').trim();
  });
  return map;
}

// ── Routes ────────────────────────────────────────────────────────

// Serve the static portal shell
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Public: app status (green/red only, no container details)
app.get('/api/apps', async (req, res) => {
  try {
    const containerMap = await getContainerMap();
    const apps = Object.entries(APP_REGISTRY).map(([id, app]) => {
      const primaryStatus = containerMap[app.primary] || '';
      const up = primaryStatus.toLowerCase().startsWith('up');
      const entry = {
        id,
        name: app.name,
        description: app.description,
        url: app.url,
        category: app.category,
        up,
      };
      if (app.itch) entry.itch = app.itch;
      return entry;
    });
    res.json({ apps, ts: Date.now() });
  } catch {
    res.status(503).json({ apps: [], error: 'Cannot reach Docker', ts: Date.now() });
  }
});

// Admin: full server status + per-container details
app.get('/api/status', requireAuth, async (req, res) => {
  try {
    const [uptimeRaw, diskRaw, memRaw, containerMap] = await Promise.all([
      run('uptime'),
      run('df -h / | tail -1'),
      run('free -h | grep Mem'),
      getContainerMap(),
    ]);

    // Parse uptime
    const uptimeMatch = uptimeRaw.match(/up\s+(.+?),\s+\d+ user/);
    const loadMatch = uptimeRaw.match(/load average:\s+([\d.]+)/);
    const uptime = uptimeMatch ? uptimeMatch[1].trim() : uptimeRaw;
    const load = loadMatch ? parseFloat(loadMatch[1]) : null;

    // Parse disk
    const diskParts = diskRaw.split(/\s+/);
    const disk = { size: diskParts[1], used: diskParts[2], avail: diskParts[3], pct: diskParts[4] };

    // Parse memory
    const memParts = memRaw.split(/\s+/);
    const mem = { total: memParts[1], used: memParts[2], available: memParts[6] };

    // Group containers by project
    const projects = Object.entries(APP_REGISTRY).map(([id, app]) => ({
      id,
      name: app.name,
      url: app.url,
      containers: app.containers.map(c => ({
        name: c,
        status: containerMap[c] || null,
        up: containerMap[c] ? containerMap[c].toLowerCase().startsWith('up') : false,
      })),
    }));

    res.json({ ok: true, uptime, load, disk, mem, projects, ts: Date.now() });
  } catch (err) {
    logger.error('Status fetch failed', { exc: String(err) });
    res.status(503).json({ ok: false, error: 'Failed to get status' });
  }
});

// Admin: proxy Bug Fairy reports (avoids CORS issues)
app.get('/api/bugs', requireAuth, async (req, res) => {
  try {
    const resp = await fetch(`${BUGFAIRY_URL}/api/reports?limit=10&offset=0`);
    if (!resp.ok) throw new Error(`Bug Fairy returned ${resp.status}`);
    const data = await resp.json();
    // Only return safe fields
    const reports = (data.reports || []).map(r => ({
      id: r.id,
      app: r.app,
      title: r.title,
      status: r.status,
      created_at: r.created_at,
      github_url: r.github_url,
    }));
    res.json({ reports, total: data.total });
  } catch (err) {
    res.json({ reports: [], total: 0, error: 'Cannot reach Bug Fairy' });
  }
});

// Access request — notifies operator for approval
const accessRequestLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 3 });
app.post('/api/request-access', accessRequestLimiter, async (req, res) => {
  const { name, contact, reason } = req.body || {};
  if (!name || !contact) {
    return res.status(400).json({ error: 'Name and contact are required.' });
  }

  const message = `**Portal Access Request**\n| Field | Value |\n|---|---|\n| Name | ${name} |\n| Contact | ${contact} |\n| Reason | ${reason || 'Not provided'} |\n| Time | ${new Date().toISOString()} |`;

  logger.info('Access request received', { name, contact, reason });

  if (MATTERMOST_WEBHOOK_URL) {
    try {
      await fetch(MATTERMOST_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
      });
    } catch (err) {
      logger.error('Mattermost webhook failed', { exc: String(err) });
    }
  }

  res.json({ ok: true });
});

const server = app.listen(PORT, () => {
  logger.info(`BirdMug Portal started on port ${PORT}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
