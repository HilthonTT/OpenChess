-- CreateEnum
CREATE TYPE "RepertoireSide" AS ENUM ('WHITE', 'BLACK');

-- CreateTable
CREATE TABLE "RepertoireLine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eco" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "moves" TEXT[],
    "side" "RepertoireSide" NOT NULL,
    "lineKey" TEXT NOT NULL,
    "ease" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "reviews" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepertoireLine_pkey" PRIMARY KEY ("id")
);

-- One entry per line per colour per player.
CREATE UNIQUE INDEX "RepertoireLine_userId_lineKey_key" ON "RepertoireLine"("userId", "lineKey");

-- The queue: this player's lines, soonest due first.
CREATE INDEX "RepertoireLine_userId_dueAt_idx" ON "RepertoireLine"("userId", "dueAt");

-- AddForeignKey
ALTER TABLE "RepertoireLine" ADD CONSTRAINT "RepertoireLine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
