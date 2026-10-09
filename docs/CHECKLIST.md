# Master checklist

Status key: `[x]` done (tests ran) · `[~]` code done, live test blocked · `[ ]` not started. Each item lists its acceptance criteria (AC).

## Phase 0: Requirements and architecture ✅
- [x] Review requirements. AC: [PRD.md](PRD.md) lists the decisions D1–D8.
- [x] PRD, SOW, user flows, architecture. AC: PRD, [ARCHITECTURE.md](ARCHITECTURE.md).
- [x] Data model, API contracts, permission model. AC: [DATABASE.md](DATABASE.md), [API.md](API.md), PRD §3.
- [x] Feature matrix and acceptance criteria. AC: this file, plus the risks below.

## Phase 1: Foundation ✅
- [x] Monorepo and env config. AC: `pnpm install` works, and env is Zod-validated (bad env fails at boot with a clear message).
- [x] Dashboard, API, PostgreSQL. AC: `pnpm dev` serves web and API, and `/health/ready` reports DB and Redis as ok.
- [x] Prisma migrations and seed. AC: `pnpm db:migrate && pnpm db:seed` is idempotent.
- [x] Lint, typecheck, tests, CI. AC: all green locally; the GitHub Actions workflow is present (it has not run yet because nothing is pushed).

## Phase 2: Auth and multi-tenancy (code ✅, live install blocked on HTTPS tunnel)
- [x] Merchant registration and login. AC: register/login/logout tests; rate limit; scrypt; CSRF origin check.
- [~] Shopify install (managed install plus token exchange, expiring tokens). AC: tests reject a forged, expired, wrong-audience or wrong-shop token; tokens are encrypted; refresh is single-flight. **Live install on the dev store: blocked, needs an HTTPS tunnel.**
- [x] Store, user and role model. AC: RBAC matrix tests for every role.
- [x] Isolation, sessions, uninstall. AC: Store A cannot read or modify Store B (tests); uninstall, reinstall, duplicate-webhook and GDPR webhook tests pass.

## Phase 3: Product catalog (code ✅, live sync blocked on dev-store install)
- [x] GraphQL product and variant sync. AC: paginated sync test (3 pages) stores gids; products with 180 variants fetch extra variant pages.
- [x] Background jobs, pagination, throttling. AC: THROTTLED responses wait (based on the reported query cost) and retry; repeated throttling marks the run FAILED; one active sync per store, and stuck runs expire after 2h.
- [x] Search UI. AC: search by title, handle or SKU, status filter, cursor pagination; isolation test. *Tagging products onto videos ships with videos in Phase 4.*
- [x] Webhook updates and reconciliation. AC: create/update re-fetch from GraphQL (out-of-order safe); delete marks deleted; a full sync soft-deletes products Shopify no longer returns; nightly `reconcile-all` scheduler at 03:00 UTC.

## Phase 4: Video library (code ✅, live provider tests blocked on credentials)
- [~] Upload to Bunny with processing states. AC: pre-signed TUS (signature test); status is read from the Bunny API (PENDING→PROCESSING→READY/FAILED, abandoned uploads fail after 6h); webhook signature checked. **Live: blocked, needs a Bunny library.**
- [~] YouTube and Shorts import. AC: URL parser tests; private, deleted and non-embeddable videos are rejected; daily availability recheck. **Live: blocked, needs YOUTUBE_API_KEY.**
- [x] TikTok URL import. AC: oEmbed import, unavailable and short-link errors, daily recheck. (Uses public oEmbed with no key; not yet tried against live TikTok.)
- [~] TikTok OAuth and Display API (flag). AC: single-use, expiring, provider-bound state; encrypted tokens; refresh; REAUTH on revoke; pagination; import only owned ids; disconnect revokes. **Live: blocked until the TikTok app is approved.**
- [x] Library operations. AC: search, filter, sort, cursor pagination, archive/restore, delete (removes Bunny media), bulk tags, product/variant tagging validated against the store, duplicate detection (409), store isolation for every operation.

## Instagram Reels (added at the owner's request)
- [~] Connect a Business/Creator account (Instagram Login, `instagram_business_basic`), long-lived token, daily refresh, REAUTH handling. **Live: blocked, needs a Meta app and approval.**
- [~] List Reels (VIDEO posts), flag non-importable ones (no `media_url`), require ownership confirmation, copy to Bunny, mark UNAVAILABLE if removed.
- [~] Reel URL embed via Meta oEmbed (flag `instagram_oembed`). **Live: blocked, needs oEmbed Read approval.**

