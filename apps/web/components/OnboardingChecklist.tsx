'use client';

import { onboardingSchema, type Onboarding } from '@instafeed/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { clientApi, openTopLevel } from '../lib/client';

export function OnboardingChecklist({ links }: { links: { products: string; videos: string; widgets: string } }) {
  const [data, setData] = useState<Onboarding | null>(null);
  useEffect(() => {
    clientApi('/api/v1/onboarding', onboardingSchema).then(setData, () => undefined);
  }, []);
  if (!data) return null;
  const steps = [
    { done: data.productsSynced, label: 'Sync your products', action: <Link href={links.products}>Products</Link> },
    { done: data.videoCount > 0, label: 'Add your first video', action: <Link href={links.videos}>Videos</Link> },
    { done: data.publishedWidgets > 0, label: 'Create and publish a widget', action: <Link href={links.widgets}>Widgets</Link> },
    {
      done: data.appEmbed === 'enabled',
      label: data.appEmbed === 'unknown' ? 'Turn on the Instafeed app embed in your theme (status unavailable)' : 'Turn on the Instafeed app embed in your theme',
      action: <button onClick={() => openTopLevel(data.themeEditorUrl)}>Open theme editor</button>,
    },
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <section style={{ background: '#fff', border: '1px solid #ddd', padding: 12, margin: '12px 0' }}>
      <h2 style={{ marginTop: 0 }}>Get started ({steps.filter((s) => s.done).length}/{steps.length})</h2>
      <ol>
        {steps.map((s) => (
          <li key={s.label} style={{ marginBottom: 6 }}>
            {s.done ? '✅' : '⬜'} {s.label} {!s.done && s.action}
          </li>
        ))}
      </ol>
    </section>
  );
}
