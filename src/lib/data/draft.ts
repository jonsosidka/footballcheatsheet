import { db } from '@/db';
import { leagues, leagueUsers, players, seasonProjections, myTeams } from '@/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { scoreProjection } from '@/lib/engine/scoring';
import { isStartingSlot } from '@/lib/engine/lineup';
import {
  adpDrift,
  assignTiers,
  detectRuns,
  injuryDiscount,
  pickLabel,
  pickNumbersForSlot,
  positionDemand,
  replacementLevels,
  rosterValue,
  slotForPick,
  suggestPicks,
  type DraftPickSuggestion,
  type DraftPlayer,
  type DraftType,
  type PositionRun,
} from '@/lib/engine/draft';
import {
  adpFromStats,
  getDraft,
  getDraftPicks,
  getLeagueDrafts,
  type SleeperDraft,
  type SleeperDraftPick,
} from '@/lib/sources/sleeper';

/**
 * The live draft board.
 *
 * Everything slow is read from the database — the player dump, season
 * projections, byes — and everything that changes during a draft is read from
 * Sleeper on every request. Nothing about the draft is persisted, deliberately:
 * a draft is thirty seconds of relevance per pick, and writing every poll to
 * Postgres would buy staleness and a write amplification problem in exchange
 * for nothing. The two Sleeper calls are small and uncached.
 */

export interface DraftLineupSlot {
  slot: string;
  playerId: string | null;
  name: string | null;
  position: string | null;
  team: string | null;
  byeWeek: number | null;
  points: number;
}

export interface DraftTeamSummary {
  slot: number;
  name: string;
  isMe: boolean;
  picks: number;
  starterPoints: number;
  total: number;
}

export interface DraftFeedPick {
  pickNo: number;
  label: string;
  slot: number;
  team: string;
  playerName: string;
  position: string;
  playerTeam: string | null;
  /** Picks he lasted past his ADP. Negative is a reach. */
  adpDelta: number | null;
  isMine: boolean;
}

export interface DraftNeed {
  position: string;
  demand: number;
  rostered: number;
  /** Best available at the position right now. */
  bestAvailable: number;
}

export interface BoardEntry {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  byeWeek: number | null;
  points: number;
  adp: number | null;
  tier: number;
  injuryStatus: string | null;
}

export interface DraftView {
  leagueId: string | null;
  leagueName: string;
  season: string;
  isDynasty: boolean;
  isSuperflex: boolean;
  rosterPositions: string[];

  draftId: string;
  draftName: string;
  /** pre_draft | drafting | paused | complete */
  status: string;
  type: string;
  teams: number;
  rounds: number;
  totalPicks: number;

  mySlot: number | null;
  currentPickNo: number;
  currentLabel: string;
  onTheClockSlot: number | null;
  onTheClockTeam: string | null;
  isMyPick: boolean;
  myNextPickNo: number | null;
  myNextLabel: string | null;
  picksUntilMyTurn: number | null;
  myFollowingPickNo: number | null;
  picksRemaining: number;

  /** How far this room is running behind ADP. Positive means it is slow. */
  drift: number;
  suggestions: DraftPickSuggestion[];
  runs: PositionRun[];

  lineup: DraftLineupSlot[];
  bench: BoardEntry[];
  starterPoints: number;
  depthPoints: number;
  rosterTotal: number;
  byeShortWeeks: number[];

  needs: DraftNeed[];
  board: Array<{ position: string; players: BoardEntry[] }>;
  standings: DraftTeamSummary[];
  recentPicks: DraftFeedPick[];

  poolSize: number;
  fetchedAt: string;
  warnings: string[];
}

export interface DraftViewOptions {
  leagueId?: string;
  /** Overrides league lookup — how a mock draft gets on the board. */
  draftId?: string;
  /** Manual override for which seat is yours. */
  slot?: number;
}

/** Positions worth showing a column for, in the order people read them. */
const BOARD_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];

