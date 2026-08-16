import { db } from '@/db';
import {
  leagues,
  rosters,
  players,
  projections,
  gameOdds,
  marketValues,
  myTeams,
  syncState,
  type ScoringSettings,
} from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { projectPlayers, explainLayers, type TeamOdds, type ProjectedPlayer } from '@/lib/engine/pipeline';
import { compareToCurrentLineup, optimizeLineup, type LineupPlayer } from '@/lib/engine/lineup';
import { computeOccupancy, findSlotMoves, type RosterPlayerInfo, type SlotMove } from '@/lib/engine/roster';
import { evaluatePosture, adjustedDynastyValue, ageMultiplier, type PostureResult } from '@/lib/engine/value';
import { shapeFromLeague, shapeKey } from '@/lib/sources/fantasycalc';

/**
 * Single server-side assembly of everything the dashboard renders.
 *
 * Deliberately one function rather than per-widget queries: the market layer
 * needs league-wide aggregates (every team's base points, every roster's
 * strength) so splitting it up would mean recomputing the same joins several
 * times per page load.
 */

export interface DashboardPlayer {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  opponent: string | null;
  points: number;
  basePoints: number;
  marketPoints: number | null;
  marketDelta: number | null;
  impliedTeamPoints: number | null;
  spread: number | null;
  injuryStatus: string | null;
  age: number | null;
  dynastyValue: number | null;
  adjustedValue: number | null;
  ageMultiplier: number;
  trend30Day: number | null;
  explanation: string | null;
}

export interface DashboardSlot {
  slot: string;
  slotIndex: number;
  player: DashboardPlayer | null;
}

export interface LeagueSummary {
  id: string;
  name: string;
  season: string;
  isDynasty: boolean;
  isSuperflex: boolean;
  totalRosters: number;
  status: string | null;
  scoringKeyCount: number;
}

export interface Dashboard {
  league: LeagueSummary;
  week: number;
  hasRoster: boolean;

  lineup: DashboardSlot[];
  optimalPoints: number;
  currentPoints: number;
  pointsLeftOnBench: number;
  changes: Array<{ slot: string; incoming: DashboardPlayer; outgoing: DashboardPlayer | null; gain: number }>;

  bench: DashboardPlayer[];
  taxi: DashboardPlayer[];
  reserve: DashboardPlayer[];

  movers: DashboardPlayer[];
  occupancy: ReturnType<typeof computeOccupancy>;
  slotMoves: SlotMove[];

  posture: PostureResult | null;
  leagueStrengths: Array<{ rosterId: number; strength: number; isMine: boolean }>;

  assets: DashboardPlayer[];
  totalAssetValue: number;
  ageCliff: DashboardPlayer[];

  marketCoverage: { withMarket: number; total: number; games: number };
  /** Most recent successful sync touching this league, from sync_state. */
  lastSyncedAt: Date | null;
}

export async function listLeagues(): Promise<Array<LeagueSummary & { rosterId: number }>> {
  const rows = await db
    .select({ l: leagues, rosterId: myTeams.rosterId })
    .from(leagues)
    .innerJoin(myTeams, eq(myTeams.leagueId, leagues.id));

  return rows.map(({ l, rosterId }) => ({
    id: l.id,
    name: l.name,
    season: l.season,
    isDynasty: l.isDynasty,
    isSuperflex: l.isSuperflex,
    totalRosters: l.totalRosters,
    status: l.status,
    scoringKeyCount: Object.keys(l.scoringSettings as ScoringSettings).length,
    rosterId,
  }));
}

