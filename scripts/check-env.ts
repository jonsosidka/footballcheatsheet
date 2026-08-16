/**
 * Verify the local environment is wired up correctly.
 *
 *   npm run check
 *
 * Checks each variable, actually connects to Neon, and reports which
 * projection layers are available given what's configured.
 */
import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';

config({ path: '.env.local' });

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const ok = (msg: string) => console.log(`${GREEN}  ok${RESET}   ${msg}`);
const warn = (msg: string) => console.log(`${YELLOW}  warn${RESET} ${msg}`);
const fail = (msg: string) => console.log(`${RED}  FAIL${RESET} ${msg}`);
const hint = (msg: string) => console.log(`${DIM}       ${msg}${RESET}`);

let hardFailures = 0;

async function checkDatabase() {
  console.log('\nDATABASE_URL');
  const url = process.env.DATABASE_URL?.trim();

  if (!url) {
    fail('not set');
    hint('Create a free project at https://neon.tech, then paste the pooled');
    hint('connection string into .env.local as DATABASE_URL.');
    hardFailures++;
    return;
  }

  if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) {
    fail('does not look like a Postgres connection string');
    hardFailures++;
    return;
  }

  if (!url.includes('-pooler')) {
    warn('this looks like the UNPOOLED Neon string');
    hint('Neon shows both. Prefer the host containing "-pooler" — the direct');
    hint('connection will exhaust its limit under serverless functions.');
  }

  try {
    const sql = neon(url);
    const started = Date.now();
    const rows = (await sql`select version() as version, current_database() as db`) as Array<{
      version: string;
      db: string;
    }>;
    const elapsed = Date.now() - started;

    ok(`connected to "${rows[0].db}" in ${elapsed}ms`);
    hint(rows[0].version.split(',')[0]);

    const tables = (await sql`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name
    `) as Array<{ table_name: string }>;

    if (tables.length === 0) {
      warn('no tables yet — run `npm run db:push` to create the schema');
    } else {
      ok(`${tables.length} tables present`);
      hint(tables.map((t) => t.table_name).join(', '));
    }
  } catch (error) {
    fail(`could not connect: ${(error as Error).message}`);
    hint('Check the password in the string, and that the Neon project is active.');
    hardFailures++;
  }
}

function checkOptional() {
  console.log('\nSLEEPER_USERNAME');
  const username = process.env.SLEEPER_USERNAME?.trim();
  if (username) ok(`"${username}" — /setup will be pre-filled`);
  else warn('not set — you will type it into /setup instead (fine)');

  console.log('\nSPORTSGAMEODDS_API_KEY');
  const key = process.env.SPORTSGAMEODDS_API_KEY?.trim();
  if (key) ok(`set (${key.slice(0, 6)}…) — projection layer 3 (player props) enabled`);
  else warn('not set — layers 1 and 2 still work, props layer disabled');

  console.log('\nCRON_SECRET');
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    fail('not set — /api/cron/* would be unprotected');
    hint('node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"');
    hardFailures++;
  } else if (secret.length < 24) {
    warn(`only ${secret.length} chars — regenerate something longer`);
  } else {
    ok('set');
  }
}

async function checkUpstreams() {
  console.log('\nUpstream data sources (no keys required)');

  const probes: Array<[string, string]> = [
    ['Sleeper API', 'https://api.sleeper.app/v1/state/nfl'],
    ['Sleeper projections', 'https://api.sleeper.com/projections/nfl/2026/1?season_type=regular&position[]=QB&order_by=ppr'],
    ['DK lines via ESPN', 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'],
    ['FantasyCalc', 'https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&numTeams=12&ppr=1'],
  ];

  for (const [name, url] of probes) {
    try {
      const started = Date.now();
      const response = await fetch(url, { headers: { 'user-agent': 'footballcheatsheet/1.0' } });
      if (response.ok) ok(`${name} — ${response.status} in ${Date.now() - started}ms`);
      else warn(`${name} — HTTP ${response.status}`);
    } catch (error) {
      warn(`${name} — unreachable (${(error as Error).message})`);
    }
  }
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  footballcheatsheet — environment check');
  console.log('='.repeat(60));

  await checkDatabase();
  checkOptional();
  await checkUpstreams();

  console.log('\n' + '='.repeat(60));
  if (hardFailures > 0) {
    console.log(`${RED}  ${hardFailures} blocking issue${hardFailures === 1 ? '' : 's'}${RESET} — see above`);
    console.log('='.repeat(60) + '\n');
    process.exit(1);
  }
  console.log(`${GREEN}  Environment is ready.${RESET}`);
  console.log('='.repeat(60) + '\n');
}

main();
