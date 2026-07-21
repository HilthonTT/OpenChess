-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "initialSeconds" INTEGER,
ADD COLUMN     "incrementSeconds" INTEGER,
ADD COLUMN     "whiteTimeMs" INTEGER,
ADD COLUMN     "blackTimeMs" INTEGER,
ADD COLUMN     "turnStartedAt" TIMESTAMP(3);
