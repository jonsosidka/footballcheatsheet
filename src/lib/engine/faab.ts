/**
 * Waiver acquisition cost.
 *
 * Sleeper runs two systems and they need completely different advice:
 *   waiver_type 1  -> FAAB blind bidding; the question is "how much"
 *   waiver_type 0/2 -> rolling priority / reverse standings; the question is
 *                      "is he worth burning my position"
 *
 * Your two leagues happen to use one of each, which is exactly why this can't
 * be a single hardcoded assumption.
 */

export type WaiverSystem = 'faab' | 'rolling' | 'reverse';

export function waiverSystem(waiverType: number | undefined): WaiverSystem {
  if (waiverType === 1) return 'faab';
  if (waiverType === 2) return 'reverse';
  return 'rolling';
}

export interface BidInput {
  /** Points this add gains over the incumbent, rest-of-season. */
  winNowDelta: number;
  /** Best rest-of-season total on the wire, as a scale reference. */
  topAvailablePoints: number;
  budgetTotal: number;
  budgetUsed: number;
  /** Weeks left in the fantasy regular season. */
  weeksRemaining: number;
  /** Sleeper community adds in 24h — a proxy for how contested he'll be. */
  trendingAdds: number;
  /** Covers a bye-week hole, which raises what he's genuinely worth. */
  coversBye: boolean;
}

export interface BidRecommendation {
  /** Percentage of the ORIGINAL budget. */
  percent: number;
  /** Dollars, given the league's budget size. */
  amount: number;
  /** Sensible spread to bid within. */
  low: number;
  high: number;
  remaining: number;
  rationale: string;
}

/** Never counsel spending the whole bank on one player. */
const MAX_SINGLE_BID_FRACTION = 0.45;

/**
 * Recommend a FAAB bid.
 *
 * Anchored on value relative to the best player available rather than on raw
 * points, because a 40-point-ROS add means something very different in week 2
 * than in week 12. Contested players (heavy trending adds) get a premium since
 * blind bidding rewards the winner, not the fair price.
 */
export function recommendBid(input: BidInput): BidRecommendation {
  const remaining = Math.max(0, input.budgetTotal - input.budgetUsed);

  if (remaining <= 0) {
    return {
      percent: 0,
      amount: 0,
      low: 0,
      high: 0,
      remaining: 0,
      rationale: 'No FAAB left — this one has to come through free agency or a trade.',
    };
  }

  // Value relative to the best thing on the wire, clamped to [0,1].
  const reference = Math.max(1, input.topAvailablePoints);
  const relative = Math.max(0, Math.min(1, input.winNowDelta / reference));

  // Late-season adds are worth less: fewer weeks to pay you back.
  const seasonFactor = Math.max(0.35, Math.min(1, input.weeksRemaining / 12));

  // Contested premium — blind bidding means the price is set by demand.
  const contested = input.trendingAdds > 30_000 ? 1.35 : input.trendingAdds > 8_000 ? 1.15 : 1;

  const byeFactor = input.coversBye ? 1.2 : 1;

  const rawPercent = relative * 40 * seasonFactor * contested * byeFactor;
  const capPercent = MAX_SINGLE_BID_FRACTION * 100;
  const percent = Math.max(0, Math.min(capPercent, Math.round(rawPercent)));

  // Bid against what's LEFT, not the original budget.
  const amount = Math.max(percent > 0 ? 1 : 0, Math.round((percent / 100) * input.budgetTotal));
  const capped = Math.min(amount, remaining);

  const low = Math.max(percent > 0 ? 1 : 0, Math.round(capped * 0.7));
  const high = Math.min(remaining, Math.round(capped * 1.35));

  const reasons: string[] = [];
  if (contested > 1.2) reasons.push('heavily contested');
  else if (contested > 1) reasons.push('drawing interest');
  if (input.coversBye) reasons.push('fills a bye-week hole');
  if (seasonFactor < 0.6) reasons.push('limited weeks left to pay off');

  return {
    percent,
    amount: capped,
    low,
    high,
    remaining,
    rationale:
      capped === 0
        ? 'Not worth a bid — claim him only if he clears to free agency.'
        : `Bid ${low}-${high} of your ${remaining} remaining` +
          (reasons.length > 0 ? ` (${reasons.join(', ')}).` : '.'),
  };
}

export interface PriorityAdvice {
  worthBurning: boolean;
  rationale: string;
}

/**
 * For rolling/reverse-priority leagues, the cost isn't money — it's dropping to
 * the back of the queue. Only a genuine starter upgrade justifies that.
 */
export function evaluatePriorityClaim(input: {
  winNowDelta: number;
  waiverPosition: number | null;
  totalTeams: number;
  coversBye: boolean;
  system: WaiverSystem;
}): PriorityAdvice {
  const { winNowDelta, waiverPosition, totalTeams, coversBye } = input;

  // Near the front of the queue, the claim is cheap to make but expensive to
  // waste; near the back it costs almost nothing to try.
  const nearFront = waiverPosition !== null && waiverPosition <= Math.ceil(totalTeams / 3);

  const meaningful = winNowDelta >= 15 || coversBye;

  if (!meaningful) {
    return {
      worthBurning: false,
      rationale: nearFront
        ? `Not worth waiver position ${waiverPosition} — wait for him to clear.`
        : 'Marginal, but your waiver position is low enough that a claim costs little.',
    };
  }

  return {
    worthBurning: true,
    rationale: nearFront
      ? `Worth using waiver position ${waiverPosition}${coversBye ? ' — and he fills a bye-week hole' : ''}.`
      : `Worth claiming${waiverPosition !== null ? ` from position ${waiverPosition}` : ''}${
          coversBye ? '; also fills a bye-week hole' : ''
        }.`,
  };
}
