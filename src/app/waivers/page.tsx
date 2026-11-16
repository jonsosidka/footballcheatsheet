import { getWaiverView } from '@/lib/data/waivers';
import { listLeagues } from '@/lib/data/dashboard';
import Link from 'next/link';
import { Panel, PositionTag, InjuryTag, Tag, PageHero, SpecGrid, ChromeFigure, EmptyState, HowItWorks } from '@/components/primitives';
import { AppHeader } from '@/components/AppHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { RefreshButton } from '@/components/RefreshButton';
import { resolveWeek } from '@/lib/data/week';
import { lastName } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function WaiversPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string; week?: string }>;
}) {
  const params = await searchParams;
  const [{ week, liveWeek }, leagues] = await Promise.all([resolveWeek(params.week), listLeagues()]);
  const view = await getWaiverView(params.league, week);

  if (!view) {
    return <NoLeague leagues={leagues} />;
  }

  const top = view.suggestions[0];
  // Section numbers follow what is actually on the page.
  let section = 0;
  const next = () => ++section;

  return (
    <main className="min-h-dvh pb-tabbar">
      <AppHeader
        active="/waivers"
        leagues={leagues}
        activeLeagueId={view.leagueId}
        week={week}
        liveWeek={liveWeek}
        division={view.isDynasty ? 'DYNASTY DIV.' : 'REDRAFT DIV.'}
        strip={[
          `Week ${week} wire`,
          view.suggestions.length > 0
            ? `${view.suggestions.length} move${view.suggestions.length === 1 ? '' : 's'} ranked`
            : 'Nothing worth a claim',
          `${view.freeAgentCount.toLocaleString()} free agents scanned`,
        ]}
        actions={
          <RefreshButton
            leagueId={view.leagueId}
            week={week}
            lastSyncedAt={view.lastSyncedAt ? view.lastSyncedAt.toISOString() : null}
          />
        }
      />

      <div className="shell">
        <PageHero
          kicker={`[ Week ${week} ] — Waiver board — ${view.isDynasty ? 'dynasty' : 'redraft'}`}
          title={
            top ? (
              <>
                Add
                <br />
                {lastName(top.add.name)}.
                <br />
                <span className="outline-text">
                  {top.drop ? (
                    <>
                      Drop
                      <br />
                      {lastName(top.drop.name)}.
                    </>
                  ) : (
                    <>
                      Open
                      <br />
                      spot.
                    </>
                  )}
                </span>
              </>
            ) : (
              <>
                Wire&apos;s
                <br />
                <span className="outline-text">dry.</span>
              </>
            )
          }
          aside={
            <>
              {view.waiverSystem === 'faab' ? (
                <ChromeFigure label="FAAB remaining" value={`$${view.faabRemaining ?? 0}`}>
                  OF ${view.faabTotal ?? 0} BUDGET
                </ChromeFigure>
              ) : (
                <ChromeFigure label="Waiver position" value={view.waiverPosition ? `#${view.waiverPosition}` : '—'}>
                  ROLLING PRIORITY
                </ChromeFigure>
              )}
              <SpecGrid
                items={[
                  { label: 'Outlook', value: view.posture },
                  { label: 'Open spots', value: String(view.openSlots) },
                  { label: 'Scanned', value: view.freeAgentCount.toLocaleString() },
                ]}
              />
            </>
          }
        >
          <p>
            {top
              ? top.rationale
              : 'Nothing on the wire improves your roster right now. That is a good sign — check back after the next round of injuries.'}
          </p>
        </PageHero>

        <div className="py-6">
        <div className="grid grid-cols-1 xl:grid-cols-[1.7fr_1fr] gap-3 sm:gap-4 items-start">
          <Panel index={next()} title="Recommended moves" accent meta={`${view.suggestions.length} ranked`}>
            {view.suggestions.length === 0 ? (
              <p className="px-4 py-8 text-[14px] text-text-faint">
                No free agent beats what you already have at any position.
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
                          <Tag tone="accent">Add</Tag>
                          <PositionTag position={s.add.position} />
                          <span className="wide uppercase text-[16px]">{s.add.name}</span>
                          <span className="num text-[10px] text-text-faint">{s.add.team}</span>
                          <InjuryTag status={s.add.injuryStatus} />
                          {s.streamDelta >= 2 ? (
                            <Tag tone="outline">+{s.streamDelta.toFixed(1)} wk {week}</Tag>
                          ) : null}

                          {s.drop ? (
                            <>
                              <span className="font-mono text-text-faint text-[11px] mx-1">FOR</span>
                              <Tag tone="fade">Drop</Tag>
                              <PositionTag position={s.drop.position} />
                              <span className="text-[14px] text-text-dim">{s.drop.name}</span>
                            </>
                          ) : null}
                        </div>

                        <p className="text-[13px] text-text-faint leading-relaxed">{s.rationale}</p>
                        {s.bid && s.bid.amount > 0 ? (
                          <p className="text-[12px] text-signal mt-1">{s.bid.rationale}</p>
                        ) : null}
                        {s.priority ? (
                          <p className="text-[12px] text-text-faint mt-1">{s.priority.rationale}</p>
                        ) : null}
                      </div>

                      <div className="shrink-0 text-right w-full sm:w-[142px] space-y-1.5 pt-1 sm:pt-0 border-t border-rule/60 sm:border-0">
                        <DualBar winNow={s.score.winNowDelta} future={s.score.futureDelta} isDynasty={view.isDynasty} />
                        {s.bid && s.bid.amount > 0 ? (
                          <div className="flex items-baseline justify-end gap-1.5">
                            <span className="eyebrow">bid</span>
                            <span className="figure text-[20px] text-signal">
                              ${s.bid.low}–{s.bid.high}
                            </span>
                          </div>
                        ) : null}
                        {s.priority ? (
                          <div className="flex items-center justify-end">
                            <Tag tone={s.priority.worthBurning ? 'accent' : 'muted'}>
                              {s.priority.worthBurning ? 'Claim now' : 'Wait'}
                            </Tag>
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
              <Panel index={next()} title="Trade targets" meta="roster full">
                <p className="px-4 pt-3 text-[13px] text-text-faint leading-relaxed">
                  Worth having, but nobody on your roster is worth cutting for them. Get them in a trade instead.
                </p>
                <ul className="pb-1">
                  {view.blocked.map((s) => (
                    <li key={s.add.playerId} className="px-4 py-2 flex items-center gap-2">
                      <PositionTag position={s.add.position} />
                      <span className="text-[14px] text-text truncate">{s.add.name}</span>
                      <span className="num text-[10px] text-text-faint">{s.add.team}</span>
                      <span className="num text-[12px] font-bold ml-auto text-signal">
                        +{s.score.winNowDelta.toFixed(1)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}

            {view.byeGaps.length > 0 ? (
              <Panel index={next()} title="Bye-week gaps" meta={`through wk ${view.lastRegularWeek}`}>
                <p className="px-4 pt-3 text-[13px] text-text-faint leading-relaxed">
                  Weeks where byes leave you short a starter. Fix them early, before the wire is picked over.
                </p>
                <ul className="pt-1">
                  {view.byeGaps.slice(0, 6).map((g, i) => (
                    <li key={`${g.week}-${g.position}-${i}`} className="px-4 py-2.5 border-b border-rule/60 last:border-0">
                      <div className="flex items-center gap-2.5 mb-1">
                        <Tag tone={g.severity === 'critical' ? 'crit' : 'warn'}>Wk {g.week}</Tag>
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
                        <div className="text-[12px] text-text-faint truncate">
                          Out: {g.onBye.slice(0, 4).map((x) => x.name).join(', ')}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}

            <Panel index={next()} title="Positional need" meta="thinnest first">
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
                        style={{ color: n.needScore > 0.5 ? 'var(--color-signal)' : 'var(--color-text-faint)' }}
                      >
                        {Math.round(n.needScore * 100)}
                      </span>
                    </div>
                    <div className="h-[4px] bg-rule overflow-hidden">
                      <div
                        className="sweep h-full"
                        style={{
                          width: `${n.needScore * 100}%`,
                          background:
                            n.needScore > 0.5 ? 'var(--color-signal)' : 'var(--color-rule-bright)',
                        }}
                      />
                    </div>
                    <div className="mt-1 num text-[10px] text-text-faint">
                      your starter {n.incumbentPoints.toFixed(0)} · best free agent {n.replacementPoints.toFixed(0)}
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>

            <HowItWorks>
              <div className="space-y-2.5">
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
            </HowItWorks>
          </div>
        </div>
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}

function NoLeague({ leagues }: { leagues: Awaited<ReturnType<typeof listLeagues>> }) {
  return (
    <main className="min-h-dvh pb-tabbar">
      <AppHeader active="/waivers" leagues={leagues} />
      <div className="shell">
        <EmptyState
          kicker="[ Waivers ]"
          title={
            <>
              No league.
              <br />
              <span className="outline-text">Yet.</span>
            </>
          }
          action={
            <Link href="/setup" className="btn btn-primary">
              Import from Sleeper →
            </Link>
          }
        >
          Import a league in setup and the waiver board ranks every free agent against your roster.
        </EmptyState>
      </div>
      <SiteFooter />
    </main>
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