export async function getDraftView(options: DraftViewOptions = {}): Promise<DraftView | null> {
  const tracked = await db
    .select({ l: leagues, rosterId: myTeams.rosterId, sleeperUserId: myTeams.sleeperUserId })
    .from(leagues)
    .innerJoin(myTeams, eq(myTeams.leagueId, leagues.id));

  if (tracked.length === 0) return null;

  // Redraft first: this board is built around a season that ends in January.
  const target =
    (options.leagueId ? tracked.find((t) => t.l.id === options.leagueId) : undefined) ??
    tracked.find((t) => !t.l.isDynasty) ??
    tracked[0];
  const league = target.l;

  const draft = await resolveDraft(league.id, options.draftId);
  if (!draft) return null;

  const warnings: string[] = [];
  const [picks, members] = await Promise.all([
    getDraftPicks(draft.draft_id),
    db.select().from(leagueUsers).where(eq(leagueUsers.leagueId, league.id)),
  ]);

  // --- the player universe -------------------------------------------------
  const projectionRows = await db
    .select()
    .from(seasonProjections)
    .where(eq(seasonProjections.season, draft.season ?? league.season));

  if (projectionRows.length === 0) {
    warnings.push(
      `No season projections stored for ${draft.season ?? league.season}. Run a daily sync before drafting.`,
    );
  }

  const projectedIds = projectionRows.map((row) => row.playerId);
  const playerRows =
    projectedIds.length > 0
      ? await db.select().from(players).where(inArray(players.id, projectedIds))
      : [];

  const playerById = new Map(playerRows.map((row) => [row.id, row]));

  const universe: DraftPlayer[] = [];
  for (const row of projectionRows) {
    const player = playerById.get(row.playerId);
    if (!player || player.active === false || !player.position) continue;

    const raw = scoreProjection(row.stats, league.scoringSettings);
    if (raw <= 0) continue;

    universe.push({
      playerId: row.playerId,
      name: player.fullName ?? row.playerId,
      position: player.position,
      eligiblePositions: player.fantasyPositions ?? [player.position],
      team: player.team,
      byeWeek: player.byeWeek,
      // Applied here rather than in the engine so the discount flows through
      // starters, depth and lookahead identically.
      points: round2(raw * injuryDiscount(player.injuryStatus ?? player.status)),
      adp: adpFromStats(row.stats, { isSuperflex: league.isSuperflex, pprType: league.pprType }),
      injuryStatus: player.injuryStatus,
    });
  }

  const universeById = new Map(universe.map((player) => [player.playerId, player]));

  // --- draft shape ---------------------------------------------------------
  const teams = Math.max(1, draft.settings?.teams ?? league.totalRosters ?? 12);
  const rounds = Math.max(1, draft.settings?.rounds ?? league.rosterPositions.length);
  const reversalRound = draft.settings?.reversal_round ?? 0;
  const type = (draft.type ?? 'snake') as DraftType;
  const totalPicks = teams * rounds;

  const madePicks = [...picks].sort((a, b) => a.pick_no - b.pick_no);
  const currentPickNo = Math.min(totalPicks, madePicks.length + 1);
  const draftedIds = new Set(madePicks.map((pick) => pick.player_id));

  const nameBySlot = buildSlotNames(draft, members, teams);
  const mySlot = resolveMySlot(draft, options.slot, target.sleeperUserId, target.rosterId);

  if (mySlot === null) {
    warnings.push(
      'Could not work out which seat is yours — the draft order may not be set. Add ?slot=N to the URL to pick one.',
    );
  }

  const myPickNumbers = mySlot === null ? [] : pickNumbersForSlot(mySlot, teams, rounds, type, reversalRound);
  const upcoming = myPickNumbers.filter((pickNo) => pickNo >= currentPickNo);
  const myNextPickNo = upcoming[0] ?? null;
  const myFollowingPickNo = upcoming[1] ?? null;
  const isMyPick = myNextPickNo === currentPickNo && madePicks.length < totalPicks;

  if (type === 'auction') {
    warnings.push(
      'Auction draft: nomination order and budgets are not modelled, so values are roster-marginal points rather than prices.',
    );
  }

  // --- rosters so far ------------------------------------------------------
  const bySlot = new Map<number, DraftPlayer[]>();
  for (const pick of madePicks) {
    const player = universeById.get(pick.player_id);
    if (!player) continue;
    const slot = pick.draft_slot;
    const group = bySlot.get(slot);
    if (group) group.push(player);
    else bySlot.set(slot, [player]);
  }

  const myPlayers = mySlot === null ? [] : (bySlot.get(mySlot) ?? []);
  const available = universe.filter((player) => !draftedIds.has(player.playerId));

  const replacements = replacementLevels(universe, league.rosterPositions, teams);
  const drift = adpDrift(
    madePicks.map((pick) => ({
      pickNo: pick.pick_no,
      adp: universeById.get(pick.player_id)?.adp ?? null,
    })),
  );

  // --- advice --------------------------------------------------------------
  const suggestions =
    mySlot === null || madePicks.length >= totalPicks
      ? []
      : suggestPicks({
          rosterPositions: league.rosterPositions,
          myPlayers,
          available,
          replacementByPosition: replacements,
          currentPickNo,
          // Off the clock, the board plans for the pick you will actually make.
          targetPickNo: myNextPickNo,
          followingPickNo: myFollowingPickNo,
          picksRemaining: upcoming.length,
          recentPositions: madePicks
            .slice(-Math.max(6, teams))
            .map((pick) => universeById.get(pick.player_id)?.position ?? 'UNK'),
          teams,
          drift,
          limit: 12,
        });

  const runs = detectRuns(
    madePicks.slice(-Math.max(6, teams)).map((pick) => universeById.get(pick.player_id)?.position ?? 'UNK'),
    teams,
  );

  // --- my roster -----------------------------------------------------------
  const myValue = rosterValue(myPlayers, {
    rosterPositions: league.rosterPositions,
    replacementByPosition: replacements,
    includeByeRisk: myPlayers.length >= league.rosterPositions.filter(isStartingSlot).length,
  });

  const myById = new Map(myPlayers.map((player) => [player.playerId, player]));
  const lineup: DraftLineupSlot[] = myValue.lineup.assignments.map((assignment) => {
    const player = assignment.playerId ? myById.get(assignment.playerId) : undefined;
    return {
      slot: assignment.slot,
      playerId: player?.playerId ?? null,
      name: player?.name ?? null,
      position: player?.position ?? null,
      team: player?.team ?? null,
      byeWeek: player?.byeWeek ?? null,
      points: player?.points ?? 0,
    };
  });

  const tiers = assignTiers(available);
  const toEntry = (player: DraftPlayer): BoardEntry => ({
    playerId: player.playerId,
    name: player.name,
    position: player.position,
    team: player.team,
    byeWeek: player.byeWeek,
    points: player.points,
    adp: player.adp,
    tier: tiers.get(player.playerId) ?? 1,
    injuryStatus: player.injuryStatus,
  });

  const bench = myValue.lineup.benchedPlayerIds
    .map((id) => myById.get(id))
    .filter((player): player is DraftPlayer => !!player)
    .sort((a, b) => b.points - a.points)
    .map(toEntry);

  // --- needs and the position boards --------------------------------------
  const positions = [...new Set(universe.map((player) => player.position))].filter(
    (position) => positionDemand(position, league.rosterPositions) > 0,
  );

  const needs: DraftNeed[] = positions
    .map((position) => {
      const pool = available.filter((player) => player.position === position);
      return {
        position,
        demand: round2(positionDemand(position, league.rosterPositions)),
        rostered: myPlayers.filter((player) => player.position === position).length,
        bestAvailable: pool.length > 0 ? Math.max(...pool.map((player) => player.points)) : 0,
      };
    })
    // Widest gap between what the league starts and what you own, first.
    .sort((a, b) => b.demand - b.rostered - (a.demand - a.rostered));


  const board = BOARD_ORDER.filter((position) => positions.includes(position)).map((position) => ({
    position,
    players: available
      .filter((player) => player.position === position)
      .sort((a, b) => b.points - a.points)
      .slice(0, 8)
      .map(toEntry),
  }));

  // --- everyone else -------------------------------------------------------
  const standings: DraftTeamSummary[] = Array.from({ length: teams }, (_, index) => {
    const slot = index + 1;
    const roster = bySlot.get(slot) ?? [];
    const value = rosterValue(roster, {
      rosterPositions: league.rosterPositions,
      replacementByPosition: replacements,
    });
    return {
      slot,
      name: nameBySlot.get(slot) ?? `Slot ${slot}`,
      isMe: slot === mySlot,
      picks: roster.length,
      starterPoints: value.starterPoints,
      total: value.total,
    };
  }).sort((a, b) => b.total - a.total);

  const recentPicks: DraftFeedPick[] = madePicks
    .slice(-14)
    .reverse()
    .map((pick) => {
      const player = universeById.get(pick.player_id);
      return {
        pickNo: pick.pick_no,
        label: pickLabel(pick.pick_no, teams),
        slot: pick.draft_slot,
        team: nameBySlot.get(pick.draft_slot) ?? `Slot ${pick.draft_slot}`,
        playerName: player?.name ?? pickMetadataName(pick),
        position: player?.position ?? pick.metadata?.position ?? 'UNK',
        playerTeam: player?.team ?? pick.metadata?.team ?? null,
        adpDelta: player?.adp == null ? null : round1(pick.pick_no - player.adp),
        isMine: pick.draft_slot === mySlot,
      };
    });

  const onTheClockSlot =
    madePicks.length >= totalPicks ? null : slotForPick(currentPickNo, teams, type, reversalRound);

  return {
    leagueId: draft.league_id,
    leagueName: league.name,
    season: draft.season ?? league.season,
    isDynasty: league.isDynasty,
    isSuperflex: league.isSuperflex,
    rosterPositions: league.rosterPositions,

    draftId: draft.draft_id,
    draftName: draft.metadata?.name?.trim() || league.name,
    status: draft.status,
    type: draft.type,
    teams,
    rounds,
    totalPicks,

    mySlot,
    currentPickNo,
    currentLabel: pickLabel(currentPickNo, teams),
    onTheClockSlot,
    onTheClockTeam: onTheClockSlot === null ? null : (nameBySlot.get(onTheClockSlot) ?? `Slot ${onTheClockSlot}`),
    isMyPick,
    myNextPickNo,
    myNextLabel: myNextPickNo === null ? null : pickLabel(myNextPickNo, teams),
    picksUntilMyTurn: myNextPickNo === null ? null : myNextPickNo - currentPickNo,
    myFollowingPickNo,
    picksRemaining: upcoming.length,

    drift: round1(drift),
    suggestions,
    runs,

    lineup,
    bench,
    starterPoints: myValue.starterPoints,
    depthPoints: myValue.depthPoints,
    rosterTotal: myValue.total,
    byeShortWeeks: myValue.byeShortWeeks,

    needs,
    board,
    standings,
    recentPicks,

    poolSize: available.length,
    fetchedAt: new Date().toISOString(),
    warnings,
  };
}

