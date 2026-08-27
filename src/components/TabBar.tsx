'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The phone's primary navigation.
 *
 * The header nav is a row of 11px links roughly 26px tall — fine for a cursor,
 * well under the 44pt Apple asks for and impossible to hit reliably with a
 * thumb on a moving train. On phones that row is replaced by this: fixed to
 * the bottom edge where the thumb rests, translucent so content scrolling
 * under it still reads as one surface, and inset for the home indicator.
 *
 * Icons are inline paths rather than an icon package — five glyphs is not
 * worth a dependency, and it keeps them tintable by currentColor.
 */

const TABS = [
  { href: '/', label: 'Dash', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z' },
  { href: '/draft', label: 'Draft', icon: 'M3 6h18M3 12h12M3 18h7' },
  { href: '/waivers', label: 'Waivers', icon: 'M12 5v14M5 12h14' },
  { href: '/trades', label: 'Trades', icon: 'M7 4 3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8' },
  { href: '/setup', label: 'Setup', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.6H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.7 7.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9.4a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9.4a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z' },
] as const;

export function TabBar({ leagueId, week }: { leagueId?: string | null; week?: number }) {
  const pathname = usePathname();

  const query = new URLSearchParams();
  if (leagueId) query.set('league', leagueId);
  if (week) query.set('week', String(week));
  const suffix = query.toString() ? `?${query.toString()}` : '';

  return (
    <nav
      aria-label="Primary"
      className="chrome md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-rule
        bg-ink/85 backdrop-blur-xl backdrop-saturate-150 pb-safe"
    >
      <ul className="flex items-stretch">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={`${tab.href}${suffix}`}
                aria-current={active ? 'page' : undefined}
                className="press flex flex-col items-center justify-center gap-1 h-[52px]
                  text-text-faint aria-[current=page]:text-signal"
              >
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={active ? 2.2 : 1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={tab.icon} />
                </svg>
                <span className="text-[9.5px] tracking-wide leading-none">{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
