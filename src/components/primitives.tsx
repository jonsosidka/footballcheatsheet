import type { ReactNode } from 'react';

/*
 * The Supply Co. kit. Every page is built from these, and /kit shows each one
 * in both themes — change a piece here and the kit is the place to look.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** "[01] THE MOVES" — the bracketed section head. */
export function SectionHead({
  index,
  title,
  meta,
  className = '',
}: {
  index?: number;
  title: string;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${className}`}>
      <h2 className="kicker">
        {index !== undefined ? `[${pad(index)}] ` : ''}
        {title}
      </h2>
      {meta ? <div className="eyebrow text-right">{meta}</div> : null}
    </div>
  );
}

/**
 * An open section: a head and its content, divided from the next by a rule.
 * The dashboard is laid out from these.
 */
export function Section({
  index,
  title,
  meta,
  children,
  className = '',
}: {
  index?: number;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`py-6 border-b border-rule last:border-b-0 ${className}`}>
      <SectionHead index={index} title={title} meta={meta} className="mb-3.5" />
      {children}
    </section>
  );
}

/**
 * A boxed section: the same head inside a hairline frame. For denser pages
 * where several sit side by side. `accent` gives the frame the ink colour, as
 * the first of the moves has.
 */
export function Panel({
  index,
  title,
  meta,
  children,
  className = '',
  accent = false,
}: {
  index?: number;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  accent?: boolean;
}) {
  return (
    <section className={`border ${accent ? 'border-text' : 'border-rule'} relative ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 border-b border-rule">
        <h2 className="kicker">
          {index !== undefined ? `[${pad(index)}] ` : ''}
          {title}
        </h2>
        {meta ? <div className="eyebrow">{meta}</div> : null}
      </header>
      {children}
    </section>
  );
}

/**
 * The page's opening statement: a mono kicker, a headline in the wide face
 * whose second line is drawn in outline, a line of plain explanation, and an
 * optional right-hand column (the chrome figure on My Team).
 */
export function PageHero({
  kicker,
  title,
  children,
  aside,
}: {
  kicker: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="flex flex-wrap border-b border-rule">
      <div
        className={`flex-[3_1_520px] min-w-0 py-7 sm:py-9 flex flex-col gap-4 sm:gap-[18px] ${
          aside ? 'md:pr-6 md:border-r border-rule' : ''
        }`}
      >
        <div className="eyebrow">{kicker}</div>
        <h1 className="display text-[clamp(2.75rem,8.5vw,4.75rem)] break-words">{title}</h1>
        {children ? (
          <div className="max-w-[460px] text-[15px] sm:text-base leading-normal text-text-dim">{children}</div>
        ) : null}
      </div>
      {aside ? (
        <div className="@container flex-[2_1_340px] min-w-0 pb-7 md:py-9 md:pl-6 relative flex flex-col justify-between gap-[22px] border-t md:border-t-0 border-rule pt-7">
          {aside}
        </div>
      ) : null}
    </section>
  );
}

/** Big chrome number with its label, for the one figure a page is about. */
export function ChromeFigure({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="figure chrome-text text-[clamp(3.5rem,21cqi,7rem)] leading-[0.9] tracking-[-0.04em] whitespace-nowrap">{value}</div>
      {children ? <div className="num text-[13px] mt-2 text-text-dim">{children}</div> : null}
    </div>
  );
}

/** Tilted holographic disc. Decoration that carries one real number. */
export function Sticker({ value, label, className = '' }: { value: string; label: string; className?: string }) {
  return (
    <div
      className={`w-[84px] h-[84px] lg:w-[112px] lg:h-[112px] rounded-full -rotate-[14deg] flex flex-col items-center justify-center
        text-[#0b0b0c] shadow-[0_8px_24px_rgba(0,0,0,0.35)] select-none ${className}`}
      style={{ background: 'var(--holo)' }}
    >
      <span className="figure text-[20px] lg:text-[26px] leading-none tracking-[-0.04em]">{value}</span>
      <span className="font-mono text-[8px] lg:text-[9px] font-bold tracking-[0.2em] mt-0.5">{label}</span>
    </div>
  );
}

