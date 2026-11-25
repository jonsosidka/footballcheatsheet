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

/**
 * When a new week begins: Tuesday 10:00 UTC, i.e. early Tuesday morning US
 * time, after Monday night's last game.
 */
const ROLLOVER_HOUR_UTC = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/**
 * The week from the calendar alone, or null if the start date is unusable.
 *
 * Sleeper's own counter (`week` / `display_week`) does not turn over on
 * Tuesday — it lags into midweek. In that window the app kept showing the
 * week that had just finished, even after a manual refresh, because the
 * refresh asked Sleeper and Sleeper still said last week. Counting from the
 * season's first Thursday gives the week a manager is actually setting a
 * lineup for.
 */
export function calendarWeek(seasonStartDate: string | null | undefined, now: Date = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(seasonStartDate ?? '');
  if (!match) return null;
  const kickoff = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), ROLLOVER_HOUR_UTC);
  if (!Number.isFinite(kickoff)) return null;
  // Week 1 begins on the Tuesday before the opening Thursday.
  const anchor = kickoff - 2 * DAY_MS;
  const elapsed = now.getTime() - anchor;
  if (elapsed < 0) return 1;
  return Math.min(LAST_WEEK, Math.floor(elapsed / WEEK_MS) + 1);
}

/** The fields of Sleeper's NFL state this module reads. */
export interface WeekState {
  week?: number | null;
  display_week?: number | null;
  season_type?: string | null;
  season_start_date?: string | null;
}

/**
 * The live week: Sleeper's week, moved ahead by the calendar during the
 * regular season when Sleeper is late to roll over. Never moves backwards
 * from what Sleeper says.
 */
export function liveWeekFromState(state: WeekState, now: Date = new Date()): number {
  const sleeper = clampWeek(state.display_week ?? state.week) ?? 1;
  if (state.season_type !== 'regular') return sleeper;
  const calendar = calendarWeek(state.season_start_date, now);
  return calendar === null ? sleeper : Math.max(sleeper, calendar);
}
