'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { lookupUser, importLeague, removeLeague, type FoundLeague, type LookupResult } from '@/app/setup/actions';
import { PositionTag } from '@/components/primitives';

/**
 * Sleeper username -> pick leagues -> import.
 *
 * Lookup is deliberately separate from import: it reads Sleeper without writing
 * anything, so you can see exactly what was detected — dynasty vs redraft, taxi
 * slots, which roster is yours — and confirm it's right before any data lands
 * in the database.
 */
export function SetupFlow({ initialUsername }: { initialUsername: string }) {
  const [username, setUsername] = useState(initialUsername);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const search = () => {
    setNotice(null);
    startTransition(async () => {
      const found = await lookupUser(username);
      setResult(found);
      if (!found.ok) setNotice({ ok: false, text: found.message });
    });
  };

  const doImport = (league: FoundLeague) => {
    if (league.myRosterId === null || !result?.userId) return;
    setImporting(league.leagueId);
    setNotice(null);
    startTransition(async () => {
      const outcome = await importLeague(league.leagueId, league.myRosterId!, result.userId!);
      setImporting(null);
      setNotice({ ok: outcome.ok, text: outcome.message });
      if (outcome.ok) {
        setResult(await lookupUser(username));
        router.refresh();
      }
    });
  };

  const doRemove = (leagueId: string) => {
    setImporting(leagueId);
    startTransition(async () => {
      const outcome = await removeLeague(leagueId);
      setImporting(null);
      setNotice({ ok: outcome.ok, text: outcome.message });
      if (outcome.ok) {
        setResult(await lookupUser(username));
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* --- username --- */}
      <div className="bg-ink-card border border-rule p-5">
        <label htmlFor="sleeper-username" className="eyebrow block mb-2">
          Sleeper username
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="sleeper-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') search();
            }}
            placeholder="your sleeper handle"
            spellCheck={false}
            autoComplete="off"
            className="num flex-1 min-w-[220px] bg-ink border border-rule px-3 py-2 text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-signal/50"
          />
          <button
            type="button"
            onClick={search}
            disabled={pending || !username.trim()}
            className="px-4 py-2 border border-signal/40 bg-signal/10 text-signal text-[12px] transition-colors hover:bg-signal/20 disabled:opacity-40 disabled:cursor-wait"
          >
            {pending && !importing ? 'Searching…' : 'Find leagues'}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-text-faint leading-relaxed">
          Sleeper&apos;s API is public and read-only — no password, and nothing on your account can be changed from
          here.
        </p>
      </div>

      {notice ? (
        <div
          className="border px-4 py-2.5 text-[12px]"
          style={{
            borderColor: notice.ok ? 'rgba(201,242,77,0.3)' : 'rgba(255,107,90,0.3)',
            background: notice.ok ? 'rgba(201,242,77,0.06)' : 'rgba(255,107,90,0.06)',
            color: notice.ok ? 'var(--color-signal)' : 'var(--color-fade)',
          }}
          role="status"
        >
          {notice.text}
        </div>
      ) : null}

      {/* --- results --- */}
      {result?.ok && result.leagues ? (
        <div>
          <div className="flex items-baseline gap-3 mb-3">
            <h2 className="eyebrow">
              {result.displayName} · {result.leagues.length} league{result.leagues.length === 1 ? '' : 's'}
            </h2>
            <span className="eyebrow text-text-faint">seasons {result.seasons?.join(', ')}</span>
          </div>

          <ul className="space-y-2">
            {result.leagues.map((league) => (
              <li key={`${league.leagueId}`} className="bg-ink-card border border-rule p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-[14px]">{league.name}</span>
                      <span
                        className="num text-[9px] px-1.5 py-0.5 border tracking-wider"
                        style={{
                          color: league.isDynasty ? 'var(--color-signal)' : 'var(--color-text-faint)',
                          borderColor: 'var(--color-rule-bright)',
                        }}
                      >
                        {league.isDynasty ? 'DYNASTY' : 'REDRAFT'}
                      </span>
                      {league.isSuperflex ? (
                        <span className="num text-[9px] px-1.5 py-0.5 border border-rule-bright text-warn tracking-wider">
                          SUPERFLEX
                        </span>
                      ) : null}
                      <span className="num text-[10px] text-text-faint">{league.season}</span>
                      {league.status !== 'in_season' ? (
                        <span className="num text-[9px] px-1.5 py-0.5 border border-rule-bright text-text-faint tracking-wider">
                          {league.status.replace(/_/g, ' ').toUpperCase()}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-1 mb-2">
                      {league.starters.map((slot, i) => (
                        <PositionTag key={`${slot}-${i}`} position={slot.replace('_FLEX', 'F')} />
                      ))}
                    </div>

                    <div className="num text-[10.5px] text-text-faint">
                      {league.totalRosters} teams ·{' '}
                      {league.ppr === 1 ? 'full PPR' : league.ppr === 0.5 ? 'half PPR' : `${league.ppr}/rec`} ·{' '}
                      {league.scoringKeys} scoring keys
                      {league.taxiSlots > 0 ? ` · taxi ${league.taxiSlots}` : ''}
                      {league.reserveSlots > 0 ? ` · IR ${league.reserveSlots}` : ''}
                    </div>

                    <div className="num text-[10.5px] mt-1" style={{ color: league.myRosterId === null ? 'var(--color-fade)' : 'var(--color-text-faint)' }}>
                      {league.myRosterId === null
                        ? 'could not find your roster in this league'
                        : `your roster #${league.myRosterId} · ${league.playerCount} players`}
                    </div>
                  </div>

                  <div className="shrink-0">
                    {league.alreadyTracked ? (
                      <div className="flex items-center gap-2">
                        <span className="num text-[10px] px-2 py-1 border border-signal/30 bg-signal/10 text-signal tracking-wider">
                          TRACKED
                        </span>
                        <button
                          type="button"
                          onClick={() => doRemove(league.leagueId)}
                          disabled={pending}
                          className="px-2.5 py-1.5 border border-rule text-[11px] text-text-faint transition-colors hover:border-fade/40 hover:text-fade disabled:opacity-40"
                        >
                          {importing === league.leagueId ? '…' : 'Remove'}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => doImport(league)}
                        disabled={pending || league.myRosterId === null}
                        className="px-4 py-2 border border-signal/40 bg-signal/10 text-signal text-[12px] transition-colors hover:bg-signal/20 disabled:opacity-30 disabled:cursor-not-allowed"
                        title={league.myRosterId === null ? 'Your roster was not found in this league' : undefined}
                      >
                        {importing === league.leagueId ? 'Importing…' : 'Import'}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-[11px] text-text-faint leading-relaxed">
            Importing pulls rosters, projections, betting lines and dynasty values. The first import also downloads
            Sleeper&apos;s full player list (~14MB) and the season schedule, so it takes a moment; later ones are
            fast.
          </p>
        </div>
      ) : null}
    </div>
  );
}
