'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { leagues, myTeams, players } from '@/db/schema';
import { eq } from 'drizzle-orm';
import {
  getState,
  getUserByName,
  getUserLeagues,
  getLeagueRosters,
  isDynastyLeague,
  requiredProjectionPositions,
} from '@/lib/sources/sleeper';
import { isSuperflexRoster, pprType, startingSlots } from '@/lib/engine/scoring';
import { syncLeague, setMyTeam } from '@/lib/sync/league';
import {
  syncPlayers,
  syncWeeklyProjections,
  syncSeasonProjections,
  syncGameOdds,
  syncMarketValues,
  syncByeWeeks,
} from '@/lib/sync/data';
import { shapeFromLeague } from '@/lib/sources/fantasycalc';

export interface FoundLeague {
  leagueId: string;
  name: string;
  season: string;
  status: string;
  totalRosters: number;
  isDynasty: boolean;
  isSuperflex: boolean;
  ppr: number;
  starters: string[];
  taxiSlots: number;
  reserveSlots: number;
  scoringKeys: number;
  /** Which roster in this league belongs to the user. */
  myRosterId: number | null;
  playerCount: number;
  alreadyTracked: boolean;
}

export interface LookupResult {
  ok: boolean;
  message: string;
  userId?: string;
  displayName?: string;
  seasons?: string[];
  leagues?: FoundLeague[];
}

/**
 * Find a Sleeper user's leagues without importing anything.
 *
 * Checks the upcoming season and the previous one, because early in the year a
 * dynasty league may still be on last season's id while a new redraft league
 * already exists on this one.
 */
export async function lookupUser(username: string): Promise<LookupResult> {
  const trimmed = username.trim();
  if (!trimmed) return { ok: false, message: 'Enter a Sleeper username.' };

  try {
    const [state, user] = await Promise.all([getState(), getUserByName(trimmed)]);
    if (!user) return { ok: false, message: `Sleeper has no user "${trimmed}".` };

    const tracked = new Set((await db.select({ id: leagues.id }).from(leagues)).map((l) => l.id));

    const seasons = [...new Set([state.league_season, state.previous_season])];
    const found: FoundLeague[] = [];

    for (const season of seasons) {
      const userLeagues = await getUserLeagues(user.user_id, season);
      for (const league of userLeagues) {
        const rosters = await getLeagueRosters(league.league_id);
        const mine = rosters.find((r) => r.owner_id === user.user_id);
        const settings = league.settings ?? {};

        found.push({
          leagueId: league.league_id,
          name: league.name,
          season: league.season,
          status: league.status,
          totalRosters: league.total_rosters,
          isDynasty: isDynastyLeague(league),
          isSuperflex: isSuperflexRoster(league.roster_positions),
          ppr: pprType(league.scoring_settings),
          starters: startingSlots(league.roster_positions),
          taxiSlots: settings.taxi_slots ?? 0,
          reserveSlots: settings.reserve_slots ?? 0,
          scoringKeys: Object.keys(league.scoring_settings).length,
          myRosterId: mine?.roster_id ?? null,
          playerCount: mine?.players?.length ?? 0,
          alreadyTracked: tracked.has(league.league_id),
        });
      }
    }

    if (found.length === 0) {
      return { ok: false, message: `No leagues found for ${user.display_name} in ${seasons.join(' or ')}.` };
    }

    return {
      ok: true,
      message: `Found ${found.length} league${found.length === 1 ? '' : 's'}.`,
      userId: user.user_id,
      displayName: user.display_name,
      seasons,
      leagues: found,
    };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

export interface ImportResult {
  ok: boolean;
  message: string;
}

/**
 * Import one league and pull everything it needs to be immediately usable.
 *
 * The heavy shared syncs (player dump, byes) are skipped when the database
 * already has them, so importing a second league is fast.
 */
export async function importLeague(
  leagueId: string,
  rosterId: number,
  sleeperUserId: string,
): Promise<ImportResult> {
  try {
    const state = await getState();
    const season = state.league_season;
    const week = Math.max(1, state.display_week ?? state.week ?? 1);

    const league = await syncLeague(leagueId);
    await setMyTeam(leagueId, rosterId, sleeperUserId);

    /*
     * The 14MB player dump and the schedule are shared across leagues, so only
     * pull them when the table is actually empty. Importing a second league
     * should not re-download everything.
     */
    const [existingPlayer] = await db.select({ id: players.id }).from(players).limit(1);
    if (!existingPlayer) {
      await syncPlayers();
      await syncByeWeeks(Number(season)).catch(() => 0);
    }

    const positions = requiredProjectionPositions([league.roster_positions]);
    await Promise.all([
      syncWeeklyProjections(season, week, positions),
      syncSeasonProjections(season, positions),
      syncGameOdds(season, week),
    ]);

    await syncMarketValues(
      shapeFromLeague({
        isDynasty: isDynastyLeague(league),
        isSuperflex: isSuperflexRoster(league.roster_positions),
        totalRosters: league.total_rosters,
        pprType: pprType(league.scoring_settings),
      }),
    );

    revalidatePath('/');
    revalidatePath('/setup');

    return { ok: true, message: `${league.name} imported.` };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

export async function removeLeague(leagueId: string): Promise<ImportResult> {
  try {
    await db.delete(myTeams).where(eq(myTeams.leagueId, leagueId));
    await db.delete(leagues).where(eq(leagues.id, leagueId));
    revalidatePath('/');
    revalidatePath('/setup');
    return { ok: true, message: 'League removed.' };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}
