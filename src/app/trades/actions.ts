'use server';

import { loadTradeContext } from '@/lib/data/trades';
import { suggestOffers, evaluateTrade, type TradeOffer } from '@/lib/engine/trades';

export interface BuildTradeInput {
  leagueId: string;
  week: number;
  partnerRosterId: number;
  /** Their players being asked for. */
  wantIds: string[];
  /** Our players: pinned into every suggestion, or the exact package when evaluating. */
  giveIds: string[];
  /** Our players that must not appear in a suggestion. */
  untouchableIds: string[];
  mode: 'suggest' | 'evaluate';
}

export type BuildTradeResult =
  | { ok: true; offers: TradeOffer[] }
  | { ok: false; message: string };

/**
 * Run the trade engine for one hand-built ask.
 *
 * A server action because the engine needs every roster in the league fully
 * scored — the same context the finder builds — and shipping that to the
 * browser would be most of the database. The rosters the builder renders are
 * the light `TradePlayer` shape; the scoring happens here against the real
 * `TradeTeam`s with their postures and needs.
 */
export async function buildTradeAction(input: BuildTradeInput): Promise<BuildTradeResult> {
  try {
    const ctx = await loadTradeContext(input.leagueId, input.week);
    if (!ctx) return { ok: false, message: 'League is not tracked.' };

    const partner = ctx.rivals.find((t) => t.rosterId === input.partnerRosterId);
    if (!partner) return { ok: false, message: 'That team is not in this league.' };

    const theirs = new Map(partner.players.map((p) => [p.playerId, p]));
    const mine = new Map(ctx.me.players.map((p) => [p.playerId, p]));

    // Ids are resolved against the freshly loaded rosters, so a player who has
    // moved since the page rendered simply drops out rather than being scored
    // on the wrong team.
    const wants = input.wantIds.map((id) => theirs.get(id)).filter((p) => p !== undefined);
    const gives = input.giveIds.map((id) => mine.get(id)).filter((p) => p !== undefined);

    if (wants.length === 0) return { ok: false, message: 'Pick at least one player you want.' };

    // The market prices offense; IDP and kickers have no value to trade
    // against, so the search has nothing to anchor a package to.
    if (input.mode === 'suggest' && wants.every((p) => p.dynastyValue <= 0)) {
      return {
        ok: false,
        message: `${wants.map((p) => p.name).join(', ')} ${wants.length === 1 ? 'has' : 'have'} no market value to price a package against — pin what you'd send and use Evaluate instead.`,
      };
    }

    if (input.mode === 'evaluate') {
      if (gives.length === 0) return { ok: false, message: 'Pick what you would send.' };
      return { ok: true, offers: [evaluateTrade(ctx.me, partner, gives, wants, ctx.league.isDynasty)] };
    }

    const offers = suggestOffers({
      me: ctx.me,
      partner,
      wants,
      mustGive: gives,
      untouchable: new Set(input.untouchableIds),
      isDynasty: ctx.league.isDynasty,
      limit: 8,
    });
    return { ok: true, offers };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}
