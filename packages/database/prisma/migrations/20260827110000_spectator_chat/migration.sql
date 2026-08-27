-- CreateEnum
CREATE TYPE "ChatScope" AS ENUM ('PLAYERS', 'SPECTATORS');

-- AlterTable
-- Defaulted, so every message written before the watchers had a channel stays
-- what it always was: something a player said.
ALTER TABLE "GameMessage" ADD COLUMN "scope" "ChatScope" NOT NULL DEFAULT 'PLAYERS';

-- The read is now always scoped, and so is the flood-control count.
DROP INDEX "GameMessage_gameId_createdAt_idx";
DROP INDEX "GameMessage_gameId_senderId_idx";
CREATE INDEX "GameMessage_gameId_scope_createdAt_idx" ON "GameMessage"("gameId", "scope", "createdAt");
CREATE INDEX "GameMessage_gameId_senderId_scope_idx" ON "GameMessage"("gameId", "senderId", "scope");
