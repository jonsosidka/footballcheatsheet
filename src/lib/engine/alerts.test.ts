import { describe, it, expect } from 'vitest';
import { buildAlerts, type AlertPlayer } from './alerts';

const player = (extra: Partial<AlertPlayer> = {}): AlertPlayer => ({
  playerId: 'p1',
  name: 'Test Player',
  position: 'RB',
  injuryStatus: null,
  status: null,
  points: 12,
  previousPoints: null,
  isStarting: true,
  ...extra,
});

const build = (players: AlertPlayer[], week = 5) =>
  buildAlerts({
    week,
    players,
    pointsLeftOnBench: 0,
    topChange: null,
    slotMoves: [],
    waiverTargets: [],
  });

describe('buildAlerts injury handling', () => {
  it('raises a critical alert for a starter who is ruled out', () => {
    const [alert] = build([player({ injuryStatus: 'Out' })]);
    expect(alert.type).toBe('starting-inactive');
    expect(alert.severity).toBe('critical');
    expect(alert.title).toContain('Bench');
  });

  it('raises it for a starter on bye, not just an injured one', () => {
    const alerts = build([player({ byeWeek: 5 })], 5);
    expect(alerts[0].type).toBe('starting-inactive');
    expect(alerts[0].body).toContain('bye');
  });

  it('stays quiet about a player on bye in some other week', () => {
    expect(build([player({ byeWeek: 9 })], 5)).toHaveLength(0);
  });

  it('warns rather than screams about a questionable starter', () => {
    const [alert] = build([player({ injuryStatus: 'Questionable' })]);
    expect(alert.type).toBe('injury-change');
    expect(alert.severity).toBe('warn');
  });

  it('says nothing about an injured player who is already benched', () => {
    expect(build([player({ injuryStatus: 'Out', isStarting: false })])).toHaveLength(0);
  });

  it('reads the roster status when there is no weekly injury tag', () => {
    const [alert] = build([player({ status: 'Injured Reserve' })]);
    expect(alert.type).toBe('starting-inactive');
    expect(alert.title).toContain('Injured Reserve');
  });
});
