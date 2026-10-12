'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';
import { clientApi, errorMessage } from '../lib/client';

const schema = z.object({ defaultPurchaseFlow: z.enum(['POPUP', 'PDP']), authorizedDomains: z.array(z.string()), headlessEndpoint: z.string().optional() });

export function StoreSettingsForm() {
  const [s, setS] = useState<z.infer<typeof schema> | null>(null);
  const [domains, setDomains] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    clientApi('/api/v1/settings/store', schema).then((r) => { setS(r); setDomains(r.authorizedDomains.join('\n')); }, (e: unknown) => setMsg({ ok: false, text: errorMessage(e) }));
  }, []);
  if (!s) return <p>{msg?.text ?? 'Loading…'}</p>;

  async function save() {
    const list = domains.split(/[\s,]+/).map((d) => d.trim()).filter(Boolean);
    if (list.length > 10) return setMsg({ ok: false, text: 'Up to 10 domains' });
    try {
      const r = await clientApi('/api/v1/settings/store', schema, { method: 'PATCH', body: JSON.stringify({ defaultPurchaseFlow: s!.defaultPurchaseFlow, authorizedDomains: list }) });
      setS({ ...s!, ...r });
      setDomains(r.authorizedDomains.join('\n'));
      setMsg({ ok: true, text: 'Saved' });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  }
  return (
    <section>
      <label style={{ display: 'block', marginBottom: 12 }}>
        Default purchase flow for new widgets{' '}
        <select value={s.defaultPurchaseFlow} onChange={(e) => setS({ ...s, defaultPurchaseFlow: e.target.value as 'POPUP' | 'PDP' })}>
          <option value="POPUP">Product popup with Add to Cart</option>
          <option value="PDP">Go to the product page</option>
        </select>
      </label>
      <label style={{ display: 'block' }}>
        Authorized domains for headless storefronts (https only, one per line)
        <textarea value={domains} onChange={(e) => setDomains(e.target.value)} rows={4} style={{ width: '100%' }} placeholder="https://shop.yourbrand.com" />
      </label>
      {s.headlessEndpoint && <p><small>Headless widget endpoint: <code>{s.headlessEndpoint}</code> (works only from the domains above).</small></p>}
      <button onClick={() => void save()}>Save settings</button>
      {msg && <p role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
    </section>
  );
}
