import { getWaiverView } from '@/lib/data/waivers';
import { listLeagues } from '@/lib/data/dashboard';
import { Panel, PositionTag, InjuryTag } from '@/components/primitives';
import { AppHeader } from '@/components/AppHeader';
import { RefreshButton } from '@/components/RefreshButton';
import { resolveWeek } from '@/lib/data/week';

export const dynamic = 'force-dynamic';

export default async function WaiversPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string; week?: string }>;
}) {
  const params = await searchParams;
  const week = await resolveWeek(params.week);
  const leagues = await listLeagues();
  const view = await getWaiverView(params.league, week);

  if (!view) {
    return (
      <main className="min-h-dvh grid place-items-center">
        <p className="text-[13px] text-text-dim">No leagues imported yet.</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh pb-tabbar">
      <AppHeader
        eyebrow={`Week ${week} · waiver board`}
        title={
          <>
            Add <em className="text-signal not-italic">/</em> Drop
          </>
        }
        active="/waivers"
        leagues={leagues}
        activeLeagueId={view.leagueId}
        week={week}
        actions={
          <RefreshButton
            leagueId={view.leagueId}
            week={week}
            lastSyncedAt={view.lastSyncedAt ? view.lastSyncedAt.toISOString() : null}
          />
        }
      />

      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {/* context strip */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-x-6 sm:gap-x-8 gap-y-3 mb-4 sm:mb-5 pb-4 sm:pb-5 border-b border-rule">
          <Bit label="Posture" value={view.posture} tone="signal" />
          <Bit label="Open roster spots" value={String(view.openSlots)} />
          {view.waiverSystem === 'faab' ? (
            <Bit
              label="FAAB remaining"
              value={`$${view.faabRemaining ?? 0} / $${view.faabTotal ?? 0}`}
              tone="signal"
            />
          ) : (
            <Bit label="Waiver position" value={view.waiverPosition ? `#${view.waiverPosition}` : '—'} />
          )}
          <Bit label="Free agents scanned" value={view.freeAgentCount.toLocaleString()} />
          <p className="col-span-2 text-[11px] text-text-faint sm:max-w-md leading-relaxed sm:ml-auto">
            {view.isDynasty
              ? `Ranked on a ${view.posture} posture — win-now points and future asset value are weighted accordingly.`
              : 'Redraft league: ranked purely on rest-of-season points added to your starting lineup.'}
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.7fr_1fr] gap-3 sm:gap-4 items-start">
          <Panel title="Recommended moves" accent meta={`${view.suggestions.length} ranked`}>
            {view.suggestions.length === 0 ? (
              <p className="px-4 py-8 text-[12px] text-text-faint">
                Nothing on the wire improves this roster. That is a good sign.
              </p>
            ) : (
              <ul>
                {view.suggestions.map((s, i) => (
                  <li
                    key={s.add.playerId}
                    className="px-4 py-3.5 border-b border-rule/60 last:border-0 rise"
                    style={{ animationDelay: `${i * 28}ms` }}
                  >
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-2 sm:gap-3">
                      <span className="num text-[10px] text-text-faint w-5 pt-1 shrink-0 hidden sm:block">
                        {String(i + 1).padStart(2, '0')}
                      </span>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="num text-[10px] text-text-faint sm:hidden">
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <span className="num text-[9px] px-1.5 py-0.5 border border-signal/30 bg-signal/10 text-signal tracking-wider">
                            ADD
                          </span>
                          <PositionTag position={s.add.position} />
                          <span className="text-[13.5px]">{s.add.name}</span>
                          <span className="num text-[10px] text-text-faint">{s.add.team}</span>
                          <InjuryTag status={s.add.injuryStatus} />
                          {s.streamDelta >= 2 ? (
                            <span
                              className="num text-[9px] px-1.5 py-0.5 border tracking-wider"
                              style={{
                                color: 'var(--color-signal)',
                                borderColor: 'rgba(80,220,160,0.3)',
                                background: 'rgba(80,220,160,0.08)',
                              }}
                            >
                              +{s.streamDelta.toFixed(1)} WK {week}
                            </span>
                          ) : null}

                          {s.drop ? (
                            <>
                              <span className="text-text-faint text-[11px] mx-1">for</span>
                              <span className="num text-[9px] px-1.5 py-0.5 border border-fade/30 bg-fade/10 text-fade tracking-wider">
                                DROP
                              </span>
                              <PositionTag position={s.drop.position} />
                              <span className="text-[12.5px] text-text-dim">{s.drop.name}</span>
                            </>
                          ) : null}
                        </div>

                        <p className="text-[11.5px] text-text-faint leading-relaxed">{s.rationale}</p>
                        {s.bid && s.bid.amount > 0 ? (
                          <p className="text-[10.5px] text-signal-dim mt-1">{s.bid.rationale}</p>
                        ) : null}
                        {s.priority ? (
                          <p className="text-[10.5px] text-text-faint mt-1">{s.priority.rationale}</p>
                        ) : null}
                      </div>

                      <div className="shrink-0 text-right w-full sm:w-[142px] space-y-1.5 pt-1 sm:pt-0 border-t border-rule/60 sm:border-0">
                        <DualBar winNow={s.score.winNowDelta} future={s.score.futureDelta} isDynasty={view.isDynasty} />
                        {s.bid && s.bid.amount > 0 ? (
                          <div className="flex items-baseline justify-end gap-1.5">
                            <span className="eyebrow">bid</span>
                            <span className="num text-[13px] text-signal">
                              ${s.bid.low}–{s.bid.high}
                            </span>
                          </div>
                        ) : null}
                        {s.priority ? (
                          <div className="flex items-center justify-end">
                            <span
                              className="num text-[9px] px-1.5 py-0.5 border tracking-wider"
                              style={{
                                color: s.priority.worthBurning ? 'var(--color-signal)' : 'var(--color-text-faint)',
                                borderColor: s.priority.worthBurning
                                  ? 'rgba(201,242,77,0.3)'
                                  : 'var(--color-rule-bright)',
                              }}
                            >
                              {s.priority.worthBurning ? 'CLAIM' : 'WAIT'}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="space-y-4">
            {view.blocked.length > 0 ? (
              <Panel title="Blocked — trade targets" meta={`${view.blocked.length}`}>
                <p className="px-4 pt-3 text-[11px] text-text-faint leading-relaxed">
                  Worth having, but your roster is full and nothing on it is worth cutting for them. These are trade
                  targets rather than waiver claims.
                </p>
                <ul className="pb-1">
                  {view.blocked.map((s) => (
                    <li key={s.add.playerId} className="px-4 py-2 flex items-center gap-2">
                      <PositionTag position={s.add.position} />
                      <span className="text-[12.5px] text-text-dim truncate">{s.add.name}</span>
                      <span className="num text-[10px] text-text-faint">{s.add.team}</span>
                      <span className="num text-[11px] ml-auto text-signal-dim">
                        +{s.score.winNowDelta.toFixed(1)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}

            {view.byeGaps.length > 0 ? (
              <Panel title="Bye-week gaps" meta={`through wk ${view.lastRegularWeek}`} accent>
                <p className="px-4 pt-3 text-[11px] text-text-faint leading-relaxed">
                  Weeks where byes leave you unable to field a full lineup. Solve these early — the wire is picked
                  over by the time everyone notices.
                </p>
                <ul className="pt-1">
                  {view.byeGaps.slice(0, 6).map((g, i) => (
                    <li key={`${g.week}-${g.position}-${i}`} className="px-4 py-2.5 border-b border-rule/60 last:border-0">
                      <div className="flex items-center gap-2.5 mb-1">
                        <span
                          className="num text-[10px] px-1.5 py-0.5 border tracking-wider"
                          style={{
                            color: g.severity === 'critical' ? 'var(--color-crit)' : 'var(--color-warn)',
                            borderColor:
                              g.severity === 'critical' ? 'rgba(255,77,106,0.3)' : 'rgba(255,179,64,0.3)',
                          }}
                        >
                          WK {g.week}
                        </span>
                        <PositionTag position={g.position} />
                        <span className="num text-[10px] text-text-faint">
                          need {g.required}, have {g.available}
                        </span>
                        <span
                          className="num text-[11px] ml-auto"
                          style={{ color: g.severity === 'critical' ? 'var(--color-crit)' : 'var(--color-warn)' }}
                        >
                          −{g.shortBy}
                        </span>
                      </div>
                      {g.onBye.length > 0 ? (
                        <div className="text-[10.5px] text-text-faint truncate">
                          out: {g.onBye.slice(0, 4).map((x) => x.name).join(', ')}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}

            <Panel title="Positional need" meta="thinnest first">
              <ul>
                {view.needs.slice(0, 8).map((n) => (
                  <li key={n.position} className="px-4 py-2.5 border-b border-rule/60 last:border-0">
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <PositionTag position={n.position} />
                      <span className="num text-[10px] text-text-faint">
                        {n.rosteredCount} rostered · {n.startingDemand.toFixed(1)} slots
                      </span>
                      <span
                        className="num text-[11px] ml-auto"
                        style={{ color: n.needScore > 0.5 ? 'var(--color-warn)' : 'var(--color-text-faint)' }}
                      >
                        {Math.round(n.needScore * 100)}
                      </span>
                    </div>
                    <div className="h-[3px] bg-rule overflow-hidden">
                      <div
                        className="sweep h-full"
                        style={{
                          width: `${n.needScore * 100}%`,
                          background:
                            n.needScore > 0.5 ? 'var(--color-warn)' : 'var(--color-rule-bright)',
                        }}
                      />
                    </div>
                    <div className="mt-1 num text-[9.5px] text-text-faint">
                      incumbent {n.incumbentPoints.toFixed(0)} · replacement {n.replacementPoints.toFixed(0)}
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="How this is ranked">
              <div className="px-4 py-3.5 space-y-2.5 text-[11.5px] text-text-faint leading-relaxed">
                <p>
                  Value over replacement uses the best <em className="text-text-dim not-italic">actually available</em>{' '}
                  free agent at each position, not a fixed rank — so a barren 14-team wire correctly makes marginal
                  adds more valuable.
                </p>
                <p>
                  {view.isDynasty ? (
                    <>
                      Each move scores on two axes. Your <span className="text-signal">{view.posture}</span> posture
                      weights future value at{' '}
                      <span className="num">
                        {view.posture === 'rebuild' ? '0.8' : view.posture === 'bubble' ? '0.5' : '0.25'}
                      </span>
                      , which is why drop candidates skew toward older players.
                    </>
                  ) : (
                    <>Redraft scoring pins the future axis to zero — only rest-of-season points count.</>
                  )}
                </p>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </main>
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

/** Two-axis readout so the tradeoff stays visible instead of collapsing to one number. */
function DualBar({ winNow, future, isDynasty }: { winNow: number; future: number; isDynasty: boolean }) {
  return (
    <div className="space-y-1">
      <Axis label="now" value={winNow} max={40} />
      {isDynasty ? <Axis label="future" value={future} max={20} /> : null}
    </div>
  );
}

function Axis({ label, value, max }: { label: string; value: number; max: number }) {
  const up = value >= 0;
  const width = Math.min(100, (Math.abs(value) / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="eyebrow w-[46px] text-right shrink-0">{label}</span>
      <span className="relative flex-1 h-[3px] bg-rule overflow-hidden">
        <span
          className="absolute top-0 h-full"
          style={{
            width: `${width}%`,
            left: up ? '50%' : undefined,
            right: up ? undefined : '50%',
            background: up ? 'var(--color-signal)' : 'var(--color-fade)',
          }}
        />
        <span className="absolute top-0 left-1/2 h-full w-px bg-rule-bright" />
      </span>
      <span
        className="num text-[10px] w-[36px] text-right"
        style={{ color: up ? 'var(--color-signal)' : 'var(--color-fade)' }}
      >
        {up ? '+' : ''}
        {value.toFixed(1)}
      </span>
    </div>
  );
}
