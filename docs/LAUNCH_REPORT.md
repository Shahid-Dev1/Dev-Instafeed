# Launch report (Phase 10)

_Date: 2026-10-12. Status: **code-complete and launch-ready pending owner actions. Not deployed.**_

## Verification (actual results)
| Check | Result |
|---|---|
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | pass / pass / pass |
| Unit and integration tests | **255 / 255 pass** (API 197, storefront SDK 30, shared 23, dashboard 5) |
| Security tests | Route inventory: every non-allowlisted route returns 401 unauthenticated; cross-store GET by id never leaks; `shop/redact` empties all 20+ store-owned tables; per-module isolation and role tests |
| Dependency audit (`pnpm audit --prod`) | 0 known vulnerabilities (3 transitive advisories in the Prisma CLI fixed via pnpm overrides) |
| Secrets scan (tree and full git history) | none found; `.env` never committed |
| Storefront bundle | 9.3 KB gzip (budget 12 KB, enforced by test); hls.js lazy-loaded |
| Backups | `deploy/backup.sh` dump and verified restore into a scratch DB (27 tables) |
| Shopify CLI config | app, theme extension and web pixel recognized |
| App Store self-review | 31 likely passing, 0 failing, 3 needs review (see below) |

## Failed or blocked tests
- **Playwright e2e (14 cases): not run.** Chromium needs system libraries on WSL: `sudo pnpm exec playwright install-deps chromium`. CI installs them automatically.
- **Live checks not run:**
  - dev-store install, product sync and theme editor;
  - real Bunny, YouTube, TikTok, Instagram, Meta and Anthropic calls;
  - App Pricing checkout;
  - order attribution with a real order;
  - Lighthouse on a real theme.

  All provider calls are tested against in-memory fakes only. Follow docs/STOREFRONT_TEST_PLAN.md.
- **Deploy artifacts:** `deploy/Dockerfile` and compose are **untested** (no Docker locally). Validate them in staging.

## App Store self-review: items needing attention
1. **2.2.3 App Bridge first script:** App Bridge loads from the CDN in the embedded root layout's `<head>` (`beforeInteractive`, preloaded). Next.js 16/React 19 always emits its own async chunks first, so it isn't literally the first `<script>` tag. The client waits for App Bridge before any authenticated call. Confirm with Shopify review or the App Bridge docs for Next.js.
2. **1.2.2 Billing implementation:** App Pricing plans (handles `free/starter/growth/pro`) and the welcome link must be configured. Verify declining a plan and resubscribing after reinstall on a dev store.
3. **3.1.1 TLS:** production HTTPS is configured via Caddy (auto certificates and redirect) and HSTS, but not deployed yet.

## Known limitations
- Embedded third-party players (YouTube, TikTok, Instagram) report opens and starts only, not progress.
- Attribution needs the `_ifv` cart attribute (same browser, analytics consent).
- Instagram Reels with licensed audio cannot be imported (Instagram withholds the file). Instagram Login doesn't expose `media_product_type`, so all VIDEO posts are listed.
- Bunny webhook signature format comes from third-party documentation. The webhook is only a hint; status is always re-read from Bunny.
- No email delivery: team invites are shared as links.
- The dashboard uses plain HTML rather than Polaris (not required for this category, but recommended for UX).
- Next.js App Router can't place App Bridge as the literal first script (see above).

## Outstanding approvals and owner actions
| Item | Owner action |
|---|---|
| Rotate the Shopify client secret (shared in chat) | Dev Dashboard → regenerate, update `.env` |
| Protected customer data (Level 1) for `read_orders` | Dev Dashboard → API access |
| New scopes `write_pixels`, `read_customer_events` | Approve on next `shopify app dev` |
| App Pricing plans, welcome link, Partner API token | docs/BILLING.md |
| Bunny Stream, YouTube key, TikTok and Meta apps (and their review), Anthropic key | docs/DEPLOYMENT.md table |
| Production host, domain, managed Postgres/Redis | Decide; then staging → production with explicit approval |
| Legal review of PRIVACY_POLICY.md and TERMS.md, then host them publicly | Counsel |
| Listing assets (icon, screenshots, demo store) | docs/APP_LISTING.md |

## Operational costs (pilot estimate)
~$30–75/month: VPS $10–20, managed Postgres/Redis $15–40, Bunny $1–10, domain ~$1, Anthropic ≈ $0.01 per AI suggestion. See docs/DEPLOYMENT.md.

## Rollback procedure
App: redeploy the previous tag (migrations are additive). Extensions: release the previous app version in the Partner Dashboard. Data: managed snapshot, or `pg_restore` from the nightly dump. Pilot store: disable the app embed or blocks instantly. Details in docs/DEPLOYMENT.md.
