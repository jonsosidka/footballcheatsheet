import { describe, it, expect } from 'vitest';
import {
  findPromotions,
  applyPromotion,
  PROMOTION_MULTIPLIERS,
  type VacancyCandidate,
} from './vacancy';

const p = (
  playerId: string,
  position: string,
  healthyPoints: number,
  extra: Partial<VacancyCandidate> = {},
): VacancyCandidate => ({
  playerId,
  position,
  team: 'SF',
  healthyPoints,
  startable: true,
  playStatus: 'active',
  ...extra,
});

const out = (id: string, pos: string, pts: number) =>
  p(id, pos, pts, { startable: false, playStatus: 'out' });

describe('findPromotions', () => {
  it('promotes the backup when the lead back is ruled out', () => {
    const promotions = findPromotions([out('rb1', 'RB', 16), p('rb2', 'RB', 5)]);
    const promotion = promotions.get('rb2');

    expect(promotion).toBeDefined();
    expect(promotion!.multiplier).toBe(PROMOTION_MULTIPLIERS.RB);
    expect(promotion!.vacatedBy).toBe('rb1');
  });

  it('leaves receivers alone — the study found no effect there', () => {
    const promotions = findPromotions([out('wr1', 'WR', 18), p('wr2', 'WR', 7)]);
    expect(promotions.size).toBe(0);
  });

  it('promotes a tight end, where the effect is real', () => {
    const promotions = findPromotions([out('te1', 'TE', 11), p('te2', 'TE', 3)]);
    expect(promotions.get('te2')?.multiplier).toBe(PROMOTION_MULTIPLIERS.TE);
  });

  it('does nothing when the starter is playing', () => {
    expect(findPromotions([p('rb1', 'RB', 16), p('rb2', 'RB', 5)]).size).toBe(0);
  });

  it('treats a bye as vacating nothing, since the backup is off too', () => {
    const onBye = p('rb1', 'RB', 16, { startable: false, playStatus: 'bye' });
    const alsoBye = p('rb2', 'RB', 5, { startable: false, playStatus: 'bye' });
    expect(findPromotions([onBye, alsoBye]).size).toBe(0);
  });

  it('does not promote a backup who is himself out', () => {
    expect(findPromotions([out('rb1', 'RB', 16), out('rb2', 'RB', 5)]).size).toBe(0);
  });

  it('ignores the absence of a player nobody was starting anyway', () => {
    // Two committee afterthoughts should not hand each other a raise.
    expect(findPromotions([out('rb1', 'RB', 3), p('rb2', 'RB', 2)]).size).toBe(0);
  });

  it('promotes only the immediate next man, not the whole depth chart', () => {
    const promotions = findPromotions([
      out('rb1', 'RB', 16),
      p('rb2', 'RB', 6),
      p('rb3', 'RB', 2),
    ]);
    expect([...promotions.keys()]).toEqual(['rb2']);
  });

  it('keeps teams separate', () => {
    const promotions = findPromotions([
      out('sf1', 'RB', 16),
      p('dal2', 'RB', 5, { team: 'DAL' }),
    ]);
    expect(promotions.size).toBe(0);
  });
});

