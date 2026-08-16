import { describe, it, expect } from 'vitest';
import {
  ageMultiplier,
  evaluatePosture,
  futureWeight,
  adjustedDynastyValue,
  scoreMove,
  describeMove,
  ordinal,
  type AssetValue,
} from './value';

describe('ageMultiplier', () => {
  it('penalizes running backs past the cliff hardest', () => {
    const rb29 = ageMultiplier('RB', 29);
    const wr29 = ageMultiplier('WR', 29);
    expect(rb29).toBeLessThan(wr29);
    expect(rb29).toBeCloseTo(1 - 2 * 0.13, 4);
  });

  it('leaves a quarterback near his prime untouched at an age that guts an RB', () => {
    expect(ageMultiplier('QB', 30)).toBe(1);
    expect(ageMultiplier('RB', 30)).toBeLessThan(0.65);
  });

  it('gives young players a bounded premium', () => {
    expect(ageMultiplier('RB', 22)).toBeCloseTo(1.06, 4);
    expect(ageMultiplier('RB', 19)).toBeCloseTo(1.12, 4); // capped
    expect(ageMultiplier('WR', 21)).toBeLessThanOrEqual(1.12);
  });

  it('is neutral between peak and cliff', () => {
    expect(ageMultiplier('WR', 27)).toBe(1);
    expect(ageMultiplier('WR', 29)).toBe(1);
  });

  it('floors the decay so an old player never goes to zero', () => {
    expect(ageMultiplier('RB', 40)).toBe(0.25);
  });

  it('is neutral for unknown positions and missing ages', () => {
    expect(ageMultiplier('LB', 30)).toBe(1);
    expect(ageMultiplier('RB', null)).toBe(1);
  });
});

describe('evaluatePosture', () => {
  const league = [80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190];

  it('calls a strong, winning roster a contender', () => {
    const result = evaluatePosture({
      myStartingStrength: 185,
      leagueStartingStrengths: league,
      wins: 7,
      losses: 2,
      weeksRemaining: 5,
      playoffTeams: 6,
      totalTeams: 12,
    });
    expect(result.posture).toBe('contend');
    expect(result.strengthPercentile).toBeGreaterThan(0.8);
  });

  it('calls a weak, losing roster a rebuild', () => {
    const result = evaluatePosture({
      myStartingStrength: 85,
      leagueStartingStrengths: league,
      wins: 2,
      losses: 7,
      weeksRemaining: 5,
      playoffTeams: 6,
      totalTeams: 12,
    });
    expect(result.posture).toBe('rebuild');
  });

  it('weights roster strength over record early in the season', () => {
    // A strong roster that started 0-2 is not a rebuild in week 3.
    const result = evaluatePosture({
      myStartingStrength: 185,
      leagueStartingStrengths: league,
      wins: 0,
      losses: 2,
      weeksRemaining: 12,
      playoffTeams: 6,
      totalTeams: 12,
    });
    expect(result.posture).not.toBe('rebuild');
  });

  it('forces a rebuild late when a weak team is outside the cut', () => {
    const result = evaluatePosture({
      myStartingStrength: 95,
      leagueStartingStrengths: league,
      wins: 3,
      losses: 8,
      weeksRemaining: 2,
      playoffTeams: 6,
      totalTeams: 12,
    });
    expect(result.posture).toBe('rebuild');
    expect(result.score).toBeLessThanOrEqual(0.25);
  });

  it('handles week zero with no games played', () => {
    const result = evaluatePosture({
      myStartingStrength: 140,
      leagueStartingStrengths: league,
      wins: 0,
      losses: 0,
      weeksRemaining: 14,
      playoffTeams: 6,
      totalTeams: 12,
    });
    expect(result.winPct).toBe(0.5);
    expect(['contend', 'bubble', 'rebuild']).toContain(result.posture);
  });
});

describe('futureWeight', () => {
  it('is zero in redraft regardless of posture', () => {
    expect(futureWeight('rebuild', false)).toBe(0);
    expect(futureWeight('contend', false)).toBe(0);
  });

  it('rises as the posture shifts toward rebuilding', () => {
    expect(futureWeight('contend', true)).toBeLessThan(futureWeight('bubble', true));
    expect(futureWeight('bubble', true)).toBeLessThan(futureWeight('rebuild', true));
  });
});