/**
 * Pick the draft that matters.
 *
 * A league accumulates a draft per season, so "the most recent" is the wrong
 * answer during the one week of the year this page exists for: a live draft
 * beats a finished one regardless of dates.
 */
async function resolveDraft(leagueId: string, draftId?: string): Promise<SleeperDraft | null> {
  if (draftId) return getDraft(draftId);

  const drafts = await getLeagueDrafts(leagueId);
  if (drafts.length === 0) return null;

  const rank = (draft: SleeperDraft) =>
    draft.status === 'drafting' ? 0 : draft.status === 'paused' ? 1 : draft.status === 'pre_draft' ? 2 : 3;

  return [...drafts].sort((a, b) => rank(a) - rank(b) || (b.created ?? 0) - (a.created ?? 0))[0];
}

/**
 * Which seat is yours.
 *
 * Three sources in decreasing reliability: an explicit override (the only thing
 * that works for a mock draft), the draft order keyed by your Sleeper user id,
 * and the slot-to-roster map. Any of them can be absent — `draft_order` is null
 * until the commissioner sets the order — so all three are tried.
 */
function resolveMySlot(
  draft: SleeperDraft,
  override: number | undefined,
  sleeperUserId: string | null,
  rosterId: number | null,
): number | null {
  if (override && override > 0) return override;

  if (sleeperUserId && draft.draft_order?.[sleeperUserId]) return draft.draft_order[sleeperUserId];

  if (rosterId !== null && draft.slot_to_roster_id) {
    const found = Object.entries(draft.slot_to_roster_id).find(([, id]) => id === rosterId);
    if (found) return Number(found[0]);
  }

  return null;
}

function buildSlotNames(
  draft: SleeperDraft,
  members: Array<{ userId: string; displayName: string | null; teamName: string | null }>,
  teams: number,
): Map<number, string> {
  const nameByUser = new Map(
    members.map((member) => [member.userId, member.teamName || member.displayName || member.userId]),
  );

  const names = new Map<number, string>();
  for (let slot = 1; slot <= teams; slot++) names.set(slot, `Slot ${slot}`);

  for (const [userId, slot] of Object.entries(draft.draft_order ?? {})) {
    names.set(slot, nameByUser.get(userId) ?? `Slot ${slot}`);
  }

  return names;
}

/** Sleeper carries the drafted player's name on the pick itself, which is the
 * only thing that renders correctly when a rookie has no projection yet. */
function pickMetadataName(pick: SleeperDraftPick): string {
  const first = pick.metadata?.first_name ?? '';
  const last = pick.metadata?.last_name ?? '';
  const full = `${first} ${last}`.trim();
  return full || pick.player_id;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
