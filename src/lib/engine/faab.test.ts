import { describe, it, expect } from 'vitest';
import { waiverSystem, recommendBid, evaluatePriorityClaim } from './faab';

describe('waiverSystem', () => {
  it('maps Sleeper waiver_type correctly', () => {
    expect(waiverSystem(1)).toBe('faab');
    expect(waiverSystem(0)).toBe('rolling');
    expect(waiverSystem(2)).toBe('reverse');
    expect(waiverSystem(undefined)).toBe('rolling');
  });
});

describe('recommendBid', () => {
  const base = {
    winNowDelta: 40,
    topAvailablePoints: 80,
    budgetTotal: 100,
    budgetUsed: 0,
    weeksRemaining: 12,
    trendingAdds: 0,
    coversBye: false,
  };

  it('scales the bid with value relative to the best player available', () => {
    const strong = recommendBid({ ...base, winNowDelta: 80 });
    const weak = recommendBid({ ...base, winNowDelta: 10 });
    expect(strong.amount).toBeGreaterThan(weak.amount);
  });

  it('never recommends more than 45% of budget on one player', () => {
    const huge = recommendBid({ ...base, winNowDelta: 500, trendingAdds: 90_000, coversBye: true });
    expect(huge.percent).toBeLessThanOrEqual(45);
  });

  it('bids less late in the season with fewer weeks to pay off', () => {
    const early = recommendBid({ ...base, weeksRemaining: 12 });
    const late = recommendBid({ ...base, weeksRemaining: 2 });
    expect(late.amount).toBeLessThan(early.amount);
    expect(late.rationale).toMatch(/limited weeks/i);
  });

  it('pays a premium for a contested player', () => {
    const quiet = recommendBid({ ...base, trendingAdds: 100 });
    const hot = recommendBid({ ...base, trendingAdds: 50_000 });
    expect(hot.amount).toBeGreaterThan(quiet.amount);
    expect(hot.rationale).toMatch(/contested/i);
  });

  it('pays up for a bye-week fill', () => {
    expect(recommendBid({ ...base, coversBye: true }).amount).toBeGreaterThan(recommendBid(base).amount);
  });

  it('bids against what is left, not the original budget', () => {
    const broke = recommendBid({ ...base, budgetUsed: 95 });
    expect(broke.remaining).toBe(5);
    expect(broke.amount).toBeLessThanOrEqual(5);
    expect(broke.high).toBeLessThanOrEqual(5);
  });

  it('says so plainly when the budget is gone', () => {
    const empty = recommendBid({ ...base, budgetUsed: 100 });
    expect(empty.amount).toBe(0);
    expect(empty.rationale).toMatch(/no faab left/i);
  });

  it('recommends nothing for a worthless add', () => {
    const nothing = recommendBid({ ...base, winNowDelta: 0 });
    expect(nothing.amount).toBe(0);
    expect(nothing.rationale).toMatch(/not worth a bid/i);
  });
});

describe('evaluatePriorityClaim', () => {
  it('protects a high waiver position from a marginal add', () => {
    const result = evaluatePriorityClaim({
      winNowDelta: 4,
      waiverPosition: 2,
      totalTeams: 14,
      coversBye: false,
      system: 'rolling',
    });
    expect(result.worthBurning).toBe(false);
    expect(result.rationale).toMatch(/wait for him to clear/i);
  });

  it('spends a low waiver position freely', () => {
    const result = evaluatePriorityClaim({
      winNowDelta: 4,
      waiverPosition: 12,
      totalTeams: 14,
      coversBye: false,
      system: 'rolling',
    });
    expect(result.rationale).toMatch(/costs little/i);
  });

  it('burns a top position for a real upgrade', () => {
    const result = evaluatePriorityClaim({
      winNowDelta: 45,
      waiverPosition: 1,
      totalTeams: 14,
      coversBye: false,
      system: 'rolling',
    });
    expect(result.worthBurning).toBe(true);
  });

  it('treats a bye-week fill as worth claiming even at low raw value', () => {
    const result = evaluatePriorityClaim({
      winNowDelta: 3,
      waiverPosition: 3,
      totalTeams: 14,
      coversBye: true,
      system: 'rolling',
    });
    expect(result.worthBurning).toBe(true);
    expect(result.rationale).toMatch(/bye-week hole/i);
  });
});
