import type { StatLine } from '@/db/schema';

/**
 * Market overlay: layers 2 and 3 of the projection stack.
 *
 * Layer 1 (Rotowire via Sleeper) gives full coverage but isn't market-sharp.
 * Layer 2 reshapes those projections toward what the betting market expects
 * each team to score, which applies to *every* player on a team — including
 * waiver-wire targets who have no props. Layer 3 overrides individual players
 * with their own de-vigged prop lines where those exist.
 *
 * Every tunable constant here is a DEFAULT that the backtest re-fits against
 * nflverse actuals (see scripts/backtest.ts). Nothing in this file should be
 * treated as a known-good magic number until that backtest has run.
 */

// ---------------------------------------------------------------------------
// Odds primitives
// ---------------------------------------------------------------------------

/** American odds -> raw implied probability (still contains vig). */
export function americanToImpliedProb(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return NaN;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

export interface DeviggedLine {
  overProb: number;
  underProb: number;
  /** Total book margin, e.g. ~0.048 for a standard -110/-110 pair. */
  vig: number;
}

/**
 * Strip the bookmaker's margin from a two-way market by normalizing the two
 * raw probabilities to sum to 1.
 *
 * A -110/-110 pair implies 52.38% on each side (104.76% total). The 4.76%
 * overround is the book's edge, not information about the game. Using raw
 * implied probability as a forecast systematically overstates both outcomes,
 * so this normalization is mandatory before anything downstream consumes it.
 */
export function deVig(overOdds: number, underOdds: number): DeviggedLine | null {
  const rawOver = americanToImpliedProb(overOdds);
  const rawUnder = americanToImpliedProb(underOdds);
  if (!Number.isFinite(rawOver) || !Number.isFinite(rawUnder)) return null;

  const sum = rawOver + rawUnder;
  if (sum <= 0) return null;

  return {
    overProb: rawOver / sum,
    underProb: rawUnder / sum,
    vig: sum - 1,
  };
}

// ---------------------------------------------------------------------------
// Layer 2 — game lines to implied team totals
// ---------------------------------------------------------------------------

export interface ImpliedTotals {
  home: number;
  away: number;
}

/**
 * Split a game total into per-team expected points using the spread.
 *
 * `spread` follows ESPN/DK convention: the HOME team's number, negative when
 * home is favored. A 37.5 total with a -6.5 spread implies home 22.0,
 * away 15.5.
 */
export function impliedTeamTotals(spread: number | null, total: number | null): ImpliedTotals | null {
  if (spread === null || total === null) return null;
  if (!Number.isFinite(spread) || !Number.isFinite(total)) return null;
  return {
    home: (total - spread) / 2,
    away: (total + spread) / 2,
  };
}

export interface GameScript {
  /** >1 means the market expects this team to throw more than baseline. */
  passMultiplier: number;
  /** >1 means more rushing volume — the profile of a team playing with a lead. */
  rushMultiplier: number;
}

/**
 * Expected game flow from the spread.
 *
 * Teams trailing throw to catch up; teams leading run to bleed clock. A team
 * favored by 10 sees meaningfully more rush attempts and fewer dropbacks than
 * the same team in a pick'em, which moves RB and WR value in opposite
 * directions. `teamSpread` is this team's own spread (negative = favored).
 */
export function gameScript(teamSpread: number, sensitivity = GAME_SCRIPT_SENSITIVITY): GameScript {
  if (!Number.isFinite(teamSpread)) return { passMultiplier: 1, rushMultiplier: 1 };
  // Favored (negative spread) -> tilt toward rushing.
  const tilt = clamp(-teamSpread * sensitivity, -MAX_SCRIPT_TILT, MAX_SCRIPT_TILT);
  return {
    passMultiplier: 1 - tilt,
    rushMultiplier: 1 + tilt,
  };
}

/** Per-point-of-spread tilt. Backtest-fittable. */
export const GAME_SCRIPT_SENSITIVITY = 0.012;
/** Cap so a 20-point spread can't distort projections beyond reason. */
export const MAX_SCRIPT_TILT = 0.18;
/**
 * How much of the market's disagreement with the base projection we act on.
 * 1.0 would mean the base projection carries no independent information about
 * scoring environment, which is false — Rotowire already prices in some of it.
 * Backtest-fittable; 0.5 is a deliberately conservative starting point.
 */
export const MARKET_DAMPING = 0.5;

const PASS_STATS = new Set(['pass_yd', 'pass_td', 'pass_att', 'pass_cmp', 'pass_fd', 'pass_int', 'pass_2pt']);
const RECV_STATS = new Set(['rec', 'rec_yd', 'rec_td', 'rec_tgt', 'rec_fd', 'rec_2pt']);
const RUSH_STATS = new Set(['rush_yd', 'rush_td', 'rush_att', 'rush_fd', 'rush_2pt']);
/** Scale with scoring environment but aren't split by pass/rush. */
const SCORING_STATS = new Set(['fgm', 'xpm', 'fga', 'xpa']);

/**
 * Estimate the offensive points a team's projected stat lines already imply.
 *
 * Used as the denominator when comparing the base projection's scoring
 * environment against the market's. Receiving TDs are deliberately excluded —
 * they're the same events as passing TDs and would double-count.
 */
export function baseImpliedTeamPoints(teamStats: StatLine[]): number {
  let passTd = 0;
  let rushTd = 0;
  let fgm = 0;
  let xpm = 0;

  for (const stats of teamStats) {
    passTd += stats.pass_td ?? 0;
    rushTd += stats.rush_td ?? 0;
    fgm += stats.fgm ?? 0;
    xpm += stats.xpm ?? 0;
  }

  const touchdowns = passTd + rushTd;
  // If kicker projections are missing, approximate extra points from TDs.
  const extraPoints = xpm > 0 ? xpm : touchdowns * 0.94;
  return touchdowns * 6 + extraPoints + fgm * 3;
}

export interface MarketContext {
  /** Market-implied points for this player's team. */
  impliedTeamPoints: number;
  /** Points the team's base projections already imply. */
  baseTeamPoints: number;
  /** This team's spread (negative = favored). */
  teamSpread: number;
  damping?: number;
  /**
   * League-wide median of (impliedTeamPoints / baseTeamPoints), used to center
   * the adjustment. See normalizeRatio for why this is not optional in
   * practice.
   */
  normalization?: number;
}

/**
 * Center the market/base ratio so only *relative* differences between teams
 * move projections.
 *
 * The absolute comparison is untrustworthy: `baseImpliedTeamPoints` is summed
 * over whichever players we happened to fetch, so it misses field goals,
 * defensive scores, and any position not in the batch. That makes every team's
 * base total biased low, every ratio biased high, and — as the first live run
 * showed — every player in the league adjusts upward, which is obviously wrong.
 *
 * Dividing by the league-wide median ratio removes that shared bias. A team the
 * market likes relative to its peers still moves up; an average matchup stays
 * put. The median rather than the mean so one blowout line can't drag the
 * baseline.
 */
export function normalizeRatio(ratios: number[]): number {
  const valid = ratios.filter((r) => Number.isFinite(r) && r > 0).sort((a, b) => a - b);
  if (valid.length === 0) return 1;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 0 ? (valid[mid - 1] + valid[mid]) / 2 : valid[mid];
}

/**
 * Reshape a base stat line toward the market's view of the game.
 *
 * Two independent adjustments:
 *   1. *Scale* — if the market expects the team to score 27 while the base
 *      projections imply 21, everything TD- and yardage-related scales up by a
 *      damped version of that ratio.
 *   2. *Mix* — the spread tilts pass volume against rush volume.
 *
 * Returns a full component stat line so league-specific scoring still applies
 * downstream. That's the reason this works on the stat line rather than on a
 * points total: a TE-premium league must still see the reception bonus.
 */
export function applyMarketLayer(stats: StatLine, ctx: MarketContext): StatLine {
  const damping = ctx.damping ?? MARKET_DAMPING;

  const normalization = ctx.normalization && ctx.normalization > 0 ? ctx.normalization : 1;

  let scale = 1;
  if (ctx.baseTeamPoints > 0 && Number.isFinite(ctx.impliedTeamPoints)) {
    // Centered ratio: 1.0 means "this team's matchup is league-average".
    const ratio = ctx.impliedTeamPoints / ctx.baseTeamPoints / normalization;
    if (Number.isFinite(ratio) && ratio > 0) {
      scale = 1 + damping * (ratio - 1);
      scale = clamp(scale, 0.6, 1.6);
    }
  }

  const script = gameScript(ctx.teamSpread);
  const out: StatLine = {};

  for (const [key, value] of Object.entries(stats)) {
    if (!Number.isFinite(value)) {
      out[key] = value;
      continue;
    }
    let factor = 1;
    if (PASS_STATS.has(key) || RECV_STATS.has(key)) {
      factor = scale * script.passMultiplier;
    } else if (RUSH_STATS.has(key)) {
      factor = scale * script.rushMultiplier;
    } else if (SCORING_STATS.has(key)) {
      factor = scale;
    } else {
      // ADP, games played, turnovers, defensive stats: pass through untouched.
      out[key] = value;
      continue;
    }
    out[key] = value * factor;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Layer 3 — player props to expectations
// ---------------------------------------------------------------------------

/**
 * Coefficient of variation per market, used to convert a line plus its
 * de-vigged probability into a mean. Backtest-fittable.
 */
export const MARKET_CV: Record<string, number> = {
  pass_yd: 0.28,
  pass_td: 0.65,
  pass_att: 0.18,
  pass_cmp: 0.2,
  rush_yd: 0.45,
  rush_att: 0.28,
  rec: 0.4,
  rec_yd: 0.55,
  rec_tgt: 0.3,
};

/**
 * Convert an anytime-touchdown probability into expected touchdowns.
 *
 * A prop prices P(at least one TD), but fantasy scoring pays per TD. Treating
 * a 45% anytime-TD player as 0.45 expected TDs understates them, because some
 * of that mass is two- and three-TD games. Modeling TDs as Poisson(lambda):
 * P(X >= 1) = 1 - e^-lambda, so lambda = -ln(1 - p). At p = 0.45 that's 0.598
 * expected TDs — a third of a touchdown per game more than the naive read.
 */
export function anytimeTdToExpectedTds(prob: number): number {
  if (!Number.isFinite(prob) || prob <= 0) return 0;
  if (prob >= 0.999) return -Math.log(0.001);
  return -Math.log(1 - prob);
}

/**
 * Convert an over/under line into a mean.
 *
 * The posted line is roughly the median, and the de-vigged over-probability
 * tells us how far the mean sits from it: if fair P(over) is 55%, the market's
 * central estimate is above the posted number. Modeling the outcome as normal
 * with market-specific dispersion, mean = line + z * sigma.
 */
export function lineToMean(market: string, line: number, fairOverProb: number): number {
  if (!Number.isFinite(line)) return NaN;
  if (!Number.isFinite(fairOverProb)) return line;
  const cv = MARKET_CV[market];
  if (!cv) return line;
  const sigma = Math.abs(line) * cv;
  const z = normalInverseCdf(fairOverProb);
  if (!Number.isFinite(z)) return line;
  return line + z * sigma;
}

export interface PropInput {
  market: string;
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
}

/**
 * Turn a raw prop into a fantasy-usable expectation.
 * Returns null when the prop can't be interpreted, so callers fall back to
 * layers 1-2 rather than silently substituting a bad number.
 */
export function propToExpectation(prop: PropInput): { market: string; mean: number } | null {
  if (prop.market === 'anytime_td') {
    if (prop.overOdds === null) return null;
    // Anytime TD is a yes/no market; de-vig against the "no" side when present.
    const fair =
      prop.underOdds !== null
        ? deVig(prop.overOdds, prop.underOdds)?.overProb
        : americanToImpliedProb(prop.overOdds);
    if (fair === undefined || !Number.isFinite(fair)) return null;
    return { market: 'anytime_td', mean: anytimeTdToExpectedTds(fair) };
  }

  if (prop.line === null || prop.overOdds === null || prop.underOdds === null) return null;
  const devigged = deVig(prop.overOdds, prop.underOdds);
  if (!devigged) return null;
  const mean = lineToMean(prop.market, prop.line, devigged.overProb);
  if (!Number.isFinite(mean)) return null;
  return { market: prop.market, mean };
}

/**
 * Overlay prop-derived expectations onto a stat line.
 *
 * Props override the base for the stats they cover and leave everything else
 * intact, so a WR with a receiving-yards prop but no reception prop keeps his
 * projected catches from layers 1-2.
 *
 * `anytime_td` is distributed across rushing and receiving TDs in proportion to
 * the base projection's own split, so a goal-line back's expected TDs land in
 * rush_td rather than being arbitrarily assigned.
 */
export function applyPropLayer(stats: StatLine, props: PropInput[]): StatLine {
  const out: StatLine = { ...stats };

  for (const prop of props) {
    const expectation = propToExpectation(prop);
    if (!expectation) continue;

    if (expectation.market === 'anytime_td') {
      const baseRush = stats.rush_td ?? 0;
      const baseRec = stats.rec_td ?? 0;
      const baseTotal = baseRush + baseRec;
      if (baseTotal > 0) {
        out.rush_td = expectation.mean * (baseRush / baseTotal);
        out.rec_td = expectation.mean * (baseRec / baseTotal);
      } else {
        // No base TD split to follow — assign by position-neutral default.
        out.rec_td = expectation.mean;
      }
      continue;
    }

    out[expectation.market] = expectation.mean;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Blending
// ---------------------------------------------------------------------------

export interface LayerWeights {
  base: number;
  market: number;
  props: number;
}

/**
 * Weighted blend of the three layers' scored point totals.
 *
 * Weights come from `blend_weights`, fit by the backtest. Layers that produced
 * no value (no odds for the game, no props for the player) are dropped and the
 * remaining weights renormalized, so a player with no props isn't penalized.
 */
export function blend(
  values: { base: number; market?: number | null; props?: number | null },
  weights: LayerWeights,
): number {
  const parts: Array<[number, number]> = [[values.base, weights.base]];
  if (values.market !== null && values.market !== undefined && Number.isFinite(values.market)) {
    parts.push([values.market, weights.market]);
  }
  if (values.props !== null && values.props !== undefined && Number.isFinite(values.props)) {
    parts.push([values.props, weights.props]);
  }

  const totalWeight = parts.reduce((sum, [, w]) => sum + w, 0);
  if (totalWeight <= 0) return values.base;

  const weighted = parts.reduce((sum, [v, w]) => sum + v * w, 0);
  return Math.round((weighted / totalWeight) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Inverse normal CDF (Acklam's rational approximation, ~1.15e-9 relative
 * error). Needed to turn a de-vigged probability into a z-score without
 * pulling in a stats dependency.
 */
export function normalInverseCdf(p: number): number {
  if (!(p > 0 && p < 1)) return NaN;

  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}
