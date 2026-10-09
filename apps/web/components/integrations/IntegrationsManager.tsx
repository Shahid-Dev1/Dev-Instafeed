'use client';

import { DEFAULT_FORWARDED, FORWARDABLE_EVENTS, integrationConfigSchemas, integrationListSchema, type IntegrationDto, type IntegrationKind } from '@instafeed/shared';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { clientApi, errorMessage } from '../../lib/client';

type Field = { key: string; label: string; secret?: boolean; options?: string[]; placeholder?: string };
const FIELDS: Record<IntegrationKind, { title: string; help: string; fields: Field[] }> = {
  GA4: { title: 'Google Analytics 4', help: 'Events are sent with gtag when GA4 is on your storefront, or through GTM.', fields: [
    { key: 'measurementId', label: 'Measurement ID', placeholder: 'G-XXXXXXX' },
    { key: 'sendVia', label: 'Send via', options: ['gtag', 'gtm'] },
    { key: 'apiSecret', label: 'Measurement Protocol API secret (for test events)', secret: true },
  ] },
  GTM: { title: 'Google Tag Manager', help: 'Pushes instafeed_* events to the dataLayer for your container to route.', fields: [{ key: 'containerId', label: 'Container ID', placeholder: 'GTM-XXXXXX' }] },
  META: { title: 'Meta Pixel', help: 'Sends custom Instafeed events to your pixel (requires marketing consent).', fields: [
    { key: 'pixelId', label: 'Pixel ID' },
    { key: 'accessToken', label: 'Conversions API token (for test events)', secret: true },
    { key: 'testEventCode', label: 'Test event code', secret: true, placeholder: 'TEST12345' },
  ] },
  MIXPANEL: { title: 'Mixpanel', help: 'Tracks Instafeed events with your existing Mixpanel snippet.', fields: [
    { key: 'token', label: 'Project token' },
    { key: 'region', label: 'Data residency', options: ['us', 'eu', 'in'] },
  ] },
  CLEVERTAP: { title: 'CleverTap', help: 'Pushes Instafeed events with your existing CleverTap SDK.', fields: [
    { key: 'accountId', label: 'Account ID' },
    { key: 'region', label: 'Region', options: ['in1', 'eu1', 'us1', 'sg1', 'aps3', 'mec1'] },
    { key: 'passcode', label: 'Passcode (for test events)', secret: true },
  ] },
};

function Card({ item, onSaved }: { item: IntegrationDto; onSaved: (items: IntegrationDto[]) => void }) {
  const spec = FIELDS[item.kind];
  const pub = (item.publicConfig ?? {}) as Record<string, string>;
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(spec.fields.map((f) => [f.key, f.secret ? '' : (pub[f.key] ?? f.options?.[0] ?? '')])));
  const [events, setEvents] = useState<string[]>(item.connected ? item.events : DEFAULT_FORWARDED);
  const [enabled, setEnabled] = useState(item.connected ? item.enabled : true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const split = () => {
    const publicConfig = Object.fromEntries(spec.fields.filter((f) => !f.secret).map((f) => [f.key, values[f.key]]));
    const secrets = Object.fromEntries(spec.fields.filter((f) => f.secret && values[f.key]).map((f) => [f.key, values[f.key]]));
    return { publicConfig, secrets };
  };

  async function save() {
    const { publicConfig, secrets } = split();
    const p = integrationConfigSchemas[item.kind].public.safeParse(publicConfig);
    if (!p.success) return setMsg({ ok: false, text: p.error.issues[0]?.message ?? 'Invalid configuration' });
    setBusy(true);
    try {
      const res = await clientApi(`/api/v1/integrations/${item.kind}`, integrationListSchema, { method: 'PUT', body: JSON.stringify({ enabled, publicConfig, ...(Object.keys(secrets).length ? { secrets } : {}), events }) });
      onSaved(res.items);
      setValues((v) => Object.fromEntries(Object.entries(v).map(([k, val]) => [k, spec.fields.find((f) => f.key === k)?.secret ? '' : val])));
      setMsg({ ok: true, text: 'Saved' });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    try {
      const r = await clientApi(`/api/v1/integrations/${item.kind}/test`, z.object({ ok: z.boolean(), message: z.string() }), { method: 'POST' });
      setMsg({ ok: r.ok, text: r.message });
      onSaved((await clientApi('/api/v1/integrations', integrationListSchema)).items);
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    if (!confirm(`Disconnect ${spec.title}?`)) return;
    await clientApi(`/api/v1/integrations/${item.kind}`, z.object({ ok: z.literal(true) }), { method: 'DELETE' });
    onSaved((await clientApi('/api/v1/integrations', integrationListSchema)).items);
  }

  const statusIcon = item.status === 'OK' ? '✅ Working' : item.status === 'ERROR' ? '⚠️ Error' : item.connected ? '• Not tested' : '○ Not connected';
  return (
    <section style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 12 }}>
      <h2 style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between' }}>{spec.title} <small>{statusIcon}</small></h2>
      <p><small>{spec.help}</small></p>
      {item.lastError && <p role="alert"><small>Last error: {item.lastError}</small></p>}
      {spec.fields.map((f) => (
        <label key={f.key} style={{ display: 'block', margin: '6px 0' }}>
          {f.label}{f.secret && item.secretsSet.includes(f.key) && ' (saved, leave blank to keep)'}{' '}
          {f.options ? (
            <select value={values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
          ) : (
            <input type={f.secret ? 'password' : 'text'} autoComplete="off" value={values[f.key]} placeholder={f.placeholder} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value.trim() }))} />
          )}
        </label>
      ))}
      <fieldset>
        <legend>Events to send</legend>
        {FORWARDABLE_EVENTS.map((ev) => (
          <label key={ev} style={{ marginRight: 12, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={events.includes(ev)} onChange={(e) => setEvents((xs) => (e.target.checked ? [...xs, ev] : xs.filter((x) => x !== ev)))} /> {ev}
          </label>
        ))}
      </fieldset>
      <label><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled</label>{' '}
      <button onClick={() => void save()} disabled={busy}>{item.connected ? 'Save' : 'Connect'}</button>{' '}
      {item.connected && <><button onClick={() => void test()} disabled={busy}>Send test event</button> <button onClick={() => void disconnect()}>Disconnect</button></>}
      {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? '#067647' : '#b42318' }}>{msg.text}</p>}
      {item.logs.length > 0 && (
        <details><summary>Activity log</summary>
          <ul>{item.logs.map((l) => <li key={l.createdAt + l.message}><small>{new Date(l.createdAt).toLocaleString()} · {l.level} · {l.message}</small></li>)}</ul>
        </details>
      )}
    </section>
  );
}

export function IntegrationsManager() {
  const [items, setItems] = useState<IntegrationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    clientApi('/api/v1/integrations', integrationListSchema).then((r) => setItems(r.items), (e: unknown) => setError(errorMessage(e)));
  }, []);
  if (error) return <p role="alert">{error}</p>;
  if (!items) return <p>Loading…</p>;
  return (
    <>
      <p><small>Instafeed forwards its own events (named <code>instafeed_*</code>) to the tools already installed on your store. Standard ecommerce events such as add_to_cart are not duplicated, because Shopify&apos;s channels already send them. Only public IDs reach your storefront; secrets are used server-side for test events.</small></p>
      {items.map((i) => <Card key={i.kind} item={i} onSaved={setItems} />)}
    </>
  );
}
