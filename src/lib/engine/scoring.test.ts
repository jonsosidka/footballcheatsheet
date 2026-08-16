import { describe, it, expect } from 'vitest';
import { scoreProjection, explainProjection, isSuperflexRoster, startingSlots } from './scoring';
import type { ScoringSettings } from '@/db/schema';

/** A realistic half-PPR config with a TE premium, as Sleeper serializes it. */
const HALF_PPR_TE_PREMIUM: ScoringSettings = {
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -2,
  rush_yd: 0.1,
  rush_td: 6,
  rec: 0.5,
  bonus_rec_te: 0.5,
  rec_yd: 0.1,
  rec_td: 6,
  fum_lost: -2,
};

describe('scoreProjection', () => {
  it('computes a hand-verified stat line exactly', () => {
    // 53.03 rush yd (5.303) + 0.42 rush td (2.52) + 1.0 rec (0.5)
    // + 8.59 rec yd (0.859) + 0.06 rec td (0.36) + 0.06 fum_lost (-0.12)
    const stats = {
      rush_yd: 53.03,
      rush_td: 0.42,
      rec: 1.0,
      rec_yd: 8.59,
      rec_td: 0.06,
      fum_lost: 0.06,
    };
    const expected = 5.303 + 2.52 + 0.5 + 0.859 + 0.36 - 0.12;
    expect(scoreProjection(stats, HALF_PPR_TE_PREMIUM)).toBeCloseTo(expected, 2);
  });

  it('applies the TE premium bonus that generic PPR scoring would miss', () => {
    const teLine = { rec: 6, rec_yd: 70, bonus_rec_te: 6 };
    // 6 receptions * 0.5 + 70 * 0.1 + 6 TE-bonus receptions * 0.5 = 3 + 7 + 3
    expect(scoreProjection(teLine, HALF_PPR_TE_PREMIUM)).toBeCloseTo(13, 2);

    // Without the premium key in scoring settings, the bonus must not count.
    const noPremium: ScoringSettings = { ...HALF_PPR_TE_PREMIUM };
    delete noPremium.bonus_rec_te;
    expect(scoreProjection(teLine, noPremium)).toBeCloseTo(10, 2);
  });

  it('applies negative multipliers', () => {
    expect(scoreProjection({ pass_int: 2 }, HALF_PPR_TE_PREMIUM)).toBeCloseTo(-4, 2);
  });

  it('ignores stats the league does not score', () => {
    expect(scoreProjection({ rec_tgt: 12, rush_att: 20 }, HALF_PPR_TE_PREMIUM)).toBe(0);
  });

  it('ignores ADP and metadata keys even if they collide with scoring settings', () => {
    const hostile: ScoringSettings = { ...HALF_PPR_TE_PREMIUM, adp_ppr: 5, gp: 10, pts_ppr: 1 };
    const stats = { adp_ppr: 120, gp: 1, pts_ppr: 18.4, rush_yd: 100 };
    // Only rush_yd should score: 100 * 0.1
    expect(scoreProjection(stats, hostile)).toBeCloseTo(10, 2);
  });

  it('is resilient to null, undefined and non-finite values', () => {
    expect(scoreProjection(null, HALF_PPR_TE_PREMIUM)).toBe(0);
    expect(scoreProjection(undefined, HALF_PPR_TE_PREMIUM)).toBe(0);
    expect(scoreProjection({ rush_yd: NaN, rec: 3 }, HALF_PPR_TE_PREMIUM)).toBeCloseTo(1.5, 2);
  });
});

describe('explainProjection', () => {
  it('breaks down contributions largest-first and agrees with the total', () => {
    const stats = { rush_yd: 80, rush_td: 0.5, rec: 2, rec_yd: 15 };
    const { total, contributions } = explainProjection(stats, HALF_PPR_TE_PREMIUM);

    expect(total).toBeCloseTo(scoreProjection(stats, HALF_PPR_TE_PREMIUM), 2);
    expect(contributions[0].key).toBe('rush_yd'); // 80 * 0.1 = 8.0, the largest chunk
    expect(contributions[0].points).toBeCloseTo(8, 2);
    expect(contributions[1].key).toBe('rush_td'); // 0.5 * 6 = 3.0

    const summed = contributions.reduce((s, c) => s + c.points, 0);
    expect(summed).toBeCloseTo(total, 1);
  });

  it('omits zero-point contributions', () => {
    const { contributions } = explainProjection({ rush_yd: 0, rec: 4 }, HALF_PPR_TE_PREMIUM);
    expect(contributions.map((c) => c.key)).toEqual(['rec']);
  });
});

describe('roster shape helpers', () => {
  it('detects superflex via an explicit slot', () => {
    expect(isSuperflexRoster(['QB', 'RB', 'WR', 'SUPER_FLEX', 'BN'])).toBe(true);
  });

  it('detects superflex via two dedicated QB slots', () => {
    expect(isSuperflexRoster(['QB', 'QB', 'RB', 'WR', 'BN'])).toBe(true);
  });

  it('does not flag a single-QB league', () => {
    expect(isSuperflexRoster(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN'])).toBe(false);
  });

  it('excludes bench, IR and taxi from starting slots', () => {
    const positions = ['QB', 'RB', 'WR', 'FLEX', 'BN', 'BN', 'IR', 'TAXI'];
    expect(startingSlots(positions)).toEqual(['QB', 'RB', 'WR', 'FLEX']);
  });
});
