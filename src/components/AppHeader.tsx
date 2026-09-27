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
  liveWeek,
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
   * The week it actually is. When `week` matches it the links leave the week
   * out, so a bookmarked or restored URL keeps following the calendar instead
   * of freezing on whatever week it was captured in.
   */
  liveWeek?: number;
  /**
   * A week the user pinned, kept in the nav links on weekless routes so a trip
   * through the draft board or setup does not drop it.
   */
  carriedWeek?: number;
  /** Right-hand controls — the refresh button, typically. */
  actions?: ReactNode;
  /** Supporting figures. Desktop only: on a phone they cost a row of chrome
   *  and repeat what the panels below already say. */
  meta?: ReactNode;
  width?: string;
}) {
  // Only a week the user chose travels in a link. Carrying the default too is
  // what froze the app on week 1: every tab and league link baked it in, and
  // an explicit `?week=` outranks the live week on the next load.
  const pinnedWeek = week !== undefined ? (week !== liveWeek ? week : undefined) : carriedWeek;

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
              <LeagueSwitcher leagues={leagues} activeId={activeLeagueId} week={week !== undefined ? pinnedWeek : undefined} variant="button" />
              {week ? <WeekPicker week={week} liveWeek={liveWeek} leagueId={activeLeagueId} variant="compact" /> : null}
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
            <Nav active={active} leagueId={activeLeagueId ?? undefined} week={pinnedWeek} />
            {leagues.length > 0 ? (
              <>
                <div className="h-9 w-px bg-rule" />
                <LeagueSwitcher leagues={leagues} activeId={activeLeagueId} week={week !== undefined ? pinnedWeek : undefined} variant="pills" />
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-6">
            {week ? <WeekPicker week={week} liveWeek={liveWeek} leagueId={activeLeagueId} variant="full" /> : null}
            {actions}
            {meta}
          </div>
        </div>
      </header>

      <TabBar leagueId={activeLeagueId} week={pinnedWeek} />
    </>
  );
}
