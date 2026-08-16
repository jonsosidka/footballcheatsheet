import type { Config } from '@netlify/functions';

/**
 * Hourly refresh: projections, DraftKings lines, rosters, alerts.
 *
 * Netlify scheduled functions hard-stop at 30 seconds, so this only calls the
 * light job. The 14MB player dump and FantasyCalc pulls live in the daily
 * background function instead.
 *
 * Scheduled functions only run on published deploys — never on branch deploys
 * or previews.
 */
export default async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  const base = process.env.URL ?? process.env.DEPLOY_PRIME_URL;

  if (!secret || !base) {
    console.error('scheduled-hourly: missing CRON_SECRET or URL');
    return;
  }

  const response = await fetch(`${base}/api/cron/hourly`, {
    headers: { authorization: `Bearer ${secret}` },
  });

  console.log('scheduled-hourly', response.status, await response.text());
};

export const config: Config = {
  schedule: '@hourly',
};
