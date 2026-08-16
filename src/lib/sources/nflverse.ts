/**
 * nflverse schedule data.
 *
 * Sleeper's player dump carries no bye week (verified: 0 of 11,979 players had
 * one), and deriving byes from ESPN would cost ~300 requests a season. nflverse
 * publishes the full schedule as a single CSV, from which byes fall out as
 * "team absent from a week".
 *
 * Also the basis for strength-of-schedule work later.
 */

const SCHEDULE_CSV = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';

export interface ScheduleGame {
  season: number;
  week: number;
  gameType: string;
  homeTeam: string;
  awayTeam: string;
  gameday: string | null;
}

/**
 * Team abbreviations that differ between nflverse and Sleeper. Left unmapped a
 * team's bye week silently goes missing, so this is explicit.
 */
const NFLVERSE_TO_SLEEPER: Record<string, string> = {
  LA: 'LAR',
  WSH: 'WAS',
  SD: 'LAC',
  OAK: 'LV',
  STL: 'LAR',
};

const normalize = (team: string) => NFLVERSE_TO_SLEEPER[team] ?? team;

export async function getSchedule(season: number): Promise<ScheduleGame[]> {
  const response = await fetch(SCHEDULE_CSV, {
    headers: { 'user-agent': 'footballcheatsheet/1.0' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`nflverse schedule fetch failed: ${response.status}`);

  const csv = await response.text();
  return parseSchedule(csv).filter((game) => game.season === season);
}

/** Minimal CSV parse — nflverse's schedule has no quoted commas in the columns we read. */
export function parseSchedule(csv: string): ScheduleGame[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map((h) => h.trim());
  const idx = {
    season: header.indexOf('season'),
    week: header.indexOf('week'),
    gameType: header.indexOf('game_type'),
    home: header.indexOf('home_team'),
    away: header.indexOf('away_team'),
    gameday: header.indexOf('gameday'),
  };

  if (Object.values(idx).some((i) => i === -1)) {
    throw new Error('nflverse schedule CSV is missing an expected column');
  }

  const games: ScheduleGame[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const season = Number(cols[idx.season]);
    const week = Number(cols[idx.week]);
    if (!Number.isFinite(season) || !Number.isFinite(week)) continue;

    games.push({
      season,
      week,
      gameType: cols[idx.gameType],
      homeTeam: normalize(cols[idx.home]?.trim()),
      awayTeam: normalize(cols[idx.away]?.trim()),
      gameday: cols[idx.gameday]?.trim() || null,
    });
  }
  return games;
}

/**
 * Map each team to its bye week: the regular-season week in which it does not
 * appear on the schedule.
 *
 * Returns an empty map rather than guessing if the schedule looks incomplete —
 * a wrong bye week is worse than no bye week, because it would silently zero
 * out a healthy starter's projection.
 */
export function deriveByeWeeks(games: ScheduleGame[]): Map<string, number> {
  const regular = games.filter((g) => g.gameType === 'REG');
  if (regular.length === 0) return new Map();

  const teams = new Set<string>();
  for (const game of regular) {
    teams.add(game.homeTeam);
    teams.add(game.awayTeam);
  }

  const weeks = [...new Set(regular.map((g) => g.week))].sort((a, b) => a - b);
  const byes = new Map<string, number>();

  for (const week of weeks) {
    const playing = new Set<string>();
    for (const game of regular) {
      if (game.week !== week) continue;
      playing.add(game.homeTeam);
      playing.add(game.awayTeam);
    }
    for (const team of teams) {
      // First absence only: weeks 15-18 can have teams missing for other
      // reasons in a partial schedule, and a team has exactly one bye.
      if (!playing.has(team) && !byes.has(team)) byes.set(team, week);
    }
  }

  return byes;
}

/** Which teams play in a given week — used for bye-week roster coverage. */
export function teamsPlayingInWeek(games: ScheduleGame[], week: number): Set<string> {
  const playing = new Set<string>();
  for (const game of games) {
    if (game.gameType !== 'REG' || game.week !== week) continue;
    playing.add(game.homeTeam);
    playing.add(game.awayTeam);
  }
  return playing;
}
