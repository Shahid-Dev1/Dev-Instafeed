# Deployment

> Nothing has been deployed. Production deployment requires the owner's explicit approval (CLAUDE.md).

## Topology (pilot)
- **One VPS** (for example an InterServer VPS, 2 vCPU / 4 GB) running `deploy/docker-compose.prod.yml`. It runs `migrate` (one-off), `api`, `worker`, `web` and `caddy`, which provides automatic HTTPS and the HTTP→HTTPS redirect.
- **Managed PostgreSQL 16** with daily snapshots and point-in-time recovery, plus **managed Redis 7** (persistence on, used by BullMQ).
- **Bunny Stream** for hosted video. The App Proxy and theme extension are served via Shopify.

## Release procedure
1. **Staging first:** a separate store, database and app config (`shopify.app.staging.toml`). Run docs/STOREFRONT_TEST_PLAN.md and get sign-off.
2. Tag the release: `git tag vX.Y.Z`. CI must be green (lint, typecheck, tests, build, e2e, bundle freshness).
3. On the server: `git checkout vX.Y.Z && docker compose -f deploy/docker-compose.prod.yml up -d --build`. The `migrate` service runs `prisma migrate deploy` before the API starts.
4. Push Shopify config and extensions: `shopify app deploy` (the app URL, webhooks, proxy and extensions version).
5. Verify `https://<app>/health/ready` returns `ok` and smoke-test install, a widget, Add to Cart and analytics.

## Rollback
- **App:** `git checkout <previous tag> && docker compose … up -d --build`. Migrations are additive (new tables and columns); never edit applied migrations. For a destructive migration, ship it only after the code that stops using the column has been live for a release.
- **Extensions:** in the Partner Dashboard → Versions, release the previous app version (this reverts the theme extension and pixel).
- **Data:** restore from the managed snapshot, or from `deploy/backup.sh` dumps with `pg_restore --clean --if-exists --no-owner`. The restore was tested locally (27 tables restored).

## Backups
- Managed DB snapshots (daily, 7+ days of point-in-time recovery). Plus `deploy/backup.sh` nightly (logical dump, verified with `pg_restore --list`, 14-day retention), copied off-host.
- Run a restore drill monthly into a scratch database.

## Monitoring and alerts
| Signal | How | Alert when |
|---|---|---|
| Uptime | External check of `/health/ready` (DB and Redis) every 1 min | 2 consecutive failures |
| Errors | JSON logs (pino) shipped to the log service; `unhandled error` and `tenant scope violation` entries | any `tenant scope violation`; >1% 5xx over 5 min |
| Queues | Failed-job counts per queue (support console diagnostics show waiting/active/delayed/failed) | failed > 50 or waiting growing for 15 min |
| Webhooks | Missing `orders/create` or `app/uninstalled` receipts | none received in 24h from active stores |
| Billing | `sync-all` job result | Partner API errors 2 days running |
| TLS | Caddy auto-renewal; expiry monitor | < 14 days to expiry |

Optionally add an error tracker (for example Sentry) by setting a DSN. It isn't wired in, to avoid sending data to another processor without the owner's decision.

## Environment checklist (production)
`NODE_ENV=production`, `API_URL`, `WEB_URL`, `SHOPIFY_APP_URL` (https), `SHOPIFY_API_KEY/SECRET/SCOPES`, a fresh `ENCRYPTION_KEY` (never reuse dev; rotating it requires re-encrypting tokens), `DATABASE_URL`, `REDIS_URL`, `QUEUE_PREFIX`, the Bunny, YouTube, TikTok, Instagram and Meta provider keys (optional), `ANTHROPIC_API_KEY` (optional) and the Partner API billing vars. `BILLING_DEV_PLAN` must be unset (it is ignored in production anyway).

## External accounts and credentials
| Service | Needed for | Status |
|---|---|---|
| Shopify Partner app + dev store | Install, admin | Owner has it. **Rotate the client secret** (it was shared in chat). |
| YouTube Data API v3 key | YouTube import | Owner has it; not yet in `.env` |
| Bunny Stream library + webhook | Uploads, Instagram copies | **Needed** |
| TikTok developer app (Login Kit, Display API) | TikTok account import (flagged) | **Needed / approval pending** |
| Meta app (Instagram Login; optional oEmbed Read) | Instagram (flagged) | **Needed / approval pending** |
| Anthropic API key | AI assistant (flagged) | **Needed** |
| App Pricing plans + Partner API token | Billing | **Needed** (docs/BILLING.md) |
| Protected customer data (Level 1) for `read_orders` | Attribution | **Request in the Dev Dashboard** |
| Production VPS, managed Postgres/Redis, domain | Hosting | **Owner decision** |

## Cost model (pilot, 10–20 brands, estimate)
VPS ~$10–20/mo · managed Postgres/Redis ~$15–40/mo · Bunny ~$1–10/mo (storage ~$0.01/GB, delivery ~$0.005–0.01/GB) · Anthropic usage-based (about $0.01 per AI suggestion) · domain ~$1/mo.
