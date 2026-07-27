-- AlterTable
ALTER TABLE "CoinTransaction" ADD COLUMN     "periodKey" TEXT;

-- CreateIndex
-- NULLs are distinct in Postgres, so this only constrains rows that name a
-- period: one scheduled payout per user per reason per period, while every
-- existing row (periodKey NULL) stays unconstrained.
CREATE UNIQUE INDEX "CoinTransaction_userId_reason_periodKey_key" ON "CoinTransaction"("userId", "reason", "periodKey");
