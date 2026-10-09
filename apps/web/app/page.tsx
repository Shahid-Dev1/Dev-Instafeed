import { readinessSchema, type Readiness } from '@instafeed/shared';
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

export default async function Home() {
  const status = await loadStatus();
  return (
    <main>
      <h1>Instafeed</h1>
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
