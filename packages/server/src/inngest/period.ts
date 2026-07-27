/**
 * Naming the period a scheduled payout belongs to.
 *
 * A recurring award needs a name for "which run is this" that is stable across
 * retries and identical for two runs that mean the same payout — that name is
 * what the ledger's `@@unique([userId, reason, periodKey])` turns into an
 * exactly-once guarantee. Kept apart from `functions.ts` so it can be tested
 * without pulling in Prisma, Polar and the Inngest client.
 */

/**
 * The ISO-8601 week `at` falls in, as `YYYY-Www` — `2026-W31`.
 *
 * A week rather than a date, because the stipend is weekly: keying on the run's
 * date would let a cron replayed on Wednesday pay a second time for a week
 * already paid on Monday, which is the whole thing the key exists to prevent.
 *
 * ISO weeks run Monday to Sunday and belong to the year containing their
 * Thursday, which is why the year comes off the shifted date rather than off
 * `at` — the days either side of New Year otherwise land in a week numbered for
 * one year and labelled with the other, and 2027-W01 would collide with
 * 2026-W01 having already been paid.
 */
export function isoWeekKey(at: Date): string {
  // Midnight UTC on the same calendar day, so the arithmetic below cannot be
  // nudged across a boundary by the time of day the cron happened to fire.
  const date = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );

  // Move to the Thursday of this week. `getUTCDay` is 0 for Sunday, which ISO
  // counts as day 7 — the last day of the week, not the first.
  const isoDay = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + 4 - isoDay);

  const year = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstIsoDay =
    firstThursday.getUTCDay() === 0 ? 7 : firstThursday.getUTCDay();
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstIsoDay);

  const week =
    1 +
    Math.round(
      (date.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000),
    );

  return `${year}-W${String(week).padStart(2, "0")}`;
}
