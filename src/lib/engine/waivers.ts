import { scoreMove, adjustedDynastyValue, type AssetValue, type DualScore, type Posture, type Trajectory } from './value';
import { coversByeGaps, type ByeGap } from './byes';

/**
 * Waiver-wire add/drop recommendations.
 *
 * Every suggestion is a *pair* — an add and the specific player it costs you —
 * because "add this guy" is useless advice on a full roster. Each pair carries
 * both a win-now and a future delta, so a rebuilding team never gets told to
 * cut a 22-year-old for a one-week streamer.
 */

export interface WaiverCandidate {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  age: number | null;
  /** Rest-of-season league-scored points. */
  rosPoints: number;
  /** This week's league-scored projection. */
  weekPoints: number;
  dynastyValue: number | null;
  trend30Day: number | null;
  /** Sleeper community adds in the last 24h — a crowd signal, not a projection. */
  trendingAdds: number;
  injuryStatus: string | null;
}

export interface PositionalNeed {
  position: string;
  /** Starting slots that can be filled by this position. */
  startingDemand: number;
  /** Rostered players at this position with a usable projection. */
  rosteredCount: number;
  /** Points from our current best starter-quality player here. */
  incumbentPoints: number;
  /** The same marginal starter's projection for THIS week. */
  incumbentWeekPoints: number;
  /** Replacement level: what a freely-available player at this position gives. */
  replacementPoints: number;
  /** 0-1; higher means a real gap. */
  needScore: number;
}

export interface WaiverSuggestion {
  add: WaiverCandidate;
  drop: WaiverCandidate | null;
  /** Points over the player they'd replace in your starting lineup. */
  vor: number;
  /**
   * Points he adds to THIS week's lineup over the man he'd replace. Positive
   * for a streamer who is worth starting right now even if he is nobody's
   * rest-of-season upgrade.
   */
  streamDelta: number;
  score: DualScore;
  needScore: number;
  rationale: string;
  /** Roster is full and nothing on it is worth cutting — a trade target, not a claim. */
  blocked: boolean;
  /** Upcoming bye weeks this player would cover. */
  coversByeWeeks: number[];
}

const IDP_POSITIONS = ['DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S'];

/**
 * Weekly points a free agent must add over your marginal starter before he is
 * worth a roster move. Below this it is churn: you pay a claim and a drop for
 * noise well inside the error bar of any projection.
 */
export const STREAM_THRESHOLD = 2;

/**
 * Rest-of-season points a free agent must add over your marginal starter to
 * count as an upgrade. A season projection is far noisier than a weekly one,
 * so a one-point edge is a coin flip that costs a claim and a cut — churn, not
 * an improvement.
 */
export const ROS_UPGRADE_THRESHOLD = 5;

/**
 * How much a point of this-week upgrade is worth against a point of
 * rest-of-season upgrade. A rental is real value but it is temporary, so it
 * ranks below a permanent improvement of the same size.
 */
export const STREAM_RANK_WEIGHT = 0.35;

/**
 * Share of a bench player's edge over the wire that counts as keep value. A
 * backup is insurance, not production: he only scores when a starter misses,
 * so cutting him costs a fraction of what his season total suggests.
 */
export const BENCH_DEPTH_WEIGHT = 0.25;

/**
 * Age-adjusted dynasty value above which a player is never offered up as a
 * cut for a lesser asset. Below it, the market is saying he is roster filler,
 * and filler is exactly what a waiver claim should cost.
 */
export const DYNASTY_PROTECT_FLOOR = 1000;

/**
 * Collapse positions that compete for the exact same slots into one group.
 *
 * A league whose only defensive slots are IDP_FLEX does not need a starting
 * DB *and* a starting DL *and* a starting LB — it needs two defenders of any
 * kind. Scoring those positions separately made a roster carrying four
 * linebackers look desperately short at DB, DL, CB and S simultaneously, and
 * buried the waiver board in defenders. Leagues with dedicated DL/LB/DB slots
 * keep them separate, because there the distinction is real.
 */
export function needGroupOf(position: string, rosterPositions: string[]): string {
  if (!IDP_POSITIONS.includes(position)) return position;
  const hasDedicatedIdpSlots = rosterPositions.some((slot) => ['DL', 'LB', 'DB'].includes(slot));
  return hasDedicatedIdpSlots ? position : 'IDP';
}

