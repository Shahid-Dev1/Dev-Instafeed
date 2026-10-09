# Data model

All tenant tables carry a `storeId` foreign key, with an index starting with `storeId`. IDs are cuid2. Timestamps are UTC. Money is stored as integer minor units plus a currency code.

| Entity | Key fields | Notes |
|---|---|---|
| Store | id, shopDomain (unique), name, currency, timezone, accessTokenEnc, accessTokenExpiresAt, refreshTokenEnc, refreshTokenExpiresAt, scopes, installedAt, uninstalledAt | Expiring offline tokens, encrypted. Uninstall sets uninstalledAt and wipes the tokens. shop/redact deletes the store (cascade). |
| User | id, email? (unique), passwordHash? (scrypt), name, shopifyUserId? (unique, `shop:sub`) | |
| Membership | storeId, userId, role (OWNER/ADMIN/EDITOR/ANALYST) | unique(storeId,userId) |
| Session | id, tokenHash (sha256, unique), userId, storeId?, expiresAt | Dashboard session for email login |
| Invite | storeId, email, role, tokenHash, expiresAt | |
| OAuthState | state, provider, storeId, expiresAt | Single use (Phase 4, TikTok) |
| Product | storeId, shopifyId (gid), handle, title, status, imageUrl, priceMin/Max, updatedAtShopify, deletedAt | unique(storeId, shopifyId) |
| Variant | storeId, productId, shopifyId, title, sku, price, available, options JSON | unique(storeId, shopifyId) |
| SyncRun | storeId, kind, status, cursor, counts, error | |
| Video | storeId, source (UPLOAD/YOUTUBE/TIKTOK_URL/TIKTOK_ACCOUNT), externalId, status (PENDING/PROCESSING/READY/FAILED/UNAVAILABLE), title, durationSec, thumbnailUrl, playbackUrl, embedHtml, aspectRatio, authorName, tags[], archivedAt, bytes | unique(storeId, source, externalId) for duplicate detection |
| VideoProduct | storeId, videoId, productId, variantId?, position, startSec? | |
| ProviderAccount | storeId, provider (TIKTOK), externalUserId, accessTokenEnc, refreshTokenEnc, expiresAt, scopes, status | |
| Widget | storeId, type (STORIES/CAROUSEL/FLOATING/BANNER/GRID/PRODUCT_GALLERY), name, status (DRAFT/PUBLISHED), config JSON (WidgetConfig), targeting JSON, version, publishedConfig JSON | |
| WidgetVideo | storeId, widgetId, videoId, position | |
| AnalyticsEvent | storeId, eventId (unique per store), v, type, sessionId, widgetId?, videoId?, productId?, variantId?, value?, occurredAt, receivedAt, meta JSON | Raw events, deduplicated on (storeId,eventId) |
| DailyStat | storeId, date (store timezone), widgetId?, videoId?, productId?, metric counters | Aggregates |
| Order | storeId, shopifyOrderId (unique per store), totalMinor, currency, createdAtShopify, attributed (DIRECT/ASSISTED/NONE), attributedVideoId?, attributedMinor | Idempotent on webhook |
| WebhookReceipt | webhookId (unique), topic, shopDomain, receivedAt | Deduplication, written in the same transaction as the handler |
| Integration | storeId, kind (GA4/GTM/META/CLEVERTAP/MIXPANEL), enabled, configEnc, status, lastError, lastCheckedAt | |
| Plan | id (FREE/STARTER/GROWTH/PRO), limits JSON (videos, widgets, monthlyViews, storageGb), features[] | Seeded |
| Subscription | storeId, planId, shopifySubscriptionId, status, currentPeriodEnd, graceUntil | |
| UsageCounter | storeId, period (YYYY-MM), views, storageBytes | |
| StoreSettings | storeId, customCss, purchaseFlow (POPUP/PDP), authorizedDomains[], attributionWindowDays | |
| FeatureFlag | key, storeId?, enabled | |
| AuditLog | storeId?, actorType, actorId, action, target, meta, ip, at | Append-only |
| PlatformUser | id, email, role (SUPPORT/ADMIN) | Internal staff |
