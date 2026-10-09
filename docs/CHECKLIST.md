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

## Phase 5: Widget builder
- [ ] Stories, Carousel, Floating/PIP (plus Banner, Grid, Gallery). AC: create, configure and preview each type.
- [ ] Config and style settings. AC: WidgetConfig schema validated on client and server.
- [ ] Desktop and mobile preview, page targeting. AC: preview toggle; targeting rules tested.
- [ ] Publish, unpublish, theme editor onboarding. AC: only published config is served through the proxy.

## Phase 6: Storefront SDK
- [ ] App blocks and app embed. AC: `shopify app dev` renders on the dev store (live).
- [ ] Lazy loading, responsive layout, accessibility. AC: loader ≤12 KB gz; keyboard and reduced-motion e2e.
- [ ] Variants, popup, PDP redirect. AC: e2e on the demo page.
- [ ] Add to Cart, loading and error states. AC: e2e with the cart endpoint stubbed; live test on the dev store.

## Phase 7: Analytics and attribution
- [ ] Ingestion and deduplication. AC: duplicate eventIds are stored once; schema version is checked.
- [ ] Views, engagement, clicks, ATC. AC: aggregate job tests.
- [ ] Order webhook attribution. AC: window boundary, duplicate order, delayed order, currency tests.
- [ ] Reports, charts, filters, CSV. AC: timezone-correct day buckets; CSV export test.

## Phase 8: Integrations and AI
- [ ] GA4, GTM. AC: config validation, test event, no duplicate sends.
- [ ] Meta Pixel, CleverTap, Mixpanel. AC: same, and consent is respected.
- [ ] AI structured widget settings. AC: invalid AI output is rejected; preview happens before save; behind a flag.
- [ ] Custom CSS and health checks. AC: sanitizer tests; health status shown.

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
