import { getDraftView } from '@/lib/data/draft';
import { listLeagues, type LeagueSummary } from '@/lib/data/dashboard';
import { AppHeader } from '@/components/AppHeader';
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

  if (!view) {
    return (
      <main className="min-h-dvh pb-tabbar">
        <Header
          leagues={leagues}
          activeLeagueId={params.league}
          carriedWeek={carriedWeek}
          title="Draft"
          subtitle="no draft found"
        />
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <p className="text-[13px] text-text-dim mb-3">
            {leagues.length === 0
              ? 'No leagues imported yet — run through setup first.'
              : 'Sleeper has no draft for this league yet.'}
          </p>
          <p className="text-[11.5px] text-text-faint leading-relaxed max-w-xl">
            A draft appears here as soon as the commissioner creates one. To follow a mock draft instead,
            append <span className="num text-text-dim">?draft=&lt;draft_id&gt;</span> — the id is the last
            segment of the Sleeper draft URL — and add{' '}
            <span className="num text-text-dim">&amp;slot=&lt;n&gt;</span> to say which seat is yours.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh pb-tabbar">
      <Header
        leagues={leagues}
        activeLeagueId={view.leagueId ?? params.league}
        carriedWeek={carriedWeek}
        title={view.draftName}
        subtitle={`${view.teams}-team ${view.type} · ${view.rounds} rounds · ${view.status.replace('_', ' ')}`}
      />
      <DraftBoard initial={view} query={query.toString()} />
    </main>
  );
}

function Header({
  leagues,
  activeLeagueId,
  carriedWeek,
  title,
  subtitle,
}: {
  leagues: LeagueSummary[];
  activeLeagueId?: string | null;
  carriedWeek?: number;
  title: string;
  subtitle: string;
}) {
  return (
    <AppHeader
      eyebrow={subtitle}
      title={
        <>
          Draft <em className="text-signal not-italic">/</em> {title}
        </>
      }
      active="/draft"
      leagues={leagues}
      activeLeagueId={activeLeagueId}
      carriedWeek={carriedWeek}
    />
  );
}
