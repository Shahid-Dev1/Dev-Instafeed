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
- `GET /api/v1/videos/capabilities`: which sources are configured or enabled, plus provider connection status.
- `GET /api/v1/videos?q=&source=&status=&tag=&archived=&sort=newest|oldest|title&cursor=&limit=` returns `{ items, nextCursor }`. Each item includes its tagged `products[]`.
- `GET /api/v1/videos/:id` · `PATCH /api/v1/videos/:id` `{ title?, tags? }` · `DELETE /api/v1/videos/:id`
- `POST /api/v1/videos/import` `{ url }` (Editor+) accepts YouTube/Shorts, TikTok, or an Instagram Reel (flag). Returns 201, 400 when unavailable, or 409 for a duplicate (`details.videoId`).
- `POST /api/v1/videos/uploads` `{ title, bytes, contentType, rightsConfirmed: true }` returns 201 `{ videoId, tus: { endpoint, headers } }`. The browser uploads straight to Bunny; the API key is never exposed. Then call `POST /api/v1/videos/:id/upload-complete`.
- `PUT /api/v1/videos/:id/products` `[{ productId, variantId? }]` (up to 20, ordered) replaces the tags. Products must belong to the store and not be deleted, and a variant must belong to its product.
- `POST /api/v1/videos/bulk` `{ action: archive|unarchive|delete|addTags|removeTags, ids[≤100], tags? }` returns `{ affected }`.
- **Connections** (`tiktok` | `instagram`, behind feature flags): `POST /api/v1/connections/:p/start` (Admin+) returns `{ authorizeUrl }`. `GET /oauth/:p/callback` (public, single-use state) redirects back into the admin app. `GET /api/v1/connections/:p/videos?cursor=` and `POST /api/v1/connections/:p/import` `{ ids, rightsConfirmed? }` are Editor+. `DELETE /api/v1/connections/:p` (Admin+) revokes and disconnects.
- `PATCH /api/v1/videos/:id` · `DELETE /api/v1/videos/:id` · `POST /api/v1/videos/bulk` `{ ids, action: archive|unarchive|delete|tag }`

## Widgets
- `GET /api/v1/widgets` · `POST /api/v1/widgets` `{ name, type }` returns 201 with default config and targeting for the type.
- `GET /api/v1/widgets/:id` · `PATCH /api/v1/widgets/:id` `{ version, name?, config?, targeting?, videoIds? }` returns 409 if `version` is stale · `DELETE /api/v1/widgets/:id`
- `POST /api/v1/widgets/:id/publish` snapshots the draft; a manual widget needs ≥1 READY video. `POST /api/v1/widgets/:id/unpublish`
- `GET /api/v1/widgets/:id/preview?productId=` returns `{ payload }`: the same payload shape the storefront receives, built from the draft.
- `GET /api/v1/onboarding` returns `{ productsSynced, videoCount, publishedWidgets, appEmbed: enabled|disabled|unknown, themeEditorUrl }`.
- Schemas: `widgetConfigSchema`, `targetingSchema`, `widgetPayloadSchema` in `packages/shared/src/widgets.ts`.
- `POST /api/v1/ai/widget-config` `{ widgetId, prompt }` returns `{ config, diff }`. It never saves.

## Storefront (App Proxy `/apps/instafeed`, HMAC-verified, no auth)
- `GET /proxy/widgets?ids=&embed=1&page_type=&path=&product_id=&collection=` (+ Shopify's `shop`, `timestamp`, `signature`) returns `{ widgets: [{ placement: block|embed, payload }] }`. Blocks are returned by explicit id. The embed returns FLOATING widgets whose published targeting matches the page. Responses contain only published snapshots with READY videos, use `Cache-Control: public, max-age=60`, and are limited to 120 requests/min per IP.
- `POST /proxy/events`: a batch of up to 50 versioned events (`v: 1`). Returns 202.

## Analytics (Analyst+; dates are YYYY-MM-DD in the store timezone; max 366 days)
- `GET /api/v1/analytics/summary?from=&to=&widgetId=` returns `{ currency, timezone, attributionWindowDays, metrics, orders, rates }`.
- `GET /api/v1/analytics/timeseries` returns `{ days[] }` with every day in range. `GET /api/v1/analytics/videos|products|widgets` returns `{ rows[] }`.
- `GET /api/v1/analytics/export.csv?report=daily|videos|products|widgets&from=&to=`
- `GET /api/v1/settings/attribution` · `PATCH` `{ attributionWindowDays: 1–30 }` (Admin+)
- Ingestion: `POST /proxy/events` (App Proxy, signed, ≤50 events, returns 202) · `POST /pixel/events` (Web Pixel, known visitors only). See [ANALYTICS.md](ANALYTICS.md).

## Integrations, settings, billing
- `GET /api/v1/integrations` (Admin+) returns every kind with `{ connected, enabled, publicConfig, secretsSet[], events, status, lastError, logs }`. Secret values are never returned.
- `PUT /api/v1/integrations/:kind` `{ enabled, publicConfig, secrets?, events }`. Kinds are GA4, GTM, META, MIXPANEL and CLEVERTAP. An omitted `secrets` keeps the stored values; `null` clears them. Configs are validated per kind (`integrationConfigSchemas`).
- `POST /api/v1/integrations/:kind/test` returns `{ ok, message }` and updates status and log. `DELETE /api/v1/integrations/:kind`
- `GET|PUT /api/v1/settings/custom-css` `{ customCss }` (Admin+, validated by `customCssSchema`)
- `POST /api/v1/widgets/:id/ai` `{ prompt, config }` (Editor+, flag `ai_assistant`) returns `{ config, summary, changes[] }`. Nothing is saved.
- The `/proxy/widgets` response also includes `integrations` (public ids and event allow-lists of enabled destinations) and `customCss`.
- `GET /api/v1/billing` (plan, usage, limits) · `GET /api/v1/billing/manage-url`

## Webhooks (HMAC-verified and deduplicated on `X-Shopify-Webhook-Id`)
`POST /webhooks/shopify` and `POST /webhooks/shopify/compliance` (configured in `shopify.app.toml`). Phase 2 handles `app/uninstalled`, `app/scopes_update`, `customers/data_request`, `customers/redact` and `shop/redact`. Later phases add `products/create|update|delete`, `orders/create`, `app_subscriptions/update` and `POST /webhooks/bunny`. The Bunny webhook is checked with `X-BunnyStream-Signature` when `BUNNY_STREAM_WEBHOOK_KEY` is set, and is only ever a hint: the status is re-read from Bunny's API.

## Support (PlatformUser only, audited)
- `GET /support/stores?q=` · `GET /support/stores/:id/diagnostics`
