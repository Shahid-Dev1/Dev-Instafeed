# API contracts (v1)

Merchant API calls use `Authorization: Bearer <Shopify session token | dashboard session>`. Every route declares a minimum role. Bodies are validated with Zod schemas from `packages/shared`. Errors use the shape `{ error: { code, message, details? } }`, with codes `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `PLAN_LIMIT`, `PROVIDER_ERROR`, `RATE_LIMITED` and `INTERNAL`.

## Platform
- `GET /health`: liveness. `GET /health/ready`: DB and Redis checks.

## Auth and stores
- **Embedded install/auth:** any `/api/v1/*` call with `Authorization: Bearer <App Bridge session token>`. The first call installs the store through token exchange; there is no separate OAuth route.
- **Dashboard auth:** `POST /api/v1/auth/register` (201) · `POST /api/v1/auth/login` · `POST /api/v1/auth/logout`. These set or clear the `ifs_session` cookie. Optional `x-store-id` header selects a store the user belongs to.
- `GET /api/v1/me`: `{ user, memberships[], current }` (`meSchema`).
- `GET /api/v1/team` · `PATCH /api/v1/team/:userId` `{ role: ADMIN|EDITOR|ANALYST }` · `DELETE /api/v1/team/:userId`. All require Admin or above. The owner and the caller themselves cannot be changed. Invites arrive in Phase 9.

## Products (Editor+ for writes)
- `GET /api/v1/products?q=&status=&cursor=&limit=` (Analyst+) returns `{ items, nextCursor }`. `q` matches title, handle or variant SKU (case-insensitive). Deleted products are excluded.
- `GET /api/v1/products/:id` (Analyst+) returns a summary plus `variants[]` (price as a decimal string in the store currency).
- `POST /api/v1/products/sync` (Editor+) returns 202 `{ syncRun }`. It reuses the active run if one is queued or running.
- `GET /api/v1/products/sync/status` returns `{ syncRun | null }` (latest run).

## Videos
- `GET /api/v1/videos?q=&source=&status=&tag=&archived=&sort=&cursor=`
- `POST /api/v1/videos/uploads`: returns a Bunny TUS upload URL and signature. `POST /api/v1/videos/import` `{ url }` handles YouTube or TikTok.
- `GET /api/v1/integrations/tiktok/connect`, `/callback`, `GET /api/v1/tiktok/videos?cursor=`, `POST /api/v1/tiktok/import` `{ ids[] }`, `DELETE /api/v1/integrations/tiktok`
- `PATCH /api/v1/videos/:id` · `DELETE /api/v1/videos/:id` · `POST /api/v1/videos/bulk` `{ ids, action: archive|unarchive|delete|tag }`
- `PUT /api/v1/videos/:id/products` `[{ productId, variantId?, position }]`

## Widgets
- `GET|POST /api/v1/widgets` · `GET|PATCH|DELETE /api/v1/widgets/:id` · `POST /api/v1/widgets/:id/publish|unpublish`
- `POST /api/v1/ai/widget-config` `{ widgetId, prompt }` returns `{ config, diff }`. It never saves.

## Storefront (App Proxy `/apps/instafeed`, HMAC-verified, no auth)
- `GET /proxy/widgets?page=&productId=`: published widgets, videos and products for that page.
- `POST /proxy/events`: a batch of up to 50 versioned events (`v: 1`). Returns 202.

## Analytics
- `GET /api/v1/analytics/summary|timeseries|top-videos|top-products|widgets?from=&to=&widgetId=` (in store timezone)
- `GET /api/v1/analytics/export.csv?report=&from=&to=`

## Integrations, settings, billing
- `GET|PUT /api/v1/integrations/:kind` · `POST /api/v1/integrations/:kind/test` · `DELETE /api/v1/integrations/:kind`
- `GET|PATCH /api/v1/settings` (custom CSS, purchase flow, domains, attribution window)
- `GET /api/v1/billing` (plan, usage, limits) · `GET /api/v1/billing/manage-url`

## Webhooks (HMAC-verified and deduplicated on `X-Shopify-Webhook-Id`)
`POST /webhooks/shopify` and `POST /webhooks/shopify/compliance` (configured in `shopify.app.toml`). Phase 2 handles `app/uninstalled`, `app/scopes_update`, `customers/data_request`, `customers/redact` and `shop/redact`. Later phases add `products/create|update|delete`, `orders/create`, `app_subscriptions/update` and the signature-verified Bunny video-status webhook (signature-verified).

## Support (PlatformUser only, audited)
- `GET /support/stores?q=` · `GET /support/stores/:id/diagnostics`
