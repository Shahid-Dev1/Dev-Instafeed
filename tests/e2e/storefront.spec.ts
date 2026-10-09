import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Local storefront harness: a minimal Shopify-like page that loads the real built extension asset.
 * Shopify endpoints (app proxy, product .js, cart) are stubbed at the network layer. This is NOT a
 * substitute for the dev-store test plan (docs/STOREFRONT_TEST_PLAN.md).
 */
const BUNDLE = readFileSync(new URL('../../extensions/instafeed-theme/assets/instafeed.js', import.meta.url), 'utf8');
const SHOP = 'https://demo-shop.test';
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const config = (type: string, extra: Record<string, unknown> = {}) => ({
  source: 'manual',
  style: { title: 'Shop the look', titleAlign: 'left', fontFamily: 'inherit', titleSize: 20, textSize: 14, textColor: '#111111', background: '#ffffff', transparentBackground: true, accentColor: '#d6336c', accentTextColor: '#ffffff', cardRadius: 12, borderWidth: 0, borderColor: '#e5e5e5', gap: 12, padding: 16 },
  desktop: { show: true, itemSize: type === 'FLOATING' ? 160 : 200, columns: 4 },
  mobile: { show: true, itemSize: type === 'FLOATING' ? 110 : 150, columns: 2 },
  playback: { autoplay: true, muted: true, loop: true, showControls: false },
  cta: { label: 'Shop now', action: 'POPUP' },
  product: { display: 'overlay', showPrice: true, maxProducts: 3 },
  floating: { position: 'bottom-right', closable: true },
  ...extra,
});
const product = { id: 'p1', shopifyId: 'gid://shopify/Product/101', handle: 'vitamin-c', title: 'Vitamin C Serum', imageUrl: `${SHOP}/img.png`, price: '499.00', variantId: null, shopifyVariantId: null };
const video = (n: number) => ({
  id: `v${n}`, source: 'YOUTUBE', title: `Routine ${n}`, thumbnailUrl: `${SHOP}/img.png`, playbackUrl: null,
  embedUrl: 'https://www.youtube-nocookie.com/embed/abcdefghijk', permalink: 'https://www.youtube.com/shorts/abcdefghijk', authorName: 'Brand', width: 1080, height: 1920, products: [product],
});

async function setup(page: Page, opts: { cartStatus?: number; ctaAction?: 'POPUP' | 'PDP' } = {}) {
  const proxyCalls: string[] = [];
  const cartBodies: unknown[] = [];
  await page.route(`${SHOP}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') {
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
          <script>window.Shopify = { routes: { root: '/' }, currency: { active: 'INR' } };</script></head>
          <body><h1>Demo store</h1><div style="height:900px">Hero</div>
          <instafeed-widget data-widget-id="w1" data-page-type="index" data-path="/"></instafeed-widget>
          <instafeed-embed data-page-type="index" data-path="/"></instafeed-embed>
          <script src="/instafeed.js" defer></script></body></html>`,
      });
    }
    if (url.pathname === '/instafeed.js') return route.fulfill({ contentType: 'application/javascript', body: BUNDLE });
    if (url.pathname === '/img.png') return route.fulfill({ contentType: 'image/png', body: PIXEL });
    if (url.pathname === '/apps/instafeed/widgets') {
      proxyCalls.push(url.search);
      return route.fulfill({
        json: {
          widgets: [
            { placement: 'block', payload: { id: 'w1', type: 'CAROUSEL', version: 1, currency: 'INR', config: config('CAROUSEL', { cta: { label: 'Shop now', action: opts.ctaAction ?? 'POPUP' } }), videos: [video(1), video(2), video(3)] } },
            { placement: 'embed', payload: { id: 'w2', type: 'FLOATING', version: 1, currency: 'INR', config: config('FLOATING'), videos: [video(4)] } },
          ],
        },
      });
    }
    if (url.pathname === '/products/vitamin-c.js') {
      return route.fulfill({
        json: {
          id: 101, title: 'Vitamin C Serum', handle: 'vitamin-c', featured_image: `${SHOP}/img.png`, options: [{ name: 'Size', values: ['30ml', '50ml'] }],
          variants: [
            { id: 1001, title: '30ml', price: 49900, available: true, options: ['30ml'] },
            { id: 1002, title: '50ml', price: 79900, available: false, options: ['50ml'] },
          ],
        },
      });
    }
    if (url.pathname === '/cart/add.js') {
      cartBodies.push(route.request().postDataJSON());
      return opts.cartStatus === 422
        ? route.fulfill({ status: 422, json: { status: 422, message: 'Cart Error', description: 'You can only add 1 of this item.' } })
        : route.fulfill({ json: { id: 1001 } });
    }
    if (url.pathname.startsWith('/products/')) return route.fulfill({ contentType: 'text/html', body: '<h1>Product page</h1>' });
    return route.fulfill({ status: 404, body: '' });
  });
  // Third-party players are not loaded in tests.
  await page.route('https://www.youtube-nocookie.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>YouTube player</p>' }));
  await page.goto(SHOP);
  return { proxyCalls, cartBodies };
}

