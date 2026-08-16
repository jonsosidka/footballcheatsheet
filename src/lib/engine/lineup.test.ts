import { describe, it, expect } from 'vitest';
import { optimizeLineup, compareToCurrentLineup, canFill, type LineupPlayer } from './lineup';

const player = (
  playerId: string,
  position: string,
  points: number,
  extra: Partial<LineupPlayer> = {},
): LineupPlayer => ({
  playerId,
  position,
  eligiblePositions: [position],
  points,
  ...extra,
});

describe('canFill', () => {
  it('matches dedicated slots', () => {
    expect(canFill('RB', ['RB'])).toBe(true);
    expect(canFill('RB', ['WR'])).toBe(false);
  });

  it('handles flex variants', () => {
    expect(canFill('FLEX', ['TE'])).toBe(true);
    expect(canFill('FLEX', ['QB'])).toBe(false);
    expect(canFill('SUPER_FLEX', ['QB'])).toBe(true);
    expect(canFill('REC_FLEX', ['RB'])).toBe(false);
    expect(canFill('REC_FLEX', ['TE'])).toBe(true);
    expect(canFill('WRRB_FLEX', ['TE'])).toBe(false);
  });

  it('respects multi-position eligibility', () => {
    expect(canFill('RB', ['WR', 'RB'])).toBe(true);
  });

  it('fails closed on an unknown slot rather than allowing anyone', () => {
    expect(canFill('MYSTERY_SLOT', ['RB'])).toBe(false);
  });
});

describe('optimizeLineup', () => {
  it('beats greedy on the classic flex-ordering trap', () => {
    // Slot order puts FLEX first. A greedy pass fills FLEX with the best
    // eligible player (WR_A, 20), forcing the weaker WR_C into the WR slot for
    // 30 total. The optimal assignment is WR_A -> WR and RB_B -> FLEX, for 35.
    const players = [player('WR_A', 'WR', 20), player('RB_B', 'RB', 15), player('WR_C', 'WR', 10)];
    const result = optimizeLineup(players, ['FLEX', 'WR']);

    expect(result.totalPoints).toBe(35);

    const byslot = Object.fromEntries(result.assignments.map((a) => [a.slot, a.playerId]));
    expect(byslot.WR).toBe('WR_A');
    expect(byslot.FLEX).toBe('RB_B');
    expect(result.benchedPlayerIds).toEqual(['WR_C']);
  });

  it('uses a superflex slot for a second quarterback when that is optimal', () => {
    const players = [
      player('QB1', 'QB', 25),
      player('QB2', 'QB', 22),
      player('RB1', 'RB', 18),
      player('WR1', 'WR', 14),
    ];
    const result = optimizeLineup(players, ['QB', 'RB', 'SUPER_FLEX', 'BN']);

    expect(result.totalPoints).toBe(65); // 25 + 18 + 22
    const byslot = Object.fromEntries(result.assignments.map((a) => [a.slot, a.playerId]));
    expect(byslot.QB).toBe('QB1');
    expect(byslot.SUPER_FLEX).toBe('QB2');
    expect(byslot.RB).toBe('RB1');
  });

  it('keeps a QB out of a standard FLEX', () => {
    const players = [player('QB1', 'QB', 30), player('RB1', 'RB', 8)];
    const result = optimizeLineup(players, ['FLEX']);
    expect(result.assignments[0].playerId).toBe('RB1');
  });

  it('excludes ineligible players (bye, IR, out)', () => {
    const players = [
      player('RB1', 'RB', 20, { ineligible: true }),
      player('RB2', 'RB', 12),
    ];
    const result = optimizeLineup(players, ['RB']);
    expect(result.assignments[0].playerId).toBe('RB2');
    expect(result.totalPoints).toBe(12);
  });

  it('leaves a slot empty when nothing is eligible', () => {
    const result = optimizeLineup([player('RB1', 'RB', 20)], ['RB', 'TE']);
    const te = result.assignments.find((a) => a.slot === 'TE')!;
    expect(te.playerId).toBeNull();
    expect(te.points).toBe(0);
    expect(result.totalPoints).toBe(20);
  });

  it('ignores bench, IR and taxi slots', () => {
    const players = [player('RB1', 'RB', 20), player('RB2', 'RB', 15), player('RB3', 'RB', 10)];
    const result = optimizeLineup(players, ['RB', 'BN', 'IR', 'TAXI']);
    expect(result.assignments).toHaveLength(1);
    expect(result.totalPoints).toBe(20);
    expect(result.benchedPlayerIds.sort()).toEqual(['RB2', 'RB3']);
  });

  it('handles multi-position eligibility to unlock a better total', () => {
    // WR_RB is eligible at both; using him at RB frees the WR slot for a
    // higher scorer.
    const players = [
      { ...player('FLEXY', 'RB', 12), eligiblePositions: ['RB', 'WR'] },
      player('WR_HIGH', 'WR', 19),
    ];
    const result = optimizeLineup(players, ['RB', 'WR']);
    expect(result.totalPoints).toBe(31);
    const byslot = Object.fromEntries(result.assignments.map((a) => [a.slot, a.playerId]));
    expect(byslot.RB).toBe('FLEXY');
    expect(byslot.WR).toBe('WR_HIGH');
  });

  it('solves a full-size roster quickly and consistently', () => {
    const positions = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
    const players: LineupPlayer[] = [];
    const spread = { QB: 3, RB: 6, WR: 8, TE: 3, K: 2, DEF: 2 };
    for (const [pos, count] of Object.entries(spread)) {
      for (let i = 0; i < count; i++) {
        players.push(player(`${pos}${i}`, pos, 20 - i * 1.7));
      }
    }

    const started = Date.now();
    const result = optimizeLineup(players, [...positions, 'BN', 'BN', 'BN']);
    expect(Date.now() - started).toBeLessThan(200);

    // Every starting slot filled, no player used twice.
    expect(result.assignments.every((a) => a.playerId !== null)).toBe(true);
    const ids = result.assignments.map((a) => a.playerId);
    expect(new Set(ids).size).toBe(ids.length);

    // FLEX takes the best leftover skill player. That's TE1 at 18.3 — not the
    // leftover RB2/WR2 at 16.6 — because only one TE slot exists and the
    // second-best TE outscores the third-best RB and WR.
    const expectedTotal =
      20 + // QB0
      (20 + 18.3) + // RB0, RB1
      (20 + 18.3) + // WR0, WR1
      20 + // TE0
      18.3 + // FLEX <- TE1
      20 + // K0
      20; // DEF0
    expect(expectedTotal).toBeCloseTo(174.9, 1);
    expect(result.totalPoints).toBeCloseTo(expectedTotal, 1);

    const flex = result.assignments.find((a) => a.slot === 'FLEX')!;
    expect(flex.playerId).toBe('TE1');
  });
});

