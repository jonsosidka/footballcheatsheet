/**
 * Draft pick inventory and pricing.
 *
 * In dynasty, picks are half the currency of a trade: a contender pays for a
 * veteran with a future first, a rebuilder sells a 29-year-old for two seconds.
 * A trade engine that only sees players can't propose either move, and grades
 * any deal involving a pick as if the pick were free.
 *
 * Ownership comes from Sleeper, which only reports picks that have CHANGED
 * hands. Everything else is implied: every roster starts out owning its own
 * pick in every round of every tradeable season. So the inventory is that
 * default grid with the traded entries overlaid on top.
 */

export interface TradedPick {
  season: number;
  round: number;
  /** The roster the pick originally belonged to — whose record sets its slot. */
  originalRosterId: number;
  /** The roster that owns it now. */
  ownerRosterId: number;
}

export interface OwnedPick {
  season: number;
  round: number;
  originalRosterId: number;
  ownerRosterId: number;
}

/**
 * Which rookie drafts still have tradeable picks. Once a league's draft for
 * the current season is done, the next one up is next season's; Sleeper lets
 * managers trade three drafts out by default.
 */
export function pickSeasons(params: {
  season: number;
  /** Sleeper league status: pre_draft | drafting | in_season | complete. */
  status: string | null;
  traded: TradedPick[];
  horizon?: number;
}): number[] {
  const draftPending = params.status === 'pre_draft' || params.status === 'drafting';
  const first = draftPending ? params.season : params.season + 1;
  const horizon = params.horizon ?? 3;

  const seasons = new Set<number>();
  for (let i = 0; i < horizon; i++) seasons.add(first + i);
  // A league can allow trading further out than the default; whatever Sleeper
  // reports as traded is by definition tradeable.
  for (const pick of params.traded) if (pick.season >= first) seasons.add(pick.season);
  return [...seasons].sort((a, b) => a - b);
}

export function buildPickInventory(params: {
  rosterIds: number[];
  seasons: number[];
  rounds: number;
  traded: TradedPick[];
}): OwnedPick[] {
  const seasons = new Set(params.seasons);
  const rosterIds = new Set(params.rosterIds);
  const key = (season: number, round: number, original: number) => `${season}:${round}:${original}`;

  const grid = new Map<string, OwnedPick>();
  for (const season of seasons) {
    for (let round = 1; round <= params.rounds; round++) {
      for (const rosterId of rosterIds) {
        grid.set(key(season, round, rosterId), { season, round, originalRosterId: rosterId, ownerRosterId: rosterId });
      }
    }
  }

  for (const pick of params.traded) {
    if (!seasons.has(pick.season)) continue;
    // Ignore entries pointing at rosters that no longer exist (league shrank).
    if (!rosterIds.has(pick.originalRosterId) || !rosterIds.has(pick.ownerRosterId)) continue;
    grid.set(key(pick.season, pick.round, pick.originalRosterId), { ...pick });
  }

  return [...grid.values()].sort(
    (a, b) => a.season - b.season || a.round - b.round || a.originalRosterId - b.originalRosterId,
  );
}

// ---------------------------------------------------------------------------
// Slot projection
// ---------------------------------------------------------------------------

