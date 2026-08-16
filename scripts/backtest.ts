/**
 * Does the market layer actually improve projections?
 *
 *   npx tsx scripts/backtest.ts [season] [lastWeek]
 *
 * Scores every projection layer against Sleeper's own actual stats for a
 * completed season and reports mean absolute error per position. If the market
 * layer doesn't beat the base, that shows up here as a weight near zero and we
 * drop it — the point is to measure the thesis, not to assert it.
 *
 * Ground truth is Sleeper's stats endpoint: same player_ids and the same stat
 * keys as the projections, so there is no name matching or ID crosswalk
 * anywhere in this comparison.
 *
 * Caveat worth remembering when reading the output: historical ESPN odds come
 * from ESPN BET, while live games carry DraftKings. Books correlate tightly but
 * they are not identical, so the fitted weights are a good estimate rather than
 * an exact production match.
 */
import './_env';
import fs from 'node:fs';
import path from 'node:path';
import { fetchJson, mapLimit } from '../src/lib/sources/http';
import { getWeeklyProjections, hasRealProjection, type SleeperProjection } from '../src/lib/sources/sleeper';
import { getWeekGameLines, indexByTeam, SEASON_TYPE } from '../src/lib/sources/espn-odds';
import { scoreProjection } from '../src/lib/engine/scoring';
import { applyMarketLayer, baseImpliedTeamPoints, normalizeRatio } from '../src/lib/engine/market';
import type { StatLine, ScoringSettings } from '../src/db/schema';

const CACHE = path.join(process.cwd(), '.backtest-cache');
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];

/** Standard full-PPR. Deliberately generic so the fitted weights aren't tuned to one league. */
const SCORING: ScoringSettings = {
  pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2,
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
  fum_lost: -2,
};

/**
 * Only evaluate players who were realistically startable. Including every
 * deep-bench body would flood the error with near-zero-vs-zero comparisons and
 * make every layer look identical.
 */
const MIN_PROJECTION = 5;

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const file = path.join(CACHE, `${key}.json`);
  if (fs.existsSync(file)) return Promise.resolve(JSON.parse(fs.readFileSync(file, 'utf8')) as T);
  return fn().then((value) => {
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
    return value;
  });
}

interface StatsRow {
  player_id: string;
  stats: StatLine;
  team: string | null;
  player?: { position: string | null } | null;
}

async function getActuals(season: string, week: number): Promise<StatsRow[]> {
  const groups = await mapLimit(POSITIONS, 3, async (position) => {
    const query = new URLSearchParams({ season_type: 'regular', order_by: 'ppr' });
    query.append('position[]', position);
    return (
      (await fetchJson<StatsRow[]>(`https://api.sleeper.com/stats/nfl/${season}/${week}?${query.toString()}`, {
        nullOn404: true,
      })) ?? []
    );
  });
  return groups.flat();
}

interface Sample {
  playerId: string;
  position: string;
  week: number;
  actual: number;
  base: number;
  market: number | null;
}

async function collectWeek(season: string, week: number): Promise<Sample[]> {
  const [projections, actuals, lines] = await Promise.all([
    cached(`proj-${season}-${week}`, () => getWeeklyProjections(season, week, POSITIONS)),
    cached(`stats-${season}-${week}`, () => getActuals(season, week)),
    cached(`odds-${season}-${week}`, () => getWeekGameLines(season, week, SEASON_TYPE.regular)),
  ]);

  const usable = (projections as SleeperProjection[]).filter(hasRealProjection);
  const actualByPlayer = new Map(actuals.map((row) => [row.player_id, row.stats]));

  const oddsByTeam = indexByTeam(lines);

  // Base team totals, then the league-median normalizer — same as production.
  const statsByTeam = new Map<string, StatLine[]>();
  for (const p of usable) {
    if (!p.team) continue;
    const list = statsByTeam.get(p.team);
    if (list) list.push(p.stats);
    else statsByTeam.set(p.team, [p.stats]);
  }
  const baseTeamPoints = new Map<string, number>();
  for (const [team, stats] of statsByTeam) baseTeamPoints.set(team, baseImpliedTeamPoints(stats));

  const ratios: number[] = [];
  for (const [team, base] of baseTeamPoints) {
    const implied = oddsByTeam.get(team)?.impliedPoints;
    if (base > 0 && implied != null) ratios.push(implied / base);
  }
  const normalization = normalizeRatio(ratios);

  const samples: Sample[] = [];
  for (const projection of usable) {
    const actualStats = actualByPlayer.get(projection.player_id);
    if (!actualStats) continue; // did not play / no stat line

    const base = scoreProjection(projection.stats, SCORING);
    if (base < MIN_PROJECTION) continue;

    const position = projection.player?.position ?? 'UNK';
    const odds = projection.team ? oddsByTeam.get(projection.team) : undefined;
    const teamBase = projection.team ? baseTeamPoints.get(projection.team) ?? 0 : 0;

    let market: number | null = null;
    if (odds && odds.impliedPoints != null && teamBase > 0) {
      market = scoreProjection(
        applyMarketLayer(projection.stats, {
          impliedTeamPoints: odds.impliedPoints,
          baseTeamPoints: teamBase,
          teamSpread: odds.spread ?? 0,
          normalization,
        }),
        SCORING,
      );
    }

    samples.push({
      playerId: projection.player_id,
      position,
      week,
      actual: scoreProjection(actualStats, SCORING),
      base,
      market,
    });
  }

  return samples;
}

