import Link from 'next/link';
import { getTradeView } from '@/lib/data/trades';
import { listLeagues } from '@/lib/data/dashboard';
import { Panel, PositionTag } from '@/components/primitives';
import { Nav } from '@/components/Nav';

export const dynamic = 'force-dynamic';

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string; week?: string }>;
}) {
  const params = await searchParams;
  const week = Number(params.week ?? 1);
  const leagues = await listLeagues();
  const view = await getTradeView(params.league, week);

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
              <div className="eyebrow mb-1">Week {week} · trade finder</div>
              <h1 className="font-display text-[2rem] leading-none tracking-tight">
                Trade <em className="text-signal not-italic">Targets</em>
              </h1>
            </div>
            <div className="h-9 w-px bg-rule hidden md:block" />
            <Nav active="/trades" leagueId={view.leagueId} week={week} />
          </div>
          <div className="flex items-center gap-2">
            {leagues.map((l) => (
              <Link
                key={l.id}
                href={`/trades?league=${l.id}&week=${week}`}
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
        <p className="text-[11.5px] text-text-faint max-w-3xl leading-relaxed mb-5 pb-5 border-b border-rule">
          Every idea is scored twice — once under your objective and once under the other manager&apos;s, using{' '}
          <em className="not-italic text-text-dim">their</em> posture, roster holes and age profile. Only mutual gains
          are shown, because a proposal the other side declines is worth less than no proposal. Win-now value is the
          change in each team&apos;s optimal starting lineup, re-solved after the trade.
        </p>

        <div className="grid grid-cols-1 xl:grid-cols-[1.65fr_1fr] gap-4 items-start">
          <Panel title="Mutually beneficial trades" accent meta={`${view.ideas.length} found`}>
            {view.ideas.length === 0 ? (
              <p className="px-4 py-8 text-[12px] text-text-faint">
                No trade improves both rosters right now. That usually means the league is postured similarly — check
                back once records separate contenders from sellers.
              </p>
            ) : (
              <ul>
                {view.ideas.map((idea, i) => (
                  <li
                    key={i}
                    className="px-4 py-3.5 border-b border-rule/60 last:border-0 rise"
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="eyebrow">with</span>
                      <span className="text-[12.5px] text-text-dim">{idea.partnerName}</span>
                      <span className="num text-[9px] px-1.5 py-0.5 border border-rule-bright text-text-faint ml-auto">
                        {idea.valueRatio.toFixed(2)}× value
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2 items-center mb-2">
                      <PlayerList label="you send" players={idea.mine.gives} tone="fade" />
                      <span className="text-text-faint text-[14px] hidden sm:block">⇄</span>
                      <PlayerList label="you get" players={idea.mine.gets} tone="signal" />
                    </div>

                    <p className="text-[11.5px] text-text-faint leading-relaxed mb-2">{idea.rationale}</p>

                    <div className="flex flex-wrap gap-x-6 gap-y-1">
                      <Delta label="you" now={idea.mine.winNowDelta} future={idea.mine.futureDelta} isDynasty={view.isDynasty} />
                      <Delta label={idea.partnerName} now={idea.theirs.winNowDelta} future={idea.theirs.futureDelta} isDynasty={view.isDynasty} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="League postures" meta="strongest first">
            <ul>
              {view.partners.map((p) => (
                <li
                  key={p.rosterId}
                  className="px-4 py-2.5 border-b border-rule/60 last:border-0 flex items-center gap-2.5"
                >
                  <span className="num text-[10px] text-text-faint w-4">{p.isMe ? '►' : ''}</span>
                  <span className={`text-[12.5px] truncate ${p.isMe ? 'text-signal' : 'text-text-dim'}`}>{p.name}</span>
                  <span
                    className="num text-[9px] px-1.5 py-0.5 border tracking-wider ml-auto"
                    style={{
                      color:
                        p.posture === 'contend'
                          ? 'var(--color-signal)'
                          : p.posture === 'rebuild'
                            ? 'var(--color-fade)'
                            : 'var(--color-warn)',
                      borderColor: 'var(--color-rule-bright)',
                    }}
                  >
                    {p.posture.toUpperCase()}
                  </span>
                  <span className="num text-[10px] text-text-faint w-[48px] text-right">{p.strength.toFixed(1)}</span>
                </li>
              ))}
            </ul>
            <div className="px-4 py-3 border-t border-rule">
              <p className="text-[11px] text-text-faint leading-relaxed">
                Trades happen when two teams want different things. Sellers here are your natural partners for
                win-now pieces; buyers are where your youth commands a premium.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </main>
  );
}

function PlayerList({
  label,
  players,
  tone,
}: {
  label: string;
  players: Array<{ playerId: string; name: string; position: string; age: number | null }>;
  tone: 'signal' | 'fade';
}) {
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      <div className="flex flex-wrap gap-x-2 gap-y-1">
        {players.map((p) => (
          <span key={p.playerId} className="inline-flex items-center gap-1.5">
            <PositionTag position={p.position} />
            <span
              className="text-[12.5px]"
              style={{ color: tone === 'signal' ? 'var(--color-signal)' : 'var(--color-text-dim)' }}
            >
              {p.name}
            </span>
            {p.age ? <span className="num text-[9.5px] text-text-faint">{p.age}</span> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

function Delta({
  label,
  now,
  future,
  isDynasty,
}: {
  label: string;
  now: number;
  future: number;
  isDynasty: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="eyebrow max-w-[110px] truncate">{label}</span>
      <span className="num text-[11px]" style={{ color: now >= 0 ? 'var(--color-signal)' : 'var(--color-fade)' }}>
        {now >= 0 ? '+' : ''}
        {now.toFixed(0)} now
      </span>
      {isDynasty ? (
        <span className="num text-[11px]" style={{ color: future >= 0 ? 'var(--color-signal)' : 'var(--color-fade)' }}>
          {future >= 0 ? '+' : ''}
          {future.toFixed(1)} future
        </span>
      ) : null}
    </div>
  );
}
