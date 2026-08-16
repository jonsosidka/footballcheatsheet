import { db } from '@/db';
import { leagues, rosters, players, seasonProjections, projections, gameOdds, marketValues, myTeams, syncState } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { scoreProjection } from '@/lib/engine/scoring';
import { projectPlayers, type TeamOdds } from '@/lib/engine/pipeline';
import { optimizeLineup, type LineupPlayer } from '@/lib/engine/lineup';
import { evaluatePosture } from '@/lib/engine/value';
import { computeOccupancy } from '@/lib/engine/roster';
import { rankWaiverTargets, computeNeeds, partitionSuggestions, type WaiverCandidate, type WaiverSuggestion, type PositionalNeed } from '@/lib/engine/waivers';
import { shapeFromLeague, shapeKey } from '@/lib/sources/fantasycalc';
import { getTrending } from '@/lib/sources/sleeper';
import { findByeGaps, type ByeGap, type ByeRosterPlayer } from '@/lib/engine/byes';
import { waiverSystem, recommendBid, evaluatePriorityClaim, type WaiverSystem, type BidRecommendation, type PriorityAdvice } from '@/lib/engine/faab';

export interface WaiverView {
  leagueId: string;
  leagueName: string;
  isDynasty: boolean;
  week: number;
  posture: string;
  trajectory: string;
  confidence: string;
  postureReasoning: string;
  openSlots: number;
  suggestions: Array<WaiverSuggestion & { bid: BidRecommendation | null; priority: PriorityAdvice | null }>;
  blocked: WaiverSuggestion[];
  byeGaps: ByeGap[];
  waiverSystem: WaiverSystem;
  faabRemaining: number | null;
  faabTotal: number | null;
  waiverPosition: number | null;
  lastRegularWeek: number;
  needs: PositionalNeed[];
  freeAgentCount: number;
  lastSyncedAt: Date | null;
}

/**
 * Assemble the waiver board.
 *
 * Free agents are every projected player not on any roster in the league —
 * scoped to those Sleeper considers relevant enough to project, which keeps
 * the pool at a few hundred rather than the full 12,000-player dump.
 */
