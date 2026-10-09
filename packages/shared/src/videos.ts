import { z } from 'zod';

export const VIDEO_SOURCES = ['UPLOAD', 'YOUTUBE', 'TIKTOK_URL', 'TIKTOK_ACCOUNT', 'INSTAGRAM_ACCOUNT', 'INSTAGRAM_URL'] as const;
export const VIDEO_STATUSES = ['PENDING', 'PROCESSING', 'READY', 'FAILED', 'UNAVAILABLE'] as const;
export type VideoSource = (typeof VIDEO_SOURCES)[number];
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'] as const;

const tag = z.string().trim().toLowerCase().min(1).max(40).regex(/^[\p{L}\p{N} _-]+$/u, 'Letters, numbers, spaces, - and _ only');
export const tagsSchema = z.array(tag).max(20).transform((t) => [...new Set(t)]);

export const videoListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  source: z.enum(VIDEO_SOURCES).optional(),
  status: z.enum(VIDEO_STATUSES).optional(),
  tag: tag.optional(),
  archived: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  sort: z.enum(['newest', 'oldest', 'title']).default('newest'),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});
export type VideoListQuery = z.input<typeof videoListQuerySchema>;

export const importUrlSchema = z.object({ url: z.url().max(500) });

export const createUploadSchema = z.object({
  title: z.string().trim().min(1).max(200),
  bytes: z.number().int().positive(),
  contentType: z.enum(ACCEPTED_VIDEO_TYPES),
  /** The merchant confirms they own or are licensed to use the file. */
  rightsConfirmed: z.literal(true),
});

export const uploadTicketSchema = z.object({
  videoId: z.string(),
  tus: z.object({
    endpoint: z.string(),
    headers: z.record(z.string(), z.string()),
  }),
});
export type UploadTicket = z.infer<typeof uploadTicketSchema>;

export const updateVideoSchema = z
  .object({ title: z.string().trim().min(1).max(200).optional(), tags: tagsSchema.optional() })
  .refine((v) => v.title !== undefined || v.tags !== undefined, 'Nothing to update');

export const bulkVideoSchema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['archive', 'unarchive', 'delete']), ids: z.array(z.string().max(64)).min(1).max(100) }),
  z.object({ action: z.enum(['addTags', 'removeTags']), ids: z.array(z.string().max(64)).min(1).max(100), tags: tagsSchema }),
]);

export const videoProductsSchema = z
  .array(z.object({ productId: z.string().max(64), variantId: z.string().max(64).nullable().optional() }))
  .max(20)
  .refine((items) => new Set(items.map((i) => i.productId)).size === items.length, 'Each product can be tagged once');

export const taggedProductSchema = z.object({
  productId: z.string(),
  variantId: z.string().nullable(),
  title: z.string(),
  variantTitle: z.string().nullable(),
  imageUrl: z.string().nullable(),
  deleted: z.boolean(),
});

export const videoSchema = z.object({
  id: z.string(),
  source: z.enum(VIDEO_SOURCES),
  status: z.enum(VIDEO_STATUSES),
  statusMessage: z.string().nullable(),
  title: z.string(),
  durationSec: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  thumbnailUrl: z.string().nullable(),
  playbackUrl: z.string().nullable(),
  embedUrl: z.string().nullable(),
  permalink: z.string().nullable(),
  authorName: z.string().nullable(),
  tags: z.array(z.string()),
  archived: z.boolean(),
  createdAt: z.string(),
  products: z.array(taggedProductSchema),
});
export type VideoDto = z.infer<typeof videoSchema>;
export const videoListSchema = z.object({ items: z.array(videoSchema), nextCursor: z.string().nullable() });
export const videoResponseSchema = z.object({ video: videoSchema });

export const providerVideoSchema = z.object({
  id: z.string(),
  title: z.string(),
  thumbnailUrl: z.string().nullable(),
  durationSec: z.number().nullable(),
  importable: z.boolean(),
  reason: z.string().nullable(),
  alreadyImported: z.boolean(),
});
export type ProviderVideo = z.infer<typeof providerVideoSchema>;
export const providerVideoListSchema = z.object({ items: z.array(providerVideoSchema), nextCursor: z.string().nullable() });
export const importProviderVideosSchema = z.object({ ids: z.array(z.string().max(64)).min(1).max(50), rightsConfirmed: z.literal(true).optional() });

export const PROVIDERS = ['tiktok', 'instagram'] as const;
export const providerStatusSchema = z.object({
  provider: z.enum(PROVIDERS),
  enabled: z.boolean(),
  configured: z.boolean(),
  connected: z.boolean(),
  username: z.string().nullable(),
  status: z.string().nullable(),
});
export type ProviderStatus = z.infer<typeof providerStatusSchema>;

export const videoCapabilitiesSchema = z.object({
  upload: z.boolean(),
  youtube: z.boolean(),
  tiktokUrl: z.boolean(),
  instagramUrl: z.boolean(),
  maxUploadMb: z.number(),
  providers: z.array(providerStatusSchema),
});
export type VideoCapabilities = z.infer<typeof videoCapabilitiesSchema>;
