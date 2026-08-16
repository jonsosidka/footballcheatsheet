import { fetchJson } from './http';

/**
 * FantasyCalc dynasty and redraft market values.
 *
 * Chosen over KeepTradeCut and similar because it is free, unauthenticated,
 * parameterized by league shape, and — critically — every row carries a
 * `sleeperId`. That means zero name-matching, which is where fantasy tools
 * usually accumulate silent errors (Michael Pittman Jr. vs Michael Pittman,
 * D.J. vs DJ, Jr./Sr. suffixes, defenses).
 *
 * Values differ materially by shape: at numQbs=2 a top QB leaps into the
 * overall top 3, so pulling the wrong shape would systematically misprice
 * every quarterback in a superflex league.
 */

const BASE = 'https://api.fantasycalc.com/values/current';

export interface LeagueShape {
  isDynasty: boolean;
  numQbs: number;
  numTeams: number;
  ppr: number;
}

interface FantasyCalcRow {
  player: {
    id: number;
    name: string;
    sleeperId: string | null;
    position: string;
    maybeAge: number | null;
    maybeTeam: string | null;
    maybeYoe: number | null;
  };
  value: number;
  overallRank: number;
  positionRank: number;
  trend30Day: number;
  redraftValue: number;
  maybeTier: number | null;
}

export interface PlayerValue {
  sleeperId: string;
  name: string;
  position: string;
  age: number | null;
  dynastyValue: number;
  redraftValue: number;
  overallRank: number;
  positionRank: number;
  trend30Day: number;
  tier: number | null;
}

export interface PickValue {
  label: string;
  season: number | null;
  round: number | null;
  slot: number | null;
  value: number;
}

/** Stable key so values from different league shapes never get mixed up. */
export function shapeKey(shape: LeagueShape): string {
  const format = shape.isDynasty ? 'dyn' : 'red';
  return `${format}-${shape.numQbs}qb-${shape.numTeams}tm-${shape.ppr}ppr`;
}

export async function getValues(
  shape: LeagueShape,
): Promise<{ players: PlayerValue[]; picks: PickValue[] }> {
  const query = new URLSearchParams({
    isDynasty: String(shape.isDynasty),
    numQbs: String(shape.numQbs),
    numTeams: String(shape.numTeams),
    ppr: String(shape.ppr),
  });

  const rows = (await fetchJson<FantasyCalcRow[]>(`${BASE}?${query.toString()}`)) ?? [];

  const players: PlayerValue[] = [];
  const picks: PickValue[] = [];

  for (const row of rows) {
    if (row.player.position === 'PICK') {
      picks.push({ label: row.player.name, ...parsePickLabel(row.player.name), value: row.value });
      continue;
    }

    // No sleeperId means we can't join it to anything; skip rather than guess.
    if (!row.player.sleeperId) continue;

    players.push({
      sleeperId: row.player.sleeperId,
      name: row.player.name,
      position: row.player.position,
      age: row.player.maybeAge,
      dynastyValue: row.value,
      redraftValue: row.redraftValue,
      overallRank: row.overallRank,
      positionRank: row.positionRank,
      trend30Day: row.trend30Day,
      tier: row.maybeTier,
    });
  }

  return { players, picks };
}

/**
 * FantasyCalc labels picks two ways:
 *   "2026 Pick 1.01"     -> exact slot
 *   "2027 1st (Early)"   -> round with a tier hint, no slot
 */
export function parsePickLabel(label: string): { season: number | null; round: number | null; slot: number | null } {
  const exact = label.match(/^(\d{4})\s+Pick\s+(\d+)\.(\d+)$/i);
  if (exact) {
    return { season: Number(exact[1]), round: Number(exact[2]), slot: Number(exact[3]) };
  }

  const rounded = label.match(/^(\d{4})\s+(\d)(?:st|nd|rd|th)/i);
  if (rounded) {
    return { season: Number(rounded[1]), round: Number(rounded[2]), slot: null };
  }

  return { season: null, round: null, slot: null };
}

/**
 * Derive the FantasyCalc shape from a Sleeper league. `ppr` is taken from the
 * league's actual reception value, rounded to the nearest supported shape.
 */
export function shapeFromLeague(params: {
  isDynasty: boolean;
  isSuperflex: boolean;
  totalRosters: number;
  pprType: number;
}): LeagueShape {
  return {
    isDynasty: params.isDynasty,
    numQbs: params.isSuperflex ? 2 : 1,
    // FantasyCalc supports common league sizes; clamp to its range.
    numTeams: Math.min(16, Math.max(8, params.totalRosters)),
    ppr: params.pprType >= 0.75 ? 1 : params.pprType >= 0.25 ? 0.5 : 0,
  };
}
