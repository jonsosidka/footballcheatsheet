/**
 * Does the draft engine actually build a better roster?
 *
 *   npx tsx scripts/draft-sim.ts [trials]
 *
 * Drafts a full 12-team league from every seat, three ways, and compares the
 * projected starting lineups at the end:
 *
 *   adp        take the best player left by average draft position
 *   points     take the highest projected points that fits a roster cap
 *   engine     lib/engine/draft.ts
 *
 * "points" is the control that matters. It is what every other draft board
 * ships, and it is the one the engine has to beat — beating a pure ADP bot
 * proves only that projections are worth something.
 *
 * The player pool here is synthetic: positional points curves with noise, and
 * ADP derived from value over replacement plus market noise. That is deliberate
 * and it is the honest caveat on the result — this measures the *decision
 * procedure*, holding the projections fixed and correct. It says nothing about
 * whether Sleeper's projections are any good, which is what scripts/backtest.ts
 * is for.
 */
import {
  pickNumbersForSlot,
  replacementLevels,
  rosterValue,
  slotForPick,
  suggestPicks,
  positionDemand,
  type DraftPlayer,
} from '../src/lib/engine/draft';

const ROSTER_POSITIONS = [
  'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF',
  'BN', 'BN', 'BN', 'BN', 'BN', 'BN',
];
const TEAMS = 12;
const ROUNDS = ROSTER_POSITIONS.length;
const TOTAL_PICKS = TEAMS * ROUNDS;

/**
 * Season points curves, roughly calibrated to full-PPR reality: a steep top at
 * running back, a long flat tail at receiver, kickers nearly indistinguishable.
 * The *shape* is what the engine reacts to, so it matters that these differ.
 */
const CURVES: Record<string, { count: number; top: number; decay: number; floor: number }> = {
  QB: { count: 32, top: 385, decay: 0.030, floor: 150 },
  RB: { count: 72, top: 320, decay: 0.028, floor: 40 },
  WR: { count: 96, top: 300, decay: 0.020, floor: 40 },
  TE: { count: 40, top: 235, decay: 0.055, floor: 30 },
  K: { count: 32, top: 158, decay: 0.010, floor: 105 },
  DEF: { count: 32, top: 152, decay: 0.020, floor: 70 },
};

/** Most a sane manager carries at a position in a 15-round draft. */
const POSITION_CAPS: Record<string, number> = { QB: 2, RB: 6, WR: 6, TE: 2, K: 1, DEF: 1 };

// ---------------------------------------------------------------------------
// Deterministic randomness, so a result can be re-run and argued with.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller, for noise that has tails rather than hard edges. */
function gaussian(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// ---------------------------------------------------------------------------
// The pool
// ---------------------------------------------------------------------------

function buildUniverse(rng: () => number): DraftPlayer[] {
  const universe: DraftPlayer[] = [];

  for (const [position, curve] of Object.entries(CURVES)) {
    for (let index = 0; index < curve.count; index++) {
      const shape = curve.floor + (curve.top - curve.floor) * Math.exp(-curve.decay * index * 3);
      const points = Math.max(5, shape + gaussian(rng) * 6);
      universe.push({
        playerId: `${position}-${index}`,
        name: `${position}${index + 1}`,
        position,
        eligiblePositions: [position],
        team: `T${(index % 32) + 1}`,
        byeWeek: 5 + ((index * 7) % 10),
        points: Math.round(points * 10) / 10,
        adp: null,
        injuryStatus: null,
      });
    }
  }

  /*
   * ADP from value over replacement, not from raw points — a real draft room
   * does not take four quarterbacks in round one. Noise on top, because the
   * room's disagreement is the whole reason survival probability is uncertain.
   */
  const replacements = replacementLevels(universe, ROSTER_POSITIONS, TEAMS);
  const ranked = [...universe]
    .map((player) => ({
      player,
      vor: player.points - (replacements.get(player.position) ?? 0) + gaussian(rng) * 12,
    }))
    .sort((a, b) => b.vor - a.vor);

  ranked.forEach((entry, index) => {
    entry.player.adp = index + 1;
  });

  return universe;
}

// ---------------------------------------------------------------------------
// Drafters
// ---------------------------------------------------------------------------

type Strategy = 'adp' | 'points' | 'engine';

function withinCap(roster: DraftPlayer[], position: string): boolean {
  const cap = POSITION_CAPS[position] ?? 3;
  return roster.filter((player) => player.position === position).length < cap;
}

/**
 * Slots a roster still cannot fill, so the bots do not finish the draft without
 * a kicker. Every real drafter does this; a bot that does not would flatter the
 * engine for no reason.
 */
function missingRequired(roster: DraftPlayer[]): string[] {
  const missing: string[] = [];
  for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
    const need = ROSTER_POSITIONS.filter((slot) => slot === position).length;
    if (roster.filter((player) => player.position === position).length < need) missing.push(position);
  }
  return missing;
}

