import { describe, it, expect } from 'vitest';
import { calendarWeek, clampWeek, liveWeekFromState, pickWeek } from './week';

describe('clampWeek', () => {
  it('accepts a real week from either a number or a query string', () => {
    expect(clampWeek(2)).toBe(2);
    expect(clampWeek('2')).toBe(2);
    expect(clampWeek(18)).toBe(18);
  });

  it('rejects anything outside the season', () => {
    expect(clampWeek(0)).toBeNull();
    expect(clampWeek(19)).toBeNull();
    expect(clampWeek(-3)).toBeNull();
  });

  it('rejects junk instead of turning it into week 0', () => {
    expect(clampWeek('banana')).toBeNull();
    expect(clampWeek('')).toBeNull();
    expect(clampWeek(null)).toBeNull();
    expect(clampWeek(undefined)).toBeNull();
    expect(clampWeek(Number.NaN)).toBeNull();
  });
});

describe('pickWeek', () => {
  it('honours an explicit week from the URL', () => {
    expect(pickWeek('5', 2)).toBe(5);
  });

  it('falls back to the live week when none is requested', () => {
    // The actual bug: no ?week= meant week 1 forever, even in week 2.
    expect(pickWeek(undefined, 2)).toBe(2);
    expect(pickWeek(null, 11)).toBe(11);
  });

  it('ignores an unusable request rather than rendering an empty week', () => {
    expect(pickWeek('0', 3)).toBe(3);
    expect(pickWeek('banana', 3)).toBe(3);
  });

  it('lands on week 1 only when nothing is known', () => {
    expect(pickWeek(undefined, 0)).toBe(1);
  });
});

describe('calendarWeek', () => {
  // 2026 opener: Thursday 10 September.
  const start = '2026-09-10';

  it('is week 1 before and through the opening week', () => {
    expect(calendarWeek(start, new Date('2026-08-20T12:00:00Z'))).toBe(1);
    expect(calendarWeek(start, new Date('2026-09-10T12:00:00Z'))).toBe(1);
    expect(calendarWeek(start, new Date('2026-09-14T23:00:00Z'))).toBe(1); // Monday night
  });

  it('rolls over early Tuesday, not when Sleeper gets round to it', () => {
    expect(calendarWeek(start, new Date('2026-09-15T09:59:00Z'))).toBe(1);
    expect(calendarWeek(start, new Date('2026-09-15T10:00:00Z'))).toBe(2);
    // Tuesday 24 November 2026 is the start of week 12.
    expect(calendarWeek(start, new Date('2026-11-24T15:00:00Z'))).toBe(12);
  });

  it('stops at week 18 and ignores a missing start date', () => {
    expect(calendarWeek(start, new Date('2027-01-30T12:00:00Z'))).toBe(18);
    expect(calendarWeek('', new Date())).toBeNull();
    expect(calendarWeek(undefined, new Date())).toBeNull();
  });
});

describe('liveWeekFromState', () => {
  const tuesday = new Date('2026-11-24T15:00:00Z');

  it('moves past a Sleeper counter still on last week', () => {
    expect(
      liveWeekFromState({ week: 11, display_week: 11, season_type: 'regular', season_start_date: '2026-09-10' }, tuesday),
    ).toBe(12);
  });

  it('never goes behind Sleeper', () => {
    expect(
      liveWeekFromState({ week: 13, display_week: 13, season_type: 'regular', season_start_date: '2026-09-10' }, tuesday),
    ).toBe(13);
  });

  it('trusts Sleeper outside the regular season', () => {
    expect(liveWeekFromState({ week: 0, display_week: 1, season_type: 'pre', season_start_date: '2026-09-10' }, tuesday)).toBe(1);
  });
});
