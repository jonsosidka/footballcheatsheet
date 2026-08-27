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
 *
 * `variant` is passed in for the same reason as on the league switcher: the
 * header keeps separate phone and desktop rows, so the control must not also
 * decide for itself and end up in the document twice.
 */

/** Weeks 1-18 of the NFL regular season. */
const LAST_WEEK = 18;

export function WeekPicker({
  week,
  leagueId,
  variant,
}: {
  week: number;
  leagueId?: string | null;
  /** 'compact' is the thumb-sized phone control; 'full' the desktop one. */
  variant: 'compact' | 'full';
}) {
  const compact = variant === 'compact';
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  const hrefFor = (next: number) => {
    const query = new URLSearchParams();
    if (leagueId) query.set('league', leagueId);
    query.set('week', String(next));
    return `${pathname}?${query.toString()}`;
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
      <div className="chrome flex items-stretch border border-rule bg-ink-card shrink-0">
        <Step direction="prev" compact={compact} disabled={week <= 1 || pending} onClick={() => go(week - 1)} />

        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Week ${week}. Change week`}
          className={`press px-3 border-x border-rule flex flex-col items-center justify-center ${
            compact ? 'min-h-[44px]' : 'py-1.5'
          }`}
        >
          {compact ? null : <span className="eyebrow leading-none mb-0.5">Week</span>}
          <span className="num text-[13px] leading-none text-text">
            {compact ? <span className="text-text-faint">WK </span> : null}
            {week}
          </span>
        </button>

        <Step direction="next" compact={compact} disabled={week >= LAST_WEEK || pending} onClick={() => go(week + 1)} />
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
                className={`press min-h-[56px] flex items-center justify-center num text-[15px] transition-colors ${
                  isActive ? 'bg-signal/10 text-signal' : 'bg-ink-card text-text-dim active:bg-ink-hover'
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
            <div key={`filler-${index}`} className="bg-ink-card sm:hidden" aria-hidden="true" />
          ))}
        </div>
      </Sheet>

      <NavProgress active={pending} />
    </>
  );
}

function Step({
  direction,
  compact,
  disabled,
  onClick,
}: {
  direction: 'prev' | 'next';
  compact: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 'prev' ? 'Previous week' : 'Next week'}
      className={`press px-2.5 flex items-center justify-center text-text-dim active:bg-ink-hover
        disabled:opacity-25 disabled:pointer-events-none ${compact ? 'min-h-[44px] min-w-[44px]' : ''}`}
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
