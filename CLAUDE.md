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

## Memory

This project uses the standard memory system. See `memory/MEMORY.md`, `memory/implementation_plan.md`, `memory/lessons_learned.md`. Read them at session start.

**Session end (REQUIRED — not optional):** Before the session closes or context is exhausted, invoke the `memory-writer` agent to update `memory/MEMORY.md` and `memory/lessons_learned.md` with:
- What was built/changed/fixed this session
- Any new decisions or architecture choices
- New gotchas / failure modes discovered
- Current state of in-progress work
- Any new connected systems or config changes (env vars, Doppler secrets, n8n workflows, toshi-infra changes)

This is not a suggestion. The 2026-05-09 incident: a full session of work was lost entirely because memory was never written. If you can't invoke memory-writer (context exhausted), write the key facts inline as a final message to the user so they can be recovered.
