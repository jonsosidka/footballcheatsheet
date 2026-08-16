import { describe, it, expect } from 'vitest';
import {
  americanToImpliedProb,
  deVig,
  impliedTeamTotals,
  gameScript,
  baseImpliedTeamPoints,
  applyMarketLayer,
  anytimeTdToExpectedTds,
  lineToMean,
  propToExpectation,
  applyPropLayer,
  blend,
  normalInverseCdf,
  normalizeRatio,
} from './market';
import type { StatLine } from '@/db/schema';
import { parseShortName } from '@/lib/sources/espn-odds';

describe('americanToImpliedProb', () => {
  it('converts favorites and underdogs', () => {
    expect(americanToImpliedProb(-110)).toBeCloseTo(0.5238, 4);
    expect(americanToImpliedProb(+150)).toBeCloseTo(0.4, 4);
    expect(americanToImpliedProb(-220)).toBeCloseTo(0.6875, 4);
    expect(americanToImpliedProb(+180)).toBeCloseTo(0.3571, 4);
  });
});

describe('deVig', () => {
  it('turns a standard -110/-110 pair into a true coin flip', () => {
    // The whole point: raw implied probs are 52.38% each (104.76% book).
    // Treating that as a forecast overstates both sides.
    const result = deVig(-110, -110)!;
    expect(result.overProb).toBeCloseTo(0.5, 6);
    expect(result.underProb).toBeCloseTo(0.5, 6);
    expect(result.vig).toBeCloseTo(0.0476, 4);
  });

  it('preserves asymmetry while removing the margin', () => {
    const result = deVig(-105, -115)!;
    expect(result.overProb + result.underProb).toBeCloseTo(1, 10);
    // -105 is the cheaper side, so the over is less likely than the under.
    expect(result.overProb).toBeLessThan(result.underProb);
    // raw: 105/205 = .5122, 115/215 = .5349, sum 1.0471 -> .5122/1.0471
    expect(result.overProb).toBeCloseTo(0.4892, 3);
  });

  it('returns null on malformed input', () => {
    expect(deVig(0, -110)).toBeNull();
    expect(deVig(NaN, -110)).toBeNull();
  });
});

describe('impliedTeamTotals', () => {
  it('splits a total using the home spread', () => {
    // Verified live: NE @ SEA, total 37.5, home spread -6.5
    const totals = impliedTeamTotals(-6.5, 37.5)!;
    expect(totals.home).toBeCloseTo(22, 6);
    expect(totals.away).toBeCloseTo(15.5, 6);
    expect(totals.home + totals.away).toBeCloseTo(37.5, 6);
    expect(totals.home - totals.away).toBeCloseTo(6.5, 6);
  });

  it('handles a road favorite', () => {
    const totals = impliedTeamTotals(+4, 44.5)!;
    expect(totals.away).toBeCloseTo(24.25, 6);
    expect(totals.home).toBeCloseTo(20.25, 6);
  });

  it('returns null when the market has no line', () => {
    expect(impliedTeamTotals(null, 44.5)).toBeNull();
    expect(impliedTeamTotals(-3, null)).toBeNull();
  });
});

describe('gameScript', () => {
  it('tilts a favorite toward rushing and a dog toward passing', () => {
    const favorite = gameScript(-10);
    expect(favorite.rushMultiplier).toBeGreaterThan(1);
    expect(favorite.passMultiplier).toBeLessThan(1);

    const underdog = gameScript(+10);
    expect(underdog.passMultiplier).toBeGreaterThan(1);
    expect(underdog.rushMultiplier).toBeLessThan(1);
  });

  it('is neutral in a pick-em', () => {
    const pickEm = gameScript(0);
    expect(pickEm.passMultiplier).toBeCloseTo(1, 6);
    expect(pickEm.rushMultiplier).toBeCloseTo(1, 6);
  });

  it('caps the tilt so a blowout line cannot distort projections', () => {
    const extreme = gameScript(-40);
    expect(extreme.rushMultiplier).toBeLessThanOrEqual(1.18001);
  });
});

