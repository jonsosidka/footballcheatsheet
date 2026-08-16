import { db } from '@/db';
import { alerts, projSnapshots, leagues, myTeams } from '@/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getState, requiredProjectionPositions } from '@/lib/sources/sleeper';
import { syncWeeklyProjections, syncGameOdds, syncPlayers, syncSeasonProjections, syncMarketValues, markSynced } from './data';
import { syncLeagueMembers } from './league';
import { getDashboard, listLeagues } from '@/lib/data/dashboard';
import { getWaiverView } from '@/lib/data/waivers';
import { buildAlerts, type AlertPlayer } from '@/lib/engine/alerts';
import { shapeFromLeague } from '@/lib/sources/fantasycalc';

/**
 * The three scheduled jobs.
 *
 * Split by cost, because Netlify's scheduled functions hard-stop at 30 seconds
 * while background functions get 15 minutes:
 *
 *   runHourly    light  — projections, odds, rosters, alerts     (scheduled)
 *   runDaily     heavy  — 14MB player dump, values, season proj  (background)
 *   runGameday   light  — odds + inactive checks, sub-hourly     (GitHub Actions)
 */

export interface RefreshResult {
  job: string;
  ms: number;
  detail: Record<string, unknown>;
}

export async function runHourly(): Promise<RefreshResult> {
  const started = Date.now();
  const state = await getState();
  const season = state.league_season;
  const week = Math.max(1, state.display_week ?? state.week ?? 1);

  const tracked = await listLeagues();
  const positions = requiredProjectionPositions(
    (
      await db.select({ rp: leagues.rosterPositions }).from(leagues)
    ).map((r) => r.rp),
  );

  const [projectionCount, oddsCount] = await Promise.all([
    syncWeeklyProjections(season, week, positions),
    syncGameOdds(season, week),
  ]);

  // Rosters change on waivers and trades; cheap enough to refresh hourly.
  for (const league of tracked) {
    await syncLeagueMembers(league.id);
  }

  const alertCounts: Record<string, number> = {};
  for (const league of tracked) {
    alertCounts[league.name] = await refreshAlerts(league.id, week);
  }

  await markSynced('hourly', `week ${week}`);
  return {
    job: 'hourly',
    ms: Date.now() - started,
    detail: { season, week, projectionCount, oddsCount, leagues: tracked.length, alertCounts },
  };
}

export async function runDaily(): Promise<RefreshResult> {
  const started = Date.now();
  const state = await getState();
  const season = state.league_season;

  const playerCount = await syncPlayers();

  const leagueRows = await db.select().from(leagues);
  const positions = requiredProjectionPositions(leagueRows.map((l) => l.rosterPositions));
  const seasonCount = await syncSeasonProjections(season, positions);

  // One FantasyCalc pull per distinct league shape.
  const shapes = new Map<string, ReturnType<typeof shapeFromLeague>>();
  for (const league of leagueRows) {
    const shape = shapeFromLeague({
      isDynasty: league.isDynasty,
      isSuperflex: league.isSuperflex,
      totalRosters: league.totalRosters,
      pprType: league.pprType,
    });
    shapes.set(JSON.stringify(shape), shape);
  }
  let valueCount = 0;
  for (const shape of shapes.values()) valueCount += await syncMarketValues(shape);

  await markSynced('daily', `${playerCount} players`);
  return {
    job: 'daily',
    ms: Date.now() - started,
    detail: { playerCount, seasonCount, valueCount, shapes: shapes.size },
  };
}

/**
 * Gameday poll. Netlify's scheduler floors at hourly, which is too slow for
 * pre-kickoff inactive news, so this is driven by GitHub Actions cron instead.
 */
export async function runGameday(): Promise<RefreshResult> {
  const started = Date.now();
  const state = await getState();
  const season = state.league_season;
  const week = Math.max(1, state.display_week ?? state.week ?? 1);

  const oddsCount = await syncGameOdds(season, week);
  const tracked = await listLeagues();

  const alertCounts: Record<string, number> = {};
  for (const league of tracked) {
    await syncLeagueMembers(league.id);
    alertCounts[league.name] = await refreshAlerts(league.id, week);
  }

  await markSynced('gameday', `week ${week}`);
  return { job: 'gameday', ms: Date.now() - started, detail: { week, oddsCount, alertCounts } };
}

/**
 * Recompute alerts for one league and persist any that are new.
 *
 * Projection snapshots are written on every run so the *next* run can detect
 * movement — that history is what makes "down 3.4 pts since Tuesday" possible.
 */
