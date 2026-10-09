'use client';

import { hasRole, meSchema, type Me } from '@instafeed/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiRequestError } from '../lib/api';
import { OnboardingChecklist } from './OnboardingChecklist';
import { clientApi, selectStore } from '../lib/client';

interface NavLinks {
  teamHref: string;
  productsHref: string;
  videosHref: string;
  widgetsHref: string;
  analyticsHref: string;
  integrationsHref: string;
  settingsHref: string;
}

export function MeSummary({ teamHref, productsHref, videosHref, widgetsHref, analyticsHref, integrationsHref, settingsHref }: NavLinks) {
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
      <nav style={{ display: 'flex', gap: 16 }}>
        <Link href={analyticsHref}>Analytics</Link>
        <Link href={widgetsHref}>Widgets</Link>
        <Link href={videosHref}>Videos</Link>
        <Link href={productsHref}>Products</Link>
        {hasRole(me.current.role, 'ADMIN') && (
          <>
            <Link href={teamHref}>Manage team</Link>
            <Link href={integrationsHref}>Integrations</Link>
            <Link href={settingsHref}>Settings</Link>
          </>
        )}
      </nav>
      <OnboardingChecklist links={{ products: productsHref, videos: videosHref, widgets: widgetsHref }} />
    </section>
  );
}
