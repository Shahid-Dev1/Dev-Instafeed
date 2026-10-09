'use client';

import {
  ACCEPTED_VIDEO_TYPES,
  createUploadSchema,
  importUrlSchema,
  providerVideoListSchema,
  uploadTicketSchema,
  videoResponseSchema,
  type ProviderStatus,
  type ProviderVideo,
  type VideoCapabilities,
} from '@instafeed/shared';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { clientApi, errorMessage, openTopLevel } from '../../lib/client';

type Notify = (text: string, kind?: 'ok' | 'error') => void;

function UrlImport({ caps, onAdded, notify }: { caps: VideoCapabilities; onAdded: () => void; notify: Notify }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = importUrlSchema.safeParse({ url: url.trim() });
    if (!parsed.success) return notify('Enter a valid video link', 'error');
    setBusy(true);
    try {
      const { video } = await clientApi('/api/v1/videos/import', videoResponseSchema, { method: 'POST', body: JSON.stringify(parsed.data) });
      notify(`Added “${video.title}”`);
      setUrl('');
      onAdded();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }
  const sources = ['TikTok', ...(caps.youtube ? ['YouTube / Shorts'] : []), ...(caps.instagramUrl ? ['Instagram Reel'] : [])];
  return (
    <form onSubmit={submit}>
      <label>
        Paste a {sources.join(', ')} link{' '}
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" maxLength={500} style={{ width: 360 }} />
      </label>{' '}
      <button disabled={busy}>{busy ? 'Importing…' : 'Import'}</button>
      {!caps.youtube && <p><small>YouTube import is not configured yet.</small></p>}
    </form>
  );
}

function Upload({ caps, onAdded, notify }: { caps: VideoCapabilities; onAdded: () => void; notify: Notify }) {
  const [file, setFile] = useState<File | null>(null);
  const [rights, setRights] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  if (!caps.upload) return <p><small>Direct uploads are not configured yet (video hosting credentials missing).</small></p>;

  async function start(e: FormEvent) {
    e.preventDefault();
    if (!file) return notify('Choose a video file', 'error');
    const parsed = createUploadSchema.safeParse({ title: file.name.replace(/\.[^.]+$/, '').slice(0, 200) || 'Untitled', bytes: file.size, contentType: file.type, rightsConfirmed: rights || undefined });
    if (!parsed.success) return notify(parsed.error.issues[0]?.path[0] === 'contentType' ? 'Use an MP4, MOV, WebM or M4V file' : parsed.error.issues[0]?.path[0] === 'rightsConfirmed' ? 'Confirm you have the rights to this video' : 'Invalid file', 'error');
    if (file.size > caps.maxUploadMb * 1024 * 1024) return notify(`Files up to ${caps.maxUploadMb} MB are supported`, 'error');
    try {
      const ticket = await clientApi('/api/v1/videos/uploads', uploadTicketSchema, { method: 'POST', body: JSON.stringify(parsed.data) });
      setProgress(0);
      const { Upload: TusUpload } = await import('tus-js-client');
      await new Promise<void>((resolve, reject) => {
        new TusUpload(file, {
          endpoint: ticket.tus.endpoint,
          headers: ticket.tus.headers,
          metadata: { filetype: file.type, title: parsed.data.title },
          retryDelays: [0, 3000, 10000, 30000],
          chunkSize: 50 * 1024 * 1024,
          onProgress: (sent, total) => setProgress(Math.round((sent / total) * 100)),
          onSuccess: () => resolve(),
          onError: reject,
        }).start();
      });
      await clientApi(`/api/v1/videos/${ticket.videoId}/upload-complete`, z.object({ ok: z.literal(true) }), { method: 'POST' });
      notify('Upload complete. The video is processing and will be ready shortly.');
      setFile(null);
      setRights(false);
      onAdded();
    } catch (err) {
      notify(`Upload failed: ${errorMessage(err)}`, 'error');
    } finally {
      setProgress(null);
    }
  }

  return (
    <form onSubmit={start}>
      <input type="file" accept={ACCEPTED_VIDEO_TYPES.join(',')} onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Video file" />
      <label style={{ display: 'block' }}>
        <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} /> I own this video or have permission to use it commercially
      </label>
      <button disabled={progress !== null}>{progress !== null ? `Uploading ${progress}%` : 'Upload'}</button>
      {progress !== null && <progress value={progress} max={100} style={{ marginLeft: 8 }} />}
    </form>
  );
}

const NAMES = { tiktok: 'TikTok', instagram: 'Instagram' } as const;

