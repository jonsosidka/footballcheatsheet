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

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';

/** ESPN season types: 1 = preseason, 2 = regular, 3 = postseason. */
export const SEASON_TYPE = { pre: 1, regular: 2, post: 3 } as const;

interface ScoreboardResponse {
  season?: { year: number; type: number };
  week?: { number: number };
  events?: Array<{
    id: string;
    date: string;
    competitions: Array<{
      id: string;
      competitors: Array<{
        homeAway: 'home' | 'away';
        team: { abbreviation: string; displayName: string };
      }>;
    }>;
  }>;
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

export async function getWeekGameLines(
  season: string,
  week: number,
  seasonType: number = SEASON_TYPE.regular,
): Promise<GameLine[]> {
  const scoreboard = await fetchJson<ScoreboardResponse>(
    `${SITE}/scoreboard?dates=${season}&seasontype=${seasonType}&week=${week}`,
    { nullOn404: true },
  );

  const events = scoreboard?.events ?? [];
  if (events.length === 0) return [];

  const lines = await mapLimit(events, 4, async (event): Promise<GameLine | null> => {
    const competition = event.competitions?.[0];
    if (!competition) return null;

    const home = competition.competitors.find((c) => c.homeAway === 'home');
    const away = competition.competitors.find((c) => c.homeAway === 'away');
    if (!home || !away) return null;

    const odds = await fetchJson<CoreOddsResponse>(
      `${CORE}/events/${event.id}/competitions/${competition.id}/odds`,
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
      homeTeam: normalizeTeam(home.team.abbreviation),
      awayTeam: normalizeTeam(away.team.abbreviation),
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
