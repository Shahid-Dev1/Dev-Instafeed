-- CreateEnum
CREATE TYPE "VideoSource" AS ENUM ('UPLOAD', 'YOUTUBE', 'TIKTOK_URL', 'TIKTOK_ACCOUNT', 'INSTAGRAM_ACCOUNT', 'INSTAGRAM_URL');

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('TIKTOK', 'INSTAGRAM');

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "source" "VideoSource" NOT NULL,
    "externalId" TEXT NOT NULL,
    "bunnyVideoId" TEXT,
    "status" "VideoStatus" NOT NULL DEFAULT 'PENDING',
    "statusMessage" TEXT,
    "title" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "thumbnailUrl" TEXT,
    "playbackUrl" TEXT,
    "embedUrl" TEXT,
    "permalink" TEXT,
    "authorName" TEXT,
    "tags" TEXT[],
    "bytes" BIGINT,
    "archivedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoProduct" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "position" INTEGER NOT NULL,

    CONSTRAINT "VideoProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderAccount" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "username" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenEnc" TEXT,
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Video_storeId_archivedAt_createdAt_idx" ON "Video"("storeId", "archivedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Video_storeId_bunnyVideoId_idx" ON "Video"("storeId", "bunnyVideoId");

-- CreateIndex
CREATE UNIQUE INDEX "Video_storeId_source_externalId_key" ON "Video"("storeId", "source", "externalId");

-- CreateIndex
CREATE INDEX "VideoProduct_storeId_productId_idx" ON "VideoProduct"("storeId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoProduct_storeId_videoId_productId_key" ON "VideoProduct"("storeId", "videoId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderAccount_storeId_provider_key" ON "ProviderAccount"("storeId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthState_stateHash_key" ON "OAuthState"("stateHash");

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProduct" ADD CONSTRAINT "VideoProduct_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProduct" ADD CONSTRAINT "VideoProduct_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProduct" ADD CONSTRAINT "VideoProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProduct" ADD CONSTRAINT "VideoProduct_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAccount" ADD CONSTRAINT "ProviderAccount_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthState" ADD CONSTRAINT "OAuthState_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
