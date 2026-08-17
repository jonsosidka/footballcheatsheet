import { describe, it, expect } from 'vitest';
import { findTrades, evaluateSide, computeStarterFloor, lineupStrength, type TradePlayer, type TradeTeam } from './trades';

const POSITIONS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'BN'];

const pl = (
  playerId: string,
  position: string,
  rosPoints: number,
  dynastyValue: number,
  age = 26,
): TradePlayer => ({
  playerId,
  name: playerId,
  position,
  team: 'XXX',
  age,
  rosPoints,
  eligiblePositions: [position],
  dynastyValue,
  redraftValue: rosPoints * 10,
});

const team = (
  rosterId: number,
  name: string,
  players: TradePlayer[],
  posture: TradeTeam['posture'],
  trajectory: TradeTeam['trajectory'] = 'stable',
): TradeTeam => ({
  rosterId,
  name,
  posture,
  trajectory,
  players,
  needs: new Map(),
  rosterPositions: POSITIONS,
  baselineStrength: lineupStrength(players, POSITIONS),
});

describe('computeStarterFloor', () => {
  it('is the weakest player who still starts at that position', () => {
    const players = [pl('rb1', 'RB', 200, 5000), pl('rb2', 'RB', 150, 4000), pl('rb3', 'RB', 90, 2000)];
    const floor = computeStarterFloor(players, POSITIONS);
    // Two RB slots, so the floor is the 2nd best.
    expect(floor.get('RB')).toBe(150);
  });

  it('is zero when the position is not started', () => {
    const floor = computeStarterFloor([pl('k1', 'K', 100, 500)], POSITIONS);
    expect(floor.get('K')).toBe(0);
  });

  it('is zero when the roster is short at the position', () => {
    const floor = computeStarterFloor([pl('rb1', 'RB', 200, 5000)], POSITIONS);
    expect(floor.get('RB')).toBe(0); // needs 2, has 1
  });
});

describe('evaluateSide', () => {
  // A FULL lineup — every slot including FLEX occupied. With an empty slot an
  // incoming player displaces nobody and correctly adds his whole total, which
  // makes the displacement behaviour impossible to observe.
  const me = team(
    1,
    'me',
    [
      pl('qb1', 'QB', 300, 5000),
      pl('rb1', 'RB', 200, 5000), pl('rb2', 'RB', 150, 4000),
      pl('wr1', 'WR', 180, 4500), pl('wr2', 'WR', 60, 1000),
      pl('te1', 'TE', 140, 3000),
      pl('flexy', 'WR', 100, 2000),
    ],
    'contend',
  );

  it('counts only the improvement over the man displaced', () => {
    // Every slot is filled, so a 200-pt WR pushes the weakest starter out
    // rather than filling a hole. He adds his margin, not his total.
    const side = evaluateSide(me, [], [pl('newWr', 'WR', 200, 5000)], false);
    expect(side.winNowDelta).toBeGreaterThan(0);
    expect(side.winNowDelta).toBeLessThan(200);
  });

  it('gives no win-now credit for a player who would not crack the lineup', () => {
    const deep = team(
      9,
      'deep',
      [
        pl('rb1', 'RB', 200, 5000), pl('rb2', 'RB', 190, 4800),
        pl('wr1', 'WR', 195, 4700), pl('wr2', 'WR', 185, 4600),
        pl('te1', 'TE', 180, 4400), pl('qb1', 'QB', 300, 5200),
        pl('flexy', 'WR', 175, 4300),
      ],
      'contend',
    );
    const side = evaluateSide(deep, [], [pl('scrub', 'RB', 20, 300)], false);
    expect(side.winNowDelta).toBe(0);
  });

  it('charges a package for the players promoted into the lineup behind it', () => {
    // Shipping the top two WRs must cost more than the naive
    // "points above the current third receiver" approximation.
    const stacked = team(
      8,
      'stacked',
      [
        pl('wrA', 'WR', 220, 6000), pl('wrB', 'WR', 200, 5500),
        pl('wrC', 'WR', 120, 3000), pl('wrD', 'WR', 60, 1500),
        pl('rb1', 'RB', 180, 4000), pl('rb2', 'RB', 170, 3800),
        pl('te1', 'TE', 150, 3000), pl('qb1', 'QB', 300, 4000),
      ],
      'contend',
    );
    const side = evaluateSide(stacked, [stacked.players[0], stacked.players[1]], [], false);
    // Old approximation charged (220-120) + (200-120) = 180.
    // Truth: WR slots fall to wrC and wrD, so the loss is larger.
    expect(Math.abs(side.winNowDelta)).toBeGreaterThan(180);
  });
});

