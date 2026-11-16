import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { players } from '@/db/schema';

/**
 * The players a league page can actually show, rather than all of Sleeper.
 *
 * Sleeper's player table is ~12,000 rows (5 MB over the wire), most of them
 * retired or never-signed: loading it whole was the slowest query on every
 * page. A page only ever looks up players who are on an NFL team (free agents
 * worth adding, bye weeks), on a roster in this league (retired players can
 * still sit there), or carrying a projection or market value. That is about
 * a quarter of the table, and the filter runs in Postgres in the same round
 * trip, so it does not wait on the other queries.
 */
export function relevantPlayers(opts: { leagueId: string; season: string; week?: number; shapeKey?: string }) {
  const { leagueId, season, week, shapeKey } = opts;
  return db
    .select()
    .from(players)
    .where(
      sql`${players.team} is not null
        or ${players.id} in (
          select jsonb_array_elements_text(r.players || r.taxi || r.reserve) from rosters r where r.league_id = ${leagueId}
        )
        or ${players.id} in (select player_id from season_projections where season = ${season})
        ${week !== undefined ? sql`or ${players.id} in (select player_id from projections where season = ${season} and week = ${week})` : sql``}
        ${shapeKey !== undefined ? sql`or ${players.id} in (select player_id from market_values where shape_key = ${shapeKey})` : sql``}`,
    );
}
