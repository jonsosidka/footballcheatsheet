import { getDraftView } from '@/lib/data/draft';
import Link from 'next/link';
import { listLeagues } from '@/lib/data/dashboard';
import { AppHeader } from '@/components/AppHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { EmptyState } from '@/components/primitives';
import { DraftBoard } from '@/components/DraftBoard';

export const dynamic = 'force-dynamic';

/**
 * The draft room.
 *
 * Rendered once on the server so the first paint is a complete board, then
 * handed to a client component that polls for picks. Everything the page needs
 * to identify the draft lives in the query string — league, an explicit draft
 * id for mocks, and a manual seat override for when Sleeper has not published
 * the draft order yet — so a link to a board is a link to *that* board.
 */
export default async function DraftPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string; draft?: string; slot?: string; week?: string }>;
}) {
  const params = await searchParams;
  const slot = Number(params.slot);
  // The board has no week of its own, but it must not drop the one the rest
  // of the app is on while you pass through it.
  const carriedWeek = Number(params.week) || undefined;

  const [leagues, view] = await Promise.all([
    listLeagues(),
    getDraftView({
      leagueId: params.league,
      draftId: params.draft,
      slot: Number.isFinite(slot) && slot > 0 ? slot : undefined,
    }).catch(() => null),
  ]);

  const query = new URLSearchParams();
  if (params.league) query.set('league', params.league);
  if (params.draft) query.set('draft', params.draft);
  if (params.slot) query.set('slot', params.slot);

  const header = (
    <AppHeader
      active="/draft"
      leagues={leagues}
      activeLeagueId={view?.leagueId ?? params.league}
      carriedWeek={carriedWeek}
      strip={
        view
          ? [`${view.draftName}`, `${view.teams}-team ${view.type}`, `${view.rounds} rounds`, view.status.replace('_', ' ')]
          : ['Draft room', 'No draft found']
      }
    />
  );

  if (!view) {
    return (
      <main className="min-h-dvh pb-tabbar">
        {header}
        <div className="shell">
          <EmptyState
            kicker="[ Draft ] — No draft yet"
            title={
              <>
                No draft.
                <br />
                <span className="outline-text">Yet.</span>
              </>
            }
            action={
              leagues.length === 0 ? (
                <Link href="/setup" className="btn btn-primary">
                  Import from Sleeper →
                </Link>
              ) : null
            }
          >
            <p>
              {leagues.length === 0
                ? 'Import a league in setup first.'
                : 'This league has no draft on Sleeper yet. It shows up here as soon as the commissioner creates one.'}
            </p>
            <p className="mt-3 text-[13px] text-text-faint">
              Following a mock draft? Add <span className="num text-text-dim">?draft=&lt;draft_id&gt;</span> to the
              address — the id is the last part of the Sleeper draft link — and{' '}
              <span className="num text-text-dim">&amp;slot=&lt;n&gt;</span> for your seat.
            </p>
          </EmptyState>
        </div>
        <SiteFooter />
      </main>
    );
  }

  return (
    <main className="min-h-dvh pb-tabbar">
      {header}
      <DraftBoard
        initial={view}
        query={query.toString()}
        kicker={`[ Draft ] — ${view.draftName} — ${view.teams}-team ${view.type} — ${view.rounds} rounds`}
      />
      <SiteFooter />
    </main>
  );
}
