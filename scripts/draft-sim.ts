/**
 * Does the draft engine actually build a better roster?
 *
 *   npx tsx scripts/draft-sim.ts [trials]
 *   npx tsx scripts/draft-sim.ts --league "Washed Up Pikes" [trials]
 *   npx tsx scripts/draft-sim.ts --league "Washed Up Pikes" --real [trials]
 *   npx tsx scripts/draft-sim.ts --league "Washed Up Pikes" --real --outcomes 50 [trials]
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
  type RosterValueOptions,
} from '../src/lib/engine/draft';
import { adpFromStats } from '../src/lib/sources/sleeper';
import { loadOutcomeModel, sampleRatio, describe, type OutcomeModel } from './outcome-model';

/*
 * League shape. Defaults are a vanilla 12-team redraft; `--league <name>` loads
 * the real roster_positions and total_rosters out of Neon so the sim is run
 * against the league actually being drafted. Assigned once in main() before any
 * draft runs — the script is single-threaded and never re-enters.
 *
 * The player pool below deliberately does NOT scale with team count: a 14-team
 * league draws from the same finite set of real players as a 10-team one, and
 * that thinning is exactly what a deeper league does to a draft board.
 */
let ROSTER_POSITIONS = [
  'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF',
  'BN', 'BN', 'BN', 'BN', 'BN', 'BN',
];
let TEAMS = 12;
let ROUNDS = ROSTER_POSITIONS.length;
let TOTAL_PICKS = TEAMS * ROUNDS;
let LEAGUE_LABEL = 'default 12-team redraft';
let LEAGUE_ROW: typeof import('../src/db/schema').leagues.$inferSelect | null = null;
let REAL_UNIVERSE: DraftPlayer[] | null = null;
let OUTCOME_MODEL: OutcomeModel | null = null;
let OUTCOME_SAMPLES = 0;

async function resolveLeague(name: string) {
  const { config } = await import('dotenv');
  config({ path: '.env.local' });
  const { db, schema } = await import('../src/db');
  const rows = await db.select().from(schema.leagues);
  const match = rows.find((row) => row.name.toLowerCase() === name.toLowerCase());
  if (!match) {
    const known = rows.map((row) => row.name).join(', ') || '(none)';
    throw new Error(`No league named "${name}". Found: ${known}`);
  }
  ROSTER_POSITIONS = match.rosterPositions;
  TEAMS = match.totalRosters;
  ROUNDS = ROSTER_POSITIONS.length;
  TOTAL_PICKS = TEAMS * ROUNDS;
  LEAGUE_LABEL = `${match.name} (${match.season})`;
  LEAGUE_ROW = match;
}

/**
 * The real board, scored by this league's own settings.
 *
 * Deliberately the same construction the live draft page uses
 * (lib/data/draft.ts): season projections joined to players, scored through
 * scoreProjection, discounted for injury, ADP pulled from the same stat keys.
 * If this diverged from production the sim would be measuring a board nobody
 * ever drafts off.
 */
async function buildRealUniverse(): Promise<DraftPlayer[]> {
  if (!LEAGUE_ROW) throw new Error('--real needs --league <name>');
  const { db, schema } = await import('../src/db');
  const { eq, inArray } = await import('drizzle-orm');
  const { scoreProjection } = await import('../src/lib/engine/scoring');
  const { injuryDiscount } = await import('../src/lib/engine/draft');

  const projectionRows = await db
    .select()
    .from(schema.seasonProjections)
    .where(eq(schema.seasonProjections.season, LEAGUE_ROW.season));

  const projectedIds = projectionRows.map((row) => row.playerId);
  const playerRows = projectedIds.length
    ? await db.select().from(schema.players).where(inArray(schema.players.id, projectedIds))
    : [];
  const playerById = new Map(playerRows.map((row) => [row.id, row]));

  const universe: DraftPlayer[] = [];
  for (const row of projectionRows) {
    const player = playerById.get(row.playerId);
    if (!player || player.active === false || !player.position) continue;
    const raw = scoreProjection(row.stats, LEAGUE_ROW.scoringSettings);
    if (raw <= 0) continue;
    universe.push({
      playerId: row.playerId,
      name: player.fullName ?? row.playerId,
      position: player.position,
      eligiblePositions: player.fantasyPositions ?? [player.position],
      team: player.team,
      byeWeek: player.byeWeek,
      points: Math.round(raw * injuryDiscount(player.injuryStatus ?? player.status) * 100) / 100,
      adp: adpFromStats(row.stats, {
        isSuperflex: LEAGUE_ROW.isSuperflex,
        pprType: LEAGUE_ROW.pprType,
      }),
      injuryStatus: player.injuryStatus,
    });
  }
  return universe;
}

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