function botPick(
  strategy: 'adp' | 'points',
  roster: DraftPlayer[],
  available: DraftPlayer[],
  picksLeft: number,
  rng: () => number,
): DraftPlayer {
  const forced = missingRequired(roster);
  const mustFill = forced.length >= picksLeft ? new Set(forced) : null;

  const eligible = available.filter((player) => {
    if (mustFill && !mustFill.has(player.position)) return false;
    return withinCap(roster, player.position) && positionDemand(player.position, ROSTER_POSITIONS) > 0;
  });

  const pool = eligible.length > 0 ? eligible : available;
  const ordered =
    strategy === 'adp'
      ? [...pool].sort((a, b) => (a.adp ?? 9999) - (b.adp ?? 9999))
      : [...pool].sort((a, b) => b.points - a.points);

  // A little disorder: rooms do not pick off a list in lockstep.
  const reach = Math.min(ordered.length - 1, Math.floor(rng() * 3));
  return ordered[reach];
}

function enginePick(
  roster: DraftPlayer[],
  available: DraftPlayer[],
  currentPickNo: number,
  myPicks: number[],
  drift: number,
): DraftPlayer {
  const upcoming = myPicks.filter((pickNo) => pickNo >= currentPickNo);
  const [top] = suggestPicks({
    rosterPositions: ROSTER_POSITIONS,
    myPlayers: roster,
    available,
    replacementByPosition: replacementLevels(available.concat(roster), ROSTER_POSITIONS, TEAMS),
    currentPickNo,
    targetPickNo: upcoming[0] ?? null,
    followingPickNo: upcoming[1] ?? null,
    picksRemaining: upcoming.length,
    teams: TEAMS,
    drift,
    limit: 1,
  });
  return top?.player ?? available[0];
}

// ---------------------------------------------------------------------------
// One draft
// ---------------------------------------------------------------------------

