# BirdMug Portal

Central dashboard for the BirdMug fleet. Public app library with live up/down dots; admin view for server stats, container status, and the Bug Fairy queue. Replaces the old consulting site at birdmug.com and the Server Connect dashboard.

**Live at:** https://birdmug.com

## Quick start

```bash
# Dev — proxies Docker stats over SSH to Toshi
npm run dev

# Production (on Toshi)
doppler run -- docker compose --profile prod up -d --build
```

## API

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/apps` | none | App directory + up/down status |
| `GET /api/status` | JWT | Host stats + per-container detail |
| `GET /api/bugs` | JWT | Recent bugs (proxied from Bug Fairy) |
| `GET /health` | none | Health check |

Read-only: the portal never writes to host or container state. Docker socket is mounted read-only and only fixed commands are exec'd.

## Deploy

`git push origin main` → toshi-bot → `deploy.sh` rebuilds the Express + cloudflared stack on Toshi.

## See also

- **[CLAUDE.md](./CLAUDE.md)** — full operating manual: routes, JWT auth, security model, app-directory schema.
