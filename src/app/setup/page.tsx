import Link from 'next/link';
import { listLeagues } from '@/lib/data/dashboard';
import { SetupFlow } from '@/components/SetupFlow';
import { Nav } from '@/components/Nav';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const tracked = await listLeagues();

  return (
    <main className="min-h-screen">
      <header className="border-b border-rule">
        <div className="max-w-[900px] mx-auto px-6 py-4 flex items-end justify-between gap-6 flex-wrap">
          <div className="flex items-end gap-5">
            <div>
              <div className="eyebrow mb-1">Setup</div>
              <h1 className="font-display text-[2rem] leading-none tracking-tight">
                Import <em className="text-signal not-italic">Leagues</em>
              </h1>
            </div>
            {tracked.length > 0 ? (
              <>
                <div className="h-9 w-px bg-rule hidden md:block" />
                <Nav active="/setup" leagueId={tracked[0].id} week={1} />
              </>
            ) : null}
          </div>
          {tracked.length > 0 ? (
            <Link
              href="/"
              className="px-3 py-1.5 border border-signal/40 bg-signal/10 text-signal text-[11px] transition-colors hover:bg-signal/20"
            >
              Go to dashboard →
            </Link>
          ) : null}
        </div>
      </header>

      <div className="max-w-[900px] mx-auto px-6 py-6">
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
