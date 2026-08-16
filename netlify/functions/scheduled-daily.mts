import type { Config } from '@netlify/functions';

/**
 * Daily heavy sync, fired at 09:00 UTC (early morning US).
 *
 * The work itself (14MB player dump, season projections, FantasyCalc values
 * per league shape) can exceed the 30s scheduled-function ceiling, so this
 * kicks the request and does not await completion — /api/cron/daily runs on the
 * Next.js function which has a longer budget.
 */
export default async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  const base = process.env.URL ?? process.env.DEPLOY_PRIME_URL;

  if (!secret || !base) {
    console.error('scheduled-daily: missing CRON_SECRET or URL');
    return;
  }

  const response = await fetch(`${base}/api/cron/daily`, {
    headers: { authorization: `Bearer ${secret}` },
  });

  console.log('scheduled-daily', response.status, await response.text());
};

export const config: Config = {
  schedule: '0 9 * * *',
};
