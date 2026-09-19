import type { ScoringSettings, StatLine } from '@/db/schema';
import { scoreProjection } from './scoring';
import { FULLY_AVAILABLE, type Availability, type PlayStatus } from './availability';
import { findPromotions, applyPromotion, type Promotion } from './vacancy';
import {
  applyMarketLayer,
  applyPropLayer,
  baseImpliedTeamPoints,
  blend,
  normalizeRatio,
  type LayerWeights,
  type PropInput,
} from './market';

/**
 * Assemble the three projection layers into a single league-scored number,
 * then apply the availability haircut.
 *
 * Layer 1 (base) always exists. Layers 2 and 3 are applied where the data
 * supports them and are simply absent otherwise — a player with no game line
 * and no props still gets a usable projection, which is what keeps waiver-wire
 * coverage complete.
 *
 * Availability is not a layer in the same sense: it is a multiplier applied
 * last, to whatever the layers produced. A player who is out scores zero
 * regardless of how good his matchup is, so it has to sit outside the blend
 * rather than argue with it inside.
 */

/**
 * Layer weights, set by the backtest — NOT by the original hypothesis.
 *
 * The market layer is weighted ZERO because it failed validation against 2,624
 * player-weeks of 2025 actuals (scripts/backtest.ts):
 *
 *   - MAE: base 5.477 vs market 5.509. The best blend improved MAE by 0.05%,
 *     and the bootstrap 95% CI on that difference was [-0.007, +0.013] —
 *     it includes zero.
 *   - Start/sit: across 71,614 same-position pairs where the two layers picked
 *     different players, the base was right 51.10% of the time and the market
 *     layer 48.90%. On the decision that actually matters, it was worse.
 *   - Holdout: per-position weights fit on weeks 1-9 held up on weeks 10-14 for
 *     only 2 of 4 positions, with lifts under 0.4%.
 *
 * The most likely explanation is that Rotowire already prices game totals into
 * its projections, so re-applying them double-counts the same information and
 * adds noise instead of signal.
 *
 * The market code is deliberately kept: implied team totals and spreads remain
 * useful *context* for a human reading a matchup, and the layer is ready to be
 * re-weighted the moment a backtest justifies it. But it does not move the
 * number we show.
 */
export const DEFAULT_WEIGHTS: LayerWeights = { base: 1, market: 0, props: 0 };

export interface TeamOdds {
  /** Market-implied points for this team. */
  impliedPoints: number | null;
  /** This team's own spread (negative = favored). */
  spread: number | null;
  opponent: string | null;
}

export interface PlayerProjectionInput {
  playerId: string;
  position: string;
  team: string | null;
  stats: StatLine;
  props?: PropInput[];
  /**
   * Injury/bye status for the week. Omitted means "no reason to doubt him" —
   * callers that know the status are expected to pass it, since a missing
   * status and a healthy one are indistinguishable here by design.
   */
  availability?: Availability;
}

export interface ProjectedPlayer {
  playerId: string;
  position: string;
  team: string | null;
  opponent: string | null;
  /** Final blended, league-scored projection, after the availability cut. */
  points: number;
  /** What he would be projected for if he were healthy and playing. */
  healthyPoints: number;
  basePoints: number;
  marketPoints: number | null;
  propPoints: number | null;
  /** Which layers actually contributed. */
  layers: Array<'base' | 'market' | 'props'>;
  impliedTeamPoints: number | null;
  spread: number | null;
  playStatus: PlayStatus;
  /** Set when he inherits a ruled-out teammate's role this week. */
  promotion: Promotion | null;
  /** The fraction of `healthyPoints` that survived. */
  availabilityMultiplier: number;
  /** False for ruled-out and bye players: never put him in a starting slot. */
  startable: boolean;
  /** Why the projection was cut, null when it wasn't. */
  availabilityNote: string | null;
}

export interface PipelineOptions {
  scoring: ScoringSettings;
  /** Team abbreviation -> market context for the week. */
  oddsByTeam: Map<string, TeamOdds>;
  weights?: LayerWeights;
  /** Per-position weight overrides fit by the backtest. */
  weightsByPosition?: Map<string, LayerWeights>;
}

/**
 * Run the full stack over a set of players.
 *
 * The market layer needs each team's *aggregate* base projection to know how
 * far the market disagrees, so players are grouped by team first. That's why
 * this operates on a batch rather than one player at a time.
 */
