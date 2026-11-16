'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { lookupUser, importLeague, removeLeague, type FoundLeague, type LookupResult } from '@/app/setup/actions';
import { PositionTag, Tag } from '@/components/primitives';

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
      <div className="border border-text p-4 sm:p-5">
        <label htmlFor="sleeper-username" className="kicker block mb-3">
          [01] Sleeper username
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="sleeper-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') search();
            }}
            placeholder="YOUR SLEEPER HANDLE"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="search"
            className="field flex-1 min-w-0 sm:min-w-[220px] !text-[16px] md:!text-[13px] min-h-[44px]"
          />
          <button
            type="button"
            onClick={search}
            disabled={pending || !username.trim()}
            className="btn btn-primary press min-h-[44px] disabled:cursor-wait"
          >
            {pending && !importing ? 'Searching…' : 'Find leagues →'}
          </button>
        </div>
        <p className="mt-3 text-[13px] text-text-faint leading-relaxed">
          Sleeper&apos;s API is public and read-only — no password, and nothing on your account can be changed from
          here.
        </p>
      </div>

      {notice ? (
        <div
          className={`border px-4 py-3 text-[14px] ${notice.ok ? 'border-accent bg-accent text-on-accent' : 'border-fade text-fade'}`}
          role="status"
        >
          {notice.text}
        </div>
      ) : null}

      {/* --- results --- */}
      {result?.ok && result.leagues ? (
        <div>
          <div className="flex items-baseline gap-3 mb-3">
            <h2 className="kicker">
              [02] {result.displayName} · {result.leagues.length} league{result.leagues.length === 1 ? '' : 's'}
            </h2>
            <span className="eyebrow text-text-faint">seasons {result.seasons?.join(', ')}</span>
          </div>

          <ul className="space-y-2">
            {result.leagues.map((league) => (
              <li key={`${league.leagueId}`} className="border border-rule p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="wide uppercase text-[17px]">{league.name}</span>
                      <Tag tone={league.isDynasty ? 'solid' : 'outline'}>{league.isDynasty ? 'Dynasty' : 'Redraft'}</Tag>
                      {league.isSuperflex ? <Tag tone="outline">Superflex</Tag> : null}
                      <span className="num text-[11px] text-text-faint">{league.season}</span>
                      {league.status !== 'in_season' ? <Tag tone="muted">{league.status.replace(/_/g, ' ')}</Tag> : null}
                    </div>

                    <div className="flex flex-wrap gap-1 mb-2">
                      {league.starters.map((slot, i) => (
                        <PositionTag key={`${slot}-${i}`} position={slot.replace('_FLEX', 'F')} />
                      ))}
                    </div>

                    <div className="num text-[11px] text-text-faint uppercase">
                      {league.totalRosters} teams ·{' '}
                      {league.ppr === 1 ? 'full PPR' : league.ppr === 0.5 ? 'half PPR' : `${league.ppr}/rec`} ·{' '}
                      {league.scoringKeys} scoring keys
                      {league.taxiSlots > 0 ? ` · taxi ${league.taxiSlots}` : ''}
                      {league.reserveSlots > 0 ? ` · IR ${league.reserveSlots}` : ''}
                    </div>

                    <div className="num text-[11px] mt-1 uppercase" style={{ color: league.myRosterId === null ? 'var(--color-fade)' : 'var(--color-text-faint)' }}>
                      {league.myRosterId === null
                        ? 'could not find your roster in this league'
                        : `your roster #${league.myRosterId} · ${league.playerCount} players`}
                    </div>
                  </div>

                  <div className="shrink-0">
                    {league.alreadyTracked ? (
                      <div className="flex items-center gap-2">
                        <Tag tone="accent">Tracked</Tag>
                        <button
                          type="button"
                          onClick={() => doRemove(league.leagueId)}
                          disabled={pending}
                          className="btn btn-ghost press"
                        >
                          {importing === league.leagueId ? '…' : 'Remove'}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => doImport(league)}
                        disabled={pending || league.myRosterId === null}
                        className="btn btn-primary press"
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

          <p className="mt-3 text-[13px] text-text-faint leading-relaxed">
            Importing pulls rosters, projections, betting lines and dynasty values. The first one takes a moment while
            the full player list downloads; after that it&apos;s quick.
          </p>
        </div>
      ) : null}
    </div>
  );
}
