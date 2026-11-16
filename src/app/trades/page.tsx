import { Suspense } from 'react';
import { getTradeView } from '@/lib/data/trades';
import type { TradeIdea } from '@/lib/engine/trades';
import { listLeagues } from '@/lib/data/dashboard';
import Link from 'next/link';
import { Panel, PageHero, SpecGrid, Label, Tag, EmptyState, HowItWorks, ChromeFigure } from '@/components/primitives';
import { SiteFooter } from '@/components/SiteFooter';
import { PanelSkeleton } from '@/components/PageSkeleton';
import { AppHeader } from '@/components/AppHeader';
import { TradeBuilder } from '@/components/TradeBuilder';
import { AiGm } from '@/components/AiGm';
import { PlayerList, Delta } from '@/components/TradePieces';
import { resolveWeek } from '@/lib/data/week';

export const dynamic = 'force-dynamic';

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string; week?: string }>;
}) {
  const params = await searchParams;
  const [{ week, liveWeek }, leagues] = await Promise.all([resolveWeek(params.week), listLeagues()]);
  const view = await getTradeView(params.league, week);

  if (!view) {
    return (
      <main className="min-h-dvh pb-tabbar">
        <AppHeader active="/trades" leagues={leagues} />
        <div className="shell">
          <EmptyState
            kicker="[ Trades ]"
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
            Import a league in setup and the trade finder reads every roster in it.
          </EmptyState>
        </div>
        <SiteFooter />
      </main>
    );
  }

  const myIndex = view.partners.findIndex((p) => p.isMe);
  const me = view.partners[myIndex];

  return (
    <main className="min-h-dvh pb-tabbar">
      <AppHeader
        active="/trades"
        leagues={leagues}
        activeLeagueId={view.leagueId}
        week={week}
        liveWeek={liveWeek}
        division={view.isDynasty ? 'DYNASTY DIV.' : 'REDRAFT DIV.'}
        strip={[`Week ${week} trade desk`, `${view.partners.length} teams on the board`, 'Both sides graded']}
      />

      <div className="shell">
        <PageHero
          kicker={`[ Week ${week} ] — Trade desk — ${view.isDynasty ? 'dynasty' : 'redraft'}`}
          title={
            <>
              Buy low.
              <br />
              <span className="outline-text">Sell high.</span>
            </>
          }
          aside={
            <>
              <ChromeFigure label="Your rank / starting strength" value={myIndex >= 0 ? `#${myIndex + 1}` : '—'}>
                OF {view.partners.length} TEAMS
              </ChromeFigure>
              <SpecGrid
                items={[
                  { label: 'Outlook', value: me?.posture ?? '—' },
                  { label: 'Buyers', value: String(view.partners.filter((p) => !p.isMe && p.posture === 'contend').length) },
                  { label: 'Sellers', value: String(view.partners.filter((p) => !p.isMe && p.posture === 'rebuild').length) },
                ]}
              />
              <Label seed={`${view.leagueId}:trades:${week}`} sku={`TRD-W${week}-${view.partners.length}`} />
            </>
          }
        >
          <p>
            Saw someone on the trade block? Pick their team, tap who you want, and get offers built from your
            roster — every one graded for both sides, so you only send deals they&apos;d take.
          </p>
        </PageHero>

        <div className="py-6 space-y-4">
          <AiGm leagueId={view.leagueId} week={week} isDynasty={view.isDynasty} />
          <TradeBuilder leagueId={view.leagueId} week={week} isDynasty={view.isDynasty} teams={view.rosters} />

        <div className="grid grid-cols-1 xl:grid-cols-[1.65fr_1fr] gap-3 sm:gap-4 items-start">
          <Suspense fallback={<PanelSkeleton rows={8} />}>
            <TradeIdeas ideas={view.ideas} isDynasty={view.isDynasty} />
          </Suspense>

          <Panel index={4} title="Who's buying" meta="strongest first">
            <ol>
              {view.partners.map((p, i) => (
                <li
                  key={p.rosterId}
                  className={`px-4 py-2 border-b border-rule last:border-0 flex items-center gap-2.5 ${
                    p.isMe ? 'bg-accent text-on-accent' : ''
                  }`}
                >
                  <span className="figure text-[20px] w-[28px] leading-none">{String(i + 1).padStart(2, '0')}</span>
                  <span className="flex-1 min-w-0 truncate font-bold [font-stretch:112%] uppercase text-[13px]">
                    {p.name}
                    {p.isMe ? ' (you)' : ''}
                  </span>
                  {p.isMe ? (
                    <span className="font-mono text-[10px] font-bold tracking-[0.08em] uppercase">{p.posture}</span>
                  ) : (
                    <Tag tone={p.posture === 'contend' ? 'outline' : p.posture === 'rebuild' ? 'fade' : 'muted'}>
                      {p.posture === 'contend' ? 'Buyer' : p.posture === 'rebuild' ? 'Seller' : 'Bubble'}
                    </Tag>
                  )}
                </li>
              ))}
            </ol>
            <p className="px-4 py-3 border-t border-rule text-[13px] text-text-faint leading-relaxed">
              Sellers want youth and picks for their vets. Buyers pay up for players who score now.
            </p>
          </Panel>
        </div>

        <HowItWorks>
          <p>
            Every trade is scored twice — once for you and once for the other manager, using their outlook, roster
            holes and age profile. Only deals that help both sides are shown, because an offer they decline is worth
            less than no offer. &ldquo;Now&rdquo; is the change in each team&apos;s best starting lineup after the trade.
          </p>
          {view.isDynasty ? (
            <p>
              Rookie picks count too. Each team&apos;s picks come from Sleeper, traded picks included, priced at market —
              next year&apos;s by where the original owner is on track to finish.
            </p>
          ) : null}
        </HowItWorks>
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}

/** The league-wide sweep, streamed in after the rest of the page. */
async function TradeIdeas({ ideas: pending, isDynasty }: { ideas: Promise<TradeIdea[]>; isDynasty: boolean }) {
  const ideas = await pending;
  return (
    <Panel index={3} title="Deals that help both sides" meta={`${ideas.length} found`}>
      {ideas.length === 0 ? (
        <p className="px-4 py-8 text-[14px] text-text-faint">
          No trade helps both teams right now. That usually means everyone wants the same thing — check back once
          records split the buyers from the sellers.
        </p>
      ) : (
        <ul>
          {ideas.map((idea, i) => (
            <li
              key={i}
              className="px-4 py-3.5 border-b border-rule/60 last:border-0 rise"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="eyebrow">with</span>
                <span className="wide uppercase text-[15px]">{idea.partnerName}</span>
                <span className="ml-auto">
                  <Tag tone="muted" title="Market value you send ÷ market value you get">
                    {idea.valueRatio.toFixed(2)}× value
                  </Tag>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2 items-center mb-2">
                <PlayerList label="you send" players={idea.mine.gives} tone="fade" />
                <span className="text-text-faint text-[14px] sm:hidden" aria-hidden="true">
                  ↓
                </span>
                <span className="text-text-faint text-[14px] hidden sm:block" aria-hidden="true">
                  ⇄
                </span>
                <PlayerList label="you get" players={idea.mine.gets} tone="signal" />
              </div>

              <p className="text-[13px] text-text-faint leading-relaxed mb-2">{idea.rationale}</p>

              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <Delta label="you" now={idea.mine.winNowDelta} future={idea.mine.futureDelta} isDynasty={isDynasty} />
                <Delta label={idea.partnerName} now={idea.theirs.winNowDelta} future={idea.theirs.futureDelta} isDynasty={isDynasty} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
