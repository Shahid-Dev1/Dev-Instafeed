# Testing strategy

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | Validators, HMAC, crypto, attribution rules, entitlements, URL parsers, WidgetConfig |
| Integration | Vitest + real PostgreSQL (`instafeed_test`) + Redis | Routes through Fastify `inject`, tenant isolation, webhook idempotency, jobs. External APIs are stubbed at the HTTP boundary (undici MockAgent). |
| E2E | Playwright | Dashboard flows and widget behaviour on the local storefront demo page |
| Manual / live | Shopify dev store checklist | OAuth install, theme editor, Add to Cart. These are marked **blocked** until credentials are available. |

Commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`. CI runs the first three with Postgres and Redis service containers.

Test fakes exist only under `**/test/**` and are never imported by production code.
