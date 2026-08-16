import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Upstream reachability probe.
 *
 * Exists because "works on my laptop, 403s in production" is a real and
 * recurring failure mode with free sports APIs — several of them block
 * datacenter IP ranges. This reports exactly which hosts answer from wherever
 * the app is actually running.
 *
 * Guarded by CRON_SECRET: it makes outbound requests, so it shouldn't be an
 * open relay for anyone who finds the URL.
 */
const PROBES: Array<{ name: string; url: string }> = [
  { name: 'sleeper-api', url: 'https://api.sleeper.app/v1/state/nfl' },
  {
    name: 'sleeper-projections',
    url: 'https://api.sleeper.com/projections/nfl/2026/1?season_type=regular&position[]=QB&order_by=ppr',
  },
  { name: 'espn-site-scoreboard', url: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard' },
  { name: 'espn-core-events', url: 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events?limit=2' },
  {
    name: 'espn-core-odds',
    url: 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/401873272/competitions/401873272/odds',
  },
  { name: 'fantasycalc', url: 'https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&numTeams=12&ppr=1' },
  {
    name: 'bovada',
    url: 'https://www.bovada.lv/services/sports/event/v2/events/A/description/football/nfl',
  },
];

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    request.headers.get('x-cron-secret') ??
    '';
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const results = await Promise.all(
    PROBES.map(async (probe) => {
      const started = Date.now();
      try {
        const response = await fetch(probe.url, {
          headers: {
            accept: 'application/json',
            'user-agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(15_000),
        });
        const body = await response.text();
        return {
          name: probe.name,
          host: new URL(probe.url).host,
          status: response.status,
          ok: response.ok,
          bytes: body.length,
          ms: Date.now() - started,
        };
      } catch (error) {
        return {
          name: probe.name,
          host: new URL(probe.url).host,
          status: 0,
          ok: false,
          error: (error as Error).message,
          ms: Date.now() - started,
        };
      }
    }),
  );

  return NextResponse.json({
    runtime: process.env.NETLIFY ? 'netlify' : 'local',
    region: process.env.AWS_REGION ?? null,
    results,
  });
}
