-- CreateEnum
CREATE TYPE "GameVariant" AS ENUM ('STANDARD', 'CHESS960');

-- CreateEnum
CREATE TYPE "PuzzleRushMode" AS ENUM ('THREE_MINUTE', 'FIVE_MINUTE', 'SURVIVAL');

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "variant" "GameVariant" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "startFen" TEXT,
ADD COLUMN     "personality" TEXT;

-- AlterTable
ALTER TABLE "Challenge" ADD COLUMN     "variant" "GameVariant" NOT NULL DEFAULT 'STANDARD';

-- CreateTable
CREATE TABLE "PuzzleRushRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "PuzzleRushMode" NOT NULL,
    "solved" INTEGER NOT NULL DEFAULT 0,
    "missed" INTEGER NOT NULL DEFAULT 0,
    "currentPuzzleId" TEXT,
    "servedPuzzleIds" TEXT[],
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "xpAwarded" INTEGER NOT NULL DEFAULT 0,
    "coinsAwarded" INTEGER NOT NULL DEFAULT 0,
    "rewardsGranted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PuzzleRushRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PuzzleRushRun_userId_startedAt_idx" ON "PuzzleRushRun"("userId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "PuzzleRushRun_mode_solved_idx" ON "PuzzleRushRun"("mode", "solved" DESC);

-- CreateIndex
-- Array containment (`themes @> ARRAY['fork']`) is not something a b-tree can
-- answer; GIN is the index for it. Without this, serving a themed puzzle is a
-- sequential scan of the whole corpus.
CREATE INDEX "Puzzle_themes_idx" ON "Puzzle" USING GIN ("themes" array_ops);

-- AddForeignKey
ALTER TABLE "PuzzleRushRun" ADD CONSTRAINT "PuzzleRushRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PuzzleRushRun" ADD CONSTRAINT "PuzzleRushRun_currentPuzzleId_fkey" FOREIGN KEY ("currentPuzzleId") REFERENCES "Puzzle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
