/**
 * Alert rules.
 *
 * The bar for raising an alert is "would this change what you do in the next
 * hour". Anything softer trains you to ignore the feed, which costs more than
 * the missed alert would have.
 *
 * Every alert carries a stable dedupeKey so a scheduler re-run updates rather
 * than duplicates.
 */

export type AlertType =
  | 'injury-change'
  | 'projection-move'
  | 'starting-inactive'
  | 'lineup-suboptimal'
  | 'waiver-target'
  | 'taxi-deadline'
  | 'roster-over-limit';

export interface Alert {
  type: AlertType;
  severity: 'info' | 'warn' | 'critical';
  playerId: string | null;
  week: number;
  title: string;
  body: string;
  dedupeKey: string;
}

export interface AlertPlayer {
  playerId: string;
  name: string;
  position: string;
  injuryStatus: string | null;
  status: string | null;
  points: number;
  /** Previously recorded league-scored projection, if we have one. */
  previousPoints: number | null;
  isStarting: boolean;
}

/** Statuses that mean the player will not play. */
const NOT_PLAYING = new Set(['Out', 'IR', 'Injured Reserve', 'PUP', 'Suspended', 'NFI', 'DNP']);

export interface AlertInput {
  week: number;
  players: AlertPlayer[];
  /** Points recoverable by fixing the lineup. */
  pointsLeftOnBench: number;
  topChange: { incoming: string; outgoing: string | null; slot: string; gain: number } | null;
  /** Slot moves already computed by the roster engine. */
  slotMoves: Array<{ type: string; severity: 'info' | 'warn' | 'critical'; title: string; detail: string; playerId: string | null }>;
  waiverTargets: Array<{ name: string; position: string; trendingAdds: number; winNowDelta: number }>;
}

/** Minimum projection swing worth interrupting someone for. */
export const PROJECTION_MOVE_THRESHOLD = 2.5;
/** Minimum recoverable points before we call a lineup suboptimal. */
export const LINEUP_GAP_THRESHOLD = 1.0;

export function buildAlerts(input: AlertInput): Alert[] {
  const alerts: Alert[] = [];
  const { week } = input;

  for (const player of input.players) {
    // A starter who is not going to play is the single most costly mistake.
    if (player.isStarting && isNotPlaying(player)) {
      alerts.push({
        type: 'starting-inactive',
        severity: 'critical',
        playerId: player.playerId,
        week,
        title: `${player.name} is ${player.injuryStatus ?? player.status} and in your lineup`,
        body: `You are starting ${player.name} (${player.position}) but he is listed ${
          player.injuryStatus ?? player.status
        }. Replace him before kickoff or you take a zero.`,
        dedupeKey: `inactive:${week}:${player.playerId}`,
      });
      continue;
    }

    if (player.isStarting && player.injuryStatus && !isNotPlaying(player)) {
      alerts.push({
        type: 'injury-change',
        severity: 'warn',
        playerId: player.playerId,
        week,
        title: `${player.name} is ${player.injuryStatus}`,
        body: `${player.name} (${player.position}) carries a ${player.injuryStatus} tag and is in your starting lineup. Watch for a downgrade before kickoff.`,
        dedupeKey: `injury:${week}:${player.playerId}:${player.injuryStatus}`,
      });
    }

    if (player.previousPoints !== null) {
      const delta = player.points - player.previousPoints;
      if (Math.abs(delta) >= PROJECTION_MOVE_THRESHOLD) {
        alerts.push({
          type: 'projection-move',
          severity: player.isStarting ? 'warn' : 'info',
          playerId: player.playerId,
          week,
          title: `${player.name} ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(1)} pts`,
          body: `${player.name} moved from ${player.previousPoints.toFixed(1)} to ${player.points.toFixed(
            1,
          )} since the last check${player.isStarting ? ' and he is in your lineup' : ''}.`,
          // Bucket the delta so a drifting projection doesn't re-alert every hour.
          dedupeKey: `projmove:${week}:${player.playerId}:${Math.round(delta)}`,
        });
      }
    }
  }

  if (input.pointsLeftOnBench >= LINEUP_GAP_THRESHOLD && input.topChange) {
    const change = input.topChange;
    alerts.push({
      type: 'lineup-suboptimal',
      severity: input.pointsLeftOnBench >= 5 ? 'warn' : 'info',
      playerId: null,
      week,
      title: `${input.pointsLeftOnBench.toFixed(1)} pts sitting on your bench`,
      body: `Start ${change.incoming} over ${change.outgoing ?? 'the empty slot'} at ${change.slot} for +${change.gain.toFixed(
        1,
      )}.`,
      dedupeKey: `lineup:${week}:${Math.round(input.pointsLeftOnBench * 2)}`,
    });
  }

  for (const move of input.slotMoves) {
    if (move.severity === 'info') continue; // slot hygiene isn't alert-worthy
    alerts.push({
      type: move.type === 'taxi-deadline' ? 'taxi-deadline' : 'roster-over-limit',
      severity: move.severity,
      playerId: move.playerId,
      week,
      title: move.title,
      body: move.detail,
      dedupeKey: `slot:${week}:${move.type}:${move.playerId ?? 'roster'}`,
    });
  }

  for (const target of input.waiverTargets.slice(0, 2)) {
    if (target.trendingAdds < 10_000 || target.winNowDelta <= 0) continue;
    alerts.push({
      type: 'waiver-target',
      severity: 'info',
      playerId: null,
      week,
      title: `${target.name} is being added everywhere`,
      body: `${target.trendingAdds.toLocaleString()} adds in 24h and he projects +${target.winNowDelta.toFixed(
        1,
      )} over your weakest ${target.position}.`,
      dedupeKey: `waiver:${week}:${target.name}`,
    });
  }

  const order = { critical: 0, warn: 1, info: 2 } as const;
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

function isNotPlaying(player: AlertPlayer): boolean {
  return (
    (player.injuryStatus !== null && NOT_PLAYING.has(player.injuryStatus)) ||
    (player.status !== null && NOT_PLAYING.has(player.status))
  );
}
