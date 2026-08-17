import { db } from '@/db';
import {
  leagues,
  rosters,
  players,
  seasonProjections,
  projections,
  gameOdds,
  marketValues,
  myTeams,
  leagueUsers,
} from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { scoreProjection } from '@/lib/engine/scoring';
import { projectPlayers, type TeamOdds } from '@/lib/engine/pipeline';
import { optimizeLineup, type LineupPlayer } from '@/lib/engine/lineup';
import { evaluatePosture } from '@/lib/engine/value';
import { computeNeeds, type WaiverCandidate } from '@/lib/engine/waivers';
import { findTrades, lineupStrength, type TradeIdea, type TradePlayer, type TradeTeam } from '@/lib/engine/trades';
import { shapeFromLeague, shapeKey } from '@/lib/sources/fantasycalc';

export interface TradeView {
  leagueId: string;
  leagueName: string;
  isDynasty: boolean;
  myPosture: string;
  myTrajectory: string;
  ideas: TradeIdea[];
  partners: Array<{ rosterId: number; name: string; posture: string; strength: number; isMe: boolean }>;
  lastSyncedAt: Date | null;
}

export async function getTradeView(leagueId?: string, week = 1): Promise<TradeView | null> {
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

  const [allRosters, allPlayers, seasonRows, weekRows, odds, users] = await Promise.all([
    db.select().from(rosters).where(eq(rosters.leagueId, league.id)),
    db.select().from(players),
    db.select().from(seasonProjections).where(eq(seasonProjections.season, league.season)),
    db.select().from(projections).where(and(eq(projections.season, league.season), eq(projections.week, week))),
    db.select().from(gameOdds).where(and(eq(gameOdds.season, league.season), eq(gameOdds.week, week))),
    db.select().from(leagueUsers).where(eq(leagueUsers.leagueId, league.id)),
  ]);

  const shape = shapeFromLeague({
    isDynasty: league.isDynasty,
    isSuperflex: league.isSuperflex,
    totalRosters: league.totalRosters,
    pprType: league.pprType,
  });
  const values = await db.select().from(marketValues).where(eq(marketValues.shapeKey, shapeKey(shape)));

  const valueById = new Map(values.map((v) => [v.playerId, v]));
  const playerById = new Map(allPlayers.map((p) => [p.id, p]));
  const seasonById = new Map(seasonRows.map((r) => [r.playerId, r]));
  const weekById = new Map(weekRows.map((r) => [r.playerId, r]));
  const userBysId = new Map(users.map((u) => [u.userId, u]));

  const oddsByTeam = new Map<string, TeamOdds>();
  for (const game of odds) {
    oddsByTeam.set(game.homeTeam, { impliedPoints: game.impliedHomePts, spread: game.spread, opponent: game.awayTeam });
    oddsByTeam.set(game.awayTeam, {
      impliedPoints: game.impliedAwayPts,
      spread: game.spread === null ? null : -game.spread,
      opponent: game.homeTeam,
    });
  }

  // Weekly points only feed the strength/posture read; trades run on ROS.
  const weekProjected = projectPlayers(
    [...weekById.keys()].map((id) => {
      const proj = weekById.get(id)!;
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
  const weekPoints = new Map(weekProjected.map((p) => [p.playerId, p.points]));

  const toTradePlayer = (id: string): TradePlayer | null => {
    const player = playerById.get(id);
    if (!player) return null;
    const season = seasonById.get(id);
    const value = valueById.get(id);
    return {
      playerId: id,
      name: player.fullName ?? id,
      position: player.position ?? 'UNK',
      team: player.team,
      age: player.age,
      rosPoints: season ? scoreProjection(season.stats, league.scoringSettings) : 0,
      eligiblePositions: player.fantasyPositions ?? [player.position ?? 'UNK'],
      dynastyValue: value?.dynastyValue ?? 0,
      redraftValue: value?.redraftValue ?? 0,
    };
  };

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
          points: weekPoints.get(id) ?? 0,
        };
      });
    return optimizeLineup(pool, league.rosterPositions).totalPoints;
  };

  const strengths = allRosters.map((r) => ({ rosterId: r.rosterId, strength: strengthOf(r) }));
  const settings = (league.settings ?? {}) as Record<string, number>;
  const lastRegularWeek = Math.max(1, (settings.playoff_week_start ?? 15) - 1);
  const playoffTeams = settings.playoff_teams ?? 6;

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
  const leagueAvgAge = leagueAges.length > 0 ? leagueAges.reduce((a, b) => a + b, 0) / leagueAges.length : null;

  /**
   * Every rival gets its own posture, trajectory, needs and starter floor.
   * Modelling only our own objective would produce proposals nobody accepts.
   */
  const buildTeam = (roster: (typeof allRosters)[number]): TradeTeam => {
    const tradePlayers = (roster.players ?? [])
      .map(toTradePlayer)
      .filter((p): p is TradePlayer => p !== null);

    const posture = evaluatePosture({
      myStartingStrength: strengths.find((s) => s.rosterId === roster.rosterId)?.strength ?? 0,
      leagueStartingStrengths: strengths.map((s) => s.strength),
      wins: roster.settings?.wins ?? 0,
      losses: roster.settings?.losses ?? 0,
      ties: roster.settings?.ties ?? 0,
      weeksRemaining: Math.max(0, lastRegularWeek - week),
      playoffTeams,
      totalTeams: league.totalRosters,
      isDynasty: league.isDynasty,
      myAvgAge: avgTopAge(roster.players ?? []),
      leagueAvgAge,
    });

    const asWaiverCandidates: WaiverCandidate[] = tradePlayers.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      position: p.position,
      team: p.team,
      age: p.age,
      rosPoints: p.rosPoints,
      weekPoints: weekPoints.get(p.playerId) ?? 0,
      dynastyValue: p.dynastyValue,
      trend30Day: null,
      trendingAdds: 0,
      injuryStatus: null,
    }));

    const needs = new Map<string, number>();
    for (const [position, need] of computeNeeds(league.rosterPositions, asWaiverCandidates, [])) {
      needs.set(position, need.needScore);
    }

    const owner = roster.ownerId ? userBysId.get(roster.ownerId) : undefined;

    return {
      rosterId: roster.rosterId,
      name: owner?.teamName ?? owner?.displayName ?? `Roster ${roster.rosterId}`,
      posture: posture.posture,
      trajectory: posture.trajectory,
      players: tradePlayers,
      needs,
      rosterPositions: league.rosterPositions,
      baselineStrength: lineupStrength(tradePlayers, league.rosterPositions),
    };
  };

  const teams = allRosters.map(buildTeam);
  const me = teams.find((t) => t.rosterId === target.rosterId);
  if (!me) return null;

  const rivals = teams.filter((t) => t.rosterId !== target.rosterId);

  const ideas = findTrades({
    me,
    rivals,
    isDynasty: league.isDynasty,
    limit: 15,
  });

  return {
    leagueId: league.id,
    leagueName: league.name,
    isDynasty: league.isDynasty,
    myPosture: me.posture,
    myTrajectory: me.trajectory,
    ideas,
    partners: teams
      .map((t) => ({
        rosterId: t.rosterId,
        name: t.name,
        posture: t.posture,
        strength: strengths.find((s) => s.rosterId === t.rosterId)?.strength ?? 0,
        isMe: t.rosterId === target.rosterId,
      }))
      .sort((a, b) => b.strength - a.strength),
    lastSyncedAt: null,
  };
}
