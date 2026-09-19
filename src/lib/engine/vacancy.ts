import type { PlayStatus } from './availability';

/**
 * Next man up.
 *
 * The one place this app can genuinely beat the projection feed, and it comes
 * from latency rather than from a better model. Rotowire prices a known
 * absence in when it publishes; what it cannot do is react at 11:40 on Sunday
 * when a back is scratched. Injury status now refreshes every hour and every
 * twenty minutes on gameday, so the app knows the starter is out well before
 * his backup's projection moves — and that gap is the edge.
 *
 * MEASURED, not assumed. scripts/vacancy-study.ts pools 2021-2025 nflverse
 * weekly actuals and compares the second-most-used player at a team/position
 * in weeks the lead man played against weeks he did not:
 *
 *   RB   6.04 -> 11.24 PPR   +5.20   t = 7.01   n = 142
 *   TE   3.69 ->  6.60 PPR   +2.91   t = 4.61   n =  80
 *   WR   8.84 ->  9.64 PPR   +0.80   t = 1.01   n =  84
 *
 * So RB and TE get a promotion multiplier and WR gets nothing. That is not a
 * hunch about target distribution — it is what five seasons say: carries
 * transfer almost one for one to a single back, while a missing receiver's
 * targets scatter across the whole formation and the defence re-allocates.
 */

/**
 * Promotion multiplier by position, as the ratio of the measured means.
 * Absent positions are deliberately absent: no evidence, no adjustment.
 */
export const PROMOTION_MULTIPLIERS: Record<string, number> = {
  // 11.24 / 6.04
  RB: 1.86,
  // 6.60 / 3.69
  TE: 1.79,
};

export interface VacancyCandidate {
  playerId: string;
  position: string;
  team: string | null;
  /** Projection before any availability haircut. */
  healthyPoints: number;
  /** False for ruled-out and bye players. */
  startable: boolean;
  playStatus: PlayStatus;
  /**
   * This player's projection as the week OPENED, league-scored. The feed moves
   * `healthyPoints` all week as news lands; the gap between the two is how
   * much of a role change it has already priced in. Null when we have no
   * history for the week yet.
   */
  openingPoints?: number | null;
  /** When that opening line was published. */
  openedAt?: Date | null;
  /** When this player's injury status last changed value. */
  statusChangedAt?: Date | null;
}

export interface Promotion {
  playerId: string;
  multiplier: number;
  /** The player whose absence created the opening. */
  vacatedBy: string;
  /** Ceiling: a promoted backup cannot out-project the man he replaced. */
  cappedPoints: number;
  /** Points the feed has ALREADY added since the week opened. */
  claimedByFeed: number;
  /** Points of the measured lift still unclaimed — what we actually add. */
  unclaimed: number;
  reason: string;
}

/**
 * Find the beneficiaries of an absence.
 *
 * Depth chart is inferred from projections rather than read from Sleeper's
 * `depth_chart_order`, which is frequently null and often stale. The most
 * heavily projected back on a team IS the lead back by definition of the
 * feed's own numbers, and that is the ordering we want to reason about.
 *
 * Only the immediate next man up is promoted. The third-string back does not
 * inherit a meaningful role when RB1 sits — the study measured the second-most
 * used player, and claiming more than was measured would be inventing signal.
 */
