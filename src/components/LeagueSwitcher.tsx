'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Sheet } from '@/components/Sheet';
import { NavProgress } from '@/components/NavProgress';

/**
 * Switching leagues, on every screen size.
 *
 * This used to be a row of pills marked `hidden md:flex`, which meant a phone
 * could not change league at all — the whole app was pinned to whichever
 * league the server picked first. The pills survive on desktop, where showing
 * every league at once costs nothing and one click beats two. Below `md` the
 * same data is presented as a sheet.
 *
 * Which of the two it draws is the caller's choice rather than a media query
 * inside here, because `AppHeader` already maintains separate phone and
 * desktop rows — deciding twice would put two copies of every control in the
 * document and leave the hidden one holding its own live state.
 *
 * Navigation keeps the current pathname, so switching league on the waiver
 * board lands on the waiver board rather than bouncing to the dashboard.
 */

export interface SwitchableLeague {
  id: string;
  name: string;
  season: string;
  isDynasty: boolean;
  totalRosters: number;
}

export function LeagueSwitcher({
  leagues,
  activeId,
  week,
  variant,
}: {
  leagues: SwitchableLeague[];
  activeId?: string | null;
  week?: number;
  /** 'pills' shows every league inline; 'button' opens the sheet. */
  variant: 'pills' | 'button';
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  const active = leagues.find((league) => league.id === activeId) ?? leagues[0];

  const hrefFor = (id: string) => {
    const query = new URLSearchParams();
    query.set('league', id);
    // The draft board has no concept of a week; adding one would be noise in
    // a URL that is meant to be shareable.
    if (week) query.set('week', String(week));
    return `${pathname}?${query.toString()}`;
  };

  if (leagues.length === 0 || !active) return null;

  // Dismiss first, navigate second: these pages are `force-dynamic`, so the
  // push is a server round trip, and a sheet that hangs around during it reads
  // as an unresponsive tap. `NavProgress` carries the wait instead.
  const select = (id: string) => {
    setOpen(false);
    if (id === active.id) return;
    startTransition(() => router.push(hrefFor(id)));
  };

  if (variant === 'pills') {
    return (
      <div className="flex items-center gap-2 max-w-[46vw] overflow-x-auto no-scrollbar">
        {leagues.map((league) => (
          <Link
            key={league.id}
            href={hrefFor(league.id)}
            aria-current={league.id === active.id ? 'true' : undefined}
            className={`shrink-0 px-3 py-1.5 border text-[11px] transition-colors ${
              league.id === active.id
                ? 'border-signal/40 bg-signal/10 text-signal'
                : 'border-rule text-text-dim hover:border-rule-bright hover:text-text'
            }`}
          >
            {league.name}
            <span className="num ml-2 text-[9px] opacity-60">{league.isDynasty ? 'DYN' : 'RED'}</span>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <>
      {/* One control, 44pt tall, opening the sheet. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={leagues.length === 1}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="chrome press flex items-center gap-2 min-h-[44px] min-w-0 flex-1
          px-3 border border-rule bg-ink-card text-left disabled:opacity-100"
      >
        <span className="min-w-0 flex-1">
          <span className="eyebrow block leading-none mb-1">League</span>
          <span className="block text-[13px] truncate leading-none">{active.name}</span>
        </span>
        <span className="num text-[9px] px-1 py-0.5 border border-rule-bright text-text-faint shrink-0">
          {active.isDynasty ? 'DYN' : 'RED'}
        </span>
        {leagues.length > 1 ? <Chevron /> : null}
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Switch league"
        subtitle={`${leagues.length} tracked`}
      >
        <ul>
          {leagues.map((league) => {
            const isActive = league.id === active.id;
            return (
              <li key={league.id}>
                <button
                  type="button"
                  onClick={() => select(league.id)}
                  aria-current={isActive ? 'true' : undefined}
                  className="press-row w-full min-h-[60px] px-4 py-3 flex items-center gap-3 text-left
                    border-b border-rule/60 transition-colors"
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-[14px] truncate ${isActive ? 'text-signal' : 'text-text'}`}
                    >
                      {league.name}
                    </span>
                    <span className="num text-[10px] text-text-faint">
                      {league.season} · {league.totalRosters}-team · {league.isDynasty ? 'dynasty' : 'redraft'}
                    </span>
                  </span>
                  {isActive ? <Check /> : <span className="w-4 shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>

      <NavProgress active={pending} />
    </>
  );
}

function Chevron() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-text-faint shrink-0"
      aria-hidden="true"
    >
      <path d="m7 9 5-5 5 5M7 15l5 5 5-5" />
    </svg>
  );
}

function Check() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-signal)"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="m20 6-11 11-5-5" />
    </svg>
  );
}
