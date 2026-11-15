'use client';

import { useRef, useState } from 'react';
import type { TradeOffer } from '@/lib/engine/trades';

type Kind = 'analysis' | 'pitch';

/**
 * Claude's read on one offer, and a message to send for it.
 *
 * Both stream from /api/trades/claude as plain text. Only ids go up; the
 * server re-scores the trade itself, so what Claude reasons about is the
 * engine's numbers, not the client's.
 */
export function ClaudeTake({
  leagueId,
  week,
  offer,
}: {
  leagueId: string;
  week: number;
  offer: TradeOffer;
}) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const ask = async (next: Kind) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setKind(next);
    setText('');
    setError(null);
    setCopied(false);
    setLoading(true);

    try {
      const res = await fetch('/api/trades/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          leagueId,
          week,
          partnerRosterId: offer.partnerRosterId,
          giveIds: offer.mine.gives.map((p) => p.playerId),
          wantIds: offer.mine.gets.map((p) => p.playerId),
          kind: next,
        }),
      });

      if (!res.ok || !res.body) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error ?? `Request failed (${res.status}).`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        setText((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError('Lost the connection to Claude.');
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text.trim());
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const button =
    'press min-h-[36px] md:min-h-0 px-2.5 py-1.5 border text-[11px] tracking-wide disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => ask('analysis')}
          disabled={loading}
          aria-pressed={kind === 'analysis'}
          className={`${button} ${kind === 'analysis' ? 'border-signal/50 text-signal bg-signal/5' : 'border-rule text-text-dim hover:border-rule-bright hover:text-text'}`}
          title="Claude Opus reads the engine's numbers and both rosters"
        >
          {loading && kind === 'analysis' ? 'Claude is thinking…' : 'Ask Claude'}
        </button>
        <button
          type="button"
          onClick={() => ask('pitch')}
          disabled={loading}
          aria-pressed={kind === 'pitch'}
          className={`${button} ${kind === 'pitch' ? 'border-signal/50 text-signal bg-signal/5' : 'border-rule text-text-dim hover:border-rule-bright hover:text-text'}`}
          title="A short message to send this manager"
        >
          {loading && kind === 'pitch' ? 'Writing…' : 'Draft a pitch'}
        </button>
      </div>

      {error ? (
        <p className="num text-[10.5px] text-fade mt-2" role="status">
          {error}
        </p>
      ) : null}

      {kind && (text || loading) && !error ? (
        <div className="mt-2 border-l-2 border-signal/40 pl-3 py-1" aria-live="polite">
          <div className="eyebrow mb-1 text-text-faint">
            {kind === 'analysis' ? "claude's take" : 'message to send'}
          </div>
          {text ? (
            <p className="text-[12px] text-text-dim leading-relaxed whitespace-pre-wrap">{text.trim()}</p>
          ) : (
            <p className="text-[11.5px] text-text-faint">
              {kind === 'analysis' ? 'Reading both rosters…' : 'Drafting…'}
            </p>
          )}
          {kind === 'pitch' && text && !loading ? (
            <button
              type="button"
              onClick={copy}
              className="press mt-2 px-2 py-1 border border-rule text-[10.5px] text-text-faint hover:text-text-dim"
            >
              {copied ? 'Copied' : 'Copy message'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
