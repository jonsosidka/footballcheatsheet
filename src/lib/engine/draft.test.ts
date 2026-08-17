import { describe, it, expect } from 'vitest';
import {
  slotForPick,
  pickNumbersForSlot,
  pickLabel,
  roundOfPick,
  positionDemand,
  replacementLevels,
  rosterValue,
  survivalProbability,
  adpDrift,
  assignTiers,
  detectRuns,
  injuryDiscount,
  mandatoryPositions,
  suggestPicks,
  type DraftPlayer,
} from './draft';
import { adpFromStats } from '@/lib/sources/sleeper';

const STANDARD = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'];

let counter = 0;
function player(position: string, points: number, extra: Partial<DraftPlayer> = {}): DraftPlayer {
  counter++;
  return {
    playerId: extra.playerId ?? `${position.toLowerCase()}${counter}`,
    name: extra.name ?? `${position} ${counter}`,
    position,
    eligiblePositions: extra.eligiblePositions ?? [position],
    team: extra.team ?? 'SF',
    byeWeek: extra.byeWeek ?? null,
    points,
    adp: extra.adp ?? null,
    injuryStatus: extra.injuryStatus ?? null,
    ...extra,
  };
}

const replacements = (entries: Record<string, number>) => new Map(Object.entries(entries));

// ---------------------------------------------------------------------------
// Draft order
// ---------------------------------------------------------------------------

describe('slotForPick', () => {
  it('snakes back and forth', () => {
    expect(slotForPick(1, 12)).toBe(1);
    expect(slotForPick(12, 12)).toBe(12);
    expect(slotForPick(13, 12)).toBe(12); // round 2 starts where round 1 ended
    expect(slotForPick(24, 12)).toBe(1);
    expect(slotForPick(25, 12)).toBe(1);
  });

  it('runs straight through in a linear draft', () => {
    expect(slotForPick(1, 12, 'linear')).toBe(1);
    expect(slotForPick(13, 12, 'linear')).toBe(1);
    expect(slotForPick(24, 12, 'linear')).toBe(12);
  });

  it('honours third-round reversal', () => {
    // Round 3 repeats round 2's order instead of restarting round 1's — the
    // entire point of the rule, and silently wrong under plain snake.
    expect(slotForPick(25, 12, 'snake', 3)).toBe(12);
    expect(slotForPick(36, 12, 'snake', 3)).toBe(1);
    // Round 4 goes back to forward order.
    expect(slotForPick(37, 12, 'snake', 3)).toBe(1);
    // Rounds before the reversal are untouched.
    expect(slotForPick(1, 12, 'snake', 3)).toBe(1);
    expect(slotForPick(13, 12, 'snake', 3)).toBe(12);
  });

  it('covers every slot exactly once per round', () => {
    for (const type of ['snake', 'linear'] as const) {
      const round2 = Array.from({ length: 12 }, (_, i) => slotForPick(13 + i, 12, type));
      expect([...new Set(round2)].sort((a, b) => a - b)).toEqual(
        Array.from({ length: 12 }, (_, i) => i + 1),
      );
    }
  });
});

describe('pickNumbersForSlot', () => {
  it('gives the turn-of-the-round pair to slot 1', () => {
    expect(pickNumbersForSlot(1, 12, 4)).toEqual([1, 24, 25, 48]);
  });

  it('spaces a middle slot evenly', () => {
    expect(pickNumbersForSlot(6, 12, 3)).toEqual([6, 19, 30]);
  });

  it('repeats the same slot every round when linear', () => {
    expect(pickNumbersForSlot(3, 10, 3, 'linear')).toEqual([3, 13, 23]);
  });
});

