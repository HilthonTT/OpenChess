import { z } from "@hono/zod-openapi";

/**
 * A page cursor is `<iso-timestamp>_<row-id>` — compound, because the sort
 * timestamp alone is not unique: a payout `createMany`s several ledger rows in
 * one instant, and a bare-timestamp cursor would skip the rest of that batch
 * at a page boundary. Opaque to clients, which round-trip `nextCursor`
 * verbatim; the list services build one and only `decodeCursor` splits one.
 */
const CURSOR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z_[^_]+$/;

/** Split a cursor `paginationQuerySchema` has already validated. */
export function decodeCursor(cursor: string): { ts: Date; id: string } {
  const at = cursor.indexOf("_");
  return { ts: new Date(cursor.slice(0, at)), id: cursor.slice(at + 1) };
}

export const paginationQuerySchema = z.object({
  // Cursors are the `nextCursor` we handed out. Anything malformed — the wrong
  // shape, or an out-of-range timestamp like month 13 — would reach Prisma as
  // an Invalid Date and blow up as a 500, when it deserves the 400 this schema
  // turns it into.
  cursor: z
    .string()
    .regex(CURSOR_PATTERN)
    .refine((cursor) => !Number.isNaN(decodeCursor(cursor).ts.getTime()))
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