const mae = (samples: Sample[], predict: (s: Sample) => number) =>
  samples.reduce((sum, s) => sum + Math.abs(predict(s) - s.actual), 0) / Math.max(1, samples.length);

const rmse = (samples: Sample[], predict: (s: Sample) => number) =>
  Math.sqrt(samples.reduce((sum, s) => sum + (predict(s) - s.actual) ** 2, 0) / Math.max(1, samples.length));

/** Grid search the market weight that minimizes MAE. */
function fitWeight(samples: Sample[]): { weight: number; mae: number; baseMae: number } {
  const withMarket = samples.filter((s) => s.market !== null);
  const baseMae = mae(withMarket, (s) => s.base);

  let best = { weight: 0, mae: baseMae, baseMae };
  for (let w = 0; w <= 1.0001; w += 0.05) {
    const blended = mae(withMarket, (s) => (1 - w) * s.base + w * (s.market as number));
    if (blended < best.mae) best = { weight: Math.round(w * 100) / 100, mae: blended, baseMae };
  }
  return best;
}

/**
 * Paired bootstrap on the MAE difference.
 *
 * A 0.05% improvement on a few thousand samples is meaningless unless the
 * confidence interval excludes zero. Resampling player-weeks with replacement
 * gives that without assuming a distribution.
 */
function bootstrapMaeDelta(
  samples: Sample[],
  weight: number,
  iterations = 2000,
): { mean: number; lower: number; upper: number } {
  const withMarket = samples.filter((s) => s.market !== null);
  const n = withMarket.length;
  // Deterministic PRNG so the reported interval is reproducible.
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const deltas: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let baseErr = 0;
    let blendErr = 0;
    for (let j = 0; j < n; j++) {
      const s = withMarket[Math.floor(rand() * n)];
      baseErr += Math.abs(s.base - s.actual);
      blendErr += Math.abs((1 - weight) * s.base + weight * (s.market as number) - s.actual);
    }
    deltas.push((baseErr - blendErr) / n); // positive = blend is better
  }

  deltas.sort((a, b) => a - b);
  return {
    mean: deltas.reduce((a, b) => a + b, 0) / deltas.length,
    lower: deltas[Math.floor(deltas.length * 0.025)],
    upper: deltas[Math.floor(deltas.length * 0.975)],
  };
}

/**
 * The decision that actually matters: given two players competing for one
 * lineup slot, does the market layer pick the right one more often than the
 * base projection?
 *
 * Restricted to pairs where the two layers DISAGREE — everywhere else the
 * market layer changes nothing, and including those would dilute the signal
 * toward 50% by construction.
 */
function startSitAccuracy(samples: Sample[]): {
  disagreements: number;
  baseCorrect: number;
  marketCorrect: number;
} {
  const byPositionWeek = new Map<string, Sample[]>();
  for (const s of samples) {
    if (s.market === null) continue;
    const list = byPositionWeek.get(s.position);
    if (list) list.push(s);
    else byPositionWeek.set(s.position, [s]);
  }

  let disagreements = 0;
  let baseCorrect = 0;
  let marketCorrect = 0;

  for (const group of byPositionWeek.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (a.actual === b.actual) continue;

        const basePicksA = a.base > b.base;
        const marketPicksA = (a.market as number) > (b.market as number);
        if (basePicksA === marketPicksA) continue; // no disagreement

        disagreements++;
        const truthIsA = a.actual > b.actual;
        if (basePicksA === truthIsA) baseCorrect++;
        if (marketPicksA === truthIsA) marketCorrect++;
      }
    }
  }

  return { disagreements, baseCorrect, marketCorrect };
}

