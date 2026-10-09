import type { PayloadVideo, WidgetConfig } from '@instafeed/shared';
import { el, safeUrl } from '../dom.ts';
import { openOverlay } from './overlay.ts';
import { addToCart, fetchProduct, money, numericId, productUrl, root, StorefrontError, type AjaxProduct, type AjaxVariant } from './shopify.ts';
import { track } from './events.ts';

type PayloadProduct = PayloadVideo['products'][number];

const CSS = `
.panel { width: min(420px, 100vw); padding: 20px; }
.pp-img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; background: #f3f3f3; }
.pp-title { font-size: 18px; margin: 12px 0 4px; }
.pp-price { font-size: 16px; margin: 0 0 12px; }
label { display: block; margin: 8px 0; }
select, input { display: block; width: 100%; padding: 8px; margin-top: 4px; font: inherit; }
.pp-btn { all: unset; box-sizing: border-box; display: block; width: 100%; text-align: center; padding: 12px; margin-top: 12px; border-radius: 8px; cursor: pointer;
  background: var(--accent); color: var(--accent-text); font-weight: 600; }
.pp-btn[aria-disabled="true"] { opacity: .5; cursor: not-allowed; }
.pp-link { display: block; text-align: center; margin-top: 10px; color: inherit; }
.pp-msg { margin-top: 10px; }
.pp-err { color: #b42318; }
.pp-ok { color: #067647; font-weight: 600; }
.pp-skel { height: 320px; border-radius: 8px; background: #f3f3f3; }
`;

/** Matches the selected option values to a variant (Shopify supports up to 3 options per product). */
const findVariant = (p: AjaxProduct, values: string[]) => p.variants.find((v) => v.options.every((o, i) => o === values[i]));

export function openProductPopup(product: PayloadProduct, config: WidgetConfig, ctx: { widgetId: string; videoId: string }) {
  const ov = openOverlay(product.title, CSS);
  ov.panel.style.setProperty('--accent', config.style.accentColor);
  ov.panel.style.setProperty('--accent-text', config.style.accentTextColor);
  const body = el('div', { 'aria-live': 'polite' }, [el('div', { class: 'pp-skel', 'aria-label': 'Loading product' })]);
  ov.panel.append(body);
  track('product_popup_open', { ...ctx, productId: product.id });

  const render = (p: AjaxProduct) => {
    const preferred = p.variants.find((v) => String(v.id) === numericId(product.shopifyVariantId)) ?? p.variants.find((v) => v.available) ?? p.variants[0]!;
    const values = [...preferred.options];
    const img = el('img', { class: 'pp-img', alt: p.title, src: safeUrl(preferred.featured_image?.src ?? p.featured_image ?? product.imageUrl) ?? '' });
    const price = el('p', { class: 'pp-price' });
    const msg = el('div', { class: 'pp-msg', role: 'status' });
    const qty = el('input', { type: 'number', min: 1, max: 99, value: 1, inputmode: 'numeric', 'aria-label': 'Quantity' });
    const btn = el('button', { class: 'pp-btn', type: 'button' }, ['Add to cart']);
    const details = el('a', { class: 'pp-link', href: productUrl(p.handle, preferred.id) }, ['View full details']);
    let variant: AjaxVariant | undefined = preferred;
    let busy = false;

    const sync = () => {
      variant = findVariant(p, values);
      const unavailable = !variant || !variant.available;
      price.textContent = variant ? money(variant.price) : 'Unavailable';
      btn.textContent = !variant ? 'Unavailable' : variant.available ? 'Add to cart' : 'Sold out';
      btn.setAttribute('aria-disabled', String(unavailable || busy));
      if (variant?.featured_image?.src && safeUrl(variant.featured_image.src)) img.src = variant.featured_image.src;
      if (variant) details.setAttribute('href', productUrl(p.handle, variant.id));
    };

    const selects = p.options.length > 1 || p.variants.length > 1
      ? p.options.map((o, i) =>
          el('label', {}, [o.name, el('select', { onchange: (e: Event) => { values[i] = (e.target as HTMLSelectElement).value; sync(); track('variant_select', { ...ctx, productId: product.id }); } },
            o.values.map((v) => { const opt = el('option', { value: v }, [v]); if (v === values[i]) opt.selected = true; return opt; }))]),
        )
      : [];

    btn.addEventListener('click', async () => {
      if (busy || !variant?.available) return;
      const quantity = Math.min(99, Math.max(1, Math.floor(Number(qty.value)) || 1));
      busy = true;
      btn.textContent = 'Adding…';
      btn.setAttribute('aria-busy', 'true');
      msg.replaceChildren();
      try {
        await addToCart(variant.id, quantity);
        track('add_to_cart', { ...ctx, productId: product.id, variantId: String(variant.id), quantity, value: variant.price * quantity });
        msg.replaceChildren(el('span', { class: 'pp-ok' }, ['Added to cart ✓ ']), el('a', { href: `${root()}cart` }, ['View cart']));
        document.dispatchEvent(new CustomEvent('instafeed:added-to-cart', { detail: { variantId: variant.id, quantity } }));
      } catch (e) {
        msg.replaceChildren(el('span', { class: 'pp-err', role: 'alert' }, [e instanceof StorefrontError ? e.message : 'Something went wrong. Please try again.']));
      } finally {
        busy = false;
        btn.removeAttribute('aria-busy');
        sync();
      }
    });

    sync();
    body.replaceChildren(img, el('h2', { class: 'pp-title' }, [p.title]), price, ...selects, el('label', {}, ['Quantity', qty]), btn, msg, details);
  };

  const load = () =>
    fetchProduct(product.handle).then(render, (e: unknown) => {
      const retry = el('button', { class: 'pp-btn', type: 'button', onclick: () => { body.replaceChildren(el('div', { class: 'pp-skel' })); void load(); } }, ['Try again']);
      body.replaceChildren(el('p', { class: 'pp-err', role: 'alert' }, [e instanceof StorefrontError ? e.message : 'Could not load the product.']), retry,
        el('a', { class: 'pp-link', href: productUrl(product.handle) }, ['Open product page']));
    });
  void load();
  return ov;
}

/** CTA routing shared by cards and the player: popup with Add to Cart, or straight to the product page. */
export function shopProduct(product: PayloadProduct | undefined, config: WidgetConfig, ctx: { widgetId: string; videoId: string }) {
  if (!product) return;
  track('product_click', { ...ctx, productId: product.id });
  if (config.cta.action === 'PDP') window.location.assign(productUrl(product.handle, numericId(product.shopifyVariantId)));
  else openProductPopup(product, config, ctx);
}