describe('findTrades', () => {
  it('finds a swap that a contender and a rebuilder both like', () => {
    // Contender has a valuable young player who does not start; rebuilder has
    // a productive veteran. Classic complementary trade.
    const me = team(
      1,
      'contender',
      [
        pl('vetRb', 'RB', 210, 4000, 28),
        pl('rb2', 'RB', 150, 3000, 27),
        pl('rb3', 'RB', 110, 2200, 26),
        pl('youngWr', 'WR', 40, 7000, 22),
        pl('wr1', 'WR', 200, 5000, 26),
        pl('wr2', 'WR', 120, 3000, 27),
        pl('wr3', 'WR', 105, 2400, 27),
        pl('qb1', 'QB', 300, 4000, 29),
        pl('te1', 'TE', 150, 3000, 28),
      ],
      'contend',
    );

    const them = team(
      2,
      'rebuilder',
      [
        pl('starWr', 'WR', 260, 6500, 29),
        pl('theirWr2', 'WR', 90, 2000, 24),
        pl('theirWr3', 'WR', 85, 1900, 24),
        pl('theirRb', 'RB', 120, 2500, 25),
        pl('theirRb2', 'RB', 100, 2000, 24),
        pl('theirRb3', 'RB', 95, 1800, 25),
        pl('theirQb', 'QB', 280, 3500, 30),
        pl('theirTe', 'TE', 140, 2500, 26),
      ],
      'rebuild',
    );

    const ideas = findTrades({ me, rivals: [them], isDynasty: true });

    expect(ideas.length).toBeGreaterThan(0);
    // Every surfaced idea must be a gain for BOTH sides.
    for (const idea of ideas) {
      expect(idea.mine.combined).toBeGreaterThan(0);
      expect(idea.theirs.combined).toBeGreaterThan(0);
    }
  });

  it('never proposes something the other side would obviously decline', () => {
    const me = team(1, 'me', [pl('junk', 'RB', 10, 200)], 'contend');
    const them = team(2, 'them', [pl('star', 'WR', 300, 9000)], 'contend');

    const ideas = findTrades({ me, rivals: [them], isDynasty: true });
    expect(ideas).toHaveLength(0);
  });

  it('rejects lopsided market value even when the objectives line up', () => {
    const me = team(1, 'me', [pl('cheap', 'RB', 100, 1000)], 'rebuild');
    const them = team(2, 'them', [pl('pricey', 'WR', 120, 8000)], 'contend');

    const ideas = findTrades({ me, rivals: [them], isDynasty: true, maxValueRatio: 1.4 });
    expect(ideas.every((i) => i.valueRatio <= 1.4)).toBe(true);
  });

  it('skips lateral swaps at the same position and similar production', () => {
    const me = team(1, 'me', [pl('a', 'WR', 150, 4000), pl('b', 'WR', 140, 3900)], 'bubble');
    const them = team(2, 'them', [pl('c', 'WR', 152, 4050), pl('d', 'WR', 148, 3950)], 'bubble');

    const ideas = findTrades({ me, rivals: [them], isDynasty: true });
    // All same position within 5 points — nothing meaningful to propose.
    expect(ideas).toHaveLength(0);
  });

  it('reports the posture mismatch as the reason when there is one', () => {
    const me = team(
      1,
      'me',
      [pl('young', 'WR', 30, 6000, 22), pl('wr1', 'WR', 200, 5000), pl('wr2', 'WR', 150, 4000), pl('rb1', 'RB', 180, 4000), pl('rb2', 'RB', 160, 3500)],
      'contend',
    );
    const them = team(
      2,
      'them',
      [pl('vet', 'RB', 230, 5200, 29), pl('theirRb', 'RB', 100, 2000), pl('theirWr', 'WR', 90, 2000)],
      'rebuild',
    );

    const ideas = findTrades({ me, rivals: [them], isDynasty: true });
    if (ideas.length > 0) {
      expect(ideas.some((i) => /contend.*rebuild|rebuild.*contend/i.test(i.rationale))).toBe(true);
    }
  });

  it('does not duplicate the same swap', () => {
    const me = team(1, 'me', [pl('a', 'RB', 200, 5000), pl('b', 'WR', 50, 4000)], 'contend');
    const them = team(2, 'them', [pl('c', 'WR', 220, 5200), pl('d', 'RB', 60, 4100)], 'rebuild');

    const ideas = findTrades({ me, rivals: [them], isDynasty: true });
    const keys = ideas.map((i) =>
      [i.mine.gives.map((p) => p.playerId).join('+'), i.mine.gets.map((p) => p.playerId).join('+')].join('|'),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('works in redraft, where only win-now matters', () => {
    /*
     * Each side has a genuinely surplus player who cannot crack their own
     * lineup, filling a hole on the other roster. Note the FLEX matters a lot
     * here: a team with four good receivers already plays the third one at
     * FLEX, so only the FOURTH is truly spare. Naive "you're WR-heavy, trade a
     * WR for an RB" reasoning overstates the gain, and the optimizer catches
     * that — which is why this fixture makes the surplus unambiguous.
     */
    const me = team(
      1,
      'me',
      [
        pl('qb1', 'QB', 280, 5000), pl('te1', 'TE', 140, 3000),
        pl('rb1', 'RB', 30, 800), pl('rb2', 'RB', 25, 700),
        pl('wr1', 'WR', 250, 6000), pl('wr2', 'WR', 240, 5800),
        pl('wr3', 'WR', 230, 5600), pl('wr4', 'WR', 220, 5000),
      ],
      'contend',
    );
    const them = team(
      2,
      'them',
      [
        pl('theirQb', 'QB', 275, 4900), pl('theirTe', 'TE', 135, 2900),
        pl('theirRb1', 'RB', 240, 5900), pl('theirRb2', 'RB', 235, 5700),
        pl('theirRb3', 'RB', 230, 5500), pl('theirRb4', 'RB', 225, 5100),
        pl('theirWr1', 'WR', 40, 900), pl('theirWr2', 'WR', 35, 800),
      ],
      'contend',
    );

    const ideas = findTrades({ me, rivals: [them], isDynasty: false });

    expect(ideas.length).toBeGreaterThan(0);
    for (const idea of ideas) {
      expect(idea.mine.futureDelta).toBe(0); // no future axis in redraft
      expect(idea.mine.winNowDelta).toBeGreaterThan(0);
      expect(idea.theirs.winNowDelta).toBeGreaterThan(0);
    }
  });
});
