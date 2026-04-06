# BirdMug Portal

Central dashboard for all BirdMug services. Replaces both the old consulting site (birdmug.com) and the Server Connect dashboard (toshi.birdmug.com).

## Architecture

- **Node.js + Express + vanilla HTML/CSS/JS** — no framework, no build step
- **Public view**: App library grid with live status dots (green/red)
- **Admin view**: Server stats, container status, bug tracker (via Bug Fairy API proxy)
- **Auth**: BirdMug Auth JWT (HS256), same shared secret as all other services

## Running

```bash
# Dev (SSH to Toshi for Docker stats)
npm run dev

# Production (on Toshi)
doppler run -- docker compose --profile prod up -d --build
```

## API

| Endpoint | Auth | Description |
|---|---|---|
| GET /api/apps | No | App list with up/down status |
| GET /api/status | JWT | Full server stats + container details |
| GET /api/bugs | JWT | Recent bugs (proxied from Bug Fairy) |
| GET /health | No | Health check |

## Security

- Docker socket: read-only, hardcoded commands only (no user input to shell)
- Rate limited: 60 req/min public, 30 req/min API
- Security headers: CSP, X-Frame-Options DENY, nosniff
- Bug Fairy proxy strips response to safe fields only
- No write operations — portal is observation-only
