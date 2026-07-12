-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "currentFen" TEXT,
ADD COLUMN     "difficulty" "Difficulty",
ADD COLUMN     "moves" TEXT[];
