import { describe, it, expect } from 'vitest';
import {
  weeklyAvailability,
  isOutStatus,
  isOnBye,
  AVAILABILITY_MULTIPLIERS,
} from './availability';

describe('isOutStatus', () => {
  it('recognizes every spelling Sleeper ships for "not playing"', () => {
    for (const status of [
      'Out',
      'IR',
      'Injured Reserve',
      'PUP',
      'Physically Unable to Perform',
      'NFI',
      'Non Football Injury',
      'Suspended',
      'Sus',
      'Inactive',
      'DNP',
      'NA',
      'Reserve/COVID-19',
    ]) {
      expect(isOutStatus(status), status).toBe(true);
    }
  });

  it('does not fire on statuses that still play', () => {
    for (const status of ['Active', 'Questionable', 'Doubtful', 'Practice Squad', null, '']) {
      expect(isOutStatus(status), String(status)).toBe(false);
    }
  });

  it('does not match "out" inside an unrelated word', () => {
    // The guard that makes \bout\b a word boundary rather than a substring.
    expect(isOutStatus('Workout')).toBe(false);
  });
});

describe('isOnBye', () => {
  it('is true only when the bye week is the week being projected', () => {
    expect(isOnBye(7, 7)).toBe(true);
    expect(isOnBye(7, 8)).toBe(false);
    expect(isOnBye(null, 7)).toBe(false);
    expect(isOnBye(7, null)).toBe(false);
  });
});

describe('weeklyAvailability', () => {
  it('zeroes out a ruled-out player and forbids starting him', () => {
    const result = weeklyAvailability({ injuryStatus: 'Out', week: 3 });
    expect(result.playStatus).toBe('out');
    expect(result.multiplier).toBe(0);
    expect(result.startable).toBe(false);
    expect(result.reason).toContain('will not play');
  });

  it('treats a bye exactly as harshly as an injury, and says which it is', () => {
    const result = weeklyAvailability({ byeWeek: 9, week: 9 });
    expect(result.playStatus).toBe('bye');
    expect(result.multiplier).toBe(0);
    expect(result.startable).toBe(false);
    expect(result.label).toBe('BYE');
  });

  it('reads the roster status when there is no weekly injury tag', () => {
    // A player parked on IR all season carries status but no injury_status.
    const result = weeklyAvailability({ status: 'Injured Reserve', week: 4 });
    expect(result.startable).toBe(false);
    expect(result.multiplier).toBe(0);
  });

  it('keeps a doubtful player startable but guts the projection', () => {
    const result = weeklyAvailability({ injuryStatus: 'Doubtful', week: 5 });
    expect(result.playStatus).toBe('doubtful');
    expect(result.multiplier).toBe(AVAILABILITY_MULTIPLIERS.doubtful);
    // Startable on purpose: if he is the only body for the slot, an empty slot
    // is strictly worse than a long shot.
    expect(result.startable).toBe(true);
  });

  it('takes only a modest haircut on questionable', () => {
    const result = weeklyAvailability({ injuryStatus: 'Questionable', week: 5 });
    expect(result.playStatus).toBe('questionable');
    expect(result.multiplier).toBeGreaterThan(0.8);
    expect(result.multiplier).toBeLessThan(1);
    expect(result.startable).toBe(true);
  });

  it('leaves a healthy player completely alone', () => {
    const result = weeklyAvailability({ status: 'Active', injuryStatus: null, byeWeek: 9, week: 5 });
    expect(result.playStatus).toBe('active');
    expect(result.multiplier).toBe(1);
    expect(result.startable).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('reports the bye when a player is both on bye and banged up', () => {
    // Bye is checked first: it is the certain fact, the tag is the uncertain one.
    const result = weeklyAvailability({ injuryStatus: 'Questionable', byeWeek: 6, week: 6 });
    expect(result.playStatus).toBe('bye');
    expect(result.multiplier).toBe(0);
  });
});
