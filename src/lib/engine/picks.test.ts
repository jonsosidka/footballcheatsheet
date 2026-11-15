import { describe, it, expect } from 'vitest';
import {
  buildPickInventory,
  createPickPricer,
  parsePickLabel,
  pickName,
  pickSeasons,
  projectDraftSlots,
  tierOfSlot,
} from './picks';

describe('pickSeasons', () => {
  it('starts next season once this season is underway', () => {
    expect(pickSeasons({ season: 2026, status: 'in_season', traded: [] })).toEqual([2027, 2028, 2029]);
  });

  it('includes this season while its draft is still pending', () => {
    expect(pickSeasons({ season: 2026, status: 'pre_draft', traded: [] })).toEqual([2026, 2027, 2028]);
  });

  it('extends to whatever Sleeper reports as traded, but not backwards', () => {
    const traded = [
      { season: 2030, round: 1, originalRosterId: 1, ownerRosterId: 2 },
      { season: 2026, round: 1, originalRosterId: 1, ownerRosterId: 2 },
    ];
    expect(pickSeasons({ season: 2026, status: 'in_season', traded })).toEqual([2027, 2028, 2029, 2030]);
  });
});

describe('buildPickInventory', () => {
  it('gives every roster its own picks by default', () => {
    const inv = buildPickInventory({ rosterIds: [1, 2], seasons: [2027], rounds: 2, traded: [] });
    expect(inv).toHaveLength(4);
    expect(inv.every((p) => p.ownerRosterId === p.originalRosterId)).toBe(true);
  });

  it('moves traded picks to their new owner without duplicating them', () => {
    const inv = buildPickInventory({
      rosterIds: [1, 2, 3],
      seasons: [2027],
      rounds: 1,
      traded: [{ season: 2027, round: 1, originalRosterId: 1, ownerRosterId: 3 }],
    });
    expect(inv).toHaveLength(3);
    expect(inv.filter((p) => p.ownerRosterId === 3).map((p) => p.originalRosterId).sort()).toEqual([1, 3]);
    expect(inv.filter((p) => p.ownerRosterId === 1)).toHaveLength(0);
  });

  it('ignores traded entries for seasons or rosters outside the grid', () => {
    const inv = buildPickInventory({
      rosterIds: [1, 2],
      seasons: [2027],
      rounds: 1,
      traded: [
        { season: 2025, round: 1, originalRosterId: 1, ownerRosterId: 2 },
        { season: 2027, round: 1, originalRosterId: 9, ownerRosterId: 2 },
      ],
    });
    expect(inv.every((p) => p.ownerRosterId === p.originalRosterId)).toBe(true);
  });
});

describe('projectDraftSlots', () => {
  it('gives the worst record the first pick, points-for breaking ties', () => {
    const slots = projectDraftSlots([
      { rosterId: 1, wins: 8, losses: 2, ties: 0, pointsFor: 1300 },
      { rosterId: 2, wins: 2, losses: 8, ties: 0, pointsFor: 1100 },
      { rosterId: 3, wins: 2, losses: 8, ties: 0, pointsFor: 1000 },
    ]);
    expect(slots.get(3)).toBe(1);
    expect(slots.get(2)).toBe(2);
    expect(slots.get(1)).toBe(3);
  });

  it('projects nothing before any games are played', () => {
    expect(projectDraftSlots([{ rosterId: 1, wins: 0, losses: 0, ties: 0, pointsFor: 0 }]).size).toBe(0);
  });
});

describe('parsePickLabel', () => {
  it('reads every spelling FantasyCalc uses', () => {
    expect(parsePickLabel('2026 Pick 1.01')).toEqual({ season: 2026, round: 1, slot: 1, tier: null });
    expect(parsePickLabel('2027 Early 1st')).toEqual({ season: 2027, round: 1, slot: null, tier: 'early' });
    expect(parsePickLabel('2027 1st (Late)')).toEqual({ season: 2027, round: 1, slot: null, tier: 'late' });
    expect(parsePickLabel('2028 2nd')).toEqual({ season: 2028, round: 2, slot: null, tier: null });
    expect(parsePickLabel('2027 Mid 3rd').tier).toBe('mid');
  });
});

describe('createPickPricer', () => {
  const market = [
    { label: '2027 Pick 1.01', value: 9000 },
    { label: '2027 Pick 1.06', value: 6000 },
    { label: '2027 Pick 1.12', value: 4000 },
    { label: '2028 Early 1st', value: 7000 },
    { label: '2028 Mid 1st', value: 5500 },
    { label: '2028 Late 1st', value: 4500 },
    { label: '2028 2nd', value: 2000 },
    { label: '2029 1st', value: 5000 },
  ];
  const pricer = createPickPricer(market, 12);

  it('uses the nearest exact slot when one is quoted', () => {
    expect(pricer.price({ season: 2027, round: 1, slot: 2 })).toBe(9000);
    expect(pricer.price({ season: 2027, round: 1, slot: 7 })).toBe(6000);
  });

  it('averages the slots when the slot is unknown', () => {
    expect(pricer.price({ season: 2027, round: 1, slot: null })).toBe(6333);
  });

  it('prices by tier, defaulting to mid', () => {
    expect(pricer.price({ season: 2028, round: 1, slot: 1 })).toBe(7000);
    expect(pricer.price({ season: 2028, round: 1, slot: null })).toBe(5500);
  });

  it('borrows the nearest quoted season for a draft the market does not list', () => {
    expect(pricer.price({ season: 2030, round: 1, slot: null })).toBe(5000);
    expect(pricer.price({ season: 2027, round: 2, slot: null })).toBe(2000);
  });

  it('is zero for a round nobody quotes', () => {
    expect(pricer.price({ season: 2027, round: 5, slot: null })).toBe(0);
  });
});

describe('naming', () => {
  it('names picks the way managers say them', () => {
    expect(pickName({ season: 2027, round: 1 }, 'early')).toBe('2027 Early 1st');
    expect(pickName({ season: 2028, round: 3 }, null)).toBe('2028 3rd');
    expect(tierOfSlot(4, 12)).toBe('early');
    expect(tierOfSlot(5, 12)).toBe('mid');
    expect(tierOfSlot(9, 12)).toBe('late');
  });
});
