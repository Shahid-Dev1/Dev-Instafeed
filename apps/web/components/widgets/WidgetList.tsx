'use client';

import { hasRole, meSchema, WIDGET_TYPES, widgetListSchema, widgetResponseSchema, type Role, type WidgetDto, type WidgetType } from '@instafeed/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { clientApi, errorMessage } from '../../lib/client';

const TYPE_INFO: Record<WidgetType, string> = {
  STORIES: 'Stories: Instagram-style bubbles',
  CAROUSEL: 'Carousel: swipeable video cards',
  FLOATING: 'Floating: picture-in-picture player',
  BANNER: 'Banner: full-width hero video',
  GRID: 'Grid: shoppable video wall',
  PRODUCT_GALLERY: 'Product gallery: videos for the product being viewed',
};

export function WidgetList({ hrefFor }: { hrefFor: (id: string) => string }) {
  const [items, setItems] = useState<WidgetDto[] | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [type, setType] = useState<WidgetType>('CAROUSEL');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    clientApi('/api/v1/widgets', widgetListSchema).then((r) => setItems(r.items), (e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(() => {
    load();
    clientApi('/api/v1/me', meSchema).then((m) => setRole(m.current?.role ?? null), () => undefined);
  }, [load]);

  async function create() {
    try {
      const { widget } = await clientApi('/api/v1/widgets', widgetResponseSchema, { method: 'POST', body: JSON.stringify({ name: name.trim() || TYPE_INFO[type].split(':')[0], type }) });
      location.assign(hrefFor(widget.id));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function remove(w: WidgetDto) {
    if (!confirm(`Delete “${w.name}”? It will disappear from your store.`)) return;
    try {
      await clientApi(`/api/v1/widgets/${w.id}`, z.object({ ok: z.literal(true) }), { method: 'DELETE' });
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const canEdit = role !== null && hasRole(role, 'EDITOR');
  return (
    <section>
      {error && <p role="alert">{error}</p>}
      {canEdit && (
        <fieldset>
          <legend>Create a widget</legend>
          {WIDGET_TYPES.map((t) => (
            <label key={t} style={{ display: 'block' }}><input type="radio" name="type" checked={type === t} onChange={() => setType(t)} /> {TYPE_INFO[t]}</label>
          ))}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" maxLength={80} /> <button onClick={() => void create()}>Create</button>
        </fieldset>
      )}
      {items === null ? <p>Loading…</p> : items.length === 0 ? <p>No widgets yet.</p> : (
        <table cellPadding={6}>
          <thead><tr><th align="left">Name</th><th align="left">Type</th><th align="left">Status</th><th /></tr></thead>
          <tbody>
            {items.map((w) => (
              <tr key={w.id}>
                <td><Link href={hrefFor(w.id)}>{w.name}</Link></td>
                <td>{w.type.toLowerCase().replace('_', ' ')}</td>
                <td>{w.status === 'PUBLISHED' ? (w.hasUnpublishedChanges ? 'Published · changes pending' : 'Published') : 'Draft'}</td>
                <td>{canEdit && <button onClick={() => void remove(w)}>Delete</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
