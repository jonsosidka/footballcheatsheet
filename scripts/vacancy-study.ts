/**
 * Does the next man up actually score more?
 *
 *   npx tsx scripts/vacancy-study.ts [firstSeason] [lastSeason]
 *
 * The evidence behind src/lib/engine/vacancy.ts. Pools nflverse weekly actuals
 * and compares the second-most-used player at a team/position in weeks the lead
 * man played against weeks he did not. Nothing here touches Sleeper, so it runs
 * anywhere with network access to nflverse.
 *
 * The layer ships RB and TE multipliers and deliberately ships nothing for WR.
 * Re-run this before changing those numbers — the point is to measure the
 * thesis, not to assert it, the same bar that put the market layer at zero.
 */
import './_env';
import fs from 'node:fs';
import path from 'node:path';

const CACHE = path.join(process.cwd(), '.vacancy-cache');
const POSITIONS = ['RB', 'WR', 'TE'] as const;

/** A lead man must carry this much prior usage to count as a starter. */
const MIN_STARTER_USAGE = 12;
/** ...and must be this far clear of his backup for the depth chart to be real. */
const LEAD_RATIO = 1.3;
/** Weeks of usage history used to rank the depth chart going into a week. */
const LOOKBACK = 3;

/**
 * Split one CSV line, respecting double quotes.
 *
 * A plain split on commas silently shifts every column after the first quoted
 * field that contains one — nflverse headshot URLs do — and the shift is not
 * obvious: you get a season_type of "1" and a study that quietly discards
 * 99.99% of its rows rather than an error.
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      // A doubled quote inside a quoted field is one literal quote.
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.replace(/\r$/, ''));
  return fields;
}

interface Row {
  playerId: string;
  name: string;
  position: string;
  team: string;
  week: number;
  usage: number;
  points: number;
}

async function seasonRows(season: number): Promise<Row[]> {
  const file = path.join(CACHE, `${season}.csv`);
  let csv: string;

  if (fs.existsSync(file)) {
    csv = fs.readFileSync(file, 'utf8');
  } else {
    const url = `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`nflverse ${season}: ${response.status}`);
    csv = await response.text();
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(file, csv);
  }

  const lines = csv.trim().split('\n');
  const header = splitCsvLine(lines[0]);
  const at = (name: string) => header.indexOf(name);
  const idx = {
    playerId: at('player_id'),
    name: at('player_display_name'),
    position: at('position'),
    team: at('team'),
    week: at('week'),
    seasonType: at('season_type'),
    carries: at('carries'),
    targets: at('targets'),
    points: at('fantasy_points_ppr'),
  };

  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols[idx.seasonType] !== 'REG') continue;
    const position = cols[idx.position];
    if (!POSITIONS.includes(position as (typeof POSITIONS)[number])) continue;

    const num = (column: number) => {
      const value = Number(cols[column]);
      return Number.isFinite(value) ? value : 0;
    };

    rows.push({
      playerId: cols[idx.playerId],
      name: cols[idx.name],
      position,
      // Namespaced by season so a team's depth chart never spans two years.
      team: `${season}:${cols[idx.team]}`,
      week: Number(cols[idx.week]),
      usage: num(idx.carries) + num(idx.targets),
      points: num(idx.points),
    });
  }
  return rows;
}

function study(rows: Row[]) {
  const groupKey = (team: string, position: string, week: number) => `${team}|${position}|${week}`;

  const byWeek = new Map<string, Row[]>();
  for (const row of rows) {
    const key = groupKey(row.team, row.position, row.week);
    const list = byWeek.get(key);
    if (list) list.push(row);
    else byWeek.set(key, [row]);
  }

  // Usage over the previous LOOKBACK weeks, which is the depth chart as it
  // stood going INTO each week — not hindsight.
  const prior = new Map<string, Map<string, number>>();
  for (const row of rows) {
    for (let ahead = 1; ahead <= LOOKBACK; ahead++) {
      const key = groupKey(row.team, row.position, row.week + ahead);
      const usage = prior.get(key) ?? new Map<string, number>();
      usage.set(row.playerId, (usage.get(row.playerId) ?? 0) + row.usage);
      prior.set(key, usage);
    }
  }

  const withStarter: Record<string, number[]> = { RB: [], WR: [], TE: [] };
  const withoutStarter: Record<string, number[]> = { RB: [], WR: [], TE: [] };

  for (const [key, usage] of prior) {
    const [, position, weekText] = key.split('|');
    const week = Number(weekText);
    if (week <= LOOKBACK || week > 18) continue;

    const ranked = [...usage.entries()].sort((a, b) => b[1] - a[1]);
    const [starter, backup] = ranked;
    if (!starter || !backup) continue;
    if (starter[1] < MIN_STARTER_USAGE || starter[1] < backup[1] * LEAD_RATIO) continue;

    const played = byWeek.get(key) ?? [];
    const backupRow = played.find((row) => row.playerId === backup[0]);
    if (!backupRow) continue; // the backup has to have suited up himself

    const starterPlayed = played.some((row) => row.playerId === starter[0]);
    (starterPlayed ? withStarter : withoutStarter)[position].push(backupRow.points);
  }

  return { withStarter, withoutStarter };
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

function variance(values: number[]): number {
  const m = mean(values);
  return values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
}

/** Welch's t: the samples are different sizes with different spreads. */
function welchT(a: number[], b: number[]): number {
  const se = Math.sqrt(variance(a) / a.length + variance(b) / b.length);
  return se > 0 ? (mean(b) - mean(a)) / se : 0;
}

async function main() {
  const first = Number(process.argv[2] ?? 2021);
  const last = Number(process.argv[3] ?? 2025);

  const rows: Row[] = [];
  for (let season = first; season <= last; season++) {
    process.stdout.write(`fetching ${season}... `);
    const seasonData = await seasonRows(season);
    rows.push(...seasonData);
    console.log(`${seasonData.length} player-weeks`);
  }

  const { withStarter, withoutStarter } = study(rows);

  console.log(`\nNext man up, PPR points, ${first}-${last}`);
  console.log('pos   starter plays          starter out            lift        t');

  for (const position of POSITIONS) {
    const a = withStarter[position];
    const b = withoutStarter[position];
    if (b.length < 15) {
      console.log(`${position.padEnd(6)}too few vacancies to say anything (n=${b.length})`);
      continue;
    }
    const lift = mean(b) - mean(a);
    const t = welchT(a, b);
    console.log(
      `${position.padEnd(6)}${mean(a).toFixed(2).padStart(6)} (n=${String(a.length).padStart(4)})` +
        `${mean(b).toFixed(2).padStart(10)} (n=${String(b.length).padStart(3)})` +
        `${(lift >= 0 ? '+' : '')}${lift.toFixed(2).padStart(8)}${t.toFixed(2).padStart(9)}` +
        `${Math.abs(t) >= 2 ? '  significant' : '  NOT significant'}`,
    );
    console.log(`       implied multiplier ${(mean(b) / mean(a)).toFixed(2)}x`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
