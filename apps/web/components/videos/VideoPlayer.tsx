'use client';

import type { VideoDto } from '@instafeed/shared';
import { useEffect, useRef } from 'react';

/** Dashboard preview: official embeds in an iframe; Bunny HLS via native playback or a lazily loaded hls.js. */
export function VideoPlayer({ video }: { video: VideoDto }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !video.playbackUrl) return;
    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = video.playbackUrl;
      return;
    }
    let destroy: (() => void) | undefined;
    void import('hls.js').then(({ default: Hls }) => {
      if (!Hls.isSupported()) return;
      const hls = new Hls();
      hls.loadSource(video.playbackUrl!);
      hls.attachMedia(el);
      destroy = () => hls.destroy();
    });
    return () => destroy?.();
  }, [video.playbackUrl]);

  const portrait = (video.height ?? 16) >= (video.width ?? 9);
  const box = { width: portrait ? 270 : 480, aspectRatio: portrait ? '9 / 16' : '16 / 9', border: 0, background: '#000' } as const;

  if (video.playbackUrl) return <video ref={ref} controls playsInline poster={video.thumbnailUrl ?? undefined} style={box} />;
  if (video.embedUrl) {
    return <iframe src={video.embedUrl} title={video.title} style={box} allow="encrypted-media; picture-in-picture; fullscreen" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />;
  }
  return <p>{video.statusMessage ?? 'Preview is available once processing finishes.'}</p>;
}
