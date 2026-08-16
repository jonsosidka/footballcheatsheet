/**
 * Optimal lineup selection.
 *
 * This is a max-weight bipartite matching problem: assign rostered players to
 * starting slots so total projected points is maximized, subject to each slot's
 * position eligibility.
 *
 * Solved exactly with the Hungarian algorithm rather than greedily. Greedy
 * ("fill each slot with the best remaining eligible player") is wrong in
 * precisely the situations that matter most — flex slots. Classic failure: your
 * best available player is a WR, and both a WR slot and a FLEX are open. Greedy
 * fills FLEX first with that WR, then has to put a weaker WR in the WR slot,
 * when the optimal assignment is the reverse. Rosters are small, so the exact
 * O(n^3) solve is instantaneous and there's no reason to accept a heuristic.
 */

export interface LineupPlayer {
  playerId: string;
  position: string;
  /** Positions the player is eligible at (Sleeper's fantasy_positions). */
  eligiblePositions: string[];
  points: number;
  /** Excluded from the optimal lineup entirely (bye, IR, out). */
  ineligible?: boolean;
}

export interface SlotAssignment {
  slot: string;
  slotIndex: number;
  playerId: string | null;
  points: number;
}

export interface OptimalLineup {
  assignments: SlotAssignment[];
  totalPoints: number;
  /** Rostered, eligible, but not starting. */
  benchedPlayerIds: string[];
}

/**
 * Which player positions can fill which lineup slot.
 * Sleeper uses several flex spellings depending on league age.
 */
export const SLOT_ELIGIBILITY: Record<string, string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],
  DL: ['DL', 'DE', 'DT'],
  LB: ['LB'],
  DB: ['DB', 'CB', 'S'],
  IDP_FLEX: ['DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S'],
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  WRRB_WRT: ['RB', 'WR', 'TE'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  SUPERFLEX: ['QB', 'RB', 'WR', 'TE'],
  QB_FLEX: ['QB', 'RB', 'WR', 'TE'],
};

const NON_STARTING_SLOTS = new Set(['BN', 'IR', 'TAXI']);

export function isStartingSlot(slot: string): boolean {
  return !NON_STARTING_SLOTS.has(slot);
}

export function canFill(slot: string, eligiblePositions: string[]): boolean {
  const allowed = SLOT_ELIGIBILITY[slot];
  // Unknown slot type: fail closed rather than silently allowing anyone.
  if (!allowed) return false;
  return eligiblePositions.some((position) => allowed.includes(position));
}

/**
 * Compute the highest-scoring legal lineup.
 *
 * `rosterPositions` is Sleeper's ordered slot list including BN/IR/TAXI, which
 * are filtered out here — only true starting slots are assigned.
 */
export function optimizeLineup(players: LineupPlayer[], rosterPositions: string[]): OptimalLineup {
  const slots = rosterPositions.filter(isStartingSlot);
  const candidates = players.filter((player) => !player.ineligible);

  if (slots.length === 0 || candidates.length === 0) {
    return {
      assignments: slots.map((slot, slotIndex) => ({ slot, slotIndex, playerId: null, points: 0 })),
      totalPoints: 0,
      benchedPlayerIds: candidates.map((player) => player.playerId),
    };
  }

  // Rows = slots, columns = players. Pad to a square matrix.
  const size = Math.max(slots.length, candidates.length);
  const INELIGIBLE = 1e9;

  const cost: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (row >= slots.length || col >= candidates.length) {
        cost[row][col] = 0; // padding: free, assigns nothing real
        continue;
      }
      const player = candidates[col];
      cost[row][col] = canFill(slots[row], player.eligiblePositions)
        ? -player.points // minimize cost == maximize points
        : INELIGIBLE;
    }
  }

  const assignment = hungarian(cost);

  const assignments: SlotAssignment[] = [];
  const used = new Set<string>();

  for (let row = 0; row < slots.length; row++) {
    const col = assignment[row];
    const player = col >= 0 && col < candidates.length ? candidates[col] : undefined;
    const legal = player && cost[row][col] < INELIGIBLE;

    if (legal && player) {
      used.add(player.playerId);
      assignments.push({ slot: slots[row], slotIndex: row, playerId: player.playerId, points: player.points });
    } else {
      assignments.push({ slot: slots[row], slotIndex: row, playerId: null, points: 0 });
    }
  }

  return {
    assignments,
    totalPoints: round2(assignments.reduce((sum, a) => sum + a.points, 0)),
    benchedPlayerIds: players.filter((p) => !used.has(p.playerId)).map((p) => p.playerId),
  };
}

export interface LineupComparison {
  optimal: OptimalLineup;
  currentPoints: number;
  pointsLeftOnBench: number;
  /** Concrete swaps to get from the current lineup to the optimal one. */
  changes: Array<{ slot: string; slotIndex: number; benchPlayerId: string; startingPlayerId: string | null; gain: number }>;
}

/**
 * Compare the user's actual starters against the optimal lineup.
 *
 * `currentStarters` is Sleeper's ordered starters array, positionally aligned
 * with the league's starting slots (Sleeper uses "0" for an empty slot).
 */
export function compareToCurrentLineup(
  players: LineupPlayer[],
  rosterPositions: string[],
  currentStarters: string[],
): LineupComparison {
  const optimal = optimizeLineup(players, rosterPositions);
  const byId = new Map(players.map((player) => [player.playerId, player]));
  const slots = rosterPositions.filter(isStartingSlot);

  let currentPoints = 0;
  for (const playerId of currentStarters) {
    if (!playerId || playerId === '0') continue;
    currentPoints += byId.get(playerId)?.points ?? 0;
  }

  const changes: LineupComparison['changes'] = [];
  for (let index = 0; index < slots.length; index++) {
    const currentId = currentStarters[index] && currentStarters[index] !== '0' ? currentStarters[index] : null;
    const optimalId = optimal.assignments[index]?.playerId ?? null;
    if (optimalId && optimalId !== currentId) {
      const gain = (byId.get(optimalId)?.points ?? 0) - (currentId ? byId.get(currentId)?.points ?? 0 : 0);
      changes.push({
        slot: slots[index],
        slotIndex: index,
        benchPlayerId: optimalId,
        startingPlayerId: currentId,
        gain: round2(gain),
      });
    }
  }

  return {
    optimal,
    currentPoints: round2(currentPoints),
    pointsLeftOnBench: round2(optimal.totalPoints - currentPoints),
    changes: changes.sort((a, b) => b.gain - a.gain),
  };
}

/**
 * Hungarian algorithm (Kuhn-Munkres), O(n^3), for a square cost matrix.
 * Returns `assignment[row] = col`. Standard potentials/augmenting-path
 * formulation with 1-indexed internal arrays.
 */
function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  if (n === 0) return [];

  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0); // p[col] = row assigned to col
  const way = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;

      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }

      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }

      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const assignment = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) {
    if (p[j] > 0) assignment[p[j] - 1] = j - 1;
  }
  return assignment;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
