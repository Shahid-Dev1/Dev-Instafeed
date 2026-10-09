import {
  DEFAULT_TARGETING,
  defaultWidgetConfig,
  targetingSchema,
  widgetConfigSchema,
  type Targeting,
  type WidgetConfig,
  type WidgetDto,
  type WidgetPayload,
  type WidgetType,
} from '@instafeed/shared';
import type { Deps } from '../../deps.js';
import type { Prisma, Widget } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';

const WIDGET_INCLUDE = { videos: { orderBy: { position: 'asc' as const }, select: { videoId: true } } } satisfies Prisma.WidgetInclude;
type WidgetRow = Prisma.WidgetGetPayload<{ include: typeof WIDGET_INCLUDE }>;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function toWidgetDto(w: WidgetRow): WidgetDto {
  const videoIds = w.videos.map((v) => v.videoId);
  return {
    id: w.id,
    name: w.name,
    type: w.type,
    status: w.status,
    version: w.version,
    hasUnpublishedChanges:
      w.status === 'PUBLISHED' && (!same(w.config, w.publishedConfig) || !same(w.targeting, w.publishedTargeting) || !same(videoIds, w.publishedVideoIds)),
    publishedAt: w.publishedAt?.toISOString() ?? null,
    // Stored JSON is re-validated on read so a schema change can never leak malformed config.
    config: widgetConfigSchema.parse(w.config),
    targeting: targetingSchema.parse(w.targeting),
    videoIds,
    updatedAt: w.updatedAt.toISOString(),
  };
}

export async function loadWidget(deps: Deps, storeId: string, id: string): Promise<WidgetRow> {
  const w = await deps.db.widget.findFirst({ where: { storeId, id }, include: WIDGET_INCLUDE });
  if (!w) throw new AppError('NOT_FOUND', 'Widget not found');
  return w;
}

export async function createWidget(deps: Deps, storeId: string, name: string, type: WidgetType) {
  const w = await deps.db.widget.create({
    data: { storeId, name, type, config: defaultWidgetConfig(type), targeting: DEFAULT_TARGETING[type] },
    include: WIDGET_INCLUDE,
  });
  return w;
}

interface WidgetUpdate {
  version: number;
  name?: string;
  config?: WidgetConfig;
  targeting?: Targeting;
  videoIds?: string[];
}

/** Optimistic concurrency: the update applies only if `version` matches, otherwise CONFLICT (someone else saved first). */
export async function updateWidget(deps: Deps, storeId: string, id: string, input: WidgetUpdate) {
  await loadWidget(deps, storeId, id);
  if (input.videoIds?.length) {
    const found = await deps.db.video.count({ where: { storeId, id: { in: input.videoIds } } });
    if (found !== input.videoIds.length) throw new AppError('VALIDATION_ERROR', 'Some videos were not found', [{ path: 'videoIds', message: 'Unknown video' }]);
  }
  await deps.db.$transaction(async (tx) => {
    const res = await tx.widget.updateMany({
      where: { storeId, id, version: input.version },
      data: {
        version: { increment: 1 },
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.config ? { config: input.config } : {}),
        ...(input.targeting ? { targeting: input.targeting } : {}),
      },
    });
    if (res.count === 0) throw new AppError('CONFLICT', 'This widget was changed by someone else. Reload to see the latest version.');
    if (input.videoIds) {
      await tx.widgetVideo.deleteMany({ where: { storeId, widgetId: id } });
      await tx.widgetVideo.createMany({ data: input.videoIds.map((videoId, position) => ({ storeId, widgetId: id, videoId, position })) });
    }
  });
  return loadWidget(deps, storeId, id);
}

const playable = { status: 'READY' as const, archivedAt: null };

/** Publishing snapshots the draft. Manual widgets need at least one playable video. */
export async function publishWidget(deps: Deps, storeId: string, id: string) {
  const w = await loadWidget(deps, storeId, id);
  const config = widgetConfigSchema.parse(w.config);
  const videoIds = w.videos.map((v) => v.videoId);
  if (config.source === 'manual') {
    const ready = await deps.db.video.count({ where: { storeId, id: { in: videoIds }, ...playable } });
    if (ready === 0) throw new AppError('VALIDATION_ERROR', 'Add at least one ready video before publishing', [{ path: 'videoIds', message: 'No ready videos' }]);
  }
  await deps.db.widget.update({
    where: { id, storeId },
    data: {
      status: 'PUBLISHED',
      publishedConfig: config,
      publishedTargeting: targetingSchema.parse(w.targeting),
      publishedVideoIds: videoIds,
      publishedVersion: w.version,
      publishedAt: new Date(),
    },
  });
  return loadWidget(deps, storeId, id);
}

export async function unpublishWidget(deps: Deps, storeId: string, id: string) {
  await loadWidget(deps, storeId, id);
  await deps.db.widget.update({ where: { id, storeId }, data: { status: 'DRAFT' } });
  return loadWidget(deps, storeId, id);
}

/**
 * Builds the storefront payload: only READY, non-archived videos and non-deleted products, capped per config.
 * For product_tagged widgets, videos come from the given product's tags instead of the widget's list.
 */
export async function buildPayload(
  deps: Deps,
  storeId: string,
  w: { id: string; type: WidgetType; version: number; config: WidgetConfig; videoIds: string[] },
  opts: { productId?: string | null } = {},
): Promise<WidgetPayload> {
  const store = await deps.rawDb.store.findUniqueOrThrow({ where: { id: storeId }, select: { currency: true } });
  let ids = w.videoIds;
  if (w.config.source === 'product_tagged') {
    if (!opts.productId) ids = [];
    else {
      const tags = await deps.db.videoProduct.findMany({ where: { storeId, productId: opts.productId }, orderBy: { video: { createdAt: 'desc' } }, select: { videoId: true }, take: 50 });
      ids = tags.map((t) => t.videoId);
    }
  }
  const rows = await deps.db.video.findMany({
    where: { storeId, id: { in: ids }, ...playable },
    include: {
      products: {
        where: { storeId, product: { deletedAt: null } },
        orderBy: { position: 'asc' },
        take: w.config.product.maxProducts,
        include: { product: true, variant: true },
      },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const videos = ids.flatMap((id) => {
    const v = byId.get(id);
    if (!v) return [];
    return [{
      id: v.id,
      source: v.source,
      title: v.title,
      thumbnailUrl: v.thumbnailUrl,
      playbackUrl: v.playbackUrl,
      embedUrl: v.embedUrl,
      permalink: v.permalink,
      authorName: v.authorName,
      width: v.width,
      height: v.height,
      products: v.products.map((p) => ({
        id: p.productId,
        shopifyId: p.product.shopifyId,
        handle: p.product.handle,
        title: p.product.title,
        imageUrl: p.variant?.imageUrl ?? p.product.imageUrl,
        price: (p.variant?.price ?? p.product.priceMin)?.toFixed(2) ?? null,
        variantId: p.variantId,
        shopifyVariantId: p.variant?.shopifyId ?? null,
      })),
    }];
  });
  return { id: w.id, type: w.type, version: w.version, currency: store.currency, config: w.config, videos };
}

export const draftOf = (w: Widget & { videos: { videoId: string }[] }) => ({
  id: w.id,
  type: w.type,
  version: w.version,
  config: widgetConfigSchema.parse(w.config),
  videoIds: w.videos.map((v) => v.videoId),
});
