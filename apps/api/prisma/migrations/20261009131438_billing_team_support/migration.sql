-- CreateEnum
CREATE TYPE "PlatformRoleKind" AS ENUM ('SUPPORT', 'ADMIN');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "publicKey" TEXT NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
ADD COLUMN     "shopGid" TEXT;

-- AlterTable
ALTER TABLE "StoreSettings" ADD COLUMN     "authorizedDomains" TEXT[],
ADD COLUMN     "defaultPurchaseFlow" TEXT NOT NULL DEFAULT 'POPUP';

-- CreateTable
CREATE TABLE "Subscription" (
    "storeId" TEXT NOT NULL,
    "planId" "PlanId" NOT NULL DEFAULT 'FREE',
    "status" TEXT NOT NULL DEFAULT 'NONE',
    "planHandle" TEXT,
    "billingPeriod" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "cancelAtEndOfCycle" BOOLEAN NOT NULL DEFAULT false,
    "pendingPlanHandle" TEXT,
    "overLimitSince" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("storeId")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformRole" (
    "userId" TEXT NOT NULL,
    "role" "PlatformRoleKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformRole_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");

-- CreateIndex
CREATE INDEX "Invite_storeId_email_idx" ON "Invite"("storeId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Store_publicKey_key" ON "Store"("publicKey");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformRole" ADD CONSTRAINT "PlatformRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

