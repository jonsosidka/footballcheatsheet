/**
 * Week parsing, kept free of any database import so it can be unit tested.
 *
 * The bug this exists to prevent: every page defaulted to week 1 while the
 * sync jobs wrote whatever week Sleeper said it was. The database held week 2
 * projections, the dashboard asked for week 1, and the lineup advice was
 * ranked on stale numbers that no longer matched what Sleeper showed.
 */

/** Weeks 1-18 of the NFL regular season. */
export const LAST_WEEK = 18;

/** A week number, or null for anything outside the season. */
export function clampWeek(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(parsed)) return null;
  const week = Math.trunc(parsed);
  return week >= 1 && week <= LAST_WEEK ? week : null;
}

/**
 * Pick the week to render: an explicit, valid `?week=` always wins, otherwise
 * the live week. Garbage in the query string falls back rather than throwing
 * or rendering an empty week 0.
 */
export function pickWeek(requested: string | number | null | undefined, live: number): number {
  return clampWeek(requested) ?? clampWeek(live) ?? 1;
}
