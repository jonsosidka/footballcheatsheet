import { describe, it, expect } from 'vitest';
import { requiredByPosition, flexDemand, findByeGaps, coversByeGaps, type ByeRosterPlayer } from './byes';
import { parseSchedule, deriveByeWeeks } from '@/lib/sources/nflverse';

const POSITIONS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'IR'];

const p = (playerId: string, position: string, team: string, rosPoints = 100): ByeRosterPlayer => ({
  playerId,
  name: playerId,
  position,
  team,
  rosPoints,
});

describe('requiredByPosition', () => {
  it('counts dedicated slots only', () => {
    const req = requiredByPosition(POSITIONS);
    expect(req.get('RB')).toBe(2);
    expect(req.get('WR')).toBe(2);
    expect(req.get('QB')).toBe(1);
    expect(req.get('TE')).toBe(1);
  });

  it('excludes bench, IR and taxi', () => {
    const req = requiredByPosition(['QB', 'BN', 'BN', 'IR', 'TAXI']);
    expect(req.get('QB')).toBe(1);
    expect([...req.keys()]).toEqual(['QB']);
  });

  it('does not add flex demand onto every eligible position', () => {
    // A single FLEX is one body, not one at RB *and* WR *and* TE.
    const req = requiredByPosition(POSITIONS);
    expect(req.get('RB')).toBe(2); // not 3
    expect(req.get('TE')).toBe(1); // not 2
  });
});

describe('flexDemand', () => {
  it('groups flex slots by their eligible positions', () => {
    const flex = flexDemand(['FLEX', 'FLEX', 'SUPER_FLEX', 'BN']);
    const standard = flex.find((f) => f.positions.join() === 'RB,WR,TE');
    const superflex = flex.find((f) => f.positions.includes('QB'));
    expect(standard?.count).toBe(2);
    expect(superflex?.count).toBe(1);
  });
});

describe('findByeGaps', () => {
  const byes = new Map([
    ['BUF', 7],
    ['MIA', 7],
    ['KC', 5],
    ['SF', 9],
    ['DAL', 7],
  ]);

  it('flags a week where byes leave a position short', () => {
    const roster = [
      p('wr1', 'WR', 'BUF'),
      p('wr2', 'WR', 'MIA'),
      p('wr3', 'WR', 'DAL'),
      p('qb1', 'QB', 'SF'),
      p('rb1', 'RB', 'SF'),
      p('rb2', 'RB', 'KC'),
      p('te1', 'TE', 'SF'),
      p('k1', 'K', 'SF'),
      p('def1', 'DEF', 'SF'),
    ];

    const gaps = findByeGaps({
      rosterPositions: POSITIONS,
      roster,
      byeWeeks: byes,
      currentWeek: 1,
      lastRegularWeek: 14,
    });

    const wr7 = gaps.find((g) => g.week === 7 && g.position === 'WR');
    expect(wr7).toBeDefined();
    expect(wr7!.required).toBe(2);
    expect(wr7!.available).toBe(0); // all three WRs on bye
    expect(wr7!.shortBy).toBe(2);
    expect(wr7!.severity).toBe('critical');
    expect(wr7!.onBye.map((x) => x.playerId).sort()).toEqual(['wr1', 'wr2', 'wr3']);
  });

  it('stays quiet when byes are covered', () => {
    const roster = [
      p('wr1', 'WR', 'BUF'),
      p('wr2', 'WR', 'SF'),
      p('wr3', 'WR', 'KC'),
      p('wr4', 'WR', 'SF'),
      p('qb1', 'QB', 'SF'),
      p('qb2', 'QB', 'KC'),
      p('rb1', 'RB', 'SF'),
      p('rb2', 'RB', 'KC'),
      p('rb3', 'RB', 'SF'),
      p('te1', 'TE', 'SF'),
      p('te2', 'TE', 'KC'),
      p('k1', 'K', 'SF'),
      p('k2', 'K', 'KC'),
      p('def1', 'DEF', 'SF'),
      p('def2', 'DEF', 'KC'),
    ];
    const gaps = findByeGaps({
      rosterPositions: POSITIONS,
      roster,
      byeWeeks: byes,
      currentWeek: 1,
      lastRegularWeek: 14,
    });
    expect(gaps.filter((g) => g.severity === 'critical')).toHaveLength(0);
  });

  it('only looks forward — a passed bye is not actionable', () => {
    const roster = [p('k1', 'K', 'KC')]; // KC bye is week 5
    const past = findByeGaps({
      rosterPositions: ['K'],
      roster,
      byeWeeks: byes,
      currentWeek: 8,
      lastRegularWeek: 14,
    });
    expect(past).toHaveLength(0);

    const upcoming = findByeGaps({
      rosterPositions: ['K'],
      roster,
      byeWeeks: byes,
      currentWeek: 1,
      lastRegularWeek: 14,
    });
    expect(upcoming.find((g) => g.week === 5)).toBeDefined();
  });

  it('sorts nearest problems first', () => {
    const roster = [p('k1', 'K', 'KC'), p('qb1', 'QB', 'SF')];
    const gaps = findByeGaps({
      rosterPositions: ['QB', 'K'],
      roster,
      byeWeeks: byes,
      currentWeek: 1,
      lastRegularWeek: 14,
    });
    expect(gaps[0].week).toBeLessThanOrEqual(gaps[gaps.length - 1].week);
  });
});

