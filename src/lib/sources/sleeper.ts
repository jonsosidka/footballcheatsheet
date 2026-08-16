import { fetchJson, mapLimit } from './http';
import type { ScoringSettings, StatLine } from '@/db/schema';

/**
 * Sleeper API client.
 *
 * Two hosts are in play and both matter:
 *   - api.sleeper.app/v1  — the documented, stable read-only API
 *   - api.sleeper.com     — undocumented but public; the only free source of
 *                           Rotowire projections keyed by Sleeper player_id
 *
 * The projections host is undocumented, so every call goes through fetchJson's
 * retry/backoff and callers must tolerate nulls. If it ever disappears, the
 * ProjectionProvider seam means we swap the base layer without touching the
 * engine.
 */

const V1 = 'https://api.sleeper.app/v1';
const API = 'https://api.sleeper.com';

// ---------------------------------------------------------------------------
// Types (only the fields we actually consume)
// ---------------------------------------------------------------------------

export interface SleeperState {
  week: number;
  season: string;
  season_type: string;
  display_week: number;
  league_season: string;
  previous_season: string;
  season_start_date: string;
}

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  metadata?: { team_name?: string | null } | null;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  season_type: string;
  status: string;
  avatar: string | null;
  total_rosters: number;
  scoring_settings: ScoringSettings;
  roster_positions: string[];
  settings: Record<string, number>;
  previous_league_id: string | null;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  league_id: string;
  players: string[] | null;
  starters: string[] | null;
  taxi: string[] | null;
  reserve: string[] | null;
  settings: Record<string, number>;
}

export interface SleeperMatchup {
  roster_id: number;
  matchup_id: number | null;
  points: number | null;
  starters: string[] | null;
  players: string[] | null;
  players_points: Record<string, number> | null;
}

export interface SleeperPlayer {
  player_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name?: string | null;
  position: string | null;
  fantasy_positions: string[] | null;
  team: string | null;
  age: number | null;
  years_exp: number | null;
  status: string | null;
  injury_status: string | null;
  injury_body_part: string | null;
  injury_notes: string | null;
  depth_chart_position: string | null;
  depth_chart_order: number | null;
  search_rank: number | null;
  number: number | null;
  active: boolean;
  news_updated: number | null;
}

export interface SleeperProjection {
  player_id: string;
  week: number;
  season: string;
  season_type: string;
  stats: StatLine;
  team: string | null;
  opponent: string | null;
  game_id: string | null;
  company: string | null;
  player?: {
    first_name: string;
    last_name: string;
    position: string | null;
    team: string | null;
    injury_status: string | null;
  } | null;
}

