-- CreateEnum
CREATE TYPE "IntegrationKind" AS ENUM ('GA4', 'GTM', 'META', 'MIXPANEL', 'CLEVERTAP');

-- AlterTable
ALTER TABLE "StoreSettings" ADD COLUMN     "customCss" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" "IntegrationKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "publicConfig" JSONB NOT NULL,
    "secretsEnc" TEXT,
    "events" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'NOT_TESTED',
    "lastError" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationLog" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" "IntegrationKind" NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Integration_storeId_kind_key" ON "Integration"("storeId", "kind");

-- CreateIndex
CREATE INDEX "IntegrationLog_storeId_kind_createdAt_idx" ON "IntegrationLog"("storeId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationLog" ADD CONSTRAINT "IntegrationLog_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
