import Link from 'next/link';
import { getDashboard, listLeagues, type DashboardPlayer } from '@/lib/data/dashboard';
import { Panel, PositionTag, InjuryTag, Stat } from '@/components/primitives';
import { ordinal } from '@/lib/engine/value';
import { RefreshButton } from '@/components/RefreshButton';
import { Nav } from '@/components/Nav';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string; week?: string }>;
}) {
  const params = await searchParams;
  const week = Number(params.week ?? 1);
  const leagues = await listLeagues();
  const data = await getDashboard(params.league, week);

  if (!data) return <EmptyState />;

  const { league, posture, occupancy } = data;

  return (
    <main className="min-h-screen">
      {/* ---------------------------------------------------------------- */}
      <header className="border-b border-rule">
        <div className="max-w-[1440px] mx-auto px-6 py-4 flex items-end justify-between gap-8 flex-wrap">
          <div className="flex items-end gap-5">
            <div>
              <div className="eyebrow mb-1">Week {week} · {league.season}</div>
              <h1 className="font-display text-[2rem] leading-none tracking-tight">
                Football <em className="text-signal not-italic">Cheatsheet</em>
              </h1>
            </div>
            <div className="hidden md:block h-9 w-px bg-rule" />
            <Nav active="/" leagueId={league.id} week={week} />
            <div className="hidden md:block h-9 w-px bg-rule" />
            <div className="hidden md:flex items-center gap-2">
              {leagues.map((l) => (
                <Link
                  key={l.id}
                  href={`/?league=${l.id}&week=${week}`}
                  className={`px-3 py-1.5 border text-[11px] transition-colors ${
                    l.id === league.id
                      ? 'border-signal/40 bg-signal/10 text-signal'
                      : 'border-rule text-text-dim hover:border-rule-bright hover:text-text'
                  }`}
                >
                  {l.name}
                  <span className="num ml-2 text-[9px] opacity-60">
                    {l.isDynasty ? 'DYN' : 'RED'}
                  </span>
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-6">
            <RefreshButton
              leagueId={league.id}
              week={week}
              lastSyncedAt={data.lastSyncedAt ? data.lastSyncedAt.toISOString() : null}
            />
            <MetaBit label="Format" value={`${league.totalRosters}-team ${league.isDynasty ? 'dynasty' : 'redraft'}`} />
            <MetaBit label="Scoring keys" value={String(league.scoringKeyCount)} />
            <MetaBit
              label="Market coverage"
              value={`${data.marketCoverage.withMarket}/${data.marketCoverage.total}`}
              tone="signal"
            />
          </div>
        </div>
      </header>

      {!data.hasRoster ? (
        <PreDraftNotice name={league.name} />
      ) : (
        <div className="max-w-[1440px] mx-auto px-6 py-6 space-y-4">
          {/* ---------------- hero row ---------------- */}
          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr_1fr_1.3fr] gap-4">
            <div className="rise bg-ink-card border border-rule p-5" style={{ animationDelay: '0ms' }}>
              <Stat
                label="Points left on bench"
                value={data.pointsLeftOnBench.toFixed(1)}
                tone={data.pointsLeftOnBench > 1 ? 'warn' : 'signal'}
                sub={
                  data.pointsLeftOnBench > 1 ? (
                    <>
                      Your lineup is leaving points on the table.{' '}
                      <span className="text-warn">{data.changes.length} change{data.changes.length === 1 ? '' : 's'}</span> below.
                    </>
                  ) : (
                    <>Lineup is optimal. Nothing to fix this week.</>
                  )
                }
              />
            </div>

            <div className="rise bg-ink-card border border-rule p-5" style={{ animationDelay: '60ms' }}>
              <Stat
                label="Optimal projection"
                value={data.optimalPoints.toFixed(1)}
                sub={<>Current starters project <span className="num">{data.currentPoints.toFixed(1)}</span></>}
              />
            </div>

            <div className="rise bg-ink-card border border-rule p-5" style={{ animationDelay: '120ms' }}>
              <Stat
                label="Roster slots"
                value={`${occupancy.playersActive}/${occupancy.totalActiveSlots}`}
                sub={
                  <>
                    taxi <span className="num">{occupancy.playersOnTaxi}/{occupancy.taxiSlots}</span>
                    {'  ·  '}
                    IR <span className="num">{occupancy.playersOnReserve}/{occupancy.reserveSlots}</span>
                  </>
                }
                tone={occupancy.isOverRosterLimit ? 'fade' : 'default'}
              />
            </div>

            {posture ? <PostureCard posture={posture} strengths={data.leagueStrengths} /> : <div />}
          </div>

          {/* ---------------- main grid ---------------- */}
          <div className="grid grid-cols-1 xl:grid-cols-[1.55fr_1fr] gap-4 items-start">
            <div className="space-y-4">
              <Panel
                title="Optimal lineup"
                accent
                meta={<span>game environment</span>}
              >
                <table className="w-full">
                  <tbody>
                    {data.lineup.map((slot, i) => (
                      <tr
                        key={`${slot.slot}-${slot.slotIndex}`}
                        className="border-b border-rule/60 last:border-0 hover:bg-ink-hover transition-colors rise"
                        style={{ animationDelay: `${140 + i * 22}ms` }}
                      >
                        <td className="pl-4 py-2 w-[92px]">
                          <span className="eyebrow text-text-dim">{slot.slot.replace('_', ' ')}</span>
                        </td>
                        <td className="py-2">
                          {slot.player ? (
                            <div className="flex items-center gap-2">
                              <span className="text-[13px]">{slot.player.name}</span>
                              <InjuryTag status={slot.player.injuryStatus} />
                            </div>
                          ) : (
                            <span className="text-[13px] text-text-faint italic">empty</span>
                          )}
                        </td>
                        <td className="py-2 w-[52px]">
                          {slot.player ? <PositionTag position={slot.player.position} /> : null}
                        </td>
                        <td className="py-2 w-[86px]">
                          {slot.player?.team ? (
                            <span className="num text-[10px] text-text-faint">
                              {slot.player.team}
                              {slot.player.opponent ? ` vs ${slot.player.opponent}` : ''}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 w-[112px] text-right pr-1">
                          {slot.player?.impliedTeamPoints != null ? (
                            <span className="num text-[10px] text-text-faint">
                              {slot.player.impliedTeamPoints.toFixed(1)} implied
                              {slot.player.spread != null
                                ? ` · ${slot.player.spread < 0 ? '−' : '+'}${Math.abs(slot.player.spread)}`
                                : ''}
                            </span>
                          ) : (
                            <span className="num text-[10px] text-text-faint">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-4 w-[64px] text-right">
                          <span className="num text-[15px]">{slot.player?.points.toFixed(1) ?? '—'}</span>
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-rule-bright">
                      <td className="pl-4 py-2.5" colSpan={5}>
                        <span className="eyebrow">Projected total</span>
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        <span className="num text-[17px] text-signal">{data.optimalPoints.toFixed(1)}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </Panel>

              {data.changes.length > 0 ? (
                <Panel title="Suggested changes" meta={`${data.changes.length} move${data.changes.length === 1 ? '' : 's'}`}>
                  <ul>
                    {data.changes.map((c, i) => (
                      <li key={i} className="px-4 py-2.5 border-b border-rule/60 last:border-0 flex items-center gap-3 text-[12px]">
                        <span className="eyebrow w-[72px] shrink-0">{c.slot.replace('_', ' ')}</span>
                        <span className="text-signal">{c.incoming.name}</span>
                        <span className="text-text-faint">over</span>
                        <span className="text-text-dim line-through decoration-fade/50">
                          {c.outgoing?.name ?? 'empty'}
                        </span>
                        <span className="num ml-auto text-signal">+{c.gain.toFixed(1)}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              ) : null}

              <Panel title="Bench" meta={`${data.bench.length} players`}>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5 px-4 py-3">
                  {data.bench.slice(0, 18).map((p) => (
                    <div key={p.playerId} className="flex items-center gap-2 py-1 text-[12px] min-w-0">
                      <PositionTag position={p.position} />
                      <span className="truncate text-text-dim">{p.name}</span>
                      <span className="num text-[11px] text-text-faint ml-auto">{p.points.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            {/* ---------------- right column ---------------- */}
            <div className="space-y-4">
              <Panel title="Game environment" meta="DraftKings via ESPN" accent>
                <p className="px-4 pt-3 text-[11px] text-text-faint leading-relaxed">
                  Context only — a 2025 backtest showed reweighting projections on these lines made start/sit calls
                  <em className="not-italic text-fade"> worse</em>, so they no longer move the numbers above.
                </p>
                {data.movers.length === 0 ? (
                  <p className="px-4 py-6 text-[12px] text-text-faint">No lines posted yet for this week.</p>
                ) : (
                  <ul>
                    {data.movers.map((p, i) => (
                      <li
                        key={p.playerId}
                        className="px-4 py-3 border-b border-rule/60 last:border-0 rise"
                        style={{ animationDelay: `${200 + i * 30}ms` }}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <PositionTag position={p.position} />
                          <span className="text-[13px]">{p.name}</span>
                          <span className="num ml-auto text-[13px] text-text-dim">{p.points.toFixed(1)}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="num text-[10px] text-text-faint">
                            {p.team} implied {p.impliedTeamPoints?.toFixed(1)}
                          </span>
                          <span className="num text-[10px]" style={{ color: (p.spread ?? 0) < 0 ? 'var(--color-signal-dim)' : 'var(--color-fade-dim)' }}>
                            {(p.spread ?? 0) < 0 ? `−${Math.abs(p.spread!)}` : `+${p.spread}`}
                          </span>
                          <span className="num text-[10px] text-text-faint">vs {p.opponent}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="Slot health" meta={`${data.slotMoves.length} action${data.slotMoves.length === 1 ? '' : 's'}`}>
                {data.slotMoves.length === 0 ? (
                  <div className="px-4 py-4 flex items-start gap-3">
                    <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-signal shrink-0" />
                    <p className="text-[12px] text-text-dim leading-relaxed">
                      No wasted slots. Active roster full at{' '}
                      <span className="num">{occupancy.playersActive}/{occupancy.totalActiveSlots}</span>, taxi{' '}
                      <span className="num">{occupancy.playersOnTaxi}/{occupancy.taxiSlots}</span>, IR{' '}
                      <span className="num">{occupancy.playersOnReserve}/{occupancy.reserveSlots}</span>.
                    </p>
                  </div>
                ) : (
                  <ul>
                    {data.slotMoves.map((m, i) => (
                      <li key={i} className="px-4 py-3 border-b border-rule/60 last:border-0">
                        <div className="flex items-start gap-2.5">
                          <span
                            className="mt-1 w-1.5 h-1.5 rounded-full shrink-0"
                            style={{
                              background:
                                m.severity === 'critical'
                                  ? 'var(--color-crit)'
                                  : m.severity === 'warn'
                                    ? 'var(--color-warn)'
                                    : 'var(--color-text-faint)',
                            }}
                          />
                          <div>
                            <div className="text-[12.5px] mb-0.5">{m.title}</div>
                            <div className="text-[11px] text-text-faint leading-relaxed">{m.detail}</div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              {(data.taxi.length > 0 || data.reserve.length > 0) && (
                <Panel title="Stashed" meta="taxi · IR">
                  <div className="px-4 py-3 space-y-1.5">
                    {data.taxi.map((p) => (
                      <StashRow key={p.playerId} player={p} tag="TAXI" />
                    ))}
                    {data.reserve.map((p) => (
                      <StashRow key={p.playerId} player={p} tag="IR" />
                    ))}
                  </div>
                </Panel>
              )}

              {league.isDynasty && data.assets.length > 0 ? (
                <Panel
                  title="Dynasty assets"
                  meta={<span className="num">{(data.totalAssetValue / 1000).toFixed(1)}k adj</span>}
                >
                  <ul>
                    {data.assets.slice(0, 9).map((p) => (
                      <li key={p.playerId} className="px-4 py-2 border-b border-rule/60 last:border-0 flex items-center gap-2.5">
                        <PositionTag position={p.position} />
                        <span className="text-[12.5px] truncate">{p.name}</span>
                        {p.age ? <span className="num text-[10px] text-text-faint">{p.age}</span> : null}
                        {p.ageMultiplier < 0.9 ? (
                          <span className="num text-[9px] px-1 border border-fade/30 text-fade">
                            −{Math.round((1 - p.ageMultiplier) * 100)}%
                          </span>
                        ) : null}
                        <span className="num text-[11px] ml-auto">{p.adjustedValue?.toLocaleString()}</span>
                        {p.trend30Day ? (
                          <span
                            className="num text-[10px] w-[46px] text-right"
                            style={{ color: p.trend30Day > 0 ? 'var(--color-signal-dim)' : 'var(--color-fade-dim)' }}
                          >
                            {p.trend30Day > 0 ? '+' : ''}
                            {p.trend30Day}
                          </span>
                        ) : (
                          <span className="w-[46px]" />
                        )}
                      </li>
                    ))}
                  </ul>
                  {data.ageCliff.length > 0 ? (
                    <div className="px-4 py-3 border-t border-rule bg-fade/[0.03]">
                      <div className="eyebrow mb-1.5 text-fade/80">Past the age cliff</div>
                      <p className="text-[11px] text-text-dim leading-relaxed">
                        {data.ageCliff.map((p) => `${p.name} (${p.age})`).join(', ')} —{' '}
                        {posture?.posture === 'contend'
                          ? 'keep, they are why you are contending.'
                          : 'sell now, they decline fastest while you rebuild.'}
                      </p>
                    </div>
                  ) : null}
                </Panel>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function MetaBit({ label, value, tone }: { label: string; value: string; tone?: 'signal' }) {
  return (
    <div className="text-right">
      <div className="eyebrow mb-0.5">{label}</div>
      <div className={`num text-[12px] ${tone === 'signal' ? 'text-signal' : 'text-text-dim'}`}>{value}</div>
    </div>
  );
}

function StashRow({ player, tag }: { player: DashboardPlayer; tag: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="num text-[9px] px-1 py-0.5 border border-rule-bright text-text-faint">{tag}</span>
      <PositionTag position={player.position} />
      <span className="truncate text-text-dim">{player.name}</span>
      <InjuryTag status={player.injuryStatus} />
    </div>
  );
}

function PostureCard({
  posture,
  strengths,
}: {
  posture: NonNullable<Awaited<ReturnType<typeof getDashboard>>>['posture'];
  strengths: Array<{ rosterId: number; strength: number; isMine: boolean }>;
}) {
  if (!posture) return null;
  const tone =
    posture.posture === 'contend' ? 'signal' : posture.posture === 'rebuild' ? 'fade' : 'warn';
  const color = `var(--color-${tone === 'warn' ? 'warn' : tone})`;
  const max = Math.max(...strengths.map((s) => s.strength), 1);

  return (
    <div className="rise bg-ink-card border border-rule p-5 flex gap-6" style={{ animationDelay: '180ms' }}>
      <div className="shrink-0 max-w-[210px]">
        <div className="flex items-center gap-2 mb-2">
          <span className="eyebrow">Posture</span>
          <span
            className="num text-[8.5px] px-1 py-0.5 border tracking-wider"
            style={{
              color: posture.confidence === 'low' ? 'var(--color-text-faint)' : 'var(--color-text-dim)',
              borderColor: 'var(--color-rule-bright)',
            }}
            title="How much the season has told us so far"
          >
            {posture.confidence.toUpperCase()} CONF
          </span>
        </div>

        <div className="font-display text-[2rem] leading-none tracking-tight" style={{ color }}>
          {posture.posture}
        </div>

        <div className="flex items-center gap-2 mt-2">
          <span
            className="num text-[9px] px-1.5 py-0.5 border tracking-wider"
            style={{
              color:
                posture.trajectory === 'ascending'
                  ? 'var(--color-signal)'
                  : posture.trajectory === 'aging'
                    ? 'var(--color-fade)'
                    : 'var(--color-text-faint)',
              borderColor: 'var(--color-rule-bright)',
            }}
          >
            {posture.trajectory === 'ascending' ? '↗' : posture.trajectory === 'aging' ? '↘' : '→'}{' '}
            {posture.trajectory.toUpperCase()}
          </span>
          <span className="num text-[10px] text-text-faint">
            {posture.strengthZ >= 0 ? '+' : ''}
            {posture.strengthZ.toFixed(2)}σ
          </span>
        </div>

        <div className="mt-2 text-[11px] text-text-dim leading-snug">{posture.reasoning}</div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-end">
        <div className="eyebrow mb-2">League starting strength</div>
        <div className="flex items-end gap-[3px] h-[64px]">
          {strengths.map((s) => (
            <div
              key={s.rosterId}
              className="flex-1 relative group"
              style={{ height: `${(s.strength / max) * 100}%` }}
              title={`Roster ${s.rosterId} — ${s.strength.toFixed(1)}`}
            >
              <div
                className="w-full h-full transition-colors"
                style={{
                  background: s.isMine ? 'var(--color-signal)' : 'var(--color-rule-bright)',
                }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex justify-between eyebrow text-text-faint">
          <span>strongest</span>
          <span className="text-signal">you · {ordinal(Math.round(posture.strengthPercentile * 100))} pct</span>
          <span>weakest</span>
        </div>
      </div>
    </div>
  );
}

function PreDraftNotice({ name }: { name: string }) {
  return (
    <div className="max-w-[1440px] mx-auto px-6 py-24 text-center">
      <div className="eyebrow mb-3">Nothing to analyze yet</div>
      <h2 className="font-display text-3xl mb-3">{name} hasn&apos;t drafted</h2>
      <p className="text-[13px] text-text-dim max-w-md mx-auto leading-relaxed">
        This league is still in pre-draft, so there are no rosters to optimize. Lineup and waiver advice
        will appear here the moment your draft completes.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="text-center max-w-md">
        <div className="eyebrow mb-3">No leagues imported</div>
        <h1 className="font-display text-4xl mb-4">
          Football <em className="text-signal not-italic">Cheatsheet</em>
        </h1>
        <p className="text-[13px] text-text-dim leading-relaxed mb-6">
          Run the importer to pull your Sleeper leagues, rosters and projections.
        </p>
        <code className="num text-[12px] px-3 py-2 border border-rule bg-ink-card inline-block text-signal">
          npx tsx scripts/import.ts
        </code>
      </div>
    </main>
  );
}
