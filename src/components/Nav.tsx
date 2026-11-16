import Link from 'next/link';

/**
 * Desktop route switcher: numbered, mono, the current page in lime with a
 * rule under it. On phones `TabBar` takes over.
 */
export const ROUTES = [
  { href: '/', label: 'My Team' },
  { href: '/draft', label: 'Draft' },
  { href: '/waivers', label: 'Waivers' },
  { href: '/trades', label: 'Trades' },
  { href: '/setup', label: 'Setup' },
] as const;

export function Nav({ active, leagueId, week }: { active: string; leagueId?: string; week?: number }) {
  const query = new URLSearchParams();
  if (leagueId) query.set('league', leagueId);
  if (week) query.set('week', String(week));
  const suffix = query.toString() ? `?${query.toString()}` : '';

  return (
    <nav aria-label="Primary" className="chrome hidden md:flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px] tracking-[0.06em] uppercase">
      {ROUTES.map((route, i) => {
        const current = route.href === active;
        return (
          <Link
            key={route.href}
            href={`${route.href}${suffix}`}
            aria-current={current ? 'page' : undefined}
            className={`py-2 border-b-2 no-underline transition-colors focus-ring ${
              current ? 'text-signal border-signal' : 'text-text border-transparent hover:border-rule-bright'
            }`}
          >
            {String(i + 1).padStart(2, '0')} {route.label}
          </Link>
        );
      })}
    </nav>
  );
}
