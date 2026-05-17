# Production Audit Report

**Timestamp:** 2026-03-06T21:49:27.833Z
**Node Version:** v20.20.0
**Verdict:** PASS

## Build Artifacts

| File | Size | Status |
|------|------|--------|
| `dist/index.html` | 1.2 KB | OK |
| `server_dist/index.mjs` | 158.4 KB | OK |

## Probe Results

| Endpoint | Expected | Got | Status |
|----------|----------|-----|--------|
| `/api/health` | 200 | 200 | PASS |
| `/` | 200 | 200 | PASS |
| `/dashboard` | 200 | 200 | PASS |
| `/privacy` | 200 | 200 | PASS |
| `/robots.txt` | 200 | 200 | PASS |

## Environment Variables Referenced in Code

Names only (no values):

- `PORT`
- `NODE_ENV`
- `DATABASE_URL`
- `SESSION_SECRET`
- `REPLIT_DEV_DOMAIN`
- `REPLIT_DOMAINS`
- `REPLIT_DEPLOYMENT_URL`
- `REPL_SLUG`
- `REPL_OWNER`
- `EXPO_PUBLIC_DOMAIN`
- `AI_INTEGRATIONS_OPENAI_API_KEY`
- `AI_INTEGRATIONS_OPENAI_BASE_URL`
- `GOOGLE_PLAY_PACKAGE_NAME`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`