/** How many roster spots a league realistically devotes to a need group. */
function startingDemandFor(group: string, rosterPositions: string[]): number {
  if (group === 'IDP') {
    // IDP_FLEX slots are the whole demand, and they are not shared with
    // offensive positions, so they count in full rather than fractionally.
    return rosterPositions.filter((slot) => slot === 'IDP_FLEX').length;
  }

  const direct = rosterPositions.filter((slot) => slot === group).length;
  const flexEligible = rosterPositions.filter((slot) => {
    if (slot === 'FLEX' || slot === 'WRRB_WRT') return ['RB', 'WR', 'TE'].includes(group);
    if (slot === 'WRRB_FLEX') return ['RB', 'WR'].includes(group);
    if (slot === 'REC_FLEX') return ['WR', 'TE'].includes(group);
    if (slot === 'SUPER_FLEX' || slot === 'SUPERFLEX' || slot === 'QB_FLEX')
      return ['QB', 'RB', 'WR', 'TE'].includes(group);
    if (slot === 'IDP_FLEX') return IDP_POSITIONS.includes(group);
    return false;
  }).length;

  // Flex slots are shared across positions, so they count fractionally.
  return direct + flexEligible * 0.4;
}

/**
 * Replacement level: the value of the best player you could add for free.
 *
 * Using the top free agent rather than a fixed rank means replacement level
 * reflects this league's actual scarcity — in a 14-team league with deep
 * benches the wire is barren and replacement level is genuinely low, which is
 * exactly when a marginal add matters most.
 */
export function computeNeeds(
  rosterPositions: string[],
  myPlayers: Array<{ position: string; rosPoints: number; weekPoints?: number }>,
  freeAgents: WaiverCandidate[],
): Map<string, PositionalNeed> {
  const groups = new Set([
    ...myPlayers.map((p) => needGroupOf(p.position, rosterPositions)),
    ...freeAgents.map((p) => needGroupOf(p.position, rosterPositions)),
  ]);

  const needs = new Map<string, PositionalNeed>();

  for (const position of groups) {
    const startingDemand = startingDemandFor(position, rosterPositions);
    if (startingDemand === 0) continue;

    const minePlayers = myPlayers.filter(
      (p) => needGroupOf(p.position, rosterPositions) === position,
    );
    const mine = minePlayers.map((p) => p.rosPoints).sort((a, b) => b - a);
    const mineWeek = minePlayers.map((p) => p.weekPoints ?? 0).sort((a, b) => b - a);

    const available = freeAgents
      .filter((p) => needGroupOf(p.position, rosterPositions) === position)
      .map((p) => p.rosPoints)
      .sort((a, b) => b - a);

    const replacementPoints = available[0] ?? 0;

    // The incumbent that a new add would actually displace: the weakest player
    // we currently rely on to fill this position's starting demand.
    const slotsNeeded = Math.ceil(startingDemand);
    const incumbentPoints = mine.length >= slotsNeeded ? mine[slotsNeeded - 1] : 0;
    // The weekly equivalent: what the man holding the last starting slot is
    // actually projected for on Sunday. An injured or bye-week starter lands
    // at zero here, which is precisely when a streamer is worth claiming.
    const incumbentWeekPoints = mineWeek.length >= slotsNeeded ? mineWeek[slotsNeeded - 1] : 0;

    // Need rises when we're short bodies or when our marginal starter is
    // barely better than what's sitting on the wire.
    const shortfall = Math.max(0, slotsNeeded - mine.length) / Math.max(1, slotsNeeded);
    const thinness =
      incumbentPoints > 0 ? Math.max(0, 1 - (incumbentPoints - replacementPoints) / Math.max(1, incumbentPoints)) : 1;

    needs.set(position, {
      position,
      startingDemand,
      rosteredCount: mine.length,
      incumbentPoints,
      incumbentWeekPoints,
      replacementPoints,
      needScore: Math.min(1, 0.6 * shortfall + 0.4 * thinness),
    });
  }

  return needs;
}

export interface WaiverInput {
  rosterPositions: string[];
  freeAgents: WaiverCandidate[];
  myRoster: WaiverCandidate[];
  posture: Posture;
  isDynasty: boolean;
  /** Whether the roster is getting younger or older relative to the league. */
  trajectory?: Trajectory;
  /** Upcoming weeks where byes leave the lineup short. */
  byeGaps?: ByeGap[];
  /** team -> bye week. */
  byeWeeks?: Map<string, number>;
  /** Open active roster spots; 0 means every add requires a drop. */
  openSlots: number;
  /**
   * Rostered players whose release would not open an active spot (taxi, IR),
   * so they can never be the drop that pays for a claim.
   */
  undroppableIds?: Set<string>;
  limit?: number;
}

