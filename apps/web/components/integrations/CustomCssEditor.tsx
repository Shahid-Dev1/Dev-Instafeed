'use client';

import { cssProblem } from '@instafeed/shared';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { clientApi, errorMessage } from '../../lib/client';

const schema = z.object({ customCss: z.string() });

export function CustomCssEditor() {
  const [css, setCss] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    clientApi('/api/v1/settings/custom-css', schema).then((r) => setCss(r.customCss), (e: unknown) => setMsg({ ok: false, text: errorMessage(e) }));
  }, []);
  if (css === null) return <p>{msg?.text ?? 'Loading…'}</p>;
  const problem = css.length > 10_000 ? 'Custom CSS is limited to 10,000 characters' : cssProblem(css);

  async function save() {
    try {
      await clientApi('/api/v1/settings/custom-css', schema, { method: 'PUT', body: JSON.stringify({ customCss: css }) });
      setMsg({ ok: true, text: 'Saved. Changes reach your storefront within a minute.' });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  }
  return (
    <section>
      <p><small>Applies only inside Instafeed widgets (it cannot affect the rest of your theme). Useful selectors: <code>.if-card</code>, <code>.if-btn</code>, <code>.if-title</code>, <code>.if-story</code>, <code>.if-products</code>. Scripts, @import and non-https URLs are blocked.</small></p>
      <textarea value={css} onChange={(e) => setCss(e.target.value)} rows={12} style={{ width: '100%', fontFamily: 'monospace' }} aria-label="Custom CSS" spellCheck={false} />
      {problem && <p role="alert" style={{ color: '#b42318' }}>{problem}</p>}
      <button onClick={() => void save()} disabled={!!problem}>Save CSS</button>
      {msg && <p role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
    </section>
  );
}
