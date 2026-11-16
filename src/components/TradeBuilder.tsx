'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { buildTradeAction } from '@/app/trades/actions';
import type { BuilderTeam } from '@/lib/data/trades';
import type { TradeOffer, TradePlayer, OfferVerdict, LetterGrade, TradeCallAction } from '@/lib/engine/trades';
import { Panel, PositionTag, Tag } from '@/components/primitives';
import { PlayerList, Delta } from '@/components/TradePieces';
import { ClaudeTake } from '@/components/ClaudeTake';
import { readStructured } from '@/lib/ai/readStructured';
import type { OfferResult } from '@/lib/ai/offers';

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

/** Claude's packages for the current ask; runs alongside the engine's. */
type ClaudeOffers =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; result: OfferResult }
  | { status: 'error'; message: string };

/** Cycle on tap: not offered → willing to send → off the table. */
type MyMark = 'send' | 'keep';

const POSITION_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'IDP', 'PICK'] as const;
type PositionFilter = (typeof POSITION_FILTERS)[number];

/** Everything that is not IDP: offense, specialists, and draft picks. */
const NON_IDP = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'PICK']);

function matchesFilter(position: string, filter: PositionFilter): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'IDP') return !NON_IDP.has(position);
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
  const [claude, setClaude] = useState<ClaudeOffers>({ status: 'idle' });
  const claudeAbort = useRef<AbortController | null>(null);

  const partner = rivals.find((t) => t.rosterId === partnerId) ?? rivals[0];
  if (!me || !partner) return null;

  const choosePartner = (rosterId: number) => {
    setPartnerId(rosterId);
    // A want belongs to one roster; changing teams empties the ask.
    setWants(new Set());
    setResult(null);
    resetClaude();
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

  function resetClaude() {
    claudeAbort.current?.abort();
    setClaude({ status: 'idle' });
  }

  /**
   * Fired next to the engine, not after it: the engine answers in a moment and
   * its packages show at once; Claude's land on top when they arrive.
   */
  const askClaude = async () => {
    claudeAbort.current?.abort();
    const controller = new AbortController();
    claudeAbort.current = controller;
    setClaude({ status: 'loading' });
    try {
      const res = await fetch('/api/trades/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          leagueId,
          week,
          partnerRosterId: partner.rosterId,
          wantIds: [...wants],
          giveIds,
          untouchableIds: keepIds,
        }),
      });
      const out = await readStructured<OfferResult>(res);
      if (controller.signal.aborted) return;
      setClaude(out.ok ? { status: 'done', result: out.data } : { status: 'error', message: out.error });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setClaude({ status: 'error', message: 'Lost the connection to Claude.' });
    }
  };

  const run = (mode: 'suggest' | 'evaluate') => {
    setError(null);
    if (mode === 'suggest') void askClaude();
    else resetClaude();
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
      index={2}
      title="Build a trade"
      meta={
        <label className="flex items-center gap-2 shrink-0">
          <span className="eyebrow">with</span>
          <select
            value={partner.rosterId}
            onChange={(e) => choosePartner(Number(e.target.value))}
            className="field uppercase max-w-[170px] sm:max-w-[240px] truncate"
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
      <div className="border-t border-text px-4 py-3 bg-ink sticky bottom-[calc(3.25rem+env(safe-area-inset-bottom))] md:bottom-0 lg:static z-10">
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
            className="btn btn-primary press"
          >
            {pending && result?.mode !== 'evaluate' ? 'Working…' : 'Suggest what to offer →'}
          </button>
          <button
            type="button"
            onClick={() => run('evaluate')}
            disabled={pending || wants.size === 0 || giveIds.length === 0}
            className="btn btn-outline press"
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
                resetClaude();
              }}
              className="btn btn-ghost press ml-auto"
            >
              Clear
            </button>
          )}
        </div>
        {error ? (
          <p className="num text-[12px] text-fade mt-2" role="status">
            {error}
          </p>
        ) : null}
      </div>

      {result ? (
        <Offers
          result={result}
          claude={claude}
          isDynasty={isDynasty}
          partnerName={partner.name}
          leagueId={leagueId}
          week={week}
        />
      ) : null}
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
  const present = new Set(players.map((p) => (NON_IDP.has(p.position) ? p.position : 'IDP')));

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
              className={`font-mono text-[10px] font-bold px-2 py-1 min-h-[30px] border tracking-[0.08em] transition-colors ${
                filter === f ? 'bg-text text-ink border-text' : 'border-rule text-text-faint hover:text-text hover:border-text'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <ul className="max-h-[360px] lg:max-h-[440px] overflow-y-auto border-t border-rule">
        {shown.map((p) => {
          const mark = markOf(p.playerId);
          return (
            <li key={p.playerId}>
              <button
                type="button"
                onClick={() => onTap(p.playerId)}
                aria-pressed={mark !== null}
                className={`press-row w-full min-h-[44px] px-4 py-2 flex items-center gap-2.5 text-left border-b border-rule transition-colors hover:bg-ink-hover ${
                  mark === 'want' || mark === 'send' ? 'bg-accent/15' : mark === 'keep' ? 'bg-fade/10' : ''
                }`}
              >
                <PositionTag position={p.position} />
                <span
                  className={`text-[14px] truncate min-w-0 flex-1 ${
                    mark === 'want' || mark === 'send' ? 'text-signal' : mark === 'keep' ? 'text-fade' : 'text-text'
                  }`}
                >
                  {p.name}
                  <span className="num text-[9.5px] text-text-faint ml-1.5">
                    {p.pick ? (p.pick.via ? `via ${p.pick.via}` : 'own') : `${p.team ?? 'FA'}${p.age ? ` · ${p.age}` : ''}`}
                  </span>
                </span>
                <span className="num text-[10px] text-text-faint w-[46px] text-right hidden sm:inline">
                  {p.rosPoints > 0 ? `${p.rosPoints.toFixed(0)} pts` : '—'}
                </span>
                <span className="num text-[10px] text-text-dim w-[40px] text-right">
                  {p.dynastyValue > 0 ? p.dynastyValue.toLocaleString() : '—'}
                </span>
                <span className="w-[42px] flex justify-end" aria-hidden={mark === null}>
                  {mark === 'want' ? (
                    <Tag tone="accent">Want</Tag>
                  ) : mark === 'send' ? (
                    <Tag tone="accent">Send</Tag>
                  ) : mark === 'keep' ? (
                    <Tag tone="fade">Keep</Tag>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 ? (
          <li className="px-4 py-6 text-[14px] text-text-faint">
            {filter === 'PICK' ? 'No draft picks owned.' : 'Nobody at that position.'}
          </li>
        ) : null}
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
        <span className="text-[14px] text-text-faint">{empty}</span>
      </div>
    );
  }
  return (
    <div>
      <PlayerList label={trailing ? `${label} · ${trailing}` : label} players={players} tone={tone} />
    </div>
  );
}

const VERDICT_STYLE: Record<OfferVerdict, { label: string; tone: 'accent' | 'warn' | 'fade' }> = {
  accept: { label: 'Likely accepted', tone: 'accent' },
  'coin-flip': { label: 'Coin flip', tone: 'warn' },
  decline: { label: 'Likely declined', tone: 'fade' },
};

const CALL_COLOR: Record<TradeCallAction, string> = {
  send: 'var(--color-signal)',
  pitch: 'var(--color-warn)',
  'long-shot': 'var(--color-warn)',
  pass: 'var(--color-fade)',
};

function gradeColor(grade: LetterGrade): string {
  if (grade.startsWith('A') || grade.startsWith('B')) return 'var(--color-signal)';
  if (grade.startsWith('C')) return 'var(--color-warn)';
  return 'var(--color-fade)';
}

function GradeChip({ label, grade }: { label: string; grade: LetterGrade }) {
  const color = gradeColor(grade);
  return (
    <div
      className="flex flex-col items-center justify-center min-w-14 max-w-32 px-2 py-1.5 border"
      style={{ borderColor: color }}
      title={`${label}: ${grade}, judged on ${label === 'you' ? 'your' : 'their'} own objective`}
    >
      <span className="figure text-[26px] leading-none" style={{ color }}>
        {grade}
      </span>
      <span className="eyebrow text-[8px] text-text-faint mt-1 max-w-full truncate">{label}</span>
    </div>
  );
}

function Offers({
  result,
  claude,
  isDynasty,
  partnerName,
  leagueId,
  week,
}: {
  result: { mode: 'suggest' | 'evaluate'; offers: TradeOffer[] };
  claude: ClaudeOffers;
  isDynasty: boolean;
  partnerName: string;
  leagueId: string;
  week: number;
}) {
  const { mode, offers } = result;

  return (
    <div className="border-t border-rule">
      {mode === 'suggest' ? (
        <ClaudePackages claude={claude} isDynasty={isDynasty} partnerName={partnerName} leagueId={leagueId} week={week} />
      ) : null}
      <div className="px-4 py-2.5 flex items-baseline justify-between gap-4 border-b border-rule">
        <span className="eyebrow">{mode === 'evaluate' ? 'this deal, graded' : 'engine packages'}</span>
        <span className="eyebrow text-text-faint">
          {offers.length === 0 ? 'nothing' : `${offers.length} ${offers.length === 1 ? 'package' : 'packages'}`}
        </span>
      </div>

      {offers.length === 0 ? (
        <p className="px-4 py-6 text-[14px] text-text-faint leading-relaxed">
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
                  <span className="figure text-[22px] leading-none text-signal">{String(i + 1).padStart(2, '0')}</span>
                  <Tag tone={verdict.tone}>{verdict.label}</Tag>
                  <span className="ml-auto">
                    <Tag tone="muted" title="Market value you send ÷ market value you get">
                      {offer.valueRatio.toFixed(2)}× value
                    </Tag>
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
                  <div className="flex items-center gap-2">
                    <GradeChip label="you" grade={offer.grades.mine} />
                    <GradeChip label={partnerName} grade={offer.grades.theirs} />
                  </div>
                  <p
                    className="text-[15px] font-semibold leading-snug min-w-0 flex-1 basis-60"
                    style={{ color: CALL_COLOR[offer.call.action] }}
                  >
                    {offer.call.headline}
                  </p>
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

                <p className="text-[13px] text-text-faint leading-relaxed mb-2">{offer.rationale}</p>

                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  <Delta label="you" now={offer.mine.winNowDelta} future={offer.mine.futureDelta} isDynasty={isDynasty} />
                  <Delta label={partnerName} now={offer.theirs.winNowDelta} future={offer.theirs.futureDelta} isDynasty={isDynasty} />
                </div>

                <ClaudeTake key={offer.mine.gives.map((p) => p.playerId).join(',')} leagueId={leagueId} week={week} offer={offer} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ClaudePackages({
  claude,
  isDynasty,
  partnerName,
  leagueId,
  week,
}: {
  claude: ClaudeOffers;
  isDynasty: boolean;
  partnerName: string;
  leagueId: string;
  week: number;
}) {
  if (claude.status === 'idle') return null;

  return (
    <div className="border-b border-rule">
      <div className="px-4 py-2.5 flex items-baseline justify-between gap-4 border-b border-rule">
        <span className="kicker">Claude&apos;s offers</span>
        <span className="eyebrow text-text-faint">
          {claude.status === 'loading' ? 'reading both rosters…' : claude.status === 'done' ? 'graded by the engine' : ''}
        </span>
      </div>

      {claude.status === 'loading' ? (
        <p className="px-4 py-4 text-[14px] text-text-faint" aria-live="polite">
          Claude is building offers from your surplus and {partnerName}&apos;s needs. The engine&apos;s packages are
          below in the meantime.
        </p>
      ) : null}

      {claude.status === 'error' ? (
        <p className="num px-4 py-3 text-[12px] text-fade" role="status">
          {claude.message}
        </p>
      ) : null}

      {claude.status === 'done' ? (
        <>
          {claude.result.summary ? (
            <p className="px-4 pt-3 text-[15px] text-text-dim leading-relaxed">{claude.result.summary}</p>
          ) : null}
          <ul>
            {claude.result.packages.map((pkg, i) => (
              <li key={i} className="px-4 py-3.5 border-b border-rule/60 last:border-0 rise" style={{ animationDelay: `${i * 40}ms` }}>
                <p className="wide uppercase text-[17px] leading-snug mb-1">{pkg.headline}</p>
                <p className="text-[14px] text-text-dim leading-relaxed mb-3">{pkg.why}</p>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
                  <div className="flex items-center gap-2">
                    <GradeChip label="you" grade={pkg.offer.grades.mine} />
                    <GradeChip label={partnerName} grade={pkg.offer.grades.theirs} />
                  </div>
                  <p
                    className="text-[15px] font-semibold leading-snug min-w-0 flex-1 basis-60"
                    style={{ color: CALL_COLOR[pkg.offer.call.action] }}
                  >
                    {pkg.offer.call.headline}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2 items-center mb-2">
                  <PlayerList label="you send" players={pkg.offer.mine.gives} tone="fade" />
                  <span className="text-text-faint text-[14px] hidden sm:block" aria-hidden="true">
                    ⇄
                  </span>
                  <PlayerList label="you get" players={pkg.offer.mine.gets} tone="signal" />
                </div>

                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  <Delta label="you" now={pkg.offer.mine.winNowDelta} future={pkg.offer.mine.futureDelta} isDynasty={isDynasty} />
                  <Delta label={partnerName} now={pkg.offer.theirs.winNowDelta} future={pkg.offer.theirs.futureDelta} isDynasty={isDynasty} />
                </div>

                <ClaudeTake leagueId={leagueId} week={week} offer={pkg.offer} />
              </li>
            ))}
          </ul>
          {claude.result.packages.length === 0 ? (
            <p className="px-4 py-3 text-[14px] text-text-faint">None of Claude&apos;s offers checked out against the live rosters.</p>
          ) : null}
          {claude.result.rejected.length > 0 ? (
            <p className="px-4 py-2 text-[12px] text-text-faint border-t border-rule">
              Dropped {claude.result.rejected.length} that didn&apos;t check out:{' '}
              {claude.result.rejected.map((r) => `${r.headline} (${r.reason})`).join('; ')}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
