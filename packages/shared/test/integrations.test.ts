import { describe, expect, it } from 'vitest';
import { cssProblem, defaultWidgetConfig, diffConfig, integrationConfigSchemas } from '../src/index.ts';

describe('custom CSS validation', () => {
  it('accepts ordinary CSS', () => {
    expect(cssProblem('.if-card { border-radius: 20px; } .if-btn:hover { background: #000; background-image: url("https://cdn.shopify.com/x.png"); }')).toBeNull();
  });
  it.each([
    ['</style><script>alert(1)</script>', /HTML/],
    ['@import url(https://evil.example/x.css);', /@import/],
    ['.a { width: expression(alert(1)) }', /expression/],
    ['.a { background: url(javascript:alert(1)) }', /javascript/],
    ['.a { background: url(http://insecure.example/x.png) }', /https/],
    ['.a { background: url(data:image/png;base64,AAAA) }', /https/],
    ['.a { content: "\\3c script" }', /Backslash/],
    ['.a { color: red', /Unbalanced/],
    ['.a { -moz-binding: x }', /binding/],
  ])('rejects %s', (css, msg) => expect(cssProblem(css)).toMatch(msg));
});

describe('integration config', () => {
  it('validates destination ids', () => {
    expect(integrationConfigSchemas.GA4.public.safeParse({ measurementId: 'G-ABC123XYZ', sendVia: 'gtag' }).success).toBe(true);
    expect(integrationConfigSchemas.GA4.public.safeParse({ measurementId: 'UA-1234', sendVia: 'gtag' }).success).toBe(false);
    expect(integrationConfigSchemas.META.public.safeParse({ pixelId: '123456789012345' }).success).toBe(true);
    expect(integrationConfigSchemas.CLEVERTAP.public.safeParse({ accountId: 'W9R-486-4W5Z', region: 'in1' }).success).toBe(true);
    expect(integrationConfigSchemas.MIXPANEL.public.safeParse({ token: 'not-a-token', region: 'us' }).success).toBe(false);
  });
});

describe('diffConfig', () => {
  it('lists leaf changes by path', () => {
    const a = defaultWidgetConfig('CAROUSEL');
    const b = { ...a, style: { ...a.style, cardRadius: 24 }, cta: { ...a.cta, label: 'Buy' } };
    expect(diffConfig(a, b)).toEqual([
      { path: 'style.cardRadius', from: 12, to: 24 },
      { path: 'cta.label', from: 'Shop now', to: 'Buy' },
    ]);
  });
});
