/**
 * Live smoke test for the four upstream sources.
 *
 * These are free third-party APIs we don't control, so this is deliberately a
 * real network test rather than a mock: the failure mode we care about is
 * "upstream changed shape", which mocks cannot catch.
 *
 *   npx tsx scripts/smoke-sources.ts
 */
import {
  getState,
  getWeeklyProjections,
  getSeasonProjections,
  getTrending,
  hasRealProjection,
  getUserByName,
} from '../src/lib/sources/sleeper';
import { getWeekGameLines, indexByTeam, SEASON_TYPE } from '../src/lib/sources/espn-odds';
import { getValues, shapeKey } from '../src/lib/sources/fantasycalc';
import { scoreProjection } from '../src/lib/engine/scoring';
import { applyMarketLayer, baseImpliedTeamPoints } from '../src/lib/engine/market';

const HALF_PPR = {
  pass_yd: 0.04, pass_td: 4, pass_int: -2,
  rush_yd: 0.1, rush_td: 6,
  rec: 0.5, rec_yd: 0.1, rec_td: 6,
  fum_lost: -2,
};

function heading(text: string) {
  console.log(`\n${'='.repeat(64)}\n${text}\n${'='.repeat(64)}`);
}

async function main() {
  const username = process.argv[2];

  heading('1. Sleeper state');
  const state = await getState();
  console.log(state);

  if (username) {
    heading(`1b. Sleeper user lookup: ${username}`);
    const user = await getUserByName(username);
    console.log(user ? { user_id: user.user_id, display_name: user.display_name } : 'NOT FOUND');
  }

  heading('2. Weekly projections + custom scoring');
  // Use the upcoming regular season regardless of the current preseason state.
  const season = state.league_season;
  const projections = await getWeeklyProjections(season, 1, ['QB', 'RB', 'WR', 'TE']);
  const real = projections.filter(hasRealProjection);
  console.log(`fetched ${projections.length} rows, ${real.length} with real stat lines`);

  const scored = real
    .map((p) => ({
      name: `${p.player?.first_name ?? ''} ${p.player?.last_name ?? ''}`.trim(),
      team: p.team,
      opp: p.opponent,
      pos: p.player?.position,
      custom: scoreProjection(p.stats, HALF_PPR),
      sleeperHalf: p.stats.pts_half_ppr ?? null,
      stats: p.stats,
    }))
    .sort((a, b) => b.custom - a.custom);

  console.log('\nTop 8 by our custom half-PPR scoring (vs Sleeper\'s own pts_half_ppr):');
  for (const player of scored.slice(0, 8)) {
    const delta = player.sleeperHalf !== null ? (player.custom - player.sleeperHalf).toFixed(2) : 'n/a';
    console.log(
      `  ${player.name.padEnd(22)} ${String(player.pos).padEnd(3)} ${String(player.team).padEnd(4)} ` +
        `ours=${player.custom.toFixed(2).padStart(6)}  sleeper=${String(player.sleeperHalf).padStart(6)}  delta=${delta}`,
    );
  }

  heading('3. Season projections');
  const seasonProj = await getSeasonProjections(season, ['RB']);
  const seasonReal = seasonProj.filter(hasRealProjection);
  console.log(`${seasonProj.length} rows, ${seasonReal.length} with real stat lines`);

  heading('4. DraftKings game lines via ESPN');
  let lines = await getWeekGameLines(season, 1, SEASON_TYPE.regular);
  let usedLabel = `${season} regular week 1`;
  if (lines.length === 0 || lines.every((l) => l.total === null)) {
    lines = await getWeekGameLines(state.season, state.week, SEASON_TYPE.pre);
    usedLabel = `${state.season} preseason week ${state.week}`;
  }
  console.log(`${usedLabel}: ${lines.length} games, ${lines.filter((l) => l.total !== null).length} with a line`);
  for (const line of lines.slice(0, 5)) {
    console.log(
      `  ${line.awayTeam}@${line.homeTeam}  spread=${line.spread}  total=${line.total}  ` +
        `implied ${line.awayTeam}=${line.impliedAwayPts?.toFixed(2)} ${line.homeTeam}=${line.impliedHomePts?.toFixed(2)}  [${line.book}]`,
    );
  }

  heading('5. Market layer applied to a real player');
  const teamIndex = indexByTeam(lines);
  const candidate = scored.find((p) => p.team && teamIndex.get(p.team)?.impliedPoints != null);
  if (candidate) {
    const ctx = teamIndex.get(candidate.team!)!;
    const teammates = real.filter((p) => p.team === candidate.team).map((p) => p.stats);
    const baseTeamPoints = baseImpliedTeamPoints(teammates);
    const adjusted = applyMarketLayer(candidate.stats, {
      impliedTeamPoints: ctx.impliedPoints!,
      baseTeamPoints,
      teamSpread: ctx.spread ?? 0,
    });
    console.log(`  ${candidate.name} (${candidate.team} vs ${ctx.opponent})`);
    console.log(`  base team pts implied by projections: ${baseTeamPoints.toFixed(2)}`);
    console.log(`  market implied team pts:              ${ctx.impliedPoints!.toFixed(2)}  (spread ${ctx.spread})`);
    console.log(`  base score:   ${scoreProjection(candidate.stats, HALF_PPR).toFixed(2)}`);
    console.log(`  market score: ${scoreProjection(adjusted, HALF_PPR).toFixed(2)}`);
  } else {
    console.log('  no overlap between projections and games with lines (expected in the preseason gap)');
  }

  heading('6. FantasyCalc values');
  const shape = { isDynasty: true, numQbs: 1, numTeams: 12, ppr: 1 };
  const { players, picks } = await getValues(shape);
  console.log(`shape ${shapeKey(shape)}: ${players.length} players, ${picks.length} picks`);
  console.log('top 5 dynasty assets:');
  for (const p of players.slice(0, 5)) {
    console.log(`  ${p.name.padEnd(22)} ${p.position.padEnd(3)} age=${String(p.age).padStart(5)} value=${p.dynastyValue} sleeperId=${p.sleeperId}`);
  }
  console.log('top 5 picks:');
  for (const pick of picks.sort((a, b) => b.value - a.value).slice(0, 5)) {
    console.log(`  ${pick.label.padEnd(20)} season=${pick.season} round=${pick.round} slot=${pick.slot} value=${pick.value}`);
  }

  const superflex = await getValues({ ...shape, numQbs: 2 });
  const topQbOneQb = players.find((p) => p.position === 'QB');
  const topQbSuperflex = superflex.players.find((p) => p.position === 'QB');
  console.log(
    `\nsuperflex sanity: top QB rank 1QB=#${topQbOneQb?.overallRank} -> SF=#${topQbSuperflex?.overallRank} (must rise)`,
  );

  heading('7. Trending adds');
  const trending = await getTrending('add', 24, 5);
  console.log(trending);

  console.log('\nAll source clients responded.\n');
}

main().catch((error) => {
  console.error('\nSMOKE TEST FAILED:', error);
  process.exit(1);
});
