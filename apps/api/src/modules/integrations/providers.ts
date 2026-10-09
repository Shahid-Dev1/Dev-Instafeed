import type { IntegrationKind } from '@instafeed/shared';
import type { Deps } from '../../deps.js';
import { providerJson } from '../videos/providers/http.js';

export interface TestResult {
  ok: boolean;
  message: string;
}
type Cfg = Record<string, string>;

/**
 * Sends a clearly-labelled test event using each provider's official endpoint, where one exists.
 * Destinations without server credentials are validated by configuration only.
 */
export async function testIntegration(deps: Deps, kind: IntegrationKind, cfg: Cfg, secrets: Cfg): Promise<TestResult> {
  switch (kind) {
    case 'GA4': {
      if (!secrets.apiSecret) return { ok: true, message: 'Configuration valid. Add a Measurement Protocol API secret to send a server test event.' };
      // The debug endpoint validates the hit without recording it.
      const url = `https://www.google-analytics.com/debug/mp/collect?measurement_id=${encodeURIComponent(cfg.measurementId!)}&api_secret=${encodeURIComponent(secrets.apiSecret)}`;
      const res = await providerJson<{ validationMessages?: { description?: string }[] }>(deps.fetch, 'Google Analytics', url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: 'instafeed.test', events: [{ name: 'instafeed_test', params: { debug_mode: 1 } }] }),
      });
      const problems = res.body?.validationMessages ?? [];
      if (!res.ok) return { ok: false, message: `Google Analytics returned ${res.status}` };
      return problems.length ? { ok: false, message: problems.map((p) => p.description).join('; ') } : { ok: true, message: 'Test event validated by Google Analytics' };
    }
    case 'GTM':
      return { ok: true, message: 'Configuration valid. Events are pushed to the dataLayer on your storefront.' };
    case 'META': {
      if (!secrets.accessToken) return { ok: true, message: 'Configuration valid. Add a Conversions API token to send a test event.' };
      const url = `https://graph.facebook.com/${deps.env.INSTAGRAM_GRAPH_VERSION}/${encodeURIComponent(cfg.pixelId!)}/events?access_token=${encodeURIComponent(secrets.accessToken)}`;
      const res = await providerJson<{ events_received?: number; error?: { message?: string } }>(deps.fetch, 'Meta', url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          data: [{ event_name: 'InstafeedTest', event_time: Math.floor(Date.now() / 1000), action_source: 'website', user_data: { client_user_agent: 'Instafeed test', client_ip_address: '127.0.0.1' } }],
          ...(secrets.testEventCode ? { test_event_code: secrets.testEventCode } : {}),
        }),
      });
      return res.body?.events_received === 1 ? { ok: true, message: 'Test event received by Meta (see Events Manager → Test events)' } : { ok: false, message: res.body?.error?.message ?? `Meta returned ${res.status}` };
    }
    case 'MIXPANEL': {
      const host = cfg.region === 'eu' ? 'api-eu.mixpanel.com' : cfg.region === 'in' ? 'api-in.mixpanel.com' : 'api.mixpanel.com';
      const res = await providerJson<{ status?: number; error?: string }>(deps.fetch, 'Mixpanel', `https://${host}/track?verbose=1`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([{ event: 'Instafeed Test Event', properties: { token: cfg.token, distinct_id: 'instafeed-test', time: Math.floor(Date.now() / 1000) } }]),
      });
      return res.body?.status === 1 ? { ok: true, message: 'Test event accepted by Mixpanel' } : { ok: false, message: res.body?.error ?? `Mixpanel returned ${res.status}` };
    }
    case 'CLEVERTAP': {
      if (!secrets.passcode) return { ok: true, message: 'Configuration valid. Add your CleverTap passcode to send a test event.' };
      const res = await providerJson<{ status?: string; processed?: number; unprocessed?: { error?: string }[]; error?: string }>(
        deps.fetch,
        'CleverTap',
        `https://${cfg.region}.api.clevertap.com/1/upload`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'X-CleverTap-Account-Id': cfg.accountId!, 'X-CleverTap-Passcode': secrets.passcode },
          body: JSON.stringify({ d: [{ identity: 'instafeed-test', type: 'event', evtName: 'Instafeed Test Event', evtData: {} }] }),
        },
      );
      return res.body?.status === 'success' && res.body.processed === 1
        ? { ok: true, message: 'Test event accepted by CleverTap' }
        : { ok: false, message: res.body?.unprocessed?.[0]?.error ?? res.body?.error ?? `CleverTap returned ${res.status}` };
    }
  }
}
