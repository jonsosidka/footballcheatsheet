/**
 * Show what Sleeper has for a username, before importing anything.
 *
 *   npx tsx scripts/inspect-leagues.ts [username]
 */
import { config } from 'dotenv';
import {
  getState,
  getUserByName,
  getUserLeagues,
  getLeagueRosters,
  getLeagueUsers,
  isDynastyLeague,
} from '../src/lib/sources/sleeper';
import { isSuperflexRoster, pprType, startingSlots } from '../src/lib/engine/scoring';

config({ path: '.env.local' });

async function main() {
  const username = process.argv[2] ?? process.env.SLEEPER_USERNAME;
  if (!username) throw new Error('Pass a username or set SLEEPER_USERNAME');

  const state = await getState();
  const user = await getUserByName(username);
  if (!user) throw new Error(`Sleeper has no user "${username}"`);

  console.log(`\nUser: ${user.display_name} (@${user.username})  id=${user.user_id}`);
  console.log(`NFL state: ${state.season} ${state.season_type}, week ${state.week} (league season ${state.league_season})`);

  // Check both the league season and the previous one — early in the year the
  // new season's leagues may not exist yet.
  const seasons = Array.from(new Set([state.league_season, state.season, state.previous_season]));
  for (const season of seasons) {
    const leagues = await getUserLeagues(user.user_id, season);
    console.log(`\n${'='.repeat(78)}`);
    console.log(`SEASON ${season}: ${leagues.length} league${leagues.length === 1 ? '' : 's'}`);
    console.log('='.repeat(78));

    for (const league of leagues) {
      const dynasty = isDynastyLeague(league);
      const superflex = isSuperflexRoster(league.roster_positions);
      const ppr = pprType(league.scoring_settings);
      const starters = startingSlots(league.roster_positions);
      const settings = league.settings ?? {};

      const [rosters, users] = await Promise.all([
        getLeagueRosters(league.league_id),
        getLeagueUsers(league.league_id),
      ]);
      const mine = rosters.find((r) => r.owner_id === user.user_id);
      const owner = users.find((u) => u.user_id === user.user_id);

      console.log(`\n  ${league.name}   [${league.league_id}]`);
      console.log(`    type          ${dynasty ? 'DYNASTY' : settings.type === 1 ? 'KEEPER' : 'REDRAFT'}  (settings.type=${settings.type ?? 0})`);
      console.log(`    teams         ${league.total_rosters}`);
      console.log(`    scoring       ${ppr === 1 ? 'full PPR' : ppr === 0.5 ? 'half PPR' : ppr === 0 ? 'standard' : `${ppr}/rec`}${superflex ? ', SUPERFLEX' : ''}`);
      console.log(`    starters      ${starters.join(', ')}`);
      console.log(`    bench         ${league.roster_positions.filter((p) => p === 'BN').length}`);
      console.log(`    taxi          ${settings.taxi_slots ?? 0} slots, ${settings.taxi_years ?? 0} yrs, deadline wk ${settings.taxi_deadline ?? 0}, vets ${settings.taxi_allow_vets ? 'allowed' : 'no'}`);
      console.log(`    IR            ${settings.reserve_slots ?? 0} slots`);
      console.log(`    status        ${league.status}`);

      if (mine) {
        const s = mine.settings ?? {};
        console.log(`    YOUR TEAM     roster_id=${mine.roster_id}  "${owner?.metadata?.team_name ?? owner?.display_name ?? '?'}"`);
        console.log(`                  ${s.wins ?? 0}-${s.losses ?? 0}${s.ties ? `-${s.ties}` : ''}, ${mine.players?.length ?? 0} players, ${mine.taxi?.length ?? 0} taxi, ${mine.reserve?.length ?? 0} IR`);
      } else {
        console.log(`    YOUR TEAM     not found in this league`);
      }

      // Scoring keys that are unusual — worth surfacing since they change math.
      const notable = Object.entries(league.scoring_settings)
        .filter(([k, v]) => (k.startsWith('bonus') || k.includes('_fd') || k === 'rec_te' ) && v !== 0)
        .map(([k, v]) => `${k}=${v}`);
      if (notable.length > 0) console.log(`    bonuses       ${notable.join(', ')}`);
    }
  }
  console.log();
}

main().catch((error) => {
  console.error('\nFAILED:', error.message);
  process.exit(1);
});
