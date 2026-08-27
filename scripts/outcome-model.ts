/**
 * How wrong are season projections, really?
 *
 * Every number in draft-sim.ts's default mode assumes a player scores exactly
 * his projection. That makes the sim a test of the *decision procedure* and
 * nothing else — it cannot see risk, because in that world there is none.
 *
 * This module measures the actual error from a completed season and exposes it
 * as a sampler, so a drafted roster can be scored against outcomes that vary
 * the way real ones do. Calibration is Sleeper's own 2025 season projections
 * against Sleeper's own 2025 actuals: same player_ids, same stat keys, no name
 * matching anywhere.
 *
 * The headline number is brutal and worth internalising before reading any
 * result that depends on it — the 10th percentile of actual/projected is about
 * 0.2. One drafted player in ten returns a fifth of what the board promised.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getSeasonProjections, hasRealProjection } from '../src/lib/sources/sleeper';
import { scoreProjection } from '../src/lib/engine/scoring';
import type { StatLine, ScoringSettings } from '../src/db/schema';

const CACHE = path.join(process.cwd(), '.backtest-cache');
const MODEL_FILE = path.join(CACHE, 'outcome-ratios.json');

/** Deliberately generic full-PPR, matching backtest.ts, so the error model is
 *  not tuned to one league's scoring. */
const SCORING: ScoringSettings = {
  pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2,
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
  fum_lost: -2,
};

/** Below this a projection is noise and the ratio explodes. */
const MIN_PROJECTION = 20;
/** Positions with fewer pairs than this fall back to the pooled distribution. */
const MIN_SAMPLES = 40;

export interface OutcomeModel {
  season: string;
  weeks: number;
  /** Empirical actual/projected ratios, by position, plus an 'ALL' pool. */
  ratios: Record<string, number[]>;
}

function quantile(sorted: number[], f: number): number {
  return sorted[Math.floor(f * (sorted.length - 1))];
}

export function describe(model: OutcomeModel): string {
  const lines: string[] = [];
  for (const [position, values] of Object.entries(model.ratios)) {
    const sorted = [...values].sort((a, b) => a - b);
    const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
    lines.push(
      `  ${position.padEnd(5)} n=${String(sorted.length).padStart(4)}  mean ${mean.toFixed(2)}  ` +
        `p10 ${quantile(sorted, 0.1).toFixed(2)}  p50 ${quantile(sorted, 0.5).toFixed(2)}  ` +
        `p90 ${quantile(sorted, 0.9).toFixed(2)}`,
    );
  }
  return lines.join('\n');
}

/**
 * Build (or reuse) the error model. Network is touched only on a cache miss;
 * the weekly actuals come from whatever backtest.ts has already pulled down.
 */
export async function loadOutcomeModel(
  season = '2025',
  positionById: Map<string, string>,
): Promise<OutcomeModel> {
  if (fs.existsSync(MODEL_FILE)) {
    const cached = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8')) as OutcomeModel;
    if (cached.season === season) return cached;
  }

  const actual = new Map<string, number>();
  let weeks = 0;
  for (let week = 1; week <= 18; week++) {
    const file = path.join(CACHE, `stats-${season}-${week}.json`);
    if (!fs.existsSync(file)) continue;
    weeks++;
    const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<{
      player_id: string;
      stats: StatLine;
    }>;
    for (const row of rows) {
      actual.set(row.player_id, (actual.get(row.player_id) ?? 0) + scoreProjection(row.stats, SCORING));
    }
  }
  if (weeks === 0) {
    throw new Error(`No cached actuals for ${season}. Run: npx tsx scripts/backtest.ts ${season}`);
  }

  const projections = (await getSeasonProjections(season)).filter(hasRealProjection);

  /*
   * Actuals cover only the weeks on disk, so the projection is prorated to the
   * same span before the ratio is taken. Without this every ratio would be
   * scaled down by the missing weeks and the model would read as universal
   * bust risk.
   */
  const scale = weeks / 18;
  const byPosition: Record<string, number[]> = { ALL: [] };

  for (const row of projections) {
    const projected = scoreProjection(row.stats as StatLine, SCORING) * scale;
    const realized = actual.get(row.player_id);
    if (projected < MIN_PROJECTION * scale || realized === undefined) continue;

    const ratio = realized / projected;
    if (!Number.isFinite(ratio)) continue;

    const position = positionById.get(row.player_id) ?? 'UNK';
    (byPosition[position] ??= []).push(ratio);
    byPosition.ALL.push(ratio);
  }

  // Thin positions borrow the pooled distribution rather than inventing a shape
  // from a dozen samples.
  for (const [position, values] of Object.entries(byPosition)) {
    if (position !== 'ALL' && values.length < MIN_SAMPLES) delete byPosition[position];
  }

  const model: OutcomeModel = { season, weeks, ratios: byPosition };
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(MODEL_FILE, JSON.stringify(model));
  return model;
}

/** Draw a multiplier for one player: bootstrap from the empirical ratios. */
export function sampleRatio(model: OutcomeModel, position: string, rng: () => number): number {
  const pool = model.ratios[position] ?? model.ratios.ALL;
  return pool[Math.floor(rng() * pool.length)];
}
