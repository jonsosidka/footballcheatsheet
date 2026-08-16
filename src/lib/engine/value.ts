/**
 * The dual-score spine.
 *
 * Every recommendation this app makes — start/sit, add/drop, trade — carries
 * two numbers rather than one:
 *
 *   winNowDelta  rest-of-season points added to the starting lineup
 *   futureDelta  change in long-term asset value, age-adjusted
 *
 * A single blended number would hide the tradeoff that actually matters in
 * dynasty. Keeping them separate means the UI can show "this costs you 0.4
 * points a week and gains you a 22-year-old WR2", and the weighting between
 * them is set by whether you're actually contending — not by a guess.
 */

export type Posture = 'contend' | 'bubble' | 'rebuild';

export interface DualScore {
  winNowDelta: number;
  futureDelta: number;
  /** Single number for ranking, weighted by posture. */
  combined: number;
}

// ---------------------------------------------------------------------------
// Age curves
// ---------------------------------------------------------------------------

/**
 * Age at which production typically starts declining, by position, and how
 * steeply. RBs fall off a cliff; QBs decline gently and late.
 *
 * These shape `futureDelta` so a 28-year-old RB and a 23-year-old RB with
 * identical market value are not treated as identical assets. Market value
 * already prices age in substantially — this is a secondary adjustment, which
 * is why the multipliers are modest rather than dramatic.
 */
export const AGE_CURVES: Record<string, { peak: number; cliff: number; decayPerYear: number }> = {
  RB: { peak: 24, cliff: 27, decayPerYear: 0.13 },
  WR: { peak: 26, cliff: 29, decayPerYear: 0.08 },
  TE: { peak: 27, cliff: 30, decayPerYear: 0.07 },
  QB: { peak: 28, cliff: 34, decayPerYear: 0.05 },
  K: { peak: 28, cliff: 36, decayPerYear: 0.02 },
  DEF: { peak: 28, cliff: 99, decayPerYear: 0 },
};

/**
 * Multiplier on a player's dynasty value reflecting where he sits on his
 * position's aging curve. 1.0 at or before peak, declining past the cliff.
 *
 * Young players get a modest premium because dynasty value compounds: a 22
 * year old has more productive seasons ahead than the market's point-in-time
 * value fully reflects.
 */
export function ageMultiplier(position: string, age: number | null): number {
  if (age === null || !Number.isFinite(age)) return 1;
  const curve = AGE_CURVES[position];
  if (!curve) return 1;

  if (age < curve.peak) {
    // Up to a 12% premium for being well ahead of the peak.
    const yearsToP = curve.peak - age;
    return 1 + Math.min(0.12, yearsToP * 0.03);
  }

  if (age <= curve.cliff) return 1;

  const yearsPast = age - curve.cliff;
  return Math.max(0.25, 1 - yearsPast * curve.decayPerYear);
}

// ---------------------------------------------------------------------------
// Contend vs rebuild
// ---------------------------------------------------------------------------

export type Trajectory = 'ascending' | 'stable' | 'aging';
export type Confidence = 'low' | 'medium' | 'high';

export interface PostureInput {
  /** Your projected starting-lineup strength. */
  myStartingStrength: number;
  /** Every team's starting strength in the league, including yours. */
  leagueStartingStrengths: number[];
  wins: number;
  losses: number;
  ties?: number;
  /** Weeks remaining in the regular season. */
  weeksRemaining: number;
  /** How many teams make the playoffs. */
  playoffTeams: number;
  totalTeams: number;
  isDynasty?: boolean;
  /** Mean age of your most valuable assets. */
  myAvgAge?: number | null;
  /** Mean age of the same cohort across the league. */
  leagueAvgAge?: number | null;
}

export interface PostureResult {
  posture: Posture;
  /** 0 = full rebuild, 1 = all-in contender. */
  score: number;
  /** Standard deviations from league mean strength — the honest effect size. */
  strengthZ: number;
  strengthPercentile: number;
  winPct: number;
  confidence: Confidence;
  trajectory: Trajectory;
  reasoning: string;
}

/**
 * How sharply a z-score maps to a posture score. At 0.9, being a full standard
 * deviation below the league mean lands around 0.29 — clearly a seller. Half a
 * deviation lands near 0.40, which is "mediocre", not "tear it down".
 */
const STRENGTH_SENSITIVITY = 0.9;
/** Pseudo-games of a .500 prior, so an 0-2 start isn't read as destiny. */
const RECORD_PRIOR_GAMES = 4;
/** Age gap (in years, vs league) that counts as a genuinely young roster. */
const TRAJECTORY_AGE_GAP = 0.8;

/**
 * Decide whether this roster should be buying or selling.
 *
 * Strength is measured as a z-score, NOT a rank percentile. Rank ignores how
 * tightly packed the league is: in a compressed league, finishing 10th of 14
 * can mean sitting 1% below median — statistically indistinguishable from
 * average — while rank reports it as the 31st percentile and triggers a
 * teardown. Effect size says what rank cannot.
 *
 * The score is also shrunk toward neutral when little of the season has been
 * played. Committing to a posture in week 1 on an 0-0 record is false
 * precision, and the cost of wrongly selling is far higher in dynasty than the
 * cost of waiting three weeks.
 */
