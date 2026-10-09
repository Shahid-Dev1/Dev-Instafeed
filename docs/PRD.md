# Product Requirements — Instafeed (Shoppable Video SaaS)

Source brief: [SOW.md](SOW.md). This document records the decisions and assumptions used to build the product.

## 1. Problem and goal
D2C brands on Shopify want short-form video (their own uploads, YouTube Shorts, TikTok) on their storefronts, with products tagged in the video, so shoppers can buy without leaving it. The platform must also attribute revenue to those videos.

## 2. Personas
| Persona | Needs |
|---|---|
| Store Owner | Installs the app, manages billing and the team, sees ROI |
| Marketer (Admin/Editor) | Uploads or imports videos, tags products, builds and publishes widgets |
| Analyst | Read-only access to analytics and exports |
| Shopper | Watches videos, views products, picks a variant, adds to cart |
| Support agent (internal) | Diagnoses merchant issues through the support console, with audit logging |

## 3. Roles and permissions
| Capability | Owner | Admin | Editor | Analyst |
|---|:-:|:-:|:-:|:-:|
| Billing, plan, uninstall data | ✔ | | | |
| Team and roles | ✔ | ✔ | | |
| Integrations, domains, custom CSS | ✔ | ✔ | | |
| Videos, products, widgets (write) | ✔ | ✔ | ✔ | |
| Analytics (read/export) | ✔ | ✔ | ✔ | ✔ |

Internal support users are a separate `PlatformUser` table. They never share merchant sessions, and every action they take is written to the audit log.

## 4. Key user journeys
1. **Install:** The merchant installs from the Shopify App Store. OAuth runs, then a Store and Owner are created. The merchant goes through onboarding (sync products, add first video, create widget, enable the app embed in the theme editor).
2. **Add video:** The merchant uploads a file (Bunny Stream processes it), pastes a YouTube or Shorts URL, pastes a TikTok URL, or connects a TikTok account (behind a feature flag) and picks videos.
3. **Tag products:** In the video, the merchant searches synced products, selects a product and optionally a variant, and orders the tags.
4. **Build widget:** The merchant chooses a type (Stories, Carousel, Floating/PIP, Banner, Grid, Product gallery), adds videos, styles it, previews it on desktop and mobile, targets pages and publishes.
5. **Shop:** The shopper sees a lazy-loaded widget and plays a video. They open the product popup, pick a variant and click Add to Cart (Shopify AJAX cart), or go to the product page.
6. **Measure:** Events are ingested, then the order webhook arrives and revenue is attributed. The dashboard shows views, CTR, add-to-carts and attributed revenue.
7. **Billing:** The merchant chooses a plan through Shopify App Pricing. Entitlements are enforced on the server, and usage warnings appear at 80% and 100%.

## 5. Video source rules (non-negotiable)
| Source | Mode | What we store | Playback |
|---|---|---|---|
| Upload | Merchant-owned file | Bunny Stream video GUID, HLS URL, thumbnail | Bunny HLS (hls.js lazy-loaded) |
| YouTube / Shorts | URL import (Data API v3 metadata) | videoId, title, duration, thumbnails, embeddable flag | Official IFrame player |
| TikTok URL | Public URL plus oEmbed | videoId, author, embed HTML/thumbnail | Official TikTok embed player |
| TikTok account | Login Kit plus Display API `video.list` (feature flag `tiktok_display_api`) | videoId, metadata, embed_link | Official embed |
| Instagram account | Instagram API with Instagram Login, `instagram_business_basic` (flag `instagram_api`). Business/Creator accounts only. | media id, caption, permalink. The merchant confirms ownership, and the owner's own Reel is copied to Bunny because `media_url` expires. | Bunny HLS, credited to the original permalink |
| Instagram Reel URL | Meta oEmbed (flag `instagram_oembed`, needs the oEmbed Read feature) | shortcode, author, thumbnail | Official Instagram embed |

We never scrape or download third-party video files.

## 6. Scope by release
- **MVP (Phases 0–7, 9):** Shopify install/auth, multi-tenancy, product sync, uploads, YouTube, TikTok URL, TikTok account (flagged), Stories, Carousel and Floating widgets, popup, variant selection and Add to Cart, analytics and attribution, billing.
- **V1:** Banner, Grid and Product gallery widgets; GA4, GTM, Meta, CleverTap and Mixpanel; AI customization; custom CSS; support console; CSV exports.
- **V2:** WooCommerce, agency multi-store dashboard, advanced AI (auto-tagging), A/B tests, R2 self-hosted storage adapter.

## 7. Decisions and assumptions
| # | Decision |
|---|---|
| D1 | Shopify-first public app, embedded in Shopify Admin (App Bridge, session tokens). Email/password login is also supported for team members. |
| D2 | Video hosting: **Bunny Stream** behind a `VideoStorageProvider` adapter |
| D3 | Billing: **Shopify App Pricing** (managed pricing) with plans Free, Starter, Growth and Pro. Entitlements live in our DB. |
| D4 | Storefront data and events go through the **Shopify App Proxy** (HMAC-verified), so no API keys appear in theme code |
| D5 | Attribution: the widget writes a `_ifv` cart attribute holding session and video IDs. The `orders/create` webhook reads it. The default window is 7 days and is configurable. |
| D6 | AI assistant: Anthropic Claude (`claude-sonnet-5-5`). Output must validate against the `WidgetConfig` Zod schema, and the feature is behind flag `ai_assistant`. |
| D7 | Local development uses native PostgreSQL 16 and Redis 7 in WSL (no Docker) |
| D8 | Package manager is pnpm workspaces. Node 24 LTS. |
| D9 | Instagram Reels were added at the owner's request (2026-10-09) and use official Meta APIs only. Reels from the merchant's own connected account are copied to Bunny after the merchant confirms ownership. Public Reel links are embedded via oEmbed, never downloaded. Instagram Login does not expose `media_product_type`, so VIDEO posts are treated as Reels. Reels whose `media_url` is withheld (licensed audio) cannot be imported. |
| D10 | Provider credentials are optional env vars. A missing provider shows as "not configured" rather than using placeholder keys. |

## 8. Non-functional requirements
- The storefront loader is ≤ 12 KB gzipped. Players are loaded only when visible (IntersectionObserver) or when the shopper interacts.
- Dashboard API p95 is < 300 ms. Event ingest p95 is < 100 ms (enqueue only).
- WCAG 2.1 AA for widgets: keyboard operation, focus trap in the popup, `prefers-reduced-motion`.
- GDPR and Shopify mandatory compliance webhooks (customers/data_request, customers/redact, shop/redact).