export function projectPlayers(
  inputs: PlayerProjectionInput[],
  options: PipelineOptions,
): ProjectedPlayer[] {
  const { scoring, oddsByTeam } = options;

  // Aggregate base team points once per team.
  const statsByTeam = new Map<string, StatLine[]>();
  for (const input of inputs) {
    if (!input.team) continue;
    const list = statsByTeam.get(input.team);
    if (list) list.push(input.stats);
    else statsByTeam.set(input.team, [input.stats]);
  }

  const baseTeamPoints = new Map<string, number>();
  for (const [team, stats] of statsByTeam) {
    baseTeamPoints.set(team, baseImpliedTeamPoints(stats));
  }

  // Center the market adjustment on the league median so only relative
  // matchup quality moves projections. Without this, the systematic gap
  // between our partial base-points estimate and real team totals pushes
  // every player in the league in the same direction.
  const ratios: number[] = [];
  for (const [team, base] of baseTeamPoints) {
    const implied = oddsByTeam.get(team)?.impliedPoints;
    if (base > 0 && implied !== null && implied !== undefined) ratios.push(implied / base);
  }
  const normalization = normalizeRatio(ratios);

  const projected = inputs.map((input) => {
    const odds = input.team ? oddsByTeam.get(input.team) : undefined;
    const basePoints = scoreProjection(input.stats, scoring);
    const layers: Array<'base' | 'market' | 'props'> = ['base'];

    // --- Layer 2: market game context -------------------------------------
    let marketStats: StatLine | null = null;
    let marketPoints: number | null = null;
    const teamBase = input.team ? baseTeamPoints.get(input.team) ?? 0 : 0;

    if (odds && odds.impliedPoints !== null && teamBase > 0) {
      marketStats = applyMarketLayer(input.stats, {
        impliedTeamPoints: odds.impliedPoints,
        baseTeamPoints: teamBase,
        teamSpread: odds.spread ?? 0,
        normalization,
      });
      marketPoints = scoreProjection(marketStats, scoring);
      layers.push('market');
    }

    // --- Layer 3: player props --------------------------------------------
    let propPoints: number | null = null;
    if (input.props && input.props.length > 0) {
      // Props are applied on top of the market-adjusted line where available,
      // so a player with only a rushing prop keeps market-adjusted receiving.
      const propStats = applyPropLayer(marketStats ?? input.stats, input.props);
      const scored = scoreProjection(propStats, scoring);
      // applyPropLayer returns the input untouched when nothing was usable.
      if (scored !== (marketPoints ?? basePoints)) {
        propPoints = scored;
        layers.push('props');
      }
    }

    const weights =
      options.weightsByPosition?.get(input.position) ?? options.weights ?? DEFAULT_WEIGHTS;

    const healthyPoints = blend(
      { base: basePoints, market: marketPoints, props: propPoints },
      weights,
    );

    // --- Availability: applied last, to the blended number ------------------
    const availability = input.availability ?? FULLY_AVAILABLE;
    const points = round2(healthyPoints * availability.multiplier);

    return {
      playerId: input.playerId,
      position: input.position,
      team: input.team,
      opponent: odds?.opponent ?? null,
      points,
      healthyPoints,
      basePoints,
      marketPoints,
      propPoints,
      layers,
      impliedTeamPoints: odds?.impliedPoints ?? null,
      spread: odds?.spread ?? null,
      playStatus: availability.playStatus,
      promotion: null as Promotion | null,
      availabilityMultiplier: availability.multiplier,
      startable: availability.startable,
      availabilityNote: availability.reason,
    };
  });

  /*
   * --- Vacancy: who inherits a ruled-out teammate's role --------------------
   *
   * A second pass because it is the only adjustment that depends on OTHER
   * players: you cannot know a back has been promoted until you know the man
   * ahead of him is out. Runs after availability for the same reason — the
   * absence has to be resolved before the opening exists.
   */
  const promotions = findPromotions(projected);
  if (promotions.size === 0) return projected;

  for (const player of projected) {
    const promotion = promotions.get(player.playerId);
    if (!promotion) continue;
    player.promotion = promotion;
    player.points = applyPromotion(player.healthyPoints, promotion) * player.availabilityMultiplier;
    player.points = round2(player.points);
  }

  return projected;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Explain how the layers moved a projection, for the UI's "why" panel.
 * Returns null when only the base layer was available — there's nothing to say.
 */
export function explainLayers(player: ProjectedPlayer): string | null {
  // A promotion is the most actionable thing we can say about a projection,
  // and it is the one number here that does not come from the feed.
  if (player.promotion !== null) {
    return (
      `${player.promotion.reason} Projection raised from ${player.healthyPoints.toFixed(1)} to ` +
      `${player.points.toFixed(1)} — players promoted into this role have historically scored ` +
      `${Math.round((player.promotion.multiplier - 1) * 100)}% more.`
    );
  }

  // Availability is the headline when it applies — it explains the number far
  // more than a 0.3-point matchup nudge ever does.
  if (player.availabilityNote !== null) {
    const cut =
      player.availabilityMultiplier === 0
        ? `${player.healthyPoints.toFixed(1)} projected if he played, but he is not.`
        : `Cut from ${player.healthyPoints.toFixed(1)} to ${player.points.toFixed(1)}.`;
    return `${player.availabilityNote} ${cut}`;
  }

  if (player.layers.length <= 1) return null;

  const parts: string[] = [`Base projection ${player.basePoints.toFixed(1)}.`];

  if (player.marketPoints !== null && player.impliedTeamPoints !== null) {
    const direction = player.marketPoints > player.basePoints ? 'up' : 'down';
    const favored = player.spread !== null && player.spread < 0;
    parts.push(
      `Market implies ${player.impliedTeamPoints.toFixed(1)} team points` +
        (player.spread !== null
          ? ` (${favored ? 'favored by' : 'underdog by'} ${Math.abs(player.spread)})`
          : '') +
        `, adjusting ${direction} to ${player.marketPoints.toFixed(1)}.`,
    );
  }

  if (player.propPoints !== null) {
    parts.push(`Player props put him at ${player.propPoints.toFixed(1)}.`);
  }

  parts.push(`Blended: ${player.points.toFixed(1)}.`);
  return parts.join(' ');
}