export function evaluatePosture(input: PostureInput): PostureResult {
  const { myStartingStrength, leagueStartingStrengths, wins, losses, weeksRemaining } = input;
  const ties = input.ties ?? 0;

  // --- strength as effect size ---------------------------------------------
  const n = leagueStartingStrengths.length;
  const mean = n > 0 ? leagueStartingStrengths.reduce((a, b) => a + b, 0) / n : myStartingStrength;
  const variance =
    n > 0 ? leagueStartingStrengths.reduce((a, b) => a + (b - mean) ** 2, 0) / n : 0;
  // Floor the deviation so a near-identical league can't divide by ~zero.
  const sd = Math.max(Math.sqrt(variance), 1e-6);
  const strengthZ = (myStartingStrength - mean) / sd;
  const strengthScore = logistic(strengthZ * STRENGTH_SENSITIVITY);

  const sorted = [...leagueStartingStrengths].sort((a, b) => a - b);
  const below = sorted.filter((s) => s < myStartingStrength).length;
  const strengthPercentile = n > 1 ? below / (n - 1) : 0.5;

  // --- record, regressed toward .500 ---------------------------------------
  const gamesPlayed = wins + losses + ties;
  const winPct = gamesPlayed > 0 ? (wins + ties * 0.5) / gamesPlayed : 0.5;
  const recordScore =
    (wins + ties * 0.5 + RECORD_PRIOR_GAMES * 0.5) / (gamesPlayed + RECORD_PRIOR_GAMES);

  const totalWeeks = gamesPlayed + weeksRemaining;
  const seasonProgress = totalWeeks > 0 ? gamesPlayed / totalWeeks : 0;
  const recordWeight = 0.25 + 0.5 * seasonProgress;
  const strengthWeight = 1 - recordWeight;

  let score = strengthWeight * strengthScore + recordWeight * recordScore;

  // --- trajectory: a young roster is rising even at average strength -------
  let trajectory: Trajectory = 'stable';
  if (input.isDynasty && input.myAvgAge != null && input.leagueAvgAge != null) {
    const ageGap = input.myAvgAge - input.leagueAvgAge;
    if (ageGap <= -TRAJECTORY_AGE_GAP) trajectory = 'ascending';
    else if (ageGap >= TRAJECTORY_AGE_GAP) trajectory = 'aging';

    // Modest, deliberately: youth is a reason not to sell, not evidence you
    // are good right now.
    if (trajectory === 'ascending') score += 0.04;
    if (trajectory === 'aging') score -= 0.04;
  }

  // --- shrink toward neutral when we simply don't know yet -----------------
  const infoWeight = gamesPlayed / (gamesPlayed + RECORD_PRIOR_GAMES);
  const certainty = 0.55 + 0.45 * infoWeight;
  score = 0.5 + (score - 0.5) * certainty;

  const confidence: Confidence = gamesPlayed >= 8 ? 'high' : gamesPlayed >= 4 ? 'medium' : 'low';

  // Being outside the playoff cut with little time left is close to decisive,
  // and by then we have enough games that shrinkage should not soften it.
  const playoffCutPercentile = 1 - input.playoffTeams / input.totalTeams;
  if (weeksRemaining <= 4 && strengthPercentile < playoffCutPercentile && winPct < 0.4) {
    score = Math.min(score, 0.25);
  }

  const posture: Posture = score >= 0.62 ? 'contend' : score <= 0.38 ? 'rebuild' : 'bubble';

  return {
    posture,
    score,
    strengthZ,
    strengthPercentile,
    winPct,
    confidence,
    trajectory,
    reasoning: buildPostureReasoning({
      posture,
      strengthZ,
      strengthPercentile,
      totalTeams: n,
      wins,
      losses,
      ties,
      gamesPlayed,
      winPct,
      weeksRemaining,
      confidence,
      trajectory,
    }),
  };
}

function buildPostureReasoning(p: {
  posture: Posture;
  strengthZ: number;
  strengthPercentile: number;
  totalTeams: number;
  wins: number;
  losses: number;
  ties: number;
  gamesPlayed: number;
  winPct: number;
  weeksRemaining: number;
  confidence: Confidence;
  trajectory: Trajectory;
}): string {
  const rank = Math.round((1 - p.strengthPercentile) * (p.totalTeams - 1)) + 1;
  const parts: string[] = [];

  // Lead with the effect size, because rank alone misleads in a tight league.
  const magnitude = Math.abs(p.strengthZ);
  const descriptor =
    magnitude < 0.35
      ? 'essentially league-average'
      : magnitude < 0.85
        ? p.strengthZ < 0
          ? 'modestly below average'
          : 'modestly above average'
        : p.strengthZ < 0
          ? 'clearly below average'
          : 'clearly above average';

  parts.push(
    `${rank}${ordinalSuffix(rank)} of ${p.totalTeams} on starting strength, but ${descriptor} (${p.strengthZ >= 0 ? '+' : ''}${p.strengthZ.toFixed(2)}σ).`,
  );

  if (p.gamesPlayed > 0) {
    parts.push(`You're ${p.wins}-${p.losses}${p.ties ? `-${p.ties}` : ''}.`);
  } else {
    parts.push('No games played yet.');
  }

  if (p.trajectory === 'ascending') {
    parts.push('Your core is younger than the league, so this roster improves on its own.');
  } else if (p.trajectory === 'aging') {
    parts.push('Your core is older than the league, so the window is closing.');
  }

  parts.push(
    p.confidence === 'low'
      ? `Too early to commit — holding at ${p.posture}.`
      : `Reads as ${p.posture}.`,
  );

  return parts.join(' ');
}