describe('scoreMove', () => {
  const youngWr: AssetValue = { playerId: 'w', position: 'WR', age: 23, dynastyValue: 6000, redraftValue: 4000 };
  const oldRb: AssetValue = { playerId: 'r', position: 'RB', age: 29, dynastyValue: 6000, redraftValue: 5500 };

  it('prefers the younger asset once age adjustment is applied', () => {
    expect(adjustedDynastyValue(youngWr)).toBeGreaterThan(adjustedDynastyValue(oldRb));
  });

  it('zeroes the future axis entirely in redraft', () => {
    const score = scoreMove({
      winNowDelta: 2.5,
      gaining: [oldRb],
      losing: [youngWr],
      posture: 'contend',
      isDynasty: false,
    });
    expect(score.futureDelta).toBe(0);
    expect(score.combined).toBeCloseTo(2.5, 2);
  });

  it('lets win-now dominate for a contender', () => {
    const contender = scoreMove({
      winNowDelta: 3,
      gaining: [oldRb],
      losing: [youngWr],
      posture: 'contend',
      isDynasty: true,
    });
    const rebuilder = scoreMove({
      winNowDelta: 3,
      gaining: [oldRb],
      losing: [youngWr],
      posture: 'rebuild',
      isDynasty: true,
    });

    // Same move: good for the contender, bad for the rebuilder.
    expect(contender.combined).toBeGreaterThan(rebuilder.combined);
    expect(contender.combined).toBeGreaterThan(0);
    expect(rebuilder.combined).toBeLessThan(0);
  });

  it('keeps the two axes separate and reports both', () => {
    const score = scoreMove({
      winNowDelta: -1.2,
      gaining: [youngWr],
      losing: [oldRb],
      posture: 'rebuild',
      isDynasty: true,
    });
    expect(score.winNowDelta).toBe(-1.2);
    expect(score.futureDelta).toBeGreaterThan(0);
  });
});

describe('describeMove', () => {
  it('names the tradeoff differently depending on posture', () => {
    const score = { winNowDelta: -1.5, futureDelta: 4, combined: 1 };
    expect(describeMove(score, 'contend', true)).toMatch(/hard to justify/i);
    expect(describeMove(score, 'rebuild', true)).toMatch(/sensible/i);
  });

  it('flags moves that win or lose on both axes', () => {
    expect(describeMove({ winNowDelta: 2, futureDelta: 2, combined: 2 }, 'bubble', true)).toMatch(/both axes/i);
    expect(describeMove({ winNowDelta: -2, futureDelta: -2, combined: -2 }, 'bubble', true)).toMatch(/skip it/i);
  });

  it('talks only about points in redraft', () => {
    const text = describeMove({ winNowDelta: 3.2, futureDelta: 0, combined: 3.2 }, 'contend', false);
    expect(text).toMatch(/3\.2 projected points/);
    expect(text).not.toMatch(/future/i);
  });
});

describe('ordinal', () => {
  it('handles the 11-13 exceptions that trip naive suffix logic', () => {
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
    expect(ordinal(111)).toBe('111th');
  });

  it('applies st/nd/rd correctly', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(31)).toBe('31st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(43)).toBe('43rd');
    expect(ordinal(50)).toBe('50th');
    expect(ordinal(100)).toBe('100th');
  });
});

