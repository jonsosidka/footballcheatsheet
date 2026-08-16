import type { ReactNode } from 'react';

export function Panel({
  title,
  meta,
  children,
  className = '',
  accent = false,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  accent?: boolean;
}) {
  return (
    <section
      className={`bg-ink-card border border-rule relative ${className}`}
      style={accent ? { boxShadow: 'inset 0 1px 0 rgba(201,242,77,0.14)' } : undefined}
    >
      <header className="flex items-baseline justify-between gap-4 px-4 py-2.5 border-b border-rule">
        <h2 className="eyebrow">{title}</h2>
        {meta ? <div className="eyebrow text-text-faint">{meta}</div> : null}
      </header>
      {children}
    </section>
  );
}

/**
 * The signature element: a compact visual of how far the betting market moved
 * a projection off its base. Direction is encoded in both colour and the side
 * the bar grows toward, so it reads at a glance in a dense column.
 */
export function MarketShift({ delta, max = 2.5 }: { delta: number | null; max?: number }) {
  if (delta === null || Math.abs(delta) < 0.05) {
    return <span className="inline-block w-[76px] text-center text-text-faint num text-[10px]">—</span>;
  }

  const up = delta > 0;
  const width = Math.min(100, (Math.abs(delta) / max) * 100);

  return (
    <span className="inline-flex items-center gap-1.5 w-[76px]">
      <span className="relative flex-1 h-[3px] bg-rule overflow-hidden">
        <span
          className="sweep absolute top-0 h-full"
          style={{
            width: `${width}%`,
            left: up ? '50%' : undefined,
            right: up ? undefined : '50%',
            background: up ? 'var(--color-signal)' : 'var(--color-fade)',
          }}
        />
        <span className="absolute top-0 left-1/2 h-full w-px bg-rule-bright" />
      </span>
      <span
        className="num text-[10px] tabular-nums w-[34px] text-right"
        style={{ color: up ? 'var(--color-signal)' : 'var(--color-fade)' }}
      >
        {up ? '+' : ''}
        {delta.toFixed(1)}
      </span>
    </span>
  );
}

const POSITION_TONE: Record<string, string> = {
  QB: 'text-[#ff8fa3] border-[#ff8fa3]/25 bg-[#ff8fa3]/8',
  RB: 'text-[#7ee0b8] border-[#7ee0b8]/25 bg-[#7ee0b8]/8',
  WR: 'text-[#7cc4ff] border-[#7cc4ff]/25 bg-[#7cc4ff]/8',
  TE: 'text-[#ffc46b] border-[#ffc46b]/25 bg-[#ffc46b]/8',
  K: 'text-[#c4a8ff] border-[#c4a8ff]/25 bg-[#c4a8ff]/8',
  DEF: 'text-[#8fa3b8] border-[#8fa3b8]/25 bg-[#8fa3b8]/8',
  IDP: 'text-[#b8f0e0] border-[#b8f0e0]/25 bg-[#b8f0e0]/8',
  LB: 'text-[#b8f0e0] border-[#b8f0e0]/25 bg-[#b8f0e0]/8',
  DL: 'text-[#a0d8c8] border-[#a0d8c8]/25 bg-[#a0d8c8]/8',
  DE: 'text-[#a0d8c8] border-[#a0d8c8]/25 bg-[#a0d8c8]/8',
  DB: 'text-[#d0e8b8] border-[#d0e8b8]/25 bg-[#d0e8b8]/8',
};

export function PositionTag({ position }: { position: string }) {
  const tone = POSITION_TONE[position] ?? 'text-[#9aa1ab] border-[#9aa1ab]/25 bg-[#9aa1ab]/8';
  return (
    <span className={`num text-[9px] px-1.5 py-0.5 border tracking-wider ${tone}`}>{position}</span>
  );
}

export function InjuryTag({ status }: { status: string | null }) {
  if (!status) return null;
  const critical = /out|ir|injured|pup|suspend/i.test(status);
  return (
    <span
      className="num text-[9px] px-1 py-0.5 border tracking-wider"
      style={{
        color: critical ? 'var(--color-crit)' : 'var(--color-warn)',
        borderColor: critical ? 'rgba(255,77,106,0.3)' : 'rgba(255,179,64,0.3)',
        background: critical ? 'rgba(255,77,106,0.08)' : 'rgba(255,179,64,0.08)',
      }}
    >
      {status.slice(0, 3).toUpperCase()}
    </span>
  );
}

export function Stat({
  label,
  value,
  unit,
  tone = 'default',
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'default' | 'signal' | 'fade' | 'warn';
  sub?: ReactNode;
}) {
  const color =
    tone === 'signal'
      ? 'var(--color-signal)'
      : tone === 'fade'
        ? 'var(--color-fade)'
        : tone === 'warn'
          ? 'var(--color-warn)'
          : 'var(--color-text)';

  return (
    <div>
      <div className="eyebrow mb-2">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="num text-[2.75rem] leading-none tracking-tight" style={{ color }}>
          {value}
        </span>
        {unit ? <span className="eyebrow text-text-faint">{unit}</span> : null}
      </div>
      {sub ? <div className="mt-2 text-[11px] text-text-dim leading-snug">{sub}</div> : null}
    </div>
  );
}
