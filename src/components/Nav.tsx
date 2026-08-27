import Link from 'next/link';

/**
 * Desktop route switcher. On phones `TabBar` takes over — these 11px links
 * are far too small a target for a thumb, and a bottom bar is the presentation
 * an iOS user expects for top-level navigation anyway.
 */
const TABS = [
  { href: '/', label: 'Dashboard' },
  { href: '/draft', label: 'Draft' },
  { href: '/waivers', label: 'Waivers' },
  { href: '/trades', label: 'Trades' },
  { href: '/setup', label: 'Setup' },
];

export function Nav({ active, leagueId, week }: { active: string; leagueId?: string; week?: number }) {
  const query = new URLSearchParams();
  if (leagueId) query.set('league', leagueId);
  if (week) query.set('week', String(week));
  const suffix = query.toString() ? `?${query.toString()}` : '';

  return (
    <nav className="hidden md:flex items-center gap-1">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={`${tab.href}${suffix}`}
          aria-current={tab.href === active ? 'page' : undefined}
          className={`px-3 py-1.5 text-[11px] border transition-colors ${
            tab.href === active
              ? 'border-rule-bright bg-ink-hover text-text'
              : 'border-transparent text-text-faint hover:text-text-dim'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
