import { NextResponse } from 'next/server';
import { runHourly, runDaily, runGameday } from '@/lib/sync/refresh';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const JOBS = {
  hourly: runHourly,
  daily: runDaily,
  gameday: runGameday,
} as const;

type JobName = keyof typeof JOBS;

/**
 * Cron entrypoint: /api/cron/hourly | /api/cron/daily | /api/cron/gameday
 *
 * Guarded by a shared secret because these endpoints write to the database and
 * hammer upstream APIs. Accepts either an Authorization: Bearer header (what
 * GitHub Actions sends) or an x-cron-secret header.
 */
export async function GET(request: Request, context: { params: Promise<{ job: string }> }) {
  const { job } = await context.params;

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
  }

  const provided =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    request.headers.get('x-cron-secret') ??
    '';

  if (!timingSafeEqual(provided, secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!(job in JOBS)) {
    return NextResponse.json(
      { error: `unknown job "${job}"`, available: Object.keys(JOBS) },
      { status: 404 },
    );
  }

  try {
    const result = await JOBS[job as JobName]();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error(`cron/${job} failed`, error);
    return NextResponse.json(
      { ok: false, job, error: (error as Error).message },
      { status: 500 },
    );
  }
}

/** Constant-time compare so the secret can't be probed byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