/** A grid of label-over-value cells joined by hairlines. */
export function SpecGrid({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <div className="grid border border-rule" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item, i) => (
        <div key={item.label} className={`px-3 py-2.5 min-w-0 ${i < items.length - 1 ? 'border-r border-rule' : ''}`}>
          <div className="eyebrow text-[10px] tracking-[0.1em]">{item.label}</div>
          <div className="wide text-[17px] mt-1 uppercase truncate">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

/** Deterministic barcode from any string, so each league and week has its own. */
export function Barcode({ seed, height = 34 }: { seed: string; height?: number }) {
  let h = 2166136261;
  const bars: Array<{ w: number; tall: boolean }> = [];
  for (let i = 0; i < 30; i++) {
    h ^= seed.charCodeAt(i % Math.max(seed.length, 1)) + i;
    h = Math.imul(h, 16777619) >>> 0;
    bars.push({ w: (h % 4) + 1, tall: i % 7 === 0 });
  }
  return (
    <span className="flex items-end gap-[2px]" style={{ height }} aria-hidden="true">
      {bars.map((bar, i) => (
        <span
          key={i}
          className="block bg-text"
          style={{ width: bar.w, height: bar.tall ? height : height - 6 }}
        />
      ))}
    </span>
  );
}

/** Barcode plus its SKU line and the katakana mark. */
export function Label({ seed, sku }: { seed: string; sku: string }) {
  return (
    <div className="flex items-end gap-3">
      <Barcode seed={seed} />
      <span className="font-mono text-[10px] text-text-faint tracking-[0.1em] leading-[1.4]">
        SKU {sku}
        <br />
        チートシート
      </span>
    </div>
  );
}

/** The lime release strip that runs above the header. */
export function DropStrip({ items }: { items: string[] }) {
  const line = ['CHEATSHEET® FANTASY SUPPLY CO.', ...items, 'EST. 2026'];
  const text = [...line, ...line].join(' /// ');
  return (
    <div className="bg-accent text-on-accent font-mono text-[11px] font-bold tracking-[0.18em] uppercase whitespace-nowrap overflow-hidden py-[7px] chrome">
      <span className="pl-4">{`${text} ///`}</span>
    </div>
  );
}

/**
 * A numbered call to action: "01  McBride in. Kittle out.  +13.4  [OPEN →]".
 * The first one on a page gets the ink frame.
 */
export function ActionCard({
  index,
  title,
  detail,
  value,
  action,
  emphasis = false,
}: {
  index: number;
  title: ReactNode;
  detail?: ReactNode;
  value?: ReactNode;
  action?: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <li className={`flex flex-wrap items-center gap-4 p-4 border list-none ${emphasis ? 'border-text' : 'border-rule'}`}>
      <span className="figure text-[34px] leading-none text-signal">{pad(index)}</span>
      <div className="flex-[1_1_280px] min-w-0">
        <div className="wide text-[18px] uppercase">{title}</div>
        {detail ? (
          <div className="font-mono text-[11px] text-text-faint mt-1 uppercase tracking-[0.04em]">{detail}</div>
        ) : null}
      </div>
      {value !== undefined ? <span className="figure text-[24px]">{value}</span> : null}
      {action}
    </li>
  );
}

/** "TAXI ......... 3/4" — a label, a dotted leader, a value. */
export function LeaderLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 font-mono text-[12px] leading-[1.9] text-text-dim">
      <span className="uppercase">{label}</span>
      <span className="flex-1 border-b border-dotted border-rule-bright -translate-y-1" aria-hidden="true" />
      <span className="text-text">{value}</span>
    </div>
  );
}

type TagTone = 'accent' | 'solid' | 'outline' | 'muted' | 'crit' | 'warn' | 'fade';

const TAG_TONE: Record<TagTone, string> = {
  accent: 'bg-accent text-on-accent border-accent',
  solid: 'bg-text text-ink border-text',
  outline: 'border-text text-text',
  muted: 'border-rule-bright text-text-faint',
  crit: 'bg-crit text-ink border-crit',
  warn: 'bg-warn text-ink border-warn',
  fade: 'border-fade text-fade',
};

