/**
 * Import a Sleeper user's leagues and run a full data sync.
 *
 *   npx tsx scripts/import.ts [username] [season]
 */
import './_env';
import { db } from '../src/db';
import { leagues as leaguesTable } from '../src/db/schema';
import {
  getState,
  getUserByName,
  getUserLeagues,
  getLeagueRosters,
  requiredProjectionPositions,
} from '../src/lib/sources/sleeper';
import { syncLeague, setMyTeam, getTrackedLeagues } from '../src/lib/sync/league';
import {
  syncPlayers,
  syncWeeklyProjections,
  syncSeasonProjections,
  syncGameOdds,
  syncMarketValues,
} from '../src/lib/sync/data';
import { shapeFromLeague, shapeKey } from '../src/lib/sources/fantasycalc';
import { SEASON_TYPE } from '../src/lib/sources/espn-odds';

const step = (msg: string) => console.log(`\n▸ ${msg}`);

async function main() {
  const username = process.argv[2] ?? process.env.SLEEPER_USERNAME;
  if (!username) throw new Error('Pass a username or set SLEEPER_USERNAME');

  const state = await getState();
  const season = process.argv[3] ?? state.league_season;

  step(`Looking up @${username}`);
  const user = await getUserByName(username);
  if (!user) throw new Error(`No Sleeper user "${username}"`);
  console.log(`  ${user.display_name} (${user.user_id})`);

  step(`Importing ${season} leagues`);
  const userLeagues = await getUserLeagues(user.user_id, season);
  for (const league of userLeagues) {
    await syncLeague(league.league_id);
    const rosters = await getLeagueRosters(league.league_id);
    const mine = rosters.find((r) => r.owner_id === user.user_id);
    if (mine) {
      await setMyTeam(league.league_id, mine.roster_id, user.user_id);
      console.log(`  ✓ ${league.name} — your roster_id=${mine.roster_id}`);
    } else {
      console.log(`  ! ${league.name} — could not find your roster; skipped marking`);
    }
  }

  step('Syncing player dump (~14MB, once daily in production)');
  console.log(`  ${await syncPlayers()} players`);

  const tracked = await getTrackedLeagues();
  const positionSets = tracked.map((t) => t.league.rosterPositions);
  const positions = requiredProjectionPositions(positionSets);
  console.log(`\n  position groups needed: ${positions.join(', ')}`);

  step(`Syncing week 1 projections (${season})`);
  console.log(`  ${await syncWeeklyProjections(season, 1, positions)} projections`);

  step(`Syncing season projections (${season})`);
  console.log(`  ${await syncSeasonProjections(season, positions)} rows`);

  step('Syncing DraftKings game lines');
  const regular = await syncGameOdds(season, 1, SEASON_TYPE.regular);
  console.log(`  ${regular} games (regular season week 1)`);

  step('Syncing FantasyCalc values per league shape');
  const shapes = new Map<string, ReturnType<typeof shapeFromLeague>>();
  for (const { league } of tracked) {
    const shape = shapeFromLeague({
      isDynasty: league.isDynasty,
      isSuperflex: league.isSuperflex,
      totalRosters: league.totalRosters,
      pprType: league.pprType,
    });
    shapes.set(shapeKey(shape), shape);
  }
  for (const [key, shape] of shapes) {
    console.log(`  ${key}: ${await syncMarketValues(shape)} players`);
  }

  step('Summary');
  const rows = await db.select().from(leaguesTable);
  for (const league of rows) {
    console.log(
      `  ${league.name.padEnd(20)} ${league.isDynasty ? 'DYNASTY' : 'REDRAFT'}  ` +
        `${league.totalRosters} teams  ppr=${league.pprType}  ` +
        `taxi=${league.taxiSlots} ir=${league.reserveSlots}  ` +
        `${Object.keys(league.scoringSettings).length} scoring keys`,
    );
  }
  console.log();
}

main().catch((error) => {
  console.error('\nIMPORT FAILED:', error);
  process.exit(1);
});
