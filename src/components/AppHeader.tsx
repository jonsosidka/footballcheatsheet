import Link from 'next/link';
import type { ReactNode } from 'react';
import { Nav } from '@/components/Nav';
import { TabBar } from '@/components/TabBar';
import { LeagueSwitcher, type SwitchableLeague } from '@/components/LeagueSwitcher';
import { WeekPicker } from '@/components/WeekPicker';
import { ThemeToggle } from '@/components/ThemeToggle';
import { DropStrip } from '@/components/primitives';

/**
 * One header for every route: the lime release strip, the wordmark, the
 * numbered nav, and the league / week / sync / theme controls. Each page then
 * opens with its own `PageHero` underneath.
 *
 * On phones the nav moves to the bottom `TabBar` and the controls drop to a
 * second row, so the thumb never has to reach for an 11px link.
 */
export function AppHeader({
  active,
  leagues,
  activeLeagueId,
  week,
  liveWeek,
  carriedWeek,
  actions,
  strip,
  division,
}: {
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
  /** The sync button, typically. */
  actions?: ReactNode;
  /** Lines for the release strip. Omit for no strip. */
  strip?: string[];
  /** Small line under "FC—26", e.g. "DYNASTY DIV.". */
  division?: string;
}) {
  // Only a week the user chose travels in a link. Carrying the default too is
  // what froze the app on week 1: every tab and league link baked it in, and
  // an explicit `?week=` outranks the live week on the next load.
  const pinnedWeek = week !== undefined ? (week !== liveWeek ? week : undefined) : carriedWeek;

  const home = new URLSearchParams();
  if (activeLeagueId) home.set('league', activeLeagueId);
  if (pinnedWeek) home.set('week', String(pinnedWeek));
  const homeHref = home.toString() ? `/?${home.toString()}` : '/';

  const controls =
    leagues.length > 0 || week ? (
      <div className="flex items-stretch gap-2 min-w-0">
        {leagues.length > 0 ? (
          <LeagueSwitcher leagues={leagues} activeId={activeLeagueId} week={week !== undefined ? pinnedWeek : undefined} />
        ) : null}
        {week ? <WeekPicker week={week} liveWeek={liveWeek} leagueId={activeLeagueId} /> : null}
      </div>
    ) : null;

  return (
    <>
      {strip ? <DropStrip items={strip} /> : null}
      <header className="sticky top-0 z-30 bg-ink border-b border-rule pt-safe px-safe">
        <div className="shell py-3 md:py-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <Link href={homeHref} className="chrome flex items-end gap-3.5 no-underline text-text focus-ring" aria-label="Cheatsheet home">
            <span className="display text-[26px] md:text-[30px] tracking-[-0.035em] leading-[0.9] normal-case">
              CHEATSHEET<sup className="text-[12px] font-bold align-top tracking-normal">®</sup>
            </span>
            <span className="hidden min-[1360px]:block font-mono text-[10px] leading-[1.35] text-text-faint">
              FC—26
              <br />
              {division ?? 'SUPPLY CO.'}
            </span>
          </Link>

          <Nav active={active} leagueId={activeLeagueId ?? undefined} week={pinnedWeek} />

          <div className="flex items-stretch gap-2">
            <div className="hidden md:flex">{controls}</div>
            {actions}
            <ThemeToggle />
          </div>

          {controls ? <div className="md:hidden w-full">{controls}</div> : null}
        </div>
      </header>

      <TabBar leagueId={activeLeagueId} week={pinnedWeek} />
    </>
  );
}
