'use client';

import { useState } from 'react';
import type { GmMove, GmResult } from '@/lib/ai/gm';
import type { LetterGrade } from '@/lib/engine/trades';
import { Panel, PositionTag, Tag } from '@/components/primitives';
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
      index={1}
      title="Claude's moves"
      accent
      meta={
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="btn btn-primary press disabled:cursor-wait"
        >
          {loading ? 'Reading the league…' : result ? 'Ask again →' : 'Get suggestions →'}
        </button>
      }
    >
      {!result && !loading && !error ? (
        <p className="px-4 py-4 text-[14px] text-text-faint leading-relaxed max-w-3xl">
          Claude reads every roster, record and the waiver board, then names the few moves that would help you most.
          Every trade is checked against the live rosters and graded for both sides. Takes about half a minute.
        </p>
      ) : null}

      {loading ? (
        <p className="px-4 py-4 font-mono text-[11px] tracking-[0.08em] uppercase text-text-faint pulse" aria-live="polite">
          Reading {isDynasty ? 'rosters, picks' : 'rosters'}, records and the waiver board…
        </p>
      ) : null}

      {error ? (
        <p className="num px-4 py-4 text-[12px] text-fade" role="status">
          {error}
        </p>
      ) : null}

      {result && !loading ? (
        <div>
          {result.summary ? (
            <p className="px-4 py-3 text-[15px] text-text-dim leading-relaxed border-b border-rule">{result.summary}</p>
          ) : null}
          <ol>
            {result.moves.map((move, i) => (
              <MoveRow key={i} index={i} move={move} leagueId={leagueId} week={week} isDynasty={isDynasty} />
            ))}
          </ol>
          {result.moves.length === 0 ? (
            <p className="px-4 py-4 text-[14px] text-text-faint">None of Claude&apos;s moves checked out against the live rosters. Ask again.</p>
          ) : null}
          {result.rejected.length > 0 ? (
            <p className="px-4 py-2.5 text-[12px] text-text-faint border-t border-rule">
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
        <span className="figure text-[22px] leading-none text-signal">{String(index + 1).padStart(2, '0')}</span>
        <Tag tone={move.kind === 'trade' ? 'solid' : move.kind === 'waiver' ? 'accent' : 'muted'}>{KIND_LABEL[move.kind]}</Tag>
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

      <p className="wide uppercase text-[17px] leading-snug mb-1">{move.headline}</p>
      <p className="text-[14px] text-text-dim leading-relaxed mb-2">{move.why}</p>

      {move.kind === 'trade' ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2 items-center mb-2">
            <PlayerList label="you send" players={move.offer.mine.gives} tone="fade" />
            <span className="text-text-faint text-[14px] hidden sm:block" aria-hidden="true">
              ⇄
            </span>
            <PlayerList label={`you get from ${move.offer.partnerName}`} players={move.offer.mine.gets} tone="signal" />
          </div>
          <p className="text-[13px] text-text-faint leading-relaxed mb-1">{move.offer.call.headline}</p>
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
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[14px]">
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
