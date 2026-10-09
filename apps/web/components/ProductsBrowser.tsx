'use client';

import {
  PRODUCT_STATUSES,
  productListQuerySchema,
  productListSchema,
  syncStatusSchema,
  type ProductSummary,
  type SyncRunDto,
} from '@instafeed/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError } from '../lib/api';
import { clientApi } from '../lib/client';

const errMsg = (e: unknown) => (e instanceof ApiRequestError ? e.message : 'Something went wrong');

function SyncPanel({ onFinished }: { onFinished: () => void }) {
  const [run, setRun] = useState<SyncRunDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = run?.status === 'QUEUED' || run?.status === 'RUNNING';
  const wasActive = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setRun((await clientApi('/api/v1/products/sync/status', syncStatusSchema)).syncRun);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);
  useEffect(() => {
    if (wasActive.current && !active) onFinished();
    wasActive.current = active;
    if (!active) return;
    const id = setInterval(() => void refresh(), 3000);
    return () => clearInterval(id);
  }, [active, refresh, onFinished]);

  async function start() {
    setError(null);
    try {
      setRun((await clientApi('/api/v1/products/sync', syncStatusSchema, { method: 'POST' })).syncRun);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <p>
      <button onClick={start} disabled={active}>{active ? 'Syncing…' : 'Sync products from Shopify'}</button>{' '}
      {run && (
        <small>
          Last sync: {run.status.toLowerCase()}
          {run.status === 'SUCCEEDED' && ` · ${run.upserted} products, ${run.deleted} removed`}
          {run.finishedAt && ` · ${new Date(run.finishedAt).toLocaleString()}`}
          {run.error && ` · ${run.error}`}
        </small>
      )}
      {error && <span role="alert"> {error}</span>}
    </p>
  );
}

export function ProductsBrowser() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<ProductSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (append: string | null) => {
      const parsed = productListQuerySchema.safeParse({ q: q || undefined, status: status || undefined, cursor: append ?? undefined });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Invalid search');
        setState('error');
        return;
      }
      setState('loading');
      const qs = new URLSearchParams(Object.entries(parsed.data).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
      try {
        const res = await clientApi(`/api/v1/products?${qs}`, productListSchema);
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setCursor(res.nextCursor);
        setState('idle');
      } catch (e) {
        setError(errMsg(e));
        setState('error');
      }
    },
    [q, status],
  );

  useEffect(() => {
    const id = setTimeout(() => void load(null), 250);
    return () => clearTimeout(id);
  }, [load]);

  return (
    <section>
      <SyncPanel onFinished={() => void load(null)} />
      <p>
        <input type="search" placeholder="Search title, handle or SKU" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />{' '}
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          <option value="">All statuses</option>
          {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
        </select>
      </p>
      {state === 'error' && <p role="alert">{error}</p>}
      {state !== 'loading' && items.length === 0 && state !== 'error' && (
        <p>No products found. {q || status ? 'Try a different search.' : 'Run a sync to import your Shopify catalog.'}</p>
      )}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {items.map((p) => (
          <li key={p.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #ddd' }}>
            {p.imageUrl ? <img src={p.imageUrl} alt="" width={48} height={48} style={{ objectFit: 'cover' }} loading="lazy" /> : <span style={{ width: 48 }} />}
            <span style={{ flex: 1 }}>
              <strong>{p.title}</strong>
              <br />
              <small>
                {p.status.toLowerCase()} · {p.totalVariants} variant{p.totalVariants === 1 ? '' : 's'}
                {p.priceMin && ` · ${p.priceMin === p.priceMax ? p.priceMin : `${p.priceMin}–${p.priceMax}`}`}
              </small>
            </span>
          </li>
        ))}
      </ul>
      {state === 'loading' && <p>Loading…</p>}
      {cursor && state === 'idle' && <button onClick={() => void load(cursor)}>Load more</button>}
    </section>
  );
}