describe('pickLabel', () => {
  it('reads as round.pick', () => {
    expect(pickLabel(1, 12)).toBe('1.01');
    expect(pickLabel(15, 12)).toBe('2.03');
    expect(pickLabel(24, 12)).toBe('2.12');
    expect(roundOfPick(24, 12)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Roster value
// ---------------------------------------------------------------------------

describe('positionDemand', () => {
  it('counts dedicated slots in full and flex slots fractionally', () => {
    expect(positionDemand('RB', STANDARD)).toBeCloseTo(2 + 1 / 3, 5);
    expect(positionDemand('TE', STANDARD)).toBeCloseTo(1 + 1 / 3, 5);
    expect(positionDemand('QB', STANDARD)).toBe(1);
  });

  it('is zero for a position the league never starts', () => {
    expect(positionDemand('LB', STANDARD)).toBe(0);
  });

  it('gives quarterbacks flex demand in superflex', () => {
    expect(positionDemand('QB', ['QB', 'SUPER_FLEX', 'BN'])).toBeGreaterThan(1);
  });
});

describe('replacementLevels', () => {
  it('sets the bar at the best player who goes undrafted', () => {
    const universe = Array.from({ length: 60 }, (_, i) => player('RB', 300 - i * 5));
    const levels = replacementLevels(universe, STANDARD, 12);
    // 12 teams x 2.33 RB slots = 28 starting RBs, so the 29th is replacement.
    expect(levels.get('RB')).toBe(300 - 28 * 5);
  });

  it('is zero for positions the league never starts', () => {
    const levels = replacementLevels([player('LB', 200)], STANDARD, 12);
    expect(levels.get('LB')).toBe(0);
  });
});

describe('rosterValue', () => {
  const options = {
    rosterPositions: ['RB', 'BN', 'BN', 'BN'],
    replacementByPosition: replacements({ RB: 100 }),
  };

  it('counts starters in full and backups by how often they actually start', () => {
    const value = rosterValue([player('RB', 200), player('RB', 150), player('RB', 120)], options);
    expect(value.starterPoints).toBe(200);
    // 0.22 x (150-100) + 0.09 x (120-100)
    expect(value.depthPoints).toBeCloseTo(12.8, 5);
    expect(value.total).toBeCloseTo(212.8, 5);
  });

  it('gives a backup no credit for points below replacement level', () => {
    const value = rosterValue([player('RB', 200), player('RB', 90)], options);
    expect(value.depthPoints).toBe(0);
  });

  it('stops paying for depth beyond the third backup', () => {
    const deep = [player('RB', 200), ...Array.from({ length: 5 }, () => player('RB', 150))];
    const value = rosterValue(deep, options);
    // Only three backups earn a share, however many you hoard.
    expect(value.depthPoints).toBeCloseTo((0.22 + 0.09 + 0.04) * 50, 5);
  });

  it('charges for a bye week that leaves a slot unfillable', () => {
    const stacked = [player('RB', 200, { byeWeek: 7 }), player('RB', 180, { byeWeek: 7 })];
    const spread = [player('RB', 200, { byeWeek: 7 }), player('RB', 180, { byeWeek: 9 })];

    const stackedValue = rosterValue(stacked, { ...options, includeByeRisk: true });
    const spreadValue = rosterValue(spread, { ...options, includeByeRisk: true });

    expect(stackedValue.byePenalty).toBeGreaterThan(0);
    expect(stackedValue.byeShortWeeks).toEqual([7]);
    expect(spreadValue.byePenalty).toBe(0);
  });

  it('charges only what the bye takes away, not what the roster never had', () => {
    // Two WR slots, one receiver: the second slot is empty in every week, so
    // only the one slot the bye actually empties is charged for.
    const value = rosterValue([player('WR', 200, { byeWeek: 7 })], {
      rosterPositions: ['WR', 'WR', 'BN'],
      replacementByPosition: replacements({ WR: 100 }),
      includeByeRisk: true,
    });
    expect(value.byePenalty).toBeCloseTo(100 / 17, 2);
  });
});

// ---------------------------------------------------------------------------
// Survival
// ---------------------------------------------------------------------------

describe('survivalProbability', () => {
  it('is certain when the target pick is the current one', () => {
    expect(survivalProbability(50, 10, 10)).toBe(1);
  });

  it('falls as the wait gets longer', () => {
    const soon = survivalProbability(40, 20, 25);
    const later = survivalProbability(40, 20, 60);
    expect(soon).toBeGreaterThan(later);
    expect(later).toBeLessThan(0.15);
  });

  it('is near even money when your next pick lands on his ADP', () => {
    expect(survivalProbability(40, 20, 40)).toBeGreaterThan(0.4);
    expect(survivalProbability(40, 20, 40)).toBeLessThan(0.65);
  });

  it('does not charge a player for the picks he has already survived', () => {
    // Same target pick, same ADP — the only difference is how much of the wait
    // is already behind him, and an unconditional curve would ignore that.
    expect(survivalProbability(40, 35, 45)).toBeGreaterThan(survivalProbability(40, 20, 45));
  });

  it('treats an unranked player as likely to last', () => {
    expect(survivalProbability(null, 10, 40)).toBeGreaterThan(0.5);
  });

  it('shifts with the room, not just the consensus', () => {
    // A room drafting 15 picks behind ADP leaves everyone available longer.
    expect(survivalProbability(40, 20, 45, 15)).toBeGreaterThan(survivalProbability(40, 20, 45));
  });
});

describe('adpDrift', () => {
  it('stays neutral until there is enough evidence', () => {
    expect(adpDrift([{ pickNo: 1, adp: 30 }, { pickNo: 2, adp: 40 }])).toBe(0);
  });

  it('measures how far the room runs behind consensus', () => {
    const picks = Array.from({ length: 12 }, (_, i) => ({ pickNo: i + 1, adp: i + 1 - 10 }));
    expect(adpDrift(picks)).toBeCloseTo(10, 5);
  });

  it('ignores picks with no ADP', () => {
    const picks = Array.from({ length: 12 }, (_, i) => ({ pickNo: i + 1, adp: i + 1 }));
    expect(adpDrift([...picks, { pickNo: 13, adp: null }])).toBeCloseTo(0, 5);
  });
});

// ---------------------------------------------------------------------------
// Tiers and runs
// ---------------------------------------------------------------------------

describe('assignTiers', () => {
  it('breaks a tier where the cliff is', () => {
    const pool = [
      player('WR', 260, { playerId: 'a' }),
      player('WR', 255, { playerId: 'b' }),
      player('WR', 250, { playerId: 'c' }),
      player('WR', 180, { playerId: 'd' }),
      player('WR', 176, { playerId: 'e' }),
    ];
    const tiers = assignTiers(pool);
    expect(tiers.get('a')).toBe(1);
    expect(tiers.get('c')).toBe(1);
    expect(tiers.get('d')).toBe(2);
    expect(tiers.get('e')).toBe(2);
  });

  it('does not carve a flat position into noise tiers', () => {
    const flat = Array.from({ length: 10 }, (_, i) => player('K', 130 - i * 0.5));
    const tiers = assignTiers(flat);
    expect(new Set(tiers.values()).size).toBe(1);
  });

  it('tiers each position independently', () => {
    const tiers = assignTiers([
      player('RB', 300, { playerId: 'rb-a' }),
      player('WR', 150, { playerId: 'wr-a' }),
    ]);
    expect(tiers.get('rb-a')).toBe(1);
    expect(tiers.get('wr-a')).toBe(1);
  });
});

describe('detectRuns', () => {
  it('spots a positional run', () => {
    const recent = ['WR', 'RB', 'RB', 'QB', 'RB', 'RB', 'TE', 'RB'];
    const runs = detectRuns(recent, 8);
    expect(runs[0].position).toBe('RB');
    expect(runs[0].picks).toBe(5);
  });

  it('stays quiet on a normal spread of picks', () => {
    expect(detectRuns(['QB', 'RB', 'WR', 'TE', 'WR', 'RB', 'K', 'DEF'], 8)).toHaveLength(0);
  });

  it('needs a meaningful window before calling anything', () => {
    expect(detectRuns(['RB', 'RB', 'RB'], 12)).toHaveLength(0);
  });
});

describe('injuryDiscount', () => {
  it('all but writes off a player on IR', () => {
    expect(injuryDiscount('Injured Reserve')).toBeLessThan(0.3);
    expect(injuryDiscount('PUP')).toBeLessThan(0.3);
  });

  it('barely touches a questionable tag', () => {
    expect(injuryDiscount('Questionable')).toBeGreaterThan(0.9);
  });

  it('leaves a healthy player alone', () => {
    expect(injuryDiscount(null)).toBe(1);
    expect(injuryDiscount('')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Mandatory slots
// ---------------------------------------------------------------------------

describe('mandatoryPositions', () => {
  it('is empty while you still have picks to spare', () => {
    expect(mandatoryPositions([player('QB', 300)], ['QB', 'K', 'BN'], 5).size).toBe(0);
  });

  it('locks the last picks to the slots you cannot otherwise fill', () => {
    const forced = mandatoryPositions([player('QB', 300)], ['QB', 'K'], 1);
    expect([...forced]).toEqual(['K']);
  });

  it('accounts for every eligible position of an empty flex', () => {
    const forced = mandatoryPositions([], ['FLEX'], 1);
    expect([...forced].sort()).toEqual(['RB', 'TE', 'WR']);
  });
});

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

describe('suggestPicks', () => {
  const board = (overrides: Partial<Parameters<typeof suggestPicks>[0]> = {}) =>
    suggestPicks({
      rosterPositions: STANDARD,
      myPlayers: [],
      available: [],
      replacementByPosition: replacements({ QB: 200, RB: 120, WR: 130, TE: 90, K: 110, DEF: 100 }),
      currentPickNo: 1,
      targetPickNo: 1,
      followingPickNo: 24,
      picksRemaining: 15,
      teams: 12,
      ...overrides,
    });

  // Three backs already fill RB, RB and FLEX; there is no receiver at all.
  const backHeavy = {
    myPlayers: [player('RB', 250), player('RB', 240), player('RB', 230)],
    available: [
      player('RB', 215, { playerId: 'rb4' }),
      player('WR', 200, { playerId: 'wr1' }),
      player('WR', 150, { playerId: 'wr2' }),
      player('WR', 145, { playerId: 'wr3' }),
      player('RB', 140, { playerId: 'rb5' }),
    ],
  };

  it('will not stack a position whose points cannot reach the lineup', () => {
    const [top] = board(backHeavy);
    expect(top.player.playerId).toBe('wr1');
    expect(top.fillsSlot).toBe('WR');
  });

  it('prices a backup as depth rather than as his projection', () => {
    const backup = board(backHeavy).find((s) => s.player.playerId === 'rb4')!;
    // 0.22 x (215 - 120 replacement) = 20.9, not 215.
    expect(backup.marginal).toBeCloseTo(0.22 * (215 - 120), 1);
  });

  it('takes the player whose position will not survive the wait', () => {
    /*
     * Two equal starters, one slot each. Every top player goes by pick 8 except
     * the fallback receiver — so taking the back leaves a usable receiver on the
     * board, while taking the receiver leaves nothing that can start.
     */
    const suggestions = suggestPicks({
      rosterPositions: ['RB', 'WR', 'BN', 'BN'],
      myPlayers: [],
      available: [
        player('RB', 200, { playerId: 'rb-a', adp: 5 }),
        player('RB', 195, { playerId: 'rb-b', adp: 6 }),
        player('WR', 200, { playerId: 'wr-a', adp: 5 }),
        player('WR', 120, { playerId: 'wr-b', adp: 40 }),
      ],
      replacementByPosition: replacements({ RB: 80, WR: 80 }),
      currentPickNo: 1,
      targetPickNo: 1,
      followingPickNo: 8,
      picksRemaining: 4,
      teams: 4,
    });

    expect(suggestions[0].player.playerId).toBe('rb-a');
    expect(suggestions[0].edge).toBeGreaterThan(0);
    // And the receiver it passed on is scored as what that choice would cost.
    expect(suggestions.find((s) => s.player.playerId === 'wr-a')!.edge).toBeLessThan(0);
  });

  it('forces the slots you have run out of picks to fill', () => {
    const myPlayers = [
      player('QB', 300),
      player('RB', 250),
      player('RB', 240),
      player('WR', 220),
      player('WR', 210),
      player('TE', 150),
      player('RB', 200),
      player('DEF', 110),
    ];

    const [top] = board({
      myPlayers,
      available: [player('WR', 240, { playerId: 'wr-stud' }), player('K', 130, { playerId: 'k1' })],
      picksRemaining: 1,
    });

    expect(top.player.playerId).toBe('k1');
    expect(top.mandatory).toBe(true);
    expect(top.rationale).toContain('forced');
  });

  it('flags a pick that would leave a bye week unfillable', () => {
    const suggestions = suggestPicks({
      rosterPositions: ['WR', 'WR', 'BN'],
      myPlayers: [player('WR', 200, { byeWeek: 7 }), player('WR', 190, { byeWeek: 9 })],
      available: [
        player('WR', 180, { playerId: 'same-bye', byeWeek: 7 }),
        player('WR', 178, { playerId: 'clear-bye', byeWeek: 12 }),
      ],
      replacementByPosition: replacements({ WR: 100 }),
      currentPickNo: 20,
      targetPickNo: 20,
      followingPickNo: 30,
      picksRemaining: 2,
      teams: 10,
    });

    const stacked = suggestions.find((s) => s.player.playerId === 'same-bye')!;
    const clear = suggestions.find((s) => s.player.playerId === 'clear-bye')!;
    expect(stacked.byeConflict).toEqual([7]);
    expect(clear.byeConflict).toEqual([]);
    expect(clear.score).toBeGreaterThan(stacked.score);
  });

  it('reports availability rather than hiding players who will be gone', () => {
    const suggestions = board({
      available: [
        player('RB', 260, { playerId: 'gone', adp: 2 }),
        player('WR', 250, { playerId: 'here', adp: 60 }),
      ],
      currentPickNo: 1,
      targetPickNo: 20,
      followingPickNo: 29,
    });

    const gone = suggestions.find((s) => s.player.playerId === 'gone')!;
    const here = suggestions.find((s) => s.player.playerId === 'here')!;
    expect(gone.likelyAvailable).toBe(false);
    expect(here.likelyAvailable).toBe(true);
    expect(gone.survival).toBeLessThan(here.survival);
  });

  it('counts how much of a tier should survive to your next pick', () => {
    const tier = Array.from({ length: 4 }, (_, i) =>
      player('WR', 200 - i, { playerId: `wr-${i}`, adp: 80 }),
    );
    const [top] = board({
      available: tier,
      currentPickNo: 10,
      targetPickNo: 10,
      followingPickNo: 14,
    });
    expect(top.tierRemaining).toBe(4);
    expect(top.tierSurvivors).toBeGreaterThan(3);
  });

  it('ignores positions this league never starts', () => {
    const suggestions = board({ available: [player('LB', 400, { playerId: 'lb1' })] });
    expect(suggestions.find((s) => s.player.playerId === 'lb1')).toBeUndefined();
  });

  it('still ranks when there is no ADP data at all', () => {
    const suggestions = board({
      available: [player('RB', 250, { playerId: 'rb1' }), player('K', 120, { playerId: 'k1' })],
    });
    expect(suggestions[0].player.playerId).toBe('rb1');
    expect(suggestions[0].adpDelta).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ADP off the projection payload
// ---------------------------------------------------------------------------

describe('adpFromStats', () => {
  const stats = { adp_std: 30, adp_half_ppr: 26, adp_ppr: 24, adp_2qb: 12, rec: 80 };

  it('reads the format the league actually plays', () => {
    expect(adpFromStats(stats, { isSuperflex: false, pprType: 1 })).toBe(24);
    expect(adpFromStats(stats, { isSuperflex: false, pprType: 0.5 })).toBe(26);
    expect(adpFromStats(stats, { isSuperflex: false, pprType: 0 })).toBe(30);
  });

  it('uses superflex ADP in a superflex league', () => {
    expect(adpFromStats(stats, { isSuperflex: true, pprType: 1 })).toBe(12);
  });

  it('falls back when the preferred key is missing', () => {
    expect(adpFromStats({ adp_ppr: 44 }, { isSuperflex: true, pprType: 1 })).toBe(44);
  });

  it('returns null rather than guessing', () => {
    expect(adpFromStats({ rec: 80 }, { isSuperflex: false, pprType: 1 })).toBeNull();
    expect(adpFromStats(null, { isSuperflex: false, pprType: 1 })).toBeNull();
  });
});
