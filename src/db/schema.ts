import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
  serial,
} from 'drizzle-orm/pg-core';

/**
 * Sleeper's `scoring_settings` is a flat map of stat-key -> points-per-unit
 * (e.g. { rush_yd: 0.1, rec: 1, pass_td: 4, bonus_rec_te: 0.5 }).
 *
 * Critically, Sleeper's *projection* payloads use the SAME stat keys. That lets
 * us compute exact league-specific projected points as a dot product rather
 * than relying on a generic PPR number. See lib/engine/scoring.ts.
 */
export type ScoringSettings = Record<string, number>;

/** Raw or projected stat line, keyed identically to ScoringSettings. */
export type StatLine = Record<string, number>;

// ---------------------------------------------------------------------------
// Leagues & rosters
// ---------------------------------------------------------------------------

export const leagues = pgTable('leagues', {
  /** Sleeper league_id (string snowflake). */
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  season: text('season').notNull(),
  seasonType: text('season_type'),
  status: text('status'),
  avatar: text('avatar'),
  totalRosters: integer('total_rosters').notNull(),

  /** Sleeper settings.type: 0 = redraft, 1 = keeper, 2 = dynasty. */
  leagueType: integer('league_type').notNull().default(0),
  /** Derived: leagueType === 2 (or keeper w/ taxi). Drives the dual-score weighting. */
  isDynasty: boolean('is_dynasty').notNull().default(false),
  /** Derived from roster_positions containing SUPER_FLEX or 2x QB. */
  isSuperflex: boolean('is_superflex').notNull().default(false),
  /** Derived from scoring_settings.rec: 0 = std, 0.5 = half, 1 = full ppr. */
  pprType: real('ppr_type').notNull().default(0),

  scoringSettings: jsonb('scoring_settings').$type<ScoringSettings>().notNull(),
  /** Ordered slot list, e.g. ["QB","RB","RB","WR","WR","TE","FLEX","K","DEF","BN",...]. */
  rosterPositions: jsonb('roster_positions').$type<string[]>().notNull(),
  /** Raw Sleeper settings blob: taxi_slots, taxi_years, taxi_deadline, reserve_slots, ... */
  settings: jsonb('settings').$type<Record<string, number>>().notNull(),

  /** Denormalized from settings for fast slot accounting. */
  taxiSlots: integer('taxi_slots').notNull().default(0),
  taxiYears: integer('taxi_years').notNull().default(0),
  taxiDeadline: integer('taxi_deadline').notNull().default(0),
  taxiAllowVets: integer('taxi_allow_vets').notNull().default(0),
  reserveSlots: integer('reserve_slots').notNull().default(0),

  previousLeagueId: text('previous_league_id'),
  importedAt: timestamp('imported_at').notNull().defaultNow(),
  syncedAt: timestamp('synced_at'),
});

export const leagueUsers = pgTable(
  'league_users',
  {
    leagueId: text('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    displayName: text('display_name'),
    teamName: text('team_name'),
    avatar: text('avatar'),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.userId] })],
);