/** Small square mono label. */
export function Tag({ tone = 'muted', children, title }: { tone?: TagTone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center font-mono text-[9px] font-bold leading-none tracking-[0.1em] uppercase
        px-[5px] py-[3px] border whitespace-nowrap ${TAG_TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export function PositionTag({ position }: { position: string }) {
  return (
    <span
      className="inline-flex items-center justify-center font-mono text-[9.5px] font-bold leading-none tracking-[0.08em]
        min-w-[30px] px-1 py-[3px] border border-rule-bright text-text-dim"
    >
      {position}
    </span>
  );
}

/**
 * Status chip. `playStatus` is the resolved verdict from the availability
 * engine — pass it so a bye shows up here too, and so "critical" means the
 * same thing on screen as it does in the optimizer.
 */
export function InjuryTag({
  status,
  playStatus,
}: {
  status: string | null;
  playStatus?: 'active' | 'questionable' | 'doubtful' | 'out' | 'bye';
}) {
  if (playStatus === 'bye') return <Tag tone="crit">BYE</Tag>;
  if (!status) return null;
  const critical =
    playStatus === 'out' || playStatus === 'doubtful' || /out|ir|injured|pup|suspend/i.test(status);
  const label = /^q/i.test(status) ? 'Q' : /^d/i.test(status) ? 'D' : status.slice(0, 3).toUpperCase();
  return <Tag tone={critical ? 'crit' : 'warn'}>{label}</Tag>;
}

/** Label over a figure in the headline face. */
export function Stat({
  label,
  value,
  unit,
  tone = 'default',
  sub,
  size = 'lg',
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'default' | 'signal' | 'fade' | 'warn';
  sub?: ReactNode;
  size?: 'lg' | 'sm';
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
    <div className="min-w-0">
      <div className="eyebrow mb-1.5">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span
          className={`figure leading-none ${size === 'lg' ? 'text-[2rem] sm:text-[2.5rem]' : 'text-[1.0625rem]'}`}
          style={{ color }}
        >
          {value}
        </span>
        {unit ? <span className="eyebrow">{unit}</span> : null}
      </div>
      {sub ? <div className="mt-1.5 text-[12px] text-text-faint leading-snug">{sub}</div> : null}
    </div>
  );
}

/** Up/down figure: lime arrow up, orange arrow down. */
export function Trend({ value, digits = 0 }: { value: number; digits?: number }) {
  const up = value >= 0;
  return (
    <span className="num font-bold" style={{ color: up ? 'var(--color-signal)' : 'var(--color-fade)' }}>
      {up ? '↑' : '↓'} {Math.abs(value).toFixed(digits)}
    </span>
  );
}

/** A two-ended bar for a projection moved by the market, kept for the kit. */
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
      </span>
      <span
        className="num text-[10px] w-[34px] text-right"
        style={{ color: up ? 'var(--color-signal)' : 'var(--color-fade)' }}
      >
        {up ? '+' : ''}
        {delta.toFixed(1)}
      </span>
    </span>
  );
}

/** Centered message for a page or panel with nothing to show. */
export function EmptyState({
  kicker,
  title,
  children,
  action,
}: {
  kicker: string;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="py-16 sm:py-24 max-w-xl">
      <div className="eyebrow mb-4">{kicker}</div>
      <h2 className="display text-[clamp(2.25rem,6vw,3.5rem)] mb-4">{title}</h2>
      {children ? <div className="text-[15px] text-text-dim leading-relaxed mb-6">{children}</div> : null}
      {action}
    </div>
  );
}

/** A details row that keeps "how this works" one tap away instead of on screen. */
export function HowItWorks({ children }: { children: ReactNode }) {
  return (
    <details className="group border-t border-rule">
      <summary className="list-none cursor-pointer py-3 flex items-center justify-between eyebrow hover:text-text focus-ring">
        <span>How this is ranked</span>
        <span className="font-mono text-[13px] group-open:rotate-45 transition-transform" aria-hidden="true">
          +
        </span>
      </summary>
      <div className="pb-4 space-y-2.5 text-[13px] text-text-faint leading-relaxed max-w-2xl">{children}</div>
    </details>
  );
}
