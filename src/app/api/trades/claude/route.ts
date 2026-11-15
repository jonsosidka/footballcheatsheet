import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { loadTradeContext } from '@/lib/data/trades';
import { evaluateTrade } from '@/lib/engine/trades';
import { MODELS, claudeConfigured, getClaude, recordUsage, reserveCall } from '@/lib/ai/claude';
import { leagueFacts, systemPrompt, tradeUserPrompt, type TradeAiKind } from '@/lib/ai/tradePrompt';

export const dynamic = 'force-dynamic';
// Opus thinks before it writes; a trade read can take tens of seconds.
export const maxDuration = 60;

interface Body {
  leagueId: string;
  week: number;
  partnerRosterId: number;
  giveIds: string[];
  wantIds: string[];
  kind: TradeAiKind;
}

function parseBody(raw: unknown): Body | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const ids = (v: unknown) =>
    Array.isArray(v) && v.length > 0 && v.length <= 12 && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
  const giveIds = ids(b.giveIds);
  const wantIds = ids(b.wantIds);
  if (
    typeof b.leagueId !== 'string' ||
    typeof b.week !== 'number' ||
    typeof b.partnerRosterId !== 'number' ||
    (b.kind !== 'analysis' && b.kind !== 'pitch') ||
    !giveIds ||
    !wantIds
  ) {
    return null;
  }
  return { leagueId: b.leagueId, week: b.week, partnerRosterId: b.partnerRosterId, giveIds, wantIds, kind: b.kind };
}

/**
 * Claude's read on one trade, streamed as plain text.
 *
 * The client sends only ids. The trade is re-scored here from freshly loaded
 * rosters, so the numbers in the prompt are the engine's and not whatever a
 * request body claims — and a player who moved since the page rendered drops
 * out instead of being analyzed on the wrong team.
 */
export async function POST(request: Request) {
  if (!claudeConfigured()) {
    return NextResponse.json({ error: 'Claude is not set up. Add ANTHROPIC_API_KEY to the environment.' }, { status: 503 });
  }

  const body = parseBody(await request.json().catch(() => null));
  if (!body) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });

  const ctx = await loadTradeContext(body.leagueId, body.week);
  if (!ctx) return NextResponse.json({ error: 'League is not tracked.' }, { status: 404 });

  const partner = ctx.rivals.find((t) => t.rosterId === body.partnerRosterId);
  if (!partner) return NextResponse.json({ error: 'That team is not in this league.' }, { status: 404 });

  const mine = new Map(ctx.me.players.map((p) => [p.playerId, p]));
  const theirs = new Map(partner.players.map((p) => [p.playerId, p]));
  const gives = body.giveIds.map((id) => mine.get(id)).filter((p) => p !== undefined);
  const gets = body.wantIds.map((id) => theirs.get(id)).filter((p) => p !== undefined);
  if (gives.length === 0 || gets.length === 0) {
    return NextResponse.json({ error: 'Those players are no longer on these rosters. Refresh and rebuild the trade.' }, { status: 409 });
  }

  const offer = evaluateTrade(ctx.me, partner, gives, gets, ctx.league.isDynasty);

  const reservation = await reserveCall();
  if (!reservation.ok) return NextResponse.json({ error: reservation.message }, { status: 429 });

  const { league } = ctx;
  const facts = leagueFacts(league, body.week);

  const model = MODELS[body.kind];
  const system = systemPrompt(body.kind);
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: tradeUserPrompt({ kind: body.kind, league: facts, me: ctx.me, partner, offer }) },
  ];

  const claude = getClaude();
  const stream =
    body.kind === 'analysis'
      ? // Server-side fallback: if Opus's safety classifier declines (unlikely
        // for fantasy football, but possible), the API reruns on a fallback
        // model inside the same call instead of returning nothing.
        claude.beta.messages.stream({
          model,
          max_tokens: 8000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'medium' },
          cache_control: { type: 'ephemeral' },
          system,
          messages,
        })
      : claude.messages.stream({
          model,
          max_tokens: 2000,
          output_config: { effort: 'low' },
          system,
          messages,
        });

  const encoder = new TextEncoder();
  const body$ = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === 'refusal') {
          controller.enqueue(encoder.encode('\n\nClaude declined to answer this one.'));
        } else if (final.stop_reason === 'max_tokens') {
          controller.enqueue(encoder.encode('\n\n(Cut off — try again.)'));
        }
        await recordUsage(final.model, final.usage);
      } catch (error) {
        console.error('claude trade stream failed', error);
        const message =
          error instanceof Anthropic.RateLimitError
            ? 'Claude is rate limited right now. Try again in a minute.'
            : error instanceof Anthropic.AuthenticationError
              ? 'The Anthropic API key was rejected.'
              : error instanceof Anthropic.APIError
                ? `Claude returned an error (${error.status ?? 'network'}).`
                : 'Lost the connection to Claude.';
        controller.enqueue(encoder.encode(`\n\n${message}`));
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(body$, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Claude-Model': model,
    },
  });
}
