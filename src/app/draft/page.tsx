import Link from 'next/link';
import { getDraftView } from '@/lib/data/draft';
import { listLeagues } from '@/lib/data/dashboard';
import { Nav } from '@/components/Nav';
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
  searchParams: Promise<{ league?: string; draft?: string; slot?: string }>;
}) {
  const params = await searchParams;
  const slot = Number(params.slot);

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
      <main className="min-h-screen">
        <Header leagues={leagues} activeLeagueId={params.league} title="Draft" subtitle="no draft found" />
        <div className="max-w-[1440px] mx-auto px-6 py-16">
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
    <main className="min-h-screen">
      <Header
        leagues={leagues}
        activeLeagueId={view.leagueId ?? params.league}
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
  title,
  subtitle,
}: {
  leagues: Array<{ id: string; name: string }>;
  activeLeagueId?: string | null;
  title: string;
  subtitle: string;
}) {
  return (
    <header className="border-b border-rule">
      <div className="max-w-[1440px] mx-auto px-6 py-4 flex items-end justify-between gap-8 flex-wrap">
        <div className="flex items-end gap-5">
          <div>
            <div className="eyebrow mb-1">{subtitle}</div>
            <h1 className="font-display text-[2rem] leading-none tracking-tight">
              Draft <em className="text-signal not-italic">/</em> {title}
            </h1>
          </div>
          <div className="h-9 w-px bg-rule hidden md:block" />
          <Nav active="/draft" leagueId={activeLeagueId ?? undefined} />
        </div>

        <div className="flex items-center gap-2">
          {leagues.map((league) => (
            <Link
              key={league.id}
              href={`/draft?league=${league.id}`}
              className={`px-3 py-1.5 border text-[11px] transition-colors ${
                league.id === activeLeagueId
                  ? 'border-signal/40 bg-signal/10 text-signal'
                  : 'border-rule text-text-dim hover:border-rule-bright hover:text-text'
              }`}
            >
              {league.name}
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}