describe('posture: effect size over rank', () => {
  // The real MOAT Dynasty week-1 distribution: eleven of fourteen teams inside
  // a 7.7-point band. Rank says 10th; the spread says average.
  const COMPRESSED = [152.1, 148.0, 141.5, 137.1, 136.8, 135.1, 134.9, 134.3, 133.5, 133.2, 132.6, 131.4, 130.8, 129.4];

  const base = {
    leagueStartingStrengths: COMPRESSED,
    wins: 0,
    losses: 0,
    weeksRemaining: 13,
    playoffTeams: 6,
    totalTeams: 14,
  };

  it('does not call a 1%-below-median roster a rebuild', () => {
    const result = evaluatePosture({ ...base, myStartingStrength: 133.2 });
    expect(result.posture).not.toBe('rebuild');
    expect(result.strengthZ).toBeCloseTo(-0.52, 1);
  });

  it('reports low confidence before any games are played', () => {
    expect(evaluatePosture({ ...base, myStartingStrength: 133.2 }).confidence).toBe('low');
    expect(evaluatePosture({ ...base, myStartingStrength: 133.2, wins: 5, losses: 5, weeksRemaining: 4 }).confidence).toBe('high');
  });

  it('still calls a genuinely weak roster a rebuild once the spread is real', () => {
    const spread = [200, 190, 180, 170, 160, 150, 140, 130, 120, 110, 100, 90, 80, 70];
    const result = evaluatePosture({
      ...base,
      leagueStartingStrengths: spread,
      myStartingStrength: 80,
      wins: 2,
      losses: 8,
      weeksRemaining: 4,
    });
    expect(result.posture).toBe('rebuild');
    expect(result.strengthZ).toBeLessThan(-1);
  });

  it('distinguishes identical rank in a tight league from a spread-out one', () => {
    const tight = evaluatePosture({ ...base, myStartingStrength: 133.2 });
    const spreadOut = evaluatePosture({
      ...base,
      leagueStartingStrengths: [200, 190, 180, 170, 160, 150, 140, 130, 120, 110, 100, 90, 80, 70],
      myStartingStrength: 110, // also 10th of 14
    });
    // Same rank, very different reality.
    expect(tight.score).toBeGreaterThan(spreadOut.score);
  });

  it('regresses an early bad record toward .500 rather than treating it as destiny', () => {
    const hotStart = evaluatePosture({ ...base, myStartingStrength: 133.2, wins: 2, losses: 0, weeksRemaining: 12 });
    const coldStart = evaluatePosture({ ...base, myStartingStrength: 133.2, wins: 0, losses: 2, weeksRemaining: 12 });
    // Two games should move the needle, but not flip the verdict.
    expect(Math.abs(hotStart.score - coldStart.score)).toBeLessThan(0.12);
  });
});

describe('posture: trajectory', () => {
  const base = {
    leagueStartingStrengths: [152.1, 148.0, 141.5, 137.1, 136.8, 135.1, 134.9, 134.3, 133.5, 133.2, 132.6, 131.4, 130.8, 129.4],
    myStartingStrength: 133.2,
    wins: 0,
    losses: 0,
    weeksRemaining: 13,
    playoffTeams: 6,
    totalTeams: 14,
    isDynasty: true,
  };

  it('flags a notably young core as ascending', () => {
    const result = evaluatePosture({ ...base, myAvgAge: 24.0, leagueAvgAge: 26.5 });
    expect(result.trajectory).toBe('ascending');
    expect(result.reasoning).toMatch(/improves on its own/i);
  });

  it('flags an old core as aging', () => {
    const result = evaluatePosture({ ...base, myAvgAge: 28.5, leagueAvgAge: 26.5 });
    expect(result.trajectory).toBe('aging');
    expect(result.reasoning).toMatch(/window is closing/i);
  });

  it('stays stable when ages are close', () => {
    expect(evaluatePosture({ ...base, myAvgAge: 26.3, leagueAvgAge: 26.5 }).trajectory).toBe('stable');
  });

  it('ignores age entirely in redraft', () => {
    const result = evaluatePosture({ ...base, isDynasty: false, myAvgAge: 23, leagueAvgAge: 28 });
    expect(result.trajectory).toBe('stable');
  });
});

describe('futureWeight: trajectory adjustment', () => {
  it('tells an already-young rebuilder to hoard less youth', () => {
    const youngRebuilder = futureWeight('rebuild', true, 'ascending');
    const oldRebuilder = futureWeight('rebuild', true, 'aging');
    expect(youngRebuilder).toBeLessThan(futureWeight('rebuild', true, 'stable'));
    expect(oldRebuilder).toBeGreaterThan(futureWeight('rebuild', true, 'stable'));
  });

  it('keeps the weight inside sane bounds', () => {
    for (const posture of ['contend', 'bubble', 'rebuild'] as const) {
      for (const trajectory of ['ascending', 'stable', 'aging'] as const) {
        const w = futureWeight(posture, true, trajectory);
        expect(w).toBeGreaterThanOrEqual(0.15);
        expect(w).toBeLessThanOrEqual(0.9);
      }
    }
  });

  it('is still zero in redraft regardless of trajectory', () => {
    expect(futureWeight('rebuild', false, 'ascending')).toBe(0);
  });
});
