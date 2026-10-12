# Billing model (Shopify App Pricing)

Instafeed uses **Shopify App Pricing** (managed pricing). Plans, prices and trials live in the Partner/Dev Dashboard. The app never creates charges (no `appSubscriptionCreate`).

## Plans
| Plan | Handle | Price | Videos | Widgets | Views/month | Storage | Features |
|---|---|---|---|---|---|---|---|
| Free | `free` (or no subscription) | $0 | 10 | 1 | 2,000 | 1 GB | Stories, Carousel, Analytics |
| Starter | `starter` | $19 | 50 | 5 | 25,000 | 10 GB | + Floating |
| Growth | `growth` | $49 | 250 | 20 | 150,000 | 50 GB | + Banner, Grid, Gallery, Integrations, Custom CSS |
| Pro | `pro` | $149 | 2,000 | 100 | 1,000,000 | 250 GB | + AI assistant, TikTok and Instagram account import |

Limits and features are seeded in the `Plan` table (`apps/api/prisma/seed.ts`). **Video views** are player opens in the current calendar month, in the store's timezone. **Storage** is the total size of Bunny-hosted videos.

## Setup (owner action)
1. In the Dev Dashboard, open App → Pricing. Create the plans above with exactly these **plan handles**, and add display names and features.
2. Set the **welcome link** to `/app/billing/welcome`.
3. Create a **Partner API client** for your organization with access to app subscription data. Then set these in `.env`:
   ```
   SHOPIFY_PARTNER_ORG_ID=...        # number in the Partners Dashboard URL
   SHOPIFY_PARTNER_API_TOKEN=...     # Partner API client token
   SHOPIFY_APP_ID=...                # numeric app id
   SHOPIFY_APP_HANDLE=...            # app handle used in the plan selection URL
   ```
4. Until then the app runs with a local plan: Free, or `BILLING_DEV_PLAN` in development only, which is ignored in production.

## Subscription state
- App Pricing sends **no billing webhooks**. The Partner API `activeSubscription(appId, shopId)` is the source of truth. `null` means no subscription, which is the Free plan.
- Sync (`syncSubscription`) is idempotent and runs:
  - on the welcome redirect (the `plan_handle` URL parameter is only a hint);
  - on Billing → Refresh;
  - when cached state is more than 1 hour old;
  - daily at 02:15 UTC for all stores. This catches cancellations, freezes and failed renewals, which drop to Free.
- **Upgrade, downgrade and cancel** all happen on Shopify's hosted page: `https://admin.shopify.com/store/<handle>/charges/<app_handle>/pricing_plans`. Only the Owner sees the link.
- Plan changes are audited (`billing.plan_changed`). If the Partner API is unreachable, the last known plan is kept, so nobody is downgraded because of an outage.

## Entitlements (server-enforced; `PLAN_LIMIT`, HTTP 402)
- **Counts:** creating videos (all sources) and widgets.
- **Storage:** uploads, checked against the declared file size.
- **Features:** widget types (on create and on publish); integrations; custom CSS (clearing it is always allowed); AI assistant; creator-account import; analytics.
- **Storefront:**
  - Widget types not in the current plan stop being served, for example after a downgrade.
  - Integrations and custom CSS are only delivered on plans that include them.

## Usage warnings and grace period
- Warnings appear at **80%** of any limit and turn into "over" at 100%. They show on the Billing page and as a home-page banner.
- An hourly job (`usage-all`) starts a **grace period** (`BILLING_GRACE_DAYS`, default 7) when monthly views pass the limit. Widgets keep serving during the grace period. After it ends, the storefront serves no widgets until usage is back under the limit (new month or upgrade), when the grace period clears automatically. Each grace period is audited once.

## Not implemented (by design)
- **Usage-based charging through App Events:** current plans are flat-rate.
- **One-time purchases:** App Pricing doesn't support them.