/**
 * Rank the wire.
 *
 * Ordering is by the posture-weighted combined score, not raw points — that's
 * what makes the same wire produce different advice for a contender than for a
 * rebuilder without maintaining two code paths.
 */
export function rankWaiverTargets(input: WaiverInput): WaiverSuggestion[] {
  const { freeAgents, myRoster, rosterPositions, posture, isDynasty, openSlots } = input;
  const trajectory = input.trajectory ?? 'stable';
  const byeGaps = input.byeGaps ?? [];
  const byeWeeks = input.byeWeeks ?? new Map<string, number>();
  const limit = input.limit ?? 12;

  const needs = computeNeeds(rosterPositions, myRoster, freeAgents);

  /*
   * Drop candidates: what each rostered player is worth KEEPING, on the same
   * scale an add is judged on — points this roster would lose without him,
   * plus his asset value under the current posture.
   *
   * This used to rank drops by their raw season total while adds were ranked
   * by their gain over the incumbent. A 60-point bench back then "outranked" a
   * +25 upgrade, so no full roster (which is every roster by week 2) could ever
   * find a cut and the whole board fell into the blocked pile.
   *
   * Scored per add, because who fills the hole depends on who is coming in:
   * cutting your only kicker is free when the add IS a kicker, and a disaster
   * when he is a linebacker.
   */
  const undroppable = input.undroppableIds ?? new Set<string>();
  const dropPoolFor = (add: WaiverCandidate) => {
    const after = [...myRoster, add];
    return myRoster
      .filter((player) => !undroppable.has(player.playerId) && player.playerId !== add.playerId)
      .map((player) => ({
        player,
        rank: scoreMove({
          winNowDelta: lossIfCut(player, after, needs, rosterPositions),
          gaining: [assetOf(player)],
          losing: [],
          posture,
          isDynasty,
          trajectory,
        }).combined,
      }))
      // Ties (plenty of bench bodies are worth ~nothing) go to the lower scorer.
      .sort((a, b) => a.rank - b.rank || a.player.rosPoints - b.player.rosPoints);
  };

  const scored: Array<{
    suggestion: Omit<WaiverSuggestion, 'drop' | 'rationale' | 'blocked' | 'coversByeWeeks'>;
    need: PositionalNeed;
    overIncumbent: number;
    coversByeWeeks: number[];
  }> = [];

  for (const candidate of freeAgents) {
    const group = needGroupOf(candidate.position, rosterPositions);
    const need = needs.get(group);
    if (!need) continue; // position this league never starts

    const vor = candidate.rosPoints - need.replacementPoints;
    const overIncumbent = candidate.rosPoints - need.incumbentPoints;
    const streamDelta = candidate.weekPoints - need.incumbentWeekPoints;

    /*
     * Three ways onto the board, not one.
     *
     * Rest-of-season upgrade was the only route, which made the wire look dead
     * from about week 3 onward: no free agent's remaining season beats a
     * rostered starter's, so nothing qualified and the board sat empty in
     * exactly the leagues that live on streaming. A player who beats your
     * marginal starter THIS WEEK is a real, actionable move even when his
     * season total never catches up — that is what streaming is.
     */
    const isUpgrade = overIncumbent >= ROS_UPGRADE_THRESHOLD;
    const isStream = streamDelta >= STREAM_THRESHOLD && candidate.weekPoints > 0;
    const isAssetGrab = isDynasty && (candidate.dynastyValue ?? 0) > 500;
    if (!isUpgrade && !isStream && !isAssetGrab) continue;

    const coversByeWeeks = coversByeGaps(
      { position: candidate.position, team: candidate.team },
      byeGaps,
      byeWeeks,
    );

    scored.push({
      coversByeWeeks,
      suggestion: {
        add: candidate,
        vor: round2(vor),
        streamDelta: round2(streamDelta),
        score: scoreMove({
          winNowDelta: isUpgrade ? overIncumbent : 0,
          gaining: [assetOf(candidate)],
          losing: [],
          posture,
          isDynasty,
          trajectory,
        }),
        needScore: need.needScore,
      },
      need,
      overIncumbent,
    });
  }

  /*
   * Ranking folds in four multipliers beyond raw value:
   *   need      — an equal-value add at a thin position is worth more
   *   bye       — solving a week you literally cannot field a lineup is worth
   *               more than a marginal points upgrade
   *   urgency   — heavy community adds mean he won't be there tomorrow
   *   stream    — points he adds to the lineup you are setting right now
   *
   * The stream term is added rather than multiplied because a pure streamer
   * has a combined score of zero: multiplying would leave him at zero forever
   * and he would never appear. Weighted below a season-long upgrade, since a
   * one-week rental is worth less than a permanent one.
   */
  const rankOf = (entry: (typeof scored)[number]) => {
    const need = 0.7 + 0.6 * entry.suggestion.needScore;
    const bye = 1 + Math.min(0.5, entry.coversByeWeeks.length * 0.25);
    const urgency = entry.suggestion.add.trendingAdds > 20_000 ? 1.1 : 1;
    const stream = Math.max(0, entry.suggestion.streamDelta) * STREAM_RANK_WEIGHT;
    return (entry.suggestion.score.combined + stream) * need * bye * urgency;
  };

  const ranked = scored.sort((a, b) => rankOf(b) - rankOf(a)).slice(0, limit);

  /*
   * Assign a DISTINCT drop to each suggestion, worst player first.
   *
   * Pairing every add with the same single worst player is technically correct
   * and practically useless — it reads as one repeated row rather than a menu
   * of independent moves. Walking down the drop pool makes each line a move you
   * could make on its own.
   *
   * The hard guard: never propose dropping someone the engine values MORE than
   * the player being added. Without it, rotating past the genuinely cuttable
   * players starts handing out good young assets as cuts once the bad options
   * run out. When nothing is safely droppable the suggestion carries no drop
   * and says so, rather than inventing a bad one.
   */
  const used = new Set<string>();

  return ranked.map(({ suggestion, need, overIncumbent, coversByeWeeks }) => {
    let drop: WaiverCandidate | null = null;

    if (openSlots <= 0) {
      // What the add is worth on the same scale as the drop pool: his lineup
      // gain, his asset value, and the rental value of starting him this week.
      const addRank =
        scoreMove({
          winNowDelta: suggestion.score.winNowDelta,
          gaining: [assetOf(suggestion.add)],
          losing: [],
          posture,
          isDynasty,
          trajectory,
        }).combined +
        Math.max(0, suggestion.streamDelta) * STREAM_RANK_WEIGHT;

      const addValue = isDynasty ? adjustedDynastyValue(assetOf(suggestion.add)) : 0;

      drop =
        dropPoolFor(suggestion.add).find((d) => {
          if (used.has(d.player.playerId)) return false;
          if (d.rank >= addRank) return false;
          // In dynasty, never cut a real asset for a lesser one. Scores alone
          // are not enough: a big points add outranks any bench stash, and
          // without this the rotation eventually offers up a valuable young
          // player. Filler under the floor is fair game — otherwise an add
          // the market does not price at all (IDP, kickers) could never cost
          // anyone who carries even a token value.
          if (isDynasty && adjustedDynastyValue(assetOf(d.player)) > Math.max(addValue, DYNASTY_PROTECT_FLOOR)) {
            return false;
          }
          return true;
        })?.player ?? null;

      if (drop) used.add(drop.playerId);
    }

    const score = scoreMove({
      winNowDelta: suggestion.score.winNowDelta,
      gaining: [assetOf(suggestion.add)],
      losing: drop ? [assetOf(drop)] : [],
      posture,
      isDynasty,
      trajectory,
    });

    return {
      ...suggestion,
      drop,
      score,
      blocked: openSlots <= 0 && drop === null,
      coversByeWeeks,
      rationale: buildRationale(
        suggestion.add,
        drop,
        need,
        overIncumbent,
        suggestion.streamDelta,
        posture,
        isDynasty,
        openSlots > 0,
        coversByeWeeks,
      ),
    };
  });
}

