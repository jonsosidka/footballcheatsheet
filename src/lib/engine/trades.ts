import {
  scoreMove,
  adjustedDynastyValue,
  type AssetValue,
  type Posture,
  type Trajectory,
} from './value';
import { optimizeLineup, type LineupPlayer } from './lineup';

/**
 * Trade finder.
 *
 * A trade only happens if BOTH managers think they won, which means the search
 * has to model the other side's objective, not just ours. That's also the
 * mechanism that makes trades possible at all: two teams value the same player
 * differently when they have different postures (a contender wants production
 * now, a rebuilder wants youth) or different positional holes.
 *
 * So every candidate is scored twice — once under our objective and once under
 * theirs — and only mutual gains are surfaced. Anything else is a proposal that
 * gets declined, which is worse than no suggestion at all.
 */

export interface TradePlayer {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  age: number | null;
  /** Rest-of-season points under this league's scoring. */
  rosPoints: number;
  /** Positions this player is lineup-eligible at. */
  eligiblePositions: string[];
  dynastyValue: number;
  redraftValue: number;
}

export interface TradeTeam {
  rosterId: number;
  name: string;
  posture: Posture;
  trajectory: Trajectory;
  players: TradePlayer[];
  /** position -> how badly they need it, 0-1. */
  needs: Map<string, number>;
  /** The league's slot list, needed to re-optimize a post-trade lineup. */
  rosterPositions: string[];
  /** Current optimal starting total, cached so it isn't recomputed per candidate. */
  baselineStrength: number;
}

export interface TradeSide {
  gives: TradePlayer[];
  gets: TradePlayer[];
  winNowDelta: number;
  futureDelta: number;
  combined: number;
}

export interface TradeIdea {
  partnerRosterId: number;
  partnerName: string;
  mine: TradeSide;
  theirs: TradeSide;
  /** Lower is more balanced; ratio of market value exchanged. */
  valueRatio: number;
  rationale: string;
}

/** Optimal starting total for a set of players. */
export function lineupStrength(players: TradePlayer[], rosterPositions: string[]): number {
  const pool: LineupPlayer[] = players.map((p) => ({
    playerId: p.playerId,
    position: p.position,
    eligiblePositions: p.eligiblePositions.length > 0 ? p.eligiblePositions : [p.position],
    points: p.rosPoints,
  }));
  return optimizeLineup(pool, rosterPositions).totalPoints;
}

/**
 * How much a team gains by swapping `gives` for `gets`, under its own posture.
 *
 * Win-now value is the difference between the optimal starting lineup before
 * and after the trade — actually re-solved, not approximated against a fixed
 * "starter floor".
 *
 * The approximation was wrong in a way that mattered: it charged an outgoing
 * player against the CURRENT replacement, but shipping out two receivers
 * promotes WR3 and WR4 into the lineup, so the real cost is higher than the
 * snapshot suggests. That understatement made every 2-for-1 look like a steal,
 * and the finder returned nothing but "package two good players for one great
 * one".
 */
export function evaluateSide(
  team: TradeTeam,
  gives: TradePlayer[],
  gets: TradePlayer[],
  isDynasty: boolean,
): TradeSide {
  const giveIds = new Set(gives.map((p) => p.playerId));
  const after = team.players.filter((p) => !giveIds.has(p.playerId)).concat(gets);
  const winNowDelta = lineupStrength(after, team.rosterPositions) - team.baselineStrength;

  const score = scoreMove({
    winNowDelta,
    gaining: gets.map(toAsset),
    losing: gives.map(toAsset),
    posture: team.posture,
    isDynasty,
    trajectory: team.trajectory,
  });

  return {
    gives,
    gets,
    winNowDelta: score.winNowDelta,
    futureDelta: score.futureDelta,
    combined: score.combined,
  };
}

function toAsset(player: TradePlayer): AssetValue {
  return {
    playerId: player.playerId,
    position: player.position,
    age: player.age,
    dynastyValue: player.dynastyValue,
    redraftValue: player.redraftValue,
  };
}

