'use client';

import type { Targeting, TargetingRule } from '@instafeed/shared';
import { useState } from 'react';
import { ProductPicker } from '../videos/ProductPicker';

const SIMPLE: { type: TargetingRule['type']; label: string }[] = [
  { type: 'home', label: 'Homepage' },
  { type: 'all_products', label: 'All product pages' },
  { type: 'tagged_products', label: 'Product pages tagged in these videos' },
  { type: 'all_collections', label: 'All collection pages' },
];

export function TargetingForm({ targeting, onChange }: { targeting: Targeting; onChange: (t: Targeting) => void }) {
  const [productTitles, setProductTitles] = useState<Record<string, string>>({});
  const [path, setPath] = useState('');
  const rules = targeting.rules;
  const has = (type: TargetingRule['type']) => rules.some((r) => r.type === type);
  const toggle = (type: TargetingRule['type'], on: boolean) =>
    onChange({ rules: on ? [...rules, { type } as TargetingRule] : rules.filter((r) => r.type !== type) });
  const products = rules.find((r): r is Extract<TargetingRule, { type: 'products' }> => r.type === 'products');
  const collections = rules.find((r): r is Extract<TargetingRule, { type: 'collections' }> => r.type === 'collections');
  const replace = (type: TargetingRule['type'], rule: TargetingRule | null) => onChange({ rules: [...rules.filter((r) => r.type !== type), ...(rule ? [rule] : [])] });

  return (
    <fieldset>
      <legend>Show on</legend>
      {SIMPLE.map((o) => (
        <label key={o.type} style={{ display: 'block' }}><input type="checkbox" checked={has(o.type)} onChange={(e) => toggle(o.type, e.target.checked)} /> {o.label}</label>
      ))}
      <details>
        <summary>Specific products ({products?.productIds.length ?? 0})</summary>
        <ul>
          {products?.productIds.map((id) => (
            <li key={id}>{productTitles[id] ?? id} <button onClick={() => { const ids = products.productIds.filter((x) => x !== id); replace('products', ids.length ? { type: 'products', productIds: ids } : null); }}>Remove</button></li>
          ))}
        </ul>
        <ProductPicker exclude={products?.productIds ?? []} onPick={(p) => { setProductTitles((t) => ({ ...t, [p.productId]: p.title })); replace('products', { type: 'products', productIds: [...(products?.productIds ?? []), p.productId] }); }} />
      </details>
      <label style={{ display: 'block' }}>
        Specific collections (handles, comma separated){' '}
        <input
          defaultValue={collections?.handles.join(', ') ?? ''}
          onBlur={(e) => { const handles = e.target.value.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean); replace('collections', handles.length ? { type: 'collections', handles } : null); }}
          placeholder="summer-sale, skincare"
        />
      </label>
      <div>
        Custom pages:
        <ul>
          {rules.filter((r): r is Extract<TargetingRule, { type: 'page' }> => r.type === 'page').map((r) => (
            <li key={`${r.path}-${r.match}`}>{r.path} ({r.match === 'prefix' ? 'and sub-pages' : 'exact'}) <button onClick={() => onChange({ rules: rules.filter((x) => x !== r) })}>Remove</button></li>
          ))}
        </ul>
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/pages/about" maxLength={200} />{' '}
        <button onClick={() => { if (path.startsWith('/')) { onChange({ rules: [...rules, { type: 'page', path, match: 'exact' }] }); setPath(''); } }}>Add page</button>{' '}
        <button onClick={() => { if (path.startsWith('/')) { onChange({ rules: [...rules, { type: 'page', path, match: 'prefix' }] }); setPath(''); } }}>Add page and sub-pages</button>
      </div>
    </fieldset>
  );
}
