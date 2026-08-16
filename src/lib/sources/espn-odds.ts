import { fetchJson, mapLimit } from './http';
import { impliedTeamTotals } from '@/lib/engine/market';

/**
 * DraftKings game lines, relayed free by ESPN.
 *
 * DraftKings' own endpoints are Akamai-blocked (verified 403 on both
 * sportsbook-nash and sportsbook-us-nh), but ESPN's core API serves DK's
 * spread, total and moneyline unauthenticated. This is layer 2 of the
 * projection stack and the single highest-value free market signal we get:
 * implied team totals move every player on a roster, including the waiver-wire
 * targets that have no player props.
 *
 * Two calls per refresh cycle shape:
 *   1. scoreboard  -> all games for a week, with teams and kickoff
 *   2. core odds   -> per-game DK line
 */

/*
 * Only the CORE api is used. `site.api.espn.com` (the scoreboard endpoint) is
 * reachable from a laptop but returns 403 from datacenter IP ranges — it worked
 * locally and broke the moment the cron ran on Netlify. `sports.core.api` has
 * no such block and carries everything needed: the week's event list, each
 * event's shortName ("NE @ SEA"), kickoff, and the DraftKings line.
 */
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';

/** ESPN season types: 1 = preseason, 2 = regular, 3 = postseason. */
export const SEASON_TYPE = { pre: 1, regular: 2, post: 3 } as const;

interface RefListResponse {
  count: number;
  items?: Array<{ $ref: string }>;
}

interface CoreEventResponse {
  id: string;
  date: string;
  /** "NE @ SEA" — away @ home. Saves an extra fetch per team. */
  shortName: string;
  name: string;
  competitions?: Array<{ id: string }>;
}

interface CoreOddsResponse {
  count: number;
  items?: Array<{
    provider?: { id: string; name: string };
    details?: string;
    spread?: number;
    overUnder?: number;
    awayTeamOdds?: { moneyLine?: number };
    homeTeamOdds?: { moneyLine?: number };
  }>;
}

export interface GameLine {
  gameId: string;
  season: string;
  week: number;
  homeTeam: string;
  awayTeam: string;
  kickoff: Date | null;
  /** Home team's spread; negative means home is favored. */
  spread: number | null;
  total: number | null;
  moneylineHome: number | null;
  moneylineAway: number | null;
  impliedHomePts: number | null;
  impliedAwayPts: number | null;
  book: string;
}

/**
 * ESPN abbreviations mostly match Sleeper's, but a few diverge. Left
 * unmapped, those teams silently lose their market layer, so the mapping is
 * explicit rather than assumed.
 */
const ESPN_TO_SLEEPER_TEAM: Record<string, string> = {
  WSH: 'WAS',
  LAR: 'LAR',
  LAC: 'LAC',
  JAX: 'JAX',
  ARI: 'ARI',
};

export function normalizeTeam(abbreviation: string): string {
  return ESPN_TO_SLEEPER_TEAM[abbreviation] ?? abbreviation;
}

/** Preferred books in order; we take the first one that has a usable line. */
const BOOK_PRIORITY = ['draftkings', 'espn bet', 'caesars', 'bet365'];

/**
 * Parse "NE @ SEA" into away/home abbreviations.
 *
 * ESPN uses two separators: most games are "AWAY @ HOME", but some — neutral
 * site and special games — come through as "SF VS LAR". The ordering is the
 * same in both (the full `name` field confirms "San Francisco 49ers at Los
 * Angeles Rams"), so VS is treated identically. Missing this dropped a game
 * per week, silently costing every player on those two teams their market
 * layer.
 *
 * Returns null rather than guessing if the format changes again.
 */
export function parseShortName(shortName: string): { away: string; home: string } | null {
  const match = shortName?.match(/^\s*([A-Z]{2,4})\s*(?:@|VS)\s*([A-Z]{2,4})\s*$/i);
  if (!match) return null;
  return { away: normalizeTeam(match[1].toUpperCase()), home: normalizeTeam(match[2].toUpperCase()) };
}

export async function getWeekGameLines(
  season: string,
  week: number,
  seasonType: number = SEASON_TYPE.regular,
): Promise<GameLine[]> {
  // Canonical season path. The flat /events?dates= form filters by calendar
  // year, which returns the previous season's January games for a 2026 query.
  const list = await fetchJson<RefListResponse>(
    `${CORE}/seasons/${season}/types/${seasonType}/weeks/${week}/events?limit=40`,
    { nullOn404: true },
  ).catch(() => null);

  const refs = list?.items ?? [];
  if (refs.length === 0) return [];

  const lines = await mapLimit(refs, 4, async (ref): Promise<GameLine | null> => {
    const event = await fetchJson<CoreEventResponse>(ref.$ref.replace(/^http:/, 'https:'), {
      nullOn404: true,
    }).catch(() => null);
    if (!event) return null;

    const teams = parseShortName(event.shortName);
    if (!teams) return null;

    const competitionId = event.competitions?.[0]?.id ?? event.id;
    const odds = await fetchJson<CoreOddsResponse>(
      `${CORE}/events/${event.id}/competitions/${competitionId}/odds`,
      { nullOn404: true },
    ).catch(() => null);

    const item = pickBook(odds?.items ?? []);

    const spread = numberOrNull(item?.spread);
    const total = numberOrNull(item?.overUnder);
    const implied = impliedTeamTotals(spread, total);

    return {
      gameId: event.id,
      season,
      week,
      homeTeam: teams.home,
      awayTeam: teams.away,
      kickoff: event.date ? new Date(event.date) : null,
      spread,
      total,
      moneylineHome: numberOrNull(item?.homeTeamOdds?.moneyLine),
      moneylineAway: numberOrNull(item?.awayTeamOdds?.moneyLine),
      impliedHomePts: implied?.home ?? null,
      impliedAwayPts: implied?.away ?? null,
      book: item?.provider?.name?.toLowerCase() ?? 'unknown',
    };
  });

  return lines.filter((line): line is GameLine => line !== null);
}

function pickBook(items: NonNullable<CoreOddsResponse['items']>) {
  for (const preferred of BOOK_PRIORITY) {
    const match = items.find((item) => item.provider?.name?.toLowerCase() === preferred);
    if (match && (match.spread !== undefined || match.overUnder !== undefined)) return match;
  }
  return items.find((item) => item.spread !== undefined || item.overUnder !== undefined) ?? items[0];
}

function numberOrNull(value: number | undefined | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Index game lines by team so the projection pipeline can look up a player's
 * market context from his team abbreviation alone.
 */
export interface TeamMarketContext {
  team: string;
  opponent: string;
  impliedPoints: number | null;
  /** This team's own spread (negative = favored). */
  spread: number | null;
  total: number | null;
  isHome: boolean;
  kickoff: Date | null;
}

export function indexByTeam(lines: GameLine[]): Map<string, TeamMarketContext> {
  const index = new Map<string, TeamMarketContext>();

  for (const line of lines) {
    index.set(line.homeTeam, {
      team: line.homeTeam,
      opponent: line.awayTeam,
      impliedPoints: line.impliedHomePts,
      spread: line.spread,
      total: line.total,
      isHome: true,
      kickoff: line.kickoff,
    });

    index.set(line.awayTeam, {
      team: line.awayTeam,
      opponent: line.homeTeam,
      impliedPoints: line.impliedAwayPts,
      // Away spread is the mirror of the home spread.
      spread: line.spread === null ? null : -line.spread,
      total: line.total,
      isHome: false,
      kickoff: line.kickoff,
    });
  }

  return index;
}
