import { scoreMove, adjustedDynastyValue, type AssetValue, type DualScore, type Posture, type Trajectory } from './value';

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
  score: DualScore;
  needScore: number;
  rationale: string;
  /** Roster is full and nothing on it is worth cutting — a trade target, not a claim. */
  blocked: boolean;
}

const IDP_POSITIONS = ['DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S'];

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
  myPlayers: Array<{ position: string; rosPoints: number }>,
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

    const mine = myPlayers
      .filter((p) => needGroupOf(p.position, rosterPositions) === position)
      .map((p) => p.rosPoints)
      .sort((a, b) => b - a);

    const available = freeAgents
      .filter((p) => needGroupOf(p.position, rosterPositions) === position)
      .map((p) => p.rosPoints)
      .sort((a, b) => b - a);

    const replacementPoints = available[0] ?? 0;

    // The incumbent that a new add would actually displace: the weakest player
    // we currently rely on to fill this position's starting demand.
    const slotsNeeded = Math.ceil(startingDemand);
    const incumbentPoints = mine.length >= slotsNeeded ? mine[slotsNeeded - 1] : 0;

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
  /** Open active roster spots; 0 means every add requires a drop. */
  openSlots: number;
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
  const limit = input.limit ?? 12;

  const needs = computeNeeds(rosterPositions, myRoster, freeAgents);

  // Drop candidates: our least valuable players under the current posture.
  const dropPool = [...myRoster]
    .map((player) => ({
      player,
      // Rank drop candidates the same way we rank adds, so a rebuilding team
      // protects youth and a contender protects production.
      rank: scoreMove({
        winNowDelta: player.rosPoints,
        gaining: [assetOf(player)],
        losing: [],
        posture,
        isDynasty,
        trajectory,
      }).combined,
    }))
    .sort((a, b) => a.rank - b.rank);

  const scored: Array<{ suggestion: Omit<WaiverSuggestion, 'drop' | 'rationale' | 'blocked'>; need: PositionalNeed; overIncumbent: number }> = [];

  for (const candidate of freeAgents) {
    const group = needGroupOf(candidate.position, rosterPositions);
    const need = needs.get(group);
    if (!need) continue; // position this league never starts

    const vor = candidate.rosPoints - need.replacementPoints;
    const overIncumbent = candidate.rosPoints - need.incumbentPoints;

    // Only worth surfacing if it improves the starting lineup or is a genuine
    // dynasty asset grab.
    const isUpgrade = overIncumbent > 0;
    const isAssetGrab = isDynasty && (candidate.dynastyValue ?? 0) > 500;
    if (!isUpgrade && !isAssetGrab) continue;

    scored.push({
      suggestion: {
        add: candidate,
        vor: round2(vor),
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

  const ranked = scored
    .sort((a, b) => {
      // Weight by positional need so an equal-value add at a thin position wins.
      const aRank = a.suggestion.score.combined * (0.7 + 0.6 * a.suggestion.needScore);
      const bRank = b.suggestion.score.combined * (0.7 + 0.6 * b.suggestion.needScore);
      return bRank - aRank;
    })
    .slice(0, limit);

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

  return ranked.map(({ suggestion, need, overIncumbent }) => {
    let drop: WaiverCandidate | null = null;

    if (openSlots <= 0) {
      const addRank = scoreMove({
        winNowDelta: suggestion.score.winNowDelta,
        gaining: [assetOf(suggestion.add)],
        losing: [],
        posture,
        isDynasty,
        trajectory,
      }).combined;

      const addValue = isDynasty ? adjustedDynastyValue(assetOf(suggestion.add)) : 0;

      drop =
        dropPool.find((d) => {
          if (used.has(d.player.playerId)) return false;
          if (d.player.playerId === suggestion.add.playerId) return false;
          if (d.rank >= addRank) return false;
          // In dynasty, never cut an asset the market values above the one
          // being claimed. Comparing total move scores isn't enough on its own:
          // a high-points add outranks any bench stash, so without this the
          // rotation eventually offers up a genuinely valuable young player.
          if (isDynasty && adjustedDynastyValue(assetOf(d.player)) > addValue) return false;
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
      rationale: buildRationale(suggestion.add, drop, need, overIncumbent, posture, isDynasty, openSlots > 0),
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
  posture: Posture,
  isDynasty: boolean,
  openRosterSpot: boolean,
): string {
  const parts: string[] = [];

  if (overIncumbent > 0) {
    const label = need.position === 'IDP' ? 'weakest defensive starter' : `weakest starting ${need.position}`;
    parts.push(
      need.rosteredCount >= Math.ceil(need.startingDemand)
        ? `Projects ${overIncumbent.toFixed(1)} pts above your ${label} over the rest of the season.`
        : `You are short at ${need.position === 'IDP' ? 'IDP' : need.position} — he fills an empty starting slot for ${add.rosPoints.toFixed(0)} pts.`,
    );
  } else if (isDynasty) {
    parts.push(`Not a starter now, but a real long-term asset at ${add.age ?? '?'}.`);
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
