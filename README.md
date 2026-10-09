# Instafeed: Shoppable Video for Shopify

A multi-tenant SaaS that lets D2C brands put shoppable videos on their Shopify storefronts. Videos can be uploads (Bunny Stream), YouTube Shorts or TikTok videos, each with tagged products, Add to Cart and revenue attribution.

**Status:** Phases 0 (requirements) and 1 (foundation) are complete. Phase 2 (auth and multi-tenancy) is next. See [docs/CHECKLIST.md](docs/CHECKLIST.md).

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
| `pnpm dev` | Dashboard on :3000 and API on :4000 (watch mode) |
| `pnpm --filter @instafeed/api dev:worker` | Background job worker |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` | Quality gates (CI runs all four) |

Health: `GET /health` (liveness) and `GET /health/ready` (DB and Redis; returns 503 if either is down).
The tests use `TEST_DATABASE_URL` (`instafeed_test`) and apply migrations automatically.

## Notes
- `packages/shared` is consumed as TypeScript source using `.ts` import paths (`rewriteRelativeImportExtensions`). The built API loads it through Node 24's native type stripping.
- Env vars are validated at boot ([apps/api/src/config/env.ts](apps/api/src/config/env.ts)). An invalid config exits with the list of bad variables.

## Documentation
[PRD](docs/PRD.md) · [Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [API](docs/API.md) · [Security](docs/SECURITY.md) · [Testing](docs/TESTING.md) · [Deployment](docs/DEPLOYMENT.md) · [Checklist](docs/CHECKLIST.md) · [SOW](docs/SOW.md)
