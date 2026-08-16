import { describe, it, expect } from 'vitest';
import { computeNeeds, rankWaiverTargets, needGroupOf, type WaiverCandidate } from './waivers';

const POSITIONS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN'];

const fa = (
  playerId: string,
  position: string,
  rosPoints: number,
  extra: Partial<WaiverCandidate> = {},
): WaiverCandidate => ({
  playerId,
  name: playerId,
  position,
  team: 'XXX',
  age: 25,
  rosPoints,
  weekPoints: rosPoints / 14,
  dynastyValue: null,
  trend30Day: null,
  trendingAdds: 0,
  injuryStatus: null,
  ...extra,
});

describe('computeNeeds', () => {
  it('counts flex slots fractionally across eligible positions', () => {
    const needs = computeNeeds(POSITIONS, [], [fa('a', 'RB', 100), fa('b', 'TE', 50)]);
    // 2 dedicated RB + 1 FLEX at 0.4
    expect(needs.get('RB')!.startingDemand).toBeCloseTo(2.4, 5);
    expect(needs.get('TE')!.startingDemand).toBeCloseTo(1.4, 5);
  });

  it('ignores positions the league never starts', () => {
    const needs = computeNeeds(['QB', 'RB', 'BN'], [], [fa('lb', 'LB', 90)]);
    expect(needs.has('LB')).toBe(false);
  });

  it('reports high need when a position is unfilled', () => {
    const needs = computeNeeds(POSITIONS, [], [fa('a', 'RB', 80)]);
    expect(needs.get('RB')!.needScore).toBeGreaterThan(0.5);
    expect(needs.get('RB')!.rosteredCount).toBe(0);
  });

  it('reports low need when incumbents far exceed replacement', () => {
    const mine = [
      { position: 'RB', rosPoints: 240 },
      { position: 'RB', rosPoints: 220 },
      { position: 'RB', rosPoints: 200 },
    ];
    const needs = computeNeeds(POSITIONS, mine, [fa('scrub', 'RB', 40)]);
    expect(needs.get('RB')!.needScore).toBeLessThan(0.3);
  });

  it('treats replacement level as the best actually-available free agent', () => {
    const needs = computeNeeds(POSITIONS, [], [fa('a', 'WR', 120), fa('b', 'WR', 60)]);
    expect(needs.get('WR')!.replacementPoints).toBe(120);
  });
});