describe('baseImpliedTeamPoints', () => {
  it('estimates offensive points without double-counting passing and receiving TDs', () => {
    // A passing TD and its receiving TD are the same event.
    const team: StatLine[] = [
      { pass_td: 2, pass_yd: 260 },
      { rec_td: 2, rec_yd: 180 },
      { rush_td: 1, rush_yd: 95 },
    ];
    // 3 TDs * 6 = 18, plus ~0.94 XP each = ~20.82
    expect(baseImpliedTeamPoints(team)).toBeCloseTo(20.82, 1);
  });

  it('uses real kicker projections when present', () => {
    const team: StatLine[] = [{ pass_td: 2 }, { rush_td: 1 }, { fgm: 2, xpm: 3 }];
    // 18 + 3 XP + 6 FG = 27
    expect(baseImpliedTeamPoints(team)).toBeCloseTo(27, 6);
  });
});

describe('applyMarketLayer', () => {
  const base = { rush_yd: 60, rush_td: 0.5, rec: 3, rec_yd: 30, rec_td: 0.2, rec_tgt: 4 };

  it('scales projections up when the market expects more scoring than the base', () => {
    const boosted = applyMarketLayer(base, {
      impliedTeamPoints: 28,
      baseTeamPoints: 21,
      teamSpread: 0,
    });
    // ratio 1.333, damped 0.5 -> 1.167
    expect(boosted.rush_yd).toBeGreaterThan(base.rush_yd);
    expect(boosted.rush_yd).toBeCloseTo(60 * 1.1667, 1);
  });

  it('scales down when the market is bearish on the offense', () => {
    const cut = applyMarketLayer(base, {
      impliedTeamPoints: 14,
      baseTeamPoints: 21,
      teamSpread: 0,
    });
    expect(cut.rec_yd).toBeLessThan(base.rec_yd);
  });

  it('moves rushing and receiving in opposite directions on a big spread', () => {
    const favored = applyMarketLayer(base, {
      impliedTeamPoints: 21,
      baseTeamPoints: 21,
      teamSpread: -10,
    });
    // Same scoring environment, but game script favors the run.
    expect(favored.rush_yd).toBeGreaterThan(base.rush_yd);
    expect(favored.rec_yd).toBeLessThan(base.rec_yd);
  });

  it('passes through stats that are not scoring-environment dependent', () => {
    const out = applyMarketLayer({ ...base, adp_ppr: 120, gp: 1, fum_lost: 0.05 }, {
      impliedTeamPoints: 28,
      baseTeamPoints: 21,
      teamSpread: -3,
    });
    expect(out.adp_ppr).toBe(120);
    expect(out.gp).toBe(1);
    expect(out.fum_lost).toBe(0.05);
  });

  it('is a no-op when the market agrees with the base and the game is a pick-em', () => {
    const out = applyMarketLayer(base, { impliedTeamPoints: 21, baseTeamPoints: 21, teamSpread: 0 });
    expect(out.rush_yd).toBeCloseTo(base.rush_yd, 6);
    expect(out.rec_yd).toBeCloseTo(base.rec_yd, 6);
  });

  it('falls back to the base line when there is no usable base total', () => {
    const out = applyMarketLayer(base, { impliedTeamPoints: 28, baseTeamPoints: 0, teamSpread: 0 });
    expect(out.rush_yd).toBeCloseTo(base.rush_yd, 6);
  });

  it('is neutral for a league-average matchup once normalized', () => {
    // baseTeamPoints is summed over only the players we fetched, so it is
    // systematically low and every raw ratio exceeds 1. Normalizing by the
    // league median must leave an average team untouched.
    const out = applyMarketLayer(base, {
      impliedTeamPoints: 24,
      baseTeamPoints: 20,
      teamSpread: 0,
      normalization: 24 / 20,
    });
    expect(out.rush_yd).toBeCloseTo(base.rush_yd, 6);
    expect(out.rec_yd).toBeCloseTo(base.rec_yd, 6);
  });

  it('still moves teams the market likes more than their peers', () => {
    const leagueMedian = 1.2;
    const better = applyMarketLayer(base, {
      impliedTeamPoints: 30,
      baseTeamPoints: 20, // ratio 1.5 vs median 1.2 -> above average
      teamSpread: 0,
      normalization: leagueMedian,
    });
    const worse = applyMarketLayer(base, {
      impliedTeamPoints: 18,
      baseTeamPoints: 20, // ratio 0.9 -> below average
      teamSpread: 0,
      normalization: leagueMedian,
    });
    expect(better.rush_yd).toBeGreaterThan(base.rush_yd);
    expect(worse.rush_yd).toBeLessThan(base.rush_yd);
  });
});

