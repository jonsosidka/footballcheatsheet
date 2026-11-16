'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Sheet } from '@/components/Sheet';
import { NavProgress } from '@/components/NavProgress';

/**
 * Week selection.
 *
 * The `week` search param has always driven the dashboard and the waiver
 * board, but nothing on screen ever set it — you had to type it into the
 * address bar. That is merely inconvenient in a browser and impossible in a
 * home-screen app, which has no address bar at all.
 *
 * The stepper covers the common move (last week, next week) in one tap; the
 * label opens a grid for jumping across the season.
 */

/** Weeks 1-18 of the NFL regular season. */
const LAST_WEEK = 18;

export function WeekPicker({
  week,
  liveWeek,
  leagueId,
}: {
  week: number;
  /** Picking the live week clears the param rather than pinning it. */
  liveWeek?: number;
  leagueId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  const hrefFor = (next: number) => {
    const query = new URLSearchParams();
    if (leagueId) query.set('league', leagueId);
    if (next !== liveWeek) query.set('week', String(next));
    const search = query.toString();
    return search ? `${pathname}?${search}` : pathname;
  };

  // Same contract as the league switcher: close on tap, report the round trip
  // through NavProgress rather than freezing the sheet open.
  const go = (next: number) => {
    if (next < 1 || next > LAST_WEEK) return;
    setOpen(false);
    if (next === week) return;
    startTransition(() => router.push(hrefFor(next)));
  };

  return (
    <>
      <div className="chrome flex items-stretch border border-text bg-ink shrink-0">
        <Step direction="prev" disabled={week <= 1 || pending} onClick={() => go(week - 1)} />

        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Week ${week}. Change week`}
          className="press focus-ring px-3 min-h-[44px] md:min-h-0 border-x border-rule flex items-center justify-center"
        >
          <span className="font-mono text-[11px] tracking-[0.08em] leading-none text-text whitespace-nowrap">
            <span className="text-text-faint">WK </span>
            {week}
          </span>
        </button>

        <Step direction="next" disabled={week >= LAST_WEEK || pending} onClick={() => go(week + 1)} />
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="Jump to week" subtitle="regular season">
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-px bg-rule p-px">
          {Array.from({ length: LAST_WEEK }, (_, index) => index + 1).map((candidate) => {
            const isActive = candidate === week;
            return (
              <button
                key={candidate}
                type="button"
                onClick={() => go(candidate)}
                aria-current={isActive ? 'true' : undefined}
                className={`press min-h-[56px] flex items-center justify-center figure text-[20px] transition-colors ${
                  isActive ? 'bg-accent text-on-accent' : 'bg-ink text-text active:bg-ink-hover hover:bg-ink-hover'
                }`}
              >
                {candidate}
              </button>
            );
          })}
          {/* 18 weeks leaves a ragged last row on the 4-column phone grid, and
              the hairline gap technique would show the rule colour through the
              hole. Fill it with cells that are simply not buttons. */}
          {Array.from({ length: (4 - (LAST_WEEK % 4)) % 4 }, (_, index) => (
            <div key={`filler-${index}`} className="bg-ink sm:hidden" aria-hidden="true" />
          ))}
        </div>
      </Sheet>

      <NavProgress active={pending} />
    </>
  );
}

function Step({
  direction,
  disabled,
  onClick,
}: {
  direction: 'prev' | 'next';
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 'prev' ? 'Previous week' : 'Next week'}
      className="press focus-ring px-2.5 flex items-center justify-center text-text min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-[36px]
        hover:bg-ink-hover active:bg-ink-hover disabled:opacity-25 disabled:pointer-events-none"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={direction === 'prev' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
      </svg>
    </button>
  );
}
