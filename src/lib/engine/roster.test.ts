import { describe, it, expect } from 'vitest';
import {
  computeOccupancy,
  findSlotMoves,
  isIrEligible,
  isTaxiEligible,
  type RosterSlotConfig,
  type RosterPlayerInfo,
} from './roster';

const DYNASTY_CONFIG: RosterSlotConfig = {
  rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
  taxiSlots: 4,
  taxiYears: 2,
  taxiDeadline: 0,
  taxiAllowVets: 0,
  reserveSlots: 2,
};

const p = (
  playerId: string,
  overrides: Partial<RosterPlayerInfo> = {},
): RosterPlayerInfo => ({
  playerId,
  name: playerId,
  position: 'RB',
  yearsExp: 4,
  injuryStatus: null,
  status: 'Active',
  ...overrides,
});

describe('isIrEligible', () => {
  it('accepts real IR designations', () => {
    expect(isIrEligible(p('a', { status: 'Injured Reserve' }))).toBe(true);
    expect(isIrEligible(p('b', { injuryStatus: 'Out' }))).toBe(true);
    expect(isIrEligible(p('c', { status: 'PUP' }))).toBe(true);
  });

  it('rejects healthy and questionable players', () => {
    expect(isIrEligible(p('d'))).toBe(false);
    expect(isIrEligible(p('e', { injuryStatus: 'Questionable' }))).toBe(false);
  });
});

describe('isTaxiEligible', () => {
  it('accepts players inside the experience window', () => {
    expect(isTaxiEligible(p('rookie', { yearsExp: 0 }), DYNASTY_CONFIG)).toBe(true);
    expect(isTaxiEligible(p('second', { yearsExp: 1 }), DYNASTY_CONFIG)).toBe(true);
  });

  it('rejects players past the window', () => {
    expect(isTaxiEligible(p('vet', { yearsExp: 2 }), DYNASTY_CONFIG)).toBe(false);
    expect(isTaxiEligible(p('older', { yearsExp: 6 }), DYNASTY_CONFIG)).toBe(false);
  });

  it('accepts anyone when the league allows veterans', () => {
    expect(isTaxiEligible(p('vet', { yearsExp: 8 }), { ...DYNASTY_CONFIG, taxiAllowVets: 1 })).toBe(true);
  });

  it('is always false when the league has no taxi squad', () => {
    expect(isTaxiEligible(p('rookie', { yearsExp: 0 }), { ...DYNASTY_CONFIG, taxiSlots: 0 })).toBe(false);
  });

  it('treats unknown experience as ineligible rather than guessing', () => {
    expect(isTaxiEligible(p('unknown', { yearsExp: null }), DYNASTY_CONFIG)).toBe(false);
  });
});

describe('computeOccupancy', () => {
  it('counts active players excluding taxi and IR stashes', () => {
    const roster = {
      players: ['a', 'b', 'c', 'd', 'e'],
      taxi: ['d'],
      reserve: ['e'],
    };
    const occupancy = computeOccupancy(DYNASTY_CONFIG, roster);

    expect(occupancy.startingSlots).toBe(9);
    expect(occupancy.benchSlots).toBe(6);
    expect(occupancy.totalActiveSlots).toBe(15);
    expect(occupancy.playersOnRoster).toBe(5);
    expect(occupancy.playersActive).toBe(3); // d and e don't consume active spots
    expect(occupancy.openActiveSlots).toBe(12);
    expect(occupancy.openTaxiSlots).toBe(3);
    expect(occupancy.openReserveSlots).toBe(1);
    expect(occupancy.isOverRosterLimit).toBe(false);
  });

  it('detects an over-limit roster', () => {
    const players = Array.from({ length: 17 }, (_, i) => `p${i}`);
    const occupancy = computeOccupancy(DYNASTY_CONFIG, { players, taxi: [], reserve: [] });
    expect(occupancy.playersActive).toBe(17);
    expect(occupancy.isOverRosterLimit).toBe(true);
    expect(occupancy.openActiveSlots).toBe(-2);
  });

  it('takes the larger of settings and roster_positions for IR/taxi capacity', () => {
    const config: RosterSlotConfig = {
      ...DYNASTY_CONFIG,
      rosterPositions: [...DYNASTY_CONFIG.rosterPositions, 'IR', 'IR', 'IR', 'TAXI'],
      reserveSlots: 2, // settings says 2, positions say 3 -> take 3
      taxiSlots: 4, // settings says 4, positions say 1 -> take 4
    };
    const occupancy = computeOccupancy(config, { players: [], taxi: [], reserve: [] });
    expect(occupancy.reserveSlots).toBe(3);
    expect(occupancy.taxiSlots).toBe(4);
  });
});

