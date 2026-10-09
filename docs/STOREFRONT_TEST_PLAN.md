# Storefront test plan (Shopify development store)

Automated coverage: proxy and API (Vitest), the runtime in a DOM (happy-dom), and the built bundle in Chromium on a local demo storefront (Playwright, `pnpm test:e2e`). The following must still be verified on a **real development store** before the storefront integration counts as live.

## Setup
1. Run `shopify app dev` and open the app in the dev store (this installs it, syncs products and pushes the theme extension).
2. Add ≥3 READY videos (upload, YouTube, TikTok), tag products (including one with variants and one sold-out variant).
3. Create and publish: a Carousel (homepage), a Product gallery (product pages), and a Floating widget (homepage).
4. Theme editor: add the **Shoppable videos** app block to the homepage and paste the Carousel's widget ID. Add another block on the product template with the Gallery ID. Turn on the **Instafeed videos** app embed. Save.

## Checks (desktop Chrome and Safari, plus iOS Safari and Android Chrome)
| # | Check | Expected |
|---|---|---|
| 1 | Homepage loads | Carousel renders when scrolled near; one `/apps/instafeed/widgets` request (Network tab); no console errors |
| 2 | Theme editor preview | Blocks render in the editor; an empty Widget ID shows the hint |
| 3 | Play uploaded video | HLS plays (native on Safari; hls.js loaded only on Chrome/Firefox) |
| 4 | Play YouTube / TikTok | Official player loads; attribution and "View original" link shown |
| 5 | Navigation | Arrow keys and swipe change videos; Escape closes; focus returns to the card |
| 6 | Popup | Variant options change the price; sold-out variant disables the button |
| 7 | Add to Cart | Item is in `/cart` with the correct variant and quantity; "View cart" works |
| 8 | Cart limits | Exceeding inventory shows Shopify's error message |
| 9 | PDP action | With the CTA set to "Go to product page", it opens the product URL (with variant) |
| 10 | Product page | Gallery shows only videos tagged with that product |
| 11 | Floating | Appears on the homepage only; close button hides it |
| 12 | Unpublish | After unpublishing (allow 60s cache), the widget disappears |
| 13 | Uninstall | After uninstalling the app, the proxy returns no widgets |
| 14 | Performance | Lighthouse mobile: no layout shift from blocks (set "Reserved height"); `instafeed.js` ≤ 12 KB gzip |
| 15 | Accessibility | Keyboard-only flow works; screen reader announces dialog names; reduced motion disables animated previews |
| 16 | Markets/locales | On a `/fr` locale the proxy URL is `/fr/apps/instafeed` and links keep the locale |

Record results (store, theme, browser, pass/fail, screenshots) in CHECKLIST.md.
