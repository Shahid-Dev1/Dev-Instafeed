import { z } from 'zod';
import { EVENT_TYPES } from './analytics.ts';
import { widgetConfigSchema } from './widgets.ts';

export const INTEGRATION_KINDS = ['GA4', 'GTM', 'META', 'MIXPANEL', 'CLEVERTAP'] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

/** Storefront events that may be forwarded. checkout_start is excluded: Shopify's own channels already report checkout. */
export const FORWARDABLE_EVENTS = EVENT_TYPES.filter((e) => e !== 'checkout_start');
export const DEFAULT_FORWARDED: (typeof FORWARDABLE_EVENTS)[number][] = ['video_open', 'product_click', 'add_to_cart'];
const eventsSchema = z.array(z.enum(FORWARDABLE_EVENTS as unknown as [string, ...string[]])).max(FORWARDABLE_EVENTS.length);

const CT_REGIONS = ['eu1', 'in1', 'us1', 'sg1', 'aps3', 'mec1'] as const;

/** Public config (sent to the storefront) and server-only secrets, per destination. */
export const integrationConfigSchemas = {
  GA4: {
    public: z.object({ measurementId: z.string().regex(/^G-[A-Z0-9]{4,15}$/, 'Use your GA4 Measurement ID (G-XXXXXXX)'), sendVia: z.enum(['gtag', 'gtm']) }).strict(),
    secrets: z.object({ apiSecret: z.string().min(10).max(100).optional() }).strict(),
  },
  GTM: {
    public: z.object({ containerId: z.string().regex(/^GTM-[A-Z0-9]{4,12}$/, 'Use your container ID (GTM-XXXXXX)') }).strict(),
    secrets: z.object({}).strict(),
  },
  META: {
    public: z.object({ pixelId: z.string().regex(/^\d{10,20}$/, 'Use your numeric Meta Pixel ID') }).strict(),
    secrets: z.object({ accessToken: z.string().min(20).max(500).optional(), testEventCode: z.string().regex(/^TEST\d{3,10}$/).optional() }).strict(),
  },
  MIXPANEL: {
    public: z.object({ token: z.string().regex(/^[a-f0-9]{32}$/, 'Use your 32-character project token'), region: z.enum(['us', 'eu', 'in']) }).strict(),
    secrets: z.object({}).strict(),
  },
  CLEVERTAP: {
    public: z.object({ accountId: z.string().regex(/^[A-Z0-9]{3,4}-[A-Z0-9]{3}-[A-Z0-9]{3,4}$/, 'Use your CleverTap Account ID (XXX-XXX-XXXX)'), region: z.enum(CT_REGIONS) }).strict(),
    secrets: z.object({ passcode: z.string().min(6).max(200).optional() }).strict(),
  },
} as const;

export const saveIntegrationSchema = z
  .object({
    enabled: z.boolean(),
    publicConfig: z.record(z.string(), z.unknown()),
    /** Omitted secrets keep their stored values; null clears them. */
    secrets: z.record(z.string(), z.unknown()).nullable().optional(),
    events: eventsSchema,
  })
  .strict();

export const integrationSchema = z.object({
  kind: z.enum(INTEGRATION_KINDS),
  connected: z.boolean(),
  enabled: z.boolean(),
  publicConfig: z.record(z.string(), z.unknown()).nullable(),
  /** Names of secrets that are set; values are never returned. */
  secretsSet: z.array(z.string()),
  events: z.array(z.string()),
  status: z.string(),
  lastError: z.string().nullable(),
  lastCheckedAt: z.string().nullable(),
  logs: z.array(z.object({ level: z.string(), message: z.string(), createdAt: z.string() })),
});
export type IntegrationDto = z.infer<typeof integrationSchema>;
export const integrationListSchema = z.object({ items: z.array(integrationSchema) });

/** What the storefront receives: public ids and the event allow-list only. */
export type StorefrontIntegrations = Partial<Record<IntegrationKind, { config: Record<string, string>; events: string[] }>>;

// ---- Custom CSS ----
const CSS_FORBIDDEN: [RegExp, string][] = [
  [/<\s*\/?\s*(style|script)/i, 'HTML tags are not allowed'],
  [/@import/i, '@import is not allowed'],
  [/expression\s*\(/i, 'expression() is not allowed'],
  [/javascript\s*:/i, 'javascript: URLs are not allowed'],
  [/behavior\s*:|-moz-binding/i, 'behavior / -moz-binding are not allowed'],
  [/\\/, 'Backslash escapes are not allowed'],
  [/url\s*\(\s*(?!['"]?https:\/\/)/i, 'Only https:// URLs are allowed in url()'],
];

/** Returns an error message, or null when the CSS is acceptable. Applied only inside widget shadow roots. */
export function cssProblem(css: string): string | null {
  for (const [re, msg] of CSS_FORBIDDEN) if (re.test(css)) return msg;
  let depth = 0;
  for (const ch of css) {
    if (ch === '{') depth++;
    if (ch === '}' && --depth < 0) return 'Unbalanced braces';
  }
  return depth === 0 ? null : 'Unbalanced braces';
}
export const customCssSchema = z.string().max(10_000, 'Custom CSS is limited to 10,000 characters').superRefine((css, ctx) => {
  const problem = cssProblem(css);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

// ---- AI widget assistant ----
export const aiWidgetRequestSchema = z.object({ prompt: z.string().trim().min(3).max(500), config: widgetConfigSchema }).strict();
export const aiWidgetResponseSchema = z.object({
  config: widgetConfigSchema,
  summary: z.string(),
  changes: z.array(z.object({ path: z.string(), from: z.unknown(), to: z.unknown() })),
});
export type AiWidgetResponse = z.infer<typeof aiWidgetResponseSchema>;

/** Leaf-level differences between two configs, as dotted paths. */
export function diffConfig(a: unknown, b: unknown, path = ''): { path: string; from: unknown; to: unknown }[] {
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => diffConfig((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [{ path, from: a, to: b }];
}
