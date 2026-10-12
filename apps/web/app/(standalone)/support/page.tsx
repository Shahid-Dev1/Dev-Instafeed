'use client';

import Link from 'next/link';
import { useState } from 'react';
import { z } from 'zod';
import { ApiRequestError } from '../../../lib/api';
import { clientApi, errorMessage } from '../../../lib/client';

const storesSchema = z.object({
  stores: z.array(z.object({ id: z.string(), shopDomain: z.string(), name: z.string().nullable(), uninstalledAt: z.string().nullable(), subscription: z.object({ planId: z.string(), status: z.string() }).nullable() })),
});

/** Internal support console (staff with a PlatformRole only). Every search, view and action is audited server-side. */
export default function SupportPage() {
  const [q, setQ] = useState('');
  const [stores, setStores] = useState<z.infer<typeof storesSchema>['stores'] | null>(null);
  const [diag, setDiag] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setError(null);
    try {
      setStores((await clientApi(`/support-api/stores?q=${encodeURIComponent(q)}`, storesSchema)).stores);
    } catch (e) {
      setError(e instanceof ApiRequestError && e.status === 401 ? 'Log in with your staff account first.' : errorMessage(e));
    }
  }
  async function open(id: string) {
    try {
      setDiag(await clientApi(`/support-api/stores/${id}/diagnostics`, z.record(z.string(), z.unknown())));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function act(id: string, action: 'resync_products' | 'sync_billing') {
    if (!confirm(`Run ${action} for this store? This is logged.`)) return;
    try {
      await clientApi(`/support-api/stores/${id}/actions`, z.record(z.string(), z.unknown()), { method: 'POST', body: JSON.stringify({ action }) });
      void open(id);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const store = (diag?.store ?? null) as { id: string } | null;
  return (
    <main>
      <h1>Support console</h1>
      <p><small>Internal use only. All access is audited. <Link href="/login">Staff login</Link></small></p>
      <p>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="shop domain or name" maxLength={100} aria-label="Search stores" />{' '}
        <button onClick={() => void search()}>Search</button>
      </p>
      {error && <p role="alert">{error}</p>}
      {stores && (
        <ul>{stores.map((s) => (
          <li key={s.id}>
            <button onClick={() => void open(s.id)}>{s.shopDomain}</button> {s.name} · {s.subscription?.planId ?? 'FREE'} {s.uninstalledAt && '· uninstalled'}
          </li>
        ))}</ul>
      )}
      {diag && store && (
        <section>
          <p>
            <button onClick={() => void act(store.id, 'resync_products')}>Resync products</button>{' '}
            <button onClick={() => void act(store.id, 'sync_billing')}>Refresh billing</button>
          </p>
          <pre style={{ background: '#fff', padding: 12, overflow: 'auto', maxHeight: 600 }}>{JSON.stringify(diag, null, 2)}</pre>
        </section>
      )}
    </main>
  );
}