export const rosters = pgTable(
  'rosters',
  {
    leagueId: text('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    rosterId: integer('roster_id').notNull(),
    ownerId: text('owner_id'),
    /** Every player owned: starters + bench + taxi + reserve. */
    players: jsonb('players').$type<string[]>().notNull().default([]),
    /** Ordered to match leagues.rosterPositions starting slots. */
    starters: jsonb('starters').$type<string[]>().notNull().default([]),
    taxi: jsonb('taxi').$type<string[]>().notNull().default([]),
    reserve: jsonb('reserve').$type<string[]>().notNull().default([]),
    /** wins, losses, ties, fpts, fpts_against, waiver_budget_used, ... */
    settings: jsonb('settings').$type<Record<string, number>>().notNull().default({}),
    syncedAt: timestamp('synced_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.rosterId] })],
);

/** Which roster in each league belongs to the user. */
export const myTeams = pgTable('my_teams', {
  leagueId: text('league_id')
    .primaryKey()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  rosterId: integer('roster_id').notNull(),
  sleeperUserId: text('sleeper_user_id'),
});

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export const players = pgTable(
  'players',
  {
    /** Sleeper player_id. Also the join key for projections and FantasyCalc. */
    id: text('id').primaryKey(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    fullName: text('full_name'),
    position: text('position'),
    fantasyPositions: jsonb('fantasy_positions').$type<string[]>(),
    team: text('team'),
    age: real('age'),
    yearsExp: integer('years_exp'),
    status: text('status'),
    injuryStatus: text('injury_status'),
    injuryBodyPart: text('injury_body_part'),
    injuryNotes: text('injury_notes'),
    depthChartPosition: text('depth_chart_position'),
    depthChartOrder: integer('depth_chart_order'),
    /** Sleeper's global popularity rank; lower = more relevant. Used to scope syncs. */
    searchRank: integer('search_rank'),
    byeWeek: integer('bye_week'),
    number: integer('number'),
    active: boolean('active').notNull().default(true),
    newsUpdated: timestamp('news_updated'),
    syncedAt: timestamp('synced_at').notNull().defaultNow(),
  },
  (t) => [
    index('players_position_idx').on(t.position),
    index('players_team_idx').on(t.team),
    index('players_search_rank_idx').on(t.searchRank),
  ],
);

// ---------------------------------------------------------------------------
// Projections — layer 1 (base) of the three-layer stack
// ---------------------------------------------------------------------------

export const projections = pgTable(
  'projections',
  {
    playerId: text('player_id').notNull(),
    season: text('season').notNull(),
    week: integer('week').notNull(),
    /** 'sleeper' (Rotowire). Room for additional providers behind ProjectionProvider. */
    source: text('source').notNull().default('sleeper'),
    /** Full component stat line, scored per-league downstream. */
    stats: jsonb('stats').$type<StatLine>().notNull(),
    opponent: text('opponent'),
    team: text('team'),
    gameId: text('game_id'),
    fetchedAt: timestamp('fetched_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.playerId, t.season, t.week, t.source] }),
    index('projections_season_week_idx').on(t.season, t.week),
  ],
);

/** Rest-of-season / full-season projections, used for waivers and dynasty math. */
export const seasonProjections = pgTable(
  'season_projections',
  {
    playerId: text('player_id').notNull(),
    season: text('season').notNull(),
    source: text('source').notNull().default('sleeper'),
    stats: jsonb('stats').$type<StatLine>().notNull(),
    fetchedAt: timestamp('fetched_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.season, t.source] })],
);

// ---------------------------------------------------------------------------
// Market data — layers 2 (game lines) and 3 (player props)
// ---------------------------------------------------------------------------

/**
 * Layer 2. DraftKings spread/total relayed free by ESPN's core API.
 * impliedHomePts/impliedAwayPts are derived: total/2 -/+ spread/2.
 */
export const gameOdds = pgTable(
  'game_odds',
  {
    id: serial('id').primaryKey(),
    season: text('season').notNull(),
    week: integer('week').notNull(),
    /** ESPN event id. */
    gameId: text('game_id').notNull(),
    homeTeam: text('home_team').notNull(),
    awayTeam: text('away_team').notNull(),
    /** Negative = home favored, matching ESPN's convention. */
    spread: real('spread'),
    total: real('total'),
    moneylineHome: integer('moneyline_home'),
    moneylineAway: integer('moneyline_away'),
    impliedHomePts: real('implied_home_pts'),
    impliedAwayPts: real('implied_away_pts'),
    book: text('book').notNull().default('draftkings'),
    kickoff: timestamp('kickoff'),
    capturedAt: timestamp('captured_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('game_odds_unique_idx').on(t.gameId, t.book),
    index('game_odds_season_week_idx').on(t.season, t.week),
  ],
);

/**
 * Layer 3. Player props, de-vigged. `impliedMean` is the fantasy-usable
 * expectation derived from the line (yardage line -> mean; anytime-TD
 * probability -> expected TDs).
 */
export const playerProps = pgTable(
  'player_props',
  {
    id: serial('id').primaryKey(),
    playerId: text('player_id').notNull(),
    season: text('season').notNull(),
    week: integer('week').notNull(),
    /** Maps onto a Sleeper stat key: rush_yd, rec, rec_yd, pass_yd, pass_td, anytime_td... */
    market: text('market').notNull(),
    line: real('line'),
    overOdds: integer('over_odds'),
    underOdds: integer('under_odds'),
    /** Vig removed. */
    fairProb: real('fair_prob'),
    impliedMean: real('implied_mean'),
    book: text('book').notNull(),
    capturedAt: timestamp('captured_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('player_props_unique_idx').on(t.playerId, t.season, t.week, t.market, t.book),
    index('player_props_season_week_idx').on(t.season, t.week),
  ],
);

/**
 * Blend weights per position per layer, FIT BY BACKTEST against nflverse
 * actuals — never hardcoded. If the market layer doesn't beat the base, its
 * weight comes out near zero and we can see that.
 */
export const blendWeights = pgTable(
  'blend_weights',
  {
    position: text('position').notNull(),
    layer: text('layer').notNull(), // 'base' | 'market' | 'props'
    weight: real('weight').notNull(),
    mae: real('mae'),
    fitSeason: text('fit_season').notNull(),
    fitAt: timestamp('fit_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.position, t.layer, t.fitSeason] })],
);

// ---------------------------------------------------------------------------
// Dynasty market values
// ---------------------------------------------------------------------------

/**
 * FantasyCalc values. `shapeKey` encodes the league shape the values were
 * pulled for (e.g. "dyn-1qb-12tm-1ppr") since values differ materially between
 * superflex and 1QB.
 */
export const marketValues = pgTable(
  'market_values',
  {
    playerId: text('player_id').notNull(),
    source: text('source').notNull().default('fantasycalc'),
    shapeKey: text('shape_key').notNull(),
    dynastyValue: integer('dynasty_value'),
    redraftValue: integer('redraft_value'),
    overallRank: integer('overall_rank'),
    positionRank: integer('position_rank'),
    trend30Day: integer('trend_30_day'),
    tier: integer('tier'),
    fetchedAt: timestamp('fetched_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.source, t.shapeKey] })],
);

/** Rookie draft pick values, also from FantasyCalc (e.g. "2026 Pick 1.01"). */
export const pickValues = pgTable(
  'pick_values',
  {
    label: text('label').notNull(),
    shapeKey: text('shape_key').notNull(),
    season: integer('season'),
    round: integer('round'),
    slot: integer('slot'),
    value: integer('value').notNull(),
    fetchedAt: timestamp('fetched_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.label, t.shapeKey] })],
);

// ---------------------------------------------------------------------------
// League activity
// ---------------------------------------------------------------------------

export const matchups = pgTable(
  'matchups',
  {
    leagueId: text('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    week: integer('week').notNull(),
    rosterId: integer('roster_id').notNull(),
    /** Sleeper's matchup_id pairs two rosters together. */
    matchupId: integer('matchup_id'),
    points: real('points'),
    starters: jsonb('starters').$type<string[]>(),
    playersPoints: jsonb('players_points').$type<Record<string, number>>(),
    syncedAt: timestamp('synced_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.week, t.rosterId] })],
);

export const transactions = pgTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    leagueId: text('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    week: integer('week'),
    type: text('type'),
    status: text('status'),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at'),
  },
  (t) => [index('transactions_league_idx').on(t.leagueId)],
);

// ---------------------------------------------------------------------------
// Alerting
// ---------------------------------------------------------------------------

/**
 * Point-in-time record of a player's league-scored projection. Diffing against
 * the latest snapshot is what powers "projection dropped 4.2 pts since Tuesday".
 */
export const projSnapshots = pgTable(
  'proj_snapshots',
  {
    id: serial('id').primaryKey(),
    leagueId: text('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    playerId: text('player_id').notNull(),
    week: integer('week').notNull(),
    scoredPts: real('scored_pts').notNull(),
    capturedAt: timestamp('captured_at').notNull().defaultNow(),
  },
  (t) => [index('proj_snapshots_lookup_idx').on(t.leagueId, t.playerId, t.week)],
);

export const alerts = pgTable(
  'alerts',
  {
    id: serial('id').primaryKey(),
    leagueId: text('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    severity: text('severity').notNull().default('info'), // info | warn | critical
    playerId: text('player_id'),
    week: integer('week'),
    title: text('title').notNull(),
    body: text('body'),
    /** Stable key so a re-run of the scheduler doesn't duplicate an open alert. */
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    readAt: timestamp('read_at'),
  },
  (t) => [
    uniqueIndex('alerts_dedupe_idx').on(t.leagueId, t.dedupeKey),
    index('alerts_league_created_idx').on(t.leagueId, t.createdAt),
  ],
);

/** Bookkeeping so schedulers can skip work that's already fresh. */
export const syncState = pgTable('sync_state', {
  key: text('key').primaryKey(),
  lastRunAt: timestamp('last_run_at'),
  lastOkAt: timestamp('last_ok_at'),
  detail: text('detail'),
});
