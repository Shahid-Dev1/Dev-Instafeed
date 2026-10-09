'use client';

import { productDetailSchema, productListSchema, type ProductDetail, type ProductSummary } from '@instafeed/shared';
import { useEffect, useState } from 'react';
import { clientApi, errorMessage } from '../../lib/client';

export interface PickedProduct {
  productId: string;
  variantId: string | null;
  title: string;
  variantTitle: string | null;
}

/** Searches synced products; choosing one optionally narrows to a variant. */
export function ProductPicker({ exclude, onPick }: { exclude: string[]; onPick: (p: PickedProduct) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ProductSummary[]>([]);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      clientApi(`/api/v1/products?limit=10${q ? `&q=${encodeURIComponent(q)}` : ''}`, productListSchema).then(
        (r) => setItems(r.items),
        (e: unknown) => setError(errorMessage(e)),
      );
    }, 250);
    return () => clearTimeout(id);
  }, [q]);

  async function choose(p: ProductSummary) {
    if (p.totalVariants <= 1) return onPick({ productId: p.id, variantId: null, title: p.title, variantTitle: null });
    try {
      setDetail(await clientApi(`/api/v1/products/${p.id}`, productDetailSchema));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (detail) {
    return (
      <div>
        <p>Choose a variant for <strong>{detail.title}</strong>:</p>
        <button onClick={() => { onPick({ productId: detail.id, variantId: null, title: detail.title, variantTitle: null }); setDetail(null); }}>Any variant (shopper chooses)</button>
        {detail.variants.map((v) => (
          <button key={v.id} disabled={!v.availableForSale} onClick={() => { onPick({ productId: detail.id, variantId: v.id, title: detail.title, variantTitle: v.title }); setDetail(null); }} style={{ display: 'block', marginTop: 4 }}>
            {v.title} · {v.price}{!v.availableForSale && ' (sold out)'}
          </button>
        ))}
        <button onClick={() => setDetail(null)} style={{ marginTop: 8 }}>Back</button>
      </div>
    );
  }

  return (
    <div>
      <input type="search" placeholder="Search products or SKU" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} aria-label="Search products to tag" />
      {error && <p role="alert">{error}</p>}
      <ul style={{ listStyle: 'none', padding: 0, maxHeight: 220, overflow: 'auto' }}>
        {items.filter((p) => !exclude.includes(p.id)).map((p) => (
          <li key={p.id}>
            <button onClick={() => void choose(p)} style={{ width: '100%', textAlign: 'left' }}>
              {p.title} <small>({p.totalVariants} variant{p.totalVariants === 1 ? '' : 's'})</small>
            </button>
          </li>
        ))}
        {items.length === 0 && <li><small>No products. Sync your catalog on the Products page.</small></li>}
      </ul>
    </div>
  );
}
