import Link from 'next/link';
import { getDashboard, listLeagues, type DashboardPlayer, type Dashboard } from '@/lib/data/dashboard';
import {
  Section,
  PageHero,
  ChromeFigure,
  Sticker,
  SpecGrid,
  Label,
  PositionTag,
  InjuryTag,
  Tag,
  Trend,
  EmptyState,
  ActionCard,
  LeaderLine,
} from '@/components/primitives';
import { RefreshButton } from '@/components/RefreshButton';
import { AppHeader } from '@/components/AppHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { resolveWeek } from '@/lib/data/week';
import { lastName, pad } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Change = Dashboard['changes'][number];

const POSTURE_LABEL: Record<string, string> = {
  contend: 'Contender',
  bubble: 'Bubble',
  rebuild: 'Rebuilding',
};

export default async function MyTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string; week?: string }>;
}) {
  const params = await searchParams;
  const [{ week, liveWeek }, leagues] = await Promise.all([resolveWeek(params.week), listLeagues()]);
  const data = await getDashboard(params.league, week);

  if (!data) return <NoLeagues />;

  const { league, posture, occupancy } = data;
  const bench = data.pointsLeftOnBench;
  const hasGain = bench >= 0.05;
  const moves = orderMoves(data.changes);
  const uncovered = data.doNotStart.filter((p) => !data.changes.some((c) => c.outgoing?.playerId === p.playerId));
  const moveCount = moves.length + uncovered.length;

  const strip = [
    `Week ${week} drop`,
    moveCount > 0 ? `${moveCount} lineup change${moveCount === 1 ? '' : 's'} inside` : 'Lineup locked',
    hasGain ? `+${bench.toFixed(1)} pts on the table` : `${data.optimalPoints.toFixed(1)} projected`,
  ];

  const header = (
    <AppHeader
      active="/"
      leagues={leagues}
      activeLeagueId={league.id}
      week={week}
      liveWeek={liveWeek}
      strip={strip}
      division={league.isDynasty ? 'DYNASTY DIV.' : 'REDRAFT DIV.'}
      actions={
        <RefreshButton
          leagueId={league.id}
          week={week}
          lastSyncedAt={data.lastSyncedAt ? data.lastSyncedAt.toISOString() : null}
        />
      }
    />
  );

  const kicker = [
    `[ Week ${week} ]`,
    league.name,
    `${league.totalRosters}-team ${league.isDynasty ? 'dynasty' : 'redraft'}`,
    league.isSuperflex ? 'Superflex' : null,
  ]
    .filter(Boolean)
    .join(' — ');

  if (!data.hasRoster) {
    return (
      <main className="min-h-dvh pb-tabbar">
        {header}
        <div className="shell">
          <EmptyState
            kicker={kicker}
            title={
              <>
                Pre-draft.
                <br />
                <span className="outline-text">Stand by.</span>
              </>
            }
          >
            {league.name} hasn&apos;t drafted yet, so there&apos;s no roster to set. Your lineup calls show up here the
            moment the draft is done.
          </EmptyState>
        </div>
        <SiteFooter />
      </main>
    );
  }

  const myRank = data.leagueStrengths.findIndex((s) => s.isMine) + 1;
  const incoming = new Set(data.changes.map((c) => c.incoming.playerId));
  const headline = headlineFor(moves[0], uncovered[0]);
  const sleeperHref = `https://sleeper.com/leagues/${league.id}/team`;
  const filled = data.lineup.filter((s) => s.player).length;

  return (
    <main className="min-h-dvh pb-tabbar">
      {header}

      <div className="shell">
        <PageHero
          kicker={kicker}
          title={
            <>
              {headline.solid[0]}
              <br />
              {headline.solid[1]}
              <br />
              <span className="outline-text">
                {headline.outline[0]}
                <br />
                {headline.outline[1]}
              </span>
            </>
          }
          aside={
            <>
              <ChromeFigure label="Projected / best lineup" value={data.optimalPoints.toFixed(1)}>
                NOW {data.currentPoints.toFixed(1)}
                {hasGain ? <span className="text-signal"> → +{bench.toFixed(1)}</span> : null}
              </ChromeFigure>

              {hasGain ? <Sticker value={`+${bench.toFixed(1)}`} label="PTS FREE" className="absolute top-6 md:top-9 right-0" /> : null}

              <SpecGrid
                items={[
                  { label: 'Outlook', value: posture ? POSTURE_LABEL[posture.posture] ?? posture.posture : '—' },
                  { label: 'Rank', value: myRank > 0 ? `${myRank} / ${data.leagueStrengths.length}` : '—' },
                  { label: 'Roster', value: `${occupancy.playersActive} / ${occupancy.totalActiveSlots}` },
                ]}
              />

              <Label seed={`${league.id}:${week}`} sku={`${initials(league.name)}-W${week}-${Math.round(data.optimalPoints * 10)}`} />
            </>
          }
        >
          <p>{summaryFor(data, moves[0], uncovered[0])}</p>
        </PageHero>

        <div className="flex flex-wrap">
          {/* ---------------- main column ---------------- */}
          <div className="flex-[999_1_600px] min-w-0 md:border-r border-rule md:pr-6">
            <Section index={1} title="The moves" meta={moveCount > 0 ? `${moveCount} to make` : 'none this week'}>
              {moveCount === 0 ? (
                <p className="text-[15px] text-text-dim leading-relaxed">
                  Nothing to change. Your best lineup is already set — check back after the injury report.
                </p>
              ) : (
                <ol className="flex flex-col gap-2.5">
                  {moves.map((c, i) => (
                    <MoveCard key={`${c.slot}-${c.incoming.playerId}`} index={i + 1} change={c} href={sleeperHref} first={i === 0} />
                  ))}
                  {uncovered.map((p, i) => (
                    <ActionCard
                      key={p.playerId}
                      index={moves.length + i + 1}
                      emphasis={moves.length + i === 0}
                      title={`Bench ${lastName(p.name)}.`}
                      detail={`${statusLine(p)} — no healthy backup on your bench`}
                      action={
                        <Link href={`/waivers?league=${league.id}`} className="btn btn-primary">
                          Find a replacement →
                        </Link>
                      }
                    />
                  ))}
                </ol>
              )}

              {data.promoted.length > 0 ? (
                <div className="mt-5">
                  <div className="eyebrow mb-2">Next man up — ahead of the projections</div>
                  <ul>
                    {data.promoted.map((p) => (
                      <li key={p.playerId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 border-t border-rule">
                        <Tag tone="accent">Promoted</Tag>
                        <span className="wide uppercase text-[15px]">{p.name}</span>
                        <span className="font-mono text-[10px] text-text-faint">{p.position} · {p.team}</span>
                        <span className="figure text-[18px] ml-auto">{p.points.toFixed(1)}</span>
                        {p.explanation ? <p className="basis-full text-[13px] text-text-faint leading-relaxed">{p.explanation}</p> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Section>

            <Section index={2} title="Starting lineup — spec sheet" meta={`${filled} / ${data.lineup.length} slots`}>
              <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
                <table className="w-full border-collapse min-w-[560px]">
                  <thead>
                    <tr className="font-mono text-[10px] tracking-[0.1em] text-text-faint text-left">
                      <th className="py-1.5 font-normal">NO.</th>
                      <th className="py-1.5 px-2 font-normal">SLOT</th>
                      <th className="py-1.5 px-2 font-normal">PLAYER</th>
                      <th className="py-1.5 px-2 font-normal">MATCHUP</th>
                      <th className="py-1.5 px-2 font-normal">LINE</th>
                      <th className="py-1.5 font-normal text-right">PROJ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lineup.map((slot, i) => (
                      <tr key={`${slot.slot}-${slot.slotIndex}`} className="border-t border-rule">
                        <td className="py-3 font-mono text-[11px] text-text-faint w-[34px]">{pad(i + 1)}</td>
                        <td className="py-3 px-2 font-mono text-[11px] font-bold w-[64px] whitespace-nowrap">{slotLabel(slot.slot)}</td>
                        <td className="py-3 px-2">
                          {slot.player ? (
                            <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
                              <span className="wide uppercase text-[16px]">{slot.player.name}</span>
                              <span className="font-mono text-[10px] text-text-faint">{slot.player.team ?? 'FA'}</span>
                              {incoming.has(slot.player.playerId) ? <Tag tone="accent">New in</Tag> : null}
                              <InjuryTag status={slot.player.injuryStatus} playStatus={slot.player.playStatus} />
                            </span>
                          ) : (
                            <span className="font-mono text-[11px] text-text-faint">EMPTY</span>
                          )}
                        </td>
                        <td className="py-3 px-2 font-mono text-[11px] text-text-dim whitespace-nowrap">
                          {slot.player?.opponent ? `VS ${slot.player.opponent}` : slot.player?.playStatus === 'bye' ? 'BYE' : '—'}
                        </td>
                        <td className="py-3 px-2 font-mono text-[11px] text-text-faint whitespace-nowrap">{lineFor(slot.player)}</td>
                        <td className="py-3 text-right figure text-[20px]">{slot.player ? slot.player.points.toFixed(1) : '—'}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-text">
                      <td colSpan={5} className="py-3 font-mono text-[11px] font-bold tracking-[0.16em]">
                        TOTAL
                      </td>
                      <td className="py-3 text-right figure text-[26px] text-signal">{data.optimalPoints.toFixed(1)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {data.bench.length > 0 ? (
                <div className="mt-6">
                  <div className="eyebrow mb-2">Bench</div>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                    {data.bench.map((p) => (
                      <li key={p.playerId} className="flex items-center gap-2.5 py-2 border-t border-rule min-w-0">
                        <PositionTag position={p.position} />
                        <span className="text-[14px] truncate min-w-0">{p.name}</span>
                        <InjuryTag status={p.injuryStatus} playStatus={p.playStatus} />
                        <span className="num text-[12px] text-text-faint ml-auto">{p.points.toFixed(1)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Section>
          </div>

          {/* ---------------- sidebar ---------------- */}
          <aside className="flex-[1_1_320px] min-w-0 md:pl-6">
            <Section index={3} title="Leaderboard" meta="proj. starters">
              <ol>
                {data.leagueStrengths.map((team, i) => (
                  <li
                    key={team.rosterId}
                    className={`flex items-center gap-2.5 py-2 px-2 border-t border-rule ${
                      team.isMine ? 'bg-accent text-on-accent' : 'text-text'
                    }`}
                  >
                    <span className="figure text-[22px] w-[30px] leading-none">{pad(i + 1)}</span>
                    <span className="flex-1 min-w-0 truncate font-bold [font-stretch:112%] uppercase text-[13px]">
                      {team.name}
                      {team.isMine ? ' (you)' : ''}
                    </span>
                    <span className="font-mono text-[10px] tracking-[0.06em]">{team.strength.toFixed(1)}</span>
                  </li>
                ))}
              </ol>
            </Section>

            {league.isDynasty && data.assets.length > 0 ? (
              <Section index={4} title="Market" meta={`${(data.totalAssetValue / 1000).toFixed(1)}K roster value`}>
                <MarketList assets={data.assets} />
                {data.ageCliff.length > 0 ? (
                  <p className="mt-3 text-[13px] text-text-faint leading-relaxed">
                    <span className="font-mono text-[10px] font-bold tracking-[0.12em] text-fade">PAST THE AGE CLIFF </span>
                    {data.ageCliff.map((p) => `${p.name} (${p.age})`).join(', ')} —{' '}
                    {posture?.posture === 'contend'
                      ? 'keep them, they are why you are contending.'
                      : 'sell now, they lose value fastest while you rebuild.'}
                  </p>
                ) : null}
                <Link href={`/trades?league=${league.id}`} className="btn btn-outline w-full mt-3">
                  Build a trade →
                </Link>
              </Section>
            ) : null}

            <Section index={league.isDynasty && data.assets.length > 0 ? 5 : 4} title="Roster check">
              <div>
                <LeaderLine label="Active" value={`${occupancy.playersActive}/${occupancy.totalActiveSlots}`} />
                {occupancy.taxiSlots > 0 ? <LeaderLine label="Taxi" value={`${occupancy.playersOnTaxi}/${occupancy.taxiSlots}`} /> : null}
                {occupancy.reserveSlots > 0 ? <LeaderLine label="IR" value={`${occupancy.playersOnReserve}/${occupancy.reserveSlots}`} /> : null}
              </div>
              {data.slotMoves.length > 0 ? (
                <ul className="mt-3">
                  {data.slotMoves.map((m, i) => (
                    <li key={i} className="py-2.5 border-t border-rule">
                      <div className="flex items-start gap-2">
                        <Tag tone={m.severity === 'critical' ? 'crit' : m.severity === 'warn' ? 'warn' : 'muted'}>
                          {m.severity === 'critical' ? 'Now' : m.severity === 'warn' ? 'Soon' : 'Tip'}
                        </Tag>
                        <div className="min-w-0">
                          <div className="text-[14px] font-semibold leading-snug">{m.title}</div>
                          <div className="text-[13px] text-text-faint leading-relaxed mt-0.5">{m.detail}</div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[13px] text-text-faint">Every slot is in use. Nothing to tidy up.</p>
              )}
              {data.taxi.length + data.reserve.length > 0 ? (
                <div className="mt-3 pt-3 border-t border-rule space-y-1.5">
                  {data.taxi.map((p) => (
                    <Stash key={p.playerId} player={p} tag="Taxi" />
                  ))}
                  {data.reserve.map((p) => (
                    <Stash key={p.playerId} player={p} tag="IR" />
                  ))}
                </div>
              ) : null}
            </Section>
          </aside>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}

/* ------------------------------------------------------------------ */

function MoveCard({ index, change, href, first }: { index: number; change: Change; href: string; first: boolean }) {
  const out = change.outgoing;
  const into = lastName(change.incoming.name);
  return (
    <ActionCard
      index={index}
      emphasis={first}
      title={out ? (out.startable ? `${into} over ${lastName(out.name)}.` : `${into} in. ${lastName(out.name)} out.`) : `Start ${into}.`}
      detail={`${slotLabel(change.slot)} / ${
        out ? (out.startable ? `projects ${change.incoming.points.toFixed(1)} vs ${out.points.toFixed(1)}` : statusLine(out)) : 'empty slot'
      }`}
      value={`+${change.gain.toFixed(1)}`}
      action={
        <a href={href} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
          Open in Sleeper →
        </a>
      }
    />
  );
}

function MarketList({ assets }: { assets: DashboardPlayer[] }) {
  const moving = assets
    .filter((p) => p.trend30Day)
    .sort((a, b) => Math.abs(b.trend30Day ?? 0) - Math.abs(a.trend30Day ?? 0))
    .slice(0, 5);
  const rows = moving.length > 0 ? moving : assets.slice(0, 5);
  return (
    <ul>
      {rows.map((p) => (
        <li key={p.playerId} className="flex justify-between items-baseline gap-3 py-2 border-t border-rule">
          <span className="min-w-0 truncate">
            <span className="font-bold [font-stretch:112%] uppercase">{lastName(p.name)}</span>{' '}
            <span className="font-mono text-[10px] text-text-faint">
              {p.position}
              {p.age ? `/${p.age}` : ''}
            </span>
          </span>
          {p.trend30Day ? (
            <Trend value={p.trend30Day} />
          ) : (
            <span className="num text-[12px] text-text-faint">{p.adjustedValue?.toLocaleString()}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Stash({ player, tag }: { player: DashboardPlayer; tag: string }) {
  return (
    <div className="flex items-center gap-2 text-[13px] min-w-0">
      <Tag tone="muted">{tag}</Tag>
      <PositionTag position={player.position} />
      <span className="truncate text-text-dim">{player.name}</span>
      <InjuryTag status={player.injuryStatus} playStatus={player.playStatus} />
    </div>
  );
}

function NoLeagues() {
  return (
    <main className="min-h-dvh pb-tabbar">
      <AppHeader active="/" leagues={[]} strip={['No leagues yet', 'Import yours in setup']} />
      <div className="shell">
        <EmptyState
          kicker="[ Setup ] — Step 01"
          title={
            <>
              No leagues.
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
          Enter your Sleeper username and pick the leagues you want advice for. It takes about a minute.
        </EmptyState>
      </div>
      <SiteFooter />
    </main>
  );
}

/* ------------------------------------------------------------------ */

/** Ruled-out starters first — they are the costly mistakes — then by gain. */
function orderMoves(changes: Change[]): Change[] {
  return [...changes].sort((a, b) => {
    const aOut = a.outgoing && !a.outgoing.startable ? 1 : 0;
    const bOut = b.outgoing && !b.outgoing.startable ? 1 : 0;
    return bOut - aOut || b.gain - a.gain;
  });
}

function headlineFor(top: Change | undefined, uncovered: DashboardPlayer | undefined) {
  if (top?.outgoing) {
    return { solid: ['Bench', `${lastName(top.outgoing.name)}.`], outline: ['Start', `${lastName(top.incoming.name)}.`] };
  }
  if (top) {
    return { solid: ['Fill the', `${slotLabel(top.slot)}.`], outline: ['Start', `${lastName(top.incoming.name)}.`] };
  }
  if (uncovered) {
    return { solid: ['Bench', `${lastName(uncovered.name)}.`], outline: ['Find a', 'backup.'] };
  }
  return { solid: ['Lineup', 'locked.'], outline: ['Go', 'win.'] };
}

function summaryFor(data: Dashboard, top: Change | undefined, uncovered: DashboardPlayer | undefined): string {
  const total = Math.round(data.optimalPoints);
  const count = data.changes.length;
  const flagged = top?.outgoing && !top.outgoing.startable ? top.outgoing : uncovered;
  if (flagged) {
    const why = flagged.playStatus === 'bye' ? 'is on bye' : `is ruled out${flagged.injuryStatus ? ` (${flagged.injuryStatus.toLowerCase()})` : ''}`;
    const rest =
      count > 1
        ? `Swap him, make ${count - 1} more change${count - 1 === 1 ? '' : 's'}, and you're a ${total}-point team.`
        : count === 1
          ? `Swap him and you're a ${total}-point team.`
          : 'Nobody on your bench can cover the slot, so check the waiver wire.';
    return `${flagged.name} ${why} and he's still in your lineup. ${rest}`;
  }
  if (count > 0) {
    return `${count} swap${count === 1 ? ' adds' : 's add'} ${data.pointsLeftOnBench.toFixed(1)} projected points — taking you from ${data.currentPoints.toFixed(1)} to ${data.optimalPoints.toFixed(1)}.`;
  }
  return `Your starters are already the best lineup you can set. Projected ${data.optimalPoints.toFixed(1)}.`;
}

function statusLine(p: DashboardPlayer): string {
  if (p.playStatus === 'bye') return `${lastName(p.name)} on bye`;
  return `${lastName(p.name)} ruled out${p.injuryStatus ? ` — ${p.injuryStatus}` : ''}`;
}

function lineFor(p: DashboardPlayer | null): string {
  if (!p || p.spread == null || !p.team) return '—';
  const spread = p.spread === 0 ? 'PK' : `${p.spread < 0 ? '−' : '+'}${Math.abs(p.spread)}`;
  return `${p.team} ${spread}`;
}

function slotLabel(slot: string): string {
  if (slot === 'SUPER_FLEX') return 'SFLX';
  if (slot === 'REC_FLEX') return 'RFLX';
  if (slot === 'WRRB_FLEX') return 'W/R';
  if (slot === 'IDP_FLEX') return 'IDP';
  return slot.replace('_', ' ');
}


function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter((w) => /[a-z0-9]/i.test(w))
      .slice(0, 3)
      .map((w) => w.replace(/[^a-z0-9]/gi, '')[0]?.toUpperCase() ?? '')
      .join('') || 'CS'
  );
}