describe('coversByeGaps', () => {
  const byes = new Map([['BUF', 7], ['SF', 9]]);
  const gaps = [
    { week: 7, position: 'WR', required: 2, available: 0, shortBy: 2, onBye: [], severity: 'critical' as const },
  ];

  it('identifies a free agent who solves the gap', () => {
    expect(coversByeGaps({ position: 'WR', team: 'SF' }, gaps, byes)).toEqual([7]);
  });

  it('rejects one who is on bye the same week', () => {
    expect(coversByeGaps({ position: 'WR', team: 'BUF' }, gaps, byes)).toEqual([]);
  });

  it('rejects the wrong position', () => {
    expect(coversByeGaps({ position: 'RB', team: 'SF' }, gaps, byes)).toEqual([]);
  });
});

describe('deriveByeWeeks', () => {
  const csv = [
    'season,game_type,week,gameday,away_team,home_team',
    '2026,REG,1,2026-09-10,NE,SEA',
    '2026,REG,1,2026-09-13,KC,BUF',
    '2026,REG,2,2026-09-17,SEA,NE',
    '2026,REG,2,2026-09-20,BUF,KC',
    '2026,REG,3,2026-09-24,NE,KC',
  ].join('\n');

  it('derives a bye from absence in a week', () => {
    const byes = deriveByeWeeks(parseSchedule(csv));
    // Week 3 has only NE and KC — SEA and BUF are off.
    expect(byes.get('SEA')).toBe(3);
    expect(byes.get('BUF')).toBe(3);
    expect(byes.has('NE')).toBe(false);
    expect(byes.has('KC')).toBe(false);
  });

  it('maps nflverse abbreviations onto Sleeper', () => {
    const withLa = ['season,game_type,week,gameday,away_team,home_team', '2026,REG,1,2026-09-10,LA,WSH'].join('\n');
    const games = parseSchedule(withLa);
    expect(games[0].awayTeam).toBe('LAR');
    expect(games[0].homeTeam).toBe('WAS');
  });

  it('returns empty rather than guessing when there is no regular season data', () => {
    expect(deriveByeWeeks([]).size).toBe(0);
  });
});

describe('flex coverage from positions with no dedicated slot', () => {
  // MOAT Dynasty: two IDP_FLEX slots, no dedicated DL/LB/DB slots. Four
  // defenders cover two slots comfortably, but seeding spare capacity only
  // from positions that have dedicated slots reported "need 2, have 0" in
  // every single week.
  const IDP_LEAGUE = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'IDP_FLEX', 'IDP_FLEX', 'BN'];

  const roster: ByeRosterPlayer[] = [
    p('lb1', 'LB', 'SF'),
    p('lb2', 'LB', 'KC'),
    p('lb3', 'LB', 'DAL'),
    p('de1', 'DE', 'SF'),
    p('qb1', 'QB', 'SF'),
    p('rb1', 'RB', 'SF'),
    p('rb2', 'RB', 'KC'),
    p('wr1', 'WR', 'SF'),
    p('wr2', 'WR', 'KC'),
    p('wr3', 'WR', 'DAL'),
    p('te1', 'TE', 'SF'),
    p('k1', 'K', 'SF'),
  ];

  const byes = new Map([['SF', 9], ['KC', 5], ['DAL', 7]]);

  it('does not invent an IDP shortage when defenders are rostered', () => {
    const gaps = findByeGaps({
      rosterPositions: IDP_LEAGUE,
      roster,
      byeWeeks: byes,
      currentWeek: 1,
      lastRegularWeek: 14,
    });

    // Week 5 loses only lb2 (KC). Three defenders remain for two slots.
    const week5Idp = gaps.find((g) => g.week === 5 && g.position.includes('LB'));
    expect(week5Idp).toBeUndefined();
  });

  it('still reports a genuine flex shortage', () => {
    // Week 9 wipes out SF: lb1 and de1 gone, leaving lb2 and lb3 — exactly 2.
    // Drop one and it becomes a real gap.
    const thin = roster.filter((x) => x.playerId !== 'lb3');
    const gaps = findByeGaps({
      rosterPositions: IDP_LEAGUE,
      roster: thin,
      byeWeeks: byes,
      currentWeek: 1,
      lastRegularWeek: 14,
    });
    const week9 = gaps.find((g) => g.week === 9 && g.position.includes('LB'));
    expect(week9).toBeDefined();
    expect(week9!.shortBy).toBe(1);
  });
});