export interface TrendingPlayer {
  player_id: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export async function getState(): Promise<SleeperState> {
  const state = await fetchJson<SleeperState>(`${V1}/state/nfl`);
  if (!state) throw new Error('Sleeper returned no NFL state');
  return state;
}

export async function getUserByName(username: string): Promise<SleeperUser | null> {
  return fetchJson<SleeperUser>(`${V1}/user/${encodeURIComponent(username.trim())}`, {
    nullOn404: true,
  });
}

export async function getUserLeagues(userId: string, season: string): Promise<SleeperLeague[]> {
  return (await fetchJson<SleeperLeague[]>(`${V1}/user/${userId}/leagues/nfl/${season}`)) ?? [];
}

export async function getLeague(leagueId: string): Promise<SleeperLeague | null> {
  return fetchJson<SleeperLeague>(`${V1}/league/${leagueId}`, { nullOn404: true });
}

export async function getLeagueUsers(leagueId: string): Promise<SleeperUser[]> {
  return (await fetchJson<SleeperUser[]>(`${V1}/league/${leagueId}/users`)) ?? [];
}

export async function getLeagueRosters(leagueId: string): Promise<SleeperRoster[]> {
  return (await fetchJson<SleeperRoster[]>(`${V1}/league/${leagueId}/rosters`)) ?? [];
}

export async function getMatchups(leagueId: string, week: number): Promise<SleeperMatchup[]> {
  return (await fetchJson<SleeperMatchup[]>(`${V1}/league/${leagueId}/matchups/${week}`)) ?? [];
}

/**
 * The full player dump is ~14MB and changes slowly. Sleeper explicitly asks
 * that it be fetched at most once per day — the daily background function owns
 * this call, never a request path.
 */
export async function getAllPlayers(): Promise<Record<string, SleeperPlayer>> {
  const players = await fetchJson<Record<string, SleeperPlayer>>(`${V1}/players/nfl`, {
    timeoutMs: 120_000,
  });
  if (!players) throw new Error('Sleeper returned no player dump');
  return players;
}

/** Community add/drop velocity — a useful crowd signal for waiver ranking. */
export async function getTrending(
  type: 'add' | 'drop',
  lookbackHours = 24,
  limit = 50,
): Promise<TrendingPlayer[]> {
  return (
    (await fetchJson<TrendingPlayer[]>(
      `${V1}/players/nfl/trending/${type}?lookback_hours=${lookbackHours}&limit=${limit}`,
    )) ?? []
  );
}

const PROJECTION_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/**
 * Sleeper's projection endpoint only accepts these IDP position filters —
 * DE, CB and S return zero rows and are folded into DL/DB respectively.
 */
export const IDP_POSITIONS = ['DL', 'LB', 'DB'];

const IDP_SLOTS = new Set(['DL', 'LB', 'DB', 'IDP_FLEX', 'DE', 'CB', 'S']);

/**
 * Which position groups actually need fetching for a set of leagues.
 *
 * IDP projections are three extra requests and several thousand rows, so they
 * are only pulled when a tracked league actually starts defensive players.
 * This keeps the hourly refresh inside Netlify's 30-second budget for the
 * common all-offense case.
 */
export function requiredProjectionPositions(rosterPositionSets: string[][]): string[] {
  const needsIdp = rosterPositionSets.some((positions) => positions.some((slot) => IDP_SLOTS.has(slot)));
  return needsIdp ? [...PROJECTION_POSITIONS, ...IDP_POSITIONS] : [...PROJECTION_POSITIONS];
}

/**
 * Weekly projections for a whole position group.
 *
 * Fetching by position rather than by player keeps this to 6 requests per week
 * instead of ~600. Rows with an empty-ish stats object (bench fodder Sleeper
 * pads the list with) are filtered out by the caller via hasRealProjection.
 */
export async function getWeeklyProjections(
  season: string,
  week: number,
  positions: string[] = PROJECTION_POSITIONS,
  seasonType = 'regular',
): Promise<SleeperProjection[]> {
  const results = await mapLimit(positions, 3, async (position) => {
    const query = new URLSearchParams({ season_type: seasonType, order_by: 'ppr' });
    query.append('position[]', position);
    return (
      (await fetchJson<SleeperProjection[]>(
        `${API}/projections/nfl/${season}/${week}?${query.toString()}`,
        { nullOn404: true },
      )) ?? []
    );
  });

  return results.flat();
}

/** Season-long projections, used for rest-of-season waiver and dynasty math. */
export async function getSeasonProjections(
  season: string,
  positions: string[] = PROJECTION_POSITIONS,
  seasonType = 'regular',
): Promise<SleeperProjection[]> {
  const results = await mapLimit(positions, 3, async (position) => {
    const query = new URLSearchParams({ season_type: seasonType, order_by: 'ppr' });
    query.append('position[]', position);
    return (
      (await fetchJson<SleeperProjection[]>(
        `${API}/projections/nfl/${season}?${query.toString()}`,
        { nullOn404: true },
      )) ?? []
    );
  });

  return results.flat();
}

/**
 * Sleeper pads projection responses with inactive/irrelevant players carrying
 * only an ADP field. A row is only useful if it has actual production stats.
 */
export function hasRealProjection(projection: SleeperProjection): boolean {
  const stats = projection.stats;
  if (!stats) return false;
  return Object.keys(stats).some(
    (key) => !key.startsWith('adp') && !key.startsWith('pos_adp') && key !== 'gp',
  );
}

/** Sleeper's settings.type: 2 = dynasty, 1 = keeper, 0 = redraft. */
export function isDynastyLeague(league: SleeperLeague): boolean {
  const type = league.settings?.type ?? 0;
  if (type === 2) return true;
  // A keeper league with taxi slots behaves like a dynasty for our purposes.
  return type === 1 && (league.settings?.taxi_slots ?? 0) > 0;
}
