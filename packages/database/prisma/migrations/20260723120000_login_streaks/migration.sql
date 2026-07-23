-- AlterEnum
-- Postgres 12+ permits ADD VALUE inside a transaction as long as the new label
-- is not itself used before the transaction commits. Nothing below references
-- it, so this is safe under Prisma's transactional migration runner.
ALTER TYPE "CoinReason" ADD VALUE 'DAILY_STREAK';

-- AlterTable
ALTER TABLE "UserStats" ADD COLUMN     "currentLoginStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "topLoginStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastCheckInDay" DATE;
