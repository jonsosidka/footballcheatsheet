'use client';

import { useMemo, useState, useTransition } from 'react';
import { buildTradeAction } from '@/app/trades/actions';
import type { BuilderTeam } from '@/lib/data/trades';
import type { TradeOffer, TradePlayer, OfferVerdict } from '@/lib/engine/trades';
import { Panel, PositionTag } from '@/components/primitives';
import { PlayerList, Delta } from '@/components/TradePieces';

/**
 * Hand-built trades.
 *
 * The finder answers "what trade exists?"; this answers the question a manager
 * actually has after seeing the trade block: "I want THOSE two — what would it
 * take?". Pick a team, tap the players you want, and the engine enumerates
 * packages from your roster, scored under both objectives. Pin players you're
 * willing to send, lock out the ones you're not, or spell out an exact deal and
 * have it graded.
 *
 * Selection is client state; scoring is a server action, because it needs
 * every roster in the league as a fully scored team. The lists rendered here
 * are the light shape, enough to pick from.
 */

/** Cycle on tap: not offered → willing to send → off the table. */
type MyMark = 'send' | 'keep';

const POSITION_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'IDP'] as const;
type PositionFilter = (typeof POSITION_FILTERS)[number];

const OFFENSE = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

function matchesFilter(position: string, filter: PositionFilter): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'IDP') return !OFFENSE.has(position);
  return position === filter;
}

