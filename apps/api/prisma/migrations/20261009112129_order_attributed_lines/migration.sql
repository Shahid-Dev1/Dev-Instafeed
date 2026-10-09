-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "attributedLines" JSONB NOT NULL DEFAULT '[]';
