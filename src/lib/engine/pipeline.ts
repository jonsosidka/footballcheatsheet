import type { ScoringSettings, StatLine } from '@/db/schema';
import { scoreProjection } from './scoring';
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
 * Assemble the three projection layers into a single league-scored number.
 *
 * Layer 1 (base) always exists. Layers 2 and 3 are applied where the data
 * supports them and are simply absent otherwise — a player with no game line
 * and no props still gets a usable projection, which is what keeps waiver-wire
 * coverage complete.
 */

/** Conservative starting weights; the backtest overwrites these per position. */
export const DEFAULT_WEIGHTS: LayerWeights = { base: 0.35, market: 0.45, props: 0.2 };

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
}

export interface ProjectedPlayer {
  playerId: string;
  position: string;
  team: string | null;
  opponent: string | null;
  /** Final blended, league-scored projection. */
  points: number;
  basePoints: number;
  marketPoints: number | null;
  propPoints: number | null;
  /** Which layers actually contributed. */
  layers: Array<'base' | 'market' | 'props'>;
  impliedTeamPoints: number | null;
  spread: number | null;
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

  return inputs.map((input) => {
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

    const points = blend({ base: basePoints, market: marketPoints, props: propPoints }, weights);

    return {
      playerId: input.playerId,
      position: input.position,
      team: input.team,
      opponent: odds?.opponent ?? null,
      points,
      basePoints,
      marketPoints,
      propPoints,
      layers,
      impliedTeamPoints: odds?.impliedPoints ?? null,
      spread: odds?.spread ?? null,
    };
  });
}

/**
 * Explain how the layers moved a projection, for the UI's "why" panel.
 * Returns null when only the base layer was available — there's nothing to say.
 */
export function explainLayers(player: ProjectedPlayer): string | null {
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
