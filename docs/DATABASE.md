# Data model

All tenant tables carry a `storeId` foreign key, with an index starting with `storeId`. IDs are cuid2. Timestamps are UTC. Money is stored as integer minor units plus a currency code.

| Entity | Key fields | Notes |
|---|---|---|
| Store | id, shopDomain (unique), name, currency, timezone, accessTokenEnc, accessTokenExpiresAt, refreshTokenEnc, refreshTokenExpiresAt, scopes, installedAt, uninstalledAt | Expiring offline tokens, encrypted. Uninstall sets uninstalledAt and wipes the tokens. shop/redact deletes the store (cascade). |
| User | id, email? (unique), passwordHash? (scrypt), name, shopifyUserId? (unique, `shop:sub`) | |
| Membership | storeId, userId, role (OWNER/ADMIN/EDITOR/ANALYST) | unique(storeId,userId) |
| Session | id, tokenHash (sha256, unique), userId, storeId?, expiresAt | Dashboard session for email login |
| Invite | storeId, email, role, tokenHash, expiresAt | |
| OAuthState | stateHash (sha256, unique), storeId, userId, provider, expiresAt | Single use (consumed with DELETE … RETURNING), 10-minute TTL |
| Product | storeId, shopifyId (gid), handle, title, status, imageUrl, priceMin/Max (decimal), totalVariants, shopifyUpdatedAt, syncedAt, deletedAt | unique(storeId, shopifyId). Soft-deleted (deletedAt) so video tags survive and restored products reappear. |
| Variant | storeId, productId, shopifyId, title, sku, price (decimal), availableForSale, options JSON, imageUrl, position | unique(storeId, shopifyId). Variants removed in Shopify are hard-deleted. |
| SyncRun | storeId, kind (PRODUCTS_FULL), status (QUEUED/RUNNING/SUCCEEDED/FAILED), trigger (MANUAL/INSTALL/SCHEDULED), upserted, deleted, error, startedAt, finishedAt | |
| Video | storeId, source (UPLOAD/YOUTUBE/TIKTOK_URL/TIKTOK_ACCOUNT/INSTAGRAM_ACCOUNT/INSTAGRAM_URL), externalId, bunnyVideoId?, status (PENDING/PROCESSING/READY/FAILED/UNAVAILABLE), statusMessage, title, durationSec, width, height, thumbnailUrl, playbackUrl (HLS), embedUrl (official player), permalink, authorName, tags[], bytes, archivedAt, checkedAt, createdById | unique(storeId, source, externalId) for duplicate detection |
| VideoProduct | storeId, videoId, productId, variantId?, position | unique(storeId, videoId, productId). Removing a variant sets the tag to product-level. |
| ProviderAccount | storeId, provider (TIKTOK/INSTAGRAM), externalUserId, username, accessTokenEnc, accessTokenExpiresAt, refreshTokenEnc?, refreshTokenExpiresAt?, scopes, status (ACTIVE/REAUTH_REQUIRED), lastError | unique(storeId, provider), tokens encrypted | |
| Widget | storeId, type (STORIES/CAROUSEL/FLOATING/BANNER/GRID/PRODUCT_GALLERY), name, status (DRAFT/PUBLISHED), config JSON, targeting JSON, version, publishedConfig, publishedTargeting, publishedVideoIds[], publishedVersion, publishedAt | Draft vs published snapshot; `version` for optimistic concurrency |
| WidgetVideo | storeId, widgetId, videoId, position | Draft video order; unique(storeId, widgetId, videoId) |
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
