-- CreateEnum
CREATE TYPE "Attribution" AS ENUM ('PENDING', 'DIRECT', 'ASSISTED', 'NONE');

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "v" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "widgetId" TEXT,
    "videoId" TEXT,
    "productId" TEXT,
    "variantId" TEXT,
    "quantity" INTEGER,
    "value" BIGINT,
    "currency" TEXT,
    "progress" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyStat" (
    "storeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "widgetId" TEXT NOT NULL DEFAULT '',
    "videoId" TEXT NOT NULL DEFAULT '',
    "productId" TEXT NOT NULL DEFAULT '',
    "widgetImpressions" INTEGER NOT NULL DEFAULT 0,
    "videoImpressions" INTEGER NOT NULL DEFAULT 0,
    "videoOpens" INTEGER NOT NULL DEFAULT 0,
    "videoStarts" INTEGER NOT NULL DEFAULT 0,
    "videoPauses" INTEGER NOT NULL DEFAULT 0,
    "videoProgress" INTEGER NOT NULL DEFAULT 0,
    "videoCompletes" INTEGER NOT NULL DEFAULT 0,
    "productClicks" INTEGER NOT NULL DEFAULT 0,
    "popupOpens" INTEGER NOT NULL DEFAULT 0,
    "variantSelects" INTEGER NOT NULL DEFAULT 0,
    "addToCarts" INTEGER NOT NULL DEFAULT 0,
    "addToCartValue" BIGINT NOT NULL DEFAULT 0,
    "checkoutStarts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyStat_pkey" PRIMARY KEY ("storeId","date","widgetId","videoId","productId")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "name" TEXT,
    "createdAtShopify" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "lineItems" JSONB NOT NULL,
    "visitorId" TEXT,
    "test" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "attribution" "Attribution" NOT NULL DEFAULT 'PENDING',
    "attributedMinor" BIGINT NOT NULL DEFAULT 0,
    "attributedWidgetId" TEXT,
    "attributedVideoId" TEXT,
    "attributedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSettings" (
    "storeId" TEXT NOT NULL,
    "attributionWindowDays" INTEGER NOT NULL DEFAULT 7,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSettings_pkey" PRIMARY KEY ("storeId")
);

-- CreateIndex
CREATE INDEX "AnalyticsEvent_storeId_visitorId_occurredAt_idx" ON "AnalyticsEvent"("storeId", "visitorId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_storeId_occurredAt_idx" ON "AnalyticsEvent"("storeId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsEvent_storeId_eventId_key" ON "AnalyticsEvent"("storeId", "eventId");

-- CreateIndex
CREATE INDEX "Order_storeId_createdAtShopify_idx" ON "Order"("storeId", "createdAtShopify");

-- CreateIndex
CREATE UNIQUE INDEX "Order_storeId_shopifyOrderId_key" ON "Order"("storeId", "shopifyOrderId");

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyStat" ADD CONSTRAINT "DailyStat_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSettings" ADD CONSTRAINT "StoreSettings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