export async function getDashboard(leagueId?: string, week = 1): Promise<Dashboard | null> {
  const available = await listLeagues();
  if (available.length === 0) return null;

  const target =
    (leagueId ? available.find((l) => l.id === leagueId) : undefined) ??
    available.find((l) => l.isDynasty) ??
    available[0];

  const [leagueRow] = await db.select().from(leagues).where(eq(leagues.id, target.id));
  if (!leagueRow) return null;

  const [allRosters, allPlayers, weekProjections, odds, syncRows] = await Promise.all([
    db.select().from(rosters).where(eq(rosters.leagueId, leagueRow.id)),
    db.select().from(players),
    db
      .select()
      .from(projections)
      .where(and(eq(projections.season, leagueRow.season), eq(projections.week, week))),
    db.select().from(gameOdds).where(and(eq(gameOdds.season, leagueRow.season), eq(gameOdds.week, week))),
    db.select().from(syncState),
  ]);

  // Newest of the jobs that actually refresh this league's data.
  const relevantSyncKeys = new Set(['hourly', 'gameday', `manual:${leagueRow.id}`]);
  const lastSyncedAt =
    syncRows
      .filter((row) => relevantSyncKeys.has(row.key) && row.lastOkAt)
      .map((row) => row.lastOkAt as Date)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const shape = shapeFromLeague({
    isDynasty: leagueRow.isDynasty,
    isSuperflex: leagueRow.isSuperflex,
    totalRosters: leagueRow.totalRosters,
    pprType: leagueRow.pprType,
  });
  const values = await db.select().from(marketValues).where(eq(marketValues.shapeKey, shapeKey(shape)));

  const valueById = new Map(values.map((v) => [v.playerId, v]));
  const playerById = new Map(allPlayers.map((p) => [p.id, p]));
  const projById = new Map(weekProjections.map((p) => [p.playerId, p]));

  const oddsByTeam = new Map<string, TeamOdds>();
  for (const game of odds) {
    oddsByTeam.set(game.homeTeam, {
      impliedPoints: game.impliedHomePts,
      spread: game.spread,
      opponent: game.awayTeam,
    });
    oddsByTeam.set(game.awayTeam, {
      impliedPoints: game.impliedAwayPts,
      spread: game.spread === null ? null : -game.spread,
      opponent: game.homeTeam,
    });
  }

  const mine = allRosters.find((r) => r.rosterId === target.rosterId);
  const summary: LeagueSummary = {
    id: leagueRow.id,
    name: leagueRow.name,
    season: leagueRow.season,
    isDynasty: leagueRow.isDynasty,
    isSuperflex: leagueRow.isSuperflex,
    totalRosters: leagueRow.totalRosters,
    status: leagueRow.status,
    scoringKeyCount: Object.keys(leagueRow.scoringSettings).length,
  };

  /*
   * Project EVERY player with a weekly projection, not just rostered ones.
   *
   * The market layer normalizes against the league-wide median of
   * market-vs-base team ratios, so the set of players passed in changes the
   * normalizer and therefore every player's points. Projecting a different
   * subset on each page made the dashboard and the waiver board disagree about
   * roster strength — and about whether this team was rebuilding. Always
   * projecting the full set makes the numbers deterministic across pages.
   */
  const projected = projectPlayers(
    [...projById.keys()].map((id) => {
      const proj = projById.get(id)!;
      const player = playerById.get(id);
      return {
        playerId: id,
        position: player?.position ?? 'UNK',
        team: proj.team ?? player?.team ?? null,
        stats: proj.stats,
      };
    }),
    { scoring: leagueRow.scoringSettings, oddsByTeam },
  );
  const projectedById = new Map(projected.map((p) => [p.playerId, p]));

  const toDashboardPlayer = (id: string): DashboardPlayer => {
    const player = playerById.get(id);
    const proj = projectedById.get(id);
    const value = valueById.get(id);
    const position = player?.position ?? 'UNK';
    const mult = ageMultiplier(position, player?.age ?? null);

    return {
      playerId: id,
      name: player?.fullName ?? id,
      position,
      team: player?.team ?? null,
      opponent: proj?.opponent ?? null,
      points: proj?.points ?? 0,
      basePoints: proj?.basePoints ?? 0,
      marketPoints: proj?.marketPoints ?? null,
      marketDelta:
        proj?.marketPoints != null ? round2(proj.marketPoints - proj.basePoints) : null,
      impliedTeamPoints: proj?.impliedTeamPoints ?? null,
      spread: proj?.spread ?? null,
      injuryStatus: player?.injuryStatus ?? null,
      age: player?.age ?? null,
      dynastyValue: value?.dynastyValue ?? null,
      adjustedValue: value?.dynastyValue
        ? Math.round(
            adjustedDynastyValue({
              playerId: id,
              position,
              age: player?.age ?? null,
              dynastyValue: value.dynastyValue,
              redraftValue: value.redraftValue ?? 0,
            }),
          )
        : null,
      ageMultiplier: mult,
      trend30Day: value?.trend30Day ?? null,
      explanation: proj ? explainLayers(proj) : null,
    };
  };

  const marketCoverage = {
    withMarket: projected.filter((p) => p.layers.includes('market')).length,
    total: projected.length,
    games: odds.length,
  };

  // No roster yet (pre-draft league) — return the shell so the UI can say so.
  if (!mine || (mine.players ?? []).length === 0) {
    return {
      league: summary,
      week,
      hasRoster: false,
      lineup: [],
      optimalPoints: 0,
      currentPoints: 0,
      pointsLeftOnBench: 0,
      changes: [],
      bench: [],
      taxi: [],
      reserve: [],
      movers: [],
      occupancy: computeOccupancy(slotConfigOf(leagueRow), { players: [], taxi: [], reserve: [] }),
      slotMoves: [],
      posture: null,
      leagueStrengths: [],
      assets: [],
      totalAssetValue: 0,
      ageCliff: [],
      marketCoverage,
      lastSyncedAt,
    };
  }

  const taxiSet = new Set(mine.taxi ?? []);
  const reserveSet = new Set(mine.reserve ?? []);

  const lineupPlayers: LineupPlayer[] = (mine.players ?? [])
    .filter((id) => !taxiSet.has(id) && !reserveSet.has(id))
    .map((id) => {
      const player = playerById.get(id);
      return {
        playerId: id,
        position: player?.position ?? 'UNK',
        eligiblePositions: player?.fantasyPositions ?? [player?.position ?? 'UNK'],
        points: projectedById.get(id)?.points ?? 0,
        ineligible: !projectedById.has(id),
      };
    });

  const comparison = compareToCurrentLineup(
    lineupPlayers,
    leagueRow.rosterPositions,
    mine.starters ?? [],
  );

  const lineup: DashboardSlot[] = comparison.optimal.assignments.map((a) => ({
    slot: a.slot,
    slotIndex: a.slotIndex,
    player: a.playerId ? toDashboardPlayer(a.playerId) : null,
  }));

  const startingIds = new Set(comparison.optimal.assignments.map((a) => a.playerId).filter(Boolean) as string[]);
  const bench = (mine.players ?? [])
    .filter((id) => !startingIds.has(id) && !taxiSet.has(id) && !reserveSet.has(id))
    .map(toDashboardPlayer)
    .sort((a, b) => b.points - a.points);

  const movers = (mine.players ?? [])
    .map(toDashboardPlayer)
    .filter((p) => p.marketDelta !== null && Math.abs(p.marketDelta) > 0.15)
    .sort((a, b) => Math.abs(b.marketDelta!) - Math.abs(a.marketDelta!))
    .slice(0, 8);

  // League-wide starting strength for the posture percentile.
  const strengthOf = (roster: (typeof allRosters)[number]) => {
    const rTaxi = new Set(roster.taxi ?? []);
    const rReserve = new Set(roster.reserve ?? []);
    const pool: LineupPlayer[] = (roster.players ?? [])
      .filter((id) => !rTaxi.has(id) && !rReserve.has(id))
      .map((id) => {
        const player = playerById.get(id);
        return {
          playerId: id,
          position: player?.position ?? 'UNK',
          eligiblePositions: player?.fantasyPositions ?? [player?.position ?? 'UNK'],
          points: projectedById.get(id)?.points ?? 0,
        };
      });
    return optimizeLineup(pool, leagueRow.rosterPositions).totalPoints;
  };

  const leagueStrengths = allRosters
    .map((r) => ({ rosterId: r.rosterId, strength: strengthOf(r), isMine: r.rosterId === target.rosterId }))
    .sort((a, b) => b.strength - a.strength);

  const avgTopAge = (ids: string[]): number | null => {
    const aged = ids
      .map((id) => ({ age: playerById.get(id)?.age ?? null, value: valueById.get(id)?.dynastyValue ?? 0 }))
      .filter((a): a is { age: number; value: number } => a.age !== null && a.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
    if (aged.length === 0) return null;
    return aged.reduce((sum, a) => sum + a.age, 0) / aged.length;
  };

  const leagueAges = allRosters
    .map((r) => avgTopAge(r.players ?? []))
    .filter((a): a is number => a !== null);

  const posture = evaluatePosture({
    myStartingStrength: leagueStrengths.find((s) => s.isMine)?.strength ?? 0,
    leagueStartingStrengths: leagueStrengths.map((s) => s.strength),
    wins: mine.settings?.wins ?? 0,
    losses: mine.settings?.losses ?? 0,
    ties: mine.settings?.ties ?? 0,
    weeksRemaining: Math.max(0, 14 - week),
    playoffTeams: 6,
    totalTeams: leagueRow.totalRosters,
    isDynasty: leagueRow.isDynasty,
    myAvgAge: avgTopAge(mine.players ?? []),
    leagueAvgAge: leagueAges.length > 0 ? leagueAges.reduce((a, b) => a + b, 0) / leagueAges.length : null,
  });

  const slotConfig = slotConfigOf(leagueRow);
  const rosterInfo = new Map<string, RosterPlayerInfo>(
    (mine.players ?? []).map((id) => {
      const player = playerById.get(id);
      return [
        id,
        {
          playerId: id,
          name: player?.fullName ?? id,
          position: player?.position ?? '?',
          yearsExp: player?.yearsExp ?? null,
          injuryStatus: player?.injuryStatus ?? null,
          status: player?.status ?? null,
        },
      ];
    }),
  );

  const rosterShape = { players: mine.players ?? [], taxi: mine.taxi ?? [], reserve: mine.reserve ?? [] };
  const assets = (mine.players ?? [])
    .map(toDashboardPlayer)
    .filter((p) => p.adjustedValue !== null)
    .sort((a, b) => (b.adjustedValue ?? 0) - (a.adjustedValue ?? 0));

  return {
    league: summary,
    week,
    hasRoster: true,
    lineup,
    optimalPoints: comparison.optimal.totalPoints,
    currentPoints: comparison.currentPoints,
    pointsLeftOnBench: comparison.pointsLeftOnBench,
    changes: comparison.changes.map((c) => ({
      slot: c.slot,
      incoming: toDashboardPlayer(c.benchPlayerId),
      outgoing: c.startingPlayerId ? toDashboardPlayer(c.startingPlayerId) : null,
      gain: c.gain,
    })),
    bench,
    taxi: (mine.taxi ?? []).map(toDashboardPlayer),
    reserve: (mine.reserve ?? []).map(toDashboardPlayer),
    movers,
    occupancy: computeOccupancy(slotConfig, rosterShape),
    slotMoves: findSlotMoves(slotConfig, rosterShape, rosterInfo, week),
    posture,
    leagueStrengths,
    assets,
    totalAssetValue: assets.reduce((sum, a) => sum + (a.adjustedValue ?? 0), 0),
    ageCliff: assets.filter((a) => a.ageMultiplier < 0.9),
    marketCoverage,
    lastSyncedAt,
  };
}

function slotConfigOf(league: typeof leagues.$inferSelect) {
  return {
    rosterPositions: league.rosterPositions,
    taxiSlots: league.taxiSlots,
    taxiYears: league.taxiYears,
    taxiDeadline: league.taxiDeadline,
    taxiAllowVets: league.taxiAllowVets,
    reserveSlots: league.reserveSlots,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type { ProjectedPlayer };
