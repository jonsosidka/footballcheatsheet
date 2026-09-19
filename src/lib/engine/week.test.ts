import { describe, it, expect } from 'vitest';
import { clampWeek, pickWeek } from './week';

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
