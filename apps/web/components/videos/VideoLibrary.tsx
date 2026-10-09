'use client';

import {
  hasRole,
  meSchema,
  VIDEO_SOURCES,
  VIDEO_STATUSES,
  videoCapabilitiesSchema,
  videoListSchema,
  type Role,
  type VideoCapabilities,
  type VideoDto,
} from '@instafeed/shared';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { clientApi, errorMessage } from '../../lib/client';
import { AddVideoPanel } from './AddVideoPanel';
import { sourceLabel, VideoEditor } from './VideoEditor';

const PROCESSING = new Set(['PENDING', 'PROCESSING']);

export function VideoLibrary() {
  const [role, setRole] = useState<Role | null>(null);
  const [caps, setCaps] = useState<VideoCapabilities | null>(null);
  const [filters, setFilters] = useState({ q: '', source: '', status: '', tag: '', sort: 'newest', archived: 'false' });
  const [items, setItems] = useState<VideoDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<VideoDto | null>(null);
  const [notice, setNotice] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const notify = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => setNotice({ text, kind }), []);
  const canEdit = role !== null && hasRole(role, 'EDITOR');

  const loadCaps = useCallback(() => {
    clientApi('/api/v1/videos/capabilities', videoCapabilitiesSchema).then(setCaps, (e: unknown) => notify(errorMessage(e), 'error'));
  }, [notify]);

  const load = useCallback(async (append: string | null) => {
    setLoading(true);
    const qs = new URLSearchParams(Object.entries({ ...filters, cursor: append ?? '' }).filter(([, v]) => v !== ''));
    try {
      const res = await clientApi(`/api/v1/videos?${qs}`, videoListSchema);
      setItems((prev) => (append ? [...prev, ...res.items] : res.items));
      setCursor(res.nextCursor);
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, notify]);

  useEffect(() => {
    clientApi('/api/v1/me', meSchema).then((me) => setRole(me.current?.role ?? null), () => undefined);
    loadCaps();
    const params = new URLSearchParams(location.search);
    if (params.get('connected')) notify(`${params.get('connected')} account connected`);
    if (params.get('connectError')) notify(`Could not connect ${params.get('connectError')}. Please try again.`, 'error');
  }, [loadCaps, notify]);

  useEffect(() => {
    const id = setTimeout(() => void load(null), 250);
    return () => clearTimeout(id);
  }, [load]);

  // Refresh while uploads are processing so status updates appear without a reload.
  useEffect(() => {
    if (!items.some((v) => PROCESSING.has(v.status))) return;
    const id = setInterval(() => void load(null), 10_000);
    return () => clearInterval(id);
  }, [items, load]);

  async function bulk(action: 'archive' | 'unarchive' | 'delete' | 'addTags', tags?: string[]) {
    if (action === 'delete' && !confirm(`Delete ${selected.size} video(s)? Uploaded files are removed permanently.`)) return;
    try {
      const res = await clientApi('/api/v1/videos/bulk', z.object({ affected: z.number() }), { method: 'POST', body: JSON.stringify({ action, ids: [...selected], ...(tags ? { tags } : {}) }) });
      notify(`${res.affected} video(s) updated`);
      setSelected(new Set());
      void load(null);
    } catch (e) {
      notify(errorMessage(e), 'error');
    }
  }

  const set = (k: keyof typeof filters) => (e: { target: { value: string } }) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <section>
      {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'} style={{ color: notice.kind === 'error' ? '#b42318' : '#067647' }}>{notice.text}</p>}
      {caps && canEdit && <AddVideoPanel caps={caps} canConnect={!!role && hasRole(role, 'ADMIN')} onAdded={() => void load(null)} onChanged={loadCaps} notify={notify} />}
      {editing && <VideoEditor key={editing.id} video={editing} canEdit={canEdit} onClose={() => setEditing(null)} onChange={(v) => { setEditing(v); setItems((xs) => xs.map((x) => (x.id === v.id ? v : x))); }} />}

      <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input type="search" placeholder="Search title or tag" value={filters.q} onChange={set('q')} maxLength={100} aria-label="Search videos" />
        <select value={filters.source} onChange={set('source')} aria-label="Source"><option value="">All sources</option>{VIDEO_SOURCES.map((s) => <option key={s} value={s}>{sourceLabel(s)}</option>)}</select>
        <select value={filters.status} onChange={set('status')} aria-label="Status"><option value="">All statuses</option>{VIDEO_STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select>
        <select value={filters.sort} onChange={set('sort')} aria-label="Sort"><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="title">Title</option></select>
        <select value={filters.archived} onChange={set('archived')} aria-label="Archive"><option value="false">Library</option><option value="true">Archived</option></select>
      </p>

      {canEdit && selected.size > 0 && (
        <p style={{ display: 'flex', gap: 8 }}>
          <strong>{selected.size} selected</strong>
          {filters.archived === 'false' ? <button onClick={() => void bulk('archive')}>Archive</button> : <button onClick={() => void bulk('unarchive')}>Restore</button>}
          <button onClick={() => { const t = prompt('Tag to add'); if (t) void bulk('addTags', [t]); }}>Add tag</button>
          <button onClick={() => void bulk('delete')}>Delete</button>
          <button onClick={() => setSelected(new Set())}>Clear</button>
        </p>
      )}

      {!loading && items.length === 0 && <p>No videos yet. Add one above.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
        {items.map((v) => (
          <article key={v.id} style={{ background: '#fff', border: '1px solid #ddd', padding: 8 }}>
            <button onClick={() => setEditing(v)} style={{ all: 'unset', cursor: 'pointer', display: 'block' }} aria-label={`Open ${v.title}`}>
              <div style={{ aspectRatio: '9 / 16', background: '#eee', overflow: 'hidden' }}>
                {v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />}
              </div>
              <strong style={{ display: 'block', marginTop: 4 }}>{v.title}</strong>
            </button>
            <small>
              {sourceLabel(v.source)} · <span title={v.statusMessage ?? undefined}>{v.status.toLowerCase()}</span> · {v.products.length} product{v.products.length === 1 ? '' : 's'}
            </small>
            {canEdit && (
              <label style={{ display: 'block' }}>
                <input type="checkbox" checked={selected.has(v.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(v.id); else n.delete(v.id); return n; })} /> Select
              </label>
            )}
          </article>
        ))}
      </div>
      {loading && <p>Loading…</p>}
      {cursor && !loading && <button onClick={() => void load(cursor)}>Load more</button>}
    </section>
  );
}
