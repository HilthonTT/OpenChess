-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- AlterTable
-- Nullable rather than defaulted to now(): an account that has not made a
-- request since this column existed has not been seen, and backfilling every
-- one of them with the migration's own timestamp would show the whole player
-- base as online at once.
ALTER TABLE "User" ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Friendship" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "addresseeId" TEXT NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameMessage" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_requesterId_addresseeId_key" ON "Friendship"("requesterId", "addresseeId");

-- CreateIndex
CREATE INDEX "Friendship_addresseeId_status_idx" ON "Friendship"("addresseeId", "status");

-- CreateIndex
CREATE INDEX "Friendship_requesterId_status_idx" ON "Friendship"("requesterId", "status");

-- CreateIndex
CREATE INDEX "GameMessage_gameId_createdAt_idx" ON "GameMessage"("gameId", "createdAt");

-- CreateIndex
CREATE INDEX "GameMessage_gameId_senderId_idx" ON "GameMessage"("gameId", "senderId");

-- CreateIndex
-- Player search is `username LIKE 'foo%'`. The unique index on
-- "User"."username" cannot answer that on a non-C collation — a prefix match is
-- not a range in collation order — so a search would be a sequential scan of
-- every account. `text_pattern_ops` compares byte by byte, which is exactly the
-- ordering a prefix LIKE needs, and turns the search into a range scan.
--
-- Case is handled by normalizing the *query* rather than by an ILIKE or a
-- `lower()` expression index: every username is stored lower case (see
-- `sanitize` in server/src/lib/users.ts), so `normalizeUsername` on the way in
-- is enough, and it is the only version of this that any index can serve.
--
-- Operator classes are not expressible in the Prisma schema, so this index
-- lives here and only here. A `prisma db push` against a scratch database will
-- not have it; a migrated one will.
CREATE INDEX "User_username_pattern_idx" ON "User" ("username" text_pattern_ops);

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_addresseeId_fkey" FOREIGN KEY ("addresseeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameMessage" ADD CONSTRAINT "GameMessage_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameMessage" ADD CONSTRAINT "GameMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
