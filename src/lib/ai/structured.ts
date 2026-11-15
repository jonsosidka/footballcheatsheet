import Anthropic from '@anthropic-ai/sdk';
import { MODELS, getClaude, recordUsage } from './claude';

/** Seconds between keep-alive bytes while Claude is thinking. */
const HEARTBEAT_MS = 5000;

/**
 * Ask Opus for JSON matching `schema`, and answer the browser with a text
 * stream: a space every few seconds while Claude thinks (so nothing between
 * here and the browser treats the connection as idle), then one JSON
 * document — whatever `finish` makes of the parsed reply, or `{ error }`.
 * The client trims and parses the whole body.
 */
export function structuredResponse(opts: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  finish: (parsed: unknown) => unknown;
}): Response {
  const model = MODELS.analysis;
  const stream = getClaude().beta.messages.stream({
    model,
    max_tokens: 32000,
    // If Opus's safety classifier declines, the API reruns on a fallback model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: opts.schema } },
    cache_control: { type: 'ephemeral' },
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const beat = setInterval(() => controller.enqueue(encoder.encode(' ')), HEARTBEAT_MS);
      const send = (payload: unknown) => controller.enqueue(encoder.encode(JSON.stringify(payload)));
      try {
        const final = await stream.finalMessage();
        await recordUsage(final.model, final.usage);

        if (final.stop_reason === 'refusal') return send({ error: 'Claude declined to answer this one.' });
        if (final.stop_reason === 'max_tokens') return send({ error: 'Claude ran out of room before finishing. Try again.' });

        const text = final.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return send({ error: 'Claude returned something unreadable. Try again.' });
        }
        send(opts.finish(parsed));
      } catch (error) {
        console.error('claude structured stream failed', error);
        send({
          error:
            error instanceof Anthropic.RateLimitError
              ? 'Claude is rate limited right now. Try again in a minute.'
              : error instanceof Anthropic.APIError
                ? `Claude returned an error (${error.status ?? 'network'}).`
                : 'Lost the connection to Claude.',
        });
      } finally {
        clearInterval(beat);
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Claude-Model': model },
  });
}
