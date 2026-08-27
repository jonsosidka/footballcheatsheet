import type { ReactNode } from 'react';
import { Nav } from '@/components/Nav';
import { TabBar } from '@/components/TabBar';
import { LeagueSwitcher, type SwitchableLeague } from '@/components/LeagueSwitcher';
import { WeekPicker } from '@/components/WeekPicker';

/**
 * One header for every route.
 *
 * Each page previously grew its own, and they had drifted: the dashboard hid
 * the league pills below `md`, the others let them overflow the header, and
 * none of them offered a way to change week. Consolidating means the phone
 * layout is fixed once rather than four times, and a new page gets the whole
 * navigation model for free.
 *
 * It also renders the bottom tab bar. That is not where a tab bar belongs in
 * the document, but it is `position: fixed`, and pairing it with the header
 * keeps "the app's chrome" a single component a page mounts once.
 */
export function AppHeader({
  eyebrow,
  title,
  active,
  leagues,
  activeLeagueId,
  week,
  carriedWeek,
  actions,
  meta,
  width = 'max-w-[1440px]',
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  /** Route of the current page, for marking the active tab. */
  active: string;
  leagues: SwitchableLeague[];
  activeLeagueId?: string | null;
  /** Omitted on routes with no concept of a week, like the draft board. */
  week?: number;
  /**
   * Week to keep in the nav links on those weekless routes. Without it a trip
   * through the draft board or setup silently resets the rest of the app to
   * week 1, because the query param is what carries the state.
   */
  carriedWeek?: number;
  /** Right-hand controls — the refresh button, typically. */
  actions?: ReactNode;
  /** Supporting figures. Desktop only: on a phone they cost a row of chrome
   *  and repeat what the panels below already say. */
  meta?: ReactNode;
  width?: string;
}) {
  const navWeek = week ?? carriedWeek;

  return (
    <>
      <header
        className="sticky top-0 z-30 border-b border-rule bg-ink/80 backdrop-blur-xl
          backdrop-saturate-150 pt-safe px-safe"
      >
        {/* --- phone ---------------------------------------------------- */}
        <div className="md:hidden px-4 pt-2.5 pb-3 space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="eyebrow mb-1 truncate">{eyebrow}</div>
              <h1 className="font-display text-[1.5rem] leading-none tracking-tight truncate">{title}</h1>
            </div>
            {actions ? <div className="shrink-0">{actions}</div> : null}
          </div>

          {leagues.length > 0 ? (
            <div className="flex items-stretch gap-2">
              <LeagueSwitcher leagues={leagues} activeId={activeLeagueId} week={week} variant="button" />
              {week ? <WeekPicker week={week} leagueId={activeLeagueId} variant="compact" /> : null}
            </div>
          ) : null}
        </div>

        {/* --- desktop -------------------------------------------------- */}
        <div
          className={`hidden md:flex ${width} mx-auto px-6 py-4 items-end justify-between gap-8 flex-wrap`}
        >
          <div className="flex items-end gap-5">
            <div>
              <div className="eyebrow mb-1">{eyebrow}</div>
              <h1 className="font-display text-[2rem] leading-none tracking-tight">{title}</h1>
            </div>
            <div className="h-9 w-px bg-rule" />
            <Nav active={active} leagueId={activeLeagueId ?? undefined} week={navWeek} />
            {leagues.length > 0 ? (
              <>
                <div className="h-9 w-px bg-rule" />
                <LeagueSwitcher leagues={leagues} activeId={activeLeagueId} week={week} variant="pills" />
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-6">
            {week ? <WeekPicker week={week} leagueId={activeLeagueId} variant="full" /> : null}
            {actions}
            {meta}
          </div>
        </div>
      </header>

      <TabBar leagueId={activeLeagueId} week={navWeek} />
    </>
  );
}