const round2 = (value: number) => Math.round(value * 100) / 100;

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
  // Real mode: one fixed board, shared across trials. Nothing in a draft run
  // mutates a player object, so there is no need to clone per trial.
  if (REAL_UNIVERSE) return REAL_UNIVERSE;

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

type Strategy = 'raw' | 'adp' | 'points' | 'engine';

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
  strategy: 'raw' | 'adp' | 'points',
  roster: DraftPlayer[],
  available: DraftPlayer[],
  picksLeft: number,
  rng: () => number,
): DraftPlayer {
  /*
   * 'raw' is straight Sleeper projections with no roster logic at all: take the
   * highest projected player left, every round. No position caps, no filling a
   * required slot before the draft ends. It is not a strategy anyone runs on
   * purpose — it is the floor, and it exists to show how much of the engine's
   * margin is roster construction rather than better numbers.
   */
  if (strategy === 'raw') {
    return [...available].sort((a, b) => b.points - a.points)[0];
  }

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
  recentPositions: string[],
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
    recentPositions,
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

  // Oldest first, exactly as lib/data/draft.ts feeds it from the live pick log.
  const takenPositions: string[] = [];

  for (let pickNo = 1; pickNo <= TOTAL_PICKS; pickNo++) {
    const slot = slotForPick(pickNo, TEAMS);
    const roster = rosters.get(slot)!;
    const board = [...available].map((id) => byId.get(id)!);
    const picksLeft = pickNumbersBySlot.get(slot)!.filter((n) => n >= pickNo).length;

    const seat: Strategy = slot === subjectSlot ? strategy : 'adp';
    const choice =
      seat === 'engine'
        ? enginePick(roster, board, pickNo, pickNumbersBySlot.get(slot)!, 0, takenPositions)
        : botPick(seat, roster, board, picksLeft, rng);

    roster.push(choice);
    available.delete(choice.playerId);
    takenPositions.push(choice.position);
  }

  const replacements = replacementLevels(universe, ROSTER_POSITIONS, TEAMS);

  /*
   * Outcome mode: score the finished draft against many sampled seasons rather
   * than the one season where every player hits his projection exactly.
   *
   * Bye risk is switched off here on purpose — a realized season already
   * contains its bye week, so charging for it again would double-count. Rank is
   * averaged over the samples, and `firstRate` is the number that matters: how
   * often this roster actually finishes first once projections are allowed to
   * be wrong.
   */
  if (OUTCOME_MODEL && OUTCOME_SAMPLES > 0) {
    const realizedOptions: RosterValueOptions = {
      rosterPositions: ROSTER_POSITIONS,
      replacementByPosition: replacements,
    };
    let rankSum = 0;
    let firsts = 0;
    let topThrees = 0;
    let worstRank = 0;
    let pointsSum = 0;
    let fieldMeanSum = 0;
    let fieldMaxSum = 0;

    for (let sample = 0; sample < OUTCOME_SAMPLES; sample++) {
      const scores = [...rosters.entries()].map(([slot, roster]) => {
        const realized = roster.map((player) => ({
          ...player,
          points: round2(player.points * sampleRatio(OUTCOME_MODEL!, player.position, rng)),
        }));
        return { slot, points: rosterValue(realized, realizedOptions).starterPoints };
      });
      scores.sort((a, b) => b.points - a.points);
      const rank = scores.findIndex((entry) => entry.slot === subjectSlot) + 1;
      rankSum += rank;
      if (rank === 1) firsts++;
      if (rank <= 3) topThrees++;
      worstRank = Math.max(worstRank, rank);
      pointsSum += scores.find((entry) => entry.slot === subjectSlot)!.points;

      const field = scores.filter((entry) => entry.slot !== subjectSlot).map((entry) => entry.points);
      fieldMeanSum += field.reduce((sum, v) => sum + v, 0) / field.length;
      fieldMaxSum += Math.max(...field);
    }

    return {
      starterPoints: round2(pointsSum / OUTCOME_SAMPLES),
      total: round2(pointsSum / OUTCOME_SAMPLES),
      rank: rankSum / OUTCOME_SAMPLES,
      firstRate: firsts / OUTCOME_SAMPLES,
      topThreeRate: topThrees / OUTCOME_SAMPLES,
      worstRank,
      // Sampled as well — comparing a sampled subject against a deterministic
      // field would make the deficit meaningless.
      fieldMean: fieldMeanSum / OUTCOME_SAMPLES,
      fieldMax: fieldMaxSum / OUTCOME_SAMPLES,
    };
  }

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

  const field = results.filter((result) => result.slot !== subjectSlot);

  return {
    starterPoints: subject.starterPoints,
    total: subject.total,
    rank: sorted.findIndex((result) => result.slot === subjectSlot) + 1,
    firstRate: sorted[0].slot === subjectSlot ? 1 : 0,
    topThreeRate: sorted.findIndex((result) => result.slot === subjectSlot) < 3 ? 1 : 0,
    worstRank: sorted.findIndex((result) => result.slot === subjectSlot) + 1,
    fieldMean: field.reduce((sum, r) => sum + r.starterPoints, 0) / field.length,
    fieldMax: Math.max(...field.map((r) => r.starterPoints)),
  };
}

// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const outcomesFlag = argv.indexOf('--outcomes');
  let outcomeSamples = 0;
  if (outcomesFlag !== -1) {
    const next = Number(argv[outcomesFlag + 1]);
    outcomeSamples = Number.isFinite(next) && next > 0 ? next : 50;
    argv.splice(outcomesFlag, Number.isFinite(next) && next > 0 ? 2 : 1);
  }

  const realFlag = argv.indexOf('--real');
  const useReal = realFlag !== -1;
  if (useReal) argv.splice(realFlag, 1);

  const leagueFlag = argv.indexOf('--league');
  if (leagueFlag !== -1) {
    const name = argv[leagueFlag + 1];
    if (!name) throw new Error('--league needs a league name');
    await resolveLeague(name);
    argv.splice(leagueFlag, 2);
  }
  if (useReal) {
    REAL_UNIVERSE = await buildRealUniverse();
    const withAdp = REAL_UNIVERSE.filter((player) => player.adp != null).length;
    LEAGUE_LABEL += `  ·  real pool: ${REAL_UNIVERSE.length} players, ${withAdp} with ADP`;
    if (REAL_UNIVERSE.length < TOTAL_PICKS) {
      throw new Error(`Pool of ${REAL_UNIVERSE.length} cannot fill ${TOTAL_PICKS} picks. Run a sync.`);
    }
  }

  if (outcomeSamples > 0) {
    if (!REAL_UNIVERSE) throw new Error('--outcomes needs --real (the error model is keyed by Sleeper player id)');
    const positionById = new Map(REAL_UNIVERSE.map((player) => [player.playerId, player.position]));
    OUTCOME_MODEL = await loadOutcomeModel('2025', positionById);
    OUTCOME_SAMPLES = outcomeSamples;
    console.log(`\nprojection error model — ${OUTCOME_MODEL.season}, ${OUTCOME_MODEL.weeks} weeks of actuals`);
    console.log(describe(OUTCOME_MODEL));
    console.log(`\nscoring every draft against ${outcomeSamples} sampled seasons.`);
  }

  const trials = Number(argv[0] ?? 12);
  const strategies: Strategy[] = ['raw', 'adp', 'points', 'engine'];
  const summary = new Map<Strategy, { starters: number[]; totals: number[]; ranks: number[]; seats: number[]; fieldMax: number[]; fieldMean: number[]; firstRates: number[]; topThreeRates: number[]; worstRanks: number[] }>();
  for (const strategy of strategies) summary.set(strategy, { starters: [], totals: [], ranks: [], seats: [], fieldMax: [], fieldMean: [], firstRates: [], topThreeRates: [], worstRanks: [] });

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
      bucket.seats.push(slot);
      bucket.fieldMax.push(result.fieldMax);
      bucket.fieldMean.push(result.fieldMean);
      bucket.firstRates.push(result.firstRate);
      bucket.topThreeRates.push(result.topThreeRate);
      bucket.worstRanks.push(result.worstRank);
    }
  }

  const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

  console.log(`\n${LEAGUE_LABEL}`);
  console.log(`${trials} drafts, ${TEAMS} teams, ${ROUNDS} rounds, seats rotated`);
  console.log(`starting slots: ${ROSTER_POSITIONS.filter((p) => p !== 'BN').join(' ')}\n`);
  console.log('strategy   starters   roster    avg rank   wins');
  console.log('─'.repeat(52));

  const engineStarters = summary.get('engine')!.starters;

  for (const strategy of strategies) {
    const bucket = summary.get(strategy)!;
    const wins = OUTCOME_SAMPLES > 0
      ? `${(mean(bucket.firstRates) * 100).toFixed(0)}%`
      : String(bucket.ranks.filter((rank) => rank === 1).length);
    console.log(
      `${strategy.padEnd(10)} ${mean(bucket.starters).toFixed(1).padStart(8)} ${mean(bucket.totals)
        .toFixed(1)
        .padStart(8)} ${mean(bucket.ranks).toFixed(2).padStart(10)} ${String(wins).padStart(6)}`,
    );
  }

  /*
   * Average rank hides the shape. "Did I finish first" is a different question
   * from "did I finish well", and a strategy that is always 2nd looks identical
   * on the mean to one that alternates 1st and 3rd.
   */
  console.log('\nfinish distribution (share of drafts):');
  console.log(`${'strategy'.padEnd(10)} ${'1st'.padStart(7)} ${'top 3'.padStart(7)} ${'top half'.padStart(9)} ${'worst'.padStart(7)}`);
  console.log('─'.repeat(46));
  for (const strategy of strategies) {
    const ranks = summary.get(strategy)!.ranks;
    const share = (predicate: (rank: number) => boolean) =>
      `${((ranks.filter(predicate).length / ranks.length) * 100).toFixed(0)}%`;
    // In outcome mode ranks are averages over samples, so "1st" comes from the
    // sampled rate rather than from a rank that is exactly 1.
    const bucket2 = summary.get(strategy)!;
    const firstShare =
      OUTCOME_SAMPLES > 0
        ? `${(mean(bucket2.firstRates) * 100).toFixed(0)}%`
        : share((r) => r === 1);
    const topThreeShare =
      OUTCOME_SAMPLES > 0
        ? `${(mean(bucket2.topThreeRates) * 100).toFixed(0)}%`
        : share((r) => r <= 3);
    const worst = OUTCOME_SAMPLES > 0 ? Math.max(...bucket2.worstRanks) : Math.max(...ranks);
    console.log(
      `${strategy.padEnd(10)} ${firstShare.padStart(7)} ${topThreeShare.padStart(7)} ` +
        `${share((r) => r <= TEAMS / 2).padStart(9)} ${String(worst).padStart(7)}`,
    );
  }

  /*
   * Where the losses live. If the engine only ever finishes second from one
   * corner of the room, that is a fixable bug in the lookahead; if the misses
   * are spread evenly it is just draft variance.
   */
  /*
   * Avg rank by seat, every strategy side by side.
   *
   * The engine alone would not settle anything: the back of a 14-team snake may
   * simply be a worse seat no matter how you draft. Only the *shape* across
   * strategies separates an inherent seat penalty (all columns sag together)
   * from an engine that mishandles the long wait at the turn (engine sags while
   * the controls hold flat).
   */
  /*
   * Seat value, measured in points rather than rank.
   *
   * Rank cannot separate seat from skill here: in the 'adp' run every team
   * drafts identically, so the subject's rank is near-arbitrary and averages
   * teams/2 whatever the seat. Starting points do not have that problem. The
   * adp column is what an ordinary drafter gets from that seat — the inherent
   * value of the slot — and the gap to the engine column is what the engine
   * adds on top of it. A gap that shrinks toward the back is engine weakness;
   * a gap that holds flat while both columns fall is just a worse seat.
   */
  console.log('\nstarting points by draft slot:');
  console.log(`${'slot'.padStart(5)} ${'adp'.padStart(9)} ${'engine'.padStart(9)} ${'gap'.padStart(8)}`);
  console.log('─'.repeat(35));
  for (let slot = 1; slot <= TEAMS; slot++) {
    const pick = (st: Strategy) => {
      const bucket = summary.get(st)!;
      const vals = bucket.starters.filter((_, i) => bucket.seats[i] === slot);
      return vals.length ? mean(vals) : NaN;
    };
    const a = pick('adp');
    const e = pick('engine');
    if (Number.isNaN(a) || Number.isNaN(e)) continue;
    console.log(
      `${String(slot).padStart(5)} ${a.toFixed(1).padStart(9)} ${e.toFixed(1).padStart(9)} ` +
        `${`+${(e - a).toFixed(1)}`.padStart(8)}`,
    );
  }

  console.log('\navg rank by draft slot (lower is better):');
  console.log(`${'slot'.padStart(5)}  ${strategies.map((st) => st.padStart(8)).join(' ')}   engine 1st`);
  console.log('─'.repeat(56));
  for (let slot = 1; slot <= TEAMS; slot++) {
    const cells = strategies.map((st) => {
      const bucket = summary.get(st)!;
      const ranks = bucket.ranks.filter((_, i) => bucket.seats[i] === slot);
      return ranks.length ? mean(ranks).toFixed(2).padStart(8) : ''.padStart(8);
    });
    const eng = summary.get('engine')!;
    const engRanks = eng.ranks.filter((_, i) => eng.seats[i] === slot);
    // Outcome mode ranks are per-draft averages over samples, so an exact 1 is
    // vanishingly rare — the sampled rate is the only meaningful figure.
    const engFirsts = eng.firstRates.filter((_, i) => eng.seats[i] === slot);
    const firstPct = !engRanks.length
      ? ''
      : OUTCOME_SAMPLES > 0
        ? `${(mean(engFirsts) * 100).toFixed(0)}%`
        : `${((engRanks.filter((r) => r === 1).length / engRanks.length) * 100).toFixed(0)}%`;
    console.log(`${String(slot).padStart(5)}  ${cells.join(' ')} ${firstPct.padStart(10)}`);
  }

  /*
   * What actually beats the engine.
   *
   * Finishing first means clearing the *best* of 13 opponents, not the average
   * one. If the losses are near-misses against a field maximum that occasionally
   * spikes, then variance reduction is the wrong lever — it would shave the
   * upside needed to clear that spike. This is the number that decides whether
   * a safety-first "recommended pick" would help or hurt.
   */
  const e = summary.get('engine')!;
  const lost = e.ranks.map((r, i) => i).filter((i) => e.ranks[i] > 1.5);
  const won = e.ranks.map((r, i) => i).filter((i) => e.ranks[i] <= 1.5);
  console.log('\nwhat beats the engine:');
  console.log(`  field mean (all drafts)        ${mean(e.fieldMean).toFixed(1)}`);
  console.log(`  field best  (all drafts)       ${mean(e.fieldMax).toFixed(1)}`);
  if (won.length) {
    console.log(`  engine when it wins            ${mean(won.map((i) => e.starters[i])).toFixed(1)}`);
  }
  if (lost.length) {
    const deficits = lost.map((i) => e.fieldMax[i] - e.starters[i]);
    console.log(`  engine when it loses           ${mean(lost.map((i) => e.starters[i])).toFixed(1)}`);
    console.log(`  field best in those drafts     ${mean(lost.map((i) => e.fieldMax[i])).toFixed(1)}`);
    console.log(`  mean deficit                   ${mean(deficits).toFixed(1)} pts`);
    console.log(`  losses within 25 pts           ${deficits.filter((d) => d <= 25).length} of ${deficits.length}`);
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