export function TradeBuilder({
  leagueId,
  week,
  isDynasty,
  teams,
}: {
  leagueId: string;
  week: number;
  isDynasty: boolean;
  teams: BuilderTeam[];
}) {
  const me = teams.find((t) => t.isMe);
  const rivals = useMemo(() => teams.filter((t) => !t.isMe).sort((a, b) => a.name.localeCompare(b.name)), [teams]);

  const [partnerId, setPartnerId] = useState<number>(rivals[0]?.rosterId ?? 0);
  const [wants, setWants] = useState<Set<string>>(() => new Set());
  const [marks, setMarks] = useState<Map<string, MyMark>>(() => new Map());
  const [theirFilter, setTheirFilter] = useState<PositionFilter>('ALL');
  const [myFilter, setMyFilter] = useState<PositionFilter>('ALL');

  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ mode: 'suggest' | 'evaluate'; offers: TradeOffer[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const partner = rivals.find((t) => t.rosterId === partnerId) ?? rivals[0];
  if (!me || !partner) return null;

  const choosePartner = (rosterId: number) => {
    setPartnerId(rosterId);
    // A want belongs to one roster; changing teams empties the ask.
    setWants(new Set());
    setResult(null);
  };

  const toggleWant = (id: string) => {
    setWants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const cycleMark = (id: string) => {
    setMarks((prev) => {
      const next = new Map(prev);
      const current = next.get(id);
      if (!current) next.set(id, 'send');
      else if (current === 'send') next.set(id, 'keep');
      else next.delete(id);
      return next;
    });
  };

  const giveIds = [...marks].filter(([, m]) => m === 'send').map(([id]) => id);
  const keepIds = [...marks].filter(([, m]) => m === 'keep').map(([id]) => id);

  const run = (mode: 'suggest' | 'evaluate') => {
    setError(null);
    startTransition(async () => {
      const res = await buildTradeAction({
        leagueId,
        week,
        partnerRosterId: partner.rosterId,
        wantIds: [...wants],
        giveIds,
        untouchableIds: keepIds,
        mode,
      });
      if (res.ok) setResult({ mode, offers: res.offers });
      else setError(res.message);
    });
  };

  const wantPlayers = partner.players.filter((p) => wants.has(p.playerId));
  const sendPlayers = me.players.filter((p) => marks.get(p.playerId) === 'send');

  return (
    <Panel
      title="Build a trade"
      accent
      meta={
        <label className="flex items-center gap-2 normal-case tracking-normal shrink-0">
          <span className="eyebrow">with</span>
          <select
            value={partner.rosterId}
            onChange={(e) => choosePartner(Number(e.target.value))}
            className="bg-ink-raised border border-rule text-[12px] text-text px-2 py-1 min-h-[32px] max-w-[140px] sm:max-w-[200px] truncate"
            aria-label="Trade partner"
          >
            {rivals.map((t) => (
              <option key={t.rosterId} value={t.rosterId}>
                {t.name} · {t.posture}
              </option>
            ))}
          </select>
        </label>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-rule">
        <RosterColumn
          heading={`${partner.name} — tap who you want`}
          players={partner.players}
          filter={theirFilter}
          onFilter={setTheirFilter}
          markOf={(id) => (wants.has(id) ? 'want' : null)}
          onTap={toggleWant}
        />
        <RosterColumn
          heading="Your roster — tap once to offer, twice to keep"
          players={me.players}
          filter={myFilter}
          onFilter={setMyFilter}
          markOf={(id) => marks.get(id) ?? null}
          onTap={cycleMark}
        />
      </div>

      {/* The ask, spelled out, with the controls. Sticky on phones so the
          buttons are reachable while scrolling a 30-man roster. */}
      <div className="border-t border-rule px-4 py-3 bg-ink-card sticky bottom-[calc(3.25rem+env(safe-area-inset-bottom))] md:bottom-0 lg:static z-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mb-3">
          <Summary label="you want" players={wantPlayers} tone="signal" empty="nobody yet" />
          <Summary
            label={giveIds.length > 0 ? 'you offer (pinned)' : 'you offer'}
            players={sendPlayers}
            tone="fade"
            empty="let the engine choose"
            trailing={keepIds.length > 0 ? `${keepIds.length} kept` : undefined}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => run('suggest')}
            disabled={pending || wants.size === 0}
            className="press min-h-[44px] md:min-h-0 px-3.5 py-2 border border-signal/50 bg-signal/10 text-signal text-[11.5px] tracking-wide disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending && result?.mode !== 'evaluate' ? 'Working…' : 'Suggest what to offer'}
          </button>
          <button
            type="button"
            onClick={() => run('evaluate')}
            disabled={pending || wants.size === 0 || giveIds.length === 0}
            className="press min-h-[44px] md:min-h-0 px-3.5 py-2 border border-rule text-text-dim text-[11.5px] tracking-wide hover:border-rule-bright hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
            title="Grade exactly this package, no substitutions"
          >
            Evaluate this exact deal
          </button>
          {(wants.size > 0 || marks.size > 0) && (
            <button
              type="button"
              onClick={() => {
                setWants(new Set());
                setMarks(new Map());
                setResult(null);
                setError(null);
              }}
              className="press min-h-[44px] md:min-h-0 px-2 text-[11px] text-text-faint hover:text-text-dim ml-auto"
            >
              clear
            </button>
          )}
        </div>
        {error ? (
          <p className="num text-[10.5px] text-fade mt-2" role="status">
            {error}
          </p>
        ) : null}
      </div>

      {result ? <Offers result={result} isDynasty={isDynasty} partnerName={partner.name} /> : null}
    </Panel>
  );
}

function RosterColumn({
  heading,
  players,
  filter,
  onFilter,
  markOf,
  onTap,
}: {
  heading: string;
  players: TradePlayer[];
  filter: PositionFilter;
  onFilter: (f: PositionFilter) => void;
  markOf: (id: string) => 'want' | MyMark | null;
  onTap: (id: string) => void;
}) {
  const shown = players.filter((p) => matchesFilter(p.position, filter));
  const present = new Set(players.map((p) => (OFFENSE.has(p.position) ? p.position : 'IDP')));

  return (
    <div className="min-w-0">
      <div className="px-4 pt-3 pb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="eyebrow">{heading}</span>
        <div className="flex gap-1 ml-auto">
          {POSITION_FILTERS.filter((f) => f === 'ALL' || present.has(f)).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onFilter(f)}
              aria-pressed={filter === f}
              className={`num text-[9px] px-1.5 py-1 min-h-[28px] border tracking-wider transition-colors ${
                filter === f ? 'border-signal/40 text-signal' : 'border-rule text-text-faint hover:text-text-dim'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <ul className="max-h-[360px] lg:max-h-[440px] overflow-y-auto border-t border-rule/60">
        {shown.map((p) => {
          const mark = markOf(p.playerId);
          return (
            <li key={p.playerId}>
              <button
                type="button"
                onClick={() => onTap(p.playerId)}
                aria-pressed={mark !== null}
                className={`press-row w-full min-h-[44px] px-4 py-2 flex items-center gap-2.5 text-left border-b border-rule/40 transition-colors ${
                  mark === 'want' || mark === 'send' ? 'bg-signal/5' : mark === 'keep' ? 'bg-fade/5' : ''
                }`}
              >
                <PositionTag position={p.position} />
                <span
                  className={`text-[12.5px] truncate min-w-0 flex-1 ${
                    mark === 'want' || mark === 'send' ? 'text-signal' : mark === 'keep' ? 'text-fade' : 'text-text'
                  }`}
                >
                  {p.name}
                  <span className="num text-[9.5px] text-text-faint ml-1.5">
                    {p.team ?? 'FA'}
                    {p.age ? ` · ${p.age}` : ''}
                  </span>
                </span>
                <span className="num text-[10px] text-text-faint w-[46px] text-right hidden sm:inline">
                  {p.rosPoints > 0 ? `${p.rosPoints.toFixed(0)} pts` : '—'}
                </span>
                <span className="num text-[10px] text-text-dim w-[40px] text-right">
                  {p.dynastyValue > 0 ? p.dynastyValue.toLocaleString() : '—'}
                </span>
                <span
                  className={`num text-[9px] w-[38px] text-right tracking-wider ${
                    mark === 'keep' ? 'text-fade' : mark ? 'text-signal' : 'text-transparent'
                  }`}
                  aria-hidden={mark === null}
                >
                  {mark === 'want' ? 'WANT' : mark === 'send' ? 'SEND' : mark === 'keep' ? 'KEEP' : '·'}
                </span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 ? <li className="px-4 py-6 text-[12px] text-text-faint">Nobody at that position.</li> : null}
      </ul>
    </div>
  );
}

function Summary({
  label,
  players,
  tone,
  empty,
  trailing,
}: {
  label: string;
  players: TradePlayer[];
  tone: 'signal' | 'fade';
  empty: string;
  trailing?: string;
}) {
  if (players.length === 0) {
    return (
      <div>
        <div className="eyebrow mb-1">
          {label}
          {trailing ? <span className="ml-2 text-fade">{trailing}</span> : null}
        </div>
        <span className="text-[12px] text-text-faint">{empty}</span>
      </div>
    );
  }
  return (
    <div>
      <PlayerList label={trailing ? `${label} · ${trailing}` : label} players={players} tone={tone} />
    </div>
  );
}

const VERDICT_STYLE: Record<OfferVerdict, { label: string; color: string }> = {
  accept: { label: 'LIKELY ACCEPTED', color: 'var(--color-signal)' },
  'coin-flip': { label: 'COIN FLIP', color: 'var(--color-warn)' },
  decline: { label: 'LIKELY DECLINED', color: 'var(--color-fade)' },
};

function Offers({
  result,
  isDynasty,
  partnerName,
}: {
  result: { mode: 'suggest' | 'evaluate'; offers: TradeOffer[] };
  isDynasty: boolean;
  partnerName: string;
}) {
  const { mode, offers } = result;

  return (
    <div className="border-t border-rule">
      <div className="px-4 py-2.5 flex items-baseline justify-between gap-4 border-b border-rule">
        <span className="eyebrow">{mode === 'evaluate' ? 'this deal, graded' : 'what it would take'}</span>
        <span className="eyebrow text-text-faint">
          {offers.length === 0 ? 'nothing' : `${offers.length} ${offers.length === 1 ? 'package' : 'packages'}`}
        </span>
      </div>

      {offers.length === 0 ? (
        <p className="px-4 py-6 text-[12px] text-text-faint leading-relaxed">
          Nothing on your roster gets there without wildly overpaying. Either the ask is too big for your assets, or
          the players you kept are the ones {partnerName} would want — try unlocking one.
        </p>
      ) : (
        <ul>
          {offers.map((offer, i) => {
            const verdict = VERDICT_STYLE[offer.verdict];
            return (
              <li
                key={i}
                className="px-4 py-3.5 border-b border-rule/60 last:border-0 rise"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="num text-[10px] text-text-faint">{String(i + 1).padStart(2, '0')}</span>
                  <span
                    className="num text-[9px] px-1.5 py-0.5 border tracking-wider"
                    style={{ color: verdict.color, borderColor: 'var(--color-rule-bright)' }}
                  >
                    {verdict.label}
                  </span>
                  <span
                    className="num text-[9px] px-1.5 py-0.5 border border-rule-bright text-text-faint ml-auto"
                    title="Market value you send ÷ market value you get"
                  >
                    {offer.valueRatio.toFixed(2)}× value
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2 items-center mb-2">
                  <PlayerList label="you send" players={offer.mine.gives} tone="fade" />
                  <span className="text-text-faint text-[14px] sm:hidden" aria-hidden="true">
                    ↓
                  </span>
                  <span className="text-text-faint text-[14px] hidden sm:block" aria-hidden="true">
                    ⇄
                  </span>
                  <PlayerList label="you get" players={offer.mine.gets} tone="signal" />
                </div>

                <p className="text-[11.5px] text-text-faint leading-relaxed mb-2">{offer.rationale}</p>

                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  <Delta label="you" now={offer.mine.winNowDelta} future={offer.mine.futureDelta} isDynasty={isDynasty} />
                  <Delta label={partnerName} now={offer.theirs.winNowDelta} future={offer.theirs.futureDelta} isDynasty={isDynasty} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
