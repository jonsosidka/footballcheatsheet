import { db } from '@/db';
import { leagues, leagueUsers, rosters, myTeams, draftPicks } from '@/db/schema';
import { eq, and, or, notInArray } from 'drizzle-orm';
import {
  getLeague,
  getLeagueRosters,
  getLeagueUsers,
  getTradedPicks,
  isDynastyLeague,
  type SleeperLeague,
} from '@/lib/sources/sleeper';
import { isSuperflexRoster, pprType } from '@/lib/engine/scoring';
import { buildPickInventory, pickSeasons, type TradedPick } from '@/lib/engine/picks';

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

  /*
   * Picks ride along with rosters because they change the same way — a
   * manager makes a trade — and every caller that wants fresh rosters wants
   * fresh picks too. Isolated so a pick problem never costs the roster sync,
   * which lineups and alerts depend on.
   */
  try {
    await syncDraftPicks(leagueId, leagueRosters.map((r) => r.roster_id));
  } catch (error) {
    console.error(`draft pick sync failed for ${leagueId}:`, (error as Error).message);
  }
}

/** Rookie drafts in most dynasty leagues; used when Sleeper has no setting. */
const DEFAULT_DRAFT_ROUNDS = 4;

/**
 * Store every tradeable pick in a dynasty league with its current owner.
 * Redraft leagues have no future picks to trade, so they're skipped.
 */
export async function syncDraftPicks(leagueId: string, rosterIds: number[]): Promise<number> {
  const [league] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
  if (!league?.isDynasty || rosterIds.length === 0) return 0;

  const traded: TradedPick[] = (await getTradedPicks(leagueId))
    .map((p) => ({
      season: Number(p.season),
      round: Number(p.round),
      originalRosterId: Number(p.roster_id),
      ownerRosterId: Number(p.owner_id),
    }))
    .filter((p) => Number.isFinite(p.season) && p.round > 0);

  const seasons = pickSeasons({ season: Number(league.season), status: league.status, traded });
  const configured = Number(league.settings?.draft_rounds);
  const rounds = Math.max(
    configured > 0 ? configured : DEFAULT_DRAFT_ROUNDS,
    ...traded.filter((p) => seasons.includes(p.season)).map((p) => p.round),
  );

  const inventory = buildPickInventory({ rosterIds, seasons, rounds, traded });
  const now = new Date();

  if (inventory.length > 0) {
    await db
      .insert(draftPicks)
      .values(inventory.map((p) => ({ leagueId, ...p, syncedAt: now })))
      .onConflictDoUpdate({
        target: [draftPicks.leagueId, draftPicks.season, draftPicks.round, draftPicks.originalRosterId],
        set: { ownerRosterId: sqlExcluded('owner_roster_id'), syncedAt: now },
      });
  }

  // The upsert rewrote the whole current grid; anything left over is a draft
  // that has happened, a round the league dropped, or a roster that's gone.
  await db
    .delete(draftPicks)
    .where(
      and(
        eq(draftPicks.leagueId, leagueId),
        or(
          notInArray(draftPicks.season, seasons),
          notInArray(draftPicks.originalRosterId, rosterIds),
          notInArray(
            draftPicks.round,
            Array.from({ length: rounds }, (_, i) => i + 1),
          ),
        ),
      ),
    );

  return inventory.length;
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
