# Testing strategy

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | Validators, HMAC, crypto, attribution rules, entitlements, URL parsers, WidgetConfig |
| Integration | Vitest + real PostgreSQL (`instafeed_test`) + Redis | Routes through Fastify `inject`, tenant isolation, webhook idempotency, jobs. External APIs are replaced at the injected `fetch` boundary by in-memory fakes (`test/helpers.ts`, `test/fake-providers.ts`). |
| E2E | Playwright (`pnpm test:e2e`) | The built `instafeed.js` on a stubbed Shopify-like page (desktop and mobile): lazy load, player, popup, cart, PDP, keyboard, reduced motion. On WSL, run once: `sudo pnpm exec playwright install-deps chromium` |
| Storefront DOM | Vitest + happy-dom | Renderer, loader, player, popup, cart errors, and the bundle size budget |
| Manual / live | Shopify dev store checklist | OAuth install, theme editor, Add to Cart. These are marked **blocked** until credentials are available. |

Commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`. CI runs all four (with Postgres and Redis service containers) and checks the committed storefront bundle is current.

Test fakes exist only under `**/test/**` and are never imported by production code.