export async function refreshAlerts(leagueId: string, week: number): Promise<number> {
  const dashboard = await getDashboard(leagueId, week);
  if (!dashboard || !dashboard.hasRoster) return 0;

  const startingIds = new Set(dashboard.lineup.map((s) => s.player?.playerId).filter(Boolean) as string[]);
  const roster = [...dashboard.lineup.map((s) => s.player), ...dashboard.bench].filter(
    (p): p is NonNullable<typeof p> => !!p,
  );

  // Most recent snapshot per player, to diff against.
  const previous = await db
    .select({
      playerId: projSnapshots.playerId,
      scoredPts: projSnapshots.scoredPts,
      capturedAt: projSnapshots.capturedAt,
    })
    .from(projSnapshots)
    .where(and(eq(projSnapshots.leagueId, leagueId), eq(projSnapshots.week, week)))
    .orderBy(desc(projSnapshots.capturedAt))
    .limit(2000);

  const previousByPlayer = new Map<string, number>();
  for (const row of previous) {
    if (!previousByPlayer.has(row.playerId)) previousByPlayer.set(row.playerId, row.scoredPts);
  }

  const alertPlayers: AlertPlayer[] = roster.map((player) => ({
    playerId: player.playerId,
    name: player.name,
    position: player.position,
    injuryStatus: player.injuryStatus,
    status: null,
    points: player.points,
    previousPoints: previousByPlayer.get(player.playerId) ?? null,
    isStarting: startingIds.has(player.playerId),
  }));

  const waiverView = await getWaiverView(leagueId, week).catch(() => null);

  const built = buildAlerts({
    week,
    players: alertPlayers,
    pointsLeftOnBench: dashboard.pointsLeftOnBench,
    topChange: dashboard.changes[0]
      ? {
          incoming: dashboard.changes[0].incoming.name,
          outgoing: dashboard.changes[0].outgoing?.name ?? null,
          slot: dashboard.changes[0].slot,
          gain: dashboard.changes[0].gain,
        }
      : null,
    slotMoves: dashboard.slotMoves,
    waiverTargets:
      waiverView?.suggestions.map((s) => ({
        name: s.add.name,
        position: s.add.position,
        trendingAdds: s.add.trendingAdds,
        winNowDelta: s.score.winNowDelta,
      })) ?? [],
  });

  if (built.length > 0) {
    await db
      .insert(alerts)
      .values(
        built.map((alert) => ({
          leagueId,
          type: alert.type,
          severity: alert.severity,
          playerId: alert.playerId,
          week: alert.week,
          title: alert.title,
          body: alert.body,
          dedupeKey: alert.dedupeKey,
        })),
      )
      // Same key = same alert; refresh the wording but don't create a new row.
      .onConflictDoUpdate({
        target: [alerts.leagueId, alerts.dedupeKey],
        set: { title: sql`excluded.title`, body: sql`excluded.body`, severity: sql`excluded.severity` },
      });
  }

  // Snapshot after alerting, so this run's numbers become next run's baseline.
  if (roster.length > 0) {
    await db.insert(projSnapshots).values(
      roster.map((player) => ({
        leagueId,
        playerId: player.playerId,
        week,
        scoredPts: player.points,
      })),
    );
  }

  return built.length;
}

/**
 * Force a full resync of one league, on demand.
 *
 * Distinct from the scheduled jobs: those sweep every tracked league on a
 * cadence, this one is user-initiated and scoped to what's on screen, so it
 * pulls rosters/projections/odds and recomputes alerts for a single league as
 * fast as possible.
 */
export async function refreshLeagueNow(leagueId: string, week?: number): Promise<RefreshResult> {
  const started = Date.now();
  const state = await getState();
  const season = state.league_season;
  const targetWeek = week ?? Math.max(1, state.display_week ?? state.week ?? 1);

  const [leagueRow] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
  if (!leagueRow) throw new Error(`League ${leagueId} is not tracked`);

  const positions = requiredProjectionPositions([leagueRow.rosterPositions]);

  const [projectionCount, oddsCount] = await Promise.all([
    syncWeeklyProjections(season, targetWeek, positions),
    syncGameOdds(season, targetWeek),
  ]);

  await syncLeagueMembers(leagueId);
  const alertCount = await refreshAlerts(leagueId, targetWeek);

  await markSynced(`manual:${leagueId}`, `week ${targetWeek}`);

  return {
    job: 'manual',
    ms: Date.now() - started,
    detail: { league: leagueRow.name, week: targetWeek, projectionCount, oddsCount, alertCount },
  };
}

/** Unread alerts for the UI feed. */
export async function getAlerts(leagueId: string, limit = 20) {
  return db
    .select()
    .from(alerts)
    .where(eq(alerts.leagueId, leagueId))
    .orderBy(desc(alerts.createdAt))
    .limit(limit);
}