describe('applyPromotion', () => {
  it('scales the backup by the measured multiplier when we have no history', () => {
    const promotion = findPromotions([out('rb1', 'RB', 20), p('rb2', 'RB', 5)]).get('rb2')!;
    expect(applyPromotion(5, promotion)).toBeCloseTo(9.3, 5);
  });

  it('never lets a promoted backup out-project the man he replaced', () => {
    // 9 * 1.86 = 16.74, but the starter he is standing in for was worth 10.
    const promotion = findPromotions([out('rb1', 'RB', 10), p('rb2', 'RB', 9)]).get('rb2')!;
    expect(applyPromotion(9, promotion)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Not double counting what the feed already did
// ---------------------------------------------------------------------------

const MONDAY = new Date('2025-09-15T12:00:00Z');
const WEDNESDAY = new Date('2025-09-17T12:00:00Z');
const SUNDAY = new Date('2025-09-21T15:30:00Z');

describe('crediting the feed for what it has already priced in', () => {
  it('adds the full lift when the feed has not moved him at all', () => {
    // News broke Sunday morning; the line has sat at 5.0 since Wednesday.
    const starter = { ...out('rb1', 'RB', 16), statusChangedAt: SUNDAY };
    const backup = p('rb2', 'RB', 5, { openingPoints: 5, openedAt: WEDNESDAY });

    const promotion = findPromotions([starter, backup]).get('rb2')!;
    expect(promotion.claimedByFeed).toBe(0);
    expect(promotion.unclaimed).toBeCloseTo(4.3, 5);
    expect(applyPromotion(5, promotion)).toBeCloseTo(9.3, 5);
  });

  it('adds only the remainder when the feed has partly reacted', () => {
    // Opened at 5.0, feed has since moved him to 7.0. Measured lift on a 5.0
    // opening is 4.3, so 2.0 is spoken for and 2.3 is ours.
    const starter = { ...out('rb1', 'RB', 16), statusChangedAt: SUNDAY };
    const backup = p('rb2', 'RB', 7, { openingPoints: 5, openedAt: WEDNESDAY });

    const promotion = findPromotions([starter, backup]).get('rb2')!;
    expect(promotion.claimedByFeed).toBeCloseTo(2, 5);
    expect(promotion.unclaimed).toBeCloseTo(2.3, 5);
    expect(applyPromotion(7, promotion)).toBeCloseTo(9.3, 5);
  });

  it('adds nothing when the feed has already taken the whole lift', () => {
    // Opened at 5.0 and the feed has him at 10.0 — more than the 4.3 the
    // study says the promotion is worth. Adding on top would be invention.
    const starter = { ...out('rb1', 'RB', 16), statusChangedAt: SUNDAY };
    const backup = p('rb2', 'RB', 10, { openingPoints: 5, openedAt: WEDNESDAY });

    expect(findPromotions([starter, backup]).has('rb2')).toBe(false);
  });

  it('adds nothing when the absence was known before the line was published', () => {
    /*
     * The long-term injury case. The starter went on IR Monday, the week's
     * line was published Wednesday already treating the backup as the starter.
     * His opening number IS the promoted number; there is no news to be ahead
     * of, whatever the two projections happen to look like.
     */
    const starter = { ...out('rb1', 'RB', 16), statusChangedAt: MONDAY };
    const backup = p('rb2', 'RB', 12, { openingPoints: 12, openedAt: WEDNESDAY });

    expect(findPromotions([starter, backup]).has('rb2')).toBe(false);
  });

  it('still fires when the news lands after a line that already drifted up', () => {
    // Drift before the news is not a reaction to it, but the arithmetic is
    // conservative either way: it counts as claimed.
    const starter = { ...out('rb1', 'RB', 16), statusChangedAt: SUNDAY };
    const backup = p('rb2', 'RB', 6, { openingPoints: 5, openedAt: WEDNESDAY });

    const promotion = findPromotions([starter, backup]).get('rb2')!;
    expect(promotion.claimedByFeed).toBeCloseTo(1, 5);
    expect(promotion.unclaimed).toBeCloseTo(3.3, 5);
  });

  it('adds nothing when the opening line already reads as a lead back', () => {
    /*
     * The case no timestamp can settle: a mid-week first sync, so the opening
     * line we captured already postdates the news and there is no recorded
     * status change to compare it against. A backup opening at 13 against a
     * starter at 16 is already being projected as the starter.
     */
    const starter = out('rb1', 'RB', 16);
    const backup = p('rb2', 'RB', 13, { openingPoints: 13, openedAt: WEDNESDAY });

    expect(findPromotions([starter, backup]).has('rb2')).toBe(false);
  });

  it('fires nothing at all once the feed has fully swapped the depth chart', () => {
    // The feed zeroed the out starter and promoted the backup, so the backup
    // now ranks first and the out man is no longer anybody's starter.
    const zeroed = { ...out('rb1', 'RB', 0.5), statusChangedAt: MONDAY };
    const promotedByFeed = p('rb2', 'RB', 14, { openingPoints: 6, openedAt: WEDNESDAY });

    expect(findPromotions([zeroed, promotedByFeed]).size).toBe(0);
  });

  it('says in the reason whether the feed had moved', () => {
    const quiet = findPromotions([
      { ...out('rb1', 'RB', 16), statusChangedAt: SUNDAY },
      p('rb2', 'RB', 5, { openingPoints: 5, openedAt: WEDNESDAY }),
    ]).get('rb2')!;
    expect(quiet.reason).toContain('has not moved');

    const partial = findPromotions([
      { ...out('rb1', 'RB', 16), statusChangedAt: SUNDAY },
      p('rb2', 'RB', 7, { openingPoints: 5, openedAt: WEDNESDAY }),
    ]).get('rb2')!;
    expect(partial.reason).toContain('already moved him');
  });
});