export interface StandingsRow {
  rosterId: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

/**
 * Projected rookie-draft slot for each roster's own pick in the NEXT draft,
 * 1 = first overall. Reverse of the standings, which is how nearly every
 * dynasty league orders its rookie draft. Before anyone has played there is
 * nothing to project from, so the result is empty and picks price as "mid".
 */
export function projectDraftSlots(standings: StandingsRow[]): Map<number, number> {
  const played = standings.some((s) => s.wins + s.losses + s.ties > 0);
  if (!played) return new Map();

  const winPct = (s: StandingsRow) => {
    const games = s.wins + s.losses + s.ties;
    return games > 0 ? (s.wins + s.ties / 2) / games : 0;
  };
  const ordered = [...standings].sort((a, b) => winPct(a) - winPct(b) || a.pointsFor - b.pointsFor);
  return new Map(ordered.map((s, i) => [s.rosterId, i + 1]));
}

export type PickTier = 'early' | 'mid' | 'late';

export function tierOfSlot(slot: number, numTeams: number): PickTier {
  const third = numTeams / 3;
  if (slot <= third) return 'early';
  if (slot > numTeams - third) return 'late';
  return 'mid';
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export interface PickMarketRow {
  label: string;
  value: number;
}

export interface ParsedPickLabel {
  season: number | null;
  round: number | null;
  slot: number | null;
  tier: PickTier | null;
}

/**
 * FantasyCalc names picks a few ways depending on how close the draft is:
 *   "2026 Pick 1.01"       exact slot, once the order is effectively known
 *   "2027 Early 1st"       round with a tier
 *   "2027 1st (Early)"     same, other spelling
 *   "2028 1st"             round only
 * Parse each piece independently so a new spelling degrades rather than drops.
 */
export function parsePickLabel(label: string): ParsedPickLabel {
  const season = label.match(/\b(20\d{2})\b/);
  const exact = label.match(/\b(\d{1,2})\.(\d{1,2})\b/);
  const ordinal = label.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/i);
  const tier = label.match(/\b(early|mid|middle|late)\b/i);

  return {
    season: season ? Number(season[1]) : null,
    round: exact ? Number(exact[1]) : ordinal ? Number(ordinal[1]) : null,
    slot: exact ? Number(exact[2]) : null,
    tier: tier ? (tier[1].toLowerCase().startsWith('mid') ? 'mid' : (tier[1].toLowerCase() as PickTier)) : null,
  };
}

type ParsedRow = ParsedPickLabel & { season: number; round: number; value: number };

export interface PickPricer {
  /** Market value of one pick; 0 when the market has nothing for that round. */
  price(pick: { season: number; round: number; slot: number | null }): number;
}

/**
 * Build a pricer over one league shape's pick values.
 *
 * The market never quotes every pick we own — exact slots exist only for the
 * next draft, tiers only a year or two out, and nothing past the third round
 * in shallow formats. So the lookup is a fallback chain, from most to least
 * specific, and a season beyond the quoted range borrows the furthest quote
 * for that round (the market already discounts distant picks to roughly flat).
 */
export function createPickPricer(rows: PickMarketRow[], numTeams: number): PickPricer {
  const parsed: ParsedRow[] = [];
  for (const row of rows) {
    const p = parsePickLabel(row.label);
    if (p.season === null || p.round === null || !(row.value > 0)) continue;
    parsed.push({ ...p, season: p.season, round: p.round, value: row.value });
  }

  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

  const priceIn = (candidates: ParsedRow[], slot: number | null): number => {
    const tier = slot !== null ? tierOfSlot(slot, numTeams) : 'mid';

    const slotted = candidates.filter((r) => r.slot !== null);
    if (slot !== null && slotted.length > 0) {
      return slotted.reduce((best, r) => (Math.abs(r.slot! - slot) < Math.abs(best.slot! - slot) ? r : best)).value;
    }

    const tiered = candidates.filter((r) => r.slot === null && r.tier !== null);
    const sameTier = tiered.filter((r) => r.tier === tier);
    if (sameTier.length > 0) return mean(sameTier.map((r) => r.value));

    const generic = candidates.filter((r) => r.slot === null && r.tier === null);
    if (generic.length > 0) return mean(generic.map((r) => r.value));

    // Only tiers that don't match (e.g. no "mid" quoted): their middle.
    if (tiered.length > 0) return mean(tiered.map((r) => r.value));
    // Only exact slots and no projection: the round's average.
    return mean(slotted.map((r) => r.value));
  };

  return {
    price({ season, round, slot }) {
      const sameRound = parsed.filter((r) => r.round === round);
      if (sameRound.length === 0) return 0;

      let candidates = sameRound.filter((r) => r.season === season);
      if (candidates.length === 0) {
        const seasons = [...new Set(sameRound.map((r) => r.season))];
        const nearest = seasons.reduce((best, s) => (Math.abs(s - season) < Math.abs(best - season) ? s : best));
        candidates = sameRound.filter((r) => r.season === nearest);
      }
      return Math.round(priceIn(candidates, slot));
    },
  };
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
}

/** "2027 1st", or "2027 Early 1st" when the slot is projected. */
export function pickName(pick: { season: number; round: number }, tier: PickTier | null): string {
  const t = tier ? `${tier[0].toUpperCase()}${tier.slice(1)} ` : '';
  return `${pick.season} ${t}${ordinal(pick.round)}`;
}

export function pickId(pick: { season: number; round: number; originalRosterId: number }): string {
  return `pick:${pick.season}:${pick.round}:${pick.originalRosterId}`;
}
