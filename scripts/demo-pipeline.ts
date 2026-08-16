/**
 * End-to-end demonstration of the three-layer projection stack on live data.
 * No database required.
 *
 *   npx tsx scripts/demo-pipeline.ts
 */
import { getState, getWeeklyProjections, hasRealProjection } from '../src/lib/sources/sleeper';
import { getWeekGameLines, indexByTeam, SEASON_TYPE } from '../src/lib/sources/espn-odds';
import { projectPlayers, explainLayers, type TeamOdds } from '../src/lib/engine/pipeline';
import { optimizeLineup, type LineupPlayer } from '../src/lib/engine/lineup';

/** A realistic 0.5-PPR dynasty scoring config. */
const SCORING = {
  pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2,
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  rec: 0.5, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
  fum_lost: -2,
};

async function main() {
  const state = await getState();
  const season = state.league_season;

  const [rawProjections, lines] = await Promise.all([
    getWeeklyProjections(season, 1, ['QB', 'RB', 'WR', 'TE']),
    getWeekGameLines(season, 1, SEASON_TYPE.regular),
  ]);

  const usable = rawProjections.filter(hasRealProjection);
  const teamIndex = indexByTeam(lines);

  const oddsByTeam = new Map<string, TeamOdds>();
  for (const [team, ctx] of teamIndex) {
    oddsByTeam.set(team, {
      impliedPoints: ctx.impliedPoints,
      spread: ctx.spread,
      opponent: ctx.opponent,
    });
  }

  const projected = projectPlayers(
    usable.map((p) => ({
      playerId: p.player_id,
      position: p.player?.position ?? 'UNK',
      team: p.team,
      stats: p.stats,
    })),
    { scoring: SCORING, oddsByTeam },
  );

  const names = new Map(
    usable.map((p) => [p.player_id, `${p.player?.first_name ?? ''} ${p.player?.last_name ?? ''}`.trim()]),
  );

  console.log(`\n${season} Week 1 — ${usable.length} projected players, ${lines.length} games with DK lines`);
  console.log(`Market layer coverage: ${projected.filter((p) => p.layers.includes('market')).length}/${projected.length} players\n`);

  console.log('='.repeat(96));
  console.log('BIGGEST MARKET DISAGREEMENTS  (where the betting market moves a projection most)');
  console.log('='.repeat(96));

  const movers = projected
    .filter((p) => p.marketPoints !== null && p.basePoints > 4)
    .map((p) => ({ ...p, delta: p.marketPoints! - p.basePoints }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  console.log('\nMarket is HIGHER than the base projection:');
  for (const p of movers.filter((m) => m.delta > 0).slice(0, 6)) {
    console.log(
      `  ${(names.get(p.playerId) ?? p.playerId).padEnd(22)} ${p.position.padEnd(3)} ${String(p.team).padEnd(4)} ` +
        `vs ${String(p.opponent).padEnd(4)}  base ${p.basePoints.toFixed(1).padStart(5)} -> market ${p.marketPoints!.toFixed(1).padStart(5)}  ` +
        `(${p.delta > 0 ? '+' : ''}${p.delta.toFixed(1)})  team implied ${p.impliedTeamPoints?.toFixed(1)}, spread ${p.spread}`,
    );
  }

  console.log('\nMarket is LOWER than the base projection:');
  for (const p of movers.filter((m) => m.delta < 0).slice(0, 6)) {
    console.log(
      `  ${(names.get(p.playerId) ?? p.playerId).padEnd(22)} ${p.position.padEnd(3)} ${String(p.team).padEnd(4)} ` +
        `vs ${String(p.opponent).padEnd(4)}  base ${p.basePoints.toFixed(1).padStart(5)} -> market ${p.marketPoints!.toFixed(1).padStart(5)}  ` +
        `(${p.delta.toFixed(1)})  team implied ${p.impliedTeamPoints?.toFixed(1)}, spread ${p.spread}`,
    );
  }

  console.log('\n' + '='.repeat(96));
  console.log('EXPLAIN PANEL — what the UI will show');
  console.log('='.repeat(96));
  for (const p of movers.slice(0, 3)) {
    console.log(`\n${names.get(p.playerId)} (${p.position}, ${p.team})`);
    console.log(`  ${explainLayers(p)}`);
  }

  console.log('\n' + '='.repeat(96));
  console.log('RANKING FLIPS — players the market reorders');
  console.log('='.repeat(96));
  const byBase = [...projected].sort((a, b) => b.basePoints - a.basePoints);
  const byFinal = [...projected].sort((a, b) => b.points - a.points);
  const baseRank = new Map(byBase.map((p, i) => [p.playerId, i + 1]));

  const flips = byFinal
    .map((p, i) => ({ p, finalRank: i + 1, baseRank: baseRank.get(p.playerId)!, move: baseRank.get(p.playerId)! - (i + 1) }))
    .filter((f) => f.finalRank <= 60)
    .sort((a, b) => Math.abs(b.move) - Math.abs(a.move))
    .slice(0, 8);

  for (const f of flips) {
    console.log(
      `  ${(names.get(f.p.playerId) ?? '').padEnd(22)} ${f.p.position.padEnd(3)} ` +
        `base rank #${String(f.baseRank).padStart(3)} -> #${String(f.finalRank).padStart(3)}  (${f.move > 0 ? '+' : ''}${f.move})`,
    );
  }

  console.log('\n' + '='.repeat(96));
  console.log('LINEUP OPTIMIZER on a sample dynasty superflex roster');
  console.log('='.repeat(96));

  // Build a plausible roster out of mid-tier players to exercise the optimizer.
  const pool = byFinal.filter((p) => ['QB', 'RB', 'WR', 'TE'].includes(p.position));
  const pick = (position: string, from: number, count: number) =>
    pool.filter((p) => p.position === position).slice(from, from + count);

  const roster = [
    ...pick('QB', 4, 2),
    ...pick('RB', 6, 4),
    ...pick('WR', 8, 5),
    ...pick('TE', 3, 2),
  ];

  const lineupPlayers: LineupPlayer[] = roster.map((p) => ({
    playerId: p.playerId,
    position: p.position,
    eligiblePositions: [p.position],
    points: p.points,
  }));

  const positions = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'BN', 'BN', 'BN'];
  const optimal = optimizeLineup(lineupPlayers, positions);

  for (const assignment of optimal.assignments) {
    const name = assignment.playerId ? names.get(assignment.playerId) ?? assignment.playerId : '(empty)';
    console.log(`  ${assignment.slot.padEnd(12)} ${name.padEnd(24)} ${assignment.points.toFixed(1).padStart(6)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(12)} ${''.padEnd(24)} ${optimal.totalPoints.toFixed(1).padStart(6)}`);
  console.log(`\n  Bench: ${optimal.benchedPlayerIds.map((id) => names.get(id)).join(', ')}`);
  console.log();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