/**
 * Split the board into moves you can make right now and ones blocked by a full
 * roster with nothing worth cutting.
 *
 * Blocked moves are still worth seeing — they're trade targets — but they must
 * not outrank actionable ones, or the board fills with rows you cannot act on.
 */
export function partitionSuggestions(suggestions: WaiverSuggestion[]): {
  actionable: WaiverSuggestion[];
  blocked: WaiverSuggestion[];
} {
  return {
    actionable: suggestions.filter((s) => !s.blocked),
    blocked: suggestions.filter((s) => s.blocked),
  };
}

/**
 * Rest-of-season lineup points lost if this player were released, plus the
 * rental value of his start this week. `roster` is the roster AFTER the add,
 * so an add at the same position is the one who steps in.
 *
 * A starter costs the gap to whoever on the roster moves up. Not the best free
 * agent: picking him up is a second claim needing a second cut, so it cannot
 * be what pays for this one. A backup costs a fraction of his edge over the
 * wire. A second defense or a spare kicker is worth nothing, which is what
 * makes him the natural cut.
 */
function lossIfCut(
  player: WaiverCandidate,
  roster: WaiverCandidate[],
  needs: Map<string, PositionalNeed>,
  rosterPositions: string[],
): number {
  const group = needGroupOf(player.position, rosterPositions);
  const need = needs.get(group);
  if (!need) return 0; // a position this league never starts

  const slots = Math.ceil(need.startingDemand);
  const others = roster.filter(
    (p) => p.playerId !== player.playerId && needGroupOf(p.position, rosterPositions) === group,
  );

  const gapTo = (key: 'rosPoints' | 'weekPoints') => {
    const ahead = others.filter((p) => p[key] > player[key]).length;
    if (ahead >= slots) return null; // not a starter on this measure
    const stepIn = others.map((p) => p[key]).sort((a, b) => b - a)[slots - 1] ?? 0;
    return Math.max(0, player[key] - stepIn);
  };

  const rosLoss =
    gapTo('rosPoints') ?? BENCH_DEPTH_WEIGHT * Math.max(0, player.rosPoints - need.replacementPoints);
  const weekLoss = gapTo('weekPoints') ?? 0;

  return rosLoss + weekLoss * STREAM_RANK_WEIGHT;
}

