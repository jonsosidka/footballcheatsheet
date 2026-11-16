import Link from 'next/link';
import { listLeagues } from '@/lib/data/dashboard';
import { SetupFlow } from '@/components/SetupFlow';
import { AppHeader } from '@/components/AppHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { PageHero } from '@/components/primitives';

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
        active="/setup"
        // No switcher here: setup ignores ?league, so offering one would be a
        // control that visibly does nothing. The id still rides along so the
        // tab bar carries a league back out to the other routes.
        leagues={[]}
        activeLeagueId={carriedLeague}
        carriedWeek={carriedWeek}
        strip={['Setup', `${tracked.length} league${tracked.length === 1 ? '' : 's'} tracked`, 'Sleeper import']}
        actions={
          tracked.length > 0 ? (
            <Link href={carriedLeague ? `/?league=${carriedLeague}` : '/'} className="btn btn-primary press">
              <span className="hidden md:inline">Go to My Team →</span>
              <span className="md:hidden">Done</span>
            </Link>
          ) : null
        }
      />

      <div className="shell">
        <PageHero
          kicker="[ Setup ] — Sleeper import"
          title={
            <>
              Bring
              <br />
              <span className="outline-text">your league.</span>
            </>
          }
        >
          <p>
            Enter your Sleeper username, pick the leagues you want advice for, and you&apos;re set. It only reads
            from Sleeper — no password, and nothing on your account changes.
          </p>
        </PageHero>

        <div className="py-6 max-w-[900px]">
          {tracked.length > 0 ? (
            <div className="mb-6">
              <h2 className="eyebrow mb-2">Currently tracked</h2>
              <ul className="flex flex-wrap gap-2">
                {tracked.map((league) => (
                  <li key={league.id} className="flex items-center gap-2.5 px-3 py-2 border border-rule">
                    <span className="font-bold [font-stretch:112%] uppercase text-[13px]">{league.name}</span>
                    <span className="num text-[10px] text-text-faint">
                      {league.isDynasty ? 'DYN' : 'RED'} · {league.totalRosters}T
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <SetupFlow initialUsername={process.env.SLEEPER_USERNAME ?? ''} />
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