describe('normalizeRatio', () => {
  it('returns the median so one outlier cannot drag the baseline', () => {
    expect(normalizeRatio([1.0, 1.1, 1.2, 1.3, 9.9])).toBeCloseTo(1.2, 6);
  });

  it('averages the middle pair for an even count', () => {
    expect(normalizeRatio([1.0, 1.2, 1.4, 1.6])).toBeCloseTo(1.3, 6);
  });

  it('ignores non-finite and non-positive ratios', () => {
    expect(normalizeRatio([NaN, 0, -1, 1.5, 1.5])).toBeCloseTo(1.5, 6);
  });

  it('is a safe no-op when there is nothing to normalize', () => {
    expect(normalizeRatio([])).toBe(1);
  });
});

describe('anytimeTdToExpectedTds', () => {
  it('exceeds the naive probability because of multi-TD games', () => {
    // The naive read of a 45% anytime-TD player is 0.45 expected TDs.
    // Poisson says 0.598 — worth about a full point in a 6-pt-TD league.
    expect(anytimeTdToExpectedTds(0.45)).toBeCloseTo(0.5978, 3);
    expect(anytimeTdToExpectedTds(0.45)).toBeGreaterThan(0.45);
  });

  it('is near-identity for low probabilities', () => {
    expect(anytimeTdToExpectedTds(0.05)).toBeCloseTo(0.0513, 3);
  });

  it('handles degenerate input', () => {
    expect(anytimeTdToExpectedTds(0)).toBe(0);
    expect(anytimeTdToExpectedTds(-1)).toBe(0);
    expect(Number.isFinite(anytimeTdToExpectedTds(1))).toBe(true);
  });
});

describe('lineToMean', () => {
  it('returns the line itself when the market is a true coin flip', () => {
    expect(lineToMean('rush_yd', 65.5, 0.5)).toBeCloseTo(65.5, 6);
  });

  it('shifts the mean above the line when the over is favored', () => {
    const mean = lineToMean('rush_yd', 65.5, 0.58);
    expect(mean).toBeGreaterThan(65.5);
  });

  it('shifts the mean below the line when the under is favored', () => {
    expect(lineToMean('rec_yd', 50, 0.42)).toBeLessThan(50);
  });

  it('falls back to the line for markets with no dispersion model', () => {
    expect(lineToMean('unknown_market', 40, 0.7)).toBe(40);
  });
});

describe('propToExpectation', () => {
  it('de-vigs a yardage prop before converting', () => {
    const result = propToExpectation({ market: 'rush_yd', line: 70.5, overOdds: -110, underOdds: -110 })!;
    expect(result.mean).toBeCloseTo(70.5, 4);
  });

  it('converts an anytime-TD market via Poisson', () => {
    const result = propToExpectation({ market: 'anytime_td', line: null, overOdds: +100, underOdds: -120 })!;
    // de-vigged yes-prob ~0.4762 -> lambda ~0.646
    expect(result.market).toBe('anytime_td');
    expect(result.mean).toBeCloseTo(0.6463, 2);
  });

  it('returns null on incomplete props so callers fall back rather than guess', () => {
    expect(propToExpectation({ market: 'rush_yd', line: null, overOdds: -110, underOdds: -110 })).toBeNull();
    expect(propToExpectation({ market: 'rush_yd', line: 50, overOdds: null, underOdds: -110 })).toBeNull();
  });
});

