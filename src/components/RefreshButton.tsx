'use client';

import { useState, useSyncExternalStore, useTransition } from 'react';
import { refreshLeagueAction } from '@/app/actions';

/**
 * Force-resync the league currently on screen: "SYNC 09:42".
 *
 * The time is when the data was last pulled, read from `sync_state` on the
 * server rather than held here — `revalidatePath` inside the action remounts
 * this component, and a stored timestamp stays right after a reload or when
 * the scheduled job did the refreshing.
 */
export function RefreshButton({
  leagueId,
  week,
  lastSyncedAt,
}: {
  leagueId: string;
  week: number;
  lastSyncedAt: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    startTransition(async () => {
      const state = await refreshLeagueAction(leagueId, week);
      if (!state.ok) setError(state.message);
    });
  };

  // The server renders in UTC; the clock is only drawn once we are in the
  // reader's own timezone, so the two renders never disagree.
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const stamp = hydrated && lastSyncedAt ? clock(new Date(lastSyncedAt)) : null;

  return (
    <div className="relative flex">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        aria-label={stamp ? `Sync now. Last synced ${stamp}` : 'Sync now'}
        title="Re-pull rosters, projections and betting lines for this league"
        className="btn btn-solid chrome press disabled:cursor-wait"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className={`md:hidden ${pending ? 'animate-spin' : ''}`}
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
        <span className="hidden md:inline">{pending ? 'Syncing…' : stamp ? `Sync ${stamp}` : 'Sync'}</span>
      </button>

      {error ? (
        <span
          role="status"
          className="absolute right-0 top-full mt-2 w-[220px] z-10 border border-fade bg-ink px-2.5 py-2 font-mono text-[10.5px] leading-snug text-fade"
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}

const noop = () => () => {};

/** 24-hour wall clock, the way a label prints it. */
function clock(at: Date): string {
  return at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}
