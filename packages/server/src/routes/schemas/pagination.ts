import { z } from "@hono/zod-openapi";

const CURSOR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z_[^_]+$/;

export function decodeCursor(cursor: string): { ts: Date; id: string } {
  const at = cursor.indexOf("_");
  return { ts: new Date(cursor.slice(0, at)), id: cursor.slice(at + 1) };
}

export const paginationQuerySchema = z.object({
  cursor: z
    .string()
    .regex(CURSOR_PATTERN)
    .refine((cursor) => !Number.isNaN(decodeCursor(cursor).ts.getTime()))
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
