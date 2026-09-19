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
}

export interface Promotion {
  playerId: string;
  multiplier: number;
  /** The player whose absence created the opening. */
  vacatedBy: string;
  /** Ceiling: a promoted backup cannot out-project the man he replaced. */
  cappedPoints: number;
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
    promotions.set(backup.playerId, {
      playerId: backup.playerId,
      multiplier,
      vacatedBy: starter.playerId,
      // He steps into the role, he does not become better than it.
      cappedPoints: starter.healthyPoints,
      reason: `Promoted: the ${backup.position} ahead of him is out, worth ${starter.healthyPoints.toFixed(1)}.`,
    });
  }

  return promotions;
}

/**
 * Points a promoted player is worth: his own projection scaled by the measured
 * multiplier, but never more than the starter he is replacing.
 */
export function applyPromotion(healthyPoints: number, promotion: Promotion): number {
  const promoted = healthyPoints * promotion.multiplier;
  return Math.round(Math.min(promoted, promotion.cappedPoints) * 100) / 100;
}

/**
 * A starter must be projected for at least this much before his absence counts
 * as a vacancy worth reallocating.
 */
export const MIN_STARTER_POINTS = 6;
