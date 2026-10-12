# Instafeed: Shoppable Video for Shopify

A multi-tenant SaaS that lets D2C brands put shoppable videos on their Shopify storefronts. Videos can be uploads (Bunny Stream), YouTube Shorts or TikTok videos, each with tagged products, Add to Cart and revenue attribution.

**Status:** All phases (0 to 10) are code-complete with 255 passing tests. **Not deployed.** Launch is waiting on owner actions (credentials, approvals, hosting, legal review); see [docs/LAUNCH_REPORT.md](docs/LAUNCH_REPORT.md). See [docs/CHECKLIST.md](docs/CHECKLIST.md).

## Stack
pnpm monorepo · Node 24 · TypeScript · Next.js 16 (`apps/web`) · Fastify 5 API and BullMQ worker (`apps/api`) · Prisma 7 / PostgreSQL 16 · Redis 7 · Zod schemas shared in `packages/shared`.

## Local setup (WSL/Ubuntu)
```bash
sudo apt install -y postgresql redis-server
sudo service postgresql start && sudo service redis-server start
sudo -u postgres createuser -s $USER && createdb instafeed_dev && createdb instafeed_test

cp .env.example .env            # replace YOUR_LINUX_USER with your Linux user name
pnpm install                    # also generates the Prisma client
pnpm db:migrate && pnpm db:seed # the seed is idempotent
```

## Run
| Command | What |
|---|---|
| `pnpm dev` | Dashboard on :3000, API on :4000 and the BullMQ worker (watch mode) |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` | Quality gates (CI runs all four plus e2e) |
| `pnpm test:e2e` | Builds the storefront bundle and runs Playwright |
| `pnpm --filter @instafeed/api support:grant <email>` | Grants support-console access (see docs/SUPPORT.md) |
| `pnpm --filter @instafeed/widget-sdk build` | Rebuilds `extensions/instafeed-theme/assets/instafeed.js` (commit the result) |

Health: `GET /health` (liveness) and `GET /health/ready` (DB and Redis; returns 503 if either is down).
The tests use `TEST_DATABASE_URL` (`instafeed_test`) and apply migrations automatically.

## Shopify app
The settings are in [shopify.app.toml](shopify.app.toml) (scopes, webhooks, URLs). The embedded entry point is `/app`. Install uses Shopify-managed install plus token exchange with expiring offline tokens; see [docs/SECURITY.md](docs/SECURITY.md). Local testing inside the Shopify admin needs HTTPS: run `shopify app dev`.

## Notes
- `packages/shared` is consumed as TypeScript source using `.ts` import paths (`rewriteRelativeImportExtensions`). The built API loads it through Node 24's native type stripping.
- Env vars are validated at boot ([apps/api/src/config/env.ts](apps/api/src/config/env.ts)). An invalid config exits with the list of bad variables.

## Documentation
[PRD](docs/PRD.md) · [Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [API](docs/API.md) · [Security](docs/SECURITY.md) · [Analytics](docs/ANALYTICS.md) · [Billing](docs/BILLING.md) · [Support](docs/SUPPORT.md) · [Launch report](docs/LAUNCH_REPORT.md) · [Merchant guide](docs/MERCHANT_GUIDE.md) · [Data deletion](docs/DATA_DELETION.md) · [Pilot plan](docs/PILOT_PLAN.md) · [Testing](docs/TESTING.md) · [Deployment](docs/DEPLOYMENT.md) · [Checklist](docs/CHECKLIST.md) · [SOW](docs/SOW.md)
