# API contracts (v1)

Merchant API calls use `Authorization: Bearer <Shopify session token | dashboard session>`. Every route declares a minimum role. Bodies are validated with Zod schemas from `packages/shared`. Errors use the shape `{ error: { code, message, details? } }`, with codes `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `PLAN_LIMIT`, `PROVIDER_ERROR`, `RATE_LIMITED` and `INTERNAL`.

## Platform
- `GET /health`: liveness. `GET /health/ready`: DB and Redis checks.

## Auth and stores
- `GET /auth/shopify?shop=`: starts OAuth (creates a state). `GET /auth/shopify/callback`: verifies HMAC and state, exchanges the code and upserts the store.
- `POST /api/v1/auth/register|login|logout`, `POST /api/v1/auth/invites/accept`
- `GET /api/v1/me`: user, memberships, current store and role.
- `GET|POST|PATCH|DELETE /api/v1/team[/:userId]` (Admin+)

## Products (Editor+ for writes)
- `GET /api/v1/products?q=&status=&cursor=` · `GET /api/v1/products/:id`
- `POST /api/v1/products/sync` (enqueue) · `GET /api/v1/products/sync/status`

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
`app/uninstalled`, `products/create|update|delete`, `orders/create`, `app_subscriptions/update`, `customers/data_request`, `customers/redact`, `shop/redact`. Bunny video-status webhook (signature-verified).

## Support (PlatformUser only, audited)
- `GET /support/stores?q=` · `GET /support/stores/:id/diagnostics`
