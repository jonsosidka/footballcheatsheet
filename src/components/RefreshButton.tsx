'use client';

import { useState, useTransition } from 'react';
import { refreshLeagueAction } from '@/app/actions';

/**
 * Force-resync the league currently on screen.
 *
 * The "last synced" timestamp is rendered from the database on the server
 * rather than held in component state. `revalidatePath` inside the action
 * remounts this component, so any ephemeral success message is wiped before it
 * can be read — and a timestamp read from `sync_state` is more useful anyway,
 * because it's still correct after a reload or when the scheduled job was what
 * refreshed the data.
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

  return (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="group flex items-center gap-1.5 px-2.5 py-1.5 border border-rule text-[11px] text-text-dim transition-colors hover:border-signal/40 hover:text-signal disabled:opacity-50 disabled:cursor-wait disabled:hover:border-rule disabled:hover:text-text-dim"
        title="Re-pull rosters, projections and betting lines for this league"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className={pending ? 'animate-spin' : 'transition-transform duration-500 group-hover:rotate-180'}
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
        {pending ? 'Syncing' : 'Refresh'}
      </button>

      {error ? (
        <span className="num text-[10px] text-fade max-w-[220px] leading-tight" role="status">
          {error}
        </span>
      ) : (
        <span className="eyebrow" role="status">
          {pending ? 'working' : lastSyncedAt ? `synced ${timeAgo(new Date(lastSyncedAt))}` : 'never synced'}
        </span>
      )}
    </div>
  );
}

function timeAgo(then: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
