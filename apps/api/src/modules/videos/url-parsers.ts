export type ParsedVideoUrl =
  | { provider: 'youtube'; id: string; shorts: boolean }
  | { provider: 'tiktok'; id: string; canonicalUrl: string }
  | { provider: 'instagram'; shortcode: string; canonicalUrl: string };

export class UnsupportedUrlError extends Error {}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** Recognises supported public video URLs. Only the URL is inspected; nothing is fetched. */
export function parseVideoUrl(raw: string): ParsedVideoUrl {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsupportedUrlError('Enter a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UnsupportedUrlError('Enter a valid URL');
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com') {
    let id: string | null | undefined = null;
    let shorts = false;
    if (host === 'youtu.be') id = parts[0];
    else if (parts[0] === 'watch') id = url.searchParams.get('v');
    else if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') {
      id = parts[1];
      shorts = parts[0] === 'shorts';
    }
    if (id && YT_ID.test(id)) return { provider: 'youtube', id, shorts };
    throw new UnsupportedUrlError('This YouTube link does not point to a video');
  }

  if (host === 'tiktok.com') {
    // https://www.tiktok.com/@user/video/7234567890123456789
    if (parts.length >= 3 && parts[0]!.startsWith('@') && parts[1] === 'video' && /^\d{8,25}$/.test(parts[2]!)) {
      return { provider: 'tiktok', id: parts[2]!, canonicalUrl: `https://www.tiktok.com/${parts[0]}/video/${parts[2]}` };
    }
    throw new UnsupportedUrlError('Use the full TikTok video link (tiktok.com/@user/video/…)');
  }
  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') {
    throw new UnsupportedUrlError('Short TikTok links are not supported. Open the video and copy the full link.');
  }

  if (host === 'instagram.com') {
    if ((parts[0] === 'reel' || parts[0] === 'reels' || parts[0] === 'p') && parts[1] && /^[A-Za-z0-9_-]{5,40}$/.test(parts[1])) {
      return { provider: 'instagram', shortcode: parts[1], canonicalUrl: `https://www.instagram.com/reel/${parts[1]}/` };
    }
    throw new UnsupportedUrlError('Use an Instagram Reel link (instagram.com/reel/…)');
  }

  throw new UnsupportedUrlError('Supported links: YouTube, YouTube Shorts, TikTok and Instagram Reels');
}

/** Parses ISO-8601 durations such as PT1H2M3S (YouTube contentDetails.duration). */
export function parseIsoDuration(value: string | undefined): number | null {
  const m = value ? /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value) : null;
  if (!m) return null;
  const [, d, h, min, s] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
}
