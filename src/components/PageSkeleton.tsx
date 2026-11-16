'use client';

import { Suspense, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { Nav } from '@/components/Nav';
import { TabBar } from '@/components/TabBar';
import { NavProgress } from '@/components/NavProgress';

/**
 * What a route shows the instant you tap into it, while the server builds the
 * real page.
 *
 * Every page here is `force-dynamic` and reads the database before it can
 * render, so without a `loading.tsx` a tap did nothing until the server
 * finished. This is prefetched with the link, so the route changes on tap:
 * the header and tab bar in place, the progress bar sweeping, the page's own
 * headline already set, and blocks where the sections will land.
 *
 * It renders the header's shape rather than `AppHeader` itself, because the
 * league switcher and week picker need data the server has not loaded yet.
 * The nav links still carry the league and week from the URL, so tapping on
 * to another tab mid-load does not drop them.
 */
export function PageSkeleton({
  kicker,
  title,
  active,
  children,
}: {
  kicker: string;
  /** The page's headline, drawn for real so the page reads at once. */
  title: ReactNode;
  /** Route being loaded, for marking the active tab. */
  active: string;
  /** The page body's shape. Defaults to a main column and a sidebar. */
  children?: ReactNode;
}) {
  return (
    <main className="min-h-dvh pb-tabbar" aria-busy="true">
      <div className="h-[30px] bg-accent" aria-hidden="true" />
      <header className="sticky top-0 z-30 bg-ink border-b border-rule pt-safe px-safe relative">
        <div className="shell py-3 md:py-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <span className="display text-[26px] md:text-[30px] tracking-[-0.035em] leading-[0.9]">
            CHEATSHEET<sup className="text-[12px] font-bold align-top tracking-normal">®</sup>
          </span>
          <Suspense fallback={<Nav active={active} />}>
            <CarriedNav active={active} />
          </Suspense>
          <Block className="h-10 w-[200px] hidden md:block" />
          <Block className="h-11 w-full md:hidden" />
        </div>
        <NavProgress active />
      </header>

      <div className="shell">
        <section className="py-7 sm:py-9 border-b border-rule">
          <div className="eyebrow mb-4">{kicker}</div>
          <h1 className="display text-[clamp(2.75rem,8.5vw,4.75rem)]">{title}</h1>
        </section>
        <div className="py-6">{children ?? <DefaultBody />}</div>
      </div>

      <Suspense fallback={<TabBar />}>
        <CarriedTabBar />
      </Suspense>
    </main>
  );
}

function useCarried() {
  const params = useSearchParams();
  const week = Number(params.get('week')) || undefined;
  return { leagueId: params.get('league') ?? undefined, week };
}

function CarriedNav({ active }: { active: string }) {
  const { leagueId, week } = useCarried();
  return <Nav active={active} leagueId={leagueId} week={week} />;
}

function CarriedTabBar() {
  const { leagueId, week } = useCarried();
  return <TabBar leagueId={leagueId} week={week} />;
}

/** A placeholder block, breathing slowly. */
export function Block({ className = '' }: { className?: string }) {
  return <div className={`bg-ink-hover pulse ${className}`} />;
}

/** A panel's frame with placeholder rows, matching `Panel`. */
export function PanelSkeleton({ rows = 6, className = '' }: { rows?: number; className?: string }) {
  return (
    <section className={`border border-rule ${className}`}>
      <div className="px-4 py-3.5 border-b border-rule">
        <Block className="h-3 w-40" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="px-4 py-3.5 border-b border-rule last:border-0 flex items-center gap-3">
          <Block className="h-4 w-8" />
          <Block className="h-4 flex-1 max-w-[260px]" />
          <Block className="h-5 w-12 ml-auto" />
        </div>
      ))}
    </section>
  );
}

function DefaultBody() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1.65fr_1fr] gap-4 items-start">
      <PanelSkeleton rows={8} />
      <PanelSkeleton rows={5} />
    </div>
  );
}
