/**
 * Roster slot accounting.
 *
 * Dynasty leagues hide real value in slot management. A player parked on the
 * bench who is IR-eligible is costing an active roster spot — and therefore a
 * waiver claim — for nothing. A taxi-eligible rookie occupying a bench spot is
 * the same mistake. Sleeper shows you the slots but never tells you that you're
 * wasting one, so this module makes that explicit.
 */

export interface RosterSlotConfig {
  rosterPositions: string[];
  taxiSlots: number;
  taxiYears: number;
  /** League week after which taxi moves are locked. 0 = no deadline. */
  taxiDeadline: number;
  /** 0 = rookies only, 1 = veterans allowed. */
  taxiAllowVets: number;
  reserveSlots: number;
}

export interface RosterPlayerInfo {
  playerId: string;
  name: string;
  position: string;
  yearsExp: number | null;
  injuryStatus: string | null;
  /** Sleeper status: Active, Injured Reserve, PUP, Out, ... */
  status: string | null;
}

export interface RosterOccupancy {
  startingSlots: number;
  benchSlots: number;
  taxiSlots: number;
  reserveSlots: number;
  totalActiveSlots: number;

  playersOnRoster: number;
  playersOnTaxi: number;
  playersOnReserve: number;
  /** Roster players not stashed on taxi or IR — these consume active spots. */
  playersActive: number;

  openActiveSlots: number;
  openTaxiSlots: number;
  openReserveSlots: number;
  isOverRosterLimit: boolean;
}

/** Sleeper statuses that make a player eligible for an IR/reserve slot. */
const IR_ELIGIBLE_STATUSES = new Set([
  'Injured Reserve',
  'IR',
  'PUP',
  'Physically Unable to Perform',
  'NFI',
  'Non Football Injury',
  'Out',
  'Doubtful',
  'COV',
  'Suspended',
]);

export function isIrEligible(player: RosterPlayerInfo): boolean {
  if (player.status && IR_ELIGIBLE_STATUSES.has(player.status)) return true;
  if (player.injuryStatus && IR_ELIGIBLE_STATUSES.has(player.injuryStatus)) return true;
  return false;
}

/**
 * Taxi eligibility. Sleeper's rule is years-of-experience based: a player
 * qualifies while `years_exp` is under the league's `taxi_years`, unless the
 * league allows veterans, in which case anyone qualifies.
 */
export function isTaxiEligible(player: RosterPlayerInfo, config: RosterSlotConfig): boolean {
  if (config.taxiSlots <= 0) return false;
  if (config.taxiAllowVets === 1) return true;
  const yearsExp = player.yearsExp ?? 99;
  return yearsExp < Math.max(1, config.taxiYears);
}

export function computeOccupancy(
  config: RosterSlotConfig,
  roster: { players: string[]; taxi: string[]; reserve: string[] },
): RosterOccupancy {
  const startingSlots = config.rosterPositions.filter((p) => p !== 'BN' && p !== 'IR' && p !== 'TAXI').length;
  const benchSlots = config.rosterPositions.filter((p) => p === 'BN').length;

  // Sleeper expresses IR/taxi capacity via settings, and sometimes ALSO as
  // slots in roster_positions. Take the larger so we never overcount capacity.
  const taxiSlots = Math.max(config.taxiSlots, config.rosterPositions.filter((p) => p === 'TAXI').length);
  const reserveSlots = Math.max(config.reserveSlots, config.rosterPositions.filter((p) => p === 'IR').length);

  const taxiSet = new Set(roster.taxi ?? []);
  const reserveSet = new Set(roster.reserve ?? []);
  const allPlayers = roster.players ?? [];

  const playersOnTaxi = taxiSet.size;
  const playersOnReserve = reserveSet.size;
  const playersActive = allPlayers.filter((id) => !taxiSet.has(id) && !reserveSet.has(id)).length;

  const totalActiveSlots = startingSlots + benchSlots;

  return {
    startingSlots,
    benchSlots,
    taxiSlots,
    reserveSlots,
    totalActiveSlots,
    playersOnRoster: allPlayers.length,
    playersOnTaxi,
    playersOnReserve,
    playersActive,
    openActiveSlots: totalActiveSlots - playersActive,
    openTaxiSlots: taxiSlots - playersOnTaxi,
    openReserveSlots: reserveSlots - playersOnReserve,
    isOverRosterLimit: playersActive > totalActiveSlots,
  };
}

