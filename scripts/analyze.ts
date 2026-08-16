/**
 * Full-stack analysis of a tracked league, straight from the database.
 *
 *   npx tsx scripts/analyze.ts [leagueId] [week]
 */
import './_env';
import { db } from '../src/db';
import { leagues, rosters, players, projections, gameOdds, marketValues, myTeams } from '../src/db/schema';
import { eq, and } from 'drizzle-orm';
import { scoreProjection } from '../src/lib/engine/scoring';
import { projectPlayers, explainLayers, type TeamOdds } from '../src/lib/engine/pipeline';
import { optimizeLineup, compareToCurrentLineup, type LineupPlayer } from '../src/lib/engine/lineup';
import { computeOccupancy, findSlotMoves, type RosterPlayerInfo } from '../src/lib/engine/roster';
import { evaluatePosture, adjustedDynastyValue, ageMultiplier } from '../src/lib/engine/value';
import { shapeFromLeague, shapeKey } from '../src/lib/sources/fantasycalc';

const hr = (t: string) => console.log(`\n${'='.repeat(92)}\n${t}\n${'='.repeat(92)}`);

async function main() {
  const week = Number(process.argv[3] ?? 1);
  const tracked = await db.select({ l: leagues, rosterId: myTeams.rosterId })
    .from(leagues).innerJoin(myTeams, eq(myTeams.leagueId, leagues.id));

  const chosen = process.argv[2]
    ? tracked.find((t) => t.l.id === process.argv[2])
    : tracked.find((t) => t.l.isDynasty) ?? tracked[0];
  if (!chosen) throw new Error('No tracked league found — run scripts/import.ts first');

  const league = chosen.l;
  const myRosterId = chosen.rosterId;

  hr(`${league.name} — week ${week}`);
  console.log(
    `${league.isDynasty ? 'DYNASTY' : 'REDRAFT'} · ${league.totalRosters} teams · ` +
      `${Object.keys(league.scoringSettings).length} scoring keys · taxi ${league.taxiSlots} · IR ${league.reserveSlots}`,
  );
  console.log(`Starters: ${league.rosterPositions.filter((p) => !['BN', 'IR', 'TAXI'].includes(p)).join(', ')}`);

  // --- load everything -------------------------------------------------------
  const [allRosters, allPlayers, weekProjections, odds] = await Promise.all([
    db.select().from(rosters).where(eq(rosters.leagueId, league.id)),
    db.select().from(players),
    db.select().from(projections).where(and(eq(projections.season, league.season), eq(projections.week, week))),
    db.select().from(gameOdds).where(and(eq(gameOdds.season, league.season), eq(gameOdds.week, week))),
  ]);

  const shape = shapeFromLeague({
    isDynasty: league.isDynasty, isSuperflex: league.isSuperflex,
    totalRosters: league.totalRosters, pprType: league.pprType,
  });
  const values = await db.select().from(marketValues).where(eq(marketValues.shapeKey, shapeKey(shape)));
  const valueById = new Map(values.map((v) => [v.playerId, v]));

  const playerById = new Map(allPlayers.map((p) => [p.id, p]));
  const projById = new Map(weekProjections.map((p) => [p.playerId, p]));

  const oddsByTeam = new Map<string, TeamOdds>();
  for (const game of odds) {
    oddsByTeam.set(game.homeTeam, { impliedPoints: game.impliedHomePts, spread: game.spread, opponent: game.awayTeam });
    oddsByTeam.set(game.awayTeam, {
      impliedPoints: game.impliedAwayPts,
      spread: game.spread === null ? null : -game.spread,
      opponent: game.homeTeam,
    });
  }

  const mine = allRosters.find((r) => r.rosterId === myRosterId)!;
  const name = (id: string) => playerById.get(id)?.fullName ?? id;

  // --- project every rostered player in the league ---------------------------
  // Full projection set, matching the pages — the market layer's normalizer
  // depends on which players are passed in, so a subset would give different
  // numbers than the dashboard shows.
  const projected = projectPlayers(
    [...projById.keys()].map((id) => {
      const proj = projById.get(id)!;
      const player = playerById.get(id);
      return {
        playerId: id,
        position: player?.position ?? 'UNK',
        team: proj.team ?? player?.team ?? null,
        stats: proj.stats,
      };
    }),
    { scoring: league.scoringSettings, oddsByTeam },
  );
  const projectedById = new Map(projected.map((p) => [p.playerId, p]));

  // --- slot accounting -------------------------------------------------------
  hr('ROSTER SLOTS');
  const slotConfig = {
    rosterPositions: league.rosterPositions,
    taxiSlots: league.taxiSlots, taxiYears: league.taxiYears,
    taxiDeadline: league.taxiDeadline, taxiAllowVets: league.taxiAllowVets,
    reserveSlots: league.reserveSlots,
  };
  const rosterInfo = new Map<string, RosterPlayerInfo>(
    (mine.players ?? []).map((id) => {
      const p = playerById.get(id);
      return [id, {
        playerId: id, name: p?.fullName ?? id, position: p?.position ?? '?',
        yearsExp: p?.yearsExp ?? null, injuryStatus: p?.injuryStatus ?? null, status: p?.status ?? null,
      }];
    }),
  );

  const occ = computeOccupancy(slotConfig, { players: mine.players ?? [], taxi: mine.taxi ?? [], reserve: mine.reserve ?? [] });
  console.log(`  active   ${occ.playersActive}/${occ.totalActiveSlots}   (${occ.startingSlots} starting + ${occ.benchSlots} bench)`);
  console.log(`  taxi     ${occ.playersOnTaxi}/${occ.taxiSlots}`);
  console.log(`  IR       ${occ.playersOnReserve}/${occ.reserveSlots}`);
  if (mine.taxi?.length) console.log(`  on taxi: ${mine.taxi.map(name).join(', ')}`);
  if (mine.reserve?.length) console.log(`  on IR:   ${mine.reserve.map(name).join(', ')}`);

  const moves = findSlotMoves(slotConfig, { players: mine.players ?? [], taxi: mine.taxi ?? [], reserve: mine.reserve ?? [] }, rosterInfo, week);
  console.log(`\n  ${moves.length} slot move${moves.length === 1 ? '' : 's'} suggested:`);
  for (const m of moves) console.log(`   [${m.severity.toUpperCase()}] ${m.title}\n      ${m.detail}`);

  // --- lineup ----------------------------------------------------------------
  hr('OPTIMAL LINEUP');
  const taxiSet = new Set(mine.taxi ?? []);
  const reserveSet = new Set(mine.reserve ?? []);
  const lineupPlayers: LineupPlayer[] = (mine.players ?? [])
    .filter((id) => !taxiSet.has(id) && !reserveSet.has(id))
    .map((id) => {
      const player = playerById.get(id);
      const proj = projectedById.get(id);
      return {
        playerId: id,
        position: player?.position ?? 'UNK',
        eligiblePositions: player?.fantasyPositions ?? [player?.position ?? 'UNK'],
        points: proj?.points ?? 0,
        ineligible: !proj,
      };
    });

  const comparison = compareToCurrentLineup(lineupPlayers, league.rosterPositions, mine.starters ?? []);
  for (const a of comparison.optimal.assignments) {
    const pl = a.playerId ? playerById.get(a.playerId) : null;
    const pr = a.playerId ? projectedById.get(a.playerId) : null;
    console.log(
      `  ${a.slot.padEnd(11)} ${(a.playerId ? name(a.playerId) : '(empty)').padEnd(24)} ` +
        `${String(pl?.position ?? '').padEnd(4)} ${String(pl?.team ?? '').padEnd(4)} ${a.points.toFixed(1).padStart(6)}` +
        (pr && pr.layers.includes('market') ? `   base ${pr.basePoints.toFixed(1)} → mkt ${pr.marketPoints?.toFixed(1)}` : ''),
    );
  }
  console.log(`  ${'TOTAL'.padEnd(11)} ${''.padEnd(24)} ${''.padEnd(9)} ${comparison.optimal.totalPoints.toFixed(1).padStart(6)}`);
  console.log(`\n  current starters: ${comparison.currentPoints.toFixed(1)}   points left on bench: ${comparison.pointsLeftOnBench.toFixed(1)}`);
  if (comparison.changes.length) {
    console.log('\n  suggested changes:');
    for (const c of comparison.changes.slice(0, 6)) {
      console.log(`    ${c.slot.padEnd(11)} start ${name(c.benchPlayerId).padEnd(22)} over ${(c.startingPlayerId ? name(c.startingPlayerId) : '(empty)').padEnd(22)} +${c.gain.toFixed(1)}`);
    }
  }

  // --- market movers on your roster -----------------------------------------
  hr('MARKET LAYER — biggest moves on YOUR roster');
  const movers = (mine.players ?? [])
    .map((id) => projectedById.get(id)).filter((p): p is NonNullable<typeof p> => !!p && p.marketPoints !== null)
    .map((p) => ({ p, delta: p.marketPoints! - p.basePoints }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 6);
  for (const { p, delta } of movers) {
    console.log(`  ${name(p.playerId).padEnd(24)} ${p.position.padEnd(4)} ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`);
    console.log(`      ${explainLayers(p)}`);
  }

  // --- posture ---------------------------------------------------------------
  hr('CONTEND vs REBUILD');
  const strengthOf = (r: typeof allRosters[number]) => {
    const rTaxi = new Set(r.taxi ?? []); const rRes = new Set(r.reserve ?? []);
    const pool: LineupPlayer[] = (r.players ?? []).filter((id) => !rTaxi.has(id) && !rRes.has(id)).map((id) => {
      const pl = playerById.get(id);
      return {
        playerId: id, position: pl?.position ?? 'UNK',
        eligiblePositions: pl?.fantasyPositions ?? [pl?.position ?? 'UNK'],
        points: projectedById.get(id)?.points ?? 0,
      };
    });
    return optimizeLineup(pool, league.rosterPositions).totalPoints;
  };
  const strengths = allRosters.map((r) => ({ rosterId: r.rosterId, strength: strengthOf(r), settings: r.settings }));
  const mineStrength = strengths.find((s) => s.rosterId === myRosterId)!;
  const posture = evaluatePosture({
    myStartingStrength: mineStrength.strength,
    leagueStartingStrengths: strengths.map((s) => s.strength),
    wins: mine.settings?.wins ?? 0, losses: mine.settings?.losses ?? 0, ties: mine.settings?.ties ?? 0,
    weeksRemaining: Math.max(0, 14 - week), playoffTeams: 6, totalTeams: league.totalRosters,
  });
  console.log(`  posture: ${posture.posture.toUpperCase()}  (score ${posture.score.toFixed(2)})`);
  console.log(`  ${posture.reasoning}`);
  console.log('\n  league starting-lineup strength:');
  for (const s of [...strengths].sort((a, b) => b.strength - a.strength)) {
    console.log(`    ${s.rosterId === myRosterId ? '►' : ' '} roster ${String(s.rosterId).padStart(2)}  ${s.strength.toFixed(1).padStart(7)}`);
  }

  // --- dynasty assets --------------------------------------------------------
  if (league.isDynasty) {
    hr('DYNASTY ASSETS — age-adjusted');
    const assets = (mine.players ?? []).map((id) => {
      const pl = playerById.get(id); const v = valueById.get(id);
      if (!pl || !v?.dynastyValue) return null;
      const asset = { playerId: id, position: pl.position ?? '?', age: pl.age, dynastyValue: v.dynastyValue, redraftValue: v.redraftValue ?? 0 };
      return { name: pl.fullName ?? id, pos: pl.position, age: pl.age, raw: v.dynastyValue,
               adj: adjustedDynastyValue(asset), mult: ageMultiplier(pl.position ?? '?', pl.age), trend: v.trend30Day };
    }).filter((a): a is NonNullable<typeof a> => !!a).sort((a, b) => b.adj - a.adj);

    console.log(`  ${'player'.padEnd(24)} pos  age   value   age-adj   mult   30d trend`);
    for (const a of assets.slice(0, 14)) {
      console.log(
        `  ${a.name.padEnd(24)} ${String(a.pos).padEnd(4)} ${String(a.age ?? '?').padStart(4)} ` +
          `${String(a.raw).padStart(7)} ${a.adj.toFixed(0).padStart(9)} ${a.mult.toFixed(2).padStart(6)} ` +
          `${(a.trend ?? 0) >= 0 ? '+' : ''}${a.trend ?? 0}`,
      );
    }
    const totalAdj = assets.reduce((s, a) => s + a.adj, 0);
    console.log(`\n  ${assets.length} valued assets, total age-adjusted value ${totalAdj.toFixed(0)}`);
    const aging = assets.filter((a) => a.mult < 0.9);
    if (aging.length) {
      console.log(
        `\n  past the age cliff — ` +
          (posture.posture === 'contend'
            ? 'keep, they are why you are contending:'
            : 'sell now, they decline fastest while you rebuild:'),
      );
      for (const a of aging) console.log(`    ${a.name.padEnd(24)} ${a.pos} age ${a.age}  ${((1 - a.mult) * 100).toFixed(0)}% discount`);
    }
  }
  console.log();
}

main().catch((e) => { console.error(e); process.exit(1); });
