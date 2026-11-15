import Anthropic from '@anthropic-ai/sdk';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { aiUsage } from '@/db/schema';
import { estimateCostMicros, type UsageLike } from './pricing';

/**
 * The one place the app talks to Claude.
 *
 * Model choice follows the job: judgment calls (is this trade good, what does
 * the engine miss) go to Opus; short writing (the pitch message) goes to
 * Haiku, where a bigger model would only produce nicer prose.
 */
export const MODELS = {
  analysis: 'claude-opus-5-5',
  pitch: 'claude-haiku-5-5',
} as const;

const DEFAULT_DAILY_LIMIT = 100;

let client: Anthropic | null = null;

export function claudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function getClaude(): Anthropic {
  client ??= new Anthropic();
  return client;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function dailyLimit(): number {
  const raw = Number(process.env.AI_DAILY_CALL_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_LIMIT;
}

export type Reservation = { ok: true } | { ok: false; message: string };

/**
 * Claim one call against today's cap before spending anything. The increment
 * and the read happen in one statement, so two simultaneous requests cannot
 * both slip under the limit.
 *
 * Fails closed: if the table is missing (deploy landed before `db:push`) no
 * call goes out, because the alternative is an unmetered endpoint.
 */
export async function reserveCall(): Promise<Reservation> {
  try {
    const [row] = await db
      .insert(aiUsage)
      .values({ day: today(), calls: 1 })
      .onConflictDoUpdate({ target: aiUsage.day, set: { calls: sql`${aiUsage.calls} + 1` } })
      .returning({ calls: aiUsage.calls });
    const limit = dailyLimit();
    if (row.calls > limit) {
      return { ok: false, message: `Claude's daily limit (${limit} calls) is used up. It resets at midnight UTC.` };
    }
    return { ok: true };
  } catch (error) {
    console.error('ai_usage reserve failed', error);
    return { ok: false, message: 'Usage tracking is not set up yet. Run `npm run db:push` to create the ai_usage table.' };
  }
}

/** Best effort: a failed write here must never break a response already streamed. */
export async function recordUsage(model: string, usage: UsageLike): Promise<void> {
  const cached = (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  try {
    await db
      .update(aiUsage)
      .set({
        inputTokens: sql`${aiUsage.inputTokens} + ${usage.input_tokens}`,
        cachedInputTokens: sql`${aiUsage.cachedInputTokens} + ${cached}`,
        outputTokens: sql`${aiUsage.outputTokens} + ${usage.output_tokens}`,
        costMicros: sql`${aiUsage.costMicros} + ${estimateCostMicros(model, usage)}`,
      })
      .where(sql`${aiUsage.day} = ${today()}`);
  } catch (error) {
    console.error('ai_usage record failed', error);
  }
}
