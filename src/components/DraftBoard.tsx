'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel, PositionTag, InjuryTag } from '@/components/primitives';
import type { DraftView } from '@/lib/data/draft';

/**
 * The live board.
 *
 * Polls rather than re-rendering the server component: during a draft the only
 * thing that changes is the pick list, and re-running the route would reset
 * scroll position and flash the page at the moment you are reading it. The
 * cadence follows the draft's own state — five seconds while picks are landing,
 * a lazy twenty before it starts, nothing at all once it is over.
 */

const LIVE_INTERVAL_MS = 5_000;
const IDLE_INTERVAL_MS = 20_000;

export function DraftBoard({ initial, query }: { initial: DraftView; query: string }) {
  const [view, setView] = useState(initial);
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);
  const lastPickRef = useRef(initial.currentPickNo);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/draft?${query}`, { cache: 'no-store' });
      const body = (await response.json()) as { ok: boolean; view?: DraftView; error?: string };
      if (!body.ok || !body.view) throw new Error(body.error ?? 'Draft feed unavailable');

      setView(body.view);
      setError(null);
      // Flash the header when the board actually moved, so a glance at the
      // screen tells you whether you are looking at a stale pick.
      if (body.view.currentPickNo !== lastPickRef.current) {
        lastPickRef.current = body.view.currentPickNo;
        setPulse((n) => n + 1);
      }
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, [query]);

  useEffect(() => {
    if (!live || view.status === 'complete') return;
    const interval = view.status === 'pre_draft' ? IDLE_INTERVAL_MS : LIVE_INTERVAL_MS;
    const timer = setInterval(refresh, interval);
    return () => clearInterval(timer);
  }, [live, view.status, refresh]);

  const complete = view.status === 'complete';

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-5">
      {/* --- clock ---------------------------------------------------------- */}
      <div
        key={pulse}
        className="rise flex flex-wrap items-end gap-x-10 gap-y-4 mb-5 pb-5 border-b border-rule"
      >
        <div>
          <div className="eyebrow mb-1">{complete ? 'Draft complete' : 'On the clock'}</div>
          <div className="flex items-baseline gap-3">
            <span className="num text-[2rem] leading-none text-signal">{view.currentLabel}</span>
            <span className="text-[13px] text-text-dim">
              {complete ? `${view.totalPicks} picks made` : (view.onTheClockTeam ?? '—')}
            </span>
          </div>
        </div>

        <div className="h-9 w-px bg-rule hidden md:block" />

        <div>
          <div className="eyebrow mb-1">Your pick</div>
          <div className="flex items-baseline gap-2">
            <span
              className="num text-[1.35rem] leading-none"
              style={{ color: view.isMyPick ? 'var(--color-signal)' : 'var(--color-text)' }}
            >
              {view.myNextLabel ?? '—'}
            </span>
            <span className="text-[11px] text-text-faint">
              {view.isMyPick
                ? "you're up"
                : view.picksUntilMyTurn === null
                  ? 'no picks left'
                  : `in ${view.picksUntilMyTurn} pick${view.picksUntilMyTurn === 1 ? '' : 's'}`}
            </span>
          </div>
        </div>

        <Bit label="Seat" value={view.mySlot ? `#${view.mySlot} of ${view.teams}` : '—'} />
        <Bit label="Projected starters" value={view.starterPoints.toFixed(0)} tone="signal" />
        <Bit label="Depth value" value={`+${view.depthPoints.toFixed(0)}`} />
        <Bit
          label="Room vs ADP"
          value={view.drift === 0 ? 'on pace' : `${view.drift > 0 ? '+' : ''}${view.drift.toFixed(1)}`}
        />

        <div className="ml-auto flex items-center gap-3">
          {error ? <span className="num text-[10px] text-fade max-w-[200px]">{error}</span> : null}
          <button
            type="button"
            onClick={() => (live ? setLive(false) : (setLive(true), refresh()))}
            disabled={complete}
            className="flex items-center gap-2 px-2.5 py-1.5 border border-rule text-[11px] text-text-dim transition-colors hover:border-signal/40 hover:text-signal disabled:opacity-40"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${live && !complete ? 'pulse' : ''}`}
              style={{
                background: complete
                  ? 'var(--color-text-faint)'
                  : live
                    ? 'var(--color-signal)'
                    : 'var(--color-warn)',
              }}
            />
            {complete ? 'Finished' : live ? 'Live' : 'Paused'}
          </button>
        </div>
      </div>

      {view.warnings.length > 0 ? (
        <div className="mb-4 border border-warn/30 bg-warn/5 px-4 py-2.5 space-y-1">
          {view.warnings.map((warning) => (
            <p key={warning} className="text-[11.5px] text-warn leading-relaxed">
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-[1.65fr_1fr] gap-4 items-start">
        {/* --- the recommendation ------------------------------------------ */}
        <div className="space-y-4">
          <Panel
            title={view.isMyPick ? 'Take him' : `Plan for ${view.myNextLabel ?? 'your next pick'}`}
            accent
            meta={`${view.poolSize.toLocaleString()} on the board`}
          >
            {view.suggestions.length === 0 ? (
              <p className="px-4 py-8 text-[12px] text-text-faint">
                {complete
                  ? 'Draft is over. The roster panel is your final team.'
                  : 'No suggestions — the board could not work out which seat is yours.'}
              </p>
            ) : (
              <ul>
                {view.suggestions.map((suggestion, index) => (
                  <li
                    key={suggestion.player.playerId}
                    className="px-4 py-3.5 border-b border-rule/60 last:border-0"
                    style={{
                      background: index === 0 ? 'rgba(201,242,77,0.04)' : undefined,
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <span className="num text-[10px] text-text-faint w-5 pt-1 shrink-0">
                        {String(index + 1).padStart(2, '0')}
                      </span>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <PositionTag position={suggestion.player.position} />
                          <span className={index === 0 ? 'text-[14.5px]' : 'text-[13.5px]'}>
                            {suggestion.player.name}
                          </span>
                          <span className="num text-[10px] text-text-faint">
                            {suggestion.player.team ?? 'FA'}
                            {suggestion.player.byeWeek ? ` · bye ${suggestion.player.byeWeek}` : ''}
                          </span>
                          <InjuryTag status={suggestion.player.injuryStatus} />
                          {suggestion.mandatory ? <Chip label="FORCED" tone="crit" /> : null}
                          {suggestion.run ? <Chip label="RUN" tone="warn" /> : null}
                          {suggestion.fillsSlot ? <Chip label={suggestion.fillsSlot} tone="signal" /> : null}
                          {!suggestion.likelyAvailable && !view.isMyPick ? (
                            <Chip label={`${Math.round(suggestion.survival * 100)}% THERE`} tone="fade" />
                          ) : null}
                        </div>

                        <p className="text-[11.5px] text-text-faint leading-relaxed">{suggestion.rationale}</p>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 num text-[10px] text-text-faint">
                          <span>
                            proj <span className="text-text-dim">{suggestion.player.points.toFixed(0)}</span>
                          </span>
                          <span>
                            tier{' '}
                            <span className="text-text-dim">
                              {suggestion.tier} · {suggestion.tierRemaining} left
                            </span>
                          </span>
                          {suggestion.adp !== null ? (
                            <span>
                              adp <span className="text-text-dim">{suggestion.adp.toFixed(0)}</span>
                              {suggestion.adpDelta !== null && Math.abs(suggestion.adpDelta) >= 4 ? (
                                <span
                                  style={{
                                    color:
                                      suggestion.adpDelta > 0
                                        ? 'var(--color-signal)'
                                        : 'var(--color-fade)',
                                  }}
                                >
                                  {' '}
                                  {suggestion.adpDelta > 0 ? '+' : ''}
                                  {suggestion.adpDelta.toFixed(0)}
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                          {suggestion.byeConflict.length > 0 ? (
                            <span style={{ color: 'var(--color-warn)' }}>
                              bye gap wk {suggestion.byeConflict.join(', ')}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="shrink-0 text-right w-[112px]">
                        <div className="num text-[1.5rem] leading-none text-signal">
                          {suggestion.marginal.toFixed(0)}
                        </div>
                        <div className="eyebrow mt-1">pts added</div>
                        <div
                          className="num text-[10px] mt-1.5"
                          style={{
                            color:
                              suggestion.edge >= 0 ? 'var(--color-signal-dim)' : 'var(--color-text-faint)',
                          }}
                        >
                          {suggestion.edge >= 0 ? '+' : ''}
                          {suggestion.edge.toFixed(1)} vs next
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* --- cheat sheet ------------------------------------------------ */}
          <Panel title="Best available" meta="by position">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-px bg-rule">
              {view.board.map((column) => (
                <div key={column.position} className="bg-ink-card p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <PositionTag position={column.position} />
                    <span className="eyebrow">
                      {view.needs.find((need) => need.position === column.position)?.rostered ?? 0} rostered
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {column.players.map((entry, index) => (
                      <li key={entry.playerId} className="flex items-baseline gap-1.5 text-[11.5px]">
                        <span className="num text-[9px] text-text-faint w-3">{index + 1}</span>
                        <span className="truncate text-text-dim flex-1">{entry.name}</span>
                        {index > 0 && column.players[index - 1].tier !== entry.tier ? (
                          <span className="eyebrow text-[8px]">t{entry.tier}</span>
                        ) : null}
                        <span className="num text-[10px] text-text-faint">{entry.points.toFixed(0)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* --- your team --------------------------------------------------- */}
        <div className="space-y-4">
          <Panel
            title="Your roster"
            meta={`${view.starterPoints.toFixed(0)} starters · ${view.rosterTotal.toFixed(0)} total`}
          >
            <ul>
              {view.lineup.map((slot, index) => (
                <li
                  key={`${slot.slot}-${index}`}
                  className="px-4 py-2 border-b border-rule/60 last:border-0 flex items-center gap-2.5"
                >
                  <span className="eyebrow w-[46px] shrink-0">{slot.slot}</span>
                  {slot.playerId ? (
                    <>
                      <PositionTag position={slot.position ?? '?'} />
                      <span className="text-[12.5px] truncate">{slot.name}</span>
                      <span className="num text-[9.5px] text-text-faint">
                        {slot.team}
                        {slot.byeWeek ? ` · ${slot.byeWeek}` : ''}
                      </span>
                      <span className="num text-[11px] ml-auto text-text-dim">
                        {slot.points.toFixed(0)}
                      </span>
                    </>
                  ) : (
                    <span className="text-[12px] text-text-faint italic">empty</span>
                  )}
                </li>
              ))}
            </ul>

            {view.bench.length > 0 ? (
              <div className="px-4 py-2.5 border-t border-rule">
                <div className="eyebrow mb-1.5">Bench</div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {view.bench.map((entry) => (
                    <span key={entry.playerId} className="text-[11.5px] text-text-faint">
                      {entry.name}
                      <span className="num text-[9.5px]"> {entry.position}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {view.byeShortWeeks.length > 0 ? (
              <div className="px-4 py-2 border-t border-rule text-[11px] text-warn">
                Short a starter on week {view.byeShortWeeks.join(', ')} byes.
              </div>
            ) : null}
          </Panel>

          {view.runs.length > 0 ? (
            <Panel title="Runs in progress" accent>
              <ul className="py-1">
                {view.runs.map((run) => (
                  <li key={run.position} className="px-4 py-2 flex items-center gap-2.5">
                    <PositionTag position={run.position} />
                    <span className="text-[11.5px] text-text-dim">
                      {run.picks} of the last {run.window} picks
                    </span>
                    <span className="num text-[10px] ml-auto text-warn">HOT</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel title="Draft standings" meta="projected starters">
            <ul>
              {view.standings.map((team, index) => (
                <li
                  key={team.slot}
                  className="px-4 py-2 border-b border-rule/60 last:border-0 flex items-center gap-2.5"
                  style={{ background: team.isMe ? 'rgba(201,242,77,0.05)' : undefined }}
                >
                  <span className="num text-[10px] text-text-faint w-4">{index + 1}</span>
                  <span
                    className="text-[12px] truncate flex-1"
                    style={{ color: team.isMe ? 'var(--color-signal)' : undefined }}
                  >
                    {team.name}
                  </span>
                  <span className="num text-[9.5px] text-text-faint">{team.picks}p</span>
                  <span className="num text-[11px] w-[46px] text-right text-text-dim">
                    {team.starterPoints.toFixed(0)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Recent picks" meta={`${view.currentPickNo - 1} made`}>
            <ul>
              {view.recentPicks.map((pick) => (
                <li
                  key={pick.pickNo}
                  className="px-4 py-1.5 border-b border-rule/60 last:border-0 flex items-center gap-2 text-[11.5px]"
                  style={{ background: pick.isMine ? 'rgba(201,242,77,0.05)' : undefined }}
                >
                  <span className="num text-[9.5px] text-text-faint w-8">{pick.label}</span>
                  <PositionTag position={pick.position} />
                  <span className="truncate text-text-dim flex-1">{pick.playerName}</span>
                  {pick.adpDelta !== null && Math.abs(pick.adpDelta) >= 10 ? (
                    <span
                      className="num text-[9.5px]"
                      style={{
                        color: pick.adpDelta > 0 ? 'var(--color-signal-dim)' : 'var(--color-fade)',
                      }}
                      title={pick.adpDelta > 0 ? 'fell past ADP' : 'reach'}
                    >
                      {pick.adpDelta > 0 ? '+' : ''}
                      {pick.adpDelta.toFixed(0)}
                    </span>
                  ) : null}
                  <span className="num text-[9.5px] text-text-faint truncate max-w-[74px]">{pick.team}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="How this is ranked">
            <div className="px-4 py-3.5 space-y-2.5 text-[11.5px] text-text-faint leading-relaxed">
              <p>
                A pick is scored by what it adds to your{' '}
                <em className="text-text-dim not-italic">whole roster</em> — the optimal starting lineup,
                plus what a backup contributes in the weeks the man ahead of him misses, minus the bye weeks
                you could not field a lineup. That is why a fourth running back scores near zero however
                many points he projects for.
              </p>
              <p>
                On top of that sits one step of lookahead: taking a player only costs you something if he
                would not have lasted. Survival odds come from ADP, shifted by how far this room is running
                behind consensus{' '}
                <span className="num">
                  ({view.drift > 0 ? '+' : ''}
                  {view.drift.toFixed(1)})
                </span>
                .
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Bit({ label, value, tone }: { label: string; value: string; tone?: 'signal' }) {
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      <div className={`num text-[13px] ${tone === 'signal' ? 'text-signal' : 'text-text'}`}>{value}</div>
    </div>
  );
}

function Chip({ label, tone }: { label: string; tone: 'signal' | 'warn' | 'crit' | 'fade' }) {
  const color = {
    signal: ['var(--color-signal)', 'rgba(201,242,77,0.3)'],
    warn: ['var(--color-warn)', 'rgba(255,179,64,0.3)'],
    crit: ['var(--color-crit)', 'rgba(255,77,106,0.3)'],
    fade: ['var(--color-fade)', 'rgba(255,107,90,0.3)'],
  }[tone];

  return (
    <span
      className="num text-[9px] px-1.5 py-0.5 border tracking-wider"
      style={{ color: color[0], borderColor: color[1] }}
    >
      {label}
    </span>
  );
}