describe('rankWaiverTargets', () => {
  const myRoster: WaiverCandidate[] = [
    fa('myQB', 'QB', 300),
    fa('myRB1', 'RB', 200),
    fa('myRB2', 'RB', 90),
    fa('myWR1', 'WR', 210),
    fa('myWR2', 'WR', 190),
    fa('myTE', 'TE', 150),
    fa('myK', 'K', 120),
    fa('myDEF', 'DEF', 110),
    fa('youngStash', 'WR', 20, { age: 22, dynastyValue: 3000 }),
    fa('oldScrub', 'RB', 25, { age: 31, dynastyValue: 200 }),
  ];

  const freeAgents: WaiverCandidate[] = [
    fa('bigRB', 'RB', 160, { dynastyValue: 2500, age: 24 }),
    fa('okWR', 'WR', 95),
    fa('hypeRB', 'RB', 130, { trendingAdds: 42000, dynastyValue: 1800, age: 23 }),
  ];

  it('surfaces an upgrade over a weak incumbent', () => {
    const results = rankWaiverTargets({
      rosterPositions: POSITIONS,
      freeAgents,
      myRoster,
      posture: 'contend',
      isDynasty: false,
      openSlots: 1,
    });

    expect(results.length).toBeGreaterThan(0);
    const top = results[0];
    expect(['bigRB', 'hypeRB']).toContain(top.add.playerId);
    // RB2 is the weak link at 90; a 160-point RB is a clear upgrade.
    expect(top.score.winNowDelta).toBeGreaterThan(0);
  });

  it('pairs a drop when the roster is full and leaves it null when it is not', () => {
    const full = rankWaiverTargets({
      rosterPositions: POSITIONS,
      freeAgents,
      myRoster,
      posture: 'contend',
      isDynasty: false,
      openSlots: 0,
    });
    expect(full[0].drop).not.toBeNull();
    expect(full[0].rationale).toMatch(/costs you/i);

    const open = rankWaiverTargets({
      rosterPositions: POSITIONS,
      freeAgents,
      myRoster,
      posture: 'contend',
      isDynasty: false,
      openSlots: 2,
    });
    expect(open[0].drop).toBeNull();
    expect(open[0].rationale).toMatch(/open roster spot/i);
  });

  it('protects a young dynasty asset from being the drop while rebuilding', () => {
    const results = rankWaiverTargets({
      rosterPositions: POSITIONS,
      freeAgents,
      myRoster,
      posture: 'rebuild',
      isDynasty: true,
      openSlots: 0,
    });
    // The 22-year-old with 3000 dynasty value must not be the cut.
    for (const suggestion of results) {
      expect(suggestion.drop?.playerId).not.toBe('youngStash');
    }
  });

  it('mentions a heavy trending-add signal', () => {
    const results = rankWaiverTargets({
      rosterPositions: POSITIONS,
      freeAgents,
      myRoster,
      posture: 'contend',
      isDynasty: false,
      openSlots: 1,
    });
    const hype = results.find((r) => r.add.playerId === 'hypeRB');
    expect(hype?.rationale).toMatch(/adds league-wide/i);
  });

  it('ranks the same wire differently for a contender than a rebuilder', () => {
    const base = {
      rosterPositions: POSITIONS,
      freeAgents: [
        fa('vet', 'RB', 170, { age: 30, dynastyValue: 400 }),
        fa('kid', 'RB', 120, { age: 22, dynastyValue: 5000 }),
      ],
      myRoster,
      isDynasty: true,
      openSlots: 1,
    };

    const contender = rankWaiverTargets({ ...base, posture: 'contend' });
    const rebuilder = rankWaiverTargets({ ...base, posture: 'rebuild' });

    expect(contender[0].add.playerId).toBe('vet');
    expect(rebuilder[0].add.playerId).toBe('kid');
  });

  it('skips positions the league does not start', () => {
    const results = rankWaiverTargets({
      rosterPositions: ['QB', 'RB', 'WR', 'BN'],
      freeAgents: [fa('lb', 'LB', 200)],
      myRoster,
      posture: 'contend',
      isDynasty: false,
      openSlots: 1,
    });
    expect(results.find((r) => r.add.position === 'LB')).toBeUndefined();
  });

  it('surfaces a non-starter as a dynasty asset grab but not in redraft', () => {
    const stashOnly = [fa('prospect', 'WR', 10, { age: 21, dynastyValue: 4000 })];

    const dynasty = rankWaiverTargets({
      rosterPositions: POSITIONS,
      freeAgents: stashOnly,
      myRoster,
      posture: 'rebuild',
      isDynasty: true,
      openSlots: 1,
    });
    expect(dynasty.find((r) => r.add.playerId === 'prospect')).toBeDefined();

    const redraft = rankWaiverTargets({
      rosterPositions: POSITIONS,
      freeAgents: stashOnly,
      myRoster,
      posture: 'contend',
      isDynasty: false,
      openSlots: 1,
    });
    expect(redraft.find((r) => r.add.playerId === 'prospect')).toBeUndefined();
  });
});

