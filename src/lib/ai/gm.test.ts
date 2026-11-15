import { describe, it, expect } from 'vitest';
import type { TradePlayer, TradeTeam } from '@/lib/engine/trades';
import { checkMoves, gmUserPrompt, type RawMove, type WaiverOption } from './gm';
import type { LeagueFacts } from './tradePrompt';

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

const team = (rosterId: number, players: TradePlayer[], standing: number): TradeTeam => ({
  rosterId,
  name: `Team ${rosterId}`,
  posture: 'bubble',
  trajectory: 'stable',
  players,
  needs: new Map(),
  rosterPositions: POSITIONS,
  baselineStrength: 900,
  record: { wins: 10 - standing, losses: standing, ties: 0, pointsFor: 1000, standing },
});

const league: LeagueFacts = {
  name: 'L',
  season: '2026',
  week: 10,
  leagueType: 2,
  isDynasty: true,
  isSuperflex: false,
  totalRosters: 3,
  pprType: 1,
  rosterPositions: POSITIONS,
  scoringSettings: { rec: 1 },
  playoffWeekStart: 15,
  playoffTeams: 2,
};

const me = team(1, [pl('m1', 'WR', 150, 4000), pl('m2', 'RB', 120, 3000)], 2);
const rivalA = team(2, [pl('a1', 'RB', 160, 3500)], 3);
const rivalB = team(3, [pl('b1', 'TE', 90, 2000)], 1);
const waivers: WaiverOption[] = [
  {
    add: { playerId: 'fa1', name: 'Free Agent', position: 'WR', team: 'NYJ', age: 23, rosPoints: 60 },
    drop: null,
    vor: 3.2,
    bid: 7,
    rationale: '',
  },
];
const input = { league, me, rivals: [rivalA, rivalB], waivers };

const move = (m: Partial<RawMove>): RawMove => ({
  kind: 'note',
  headline: 'h',
  why: 'w',
  partner_roster_id: null,
  give_ids: [],
  get_ids: [],
  add_id: null,
  drop_id: null,
  ...m,
});

describe('checkMoves', () => {
  it('keeps a valid trade and attaches the engine grade', () => {
    const r = checkMoves(
      { summary: 's', moves: [move({ kind: 'trade', partner_roster_id: 2, give_ids: ['m2'], get_ids: ['a1'] })] },
      input,
    );
    expect(r.rejected).toEqual([]);
    expect(r.moves[0].kind).toBe('trade');
    if (r.moves[0].kind === 'trade') {
      expect(r.moves[0].offer.partnerName).toBe('Team 2');
      expect(r.moves[0].offer.grades.mine).toMatch(/^[A-DF]/);
    }
  });

  it('drops a trade that asks for a player on a different team', () => {
    const r = checkMoves(
      { summary: 's', moves: [move({ kind: 'trade', partner_roster_id: 2, give_ids: ['m2'], get_ids: ['b1'] })] },
      input,
    );
    expect(r.moves).toEqual([]);
    expect(r.rejected[0].reason).toContain('not on Team 2');
  });

  it('drops a trade that offers someone I do not have', () => {
    const r = checkMoves(
      { summary: 's', moves: [move({ kind: 'trade', partner_roster_id: 2, give_ids: ['a1'], get_ids: ['a1'] })] },
      input,
    );
    expect(r.rejected[0].reason).toContain('not on your roster');
  });

  it('only accepts waiver adds from the waiver list', () => {
    const r = checkMoves(
      {
        summary: 's',
        moves: [move({ kind: 'waiver', add_id: 'fa1', drop_id: 'm2' }), move({ kind: 'waiver', add_id: 'a1' })],
      },
      input,
    );
    expect(r.moves).toHaveLength(1);
    if (r.moves[0].kind === 'waiver') expect(r.moves[0].drop?.playerId).toBe('m2');
    expect(r.rejected[0].reason).toContain('waiver list');
  });

  it('passes notes through and survives junk', () => {
    expect(checkMoves({ summary: 's', moves: [move({})] }, input).moves[0].kind).toBe('note');
    expect(checkMoves('nope', input).moves).toEqual([]);
  });
});

describe('gmUserPrompt', () => {
  it('lists rivals by standing with roster ids and player ids', () => {
    const text = gmUserPrompt({ ...input, ideas: [], faabRemaining: 42 });
    expect(text.indexOf('Team 3" (roster_id 3)')).toBeLessThan(text.indexOf('Team 2" (roster_id 2)'));
    expect(text).toContain('[a1] Player a1');
    expect(text).toContain('add [fa1] Free Agent');
    expect(text).toContain('FAAB remaining: $42');
    expect(text).toContain('The engine found no mutually beneficial trades');
  });
});
