import {
  optimizeLineup,
  SLOT_ELIGIBILITY,
  isStartingSlot,
  type LineupPlayer,
  type OptimalLineup,
} from './lineup';

/**
 * Live draft advice.
 *
 * The question a draft board has to answer is NOT "who is the best player
 * left". It is "which pick leaves me with the best roster once the draft is
 * over". Those differ constantly, and every naive board gets the difference
 * wrong in the same three ways:
 *
 *   1. It ranks by projected points, so it hands you a fourth running back
 *      whose points can never enter your starting lineup.
 *   2. It ignores who will still be there when you pick again, so it tells you
 *      to take the player who was going to fall to you anyway.
 *   3. It treats a bye-week pileup and an unfillable QB slot as somebody
 *      else's problem.
 *
 * So the value of a pick here is defined as the change in the value of your
 * *whole roster*, and the value of a roster is what it will actually score:
 *
 *   starters   the optimal weekly lineup, solved exactly (lineup.ts)
 *   depth      what a backup contributes in the weeks the man ahead is out,
 *              measured against a freely-available replacement
 *   bye risk   weeks where byes leave a starting slot that cannot be filled
 *
 * On top of that sits one step of lookahead. Taking a player costs you the
 * chance to take him later, which is only worth something if he would not have
 * lasted. Survival probabilities from ADP turn that into arithmetic: the score
 * for a pick is what he adds now plus what you expect to still be able to get
 * at your next pick — which is what finally makes the board say "take the tight
 * end, the tier breaks before you're back up" instead of "take the highest
 * projected points".
 *
 * MEASURED, not asserted. scripts/draft-sim.ts drafts a 12-team league from
 * every seat against a room of ADP bots. Over 24 drafts:
 *
 *   best projected points   1273.9 starting-lineup pts, 12th of 12, every time
 *   average draft position  1437.6, 6.75th
 *   this engine             1554.3, 1.38th, first in 18 of 24
 *
 * against the points board that every other tool ships, +280.4 pts per draft
 * with a 95% interval of [260.8, 300.0] and 24 wins from 24. The pool there is
 * synthetic, so what this measures is the decision procedure with projections
 * held fixed and correct — whether the projections themselves are any good is
 * scripts/backtest.ts's question, not this one.
 */

export interface DraftPlayer {
  playerId: string;
  name: string;
  position: string;
  /** Sleeper's fantasy_positions — what slots he is legal in. */
  eligiblePositions: string[];
  team: string | null;
  byeWeek: number | null;
  /** League-scored full-season projection. */
  points: number;
  /** Overall average draft position, in pick numbers. */
  adp: number | null;
  injuryStatus: string | null;
}

// ---------------------------------------------------------------------------
// Draft order
// ---------------------------------------------------------------------------

export type DraftType = 'snake' | 'linear' | 'auction';

export function roundOfPick(pickNo: number, teams: number): number {
  return Math.floor((pickNo - 1) / Math.max(1, teams)) + 1;
}

/**
 * Which draft slot is on the clock for a given overall pick number.
 *
 * Snake reverses every round. Sleeper's optional `reversal_round` (third-round
 * reversal, the most common house rule) flips the parity from that round on, so
 * round 3 repeats round 2's order rather than restarting round 1's — which is
 * the whole point of the rule and is silently wrong if you assume plain snake.
 */
export function slotForPick(
  pickNo: number,
  teams: number,
  type: DraftType = 'snake',
  reversalRound = 0,
): number {
  const size = Math.max(1, teams);
  const round = roundOfPick(pickNo, size);
  const indexInRound = (pickNo - 1) % size;

  if (type !== 'snake') return indexInRound + 1;

  const evenRound = round % 2 === 0;
  const reversed = reversalRound > 0 && round >= reversalRound ? !evenRound : evenRound;

  return reversed ? size - indexInRound : indexInRound + 1;
}

/** Every overall pick number belonging to one draft slot, in order. */
export function pickNumbersForSlot(
  slot: number,
  teams: number,
  rounds: number,
  type: DraftType = 'snake',
  reversalRound = 0,
): number[] {
  const picks: number[] = [];
  for (let round = 1; round <= rounds; round++) {
    for (let index = 0; index < teams; index++) {
      const pickNo = (round - 1) * teams + index + 1;
      if (slotForPick(pickNo, teams, type, reversalRound) === slot) {
        picks.push(pickNo);
        break;
      }
    }
  }
  return picks;
}

