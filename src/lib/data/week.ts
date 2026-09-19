import { db } from '@/db';
import { syncState } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getState } from '@/lib/sources/sleeper';
import { clampWeek, pickWeek } from '@/lib/engine/week';

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

/** Record the live week so page loads can read it without calling Sleeper. */
export async function recordCurrentWeek(week: number): Promise<void> {
  const valid = clampWeek(week);
  if (valid === null) return;
  const now = new Date();
  await db
    .insert(syncState)
    .values({ key: NFL_WEEK_KEY, lastRunAt: now, lastOkAt: now, detail: String(valid) })
    .onConflictDoUpdate({
      target: syncState.key,
      set: { lastRunAt: now, lastOkAt: now, detail: String(valid) },
    });
}

/**
 * The week the app should show by default.
 *
 * Never throws: a page that cannot reach Sleeper and has never synced still
 * renders, on week 1, rather than failing outright.
 */
export async function getCurrentWeek(): Promise<number> {
  const [row] = await db
    .select({ detail: syncState.detail })
    .from(syncState)
    .where(eq(syncState.key, NFL_WEEK_KEY));

  const stored = clampWeek(row?.detail ? Number(row.detail) : null);
  if (stored !== null) return stored;

  try {
    const state = await getState();
    const live = clampWeek(state.display_week ?? state.week);
    if (live !== null) {
      // Seed the cache so the next render is a pure database read.
      await recordCurrentWeek(live);
      return live;
    }
  } catch {
    // Offline or Sleeper down — fall through to the safe default.
  }

  return 1;
}

/**
 * Resolve the week for a page: an explicit `?week=` wins, otherwise the live
 * week. Invalid or out-of-range input is ignored rather than trusted.
 */
export async function resolveWeek(param: string | undefined): Promise<number> {
  const requested = clampWeek(param);
  if (requested !== null) return requested;
  return pickWeek(null, await getCurrentWeek());
}
