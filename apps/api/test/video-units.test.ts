import { describe, expect, it } from 'vitest';
import { mapBunnyStatus } from '../src/modules/videos/providers/bunny.js';
import { parseIsoDuration, parseVideoUrl } from '../src/modules/videos/url-parsers.js';

describe('parseVideoUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', { provider: 'youtube', id: 'dQw4w9WgXcQ', shorts: false }],
    ['https://youtu.be/dQw4w9WgXcQ?t=3', { provider: 'youtube', id: 'dQw4w9WgXcQ', shorts: false }],
    ['https://youtube.com/shorts/abcdefghijk', { provider: 'youtube', id: 'abcdefghijk', shorts: true }],
    ['https://m.youtube.com/embed/abcdefghijk', { provider: 'youtube', id: 'abcdefghijk', shorts: false }],
    ['https://www.tiktok.com/@brand/video/7234567890123456789?lang=en', { provider: 'tiktok', id: '7234567890123456789' }],
    ['https://www.instagram.com/reel/C7xYz12AbCd/?igsh=1', { provider: 'instagram', shortcode: 'C7xYz12AbCd' }],
  ])('accepts %s', (url, expected) => expect(parseVideoUrl(url)).toMatchObject(expected));

  it.each([
    ['not a url', /valid URL/],
    ['ftp://youtube.com/watch?v=dQw4w9WgXcQ', /valid URL/],
    ['https://www.youtube.com/watch?v=short', /does not point/],
    ['https://www.youtube.com/channel/UC123', /does not point/],
    ['https://vm.tiktok.com/ZMabc/', /Short TikTok links/],
    ['https://www.tiktok.com/@brand', /full TikTok video link/],
    ['https://www.instagram.com/brand/', /Reel link/],
    ['https://vimeo.com/123', /Supported links/],
    ['https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ', /Supported links/],
  ])('rejects %s', (url, msg) => expect(() => parseVideoUrl(url)).toThrow(msg));
});

describe('helpers', () => {
  it('parses ISO-8601 durations', () => {
    expect(parseIsoDuration('PT1M5S')).toBe(65);
    expect(parseIsoDuration('PT1H')).toBe(3600);
    expect(parseIsoDuration('P1DT2S')).toBe(86402);
    expect(parseIsoDuration('garbage')).toBeNull();
  });

  it('maps Bunny encoding states', () => {
    expect([0, 1, 2, 3, 4, 5, 8, 9].map(mapBunnyStatus)).toEqual(['PROCESSING', 'PROCESSING', 'PROCESSING', 'READY', 'READY', 'FAILED', 'FAILED', null]);
  });
});
