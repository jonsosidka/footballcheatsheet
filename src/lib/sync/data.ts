import { db } from '@/db';
import {
  players,
  projections,
  seasonProjections,
  gameOdds,
  marketValues,
  pickValues,
  syncState,
} from '@/db/schema';
import { sql } from 'drizzle-orm';
import {
  getAllPlayers,
  getWeeklyProjections,
  getSeasonProjections,
  hasRealProjection,
} from '@/lib/sources/sleeper';
import { getWeekGameLines, SEASON_TYPE } from '@/lib/sources/espn-odds';
import { getValues, shapeKey, type LeagueShape } from '@/lib/sources/fantasycalc';

/**
 * Sync jobs for the shared (non-league-specific) data.
 *
 * Split by cost so the schedulers can put each in the right place:
 *   syncPlayers        ~14MB, daily, background function only
 *   syncProjections    ~6 requests, hourly, fits the 30s scheduled budget
 *   syncGameOdds       ~17 requests, hourly
 *   syncMarketValues   1 request per league shape, daily
 */

const BATCH = 500;

/** Chunked insert — Neon's HTTP driver has a statement size ceiling. */
async function insertInBatches<T>(rows: T[], write: (chunk: T[]) => Promise<unknown>): Promise<number> {
  for (let i = 0; i < rows.length; i += BATCH) {
    await write(rows.slice(i, i + BATCH));
  }
  return rows.length;
}

/**
 * Collapse rows that share a primary key, keeping the last occurrence.
 *
 * Necessary because we fetch projections one position group at a time and
 * Sleeper lists multi-eligible players in more than one group — a linebacker
 * also tagged DL, or an RB with WR eligibility. Postgres rejects an
 * INSERT ... ON CONFLICT DO UPDATE whose batch contains the same key twice
 * ("cannot affect row a second time"), so this has to happen before the write.
 */
function dedupeBy<T>(rows: T[], key: (row: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) byKey.set(key(row), row);
  return [...byKey.values()];
}

export async function syncPlayers(): Promise<number> {
  const dump = await getAllPlayers();

  const rows = Object.values(dump)
    // The dump includes every player Sleeper has ever known. Keep the ones that
    // can actually appear on a fantasy roster.
    .filter((player) => player.player_id && player.position)
    .map((player) => ({
      id: player.player_id,
      firstName: player.first_name,
      lastName: player.last_name,
      fullName:
        player.full_name ?? ([player.first_name, player.last_name].filter(Boolean).join(' ') || null),
      position: player.position,
      fantasyPositions: player.fantasy_positions ?? null,
      team: player.team,
      age: player.age,
      yearsExp: player.years_exp,
      status: player.status,
      injuryStatus: player.injury_status,
      injuryBodyPart: player.injury_body_part,
      injuryNotes: player.injury_notes,
      depthChartPosition: player.depth_chart_position,
      depthChartOrder: player.depth_chart_order,
      searchRank: player.search_rank,
      number: player.number,
      active: player.active ?? true,
      newsUpdated: player.news_updated ? new Date(player.news_updated) : null,
      syncedAt: new Date(),
    }));

  const deduped = dedupeBy(rows, (row) => row.id);

  await insertInBatches(deduped, (chunk) =>
    db
      .insert(players)
      .values(chunk)
      .onConflictDoUpdate({
        target: players.id,
        set: {
          team: sql`excluded.team`,
          age: sql`excluded.age`,
          yearsExp: sql`excluded.years_exp`,
          status: sql`excluded.status`,
          injuryStatus: sql`excluded.injury_status`,
          injuryBodyPart: sql`excluded.injury_body_part`,
          injuryNotes: sql`excluded.injury_notes`,
          depthChartPosition: sql`excluded.depth_chart_position`,
          depthChartOrder: sql`excluded.depth_chart_order`,
          searchRank: sql`excluded.search_rank`,
          active: sql`excluded.active`,
          newsUpdated: sql`excluded.news_updated`,
          syncedAt: sql`excluded.synced_at`,
        },
      }),
  );

  await markSynced('players', `${deduped.length} players`);
  return deduped.length;
}