function ordinalSuffix(n: number): string {
  return ordinal(n).replace(String(n), '');
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * How much to weight future value against win-now points.
 *
 * Redraft leagues always return 0 — there is no future, so the same engine
 * serves both league types without a separate code path.
 *
 * Trajectory matters as much as posture here. A team that is already the
 * youngest in the league does not need to acquire *more* youth — it needs to
 * stop hoarding and start converting surplus prospects into current starters.
 * Weighting a young rebuilder the same as an old one is how rosters get stuck
 * perpetually two years away.
 */
export function futureWeight(
  posture: Posture,
  isDynasty: boolean,
  trajectory: Trajectory = 'stable',
): number {
  if (!isDynasty) return 0;

  const base = posture === 'contend' ? 0.25 : posture === 'bubble' ? 0.5 : 0.8;

  // Already young: lean nearer the present. Already old: the future is scarcer
  // and therefore worth more per unit.
  const adjustment = trajectory === 'ascending' ? -0.15 : trajectory === 'aging' ? 0.1 : 0;

  return Math.min(0.9, Math.max(0.15, base + adjustment));
}

// ---------------------------------------------------------------------------
// Scoring moves
// ---------------------------------------------------------------------------

export interface AssetValue {
  playerId: string;
  position: string;
  age: number | null;
  dynastyValue: number;
  redraftValue: number;
}

/** Dynasty value adjusted for position-specific aging. */
export function adjustedDynastyValue(asset: AssetValue): number {
  return asset.dynastyValue * ageMultiplier(asset.position, asset.age);
}

export interface MoveInput {
  /** Rest-of-season starting-lineup points gained (may be negative). */
  winNowDelta: number;
  /** Assets acquired. */
  gaining: AssetValue[];
  /** Assets given up. */
  losing: AssetValue[];
  posture: Posture;
  isDynasty: boolean;
  trajectory?: Trajectory;
}

/**
 * Score a move on both axes.
 *
 * `futureDelta` is normalized into rough point-equivalents so the two axes are
 * commensurable when combined: FantasyCalc values run in the thousands, while
 * weekly points run in the tens, and adding them raw would let a trivial value
 * difference swamp a real lineup improvement.
 */
export const VALUE_POINTS_DIVISOR = 250;

export function scoreMove(input: MoveInput): DualScore {
  const gained = input.gaining.reduce((sum, asset) => sum + adjustedDynastyValue(asset), 0);
  const lost = input.losing.reduce((sum, asset) => sum + adjustedDynastyValue(asset), 0);

  const futureDelta = input.isDynasty ? (gained - lost) / VALUE_POINTS_DIVISOR : 0;
  const weight = futureWeight(input.posture, input.isDynasty, input.trajectory);
  const combined = (1 - weight) * input.winNowDelta + weight * futureDelta;

  return {
    winNowDelta: round2(input.winNowDelta),
    futureDelta: round2(futureDelta),
    combined: round2(combined),
  };
}

/**
 * Human-readable read on a move, naming the tradeoff explicitly rather than
 * hiding it behind a single score.
 */
export function describeMove(score: DualScore, posture: Posture, isDynasty: boolean): string {
  if (!isDynasty) {
    return score.winNowDelta > 0
      ? `Adds ${score.winNowDelta.toFixed(1)} projected points.`
      : `Costs ${Math.abs(score.winNowDelta).toFixed(1)} projected points.`;
  }

  const now = score.winNowDelta;
  const future = score.futureDelta;

  if (now >= 0 && future >= 0) return 'Wins on both axes — better now and better later.';
  if (now < 0 && future < 0) return 'Loses on both axes. Skip it.';

  if (now < 0 && future > 0) {
    return posture === 'contend'
      ? `Buys future value at the cost of ${Math.abs(now).toFixed(1)} points now — hard to justify while contending.`
      : `Costs ${Math.abs(now).toFixed(1)} points now for meaningful long-term value. Sensible while ${posture === 'rebuild' ? 'rebuilding' : 'on the bubble'}.`;
  }

  return posture === 'contend'
    ? `Adds ${now.toFixed(1)} points now at some future cost — the right trade while contending.`
    : `Adds ${now.toFixed(1)} points now but sells future value, which cuts against a ${posture} posture.`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * English ordinal suffix. 11-13 are the exceptions that a naive
 * last-digit lookup gets wrong ("11st"), so they're handled first.
 */
export function ordinal(n: number): string {
  const mod100 = Math.abs(n) % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (Math.abs(n) % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
