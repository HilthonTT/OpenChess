-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ChallengeColor" AS ENUM ('WHITE', 'BLACK', 'RANDOM');

-- CreateEnum
CREATE TYPE "ClockPreset" AS ENUM ('BULLET', 'BLITZ', 'RAPID');

-- AlterEnum
ALTER TYPE "CoinReason" ADD VALUE 'PUZZLE';

-- AlterTable
ALTER TABLE "UserStats" ADD COLUMN     "puzzleRating" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "puzzlesSolved" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "puzzlesAttempted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "currentPuzzleStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "topPuzzleStreak" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Puzzle" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "fen" TEXT NOT NULL,
    "moves" TEXT[],
    "rating" INTEGER NOT NULL,
    "themes" TEXT[],
    "sourceUrl" TEXT,
    "plays" INTEGER NOT NULL DEFAULT 0,
    "solves" INTEGER NOT NULL DEFAULT 0,
    "dailyOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Puzzle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PuzzleAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "puzzleId" TEXT NOT NULL,
    "solved" BOOLEAN NOT NULL,
    "hintUsed" BOOLEAN NOT NULL DEFAULT false,
    "msSpent" INTEGER,
    "ratingBefore" INTEGER NOT NULL,
    "ratingAfter" INTEGER NOT NULL,
    "xpAwarded" INTEGER NOT NULL DEFAULT 0,
    "coinsAwarded" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PuzzleAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Challenge" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "challengerId" TEXT NOT NULL,
    "challengedId" TEXT,
    "color" "ChallengeColor" NOT NULL DEFAULT 'RANDOM',
    "clock" "ClockPreset",
    "status" "ChallengeStatus" NOT NULL DEFAULT 'PENDING',
    "gameId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Puzzle_externalId_key" ON "Puzzle"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Puzzle_dailyOn_key" ON "Puzzle"("dailyOn");

-- CreateIndex
CREATE INDEX "Puzzle_rating_idx" ON "Puzzle"("rating");

-- CreateIndex
CREATE UNIQUE INDEX "PuzzleAttempt_userId_puzzleId_key" ON "PuzzleAttempt"("userId", "puzzleId");

-- CreateIndex
CREATE INDEX "PuzzleAttempt_userId_createdAt_idx" ON "PuzzleAttempt"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Challenge_code_key" ON "Challenge"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Challenge_gameId_key" ON "Challenge"("gameId");

-- CreateIndex
CREATE INDEX "Challenge_challengedId_status_createdAt_idx" ON "Challenge"("challengedId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Challenge_challengerId_status_createdAt_idx" ON "Challenge"("challengerId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "UserStats_puzzleRating_idx" ON "UserStats"("puzzleRating" DESC);

-- CreateIndex
CREATE INDEX "Game_mode_endedAt_startedAt_idx" ON "Game"("mode", "endedAt", "startedAt" DESC);

-- AddForeignKey
ALTER TABLE "PuzzleAttempt" ADD CONSTRAINT "PuzzleAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PuzzleAttempt" ADD CONSTRAINT "PuzzleAttempt_puzzleId_fkey" FOREIGN KEY ("puzzleId") REFERENCES "Puzzle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_challengerId_fkey" FOREIGN KEY ("challengerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_challengedId_fkey" FOREIGN KEY ("challengedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;
