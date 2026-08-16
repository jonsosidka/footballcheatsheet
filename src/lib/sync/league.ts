import { db } from '@/db';
import { leagues, leagueUsers, rosters, myTeams } from '@/db/schema';
import { eq } from 'drizzle-orm';
import {
  getLeague,
  getLeagueRosters,
  getLeagueUsers,
  isDynastyLeague,
  type SleeperLeague,
} from '@/lib/sources/sleeper';
import { isSuperflexRoster, pprType } from '@/lib/engine/scoring';

/**
 * Import or refresh a Sleeper league.
 *
 * League shape (dynasty, superflex, PPR flavor, taxi/IR capacity) is derived
 * once here and denormalized onto the row, because almost every downstream
 * decision branches on it — including which FantasyCalc value shape to pull.
 */
export async function syncLeague(leagueId: string): Promise<SleeperLeague> {
  const league = await getLeague(leagueId);
  if (!league) throw new Error(`Sleeper has no league ${leagueId}`);

  const settings = league.settings ?? {};

  await db
    .insert(leagues)
    .values({
      id: league.league_id,
      name: league.name,
      season: league.season,
      seasonType: league.season_type,
      status: league.status,
      avatar: league.avatar,
      totalRosters: league.total_rosters,
      leagueType: settings.type ?? 0,
      isDynasty: isDynastyLeague(league),
      isSuperflex: isSuperflexRoster(league.roster_positions),
      pprType: pprType(league.scoring_settings),
      scoringSettings: league.scoring_settings,
      rosterPositions: league.roster_positions,
      settings,
      taxiSlots: settings.taxi_slots ?? 0,
      taxiYears: settings.taxi_years ?? 0,
      taxiDeadline: settings.taxi_deadline ?? 0,
      taxiAllowVets: settings.taxi_allow_vets ?? 0,
      reserveSlots: settings.reserve_slots ?? 0,
      previousLeagueId: league.previous_league_id,
      syncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: leagues.id,
      set: {
        name: league.name,
        status: league.status,
        scoringSettings: league.scoring_settings,
        rosterPositions: league.roster_positions,
        settings,
        isDynasty: isDynastyLeague(league),
        isSuperflex: isSuperflexRoster(league.roster_positions),
        pprType: pprType(league.scoring_settings),
        taxiSlots: settings.taxi_slots ?? 0,
        taxiYears: settings.taxi_years ?? 0,
        taxiDeadline: settings.taxi_deadline ?? 0,
        taxiAllowVets: settings.taxi_allow_vets ?? 0,
        reserveSlots: settings.reserve_slots ?? 0,
        syncedAt: new Date(),
      },
    });

  await syncLeagueMembers(leagueId);
  return league;
}

export async function syncLeagueMembers(leagueId: string): Promise<void> {
  const [users, leagueRosters] = await Promise.all([
    getLeagueUsers(leagueId),
    getLeagueRosters(leagueId),
  ]);

  if (users.length > 0) {
    await db
      .insert(leagueUsers)
      .values(
        users.map((user) => ({
          leagueId,
          userId: user.user_id,
          displayName: user.display_name,
          teamName: user.metadata?.team_name ?? null,
          avatar: user.avatar,
        })),
      )
      .onConflictDoUpdate({
        target: [leagueUsers.leagueId, leagueUsers.userId],
        set: {
          displayName: sqlExcluded('display_name'),
          teamName: sqlExcluded('team_name'),
          avatar: sqlExcluded('avatar'),
        },
      });
  }

  for (const roster of leagueRosters) {
    await db
      .insert(rosters)
      .values({
        leagueId,
        rosterId: roster.roster_id,
        ownerId: roster.owner_id,
        players: roster.players ?? [],
        starters: roster.starters ?? [],
        taxi: roster.taxi ?? [],
        reserve: roster.reserve ?? [],
        settings: roster.settings ?? {},
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [rosters.leagueId, rosters.rosterId],
        set: {
          ownerId: roster.owner_id,
          players: roster.players ?? [],
          starters: roster.starters ?? [],
          taxi: roster.taxi ?? [],
          reserve: roster.reserve ?? [],
          settings: roster.settings ?? {},
          syncedAt: new Date(),
        },
      });
  }
}

/** Record which roster belongs to the user. */
export async function setMyTeam(leagueId: string, rosterId: number, sleeperUserId?: string): Promise<void> {
  await db
    .insert(myTeams)
    .values({ leagueId, rosterId, sleeperUserId: sleeperUserId ?? null })
    .onConflictDoUpdate({
      target: myTeams.leagueId,
      set: { rosterId, sleeperUserId: sleeperUserId ?? null },
    });
}

export async function getTrackedLeagues() {
  return db
    .select({
      league: leagues,
      myRosterId: myTeams.rosterId,
    })
    .from(leagues)
    .innerJoin(myTeams, eq(myTeams.leagueId, leagues.id));
}

/**
 * drizzle's onConflictDoUpdate needs an excluded-column reference; this keeps
 * the call sites readable.
 */
import { sql } from 'drizzle-orm';
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}
