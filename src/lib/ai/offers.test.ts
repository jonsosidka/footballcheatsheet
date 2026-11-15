import { describe, it, expect } from 'vitest';
import type { TradePlayer, TradeTeam } from '@/lib/engine/trades';
import { checkPackages, offerUserPrompt, type OfferAsk } from './offers';

const POSITIONS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'];

const pl = (playerId: string, position: string, rosPoints: number, dynastyValue: number): TradePlayer => ({
  playerId,
  name: `Player ${playerId}`,
  position,
  team: 'KC',
  age: 26,
  rosPoints,
  eligiblePositions: [position],
  dynastyValue,
  redraftValue: dynastyValue,
});

const team = (rosterId: number, players: TradePlayer[]): TradeTeam => ({
  rosterId,
  name: `Team ${rosterId}`,
  posture: 'bubble',
  trajectory: 'stable',
  players,
  needs: new Map(),
  rosterPositions: POSITIONS,
  baselineStrength: 900,
});

const me = team(1, [pl('m1', 'WR', 150, 4000), pl('m2', 'RB', 120, 3000), pl('m3', 'WR', 40, 900), pl('m4', 'TE', 30, 500)]);
const partner = team(2, [pl('t1', 'QB', 300, 4000), pl('t2', 'WR', 50, 600), pl('t3', 'RB', 40, 400)]);

const ask: OfferAsk = {
  league: {
    name: 'L', season: '2026', week: 10, leagueType: 2, isDynasty: true, isSuperflex: false, totalRosters: 2,
    pprType: 1, rosterPositions: POSITIONS, scoringSettings: { rec: 1 }, playoffWeekStart: 15, playoffTeams: 2,
  },
  me,
  partner,
  wants: [partner.players[0]],
  mustGive: [me.players[2]],
  untouchable: [me.players[0]],
  candidates: [],
};

const pkg = (give_ids: string[], get_ids: string[], headline = 'h') => ({ headline, why: 'w', give_ids, get_ids });
const check = (...packages: ReturnType<typeof pkg>[]) => checkPackages({ summary: 's', packages }, ask);

describe('checkPackages', () => {
  it('keeps a package that follows the ask and grades it', () => {
    const r = check(pkg(['m3', 'm2'], ['t1']));
    expect(r.rejected).toEqual([]);
    expect(r.packages[0].offer.mine.gets.map((p) => p.playerId)).toEqual(['t1']);
    expect(r.packages[0].offer.grades.mine).toBeTruthy();
  });

  it('enforces wants, pins and keeps', () => {
    const r = check(
      pkg(['m3', 'm2'], ['t2'], 'missing want'),
      pkg(['m2'], ['t1'], 'missing pin'),
      pkg(['m3', 'm1'], ['t1'], 'offers a keeper'),
      pkg(['m3', 't2'], ['t1'], 'not mine'),
    );
    expect(r.packages).toEqual([]);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      'It leaves out a player you asked for.',
      'It leaves out a player you pinned.',
      'It offers a player you marked keep.',
      'It offers a player who is not on your roster.',
    ]);
    expect(check(pkg(['m3'], ['t1', 't2', 't3'], 'too greedy')).rejected[0].reason).toBe(
      'It asks for more than one extra player.',
    );
  });

  it('allows one balancing extra from their side and drops duplicates', () => {
    const r = check(pkg(['m3', 'm2'], ['t1', 't2']), pkg(['m2', 'm3'], ['t2', 't1']));
    expect(r.packages).toHaveLength(1);
  });

  it('survives junk', () => {
    expect(checkPackages(null, ask).packages).toEqual([]);
  });
});

describe('offerUserPrompt', () => {
  it('spells out the ask with ids', () => {
    const text = offerUserPrompt(ask);
    expect(text).toContain('I want: [t1] Player t1');
    expect(text).toContain('Must include from my side: [m3] Player m3');
    expect(text).toContain('Off the table: [m1] Player m1');
    expect(text).toContain('The engine found no package');
  });
});
