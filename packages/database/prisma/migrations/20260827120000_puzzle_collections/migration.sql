-- AlterEnum
ALTER TYPE "CoinReason" ADD VALUE 'PUZZLE_COLLECTION';

-- CreateTable
CREATE TABLE "PuzzleCollectionClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "solvedAtClaim" INTEGER NOT NULL,
    "xpAwarded" INTEGER NOT NULL,
    "coinsAwarded" INTEGER NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PuzzleCollectionClaim_pkey" PRIMARY KEY ("id")
);

-- One claim per player per collection: the payout's exactly-once.
CREATE UNIQUE INDEX "PuzzleCollectionClaim_userId_collectionId_key" ON "PuzzleCollectionClaim"("userId", "collectionId");

-- CreateIndex
CREATE INDEX "PuzzleCollectionClaim_userId_claimedAt_idx" ON "PuzzleCollectionClaim"("userId", "claimedAt" DESC);

-- AddForeignKey
ALTER TABLE "PuzzleCollectionClaim" ADD CONSTRAINT "PuzzleCollectionClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
