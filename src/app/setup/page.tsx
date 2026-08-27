import Link from 'next/link';
import { listLeagues } from '@/lib/data/dashboard';
import { SetupFlow } from '@/components/SetupFlow';
import { AppHeader } from '@/components/AppHeader';

export const dynamic = 'force-dynamic';

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string; week?: string }>;
}) {
  const params = await searchParams;
  const tracked = await listLeagues();

  /*
   * Setup does not read a league or a week, but the tab bar routes back out
   * through here. Echoing both keeps a trip to this screen from quietly
   * resetting the app to the first league on week 1.
   */
  const carriedLeague = tracked.find((league) => league.id === params.league)?.id ?? tracked[0]?.id;
  const carriedWeek = Number(params.week) || undefined;

  return (
    <main className="min-h-dvh pb-tabbar">
      <AppHeader
        eyebrow="Setup"
        title={
          <>
            Import <em className="text-signal not-italic">Leagues</em>
          </>
        }
        active="/setup"
        // No switcher here: setup ignores ?league, so offering one would be a
        // control that visibly does nothing. The id still rides along so the
        // tab bar carries a league back out to the other routes.
        leagues={[]}
        activeLeagueId={carriedLeague}
        carriedWeek={carriedWeek}
        width="max-w-[900px]"
        actions={
          tracked.length > 0 ? (
            <Link
              href={carriedLeague ? `/?league=${carriedLeague}` : '/'}
              className="press px-3 py-1.5 min-h-[44px] md:min-h-0 inline-flex items-center border border-signal/40 bg-signal/10 text-signal text-[11px] transition-colors hover:bg-signal/20"
            >
              <span className="hidden md:inline">Go to dashboard →</span>
              <span className="md:hidden">Done</span>
            </Link>
          ) : null
        }
      />

      <div className="max-w-[900px] mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {tracked.length > 0 ? (
          <div className="mb-6">
            <h2 className="eyebrow mb-2">Currently tracked</h2>
            <ul className="flex flex-wrap gap-2">
              {tracked.map((league) => (
                <li
                  key={league.id}
                  className="flex items-center gap-2 px-3 py-1.5 border border-rule bg-ink-card text-[12px]"
                >
                  <span>{league.name}</span>
                  <span className="num text-[9px] text-text-faint">
                    {league.isDynasty ? 'DYN' : 'RED'} · {league.totalRosters}T · {league.scoringKeyCount} keys
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mb-6 border border-rule bg-ink-card px-4 py-3">
            <p className="text-[12px] text-text-dim leading-relaxed">
              Nothing imported yet. Enter your Sleeper username below to find your leagues.
            </p>
          </div>
        )}

        <SetupFlow initialUsername={process.env.SLEEPER_USERNAME ?? ''} />
      </div>
    </main>
  );
}
