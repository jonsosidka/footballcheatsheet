import type { ScoringSettings, StatLine } from '@/db/schema';

/**
 * Keys that appear in Sleeper projection payloads but are metadata, not
 * scorable stats. Sleeper's own scoring_settings never contains these, so the
 * intersection is already safe — this is belt-and-braces against a league with
 * an exotic custom key colliding with a metadata field.
 */
const NON_STAT_KEYS = new Set([
  'gp',
  'gms_active',
  'pts_ppr',
  'pts_std',
  'pts_half_ppr',
  'rank_ppr',
  'rank_std',
  'rank_half_ppr',
]);

const isNonStat = (key: string) => NON_STAT_KEYS.has(key) || key.startsWith('adp') || key.startsWith('pos_adp');

/**
 * Compute exact league-scored fantasy points for a stat line.
 *
 * This works because Sleeper's projection payloads and a league's
 * `scoring_settings` use identical stat keys (`rush_yd`, `rec`, `pass_td`,
 * `bonus_rec_te`, `fum_lost`, ...). Scoring is therefore a dot product over the
 * intersection of the two maps — which means a 0.5 PPR TE-premium league with a
 * 100-yard rushing bonus gets a genuinely correct number, not a PPR
 * approximation nudged by hand.
 *
 * Stats present in the projection but absent from scoring_settings score zero
 * (the league doesn't count them). Stats in scoring_settings but absent from
 * the projection contribute zero (the player isn't projected for them).
 */
export function scoreProjection(stats: StatLine | null | undefined, scoring: ScoringSettings): number {
  if (!stats) return 0;
  let total = 0;
  for (const [key, value] of Object.entries(stats)) {
    if (isNonStat(key)) continue;
    const multiplier = scoring[key];
    if (multiplier === undefined || value === null || value === undefined) continue;
    if (!Number.isFinite(value) || !Number.isFinite(multiplier)) continue;
    total += value * multiplier;
  }
  return round2(total);
}

export interface ScoringContribution {
  key: string;
  stat: number;
  multiplier: number;
  points: number;
}

/**
 * Same math as scoreProjection but returns the per-stat breakdown, largest
 * contribution first. Powers the "why is he projected for 14.2?" explanation in
 * the UI — advice you can't interrogate is advice you won't trust.
 */
export function explainProjection(
  stats: StatLine | null | undefined,
  scoring: ScoringSettings,
): { total: number; contributions: ScoringContribution[] } {
  if (!stats) return { total: 0, contributions: [] };
  const contributions: ScoringContribution[] = [];
  let total = 0;

  for (const [key, value] of Object.entries(stats)) {
    if (isNonStat(key)) continue;
    const multiplier = scoring[key];
    if (multiplier === undefined || value === null || value === undefined) continue;
    if (!Number.isFinite(value) || !Number.isFinite(multiplier)) continue;
    const points = value * multiplier;
    if (points === 0) continue;
    total += points;
    contributions.push({ key, stat: value, multiplier, points: round2(points) });
  }

  contributions.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  return { total: round2(total), contributions };
}

/** Full PPR / half / standard, inferred from the league's reception value. */
export function pprType(scoring: ScoringSettings): number {
  return scoring.rec ?? 0;
}

/**
 * A league is superflex if any slot can be filled by a QB beyond the dedicated
 * QB slots. This materially changes QB value (and which FantasyCalc shape we
 * pull), so it's derived once at import.
 */
export function isSuperflexRoster(rosterPositions: string[]): boolean {
  if (rosterPositions.some((p) => p === 'SUPER_FLEX' || p === 'SUPERFLEX' || p === 'QB_FLEX')) {
    return true;
  }
  return rosterPositions.filter((p) => p === 'QB').length > 1;
}

/** Starting-lineup slots only — excludes bench, IR and taxi. */
export function startingSlots(rosterPositions: string[]): string[] {
  return rosterPositions.filter((p) => p !== 'BN' && p !== 'IR' && p !== 'TAXI');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
