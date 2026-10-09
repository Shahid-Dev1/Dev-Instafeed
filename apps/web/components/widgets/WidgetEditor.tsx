'use client';

import {
  targetingSchema,
  updateWidgetSchema,
  videoListSchema,
  widgetConfigSchema,
  widgetPayloadSchema,
  widgetResponseSchema,
  type Targeting,
  type VideoDto,
  type WidgetConfig,
  type WidgetDto,
  type WidgetPayload,
} from '@instafeed/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { ApiRequestError } from '../../lib/api';
import { clientApi, errorMessage } from '../../lib/client';
import { ConfigForm } from './ConfigForm';
import { TargetingForm } from './TargetingForm';
import { WidgetPreview } from './WidgetPreview';

const previewSchema = z.object({ payload: widgetPayloadSchema });

export function WidgetEditor({ id, backHref }: { id: string; backHref: string }) {
  const [widget, setWidget] = useState<WidgetDto | null>(null);
  const [name, setName] = useState('');
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [targeting, setTargeting] = useState<Targeting | null>(null);
  const [videoIds, setVideoIds] = useState<string[]>([]);
  const [library, setLibrary] = useState<VideoDto[]>([]);
  const [payload, setPayload] = useState<WidgetPayload | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (w: WidgetDto) => {
    setWidget(w);
    setName(w.name);
    setConfig(w.config);
    setTargeting(w.targeting);
    setVideoIds(w.videoIds);
  };
  const loadPreview = useCallback(() => {
    clientApi(`/api/v1/widgets/${id}/preview`, previewSchema).then((r) => setPayload(r.payload), (e: unknown) => setMsg({ kind: 'error', text: errorMessage(e) }));
  }, [id]);

  useEffect(() => {
    clientApi(`/api/v1/widgets/${id}`, widgetResponseSchema).then((r) => apply(r.widget), (e: unknown) => setMsg({ kind: 'error', text: errorMessage(e) }));
    clientApi('/api/v1/videos?status=READY&limit=100', videoListSchema).then((r) => setLibrary(r.items), () => undefined);
    loadPreview();
  }, [id, loadPreview]);

  if (!widget || !config || !targeting) return <p>{msg?.text ?? 'Loading…'}</p>;

  const dirty = name !== widget.name || JSON.stringify(config) !== JSON.stringify(widget.config) || JSON.stringify(targeting) !== JSON.stringify(widget.targeting) || JSON.stringify(videoIds) !== JSON.stringify(widget.videoIds);
  const configCheck = widgetConfigSchema.safeParse(config);
  const targetingCheck = targetingSchema.safeParse(targeting);

  async function save(): Promise<boolean> {
    const body = updateWidgetSchema.safeParse({ version: widget!.version, name, config, targeting, videoIds });
    if (!body.success) {
      setMsg({ kind: 'error', text: `${body.error.issues[0]?.path.join('.')}: ${body.error.issues[0]?.message}` });
      return false;
    }
    setBusy(true);
    try {
      apply((await clientApi(`/api/v1/widgets/${id}`, widgetResponseSchema, { method: 'PATCH', body: JSON.stringify(body.data) })).widget);
      loadPreview();
      setMsg({ kind: 'ok', text: 'Saved' });
      return true;
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof ApiRequestError && e.status === 409 ? 'Someone else changed this widget. Reload to get the latest version.' : errorMessage(e) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function publish(action: 'publish' | 'unpublish') {
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      apply((await clientApi(`/api/v1/widgets/${id}/${action}`, widgetResponseSchema, { method: 'POST' })).widget);
      setMsg({ kind: 'ok', text: action === 'publish' ? 'Published. It appears on your store wherever the app block or app embed is enabled.' : 'Unpublished' });
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const manual = config.source === 'manual';
  const byId = new Map(library.map((v) => [v.id, v]));
  const move = (i: number, d: -1 | 1) => setVideoIds((ids) => { const n = [...ids]; [n[i], n[i + d]] = [n[i + d]!, n[i]!]; return n; });

  return (
    <div>
      <p><Link href={backHref}>← All widgets</Link></p>
      <header style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Widget name" style={{ fontSize: 20 }} />
        <span>{widget.type.toLowerCase().replace('_', ' ')} · {widget.status === 'PUBLISHED' ? (widget.hasUnpublishedChanges || dirty ? 'published (unpublished changes)' : 'published') : 'draft'}</span>
        <button onClick={() => void save()} disabled={busy || !dirty}>Save</button>
        <button onClick={() => void publish('publish')} disabled={busy || !configCheck.success || !targetingCheck.success}>{widget.status === 'PUBLISHED' ? 'Publish changes' : 'Publish'}</button>
        {widget.status === 'PUBLISHED' && <button onClick={() => void publish('unpublish')} disabled={busy}>Unpublish</button>}
      </header>
      {msg && <p role={msg.kind === 'error' ? 'alert' : 'status'} style={{ color: msg.kind === 'error' ? '#b42318' : '#067647' }}>{msg.text}</p>}
      {!configCheck.success && <p role="alert">Fix: {configCheck.error.issues[0]?.path.join('.')}: {configCheck.error.issues[0]?.message}</p>}
      {!targetingCheck.success && <p role="alert">Targeting: {targetingCheck.error.issues[0]?.message}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 360px) 1fr', gap: 24, alignItems: 'start' }}>
        <div>
          <fieldset>
            <legend>Videos</legend>
            {!manual ? (
              <p><small>This gallery automatically shows videos tagged with the product being viewed.</small></p>
            ) : (
              <>
                <ol>
                  {videoIds.map((vid, i) => (
                    <li key={vid}>
                      {byId.get(vid)?.title ?? 'Video unavailable'}{' '}
                      <button disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                      <button disabled={i === videoIds.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                      <button onClick={() => setVideoIds((ids) => ids.filter((x) => x !== vid))}>Remove</button>
                    </li>
                  ))}
                </ol>
                <select value="" onChange={(e) => e.target.value && setVideoIds((ids) => [...ids, e.target.value])} aria-label="Add video" disabled={videoIds.length >= 50}>
                  <option value="">+ Add a ready video…</option>
                  {library.filter((v) => !videoIds.includes(v.id)).map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
                </select>
                {dirty && <p><small>Save to refresh the preview with your video changes.</small></p>}
              </>
            )}
          </fieldset>
          <TargetingForm targeting={targeting} onChange={setTargeting} />
          <ConfigForm type={widget.type} config={config} update={(fn) => setConfig((c) => fn(c!))} />
        </div>
        <WidgetPreview payload={payload} config={config} />
      </div>
    </div>
  );
}
