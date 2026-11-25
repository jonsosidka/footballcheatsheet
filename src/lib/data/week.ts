import { db } from '@/db';
import { syncState } from '@/db/schema';
import { inArray } from 'drizzle-orm';
import { getState } from '@/lib/sources/sleeper';
import { calendarWeek, clampWeek, liveWeekFromState, pickWeek } from '@/lib/engine/week';

/**
 * What week is it?
 *
 * Every page used to answer this with a hardcoded 1. The sync jobs always knew
 * better — they read Sleeper's `display_week` — so the database would be full
 * of week 3 projections while the dashboard asked for week 1 and then ranked
 * your lineup on month-old numbers. It looked like the projections were wrong;
 * they were simply the wrong week's.
 *
 * Resolved from the database first because every sync job records it there and
 * a page render should not depend on an upstream API being up. Sleeper is the
 * fallback for a fresh install whose first sync has not finished yet.
 */

/** sync_state key holding the current NFL week. */
export const NFL_WEEK_KEY = 'nfl:week';

/** sync_state key holding the season's opening date, for the calendar check. */
const SEASON_START_KEY = 'nfl:season_start';

/** Record the live week so page loads can read it without calling Sleeper. */
export async function recordCurrentWeek(
  week: number,
  state?: { season_type?: string | null; season_start_date?: string | null },
): Promise<void> {
  const valid = clampWeek(week);
  if (valid === null) return;
  const now = new Date();
  // Kept so a page can still apply the calendar when Sleeper is unreachable.
  const seasonStartDate = state?.season_type === 'regular' ? state.season_start_date : null;
  if (seasonStartDate) {
    await db
      .insert(syncState)
      .values({ key: SEASON_START_KEY, lastRunAt: now, lastOkAt: now, detail: seasonStartDate })
      .onConflictDoUpdate({
        target: syncState.key,
        set: { lastRunAt: now, lastOkAt: now, detail: seasonStartDate },
      });
  }
  await db
    .insert(syncState)
    .values({ key: NFL_WEEK_KEY, lastRunAt: now, lastOkAt: now, detail: String(valid) })
    .onConflictDoUpdate({
      target: syncState.key,
      set: { lastRunAt: now, lastOkAt: now, detail: String(valid) },
    });
}

/**
 * How long a saved week is trusted before Sleeper is asked again. The saved
 * value used to be trusted forever, so a missed sync left the app on last
 * week with nothing to tell it otherwise.
 */
const STORED_WEEK_TTL_MS = 60 * 60 * 1000;

/**
 * The week the app should show by default.
 *
 * Order: a saved week less than an hour old; otherwise Sleeper, with the
 * calendar moving it ahead if Sleeper hasn't rolled over yet; otherwise the
 * saved week moved ahead by the calendar. Never throws: a page that cannot
 * reach Sleeper and has never synced still renders, on week 1.
 */
export async function getCurrentWeek(now: Date = new Date()): Promise<number> {
  const rows = await db
    .select({ key: syncState.key, detail: syncState.detail, lastOkAt: syncState.lastOkAt })
    .from(syncState)
    .where(inArray(syncState.key, [NFL_WEEK_KEY, SEASON_START_KEY]));
  const row = rows.find((r) => r.key === NFL_WEEK_KEY);
  const seasonStart = rows.find((r) => r.key === SEASON_START_KEY)?.detail ?? null;

  const stored = clampWeek(row?.detail ? Number(row.detail) : null);
  const fresh = row?.lastOkAt && now.getTime() - row.lastOkAt.getTime() < STORED_WEEK_TTL_MS;
  if (stored !== null && fresh) return stored;

  try {
    const state = await getState();
    const live = liveWeekFromState(state, now);
    await recordCurrentWeek(live, state);
    return live;
  } catch {
    // Offline or Sleeper down — fall through to what we already know.
  }

  if (stored !== null) return Math.max(stored, calendarWeek(seasonStart, now) ?? stored);
  return 1;
}

/**
 * Resolve the week for a page: an explicit `?week=` wins, otherwise the live
 * week. Invalid or out-of-range input is ignored rather than trusted.
 *
 * The live week comes back too, so the chrome can tell a week the user chose
 * from the one it defaulted to — only the former belongs in a link.
 */
export async function resolveWeek(
  param: string | undefined,
): Promise<{ week: number; liveWeek: number }> {
  const liveWeek = await getCurrentWeek();
  return { week: pickWeek(param, liveWeek), liveWeek };
}
