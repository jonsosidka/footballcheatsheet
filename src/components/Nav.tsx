import Link from 'next/link';

const TABS = [
  { href: '/', label: 'Dashboard' },
  { href: '/waivers', label: 'Waivers' },
  { href: '/trades', label: 'Trades' },
];

export function Nav({ active, leagueId, week }: { active: string; leagueId?: string; week?: number }) {
  const query = new URLSearchParams();
  if (leagueId) query.set('league', leagueId);
  if (week) query.set('week', String(week));
  const suffix = query.toString() ? `?${query.toString()}` : '';

  return (
    <nav className="flex items-center gap-1">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={`${tab.href}${suffix}`}
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
