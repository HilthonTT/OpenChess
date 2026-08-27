-- The enum now carries the side of two different offers, so it is no longer
-- named for one of them. A rename, not a drop-and-create: the column keeps its
-- values and no game loses a standing draw offer to the migration.
ALTER TYPE "DrawOfferSide" RENAME TO "OfferSide";

-- AlterTable
ALTER TABLE "Game" ADD COLUMN "takebackOfferedBy" "OfferSide";
ALTER TABLE "Game" ADD COLUMN "takebacks" INTEGER NOT NULL DEFAULT 0;
