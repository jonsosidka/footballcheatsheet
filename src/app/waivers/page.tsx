import Link from 'next/link';
import { getWaiverView } from '@/lib/data/waivers';
import { listLeagues } from '@/lib/data/dashboard';
import { Panel, PositionTag, InjuryTag } from '@/components/primitives';
import { Nav } from '@/components/Nav';
import { RefreshButton } from '@/components/RefreshButton';

export const dynamic = 'force-dynamic';

export default async function WaiversPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string; week?: string }>;
}) {
  const params = await searchParams;
  const week = Number(params.week ?? 1);
  const leagues = await listLeagues();
  const view = await getWaiverView(params.league, week);

  if (!view) {
    return (
      <main className="min-h-screen grid place-items-center">
        <p className="text-[13px] text-text-dim">No leagues imported yet.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-rule">
        <div className="max-w-[1440px] mx-auto px-6 py-4 flex items-end justify-between gap-8 flex-wrap">
          <div className="flex items-end gap-5">
            <div>
              <div className="eyebrow mb-1">Week {week} · waiver board</div>
              <h1 className="font-display text-[2rem] leading-none tracking-tight">
                Add <em className="text-signal not-italic">/</em> Drop
              </h1>
            </div>
            <div className="h-9 w-px bg-rule hidden md:block" />
            <Nav active="/waivers" leagueId={view.leagueId} week={week} />
          </div>

          <div className="flex items-center gap-4">
            <RefreshButton
              leagueId={view.leagueId}
              week={week}
              lastSyncedAt={view.lastSyncedAt ? view.lastSyncedAt.toISOString() : null}
            />
            {leagues.map((l) => (
              <Link
                key={l.id}
                href={`/waivers?league=${l.id}&week=${week}`}
                className={`px-3 py-1.5 border text-[11px] transition-colors ${
                  l.id === view.leagueId
                    ? 'border-signal/40 bg-signal/10 text-signal'
                    : 'border-rule text-text-dim hover:border-rule-bright hover:text-text'
                }`}
              >
                {l.name}
              </Link>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-[1440px] mx-auto px-6 py-6">
        {/* context strip */}
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 mb-5 pb-5 border-b border-rule">
          <Bit label="Posture" value={view.posture} tone="signal" />
          <Bit label="Open roster spots" value={String(view.openSlots)} />
          <Bit label="Free agents scanned" value={view.freeAgentCount.toLocaleString()} />
          <p className="text-[11px] text-text-faint max-w-md leading-relaxed ml-auto">
            {view.isDynasty
              ? `Ranked on a ${view.posture} posture — win-now points and future asset value are weighted accordingly.`
              : 'Redraft league: ranked purely on rest-of-season points added to your starting lineup.'}
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.7fr_1fr] gap-4 items-start">
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
                    <div className="flex items-start gap-3">
                      <span className="num text-[10px] text-text-faint w-5 pt-1 shrink-0">
                        {String(i + 1).padStart(2, '0')}
                      </span>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="num text-[9px] px-1.5 py-0.5 border border-signal/30 bg-signal/10 text-signal tracking-wider">
                            ADD
                          </span>
                          <PositionTag position={s.add.position} />
                          <span className="text-[13.5px]">{s.add.name}</span>
                          <span className="num text-[10px] text-text-faint">{s.add.team}</span>
                          <InjuryTag status={s.add.injuryStatus} />

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
                      </div>

                      <div className="shrink-0 text-right w-[128px]">
                        <DualBar winNow={s.score.winNowDelta} future={s.score.futureDelta} isDynasty={view.isDynasty} />
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
      <span className="eyebrow w-[38px] text-right">{label}</span>
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
