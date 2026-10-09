-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "accessTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "refreshTokenEnc" TEXT,
ADD COLUMN     "refreshTokenExpiresAt" TIMESTAMP(3);
