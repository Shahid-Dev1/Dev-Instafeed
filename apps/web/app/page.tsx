import { readinessSchema, type Readiness } from '@instafeed/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiFetch, ApiRequestError } from '../lib/api';

export const dynamic = 'force-dynamic';

async function loadStatus(): Promise<Readiness | { error: string }> {
  const baseUrl = process.env.API_URL ?? 'http://localhost:4000';
  try {
    return await apiFetch(baseUrl, '/health/ready', readinessSchema, { cache: 'no-store' });
  } catch (e) {
    return { error: e instanceof ApiRequestError ? e.message : 'Unknown error' };
  }
}

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // Shopify admin opens the App URL with ?shop=&host=; send those loads to the embedded app.
  if (typeof params.shop === 'string' && typeof params.host === 'string') {
    const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === 'string'));
    redirect(`/app?${qs}`);
  }
  const status = await loadStatus();
  return (
    <main>
      <h1>Instafeed</h1>
      <p>
        <Link href="/login">Log in</Link> · <Link href="/register">Create account</Link>
      </p>
      <h2>System status</h2>
      {'error' in status ? (
        <p role="alert">API unavailable: {status.error}</p>
      ) : (
        <ul>
          <li>API: {status.status}</li>
          <li>Database: {status.checks.database}</li>
          <li>Redis: {status.checks.redis}</li>
        </ul>
      )}
    </main>
  );
}