describe('findSlotMoves', () => {
  it('flags an IR-eligible player wasting an active roster spot', () => {
    const injured = p('hurt', { name: 'Hurt Guy', status: 'Out', injuryStatus: 'Out' });
    const moves = findSlotMoves(
      DYNASTY_CONFIG,
      { players: ['hurt', 'fine'], taxi: [], reserve: [] },
      new Map([
        ['hurt', injured],
        ['fine', p('fine', { name: 'Fine Guy' })],
      ]),
      5,
    );

    const irMove = moves.find((m) => m.type === 'stash-ir');
    expect(irMove).toBeDefined();
    expect(irMove!.playerId).toBe('hurt');
    expect(irMove!.detail).toMatch(/frees an active roster spot/i);
  });

  it('does not suggest IR when no reserve slot is open', () => {
    const config = { ...DYNASTY_CONFIG, reserveSlots: 1 };
    const moves = findSlotMoves(
      config,
      { players: ['hurt', 'alreadyIr'], taxi: [], reserve: ['alreadyIr'] },
      new Map([
        ['hurt', p('hurt', { status: 'Out' })],
        ['alreadyIr', p('alreadyIr', { status: 'Out' })],
      ]),
      5,
    );
    expect(moves.find((m) => m.type === 'stash-ir')).toBeUndefined();
  });

  it('flags a taxi-eligible rookie occupying an active spot', () => {
    const moves = findSlotMoves(
      DYNASTY_CONFIG,
      { players: ['rook'], taxi: [], reserve: [] },
      new Map([['rook', p('rook', { name: 'Rookie', yearsExp: 0 })]]),
      5,
    );
    const taxiMove = moves.find((m) => m.type === 'stash-taxi');
    expect(taxiMove).toBeDefined();
    expect(taxiMove!.playerId).toBe('rook');
  });

  it('prefers IR over taxi for an injured rookie rather than double-counting him', () => {
    const moves = findSlotMoves(
      DYNASTY_CONFIG,
      { players: ['rook'], taxi: [], reserve: [] },
      new Map([['rook', p('rook', { yearsExp: 0, status: 'Out', injuryStatus: 'Out' })]]),
      5,
    );
    expect(moves.filter((m) => m.playerId === 'rook')).toHaveLength(1);
    expect(moves.find((m) => m.playerId === 'rook')!.type).toBe('stash-ir');
  });

  it('warns as the taxi deadline approaches and escalates in the final week', () => {
    const config = { ...DYNASTY_CONFIG, taxiDeadline: 10 };
    const roster = { players: ['a', 'b'], taxi: ['b'], reserve: [] };
    const playerMap = new Map([['a', p('a')], ['b', p('b', { yearsExp: 0 })]]);

    const early = findSlotMoves(config, roster, playerMap, 5);
    expect(early.find((m) => m.type === 'taxi-deadline')).toBeUndefined();

    const soon = findSlotMoves(config, roster, playerMap, 9);
    expect(soon.find((m) => m.type === 'taxi-deadline')!.severity).toBe('warn');

    const now = findSlotMoves(config, roster, playerMap, 10);
    expect(now.find((m) => m.type === 'taxi-deadline')!.severity).toBe('critical');
  });

  it('raises a critical alert when the roster is over the limit', () => {
    const players = Array.from({ length: 17 }, (_, i) => `p${i}`);
    const moves = findSlotMoves(
      DYNASTY_CONFIG,
      { players, taxi: [], reserve: [] },
      new Map(players.map((id) => [id, p(id)])),
      5,
    );
    const over = moves.find((m) => m.type === 'over-limit');
    expect(over).toBeDefined();
    expect(over!.severity).toBe('critical');
  });

  it('stays quiet on a clean, healthy roster', () => {
    const moves = findSlotMoves(
      DYNASTY_CONFIG,
      { players: ['a', 'b'], taxi: [], reserve: [] },
      new Map([['a', p('a')], ['b', p('b')]]),
      5,
    );
    expect(moves).toHaveLength(0);
  });
});