async function main() {
  const season = process.argv[2] ?? '2025';
  const lastWeek = Number(process.argv[3] ?? 14);

  console.log(`\nBacktest ${season}, weeks 1-${lastWeek}`);
  console.log(`Scoring: full PPR · evaluating players projected >= ${MIN_PROJECTION} pts\n`);

  const all: Sample[] = [];
  for (let week = 1; week <= lastWeek; week++) {
    process.stdout.write(`  week ${String(week).padStart(2)} ... `);
    try {
      const samples = await collectWeek(season, week);
      all.push(...samples);
      const covered = samples.filter((s) => s.market !== null).length;
      console.log(`${String(samples.length).padStart(4)} samples, ${covered} with odds`);
    } catch (error) {
      console.log(`failed: ${(error as Error).message}`);
    }
  }

  if (all.length === 0) {
    console.log('\nNo samples collected — nothing to measure.');
    return;
  }

  const withMarket = all.filter((s) => s.market !== null);
  console.log(`\nTotal: ${all.length} player-weeks, ${withMarket.length} with a market line\n`);

  console.log('='.repeat(74));
  console.log('OVERALL');
  console.log('='.repeat(74));
  console.log(`  base   MAE ${mae(withMarket, (s) => s.base).toFixed(3)}   RMSE ${rmse(withMarket, (s) => s.base).toFixed(3)}`);
  console.log(`  market MAE ${mae(withMarket, (s) => s.market as number).toFixed(3)}   RMSE ${rmse(withMarket, (s) => s.market as number).toFixed(3)}`);

  const overall = fitWeight(all);
  const lift = ((overall.baseMae - overall.mae) / overall.baseMae) * 100;
  console.log(
    `\n  best blend: ${(overall.weight * 100).toFixed(0)}% market  ->  MAE ${overall.mae.toFixed(3)}  ` +
      `(${lift >= 0 ? '-' : '+'}${Math.abs(lift).toFixed(2)}% vs base)`,
  );

  console.log('\n' + '='.repeat(74));
  console.log('BY POSITION');
  console.log('='.repeat(74));
  console.log(`  ${'pos'.padEnd(5)} ${'n'.padStart(6)} ${'base MAE'.padStart(9)} ${'blend MAE'.padStart(10)} ${'weight'.padStart(7)} ${'lift'.padStart(8)}`);

  const results: Array<{ position: string; weight: number; mae: number; baseMae: number; n: number }> = [];
  for (const position of POSITIONS) {
    const subset = all.filter((s) => s.position === position && s.market !== null);
    if (subset.length < 50) continue;
    const fit = fitWeight(subset);
    const positionLift = ((fit.baseMae - fit.mae) / fit.baseMae) * 100;
    results.push({ position, ...fit, n: subset.length });
    console.log(
      `  ${position.padEnd(5)} ${String(subset.length).padStart(6)} ${fit.baseMae.toFixed(3).padStart(9)} ` +
        `${fit.mae.toFixed(3).padStart(10)} ${(fit.weight * 100).toFixed(0).padStart(6)}% ` +
        `${(positionLift >= 0 ? '-' : '+') + Math.abs(positionLift).toFixed(2) + '%'}`.padStart(9),
    );
  }

  console.log('\n' + '='.repeat(74));
  console.log('IS THE DIFFERENCE REAL?');
  console.log('='.repeat(74));
  const boot = bootstrapMaeDelta(all, overall.weight);
  console.log(`  MAE improvement from blending: ${boot.mean.toFixed(4)} pts/player-week`);
  console.log(`  95% CI: [${boot.lower.toFixed(4)}, ${boot.upper.toFixed(4)}]`);
  const significant = boot.lower > 0;
  console.log(`  ${significant ? 'Excludes zero — a real (if tiny) improvement.' : 'Includes zero — indistinguishable from no effect.'}`);

  console.log('\n' + '='.repeat(74));
  console.log('START/SIT: HEAD-TO-HEAD ON DISAGREEMENTS');
  console.log('='.repeat(74));
  const ss = startSitAccuracy(all);
  if (ss.disagreements === 0) {
    console.log('  The layers never disagreed about an ordering.');
  } else {
    const basePct = (ss.baseCorrect / ss.disagreements) * 100;
    const marketPct = (ss.marketCorrect / ss.disagreements) * 100;
    console.log(`  ${ss.disagreements.toLocaleString()} same-position pairs where the layers pick different players`);
    console.log(`    base   correct ${ss.baseCorrect.toLocaleString()} (${basePct.toFixed(2)}%)`);
    console.log(`    market correct ${ss.marketCorrect.toLocaleString()} (${marketPct.toFixed(2)}%)`);
    console.log(`  ${marketPct > basePct ? 'Market wins the disagreements.' : 'Base wins the disagreements.'}`);
  }

  /*
   * Out-of-sample check.
   *
   * Grid-searching a weight per position and then reporting the improvement on
   * that same data is circular — it will always find *some* gain. Fit on the
   * early weeks, evaluate on the later ones. Only a gain that survives this is
   * real.
   */
  console.log('\n' + '='.repeat(74));
  console.log('HOLDOUT: FIT ON WEEKS 1-9, TEST ON 10+');
  console.log('='.repeat(74));

  const splitWeek = Math.floor(lastWeek * 0.65);
  const train = all.filter((s) => s.week <= splitWeek);
  const test = all.filter((s) => s.week > splitWeek);

  console.log(`  train ${train.length} samples (wk 1-${splitWeek}) · test ${test.length} samples (wk ${splitWeek + 1}-${lastWeek})\n`);
  console.log(`  ${'pos'.padEnd(5)} ${'fitted w'.padStart(9)} ${'test base'.padStart(10)} ${'test blend'.padStart(11)} ${'lift'.padStart(9)}`);

  let holdoutWins = 0;
  let holdoutTotal = 0;
  for (const position of POSITIONS) {
    const trainSubset = train.filter((s) => s.position === position && s.market !== null);
    const testSubset = test.filter((s) => s.position === position && s.market !== null);
    if (trainSubset.length < 50 || testSubset.length < 50) continue;

    const fitted = fitWeight(trainSubset).weight;
    const testBase = mae(testSubset, (s) => s.base);
    const testBlend = mae(testSubset, (s) => (1 - fitted) * s.base + fitted * (s.market as number));
    const lift = ((testBase - testBlend) / testBase) * 100;

    holdoutTotal++;
    if (testBlend < testBase) holdoutWins++;

    console.log(
      `  ${position.padEnd(5)} ${(fitted * 100).toFixed(0).padStart(8)}% ${testBase.toFixed(3).padStart(10)} ` +
        `${testBlend.toFixed(3).padStart(11)} ${((lift >= 0 ? '-' : '+') + Math.abs(lift).toFixed(2) + '%').padStart(9)}`,
    );
  }
  console.log(`\n  Held up out-of-sample for ${holdoutWins}/${holdoutTotal} positions.`);

  console.log('\n' + '='.repeat(74));
  console.log('VERDICT');
  console.log('='.repeat(74));

  const marketWinsStartSit = ss.disagreements > 0 && ss.marketCorrect > ss.baseCorrect;
  const worthShipping = significant && marketWinsStartSit && holdoutWins > holdoutTotal / 2;

  if (worthShipping) {
    console.log('  The market layer earns its place. Fitted weights:');
    for (const r of results) {
      console.log(`    ${r.position.padEnd(4)} base ${(1 - r.weight).toFixed(2)}  market ${r.weight.toFixed(2)}`);
    }
  } else {
    console.log('  The market layer does NOT earn its place:');
    if (!significant) console.log('    - the MAE improvement\'s confidence interval includes zero');
    if (!marketWinsStartSit) console.log('    - it loses head-to-head start/sit calls against the base');
    if (holdoutWins <= holdoutTotal / 2) console.log('    - the in-sample gains do not survive a holdout');
    console.log('');
    console.log('  Recommendation: ship base-only (market weight 0).');
    console.log('  The most likely explanation is that Rotowire already prices game');
    console.log('  totals into its projections, so re-applying them double-counts the');
    console.log('  same information and adds noise rather than signal.');
  }
  console.log();
  console.log(`  Cache: ${CACHE}  (delete to re-fetch)`);
  console.log();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