describe('compareToCurrentLineup', () => {
  const players = [
    player('WR_A', 'WR', 20),
    player('RB_B', 'RB', 15),
    player('WR_C', 'WR', 10),
  ];

  it('quantifies points left on the bench and names the swap', () => {
    // Currently starting the suboptimal arrangement: WR_C in WR, WR_A in FLEX.
    const result = compareToCurrentLineup(players, ['WR', 'FLEX'], ['WR_C', 'WR_A']);

    expect(result.currentPoints).toBe(30);
    expect(result.optimal.totalPoints).toBe(35);
    expect(result.pointsLeftOnBench).toBe(5);

    expect(result.changes).toHaveLength(2);
    expect(result.changes[0].gain).toBeGreaterThan(0);
    const wrChange = result.changes.find((c) => c.slot === 'WR')!;
    expect(wrChange.benchPlayerId).toBe('WR_A');
    expect(wrChange.startingPlayerId).toBe('WR_C');
  });

  it('reports no changes when the lineup is already optimal', () => {
    const result = compareToCurrentLineup(players, ['WR', 'FLEX'], ['WR_A', 'RB_B']);
    expect(result.pointsLeftOnBench).toBe(0);
    expect(result.changes).toHaveLength(0);
  });

  it('treats Sleeper empty slots ("0") as unfilled', () => {
    const result = compareToCurrentLineup(players, ['WR', 'FLEX'], ['0', '0']);
    expect(result.currentPoints).toBe(0);
    expect(result.pointsLeftOnBench).toBe(35);
  });
});