export interface TradeSearchInput {
  me: TradeTeam;
  rivals: TradeTeam[];
  isDynasty: boolean;
  /** Cap on how lopsided the raw market value can be before it reads as a fleece. */
  maxValueRatio?: number;
  /** How many players per side to consider for multi-player packages. */
  packageDepth?: number;
  limit?: number;
}

/**
 * A proposal where one side ships 40% more market value than it receives will
 * be declined regardless of how well the objectives line up, so it isn't worth
 * showing.
 */
const DEFAULT_MAX_VALUE_RATIO = 1.4;

export function findTrades(input: TradeSearchInput): TradeIdea[] {
  const { me, rivals, isDynasty } = input;
  const maxValueRatio = input.maxValueRatio ?? DEFAULT_MAX_VALUE_RATIO;
  const depth = input.packageDepth ?? 10;
  const limit = input.limit ?? 12;

  const ideas: TradeIdea[] = [];

  // Only tradeable pieces: someone with no market value is not a trade asset.
  const myAssets = me.players.filter((p) => p.dynastyValue > 0).sort((a, b) => b.dynastyValue - a.dynastyValue);

  for (const rival of rivals) {
    const theirAssets = rival.players
      .filter((p) => p.dynastyValue > 0)
      .sort((a, b) => b.dynastyValue - a.dynastyValue);

    // --- 1-for-1 ---------------------------------------------------------
    for (const mine of myAssets) {
      for (const theirs of theirAssets) {
        if (mine.position === theirs.position && Math.abs(mine.rosPoints - theirs.rosPoints) < 5) {
          continue; // lateral swap, no point
        }
        const idea = considerTrade(me, rival, [mine], [theirs], isDynasty, maxValueRatio);
        if (idea) ideas.push(idea);
      }
    }

    // --- 2-for-1: package two of ours for one better of theirs -----------
    const myTop = myAssets.slice(0, depth);
    const theirTop = theirAssets.slice(0, Math.min(6, theirAssets.length));

    for (const target of theirTop) {
      for (let i = 0; i < myTop.length; i++) {
        for (let j = i + 1; j < myTop.length; j++) {
          const pair = [myTop[i], myTop[j]];
          const pairValue = pair.reduce((sum, p) => sum + p.dynastyValue, 0);
          // Only worth packaging if it's in the neighbourhood of the target.
          if (pairValue < target.dynastyValue * 0.7 || pairValue > target.dynastyValue * 1.8) continue;

          const idea = considerTrade(me, rival, pair, [target], isDynasty, maxValueRatio);
          if (idea) ideas.push(idea);
        }
      }
    }
  }

  /*
   * Rank by our own gain, then enforce diversity.
   *
   * Without caps the list collapses onto whichever single player is most
   * valuable in the league — eight rows of "package two of yours for Gibbs".
   * Capping per partner and per acquisition target turns it into a menu of
   * genuinely different moves.
   */
  return diversify(
    dedupe(ideas).sort((a, b) => b.mine.combined - a.mine.combined),
    limit,
  );
}

const MAX_PER_PARTNER = 3;
const MAX_PER_TARGET = 2;

function diversify(ideas: TradeIdea[], limit: number): TradeIdea[] {
  const perPartner = new Map<number, number>();
  const perTarget = new Map<string, number>();
  const out: TradeIdea[] = [];

  for (const idea of ideas) {
    if (out.length >= limit) break;
    const targetKey = idea.mine.gets.map((p) => p.playerId).sort().join('+');
    const partnerCount = perPartner.get(idea.partnerRosterId) ?? 0;
    const targetCount = perTarget.get(targetKey) ?? 0;
    if (partnerCount >= MAX_PER_PARTNER || targetCount >= MAX_PER_TARGET) continue;

    perPartner.set(idea.partnerRosterId, partnerCount + 1);
    perTarget.set(targetKey, targetCount + 1);
    out.push(idea);
  }

  return out;
}

