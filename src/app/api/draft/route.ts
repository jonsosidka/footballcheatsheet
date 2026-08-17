import { NextResponse } from 'next/server';
import { getDraftView } from '@/lib/data/draft';

export const dynamic = 'force-dynamic';

/**
 * The live board, as JSON.
 *
 * The draft page polls this every few seconds rather than re-rendering the
 * server component, because during a draft the only thing that changes is the
 * pick list — re-running the whole route to swap two rows would make the page
 * flicker and the scroll position jump at the exact moment you are reading it.
 *
 * Unguarded, like the pages: it reads the same tracked leagues they do and
 * makes two calls to a public Sleeper endpoint.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const slot = Number(params.get('slot'));

  try {
    const view = await getDraftView({
      leagueId: params.get('league') ?? undefined,
      draftId: params.get('draft') ?? undefined,
      slot: Number.isFinite(slot) && slot > 0 ? slot : undefined,
    });

    if (!view) {
      return NextResponse.json({ ok: false, error: 'No draft found for this league.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, view });
  } catch (error) {
    console.error('draft view failed', error);
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
