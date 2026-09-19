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
  it('scales the backup by the measured multiplier', () => {
    const promotion = findPromotions([out('rb1', 'RB', 20), p('rb2', 'RB', 5)]).get('rb2')!;
    expect(applyPromotion(5, promotion)).toBeCloseTo(9.3, 5);
  });

  it('never lets a promoted backup out-project the man he replaced', () => {
    // 9 * 1.86 = 16.74, but the starter he is standing in for was worth 10.
    const promotion = findPromotions([out('rb1', 'RB', 10), p('rb2', 'RB', 9)]).get('rb2')!;
    expect(applyPromotion(9, promotion)).toBe(10);
  });
});
