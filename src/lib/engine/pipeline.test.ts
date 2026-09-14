import { describe, it, expect } from 'vitest';
import { projectPlayers, explainLayers, type TeamOdds } from './pipeline';
import { weeklyAvailability } from './availability';
import { optimizeLineup, type LineupPlayer } from './lineup';
import type { ScoringSettings } from '@/db/schema';

const HALF_PPR: ScoringSettings = {
  rush_yd: 0.1,
  rush_td: 6,
  rec: 0.5,
  rec_yd: 0.1,
  rec_td: 6,
};

/** ~14 points of production: the line a feed keeps publishing regardless. */
const RB_LINE = { rush_yd: 80, rush_td: 0.5, rec: 3, rec_yd: 20 };

const noOdds = new Map<string, TeamOdds>();

const project = (availability?: ReturnType<typeof weeklyAvailability>) =>
  projectPlayers(
    [{ playerId: 'rb1', position: 'RB', team: 'SF', stats: RB_LINE, availability }],
    { scoring: HALF_PPR, oddsByTeam: noOdds },
  )[0];

describe('projectPlayers availability', () => {
  it('zeroes the projection of a player who is ruled out', () => {
    const healthy = project();
    const out = project(weeklyAvailability({ injuryStatus: 'Out', week: 3 }));

    expect(healthy.points).toBeGreaterThan(10);
    expect(out.points).toBe(0);
    // The healthy number is kept so the UI can say what he'd be worth.
    expect(out.healthyPoints).toBe(healthy.points);
    expect(out.startable).toBe(false);
    expect(out.playStatus).toBe('out');
  });

  it('zeroes a player on bye even with no injury at all', () => {
    const bye = project(weeklyAvailability({ byeWeek: 7, week: 7 }));
    expect(bye.points).toBe(0);
    expect(bye.startable).toBe(false);
    expect(bye.playStatus).toBe('bye');
  });

  it('discounts questionable without benching him', () => {
    const healthy = project();
    const questionable = project(weeklyAvailability({ injuryStatus: 'Questionable', week: 3 }));

    expect(questionable.points).toBeLessThan(healthy.points);
    expect(questionable.points).toBeGreaterThan(healthy.points * 0.8);
    expect(questionable.startable).toBe(true);
  });

  it('leaves a healthy player untouched when no status is supplied', () => {
    const player = project();
    expect(player.points).toBe(player.healthyPoints);
    expect(player.availabilityMultiplier).toBe(1);
    expect(player.availabilityNote).toBeNull();
  });

  it('leads the explanation with availability, since that is the whole story', () => {
    const out = project(weeklyAvailability({ injuryStatus: 'Out', week: 3 }));
    const text = explainLayers(out);
    expect(text).toContain('Out');
    expect(text).toContain('if he played');
  });

  it('does not let an out player hold a starting slot', () => {
    // The end-to-end shape of the bug: a full-strength projection on a player
    // who is not playing, beating a healthy but lesser option.
    const star = project(weeklyAvailability({ injuryStatus: 'Out', week: 3 }));
    const backup = projectPlayers(
      [{ playerId: 'rb2', position: 'RB', team: 'DAL', stats: { rush_yd: 40, rec: 2, rec_yd: 15 } }],
      { scoring: HALF_PPR, oddsByTeam: noOdds },
    )[0];

    const pool: LineupPlayer[] = [star, backup].map((p) => ({
      playerId: p.playerId,
      position: p.position,
      eligiblePositions: [p.position],
      points: p.points,
      ineligible: !p.startable,
    }));

    const lineup = optimizeLineup(pool, ['RB', 'BN']);
    expect(lineup.assignments[0].playerId).toBe('rb2');
    expect(lineup.benchedPlayerIds).toContain('rb1');
  });
});
