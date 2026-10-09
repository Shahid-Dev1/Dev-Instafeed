-- CreateEnum
CREATE TYPE "WidgetType" AS ENUM ('STORIES', 'CAROUSEL', 'FLOATING', 'BANNER', 'GRID', 'PRODUCT_GALLERY');

-- CreateEnum
CREATE TYPE "WidgetStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "Widget" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WidgetType" NOT NULL,
    "status" "WidgetStatus" NOT NULL DEFAULT 'DRAFT',
    "config" JSONB NOT NULL,
    "targeting" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedVersion" INTEGER,
    "publishedConfig" JSONB,
    "publishedTargeting" JSONB,
    "publishedVideoIds" TEXT[],
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Widget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WidgetVideo" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "widgetId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "WidgetVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Widget_storeId_status_idx" ON "Widget"("storeId", "status");

-- CreateIndex
CREATE INDEX "WidgetVideo_storeId_videoId_idx" ON "WidgetVideo"("storeId", "videoId");

-- CreateIndex
CREATE UNIQUE INDEX "WidgetVideo_storeId_widgetId_videoId_key" ON "WidgetVideo"("storeId", "widgetId", "videoId");

-- AddForeignKey
ALTER TABLE "Widget" ADD CONSTRAINT "Widget_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WidgetVideo" ADD CONSTRAINT "WidgetVideo_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WidgetVideo" ADD CONSTRAINT "WidgetVideo_widgetId_fkey" FOREIGN KEY ("widgetId") REFERENCES "Widget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WidgetVideo" ADD CONSTRAINT "WidgetVideo_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