function runDraft(seed: number, subjectSlot: number, strategy: Strategy) {
  const rng = mulberry32(seed);
  const universe = buildUniverse(rng);
  const byId = new Map(universe.map((player) => [player.playerId, player]));

  const rosters = new Map<number, DraftPlayer[]>();
  for (let slot = 1; slot <= TEAMS; slot++) rosters.set(slot, []);

  const available = new Set(universe.map((player) => player.playerId));
  const pickNumbersBySlot = new Map(
    Array.from({ length: TEAMS }, (_, i) => [i + 1, pickNumbersForSlot(i + 1, TEAMS, ROUNDS)] as const),
  );

  for (let pickNo = 1; pickNo <= TOTAL_PICKS; pickNo++) {
    const slot = slotForPick(pickNo, TEAMS);
    const roster = rosters.get(slot)!;
    const board = [...available].map((id) => byId.get(id)!);
    const picksLeft = pickNumbersBySlot.get(slot)!.filter((n) => n >= pickNo).length;

    const seat: Strategy = slot === subjectSlot ? strategy : 'adp';
    const choice =
      seat === 'engine'
        ? enginePick(roster, board, pickNo, pickNumbersBySlot.get(slot)!, 0)
        : botPick(seat, roster, board, picksLeft, rng);

    roster.push(choice);
    available.delete(choice.playerId);
  }

  const replacements = replacementLevels(universe, ROSTER_POSITIONS, TEAMS);
  const results = [...rosters.entries()].map(([slot, roster]) => {
    const value = rosterValue(roster, {
      rosterPositions: ROSTER_POSITIONS,
      replacementByPosition: replacements,
      includeByeRisk: true,
    });
    return { slot, starterPoints: value.starterPoints, total: value.total };
  });

  const sorted = [...results].sort((a, b) => b.starterPoints - a.starterPoints);
  const subject = results.find((result) => result.slot === subjectSlot)!;

  return {
    starterPoints: subject.starterPoints,
    total: subject.total,
    rank: sorted.findIndex((result) => result.slot === subjectSlot) + 1,
    fieldMean: results.reduce((sum, r) => sum + r.starterPoints, 0) / results.length,
  };
}

// ---------------------------------------------------------------------------

function main() {
  const trials = Number(process.argv[2] ?? 12);
  const strategies: Strategy[] = ['adp', 'points', 'engine'];
  const summary = new Map<Strategy, { starters: number[]; totals: number[]; ranks: number[] }>();
  for (const strategy of strategies) summary.set(strategy, { starters: [], totals: [], ranks: [] });

  const started = Date.now();

  for (let trial = 0; trial < trials; trial++) {
    const seed = 1000 + trial;
    // Rotate the seat so no strategy is judged from the turn of the first round.
    const slot = (trial % TEAMS) + 1;

    for (const strategy of strategies) {
      const result = runDraft(seed, slot, strategy);
      const bucket = summary.get(strategy)!;
      bucket.starters.push(result.starterPoints);
      bucket.totals.push(result.total);
      bucket.ranks.push(result.rank);
    }
  }

  const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

  console.log(`\n${trials} drafts, ${TEAMS} teams, ${ROUNDS} rounds, seats rotated\n`);
  console.log('strategy   starters   roster    avg rank   wins');
  console.log('─'.repeat(52));

  const engineStarters = summary.get('engine')!.starters;

  for (const strategy of strategies) {
    const bucket = summary.get(strategy)!;
    const wins = bucket.ranks.filter((rank) => rank === 1).length;
    console.log(
      `${strategy.padEnd(10)} ${mean(bucket.starters).toFixed(1).padStart(8)} ${mean(bucket.totals)
        .toFixed(1)
        .padStart(8)} ${mean(bucket.ranks).toFixed(2).padStart(10)} ${String(wins).padStart(6)}`,
    );
  }

  const control = summary.get('points')!.starters;
  const diffs = engineStarters.map((points, i) => points - control[i]);
  const meanDiff = mean(diffs);
  const sd = Math.sqrt(mean(diffs.map((d) => (d - meanDiff) ** 2)) * (diffs.length / Math.max(1, diffs.length - 1)));
  const stderr = sd / Math.sqrt(diffs.length);

  console.log('\nengine vs best-projected-points, per draft:');
  console.log(`  mean starting-lineup gain  ${meanDiff >= 0 ? '+' : ''}${meanDiff.toFixed(1)} pts`);
  console.log(`  95% interval               ${(meanDiff - 1.96 * stderr).toFixed(1)} to ${(meanDiff + 1.96 * stderr).toFixed(1)}`);
  console.log(`  drafts won outright        ${diffs.filter((d) => d > 0).length} of ${diffs.length}`);
  console.log(`\n(${((Date.now() - started) / 1000).toFixed(1)}s)\n`);
}

main();
