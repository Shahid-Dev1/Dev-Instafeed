# Security, privacy and tenancy

- **Shopify OAuth:** single-use `state` (10-minute TTL), constant-time HMAC check, shop domain regex `^[a-z0-9-]+\.myshopify\.com$`, offline token encrypted at rest.
- **Embedded requests:** App Bridge session token (HS256 JWT signed with the app secret). We verify `aud`, `exp`, `nbf` and `dest`, then map it to the store.
- **Email login:** argon2id hashes and an httpOnly SameSite=Lax secure cookie holding an opaque session token (hashed in DB). Login is rate-limited.
- **RBAC:** each route has a `minRole`. Server-side checks are authoritative, and the UI only hides controls.
- **Tenant isolation:** context-scoped repositories plus a Prisma guard extension. Tests cover access between Store A and Store B for every resource.
- **Webhooks and App Proxy:** HMAC is verified on the raw body or query, and `webhookId` deduplication makes processing idempotent.
- **Secrets:** env only, validated at boot. `.env` is git-ignored. The Admin API token never reaches browser or storefront code.
- **Storefront:** no secrets. The App Proxy limits data to published widgets. Events are rate-limited per IP and shop.
- **AI:** output is JSON validated against the `WidgetConfig` schema. Custom CSS is sanitized (no `@import`, `url(javascript:)` or `expression`). No AI-generated JavaScript ever runs.
- **Third-party video:** official APIs and embeds only, and we never download content.
- **Privacy:** we store no shopper PII; events use a random session ID. We handle the GDPR webhooks, delete data 48h after `shop/redact`, and integrations honour the Shopify Customer Privacy API consent.
- **Audit log** entries cover role changes, integration changes, billing changes, deletions and all support-console access.