function assetOf(candidate: WaiverCandidate): AssetValue {
  return {
    playerId: candidate.playerId,
    position: candidate.position,
    age: candidate.age,
    dynastyValue: candidate.dynastyValue ?? 0,
    redraftValue: 0,
  };
}

function buildRationale(
  add: WaiverCandidate,
  drop: WaiverCandidate | null,
  need: PositionalNeed,
  overIncumbent: number,
  streamDelta: number,
  posture: Posture,
  isDynasty: boolean,
  openRosterSpot: boolean,
  coversByeWeeks: number[] = [],
): string {
  const parts: string[] = [];

  if (overIncumbent >= ROS_UPGRADE_THRESHOLD) {
    const label = need.position === 'IDP' ? 'weakest defensive starter' : `weakest starting ${need.position}`;
    parts.push(
      need.rosteredCount >= Math.ceil(need.startingDemand)
        ? `Projects ${overIncumbent.toFixed(1)} pts above your ${label} over the rest of the season.`
        : `You are short at ${need.position === 'IDP' ? 'IDP' : need.position} — he fills an empty starting slot for ${add.rosPoints.toFixed(0)} pts.`,
    );
  } else if (streamDelta >= STREAM_THRESHOLD) {
    parts.push(
      `Start him this week: ${add.weekPoints.toFixed(1)} projected against ${need.incumbentWeekPoints.toFixed(1)} from the man he replaces` +
        `${need.incumbentWeekPoints === 0 ? ', who is not playing' : ''}. A rental, not a season-long upgrade.`,
    );
  } else if (isDynasty) {
    parts.push(`Not a starter now, but a real long-term asset at ${add.age ?? '?'}.`);
  }

  if (overIncumbent >= ROS_UPGRADE_THRESHOLD && streamDelta >= STREAM_THRESHOLD) {
    parts.push(`He also starts for you this week, worth +${streamDelta.toFixed(1)}.`);
  }

  if (coversByeWeeks.length > 0) {
    const weeks = coversByeWeeks.slice(0, 3).join(', ');
    parts.push(
      `Covers your week ${weeks} bye ${coversByeWeeks.length > 1 ? 'gaps' : 'gap'} — you are short a starter there.`,
    );
  }

  if (need.needScore > 0.5) {
    parts.push(`${need.position} is your thinnest position.`);
  }

  if (add.trendingAdds > 5000) {
    parts.push(`${add.trendingAdds.toLocaleString()} adds league-wide in 24h — he won't last.`);
  }

  if (drop) {
    parts.push(
      isDynasty && posture === 'rebuild'
        ? `Costs you ${drop.name}, who is the least valuable piece of your rebuild.`
        : `Costs you ${drop.name}.`,
    );
  } else {
    parts.push(
      openRosterSpot
        ? 'You have an open roster spot, so this costs nothing.'
        : 'Roster is full and nothing on it is worth cutting for him — this needs a trade, not a claim.',
    );
  }

  return parts.join(' ');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
