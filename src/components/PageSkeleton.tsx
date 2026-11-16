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
 * render, so without a `loading.tsx` a tap did nothing at all until the server
 * finished — seven seconds on Trades. This is prefetched with the link, so the
 * route changes on tap: same header and tab bar in place, the progress bar
 * sweeping, grey blocks where the panels will land.
 *
 * It renders the header's shape rather than `AppHeader` itself, because the
 * league switcher and week picker need data the server has not loaded yet.
 * The nav links still carry the league and week from the URL, so tapping on
 * to another tab mid-load does not drop them.
 */
export function PageSkeleton({
  eyebrow,
  title,
  active,
  width = 'max-w-[1440px]',
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  /** Route being loaded, for marking the active tab. */
  active: string;
  width?: string;
  /** The page body's shape. Defaults to a strip and two panels. */
  children?: ReactNode;
}) {
  return (
    <main className="min-h-dvh pb-tabbar" aria-busy="true">
      <header
        className="sticky top-0 z-30 border-b border-rule bg-ink/80 backdrop-blur-xl
          backdrop-saturate-150 pt-safe px-safe"
      >
        <div className="md:hidden px-4 pt-2.5 pb-3 space-y-2.5">
          <div className="eyebrow mb-1 truncate">{eyebrow}</div>
          <h1 className="font-display text-[1.5rem] leading-none tracking-tight truncate">{title}</h1>
          <Block className="h-9 w-full" />
        </div>

        <div className={`hidden md:flex ${width} mx-auto px-6 py-4 items-end gap-5`}>
          <div>
            <div className="eyebrow mb-1">{eyebrow}</div>
            <h1 className="font-display text-[2rem] leading-none tracking-tight">{title}</h1>
          </div>
          <div className="h-9 w-px bg-rule" />
          <Suspense fallback={<Nav active={active} />}>
            <CarriedNav active={active} />
          </Suspense>
        </div>

        <NavProgress active />
      </header>

      <div className={`${width} mx-auto px-4 sm:px-6 py-4 sm:py-6`}>{children ?? <DefaultBody />}</div>

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

/** A grey placeholder block, breathing slowly. */
export function Block({ className = '' }: { className?: string }) {
  return <div className={`bg-ink-hover pulse ${className}`} />;
}

/** A panel's frame with placeholder rows, matching `Panel`. */
export function PanelSkeleton({ rows = 6, className = '' }: { rows?: number; className?: string }) {
  return (
    <section className={`bg-ink-card border border-rule ${className}`}>
      <div className="px-4 py-3 border-b border-rule">
        <Block className="h-2.5 w-32" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="px-4 py-3.5 border-b border-rule/60 last:border-0 flex items-center gap-3">
          <Block className="h-3 w-8" />
          <Block className="h-3 flex-1 max-w-[220px]" />
          <Block className="h-3 w-12 ml-auto" />
        </div>
      ))}
    </section>
  );
}

function DefaultBody() {
  return (
    <>
      <div className="flex flex-wrap gap-6 mb-4 sm:mb-5 pb-4 sm:pb-5 border-b border-rule">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-1.5">
            <Block className="h-2 w-16" />
            <Block className="h-4 w-20" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[1.65fr_1fr] gap-3 sm:gap-4 items-start">
        <PanelSkeleton rows={8} />
        <PanelSkeleton rows={5} />
      </div>
    </>
  );
}