function considerTrade(
  me: TradeTeam,
  rival: TradeTeam,
  give: TradePlayer[],
  get: TradePlayer[],
  isDynasty: boolean,
  maxValueRatio: number,
): TradeIdea | null {
  const giveValue = give.reduce((sum, p) => sum + adjustedDynastyValue(toAsset(p)), 0);
  const getValue = get.reduce((sum, p) => sum + adjustedDynastyValue(toAsset(p)), 0);
  if (giveValue <= 0 || getValue <= 0) return null;

  const valueRatio = Math.max(giveValue / getValue, getValue / giveValue);
  if (valueRatio > maxValueRatio) return null;

  const mine = evaluateSide(me, give, get, isDynasty);
  // From their perspective the sides are reversed.
  const theirs = evaluateSide(rival, get, give, isDynasty);

  // The whole point: both sides must come out ahead on their own terms.
  if (mine.combined <= 0 || theirs.combined <= 0) return null;

  return {
    partnerRosterId: rival.rosterId,
    partnerName: rival.name,
    mine,
    theirs,
    valueRatio: Math.round(valueRatio * 100) / 100,
    rationale: explainTrade(me, rival, mine, theirs, isDynasty),
  };
}

function explainTrade(
  me: TradeTeam,
  rival: TradeTeam,
  mine: TradeSide,
  theirs: TradeSide,
  isDynasty: boolean,
): string {
  const parts: string[] = [];

  if (isDynasty && me.posture !== rival.posture) {
    parts.push(
      `You're ${me.posture}, they're ${rival.posture} — that mismatch is what makes this work.`,
    );
  }

  const incoming = mine.gets[0];
  const need = me.needs.get(incoming.position) ?? 0;
  if (need > 0.5) {
    parts.push(`${incoming.position} is one of your thinner spots.`);
  }

  if (mine.winNowDelta > 0 && mine.futureDelta > 0) {
    parts.push('You gain on both axes.');
  } else if (mine.winNowDelta > 0) {
    parts.push(`Adds ${mine.winNowDelta.toFixed(0)} starting points at some future cost.`);
  } else if (mine.futureDelta > 0) {
    parts.push(`Buys future value for ${Math.abs(mine.winNowDelta).toFixed(0)} points now.`);
  }

  parts.push(`They gain ${theirs.combined.toFixed(1)} on their own objective, so it's plausibly accepted.`);

  return parts.join(' ');
}

/** Collapse duplicate player sets so the same swap isn't listed twice. */
function dedupe(ideas: TradeIdea[]): TradeIdea[] {
  const seen = new Map<string, TradeIdea>();
  for (const idea of ideas) {
    const key = [
      idea.partnerRosterId,
      idea.mine.gives.map((p) => p.playerId).sort().join('+'),
      idea.mine.gets.map((p) => p.playerId).sort().join('+'),
    ].join('|');
    const existing = seen.get(key);
    if (!existing || idea.mine.combined > existing.mine.combined) seen.set(key, idea);
  }
  return [...seen.values()];
}

/**
 * Weakest starter at each position. No longer used for trade valuation (see
 * evaluateSide) but still a useful display figure for "what would he have to
 * beat to crack the lineup".
 */
export function computeStarterFloor(
  players: TradePlayer[],
  rosterPositions: string[],
): Map<string, number> {
  const demand = new Map<string, number>();
  for (const slot of rosterPositions) {
    if (slot === 'BN' || slot === 'IR' || slot === 'TAXI') continue;
    demand.set(slot, (demand.get(slot) ?? 0) + 1);
  }

  const floor = new Map<string, number>();
  const positions = new Set(players.map((p) => p.position));

  for (const position of positions) {
    const needed = demand.get(position) ?? 0;
    if (needed === 0) {
      floor.set(position, 0);
      continue;
    }
    const sorted = players
      .filter((p) => p.position === position)
      .map((p) => p.rosPoints)
      .sort((a, b) => b - a);
    floor.set(position, sorted.length >= needed ? sorted[needed - 1] : 0);
  }

  return floor;
}