describe('applyPropLayer', () => {
  it('overrides only the stats the props cover', () => {
    const base = { rush_yd: 60, rush_td: 0.5, rec: 3, rec_yd: 30, rec_tgt: 4 };
    const out = applyPropLayer(base, [
      { market: 'rush_yd', line: 80.5, overOdds: -110, underOdds: -110 },
    ]);
    expect(out.rush_yd).toBeCloseTo(80.5, 3);
    expect(out.rec).toBe(3); // untouched
    expect(out.rec_tgt).toBe(4);
  });

  it('splits anytime-TD expectation along the base rush/rec ratio', () => {
    const base = { rush_td: 0.6, rec_td: 0.2 }; // 75/25 split
    const out = applyPropLayer(base, [
      { market: 'anytime_td', line: null, overOdds: -110, underOdds: -110 },
    ]);
    const lambda = anytimeTdToExpectedTds(0.5);
    expect(out.rush_td).toBeCloseTo(lambda * 0.75, 4);
    expect(out.rec_td).toBeCloseTo(lambda * 0.25, 4);
    expect(out.rush_td! + out.rec_td!).toBeCloseTo(lambda, 4);
  });

  it('leaves the line untouched when a prop cannot be interpreted', () => {
    const base = { rush_yd: 60 };
    const out = applyPropLayer(base, [{ market: 'rush_yd', line: null, overOdds: null, underOdds: null }]);
    expect(out.rush_yd).toBe(60);
  });
});

describe('blend', () => {
  const weights = { base: 0.3, market: 0.5, props: 0.2 };

  it('weights all three layers when present', () => {
    expect(blend({ base: 10, market: 12, props: 14 }, weights)).toBeCloseTo(0.3 * 10 + 0.5 * 12 + 0.2 * 14, 2);
  });

  it('renormalizes when props are missing, rather than penalizing the player', () => {
    // A waiver target with no props must not be scored as if his prop was zero.
    const result = blend({ base: 10, market: 12, props: null }, weights);
    expect(result).toBeCloseTo((0.3 * 10 + 0.5 * 12) / 0.8, 2);
    expect(result).toBeGreaterThan(10);
  });

  it('falls back to the base when no other layer is available', () => {
    expect(blend({ base: 9.4, market: null, props: null }, weights)).toBeCloseTo(9.4, 2);
  });

  it('returns the base when weights are degenerate', () => {
    expect(blend({ base: 9.4 }, { base: 0, market: 0, props: 0 })).toBe(9.4);
  });
});

describe('normalInverseCdf', () => {
  it('matches known quantiles', () => {
    expect(normalInverseCdf(0.5)).toBeCloseTo(0, 6);
    expect(normalInverseCdf(0.975)).toBeCloseTo(1.959964, 4);
    expect(normalInverseCdf(0.025)).toBeCloseTo(-1.959964, 4);
    expect(normalInverseCdf(0.84134)).toBeCloseTo(1, 3);
  });

  it('rejects out-of-domain input', () => {
    expect(Number.isNaN(normalInverseCdf(0))).toBe(true);
    expect(Number.isNaN(normalInverseCdf(1))).toBe(true);
  });
});

describe('parseShortName (ESPN core event)', () => {
  it('parses away @ home', () => {
    expect(parseShortName('NE @ SEA')).toEqual({ away: 'NE', home: 'SEA' });
    expect(parseShortName('CAR @ TB')).toEqual({ away: 'CAR', home: 'TB' });
  });

  it('normalizes ESPN abbreviations that differ from Sleeper', () => {
    expect(parseShortName('WSH @ DAL')).toEqual({ away: 'WAS', home: 'DAL' });
  });

  it('handles the VS separator ESPN uses for neutral-site games', () => {
    // "SF VS LAR" is the same away-at-home ordering as "@". Missing this
    // dropped one game a week from the market layer entirely.
    expect(parseShortName('SF VS LAR')).toEqual({ away: 'SF', home: 'LAR' });
    expect(parseShortName('SF vs LAR')).toEqual({ away: 'SF', home: 'LAR' });
  });

  it('returns null rather than guessing on an unexpected format', () => {
    expect(parseShortName('New England at Seattle')).toBeNull();
    expect(parseShortName('')).toBeNull();
  });
});
