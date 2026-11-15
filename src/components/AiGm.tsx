'use client';

import { useState } from 'react';
import type { GmMove, GmResult } from '@/lib/ai/gm';
import type { LetterGrade } from '@/lib/engine/trades';
import { Panel, PositionTag } from '@/components/primitives';
import { PlayerList, Delta } from '@/components/TradePieces';
import { ClaudeTake } from '@/components/ClaudeTake';
import { readStructured } from '@/lib/ai/readStructured';

/**
 * Claude looks at the whole league and says what to do.
 *
 * One request, roughly half a minute: Opus reads every roster, the engine's
 * trade ideas and the waiver board. Every move it returns has already been
 * checked server-side against the live rosters, and trades carry the engine's
 * grades — Claude's reasoning on top, the engine's math underneath.
 */
export function AiGm({ leagueId, week, isDynasty }: { leagueId: string; week: number; isDynasty: boolean }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GmResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/trades/gm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, week }),
      });
      const out = await readStructured<GmResult>(res);
      if (out.ok) setResult(out.data);
      else setError(out.error);
    } catch {
      setError('Lost the connection to Claude.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel
      title="AI suggested moves"
      accent
      meta={
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="press normal-case tracking-normal min-h-[36px] md:min-h-0 px-3 py-1.5 border border-signal/50 bg-signal/10 text-signal text-[11.5px] disabled:opacity-50 disabled:cursor-wait"
        >
          {loading ? 'Claude is reading the league…' : result ? 'Ask again' : 'Get suggestions'}
        </button>
      }
    >
      {!result && !loading && !error ? (
        <p className="px-4 py-4 text-[11.5px] text-text-faint leading-relaxed max-w-3xl">
          Claude reads every roster in the league, each team&apos;s record and standing, the engine&apos;s trade ideas
          and the waiver board, then names the few moves that would help your team most. Every trade it suggests is
          checked against the live rosters and graded by the engine before it shows up here. Takes about half a minute.
        </p>
      ) : null}

      {loading ? (
        <p className="px-4 py-4 text-[11.5px] text-text-faint" aria-live="polite">
          Reading {isDynasty ? 'rosters, picks' : 'rosters'}, records and the waiver board…
        </p>
      ) : null}

      {error ? (
        <p className="num px-4 py-4 text-[11px] text-fade" role="status">
          {error}
        </p>
      ) : null}

      {result && !loading ? (
        <div>
          {result.summary ? (
            <p className="px-4 py-3 text-[12.5px] text-text-dim leading-relaxed border-b border-rule">{result.summary}</p>
          ) : null}
          <ol>
            {result.moves.map((move, i) => (
              <MoveRow key={i} index={i} move={move} leagueId={leagueId} week={week} isDynasty={isDynasty} />
            ))}
          </ol>
          {result.moves.length === 0 ? (
            <p className="px-4 py-4 text-[12px] text-text-faint">No moves survived the roster check. Try again.</p>
          ) : null}
          {result.rejected.length > 0 ? (
            <p className="px-4 py-2.5 text-[10.5px] text-text-faint border-t border-rule/60">
              Dropped {result.rejected.length} suggestion{result.rejected.length === 1 ? '' : 's'} that didn&apos;t check
              out: {result.rejected.map((r) => `${r.headline} (${r.reason})`).join('; ')}
            </p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

const KIND_LABEL: Record<GmMove['kind'], string> = { trade: 'TRADE', waiver: 'WAIVER', note: 'PLAN' };

function gradeColor(grade: LetterGrade): string {
  if (grade.startsWith('A') || grade.startsWith('B')) return 'var(--color-signal)';
  if (grade.startsWith('C')) return 'var(--color-warn)';
  return 'var(--color-fade)';
}

function MoveRow({
  index,
  move,
  leagueId,
  week,
  isDynasty,
}: {
  index: number;
  move: GmMove;
  leagueId: string;
  week: number;
  isDynasty: boolean;
}) {
  return (
    <li className="px-4 py-3.5 border-b border-rule/60 last:border-0 rise" style={{ animationDelay: `${index * 40}ms` }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="num text-[10px] text-text-faint">{String(index + 1).padStart(2, '0')}</span>
        <span className="num text-[9px] px-1.5 py-0.5 border border-rule-bright text-text-faint tracking-wider">
          {KIND_LABEL[move.kind]}
        </span>
        {move.kind === 'trade' ? (
          <span className="num text-[10px] ml-auto text-text-faint">
            engine:{' '}
            <span style={{ color: gradeColor(move.offer.grades.mine) }}>you {move.offer.grades.mine}</span>
            {' · '}
            <span style={{ color: gradeColor(move.offer.grades.theirs) }}>
              {move.offer.partnerName} {move.offer.grades.theirs}
            </span>
          </span>
        ) : null}
      </div>

      <p className="text-[13px] text-text font-medium leading-snug mb-1">{move.headline}</p>
      <p className="text-[11.5px] text-text-dim leading-relaxed mb-2">{move.why}</p>

      {move.kind === 'trade' ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2 items-center mb-2">
            <PlayerList label="you send" players={move.offer.mine.gives} tone="fade" />
            <span className="text-text-faint text-[14px] hidden sm:block" aria-hidden="true">
              ⇄
            </span>
            <PlayerList label={`you get from ${move.offer.partnerName}`} players={move.offer.mine.gets} tone="signal" />
          </div>
          <p className="text-[11px] text-text-faint leading-relaxed mb-1">{move.offer.call.headline}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <Delta label="you" now={move.offer.mine.winNowDelta} future={move.offer.mine.futureDelta} isDynasty={isDynasty} />
            <Delta
              label={move.offer.partnerName}
              now={move.offer.theirs.winNowDelta}
              future={move.offer.theirs.futureDelta}
              isDynasty={isDynasty}
            />
          </div>
          <ClaudeTake leagueId={leagueId} week={week} offer={move.offer} />
        </>
      ) : null}

      {move.kind === 'waiver' ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px]">
          <span className="inline-flex items-center gap-1.5">
            <span className="eyebrow">add</span>
            <PositionTag position={move.waiver.add.position} />
            <span className="text-signal">{move.waiver.add.name}</span>
          </span>
          {move.drop ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="eyebrow">drop</span>
              <PositionTag position={move.drop.position} />
              <span className="text-text-dim">{move.drop.name}</span>
            </span>
          ) : null}
          {move.waiver.bid !== null ? <span className="num text-[11px] text-text-faint">bid ${move.waiver.bid}</span> : null}
        </div>
      ) : null}
    </li>
  );
}