const widget = (page: Page) => page.locator('instafeed-widget');

test('loads lazily with one request and renders block and floating widgets', async ({ page }) => {
  const { proxyCalls } = await setup(page);
  await widget(page).scrollIntoViewIfNeeded();
  await expect(widget(page).locator('.if-card')).toHaveCount(3);
  await expect(page.locator('instafeed-embed .if-floating')).toBeVisible();
  expect(proxyCalls).toHaveLength(1);
  expect(new URLSearchParams(proxyCalls[0])).toEqual(new URLSearchParams('page_type=index&path=%2F&ids=w1&embed=1'));
});

test('player: opens, navigates by keyboard, shows attribution, closes with Escape', async ({ page }) => {
  await setup(page);
  await widget(page).scrollIntoViewIfNeeded();
  await widget(page).getByRole('button', { name: 'Play video: Routine 1' }).click();
  const dialog = page.getByRole('dialog', { name: 'Shoppable video' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.pl-title')).toHaveText('Routine 1');
  await expect(dialog.locator('iframe')).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/abcdefghijk\?autoplay=1&mute=1/);
  await expect(dialog.locator('.pl-source')).toContainText('Video from YouTube');
  await page.keyboard.press('ArrowRight');
  await expect(dialog.locator('.pl-title')).toHaveText('Routine 2');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('popup: variant selection, sold-out state and Add to Cart confirmation', async ({ page }) => {
  const { cartBodies } = await setup(page);
  await widget(page).scrollIntoViewIfNeeded();
  await widget(page).getByRole('button', { name: 'Shop now' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Vitamin C Serum' });
  await expect(dialog.locator('.pp-price')).toContainText('499');
  await dialog.getByLabel('Size').selectOption('50ml');
  await expect(dialog.locator('.pp-btn')).toHaveText('Sold out');
  await dialog.getByLabel('Size').selectOption('30ml');
  await dialog.getByRole('button', { name: 'Add to cart' }).click();
  await expect(dialog.locator('.pp-ok')).toContainText('Added to cart');
  await expect(dialog.getByRole('link', { name: 'View cart' })).toHaveAttribute('href', '/cart');
  expect(cartBodies).toEqual([{ items: [{ id: 1001, quantity: 1 }] }]);
});

test('popup: shows Shopify cart errors', async ({ page }) => {
  await setup(page, { cartStatus: 422 });
  await widget(page).scrollIntoViewIfNeeded();
  await widget(page).getByRole('button', { name: 'Shop now' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Vitamin C Serum' });
  await dialog.getByRole('button', { name: 'Add to cart' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('You can only add 1 of this item.');
});

test('PDP action redirects to the product page', async ({ page }) => {
  await setup(page, { ctaAction: 'PDP' });
  await widget(page).scrollIntoViewIfNeeded();
  await widget(page).getByRole('button', { name: 'Shop now' }).first().click();
  await expect(page).toHaveURL(`${SHOP}/products/vitamin-c`);
});

test('keyboard users can reach and operate widgets; floating video can be closed', async ({ page }) => {
  await setup(page);
  await widget(page).scrollIntoViewIfNeeded();
  await expect(widget(page).locator('.if-card')).toHaveCount(3);
  const play = widget(page).getByRole('button', { name: 'Play video: Routine 1' });
  await play.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Shoppable video' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(play).toBeFocused();
  await page.locator('instafeed-embed').getByRole('button', { name: 'Close video' }).click();
  await expect(page.locator('instafeed-embed .if-floating')).toHaveCount(0);
});

test('respects reduced motion (no animated previews)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page);
  await widget(page).scrollIntoViewIfNeeded();
  await expect(widget(page).locator('.if-card img').first()).toHaveAttribute('src', `${SHOP}/img.png`);
});
