'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ROUTES } from '@/components/Nav';

/**
 * The phone's primary navigation: fixed to the bottom edge where the thumb
 * rests, inset for the home indicator. The numbered labels from the desktop
 * nav stay, the current tab gets a lime bar along its top edge.
 */
export function TabBar({ leagueId, week }: { leagueId?: string | null; week?: number }) {
  const pathname = usePathname();

  const query = new URLSearchParams();
  if (leagueId) query.set('league', leagueId);
  if (week) query.set('week', String(week));
  const suffix = query.toString() ? `?${query.toString()}` : '';

  return (
    <nav
      aria-label="Primary"
      className="chrome md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-rule bg-ink pb-safe"
    >
      <ul className="flex items-stretch">
        {ROUTES.map((route, i) => {
          const active = pathname === route.href;
          return (
            <li key={route.href} className="flex-1 min-w-0">
              <Link
                href={`${route.href}${suffix}`}
                aria-current={active ? 'page' : undefined}
                className={`press flex flex-col items-center justify-center gap-1 h-[56px] no-underline border-t-2 -mt-px
                  ${active ? 'border-signal text-signal' : 'border-transparent text-text-faint'}`}
              >
                <span className="figure text-[15px] leading-none">{String(i + 1).padStart(2, '0')}</span>
                <span className="font-mono text-[9px] font-bold tracking-[0.12em] uppercase leading-none truncate max-w-full px-1">
                  {route.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
