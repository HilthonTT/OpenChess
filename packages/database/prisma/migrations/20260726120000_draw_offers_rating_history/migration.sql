-- CreateEnum
CREATE TYPE "DrawOfferSide" AS ENUM ('WHITE', 'BLACK');

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "drawOfferedBy" "DrawOfferSide";

-- CreateTable
CREATE TABLE "RatingSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "gameId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RatingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RatingSnapshot_userId_gameId_key" ON "RatingSnapshot"("userId", "gameId");

-- CreateIndex
CREATE INDEX "RatingSnapshot_userId_createdAt_idx" ON "RatingSnapshot"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "RatingSnapshot" ADD CONSTRAINT "RatingSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatingSnapshot" ADD CONSTRAINT "RatingSnapshot_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;
