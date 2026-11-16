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

  const button = 'btn press !min-h-[2.25rem]';

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => ask('analysis')}
          disabled={loading}
          aria-pressed={kind === 'analysis'}
          className={`${button} ${kind === 'analysis' ? 'btn-primary' : 'btn-outline'}`}
          title="Claude Opus reads the engine's numbers and both rosters"
        >
          {loading && kind === 'analysis' ? 'Claude is thinking…' : 'Ask Claude'}
        </button>
        <button
          type="button"
          onClick={() => ask('pitch')}
          disabled={loading}
          aria-pressed={kind === 'pitch'}
          className={`${button} ${kind === 'pitch' ? 'btn-primary' : 'btn-outline'}`}
          title="A short message to send this manager"
        >
          {loading && kind === 'pitch' ? 'Writing…' : 'Draft a pitch'}
        </button>
      </div>

      {error ? (
        <p className="num text-[12px] text-fade mt-2" role="status">
          {error}
        </p>
      ) : null}

      {kind && (text || loading) && !error ? (
        <div className="mt-3 border border-rule p-3" aria-live="polite">
          <div className="eyebrow mb-1.5">
            {kind === 'analysis' ? "claude's take" : 'message to send'}
          </div>
          {text ? (
            <p className="text-[14px] text-text-dim leading-relaxed whitespace-pre-wrap">{text.trim()}</p>
          ) : (
            <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-text-faint pulse">
              {kind === 'analysis' ? 'Reading both rosters…' : 'Drafting…'}
            </p>
          )}
          {kind === 'pitch' && text && !loading ? (
            <button
              type="button"
              onClick={copy}
              className="btn btn-outline press mt-3 !min-h-[2.25rem]"
            >
              {copied ? 'Copied' : 'Copy message'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