export async function syncWeeklyProjections(
  season: string,
  week: number,
  positions?: string[],
): Promise<number> {
  const raw = await getWeeklyProjections(season, week, positions);
  const useful = raw.filter(hasRealProjection);

  const rows = useful.map((projection) => ({
    playerId: projection.player_id,
    season,
    week,
    source: 'sleeper' as const,
    stats: projection.stats,
    team: projection.team,
    opponent: projection.opponent,
    gameId: projection.game_id,
    fetchedAt: new Date(),
  }));

  const deduped = dedupeBy(rows, (row) => `${row.playerId}|${row.season}|${row.week}|${row.source}`);

  await insertInBatches(deduped, (chunk) =>
    db
      .insert(projections)
      .values(chunk)
      .onConflictDoUpdate({
        target: [projections.playerId, projections.season, projections.week, projections.source],
        set: {
          stats: sql`excluded.stats`,
          team: sql`excluded.team`,
          opponent: sql`excluded.opponent`,
          gameId: sql`excluded.game_id`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      }),
  );

  await markSynced(`projections:${season}:${week}`, `${deduped.length} projections`);
  return deduped.length;
}

export async function syncSeasonProjections(season: string, positions?: string[]): Promise<number> {
  const raw = await getSeasonProjections(season, positions);
  const useful = raw.filter(hasRealProjection);

  const rows = useful.map((projection) => ({
    playerId: projection.player_id,
    season,
    source: 'sleeper' as const,
    stats: projection.stats,
    fetchedAt: new Date(),
  }));

  const deduped = dedupeBy(rows, (row) => `${row.playerId}|${row.season}|${row.source}`);

  await insertInBatches(deduped, (chunk) =>
    db
      .insert(seasonProjections)
      .values(chunk)
      .onConflictDoUpdate({
        target: [seasonProjections.playerId, seasonProjections.season, seasonProjections.source],
        set: { stats: sql`excluded.stats`, fetchedAt: sql`excluded.fetched_at` },
      }),
  );

  await markSynced(`season-projections:${season}`, `${deduped.length} rows`);
  return deduped.length;
}

export async function syncGameOdds(
  season: string,
  week: number,
  seasonType: number = SEASON_TYPE.regular,
): Promise<number> {
  const lines = await getWeekGameLines(season, week, seasonType);
  const usable = lines.filter((line) => line.total !== null || line.spread !== null);

  if (usable.length === 0) {
    await markSynced(`odds:${season}:${week}`, 'no lines posted yet');
    return 0;
  }

  await insertInBatches(
    usable.map((line) => ({
      season: line.season,
      week: line.week,
      gameId: line.gameId,
      homeTeam: line.homeTeam,
      awayTeam: line.awayTeam,
      spread: line.spread,
      total: line.total,
      moneylineHome: line.moneylineHome,
      moneylineAway: line.moneylineAway,
      impliedHomePts: line.impliedHomePts,
      impliedAwayPts: line.impliedAwayPts,
      book: line.book,
      kickoff: line.kickoff,
      capturedAt: new Date(),
    })),
    (chunk) =>
      db
        .insert(gameOdds)
        .values(chunk)
        .onConflictDoUpdate({
          target: [gameOdds.gameId, gameOdds.book],
          set: {
            spread: sql`excluded.spread`,
            total: sql`excluded.total`,
            moneylineHome: sql`excluded.moneyline_home`,
            moneylineAway: sql`excluded.moneyline_away`,
            impliedHomePts: sql`excluded.implied_home_pts`,
            impliedAwayPts: sql`excluded.implied_away_pts`,
            capturedAt: sql`excluded.captured_at`,
          },
        }),
  );

  await markSynced(`odds:${season}:${week}`, `${usable.length} games`);
  return usable.length;
}

export async function syncMarketValues(shape: LeagueShape): Promise<number> {
  const key = shapeKey(shape);
  const { players: valueRows, picks } = await getValues(shape);

  if (valueRows.length > 0) {
    await insertInBatches(
      valueRows.map((value) => ({
        playerId: value.sleeperId,
        source: 'fantasycalc' as const,
        shapeKey: key,
        dynastyValue: value.dynastyValue,
        redraftValue: value.redraftValue,
        overallRank: value.overallRank,
        positionRank: value.positionRank,
        trend30Day: value.trend30Day,
        tier: value.tier,
        fetchedAt: new Date(),
      })),
      (chunk) =>
        db
          .insert(marketValues)
          .values(chunk)
          .onConflictDoUpdate({
            target: [marketValues.playerId, marketValues.source, marketValues.shapeKey],
            set: {
              dynastyValue: sql`excluded.dynasty_value`,
              redraftValue: sql`excluded.redraft_value`,
              overallRank: sql`excluded.overall_rank`,
              positionRank: sql`excluded.position_rank`,
              trend30Day: sql`excluded.trend_30_day`,
              tier: sql`excluded.tier`,
              fetchedAt: sql`excluded.fetched_at`,
            },
          }),
    );
  }

  if (picks.length > 0) {
    await insertInBatches(
      picks.map((pick) => ({
        label: pick.label,
        shapeKey: key,
        season: pick.season,
        round: pick.round,
        slot: pick.slot,
        value: pick.value,
        fetchedAt: new Date(),
      })),
      (chunk) =>
        db
          .insert(pickValues)
          .values(chunk)
          .onConflictDoUpdate({
            target: [pickValues.label, pickValues.shapeKey],
            set: { value: sql`excluded.value`, fetchedAt: sql`excluded.fetched_at` },
          }),
    );
  }

  await markSynced(`values:${key}`, `${valueRows.length} players, ${picks.length} picks`);
  return valueRows.length;
}

export async function markSynced(key: string, detail?: string): Promise<void> {
  const now = new Date();
  await db
    .insert(syncState)
    .values({ key, lastRunAt: now, lastOkAt: now, detail: detail ?? null })
    .onConflictDoUpdate({
      target: syncState.key,
      set: { lastRunAt: now, lastOkAt: now, detail: detail ?? null },
    });
}
