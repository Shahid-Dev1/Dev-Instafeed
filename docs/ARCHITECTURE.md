# Architecture

```
                 Shopify Admin (iframe)                    Shopper's browser
                        │ App Bridge session token                 │ theme app embed / blocks
                        ▼                                          ▼
┌──────────────────────────────┐            ┌───────────────────────────────────────┐
│ apps/web  (Next.js, React)   │            │ packages/widget-sdk (vanilla TS, ≤12KB) │
│ merchant dashboard           │            │ lazy-loads hls.js / YT / TikTok players │
└──────────────┬───────────────┘            └──────────────────┬────────────────────┘
               │ REST /api/v1 (Bearer session token)           │ /apps/instafeed/* (App Proxy, HMAC)
               ▼                                               ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│ apps/api  (Node 24, Fastify, Zod, Prisma)                                         │
│ modules: auth · stores · team · products · videos · providers(youtube,tiktok,     │
│ bunny) · widgets · storefront · analytics · attribution · integrations · ai ·     │
│ billing · webhooks · support · audit                                              │
└───────┬──────────────────────────────┬──────────────────────────────┬────────────┘
        ▼                              ▼                              ▼
   PostgreSQL 16                 Redis 7 + BullMQ               External APIs
   (Prisma)                      apps/api worker process        Shopify GraphQL Admin,
                                 queues: product-sync,          Bunny Stream, YouTube Data v3,
                                 video-status, events,          TikTok Login Kit/Display/oEmbed,
                                 attribution, aggregates,       Anthropic, GA4 MP, Meta CAPI,
                                 integrations                   Mixpanel, CleverTap
```

## Repository layout
```
apps/web            Next.js dashboard (App Router, Polaris web components, TanStack Query)
apps/api            Fastify server (src/server.ts) and BullMQ worker (src/worker.ts)
packages/shared     Zod schemas and types shared by web, api and sdk (WidgetConfig, events, API DTOs)
packages/widget-sdk Storefront renderer (plain TypeScript, Shadow DOM, no innerHTML from data). The dashboard preview uses the same renderer. Phase 6 bundles it with esbuild into extensions/.../assets
extensions/instafeed-theme  Shopify Theme App Extension (app blocks and app embed)
shopify.app.toml    Shopify CLI app config (scopes, webhooks, app proxy)
tests/e2e           Playwright
docs/               This documentation
```

## Key design rules
- **Tenant isolation:** Every merchant request resolves a `RequestContext { storeId, userId, role }` in an auth hook. Repositories take the context, never a raw storeId from the body. A Prisma client extension rejects queries on tenant models that lack a `storeId` filter. Integration tests check access between two stores.
- **Provider adapters:** `VideoSourceProvider` (youtube, tiktok_url, tiktok_account, upload) and `VideoStorageProvider` (bunny). Tests use fake adapters only.
- **Feature flags:** `FeatureFlag` table (global plus per-store override), seeded from env defaults. Flags are `tiktok_display_api`, `ai_assistant` and `integration_<name>`.
- **Secrets:** OAuth tokens are encrypted with AES-256-GCM (`ENCRYPTION_KEY`), and env is validated with Zod at boot.
- **Jobs:** These are idempotent, keyed by a natural `jobId` (for example `full-sync-{storeId}-{runId}`; BullMQ ids avoid `:`). They retry with exponential backoff, and Shopify throttle cost is honoured.
- **Errors:** The uniform envelope is `{ error: { code, message, details? } }` with typed codes.
