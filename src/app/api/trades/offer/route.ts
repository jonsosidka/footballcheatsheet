import { NextResponse } from 'next/server';
import { loadTradeContext } from '@/lib/data/trades';
import { suggestOffers } from '@/lib/engine/trades';
import { claudeConfigured, reserveCall } from '@/lib/ai/claude';
import { structuredResponse } from '@/lib/ai/structured';
import { leagueFacts } from '@/lib/ai/tradePrompt';
import { OFFER_SCHEMA, OFFER_SYSTEM, checkPackages, offerUserPrompt, type OfferAsk } from '@/lib/ai/offers';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const isIds = (v: unknown, max: number): v is string[] =>
  Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string');

/**
 * Claude's offers for a hand-built ask. Same inputs as the builder's
 * "Suggest what to offer"; runs alongside the engine's instant answer.
 * See structuredResponse for the wire format.
 */
export async function POST(request: Request) {
  if (!claudeConfigured()) {
    return NextResponse.json({ error: 'Claude is not set up. Add ANTHROPIC_API_KEY to the environment.' }, { status: 503 });
  }

  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !b ||
    typeof b.leagueId !== 'string' ||
    typeof b.week !== 'number' ||
    typeof b.partnerRosterId !== 'number' ||
    !isIds(b.wantIds, 12) ||
    !isIds(b.giveIds, 12) ||
    !isIds(b.untouchableIds, 60) ||
    b.wantIds.length === 0
  ) {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  const { wantIds, giveIds, untouchableIds } = b;

  const ctx = await loadTradeContext(b.leagueId, b.week);
  if (!ctx) return NextResponse.json({ error: 'League is not tracked.' }, { status: 404 });
  const partner = ctx.rivals.find((t) => t.rosterId === b.partnerRosterId);
  if (!partner) return NextResponse.json({ error: 'That team is not in this league.' }, { status: 404 });

  const mine = new Map(ctx.me.players.map((p) => [p.playerId, p]));
  const theirs = new Map(partner.players.map((p) => [p.playerId, p]));
  const pick = <T,>(ids: string[], from: Map<string, T>) => ids.map((id) => from.get(id)).filter((p) => p !== undefined);

  const wants = pick(wantIds, theirs);
  if (wants.length === 0) {
    return NextResponse.json({ error: 'Those players are no longer on that roster. Refresh and pick again.' }, { status: 409 });
  }
  const mustGive = pick(giveIds, mine);
  const untouchable = pick(untouchableIds, mine);

  const reservation = await reserveCall();
  if (!reservation.ok) return NextResponse.json({ error: reservation.message }, { status: 429 });

  const ask: OfferAsk = {
    league: leagueFacts(ctx.league, b.week),
    me: ctx.me,
    partner,
    wants,
    mustGive,
    untouchable,
    candidates: suggestOffers({
      me: ctx.me,
      partner,
      wants,
      mustGive,
      untouchable: new Set(untouchableIds),
      isDynasty: ctx.league.isDynasty,
      limit: 8,
    }),
  };

  return structuredResponse({
    system: OFFER_SYSTEM,
    user: offerUserPrompt(ask),
    schema: OFFER_SCHEMA,
    finish: (parsed) => ({ ok: true, ...checkPackages(parsed, ask) }),
  });
}
