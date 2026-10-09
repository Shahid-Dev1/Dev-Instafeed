import { z } from 'zod';

export const PRODUCT_STATUSES = ['ACTIVE', 'DRAFT', 'ARCHIVED', 'UNLISTED'] as const;

export const productListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ProductListQuery = z.input<typeof productListQuerySchema>;

export const variantSchema = z.object({
  id: z.string(),
  shopifyId: z.string(),
  title: z.string(),
  sku: z.string().nullable(),
  price: z.string(),
  availableForSale: z.boolean(),
  options: z.array(z.object({ name: z.string(), value: z.string() })),
  imageUrl: z.string().nullable(),
});
export type VariantDto = z.infer<typeof variantSchema>;

export const productSummarySchema = z.object({
  id: z.string(),
  shopifyId: z.string(),
  handle: z.string(),
  title: z.string(),
  status: z.string(),
  imageUrl: z.string().nullable(),
  priceMin: z.string().nullable(),
  priceMax: z.string().nullable(),
  totalVariants: z.number().int(),
});
export type ProductSummary = z.infer<typeof productSummarySchema>;

export const productListSchema = z.object({ items: z.array(productSummarySchema), nextCursor: z.string().nullable() });
export const productDetailSchema = productSummarySchema.extend({ variants: z.array(variantSchema) });
export type ProductDetail = z.infer<typeof productDetailSchema>;

export const syncRunSchema = z.object({
  id: z.string(),
  status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']),
  trigger: z.string(),
  upserted: z.number().int(),
  deleted: z.number().int(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type SyncRunDto = z.infer<typeof syncRunSchema>;
export const syncStatusSchema = z.object({ syncRun: syncRunSchema.nullable() });
