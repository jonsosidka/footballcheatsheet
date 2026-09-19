/**
 * Will he actually play this week?
 *
 * Projection feeds are published as though everyone is healthy and everyone
 * has a game. Rotowire's weekly line for a back who was ruled out on Friday
 * still reads 14 points on Sunday morning, and a player on bye carries a
 * full line too. Consuming those numbers raw is how an optimizer ends up
 * recommending a starter who is going to score zero.
 *
 * This module is the single place that answers the question, so start/sit,
 * waivers, trades and alerts all answer it the same way. Everything else
 * consumes `weeklyAvailability` rather than pattern-matching status strings
 * on its own.
 */

export type PlayStatus = 'active' | 'questionable' | 'doubtful' | 'out' | 'bye';

export interface AvailabilityInput {
  /** Sleeper's roster status: Active, Inactive, Injured Reserve, PUP, ... */
  status?: string | null;
  /** Sleeper's weekly game-status tag: Questionable, Doubtful, Out, IR, ... */
  injuryStatus?: string | null;
  /** The player's team bye week, when known. */
  byeWeek?: number | null;
  /** The week being projected. */
  week?: number | null;
}

export interface Availability {
  playStatus: PlayStatus;
  /** Fraction of the raw projection to believe. */
  multiplier: number;
  /** Whether he may be assigned to a starting slot at all. */
  startable: boolean;
  /** Short tag for the UI, null when there is nothing to flag. */
  label: string | null;
  /** One line explaining the haircut, null when there is none. */
  reason: string | null;
}

/**
 * Statuses that mean he is not playing, in any of the spellings Sleeper uses
 * across `status` and `injury_status`.
 *
 * `\bna\b` is Sleeper's "not active" and `\bdnp\b` its practice-report
 * did-not-participate. "Reserve" covers Reserve/COVID and similar list
 * placements. Practice-squad players are deliberately absent: they can be
 * elevated and play, and their projections are already small.
 */
const OUT_PATTERN =
  /(injured reserve|\bir\b|\bpup\b|physically unable|\bnfi\b|non football injury|suspend|\bsus\b|\bout\b|inactive|\bdnp\b|\bna\b|\bcov\b|covid|reserve)/;

/**
 * How much of a weekly projection survives each game-status tag.
 *
 * Questionable players suit up roughly 70-75% of the time and usually play a
 * near-normal snap share when they do. The haircut here is deliberately
 * lighter than that raw play rate implies, because the projection source
 * already prices some injury news in and double-counting it would bench
 * healthy-enough starters. Doubtful is the opposite case: those players play
 * well under a third of the time, so the projection is mostly fiction.
 */
export const AVAILABILITY_MULTIPLIERS: Record<PlayStatus, number> = {
  active: 1,
  questionable: 0.88,
  doubtful: 0.25,
  out: 0,
  bye: 0,
};

/** True for any status meaning the player will not take a snap. */
export function isOutStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return OUT_PATTERN.test(status.toLowerCase());
}

/** True when this player's team is on bye in the given week. */
export function isOnBye(byeWeek: number | null | undefined, week: number | null | undefined): boolean {
  return !!byeWeek && !!week && byeWeek === week;
}

/** An always-available result, for players we have no status for at all. */
export const FULLY_AVAILABLE: Availability = {
  playStatus: 'active',
  multiplier: 1,
  startable: true,
  label: null,
  reason: null,
};

/**
 * Resolve a player's weekly availability.
 *
 * Ruled out and on bye are hard exclusions — `startable: false` keeps them out
 * of the optimal lineup entirely rather than merely ranking them last, because
 * "he is projected for 0.0" and "do not start him" are different statements
 * and only the second one is useful at 12:55 on Sunday.
 *
 * Doubtful stays startable on purpose. It is a heavy discount, not a ban: if a
 * doubtful player is genuinely the only body you have for a slot, starting him
 * beats leaving it empty.
 */
export function weeklyAvailability(input: AvailabilityInput): Availability {
  const { status, injuryStatus } = input;

  if (isOnBye(input.byeWeek, input.week)) {
    return {
      playStatus: 'bye',
      multiplier: AVAILABILITY_MULTIPLIERS.bye,
      startable: false,
      label: 'BYE',
      reason: `On bye in week ${input.week}.`,
    };
  }

  if (isOutStatus(injuryStatus) || isOutStatus(status)) {
    const tag = injuryStatus ?? status ?? 'Out';
    return {
      playStatus: 'out',
      multiplier: AVAILABILITY_MULTIPLIERS.out,
      startable: false,
      label: tag,
      reason: `Listed ${tag} — he will not play.`,
    };
  }

  const tag = (injuryStatus ?? '').toLowerCase();

  if (/doubtful/.test(tag)) {
    return {
      playStatus: 'doubtful',
      multiplier: AVAILABILITY_MULTIPLIERS.doubtful,
      startable: true,
      label: injuryStatus ?? 'Doubtful',
      reason: `Doubtful — projection cut to ${Math.round(AVAILABILITY_MULTIPLIERS.doubtful * 100)}%. Treat him as out unless you have nobody else.`,
    };
  }

  if (/questionable/.test(tag)) {
    return {
      playStatus: 'questionable',
      multiplier: AVAILABILITY_MULTIPLIERS.questionable,
      startable: true,
      label: injuryStatus ?? 'Questionable',
      reason: `Questionable — projection cut to ${Math.round(AVAILABILITY_MULTIPLIERS.questionable * 100)}%. Check inactives before kickoff.`,
    };
  }

  return FULLY_AVAILABLE;
}

// ---------------------------------------------------------------------------
// Rest of season
// ---------------------------------------------------------------------------

/**
 * How much of a REST-OF-SEASON projection to believe, given a player's status.
 *
 * A different question from the weekly one, and it needs different numbers. A
 * player ruled out for Sunday still has fourteen games ahead of him, so his
 * season line is mostly intact; a player on IR has lost a chunk of the year
 * that no projection feed ever subtracts. Season projections are published as
 * though everyone plays sixteen games, so without this a back who is done for
 * the year still reads as your best running back — which silently suppresses
 * every waiver suggestion at that position, because nothing on the wire can
 * beat a healthy-looking phantom.
 */
export function restOfSeasonMultiplier(status: string | null | undefined): number {
  if (!status) return 1;
  const normalized = status.toLowerCase();
  if (/(injured reserve|\bir\b|\bpup\b|physically unable|\bnfi\b|non football injury|suspend|\bsus\b)/.test(normalized)) {
    return 0.2;
  }
  if (/\bout\b|inactive|\bdnp\b|\bna\b/.test(normalized)) return 0.6;
  if (/doubtful/.test(normalized)) return 0.8;
  if (/questionable/.test(normalized)) return 0.95;
  return 1;
}

/**
 * The rest-of-season discount for a player, reading both status fields and
 * taking the harsher of the two — `status` carries the season-long list
 * placements (IR, PUP) while `injuryStatus` carries this week's tag.
 */
export function restOfSeasonAvailability(input: {
  status?: string | null;
  injuryStatus?: string | null;
}): number {
  return Math.min(
    restOfSeasonMultiplier(input.status),
    restOfSeasonMultiplier(input.injuryStatus),
  );
}