export async function getWaiverView(leagueId?: string, week = 1): Promise<WaiverView | null> {
  const tracked = await db
    .select({ l: leagues, rosterId: myTeams.rosterId })
    .from(leagues)
    .innerJoin(myTeams, eq(myTeams.leagueId, leagues.id));
  if (tracked.length === 0) return null;

  const target =
    (leagueId ? tracked.find((t) => t.l.id === leagueId) : undefined) ??
    tracked.find((t) => t.l.isDynasty) ??
    tracked[0];
  const league = target.l;

  const [allRosters, allPlayers, seasonRows, weekRows, odds, trendingAdds] = await Promise.all([
    db.select().from(rosters).where(eq(rosters.leagueId, league.id)),
    db.select().from(players),
    db.select().from(seasonProjections).where(eq(seasonProjections.season, league.season)),
    db.select().from(projections).where(and(eq(projections.season, league.season), eq(projections.week, week))),
    db.select().from(gameOdds).where(and(eq(gameOdds.season, league.season), eq(gameOdds.week, week))),
    getTrending('add', 24, 200).catch(() => []),
  ]);

  const syncRows = await db.select().from(syncState);
  const relevantSyncKeys = new Set(['hourly', 'gameday', `manual:${league.id}`]);
  const lastSyncedAt =
    syncRows
      .filter((row) => relevantSyncKeys.has(row.key) && row.lastOkAt)
      .map((row) => row.lastOkAt as Date)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const shape = shapeFromLeague({
    isDynasty: league.isDynasty,
    isSuperflex: league.isSuperflex,
    totalRosters: league.totalRosters,
    pprType: league.pprType,
  });
  const values = await db.select().from(marketValues).where(eq(marketValues.shapeKey, shapeKey(shape)));

  const valueById = new Map(values.map((v) => [v.playerId, v]));
  const playerById = new Map(allPlayers.map((p) => [p.id, p]));
  const trendingById = new Map(trendingAdds.map((t) => [t.player_id, t.count]));
  const seasonById = new Map(seasonRows.map((r) => [r.playerId, r]));
  const weekProjById = new Map(weekRows.map((r) => [r.playerId, r]));

  const oddsByTeam = new Map<string, TeamOdds>();
  for (const game of odds) {
    oddsByTeam.set(game.homeTeam, { impliedPoints: game.impliedHomePts, spread: game.spread, opponent: game.awayTeam });
    oddsByTeam.set(game.awayTeam, {
      impliedPoints: game.impliedAwayPts,
      spread: game.spread === null ? null : -game.spread,
      opponent: game.homeTeam,
    });
  }

  const rosteredIds = new Set(allRosters.flatMap((r) => r.players ?? []));
  const mine = allRosters.find((r) => r.rosterId === target.rosterId);
  if (!mine) return null;

  // Weekly projections drive the market layer; season projections drive VOR.
  const weekProjected = projectPlayers(
    [...weekProjById.keys()].map((id) => {
      const proj = weekProjById.get(id)!;
      const player = playerById.get(id);
      return {
        playerId: id,
        position: player?.position ?? 'UNK',
        team: proj.team ?? player?.team ?? null,
        stats: proj.stats,
      };
    }),
    { scoring: league.scoringSettings, oddsByTeam },
  );
  const weekPointsById = new Map(weekProjected.map((p) => [p.playerId, p.points]));

  const toCandidate = (id: string): WaiverCandidate | null => {
    const player = playerById.get(id);
    if (!player) return null;
    const season = seasonById.get(id);
    const rosPoints = season ? scoreProjection(season.stats, league.scoringSettings) : 0;
    return {
      playerId: id,
      name: player.fullName ?? id,
      position: player.position ?? 'UNK',
      team: player.team,
      age: player.age,
      rosPoints,
      weekPoints: weekPointsById.get(id) ?? 0,
      dynastyValue: valueById.get(id)?.dynastyValue ?? null,
      trend30Day: valueById.get(id)?.trend30Day ?? null,
      trendingAdds: trendingById.get(id) ?? 0,
      injuryStatus: player.injuryStatus,
    };
  };

  const freeAgents = [...seasonById.keys()]
    .filter((id) => !rosteredIds.has(id))
    .map(toCandidate)
    .filter((c): c is WaiverCandidate => !!c && (c.rosPoints > 0 || (c.dynastyValue ?? 0) > 0))
    .filter((c) => playerById.get(c.playerId)?.active !== false);

  const myRoster = (mine.players ?? []).map(toCandidate).filter((c): c is WaiverCandidate => !!c);

  // Posture needs league-wide strength, same as the dashboard.
  const strengthOf = (roster: (typeof allRosters)[number]) => {
    const skip = new Set([...(roster.taxi ?? []), ...(roster.reserve ?? [])]);
    const pool: LineupPlayer[] = (roster.players ?? [])
      .filter((id) => !skip.has(id))
      .map((id) => {
        const player = playerById.get(id);
        return {
          playerId: id,
          position: player?.position ?? 'UNK',
          eligiblePositions: player?.fantasyPositions ?? [player?.position ?? 'UNK'],
          points: weekPointsById.get(id) ?? 0,
        };
      });
    return optimizeLineup(pool, league.rosterPositions).totalPoints;
  };

  const strengths = allRosters.map((r) => ({ rosterId: r.rosterId, strength: strengthOf(r) }));

  // Read these from the league rather than assuming: playoff_week_start 15
  // means the fantasy regular season ends at week 14.
  const leagueSettings = (league.settings ?? {}) as Record<string, number>;
  const lastRegularWeek = Math.max(1, (leagueSettings.playoff_week_start ?? 15) - 1);
  const playoffTeams = leagueSettings.playoff_teams ?? 6;

  const avgTopAge = (ids: string[]): number | null => {
    const aged = ids
      .map((id) => ({ age: playerById.get(id)?.age ?? null, value: valueById.get(id)?.dynastyValue ?? 0 }))
      .filter((a): a is { age: number; value: number } => a.age !== null && a.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
    if (aged.length === 0) return null;
    return aged.reduce((sum, a) => sum + a.age, 0) / aged.length;
  };
  const leagueAges = allRosters.map((r) => avgTopAge(r.players ?? [])).filter((a): a is number => a !== null);
  const posture = evaluatePosture({
    myStartingStrength: strengths.find((s) => s.rosterId === target.rosterId)?.strength ?? 0,
    leagueStartingStrengths: strengths.map((s) => s.strength),
    wins: mine.settings?.wins ?? 0,
    losses: mine.settings?.losses ?? 0,
    ties: mine.settings?.ties ?? 0,
    weeksRemaining: Math.max(0, lastRegularWeek - week),
    playoffTeams,
    totalTeams: league.totalRosters,
    isDynasty: league.isDynasty,
    myAvgAge: avgTopAge(mine.players ?? []),
    leagueAvgAge: leagueAges.length > 0 ? leagueAges.reduce((a, b) => a + b, 0) / leagueAges.length : null,
  });

  const occupancy = computeOccupancy(
    {
      rosterPositions: league.rosterPositions,
      taxiSlots: league.taxiSlots,
      taxiYears: league.taxiYears,
      taxiDeadline: league.taxiDeadline,
      taxiAllowVets: league.taxiAllowVets,
      reserveSlots: league.reserveSlots,
    },
    { players: mine.players ?? [], taxi: mine.taxi ?? [], reserve: mine.reserve ?? [] },
  );

  const byeWeeks = new Map<string, number>();
  for (const player of allPlayers) {
    if (player.team && player.byeWeek) byeWeeks.set(player.team, player.byeWeek);
  }

  const byeRoster: ByeRosterPlayer[] = myRoster.map((c) => ({
    playerId: c.playerId,
    name: c.name,
    position: c.position,
    team: c.team,
    rosPoints: c.rosPoints,
  }));

  const byeGaps = findByeGaps({
    rosterPositions: league.rosterPositions,
    roster: byeRoster,
    byeWeeks,
    currentWeek: week,
    lastRegularWeek,
  });

  const suggestions = rankWaiverTargets({
    rosterPositions: league.rosterPositions,
    freeAgents,
    myRoster,
    posture: posture.posture,
    isDynasty: league.isDynasty,
    trajectory: posture.trajectory,
    byeGaps,
    byeWeeks,
    openSlots: Math.max(0, occupancy.openActiveSlots),
    limit: 24,
  });

  const { actionable, blocked } = partitionSuggestions(suggestions);

  const system = waiverSystem(leagueSettings.waiver_type);
  const faabTotal = leagueSettings.waiver_budget ?? null;
  const faabUsed = mine.settings?.waiver_budget_used ?? 0;
  const waiverPosition = mine.settings?.waiver_position ?? null;
  const topAvailablePoints = Math.max(...freeAgents.map((f) => f.rosPoints), 1);
  const weeksRemaining = Math.max(0, lastRegularWeek - week);

  const withAcquisition = actionable.slice(0, 12).map((s) => ({
    ...s,
    bid:
      system === 'faab' && faabTotal !== null
        ? recommendBid({
            winNowDelta: s.score.winNowDelta,
            topAvailablePoints,
            budgetTotal: faabTotal,
            budgetUsed: faabUsed,
            weeksRemaining,
            trendingAdds: s.add.trendingAdds,
            coversBye: s.coversByeWeeks.length > 0,
          })
        : null,
    priority:
      system === 'faab'
        ? null
        : evaluatePriorityClaim({
            winNowDelta: s.score.winNowDelta,
            waiverPosition,
            totalTeams: league.totalRosters,
            coversBye: s.coversByeWeeks.length > 0,
            system,
          }),
  }));

  const needs = [...computeNeeds(league.rosterPositions, myRoster, freeAgents).values()].sort(
    (a, b) => b.needScore - a.needScore,
  );

  return {
    leagueId: league.id,
    leagueName: league.name,
    isDynasty: league.isDynasty,
    week,
    posture: posture.posture,
    trajectory: posture.trajectory,
    confidence: posture.confidence,
    postureReasoning: posture.reasoning,
    openSlots: Math.max(0, occupancy.openActiveSlots),
    suggestions: withAcquisition,
    blocked: blocked.slice(0, 6),
    needs,
    freeAgentCount: freeAgents.length,
    byeGaps,
    waiverSystem: system,
    faabRemaining: faabTotal !== null ? Math.max(0, faabTotal - faabUsed) : null,
    faabTotal,
    waiverPosition,
    lastRegularWeek,
    lastSyncedAt,
  };
}