## Phase 5: Widget builder (code ✅, theme-editor check pending a dev-store install)
- [x] Stories, Carousel, Floating/PIP, Banner, Grid, Product gallery. AC: create, configure and preview each type (renderer DOM tests for all six).
- [x] Config and style settings. AC: strict `widgetConfigSchema` (unknown keys, non-hex colours and out-of-range values rejected) validated on client and server and re-validated on read.
- [x] Desktop and mobile preview, page targeting. AC: preview uses the storefront renderer with unsaved config; `matchesTargeting` tests cover home, products, tagged products, collections and page paths.
- [~] Publish, unpublish, theme editor onboarding. AC: publish snapshots config, targeting and videos (draft edits don't leak; tested); optimistic concurrency (409); onboarding checklist detects the app embed from `settings_data.json` and deep-links the theme editor. *The proxy that serves published data ships in Phase 6. **Live theme-editor check: blocked, needs a dev-store install and the Phase 6 extension.***

## Phase 6: Storefront SDK (code ✅, Playwright needs system libs, live dev-store test pending)
- [~] App blocks and app embed. AC: `instafeed-widget` app block and `instafeed-embed` app embed; the CLI validates the extension; the signed App Proxy serves only published snapshots (8 tests: signature, drafts, targeting, galleries, isolation, uninstall). **Live: blocked, run docs/STOREFRONT_TEST_PLAN.md on the dev store.**
- [x] Lazy loading, responsive layout, accessibility. AC: `instafeed.js` is 7.9 KB gzip (budget test < 12 KB); IntersectionObserver plus one batched request; hls.js lazy; dialog focus trap, Escape, focus restore, reduced motion (DOM tests). *Playwright e2e is written (14 cases, desktop and mobile) but needs `sudo pnpm exec playwright install-deps chromium` on WSL to run.*
- [x] Variants, popup, PDP redirect. AC: option-to-variant matching, sold-out disabled, preselected tagged variant, PDP with `?variant=` (DOM tests; e2e pending libs).
- [~] Add to Cart, loading states and error recovery. AC: `/cart/add.js` body, confirmation and View cart, Shopify 422 messages, product-load retry, proxy failure fails closed with one retry (DOM tests). **Live: dev-store plan.**

## Phase 7: Analytics and attribution (code ✅, live order test pending dev-store install)
- [x] Ingestion and deduplication. AC: duplicate eventIds are stored and counted once; v1 strict schema; foreign ids dropped; clock clamping; signed proxy, text/plain beacon and the 50-event cap; pixel endpoint only for known visitors.
- [x] Views, engagement, clicks, ATC. AC: storefront emits impressions, opens, start, pause, progress, complete, clicks, popup, variant and ATC (contract test against the server schema); consent respected; atomic daily counters in the store timezone.
- [~] Order webhook attribution. AC: duplicate deliveries give one order; DIRECT (line match, net of discounts, last touch), ASSISTED, NONE; configurable window with a late-event grace; cancelled and test orders excluded; JPY and KWD exponents. **Live: needs `orders/create` on the dev store and protected customer data level 1.**
- [x] Reports, charts, filters, CSV. AC: summary, rates, zero-filled timeseries, top videos, products and widgets, widget filter, range validation, CSV with formula-injection protection, isolation and roles; dashboard chart with tooltip and table view.

## Phase 8: Integrations and AI (code ✅, live provider tests need merchant credentials and an Anthropic key)
- [x] GA4, GTM. AC: ID validation; GA4 test via the Measurement Protocol debug endpoint; GTM dataLayer; GA4 "via GTM" skips gtag (no duplicates); only `instafeed_*` events (no duplicate ecommerce events).
- [x] Meta Pixel, CleverTap, Mixpanel. AC: validation; test events (Meta CAPI with test code, Mixpanel /track, CleverTap /1/upload by region); failures recorded with status, error and log; analytics consent gates GA4, GTM, Mixpanel and CleverTap; marketing consent gates Meta; secrets encrypted, never returned or sent to the storefront.
- [~] AI structured widget settings. AC: `claude-opus-5-5` via SDK structured outputs plus server re-validation; unknown keys, bad colours and refusals rejected; returns a diff and never saves; 20/hour per store; audited; flag `ai_assistant` plus `ANTHROPIC_API_KEY`. **Live: needs a key.**
- [x] Custom CSS and health checks. AC: CSS validator (HTML, @import, expression, javascript:, non-https url(), escapes, unbalanced braces) on client and server, scoped to the widget shadow root; per-integration status, last error and activity log in the UI.

## Phase 9: Billing and settings
- [ ] Free, Starter, Growth, Pro. AC: plans seeded; App Pricing webhook sync.
- [ ] Usage metering and entitlements. AC: server rejects over-limit requests with `PLAN_LIMIT`; 80% and 100% warnings.
- [ ] Upgrade, downgrade, cancel. AC: transition, grace period and duplicate-event tests.
- [ ] Domains, purchase flow, support tools. AC: audited support console; domain validation.

## Phase 10: Hardening and launch
- [ ] Security and isolation audit · [ ] Performance and cross-device · [ ] App Store compliance · [ ] Production deployment, monitoring, pilot (requires approval)

## TikTok readiness (SOW §6)
Tracked within Phase 4, 6 and 7 items. Developer approval and production scopes are **pending (owner action)**.

## Risk register
| Risk | Impact | Mitigation |
|---|---|---|
| TikTok Display API approval delayed or denied | No account import | URL embed path works without approval; feature flag |
| Third-party embeds blocked (privacy, ad blockers, region) | Video not shown | Thumbnail fallback with a "Watch on TikTok/YouTube" link |
| Shopify App Store review rejection | Launch delay | Run the `shopify-app-store-review` pre-check in Phase 10; GDPR webhooks from Phase 2 |
| Attribution disputes | Merchant trust | Documented window; direct vs assisted shown separately |
| Bunny cost spikes from viral video | Cost | Per-plan monthly view limits and usage alerts |
| Cross-tenant data leak | Critical | Context repositories, Prisma guard, isolation tests on every module |
