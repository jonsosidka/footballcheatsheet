'use server';

import { revalidatePath } from 'next/cache';
import { refreshLeagueNow } from '@/lib/sync/refresh';

export interface RefreshState {
  ok: boolean;
  message: string;
  at: number;
}

/**
 * Force a resync of one league from the UI.
 *
 * A server action rather than a fetch to /api/cron/*: those are secret-guarded
 * because they're reachable from the open internet, whereas this is invoked by
 * the rendered page itself. It also lets `revalidatePath` refresh the server
 * components in the same round trip, so the numbers on screen update without a
 * manual reload.
 */
export async function refreshLeagueAction(leagueId: string, week: number): Promise<RefreshState> {
  try {
    const result = await refreshLeagueNow(leagueId, week);
    const detail = result.detail as {
      projectionCount?: number;
      oddsCount?: number;
      alertCount?: number;
    };

    revalidatePath('/');
    revalidatePath('/waivers');

    return {
      ok: true,
      message: `${detail.projectionCount ?? 0} projections · ${detail.oddsCount ?? 0} games · ${
        detail.alertCount ?? 0
      } alerts · ${(result.ms / 1000).toFixed(1)}s`,
      at: Date.now(),
    };
  } catch (error) {
    return { ok: false, message: (error as Error).message, at: Date.now() };
  }
}