describe('IDP need grouping', () => {
  const IDP_LEAGUE = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'IDP_FLEX', 'IDP_FLEX', 'BN'];

  it('pools IDP positions when the league only has IDP_FLEX slots', () => {
    expect(needGroupOf('LB', IDP_LEAGUE)).toBe('IDP');
    expect(needGroupOf('DB', IDP_LEAGUE)).toBe('IDP');
    expect(needGroupOf('DE', IDP_LEAGUE)).toBe('IDP');
    expect(needGroupOf('WR', IDP_LEAGUE)).toBe('WR');
  });

  it('keeps IDP positions separate when the league has dedicated slots', () => {
    const dedicated = ['QB', 'RB', 'WR', 'DL', 'LB', 'DB', 'BN'];
    expect(needGroupOf('LB', dedicated)).toBe('LB');
    expect(needGroupOf('DB', dedicated)).toBe('DB');
  });

  it('counts IDP_FLEX demand in full rather than fractionally', () => {
    // Two IDP_FLEX slots means demand for exactly two defenders — not 0.4
    // spread across six separate defensive positions.
    const needs = computeNeeds(IDP_LEAGUE, [], [fa('lb', 'LB', 150)]);
    expect(needs.get('IDP')!.startingDemand).toBe(2);
    expect(needs.has('DB')).toBe(false);
    expect(needs.has('LB')).toBe(false);
  });

  it('does not report a defensive need when IDP slots are already covered', () => {
    // This is the real-world bug: 4 defenders (3 LB + 1 DE) filling 2 slots
    // was reported as a screaming need at DB, DL, CB and S simultaneously.
    const mine = [
      { position: 'LB', rosPoints: 200 },
      { position: 'LB', rosPoints: 190 },
      { position: 'LB', rosPoints: 180 },
      { position: 'DE', rosPoints: 140 },
    ];
    const needs = computeNeeds(IDP_LEAGUE, mine, [fa('freeDB', 'DB', 157)]);
    const idp = needs.get('IDP')!;
    expect(idp.rosteredCount).toBe(4);
    expect(idp.incumbentPoints).toBe(190); // 2nd best fills the 2nd slot
    expect(idp.needScore).toBeLessThan(0.5);
  });

  it('stops a covered IDP corps from flooding the waiver board', () => {
    const myRoster: WaiverCandidate[] = [
      fa('lb1', 'LB', 200),
      fa('lb2', 'LB', 190),
      fa('lb3', 'LB', 180),
      fa('de1', 'DE', 140),
      fa('rb1', 'RB', 90),
      fa('qb1', 'QB', 300),
      fa('wr1', 'WR', 250),
    ];
    const freeAgents: WaiverCandidate[] = [
      fa('freeDB', 'DB', 157),
      fa('freeLB', 'LB', 155),
      fa('freeRB', 'RB', 175),
    ];

    const results = rankWaiverTargets({
      rosterPositions: IDP_LEAGUE,
      freeAgents,
      myRoster,
      posture: 'contend',
      isDynasty: false,
      openSlots: 1,
    });

    // The RB upgrade beats defenders who would not crack the IDP_FLEX slots.
    expect(results[0].add.playerId).toBe('freeRB');
  });
});

describe('drop assignment', () => {
  it('assigns a distinct drop to each suggestion instead of repeating one name', () => {
    const myRoster: WaiverCandidate[] = [
      fa('keep1', 'QB', 300),
      fa('keep2', 'WR', 260),
      fa('weak1', 'RB', 12),
      fa('weak2', 'RB', 14),
      fa('weak3', 'WR', 16),
    ];
    const freeAgents: WaiverCandidate[] = [
      fa('add1', 'RB', 180),
      fa('add2', 'RB', 175),
      fa('add3', 'WR', 170),
    ];

    const results = rankWaiverTargets({
      rosterPositions: POSITIONS,
      freeAgents,
      myRoster,
      posture: 'contend',
      isDynasty: false,
      openSlots: 0,
    });

    const dropIds = results.map((r) => r.drop?.playerId).filter(Boolean);
    expect(dropIds.length).toBeGreaterThan(1);
    expect(new Set(dropIds).size).toBe(dropIds.length);
  });

  it('never proposes dropping the player being added', () => {
    const roster: WaiverCandidate[] = [fa('a', 'RB', 10), fa('b', 'RB', 12)];
    const results = rankWaiverTargets({
      rosterPositions: POSITIONS,
      freeAgents: [fa('c', 'RB', 200)],
      myRoster: roster,
      posture: 'contend',
      isDynasty: false,
      openSlots: 0,
    });
    for (const r of results) expect(r.drop?.playerId).not.toBe(r.add.playerId);
  });
});
