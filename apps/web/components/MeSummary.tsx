'use client';

import { hasRole, meSchema, type Me } from '@instafeed/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiRequestError } from '../lib/api';
import { clientApi, selectStore } from '../lib/client';

export function MeSummary({ teamHref }: { teamHref: string }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);

  useEffect(() => {
    clientApi('/api/v1/me', meSchema).then(setMe, (e: unknown) => setError(e instanceof ApiRequestError ? e : null));
  }, []);

  if (error?.status === 401) return <p>Your session has expired. <Link href="/login">Log in again</Link>.</p>;
  if (error) return <p role="alert">{error.message}</p>;
  if (!me) return <p>Loading…</p>;
  if (!me.current) {
    return me.memberships.length === 0 ? (
      <p>You are not a member of any store yet. Ask a store owner to invite you, or install the app from the Shopify App Store.</p>
    ) : (
      <ul>
        {me.memberships.map((m) => (
          <li key={m.storeId}>
            <button onClick={() => { selectStore(m.storeId); location.reload(); }}>{m.storeName ?? m.shopDomain}</button> ({m.role})
          </li>
        ))}
      </ul>
    );
  }
  return (
    <section>
      <p>
        <strong>{me.current.storeName ?? me.current.shopDomain}</strong> · your role: {me.current.role}
      </p>
      {hasRole(me.current.role, 'ADMIN') && <Link href={teamHref}>Manage team</Link>}
    </section>
  );
}
