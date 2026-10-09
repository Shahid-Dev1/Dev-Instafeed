'use client';

import { tagsSchema, updateVideoSchema, videoResponseSchema, type VideoDto } from '@instafeed/shared';
import { useState } from 'react';
import { clientApi, errorMessage } from '../../lib/client';
import { ProductPicker, type PickedProduct } from './ProductPicker';
import { VideoPlayer } from './VideoPlayer';

const SOURCE_LABEL: Record<VideoDto['source'], string> = {
  UPLOAD: 'Upload', YOUTUBE: 'YouTube', TIKTOK_URL: 'TikTok link', TIKTOK_ACCOUNT: 'TikTok account', INSTAGRAM_ACCOUNT: 'Instagram account', INSTAGRAM_URL: 'Instagram link',
};
export const sourceLabel = (s: VideoDto['source']) => SOURCE_LABEL[s];

export function VideoEditor({ video, canEdit, onChange, onClose }: { video: VideoDto; canEdit: boolean; onChange: (v: VideoDto) => void; onClose: () => void }) {
  const [title, setTitle] = useState(video.title);
  const [tags, setTags] = useState(video.tags.join(', '));
  const [products, setProducts] = useState<PickedProduct[]>(video.products.map((p) => ({ productId: p.productId, variantId: p.variantId, title: p.title, variantTitle: p.variantTitle })));
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const parsedTags = tagsSchema.safeParse(tags.split(',').map((t) => t.trim()).filter(Boolean));
    const parsed = updateVideoSchema.safeParse({ title, tags: parsedTags.success ? parsedTags.data : undefined });
    if (!parsedTags.success || !parsed.success) {
      setMsg({ kind: 'error', text: (!parsedTags.success ? parsedTags.error : parsed.error!).issues[0]?.message ?? 'Invalid input' });
      return;
    }
    setSaving(true);
    try {
      await clientApi(`/api/v1/videos/${video.id}`, videoResponseSchema, { method: 'PATCH', body: JSON.stringify(parsed.data) });
      const res = await clientApi(`/api/v1/videos/${video.id}/products`, videoResponseSchema, {
        method: 'PUT',
        body: JSON.stringify(products.map((p) => ({ productId: p.productId, variantId: p.variantId }))),
      });
      onChange(res.video);
      setMsg({ kind: 'ok', text: 'Saved' });
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  const move = (i: number, d: -1 | 1) => setProducts((ps) => {
    const next = [...ps];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    return next;
  });

  return (
    <aside style={{ border: '1px solid #ccc', padding: 16, background: '#fff', marginBottom: 16 }}>
      <button onClick={onClose} style={{ float: 'right' }} aria-label="Close editor">✕</button>
      <h2 style={{ marginTop: 0 }}>{video.title}</h2>
      <p><small>{sourceLabel(video.source)} · {video.status.toLowerCase()}{video.authorName && ` · ${video.authorName}`}{video.permalink && <> · <a href={video.permalink} target="_blank" rel="noreferrer">original</a></>}</small></p>
      <VideoPlayer video={video} />
      {canEdit && (
        <>
          <label style={{ display: 'block', marginTop: 12 }}>Title <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} style={{ width: '100%' }} /></label>
          <label style={{ display: 'block', marginTop: 8 }}>Tags (comma separated) <input value={tags} onChange={(e) => setTags(e.target.value)} style={{ width: '100%' }} /></label>
          <h3>Tagged products ({products.length}/20)</h3>
          <ol>
            {products.map((p, i) => (
              <li key={p.productId}>
                {p.title}{p.variantTitle && ` · ${p.variantTitle}`}{' '}
                <button disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                <button disabled={i === products.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                <button onClick={() => setProducts((ps) => ps.filter((x) => x.productId !== p.productId))}>Remove</button>
              </li>
            ))}
          </ol>
          {products.length < 20 && <ProductPicker exclude={products.map((p) => p.productId)} onPick={(p) => setProducts((ps) => [...ps, p])} />}
          <p><button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></p>
        </>
      )}
      {msg && <p role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</p>}
    </aside>
  );
}