export type SlotMoveType = 'stash-ir' | 'stash-taxi' | 'taxi-deadline' | 'over-limit' | 'wasted-taxi' | 'wasted-ir';

export interface SlotMove {
  type: SlotMoveType;
  playerId: string | null;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  detail: string;
}

/**
 * Concrete slot moves worth making right now.
 *
 * Deliberately conservative: only flags a move when it genuinely frees a spot
 * or prevents a loss. Noise here trains you to ignore the panel.
 */
export function findSlotMoves(
  config: RosterSlotConfig,
  roster: { players: string[]; taxi: string[]; reserve: string[] },
  playersById: Map<string, RosterPlayerInfo>,
  currentWeek: number,
): SlotMove[] {
  const occupancy = computeOccupancy(config, roster);
  const moves: SlotMove[] = [];

  const taxiSet = new Set(roster.taxi ?? []);
  const reserveSet = new Set(roster.reserve ?? []);
  const activeIds = (roster.players ?? []).filter((id) => !taxiSet.has(id) && !reserveSet.has(id));

  // 1. IR-eligible players burning an active roster spot.
  if (occupancy.openReserveSlots > 0) {
    const candidates = activeIds
      .map((id) => playersById.get(id))
      .filter((p): p is RosterPlayerInfo => !!p && isIrEligible(p))
      .slice(0, occupancy.openReserveSlots);

    for (const candidate of candidates) {
      moves.push({
        type: 'stash-ir',
        playerId: candidate.playerId,
        severity: 'warn',
        title: `Move ${candidate.name} to IR`,
        detail:
          `${candidate.name} is ${candidate.injuryStatus ?? candidate.status} and eligible for an open IR slot. ` +
          `Moving him frees an active roster spot for a waiver claim at no cost.`,
      });
    }
  }

  // 2. Taxi-eligible players burning an active roster spot.
  if (occupancy.openTaxiSlots > 0) {
    const candidates = activeIds
      .map((id) => playersById.get(id))
      .filter((p): p is RosterPlayerInfo => !!p && isTaxiEligible(p, config) && !isIrEligible(p))
      .slice(0, occupancy.openTaxiSlots);

    for (const candidate of candidates) {
      moves.push({
        type: 'stash-taxi',
        playerId: candidate.playerId,
        severity: 'info',
        title: `Consider taxi-stashing ${candidate.name}`,
        detail:
          `${candidate.name} (${candidate.yearsExp ?? 0} yrs exp) qualifies for an open taxi slot. ` +
          `Stashing him frees an active spot while retaining his rights.`,
      });
    }
  }

  // 3. Taxi deadline approaching — players must be promoted or lost.
  if (config.taxiDeadline > 0 && taxiSet.size > 0) {
    const weeksLeft = config.taxiDeadline - currentWeek;
    if (weeksLeft >= 0 && weeksLeft <= 2) {
      moves.push({
        type: 'taxi-deadline',
        playerId: null,
        severity: weeksLeft === 0 ? 'critical' : 'warn',
        title:
          weeksLeft === 0
            ? 'Taxi deadline is this week'
            : `Taxi deadline in ${weeksLeft} week${weeksLeft === 1 ? '' : 's'}`,
        detail:
          `You have ${taxiSet.size} player${taxiSet.size === 1 ? '' : 's'} on the taxi squad. ` +
          `After week ${config.taxiDeadline} they can no longer be moved.`,
      });
    }
  }

  // 4. Over the active roster limit — a move is mandatory, not optional.
  if (occupancy.isOverRosterLimit) {
    moves.push({
      type: 'over-limit',
      playerId: null,
      severity: 'critical',
      title: 'Roster is over the active limit',
      detail:
        `${occupancy.playersActive} active players against ${occupancy.totalActiveSlots} slots. ` +
        `You must drop, IR, or taxi someone before your next transaction will process.`,
    });
  }

  // 5. Unused capacity worth knowing about, but only if it can actually be used.
  if (occupancy.openTaxiSlots > 0 && occupancy.openActiveSlots <= 0) {
    moves.push({
      type: 'wasted-taxi',
      playerId: null,
      severity: 'info',
      title: `${occupancy.openTaxiSlots} taxi slot${occupancy.openTaxiSlots === 1 ? '' : 's'} sitting empty`,
      detail: 'Your active roster is full while taxi capacity goes unused — a stash would open a spot.',
    });
  }

  return moves;
}
