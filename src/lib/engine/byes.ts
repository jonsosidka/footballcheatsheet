/**
 * Bye-week roster coverage.
 *
 * The single most predictable waiver need, and the one most often noticed too
 * late. If four of your six receivers share a bye in week 7, the time to solve
 * it is week 5 — not the Sunday morning you discover you cannot fill a slot.
 */

export interface ByeRosterPlayer {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  /** Rest-of-season points; used to rank who you actually lose. */
  rosPoints: number;
}

export interface ByeGap {
  week: number;
  position: string;
  /** Starting slots this league needs filled at this position. */
  required: number;
  /** Rostered players at this position who are available that week. */
  available: number;
  shortBy: number;
  /** Players you lose that week, best first. */
  onBye: ByeRosterPlayer[];
  severity: 'info' | 'warn' | 'critical';
}

/**
 * Positions that can fill each starting slot. Kept local rather than shared
 * with the lineup optimizer because here we need the coarse "how many bodies
 * do I need at this position" view, not exact slot assignment.
 */
const SLOT_POSITIONS: Record<string, string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  WRRB_WRT: ['RB', 'WR', 'TE'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  SUPERFLEX: ['QB', 'RB', 'WR', 'TE'],
  QB_FLEX: ['QB', 'RB', 'WR', 'TE'],
  IDP_FLEX: ['DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S'],
  DL: ['DL', 'DE', 'DT'],
  LB: ['LB'],
  DB: ['DB', 'CB', 'S'],
};

/**
 * Minimum bodies needed at each position for a full lineup.
 *
 * Dedicated slots count fully. Flex slots are deliberately NOT added on top —
 * counting them per-eligible-position would demand a flex body at RB *and* WR
 * *and* TE simultaneously, inventing shortages that don't exist. A flex is one
 * body drawn from whichever of those groups has a spare.
 */
export function requiredByPosition(rosterPositions: string[]): Map<string, number> {
  const required = new Map<string, number>();
  for (const slot of rosterPositions) {
    if (slot === 'BN' || slot === 'IR' || slot === 'TAXI') continue;
    const eligible = SLOT_POSITIONS[slot];
    if (!eligible || eligible.length !== 1) continue; // flex handled separately
    required.set(eligible[0], (required.get(eligible[0]) ?? 0) + 1);
  }
  return required;
}

/** Total flexible slots, and which positions can feed them. */
export function flexDemand(rosterPositions: string[]): Array<{ count: number; positions: string[] }> {
  const groups = new Map<string, number>();
  for (const slot of rosterPositions) {
    if (slot === 'BN' || slot === 'IR' || slot === 'TAXI') continue;
    const eligible = SLOT_POSITIONS[slot];
    if (!eligible || eligible.length <= 1) continue;
    const key = eligible.join(',');
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()].map(([key, count]) => ({ count, positions: key.split(',') }));
}

export interface ByeAnalysisInput {
  rosterPositions: string[];
  roster: ByeRosterPlayer[];
  /** team -> bye week */
  byeWeeks: Map<string, number>;
  currentWeek: number;
  /** Last week of the fantasy regular season. */
  lastRegularWeek: number;
}

/**
 * Find weeks where byes leave you unable to field a full lineup.
 *
 * Only looks forward — a bye you already survived is not actionable.
 */
export function findByeGaps(input: ByeAnalysisInput): ByeGap[] {
  const { rosterPositions, roster, byeWeeks, currentWeek, lastRegularWeek } = input;
  const required = requiredByPosition(rosterPositions);
  const flexes = flexDemand(rosterPositions);
  const gaps: ByeGap[] = [];

  for (let week = currentWeek; week <= lastRegularWeek; week++) {
    const onByeThisWeek = roster.filter((p) => p.team && byeWeeks.get(p.team) === week);
    if (onByeThisWeek.length === 0) continue;

    const availableByPosition = new Map<string, ByeRosterPlayer[]>();
    for (const player of roster) {
      if (player.team && byeWeeks.get(player.team) === week) continue;
      const list = availableByPosition.get(player.position);
      if (list) list.push(player);
      else availableByPosition.set(player.position, [player]);
    }

    /*
     * Spare bodies per position, after dedicated slots are filled.
     *
     * Seeded from every position on the roster, not just those with dedicated
     * slots. Positions that only feed a flex (IDP in an IDP_FLEX-only league,
     * for instance) have no entry in `required`, so seeding from `required`
     * alone left their spare at zero and reported a permanent shortage of
     * every flex — a roster of four linebackers read as "need 2, have 0".
     */
    const spare = new Map<string, number>();
    for (const [position, players] of availableByPosition) {
      spare.set(position, players.length - (required.get(position) ?? 0));
    }

    for (const [position, need] of required) {
      const available = availableByPosition.get(position)?.length ?? 0;

      if (available < need) {
        const lost = onByeThisWeek
          .filter((p) => p.position === position)
          .sort((a, b) => b.rosPoints - a.rosPoints);
        const shortBy = need - available;
        gaps.push({
          week,
          position,
          required: need,
          available,
          shortBy,
          onBye: lost,
          severity: shortBy >= 2 ? 'critical' : 'warn',
        });
      }
    }

    // Then check the flex slots can be fed from whatever is left over.
    for (const flex of flexes) {
      const surplus = flex.positions.reduce((sum, position) => sum + Math.max(0, spare.get(position) ?? 0), 0);
      if (surplus < flex.count) {
        const lost = onByeThisWeek
          .filter((p) => flex.positions.includes(p.position))
          .sort((a, b) => b.rosPoints - a.rosPoints);
        gaps.push({
          week,
          position: flex.positions.join('/'),
          required: flex.count,
          available: surplus,
          shortBy: flex.count - surplus,
          onBye: lost,
          severity: 'warn',
        });
      }
    }
  }

  // Nearest problems first — those are the ones you can still act on.
  return gaps.sort((a, b) => a.week - b.week || b.shortBy - a.shortBy);
}

/**
 * Does this free agent actually help with an upcoming bye gap?
 * Returns the weeks he covers, so the rationale can name them.
 */
export function coversByeGaps(
  candidate: { position: string; team: string | null },
  gaps: ByeGap[],
  byeWeeks: Map<string, number>,
): number[] {
  const candidateBye = candidate.team ? byeWeeks.get(candidate.team) : undefined;
  return gaps
    .filter((gap) => {
      if (gap.week === candidateBye) return false; // he's off that week too
      return gap.position.split('/').includes(candidate.position);
    })
    .map((gap) => gap.week);
}
