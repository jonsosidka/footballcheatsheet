'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel, PositionTag, InjuryTag, Tag, PageHero, ChromeFigure, SpecGrid, HowItWorks } from '@/components/primitives';
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

export function DraftBoard({ initial, query, kicker }: { initial: DraftView; query: string; kicker: string }) {
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
    <div className="shell">
      <div key={pulse} className="rise">
        <PageHero
          kicker={kicker}
          title={
            complete ? (
              <>
                Draft
                <br />
                <span className="outline-text">done.</span>
              </>
            ) : view.isMyPick ? (
              <>
                You&apos;re
                <br />
                <span className="outline-text">up.</span>
              </>
            ) : (
              <>
                On the
                <br />
                <span className="outline-text">clock.</span>
              </>
            )
          }
          aside={
            <>
              <ChromeFigure label={complete ? 'Picks made' : 'Pick'} value={complete ? String(view.totalPicks) : view.currentLabel}>
                {complete ? 'FINAL ROSTER BELOW' : (view.onTheClockTeam ?? '—').toUpperCase()}
              </ChromeFigure>
              <SpecGrid
                items={[
                  { label: 'Your pick', value: view.myNextLabel ?? '—' },
                  { label: 'Seat', value: view.mySlot ? `${view.mySlot} / ${view.teams}` : '—' },
                  { label: 'Starters', value: view.starterPoints.toFixed(0) },
                ]}
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => (live ? setLive(false) : (setLive(true), refresh()))}
                  disabled={complete}
                  className="btn btn-outline press"
                >
                  <span
                    className={`w-2 h-2 ${live && !complete ? 'pulse' : ''}`}
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
                <span className="font-mono text-[11px] text-text-faint uppercase tracking-[0.06em]">
                  Room vs ADP {view.drift === 0 ? 'on pace' : `${view.drift > 0 ? '+' : ''}${view.drift.toFixed(1)}`}
                </span>
                {error ? <span className="num text-[11px] text-fade basis-full">{error}</span> : null}
              </div>
            </>
          }
        >
          <p>
            {complete
              ? `All ${view.totalPicks} picks are in. Your final roster projects ${view.starterPoints.toFixed(0)} points from its starters.`
              : view.isMyPick
                ? 'You are on the clock. The best pick for your whole roster is at the top of the list below.'
                : view.picksUntilMyTurn === null
                  ? 'You have no picks left in this draft.'
                  : `Your next pick is in ${view.picksUntilMyTurn} pick${view.picksUntilMyTurn === 1 ? '' : 's'}. Here is who to plan for, and the odds each one is still there.`}
          </p>
        </PageHero>
      </div>

      <div className="py-6">
      {view.warnings.length > 0 ? (
        <div className="mb-4 border border-text px-4 py-3 space-y-1.5">
          {view.warnings.map((warning) => (
            <p key={warning} className="text-[14px] text-text-dim leading-relaxed flex gap-2.5 items-baseline">
              <Tag tone="solid">Setup</Tag>
              <span>{warning}</span>
            </p>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-[1.65fr_1fr] gap-3 sm:gap-4 items-start">
        {/* --- the recommendation ------------------------------------------ */}
        <div className="space-y-3 sm:space-y-4">
          <Panel
            index={1}
            title={complete ? 'Draft complete' : view.isMyPick ? 'Take him' : `Plan for ${view.myNextLabel ?? 'your next pick'}`}
            accent
            meta={`${view.poolSize.toLocaleString()} on the board`}
          >
            {view.suggestions.length === 0 ? (
              <p className="px-4 py-8 text-[14px] text-text-faint">
                {complete
                  ? 'Draft is over. The roster panel is your final team.'
                  : 'No suggestions — the board could not work out which seat is yours.'}
              </p>
            ) : (
              <ul>
                {view.suggestions.map((suggestion, index) => (
                  <li
                    key={suggestion.player.playerId}
                    className={`px-4 py-3.5 border-b border-rule last:border-0 ${index === 0 ? 'bg-accent/10' : ''}`}
                  >
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-2 sm:gap-3">
                      <span className="num text-[10px] text-text-faint w-5 pt-1 shrink-0 hidden sm:block">
                        {String(index + 1).padStart(2, '0')}
                      </span>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="num text-[10px] text-text-faint sm:hidden">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <PositionTag position={suggestion.player.position} />
                          <span className={`wide uppercase ${index === 0 ? 'text-[18px]' : 'text-[16px]'}`}>
                            {suggestion.player.name}
                          </span>
                          <span className="num text-[10px] text-text-faint">
                            {suggestion.player.team ?? 'FA'}
                            {suggestion.player.byeWeek ? ` · bye ${suggestion.player.byeWeek}` : ''}
                          </span>
                          <InjuryTag status={suggestion.player.injuryStatus} />
                          {suggestion.mandatory ? <Tag tone="crit">Must fill</Tag> : null}
                          {suggestion.run ? <Tag tone="warn">Run on</Tag> : null}
                          {suggestion.fillsSlot ? <Tag tone="accent">{suggestion.fillsSlot}</Tag> : null}
                          {!suggestion.likelyAvailable && !view.isMyPick ? (
                            <Tag tone="fade">{`${Math.round(suggestion.survival * 100)}% still there`}</Tag>
                          ) : null}
                        </div>

                        <p className="text-[13px] text-text-faint leading-relaxed">{suggestion.rationale}</p>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 num text-[11px] uppercase text-text-faint">
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

                      <div className="shrink-0 w-full sm:w-[112px] flex sm:block items-baseline gap-2 text-right pt-1 sm:pt-0 border-t border-rule/60 sm:border-0">
                        <div className="figure text-[1.75rem] leading-none text-signal">
                          {suggestion.marginal.toFixed(0)}
                        </div>
                        <div className="eyebrow sm:mt-1">pts added</div>
                        <div
                          className="num text-[10px] sm:mt-1.5 ml-auto sm:ml-0"
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
          <Panel index={2} title="Best available" meta="by position">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-px bg-rule">
              {view.board.map((column) => (
                <div key={column.position} className="bg-ink p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <PositionTag position={column.position} />
                    <span className="eyebrow">
                      {view.needs.find((need) => need.position === column.position)?.rostered ?? 0} rostered
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {column.players.map((entry, index) => (
                      <li key={entry.playerId} className="flex items-baseline gap-1.5 text-[13px]">
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
            index={3}
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
                      <span className="text-[14px] truncate">{slot.name}</span>
                      <span className="num text-[9.5px] text-text-faint">
                        {slot.team}
                        {slot.byeWeek ? ` · ${slot.byeWeek}` : ''}
                      </span>
                      <span className="num text-[11px] ml-auto text-text-dim">
                        {slot.points.toFixed(0)}
                      </span>
                    </>
                  ) : (
                    <span className="font-mono text-[11px] text-text-faint">EMPTY</span>
                  )}
                </li>
              ))}
            </ul>

            {view.bench.length > 0 ? (
              <div className="px-4 py-2.5 border-t border-rule">
                <div className="eyebrow mb-1.5">Bench</div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {view.bench.map((entry) => (
                    <span key={entry.playerId} className="text-[13px] text-text-faint">
                      {entry.name}
                      <span className="num text-[9.5px]"> {entry.position}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {view.byeShortWeeks.length > 0 ? (
              <div className="px-4 py-2.5 border-t border-rule text-[13px] text-warn">
                Short a starter on week {view.byeShortWeeks.join(', ')} byes.
              </div>
            ) : null}
          </Panel>

          {view.runs.length > 0 ? (
            <Panel title="Runs in progress">
              <ul className="py-1">
                {view.runs.map((run) => (
                  <li key={run.position} className="px-4 py-2 flex items-center gap-2.5">
                    <PositionTag position={run.position} />
                    <span className="text-[13px] text-text-dim">
                      {run.picks} of the last {run.window} picks
                    </span>
                    <span className="ml-auto"><Tag tone="warn">Hot</Tag></span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel index={4} title="Draft standings" meta="projected starters">
            <ul>
              {view.standings.map((team, index) => (
                <li
                  key={team.slot}
                  className={`px-4 py-2 border-b border-rule last:border-0 flex items-center gap-2.5 ${
                    team.isMe ? 'bg-accent text-on-accent' : ''
                  }`}
                >
                  <span className="figure text-[18px] w-[26px] leading-none">{String(index + 1).padStart(2, '0')}</span>
                  <span className="truncate flex-1 font-bold [font-stretch:112%] uppercase text-[13px]">
                    {team.name}
                  </span>
                  <span className="num text-[10px] opacity-70">{team.picks}P</span>
                  <span className="num text-[12px] w-[46px] text-right">
                    {team.starterPoints.toFixed(0)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel index={5} title="Recent picks" meta={`${view.currentPickNo - 1} made`}>
            <ul>
              {view.recentPicks.map((pick) => (
                <li
                  key={pick.pickNo}
                  className={`px-4 py-1.5 border-b border-rule last:border-0 flex items-center gap-2 text-[13px] ${
                    pick.isMine ? 'bg-accent/15' : ''
                  }`}
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

          <HowItWorks>
            <div className="space-y-2.5">
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
          </HowItWorks>
        </div>
      </div>
      </div>
    </div>
  );
}