export function findPromotions(candidates: VacancyCandidate[]): Map<string, Promotion> {
  const byGroup = new Map<string, VacancyCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.team) continue;
    if (!(candidate.position in PROMOTION_MULTIPLIERS)) continue;
    const key = `${candidate.team}|${candidate.position}`;
    const list = byGroup.get(key);
    if (list) list.push(candidate);
    else byGroup.set(key, [candidate]);
  }

  const promotions = new Map<string, Promotion>();

  for (const group of byGroup.values()) {
    const ranked = [...group].sort((a, b) => b.healthyPoints - a.healthyPoints);
    const starter = ranked[0];
    const backup = ranked[1];
    if (!starter || !backup) continue;

    // Nobody is missing, or the whole team is off this week (a bye vacates
    // nothing — the backup is not playing either).
    if (starter.startable || starter.playStatus === 'bye') continue;
    if (!backup.startable) continue;

    // A lead man worth replacing. Without this, two barely-projected backs
    // trade a rounding error and one of them gets an 86% raise.
    if (starter.healthyPoints < MIN_STARTER_POINTS) continue;

    const multiplier = PROMOTION_MULTIPLIERS[backup.position];

    /*
     * How much of the lift has the feed already taken?
     *
     * Rotowire prices a known absence in when it publishes. Adding the full
     * measured multiplier on top of a line that already assumes the backup is
     * starting counts the same promotion twice and can hand a committee back a
     * number no projection supports. Only the unclaimed remainder is ours.
     */
    const opening = backup.openingPoints;

    // No history for the week yet — a fresh install, or the first sync of the
    // week. Fall back to the raw multiplier, which is the behaviour before
    // any of this existed, and say so in the reason.
    if (opening === null || opening === undefined || opening <= 0) {
      promotions.set(backup.playerId, {
        playerId: backup.playerId,
        multiplier,
        vacatedBy: starter.playerId,
        cappedPoints: starter.healthyPoints,
        claimedByFeed: 0,
        unclaimed: backup.healthyPoints * (multiplier - 1),
        reason: `Promoted: the ${backup.position} ahead of him is out, worth ${starter.healthyPoints.toFixed(1)}.`,
      });
      continue;
    }

    /*
     * The feed already knew.
     *
     * If the starter's status flipped BEFORE this week's line was published,
     * the opening line was written with the absence in hand — the backup is
     * already projected as the starter and there is nothing left to claim.
     * This is the long-term-injury case: a back on IR since October vacates
     * nothing new in December.
     */
    if (
      starter.statusChangedAt &&
      backup.openedAt &&
      starter.statusChangedAt.getTime() <= backup.openedAt.getTime()
    ) {
      continue;
    }

    /*
     * A third guard, for when the timestamps cannot settle it — a mid-week
     * install whose first captured line already postdates the news, so there
     * is no statusChangedAt to compare against.
     *
     * Whatever the clock says, a backup whose OPENING line already sits near
     * the starter's is a man the feed is already treating as the lead back.
     * There is no promotion left to hand him.
     */
    if (opening >= starter.healthyPoints * ALREADY_LEAD_SHARE) continue;

    const claimedByFeed = Math.max(0, backup.healthyPoints - opening);
    const expectedLift = opening * (multiplier - 1);
    const unclaimed = Math.max(0, expectedLift - claimedByFeed);

    // The feed has taken all of it (or more). Nothing to add, and saying
    // "promoted" over a zero-point adjustment would be noise.
    if (unclaimed <= 0) continue;

    promotions.set(backup.playerId, {
      playerId: backup.playerId,
      multiplier,
      vacatedBy: starter.playerId,
      // He steps into the role, he does not become better than it.
      cappedPoints: starter.healthyPoints,
      claimedByFeed: round2(claimedByFeed),
      unclaimed: round2(unclaimed),
      reason:
        claimedByFeed > 0.5
          ? `Promoted: the ${backup.position} ahead of him is out, worth ${starter.healthyPoints.toFixed(1)}. ` +
            `The feed has already moved him ${claimedByFeed.toFixed(1)}; this adds the remaining ${round2(unclaimed).toFixed(1)}.`
          : `Promoted: the ${backup.position} ahead of him is out, worth ${starter.healthyPoints.toFixed(1)}, ` +
            `and the feed has not moved his projection yet.`,
    });
  }

  return promotions;
}

/**
 * Points a promoted player is worth: his current projection plus only the part
 * of the measured lift the feed has not already applied, and never more than
 * the starter he is replacing.
 */
export function applyPromotion(healthyPoints: number, promotion: Promotion): number {
  const promoted = healthyPoints + promotion.unclaimed;
  return round2(Math.min(promoted, promotion.cappedPoints));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A starter must be projected for at least this much before his absence counts
 * as a vacancy worth reallocating.
 */
export const MIN_STARTER_POINTS = 6;

/**
 * Share of the starter's projection at which a backup's opening line is
 * already a lead-back line. At or above this the feed has plainly made the
 * swap itself, whatever the timestamps say.
 */
export const ALREADY_LEAD_SHARE = 0.75;