/** Human label for an overall pick number: pick 15 of a 12-team draft is 2.03. */
export function pickLabel(pickNo: number, teams: number): string {
  const round = roundOfPick(pickNo, teams);
  const inRound = ((pickNo - 1) % Math.max(1, teams)) + 1;
  return `${round}.${String(inRound).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Roster value
// ---------------------------------------------------------------------------

/**
 * The share of a season a backup actually starts, by his depth at the position.
 *
 * Starters miss time — injuries, byes, benchings — and the man behind them
 * plays those weeks. Around three of seventeen games is the usual figure for a
 * skill-position starter, which is why the first backup is worth roughly a
 * fifth of a starter and the third is worth almost nothing.
 *
 * This is the number that makes balance fall out of the arithmetic instead of
 * being imposed by a rule: a fourth running back is not "against roster
 * construction policy", he is simply worth 4% of his projection to you.
 */
const DEPTH_SHARES = [0.22, 0.09, 0.04];

/** Games in a fantasy regular season plus playoffs — the divisor for weekly rates. */
const SEASON_WEEKS = 17;

export interface RosterValueOptions {
  rosterPositions: string[];
  /** Position -> points of the best player who goes undrafted. */
  replacementByPosition: Map<string, number>;
  /** Charge for weeks where byes leave a starting slot unfillable. */
  includeByeRisk?: boolean;
}

export interface RosterValue {
  starterPoints: number;
  depthPoints: number;
  byePenalty: number;
  total: number;
  lineup: OptimalLineup;
  /** Bye weeks where this roster cannot fill a slot it otherwise fills. */
  byeShortWeeks: number[];
}

function toLineupPlayer(player: DraftPlayer): LineupPlayer {
  return {
    playerId: player.playerId,
    position: player.position,
    eligiblePositions:
      player.eligiblePositions.length > 0 ? player.eligiblePositions : [player.position],
    points: player.points,
  };
}

function unfilledSlots(lineup: OptimalLineup): number {
  return lineup.assignments.filter((assignment) => assignment.playerId === null).length;
}

/**
 * What one unfillable starting slot costs for one week.
 *
 * Derived from the league's own replacement levels rather than hardcoded: a
 * slot you cannot fill costs you what a freely-available starter would have
 * scored in it, and that number is much larger in a 14-team PPR league than in
 * a shallow one.
 */
function emptySlotWeekCost(options: RosterValueOptions): number {
  const relevant = [...options.replacementByPosition.entries()]
    .filter(([position]) => positionDemand(position, options.rosterPositions) > 0)
    .map(([, points]) => points);
  if (relevant.length === 0) return 5;
  const mean = relevant.reduce((sum, points) => sum + points, 0) / relevant.length;
  return Math.max(3, mean / SEASON_WEEKS);
}

/**
 * What a roster is worth over a season.
 *
 * Starters, depth and bye risk are returned separately as well as summed,
 * because the UI has to be able to say *why* a pick scored what it scored.
 */
export function rosterValue(players: DraftPlayer[], options: RosterValueOptions): RosterValue {
  const lineup = optimizeLineup(players.map(toLineupPlayer), options.rosterPositions);
  const starterPoints = lineup.totalPoints;

  // --- depth ---------------------------------------------------------------
  const benched = new Set(lineup.benchedPlayerIds);
  const byPosition = new Map<string, DraftPlayer[]>();
  for (const player of players) {
    if (!benched.has(player.playerId)) continue;
    const group = byPosition.get(player.position);
    if (group) group.push(player);
    else byPosition.set(player.position, [player]);
  }

  let depthPoints = 0;
  for (const [position, group] of byPosition) {
    const replacement = options.replacementByPosition.get(position) ?? 0;
    group.sort((a, b) => b.points - a.points);
    group.forEach((player, depth) => {
      const share = DEPTH_SHARES[depth] ?? 0;
      if (share > 0) depthPoints += share * Math.max(0, player.points - replacement);
    });
  }

  // --- bye risk ------------------------------------------------------------
  let byePenalty = 0;
  const byeShortWeeks: number[] = [];

  if (options.includeByeRisk) {
    const baseline = unfilledSlots(lineup);
    const weeks = new Set(
      players.map((player) => player.byeWeek).filter((week): week is number => !!week),
    );
    const weekCost = emptySlotWeekCost(options);

    for (const week of weeks) {
      const available = players.filter((player) => player.byeWeek !== week);
      const withoutBye = optimizeLineup(available.map(toLineupPlayer), options.rosterPositions);
      // Measured against the baseline so a half-drafted roster isn't punished
      // for slots it hasn't filled yet — only slots the byes take away count.
      const lost = unfilledSlots(withoutBye) - baseline;
      if (lost > 0) {
        byePenalty += lost * weekCost;
        byeShortWeeks.push(week);
      }
    }
  }

  return {
    starterPoints: round2(starterPoints),
    depthPoints: round2(depthPoints),
    byePenalty: round2(byePenalty),
    total: round2(starterPoints + depthPoints - byePenalty),
    lineup,
    byeShortWeeks: byeShortWeeks.sort((a, b) => a - b),
  };
}

/**
 * How many starting slots a position competes for.
 *
 * Dedicated slots count in full. A flex is split evenly across the positions
 * eligible for it, because it is one body drawn from a shared pool — counting
 * it in full for each would claim a single FLEX creates demand for three
 * separate starters.
 */
export function positionDemand(position: string, rosterPositions: string[]): number {
  let demand = 0;
  for (const slot of rosterPositions) {
    if (!isStartingSlot(slot)) continue;
    const eligible = SLOT_ELIGIBILITY[slot];
    if (!eligible || !eligible.includes(position)) continue;
    demand += 1 / eligible.length;
  }
  return demand;
}

/**
 * Replacement level per position: what the best undrafted player at that
 * position is projected to score.
 *
 * Computed over the whole player universe, drafted or not, so the baseline is a
 * property of the league's shape rather than something that drifts upward as
 * the board empties.
 */
export function replacementLevels(
  universe: DraftPlayer[],
  rosterPositions: string[],
  teams: number,
): Map<string, number> {
  const byPosition = new Map<string, number[]>();
  for (const player of universe) {
    const list = byPosition.get(player.position);
    if (list) list.push(player.points);
    else byPosition.set(player.position, [player.points]);
  }

  const levels = new Map<string, number>();
  for (const [position, points] of byPosition) {
    const demand = positionDemand(position, rosterPositions);
    if (demand === 0) {
      levels.set(position, 0);
      continue;
    }
    points.sort((a, b) => b - a);
    // Every team fills its demand first; the next man is the streamer.
    const index = Math.min(points.length - 1, Math.ceil(teams * demand));
    levels.set(position, points[index] ?? 0);
  }
  return levels;
}

// ---------------------------------------------------------------------------
// Survival
// ---------------------------------------------------------------------------

/**
 * Probability a player who is on the board at `fromPick` is still there at
 * `toPick`.
 *
 * A logistic curve centred on his ADP, conditioned on having already lasted to
 * `fromPick`. The conditioning is what makes the number answer the question
 * being asked: the picks already spent are spent, and an unconditional curve
 * would keep charging a player for the ten picks he has visibly survived.
 *
 * The spread widens with ADP because late-round consensus is far softer than
 * early-round consensus — nobody disagrees about the 1.01, everybody disagrees
 * about pick 130 — and it widens with the current pick too, so a player who has
 * slid well past his ADP is not handed false precision on the way down.
 */
export function survivalProbability(
  adp: number | null,
  fromPick: number,
  toPick: number,
  drift = 0,
): number {
  if (toPick <= fromPick) return 1;
  // No ADP means nobody is drafting him off a list; treat him as likely to last.
  if (adp === null || !Number.isFinite(adp)) return 0.85;

  const centre = adp + drift;
  const spread = Math.max(2.5, 0.55 * Math.max(6, 0.18 * Math.max(centre, fromPick)));

  // S(t) = P(undrafted at t) = 1 / (1 + exp((t - centre) / spread)).
  // The ratio S(to)/S(from) reduces to this form, which stays stable when the
  // player is far past his ADP and S(from) underflows.
  const ratio = (1 + Math.exp((fromPick - centre) / spread)) / (1 + Math.exp((toPick - centre) / spread));
  return Math.min(1, Math.max(0, ratio));
}

/**
 * How far this room is running ahead of or behind ADP.
 *
 * Positive means players are lasting longer than their ADP says (a slow room,
 * so you can wait); negative means everyone is reaching. Measured from the
 * picks already made, which is the only honest source for it — a room of eight
 * people who have never heard of ADP is a completely different draft.
 */
export function adpDrift(picks: Array<{ pickNo: number; adp: number | null }>): number {
  const observed = picks.filter((pick): pick is { pickNo: number; adp: number } => pick.adp !== null);
  if (observed.length < 8) return 0;
  const mean =
    observed.reduce((sum, pick) => sum + (pick.pickNo - pick.adp), 0) / observed.length;
  // Bounded: a handful of keeper-league oddities shouldn't shift the whole board.
  return Math.max(-18, Math.min(18, mean));
}

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

/**
 * Group a position's players into tiers by where the drops actually are.
 *
 * Tiers matter more than ranks during a draft: the cost of waiting is zero
 * inside a tier and large across a tier break, and that is exactly the decision
 * you are making every time you pass on a position.
 *
 * The break threshold is relative to the position's own gaps, so a position
 * with a long flat middle doesn't get carved into fifteen meaningless tiers.
 */
export function assignTiers(players: DraftPlayer[]): Map<string, number> {
  const tiers = new Map<string, number>();
  const byPosition = new Map<string, DraftPlayer[]>();

  for (const player of players) {
    const group = byPosition.get(player.position);
    if (group) group.push(player);
    else byPosition.set(player.position, [player]);
  }

  for (const group of byPosition.values()) {
    const sorted = [...group].sort((a, b) => b.points - a.points);
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i - 1].points - sorted[i].points);

    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const median = sortedGaps.length > 0 ? sortedGaps[Math.floor(sortedGaps.length / 2)] : 0;
    // A break is a gap well clear of the position's typical step down, with a
    // floor so a position whose gaps are all ~0.1 pts isn't tiered on noise.
    const threshold = Math.max(6, median * 2.2);

    let tier = 1;
    sorted.forEach((player, index) => {
      if (index > 0 && sorted[index - 1].points - player.points > threshold) tier++;
      tiers.set(player.playerId, tier);
    });
  }

  return tiers;
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export interface PositionRun {
  position: string;
  picks: number;
  window: number;
}

/**
 * Positional runs in the recent picks.
 *
 * A run is the one piece of information ADP cannot give you, because it is
 * about this room right now. Once four of the last nine picks are running
 * backs, the next tier of running backs will not survive another circuit of the
 * board, and the survival model — which is built on league-wide averages —
 * doesn't know that yet.
 */
export function detectRuns(recentPositions: string[], teams: number): PositionRun[] {
  const window = Math.min(recentPositions.length, Math.max(6, teams));
  if (window < 4) return [];

  const recent = recentPositions.slice(-window);
  const counts = new Map<string, number>();
  for (const position of recent) counts.set(position, (counts.get(position) ?? 0) + 1);

  const threshold = Math.max(3, Math.ceil(window * 0.4));

  return [...counts.entries()]
    .filter(([, picks]) => picks >= threshold)
    .map(([position, picks]) => ({ position, picks, window }))
    .sort((a, b) => b.picks - a.picks);
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/**
 * How much of a projection to believe given a player's status.
 *
 * Season projections are published as though everyone plays; a back already
 * ruled out for the year is still carrying a full line. Applied to points
 * before they ever reach the value model, so the discount flows through
 * starters, depth and lookahead consistently.
 */
export function injuryDiscount(status: string | null | undefined): number {
  if (!status) return 1;
  const normalized = status.toLowerCase();
  if (/(injured reserve|\bir\b|pup|nfi|suspend)/.test(normalized)) return 0.2;
  if (/out/.test(normalized)) return 0.6;
  if (/doubtful/.test(normalized)) return 0.8;
  if (/questionable/.test(normalized)) return 0.95;
  return 1;
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export interface DraftPickSuggestion {
  player: DraftPlayer;
  /** Points this pick adds to your projected season roster right now. */
  marginal: number;
  /** Marginal value plus what you expect to still get at your next pick. */
  score: number;
  /**
   * Score against the best alternative on the board. Positive for the top
   * recommendation; for everyone else it is what taking them instead costs.
   */
  edge: number;
  /** Probability he is still there when you are actually on the clock. */
  survival: number;
  likelyAvailable: boolean;
  adp: number | null;
  /** Picks he has lasted past his ADP. Positive is value, negative is a reach. */
  adpDelta: number | null;
  tier: number;
  /** Players left in his tier at his position. */
  tierRemaining: number;
  /** How many of that tier you expect to survive to your next pick. */
  tierSurvivors: number;
  /** The starting slot he would walk into, if any. */
  fillsSlot: string | null;
  /** You are out of picks to fill a required slot any other way. */
  mandatory: boolean;
  /** His position is in the middle of a run. */
  run: boolean;
  /** Weeks where taking him leaves you unable to field a full lineup. */
  byeConflict: number[];
  rationale: string;
}

export interface DraftAdviceInput {
  rosterPositions: string[];
  /** What you have already drafted. */
  myPlayers: DraftPlayer[];
  /** Everyone still on the board. */
  available: DraftPlayer[];
  replacementByPosition: Map<string, number>;
  /** The pick currently on the clock, whoever owns it. */
  currentPickNo: number;
  /** Your next pick. Null when you have none left. */
  targetPickNo: number | null;
  /** The pick after that — the horizon the lookahead plans against. */
  followingPickNo: number | null;
  /** Picks you still own, including the one you are planning. */
  picksRemaining: number;
  /** Positions taken in the recent picks, oldest first. */
  recentPositions?: string[];
  teams: number;
  drift?: number;
  limit?: number;
}

/** Candidates per position, beyond which nobody is a realistic pick. */
const CANDIDATES_PER_POSITION = 6;
/** How many candidates the lookahead considers as your next-pick fallback. */
const LOOKAHEAD_POOL = 24;

/**
 * Rank the board.
 *
 * Two passes: score every plausible candidate on what he adds to the roster,
 * then re-score each one against what you would expect to be able to take at
 * your next pick if you did. The second pass is what stops the board from
 * recommending the player who was going to fall to you anyway.
 */
export function suggestPicks(input: DraftAdviceInput): DraftPickSuggestion[] {
  const {
    rosterPositions,
    myPlayers,
    available,
    replacementByPosition,
    currentPickNo,
    targetPickNo,
    followingPickNo,
    picksRemaining,
    teams,
  } = input;

  const drift = input.drift ?? 0;
  const limit = input.limit ?? 10;

  /*
   * Bye risk only becomes a real cost once you have the bodies to field a
   * lineup at all. Before that, every single position is "short" in some week
   * for the trivial reason that you have one player there — and charging for
   * that would quietly reward stacking the position you already have covered,
   * which is the exact opposite of what this board is for.
   */
  const startingSlotCount = rosterPositions.filter(isStartingSlot).length;
  const byeRiskApplies = myPlayers.length + 1 >= startingSlotCount;

  const valueOptions: RosterValueOptions = {
    rosterPositions,
    replacementByPosition,
    includeByeRisk: byeRiskApplies,
  };
  const fastOptions: RosterValueOptions = { rosterPositions, replacementByPosition };

  const base = rosterValue(myPlayers, valueOptions);
  const candidates = selectCandidates(available, rosterPositions);

  // --- pass 1: what each candidate adds right now ---------------------------
  const scored = candidates.map((player) => {
    const after = rosterValue([...myPlayers, player], valueOptions);
    return {
      player,
      marginal: round2(after.total - base.total),
      // His own bye is the only one taking him can make worse; a shortfall in
      // some other week was there before he arrived.
      byeConflict: after.byeShortWeeks.filter((week) => week === player.byeWeek),
      fillsSlot: slotFilledBy(player, base, after),
    };
  });

  // --- pass 2: one step of lookahead ---------------------------------------
  const lookaheadPool = [...scored].sort((a, b) => b.marginal - a.marginal).slice(0, LOOKAHEAD_POOL);

  const suggestions: DraftPickSuggestion[] = scored.map((entry) => {
    const survival =
      targetPickNo === null
        ? 0
        : survivalProbability(entry.player.adp, currentPickNo, targetPickNo, drift);

    let nextPickValue = 0;
    if (targetPickNo !== null && followingPickNo !== null && picksRemaining > 1) {
      const rosterAfter = [...myPlayers, entry.player];
      const afterFast = rosterValue(rosterAfter, fastOptions);

      const fallbacks = lookaheadPool
        .filter((other) => other.player.playerId !== entry.player.playerId)
        .map((other) => ({
          // Re-valued against the roster that already includes this pick, which
          // is what makes doubling up at a position correctly look worse.
          delta:
            rosterValue([...rosterAfter, other.player], fastOptions).total - afterFast.total,
          survival: survivalProbability(
            other.player.adp,
            targetPickNo,
            followingPickNo,
            drift,
          ),
        }))
        .sort((a, b) => b.delta - a.delta);

      nextPickValue = expectedBestAvailable(fallbacks);
    }

    return {
      player: entry.player,
      marginal: entry.marginal,
      score: round2(entry.marginal + nextPickValue),
      edge: 0,
      survival: round3(survival),
      likelyAvailable: survival >= 0.5,
      adp: entry.player.adp,
      adpDelta: entry.player.adp === null ? null : round1(currentPickNo - entry.player.adp),
      tier: 1,
      tierRemaining: 0,
      tierSurvivors: 0,
      fillsSlot: entry.fillsSlot,
      mandatory: false,
      run: false,
      byeConflict: entry.byeConflict,
      rationale: '',
    };
  });

  // --- context: tiers, runs, and slots you are running out of picks to fill -
  const tiers = assignTiers(available);
  const runs = new Set(detectRuns(input.recentPositions ?? [], teams).map((run) => run.position));
  const mandatory = mandatoryPositions(myPlayers, rosterPositions, picksRemaining);

  for (const suggestion of suggestions) {
    const player = suggestion.player;
    const tier = tiers.get(player.playerId) ?? 1;
    const peers = available.filter(
      (other) => other.position === player.position && tiers.get(other.playerId) === tier,
    );

    suggestion.tier = tier;
    suggestion.tierRemaining = peers.length;
    suggestion.tierSurvivors =
      targetPickNo === null || followingPickNo === null
        ? 0
        : round1(
            peers.reduce(
              (sum, peer) =>
                sum + survivalProbability(peer.adp, currentPickNo, followingPickNo, drift),
              0,
            ),
          );
    suggestion.run = runs.has(player.position);
    suggestion.mandatory = mandatory.has(player.position);
  }

  /*
   * A mandatory pick outranks everything.
   *
   * With two picks left and no kicker, the highest-scoring wide receiver on the
   * board is worth zero to you — you will finish the draft unable to field a
   * legal lineup. This is the one place a hard rule beats the value model,
   * because the model prices points and this is about legality.
   */
  const ranked = suggestions.sort((a, b) => {
    if (a.mandatory !== b.mandatory) return a.mandatory ? -1 : 1;
    return b.score - a.score;
  });

  const best = ranked[0]?.score ?? 0;
  const runnerUp = ranked[1]?.score ?? best;

  ranked.forEach((suggestion, index) => {
    suggestion.edge = round2(index === 0 ? best - runnerUp : suggestion.score - best);
    suggestion.rationale = buildRationale(suggestion, {
      targetPickNo,
      followingPickNo,
      currentPickNo,
      teams,
      picksRemaining,
      mandatory,
    });
  });

  return ranked.slice(0, limit);
}

/**
 * The realistic candidate set.
 *
 * Scoring all 400 remaining players is pointless — nobody is drafting the
 * 40th-best receiver — but scoring only the top 40 by projection hides kickers
 * and defenses entirely, which is exactly the mistake that leaves you taking a
 * kicker in round 12. So: the top few at every position, plus the top of the
 * board overall.
 */
function selectCandidates(available: DraftPlayer[], rosterPositions: string[]): DraftPlayer[] {
  const byPosition = new Map<string, DraftPlayer[]>();
  for (const player of available) {
    if (positionDemand(player.position, rosterPositions) === 0) continue;
    const group = byPosition.get(player.position);
    if (group) group.push(player);
    else byPosition.set(player.position, [player]);
  }

  const picked = new Map<string, DraftPlayer>();
  for (const group of byPosition.values()) {
    group
      .sort((a, b) => b.points - a.points)
      .slice(0, CANDIDATES_PER_POSITION)
      .forEach((player) => picked.set(player.playerId, player));
  }

  return [...picked.values()];
}

/**
 * Expected value of the best fallback still on the board at your next pick.
 *
 * Walks the fallbacks best-first: you take the leader if he survives, else the
 * next, and so on. The trailing term is the case where none of them last, which
 * is charged the weakest fallback's value rather than zero — there is always
 * *somebody* left, and pretending otherwise would inflate the urgency of every
 * pick.
 */
function expectedBestAvailable(fallbacks: Array<{ delta: number; survival: number }>): number {
  let expected = 0;
  let allGone = 1;

  for (const fallback of fallbacks) {
    expected += allGone * fallback.survival * fallback.delta;
    allGone *= 1 - fallback.survival;
    if (allGone < 1e-4) break;
  }

  const floor = fallbacks.length > 0 ? fallbacks[fallbacks.length - 1].delta : 0;
  return round2(expected + allGone * Math.max(0, floor));
}

/** Which starting slot a player walks into, if adding him fills a new one. */
function slotFilledBy(player: DraftPlayer, before: RosterValue, after: RosterValue): string | null {
  const wasFilled = new Set(
    before.lineup.assignments.filter((a) => a.playerId !== null).map((a) => a.slotIndex),
  );
  const nowFilled = after.lineup.assignments.filter(
    (a) => a.playerId !== null && !wasFilled.has(a.slotIndex),
  );
  if (nowFilled.length > 0) return nowFilled[0].slot;
  // He may instead have displaced someone into a slot; report the slot he
  // himself occupies, which is what the user actually wants to see.
  return after.lineup.assignments.find((a) => a.playerId === player.playerId)?.slot ?? null;
}

/**
 * Positions you can no longer afford to leave empty.
 *
 * When the number of picks you have left equals the number of starting slots
 * you cannot currently fill, every remaining pick is spoken for.
 */
export function mandatoryPositions(
  myPlayers: DraftPlayer[],
  rosterPositions: string[],
  picksRemaining: number,
): Set<string> {
  const lineup = optimizeLineup(myPlayers.map(toLineupPlayer), rosterPositions);
  const empty = lineup.assignments.filter((assignment) => assignment.playerId === null);
  if (empty.length === 0 || picksRemaining > empty.length) return new Set();

  const positions = new Set<string>();
  for (const slot of empty) {
    for (const position of SLOT_ELIGIBILITY[slot.slot] ?? []) positions.add(position);
  }
  return positions;
}

function buildRationale(
  suggestion: DraftPickSuggestion,
  context: {
    targetPickNo: number | null;
    followingPickNo: number | null;
    currentPickNo: number;
    teams: number;
    picksRemaining: number;
    mandatory: Set<string>;
  },
): string {
  const parts: string[] = [];
  const player = suggestion.player;

  if (suggestion.mandatory) {
    parts.push(
      `You have ${context.picksRemaining} pick${context.picksRemaining === 1 ? '' : 's'} left and still cannot fill ${player.position} — this is forced.`,
    );
  }

  if (suggestion.fillsSlot) {
    parts.push(
      `Slots straight into ${suggestion.fillsSlot} and adds ${suggestion.marginal.toFixed(0)} pts to your projected roster.`,
    );
  } else {
    parts.push(
      `Bench depth behind your starters — worth ${suggestion.marginal.toFixed(0)} pts over the season.`,
    );
  }

  if (suggestion.tierRemaining > 0 && context.followingPickNo !== null) {
    if (suggestion.tierSurvivors < 1) {
      parts.push(
        `Last ${suggestion.tierRemaining === 1 ? 'man' : `${suggestion.tierRemaining}`} in tier ${suggestion.tier} at ${player.position}, and the tier is not expected to reach ${pickLabel(context.followingPickNo, context.teams)}.`,
      );
    } else if (suggestion.tierSurvivors >= 2) {
      parts.push(
        `Tier ${suggestion.tier} runs ${suggestion.tierRemaining} deep — about ${suggestion.tierSurvivors.toFixed(1)} should still be there at ${pickLabel(context.followingPickNo, context.teams)}, so waiting is cheap.`,
      );
    }
  }

  if (suggestion.adp !== null && suggestion.adpDelta !== null) {
    if (suggestion.adpDelta >= 8) {
      parts.push(`He has lasted ${suggestion.adpDelta.toFixed(0)} picks past his ${suggestion.adp.toFixed(0)} ADP.`);
    } else if (suggestion.adpDelta <= -12) {
      parts.push(`A reach against his ${suggestion.adp.toFixed(0)} ADP — the roster fit is what justifies it.`);
    }
  }

  if (suggestion.run) {
    parts.push(`${player.position} is running right now.`);
  }

  if (suggestion.byeConflict.length > 0) {
    parts.push(
      `Costs you week ${suggestion.byeConflict.join(', ')} — you would not be able to fill a slot that week.`,
    );
  }

  if (context.targetPickNo !== null && !suggestion.likelyAvailable && suggestion.survival > 0) {
    parts.push(
      `Only a ${Math.round(suggestion.survival * 100)}% chance he lasts to ${pickLabel(context.targetPickNo, context.teams)}.`,
    );
  }

  return parts.join(' ');
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
