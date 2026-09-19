import { PositionTag } from '@/components/primitives';

/**
 * The atoms a trade is drawn with, shared by the finder's list and the
 * builder's results so a package reads the same wherever it appears.
 */

export function PlayerList({
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

export function Delta({
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
