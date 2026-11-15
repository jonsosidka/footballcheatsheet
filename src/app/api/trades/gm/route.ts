import { NextResponse } from 'next/server';
import { loadTradeContext } from '@/lib/data/trades';
import { getWaiverView } from '@/lib/data/waivers';
import { findTrades } from '@/lib/engine/trades';
import { claudeConfigured, reserveCall } from '@/lib/ai/claude';
import { structuredResponse } from '@/lib/ai/structured';
import { leagueFacts } from '@/lib/ai/tradePrompt';
import { GM_SCHEMA, GM_SYSTEM, checkMoves, gmUserPrompt, type WaiverOption } from '@/lib/ai/gm';

export const dynamic = 'force-dynamic';
// The whole league in one prompt: Opus takes longer here than on one trade.
export const maxDuration = 60;

/** Claude's league-wide suggestions for my team. See structuredResponse for the wire format. */
export async function POST(request: Request) {
  if (!claudeConfigured()) {
    return NextResponse.json({ error: 'Claude is not set up. Add ANTHROPIC_API_KEY to the environment.' }, { status: 503 });
  }

  const raw = (await request.json().catch(() => null)) as { leagueId?: unknown; week?: unknown } | null;
  if (!raw || typeof raw.leagueId !== 'string' || typeof raw.week !== 'number') {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  const { leagueId, week } = raw as { leagueId: string; week: number };

  const [ctx, waiverView] = await Promise.all([
    loadTradeContext(leagueId, week),
    getWaiverView(leagueId, week).catch((error) => {
      // Waivers are context, not the point; suggestions still work without them.
      console.error('gm: waiver view failed', error);
      return null;
    }),
  ]);
  if (!ctx) return NextResponse.json({ error: 'League is not tracked.' }, { status: 404 });

  const reservation = await reserveCall();
  if (!reservation.ok) return NextResponse.json({ error: reservation.message }, { status: 429 });

  const ideas = findTrades({ me: ctx.me, rivals: ctx.rivals, isDynasty: ctx.league.isDynasty, limit: 10 });
  const waivers: WaiverOption[] = (waiverView?.suggestions ?? [])
    .filter((s) => !s.blocked)
    .slice(0, 10)
    .map((s) => ({
      add: {
        playerId: s.add.playerId,
        name: s.add.name,
        position: s.add.position,
        team: s.add.team,
        age: s.add.age,
        rosPoints: s.add.rosPoints,
      },
      drop: s.drop ? { playerId: s.drop.playerId, name: s.drop.name, position: s.drop.position } : null,
      vor: s.vor,
      bid: s.bid?.amount ?? null,
      rationale: s.rationale,
    }));

  const input = {
    league: leagueFacts(ctx.league, week),
    me: ctx.me,
    rivals: ctx.rivals,
    ideas,
    waivers,
    faabRemaining: waiverView?.faabRemaining ?? null,
  };

  return structuredResponse({
    system: GM_SYSTEM,
    user: gmUserPrompt(input),
    schema: GM_SCHEMA,
    finish: (parsed) => ({ ok: true, ...checkMoves(parsed, input) }),
  });
}