function AccountImport({ p, canConnect, onAdded, onChanged, notify }: { p: ProviderStatus; canConnect: boolean; onAdded: () => void; onChanged: () => void; notify: Notify }) {
  const [items, setItems] = useState<ProviderVideo[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = NAMES[p.provider];

  if (!p.enabled) return null;
  if (!p.configured) return <p><small>{name} account import is enabled but not configured.</small></p>;

  async function connect() {
    try {
      const { authorizeUrl } = await clientApi(`/api/v1/connections/${p.provider}/start`, z.object({ authorizeUrl: z.string() }), { method: 'POST' });
      openTopLevel(authorizeUrl);
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  }
  async function disconnect() {
    try {
      await clientApi(`/api/v1/connections/${p.provider}`, z.object({ ok: z.literal(true) }), { method: 'DELETE' });
      setItems(null);
      onChanged();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  }
  async function load(next: string | null) {
    setBusy(true);
    try {
      const res = await clientApi(`/api/v1/connections/${p.provider}/videos${next ? `?cursor=${encodeURIComponent(next)}` : ''}`, providerVideoListSchema);
      setItems((prev) => (next && prev ? [...prev, ...res.items] : res.items));
      setCursor(res.nextCursor);
    } catch (err) {
      notify(errorMessage(err), 'error');
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  async function importSelected() {
    if (p.provider === 'instagram' && !rights) return notify('Confirm you own these Reels', 'error');
    setBusy(true);
    try {
      const res = await clientApi(`/api/v1/connections/${p.provider}/import`, z.object({ imported: z.array(z.string()), skipped: z.array(z.object({ id: z.string(), reason: z.string() })) }), {
        method: 'POST',
        body: JSON.stringify({ ids: [...selected], ...(p.provider === 'instagram' ? { rightsConfirmed: true } : {}) }),
      });
      notify(`Imported ${res.imported.length}${res.skipped.length ? `, skipped ${res.skipped.length} (${res.skipped[0]!.reason})` : ''}`);
      setSelected(new Set());
      onAdded();
      void load(null);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!p.connected || p.status === 'REAUTH_REQUIRED') {
    return (
      <p>
        {p.status === 'REAUTH_REQUIRED' && <small>Your {name} connection expired. </small>}
        {canConnect ? <button onClick={connect}>{p.connected ? 'Reconnect' : 'Connect'} {name} account</button> : <small>Ask an admin to connect a {name} account.</small>}
      </p>
    );
  }
  return (
    <div>
      <p>
        Connected as <strong>{p.username ?? name}</strong>{' '}
        {!items && <button onClick={() => void load(null)} disabled={busy}>Browse videos</button>}{' '}
        {canConnect && <button onClick={disconnect}>Disconnect</button>}
      </p>
      {items && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {items.map((v) => (
              <label key={v.id} title={v.reason ?? v.title} style={{ width: 120, opacity: v.importable && !v.alreadyImported ? 1 : 0.5 }}>
                {v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" width={120} height={160} style={{ objectFit: 'cover', display: 'block' }} loading="lazy" />}
                <input type="checkbox" disabled={!v.importable || v.alreadyImported} checked={selected.has(v.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(v.id); else n.delete(v.id); return n; })} />
                <small>{v.alreadyImported ? 'Imported' : (v.reason ?? v.title)}</small>
              </label>
            ))}
            {items.length === 0 && <p>No videos found on this account.</p>}
          </div>
          {cursor && <button onClick={() => void load(cursor)} disabled={busy}>Load more</button>}
          {p.provider === 'instagram' && (
            <label style={{ display: 'block' }}><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} /> I own these Reels and authorize copying them to our video host</label>
          )}
          <button onClick={importSelected} disabled={busy || selected.size === 0}>Import {selected.size || ''} selected</button>
        </>
      )}
    </div>
  );
}

export function AddVideoPanel({ caps, canConnect, onAdded, onChanged, notify }: { caps: VideoCapabilities; canConnect: boolean; onAdded: () => void; onChanged: () => void; notify: Notify }) {
  return (
    <section style={{ border: '1px solid #ddd', padding: 12, marginBottom: 16, background: '#fff' }}>
      <h2 style={{ marginTop: 0 }}>Add videos</h2>
      <h3>From a link</h3>
      <UrlImport caps={caps} onAdded={onAdded} notify={notify} />
      <h3>Upload a file</h3>
      <Upload caps={caps} onAdded={onAdded} notify={notify} />
      {caps.providers.filter((p) => p.enabled).map((p) => (
        <div key={p.provider}>
          <h3>From your {NAMES[p.provider]} account</h3>
          <AccountImport p={p} canConnect={canConnect} onAdded={onAdded} onChanged={onChanged} notify={notify} />
        </div>
      ))}
    </section>
  );
}
