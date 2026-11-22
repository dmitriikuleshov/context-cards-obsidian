import { endpoint, jsonRequest } from './http';
import type { Settings } from './types';
import {
  parseThinkingSupport,
  thinkingValue,
  usesThinking,
  type ThinkingSupport,
} from './thinking-options';
export * from './thinking-options';

export interface OllamaReply {
  message?: { content?: string; thinking?: string };
  done_reason?: string;
}
const cache = new Map<string, { expires: number; support: ThinkingSupport }>();
const unknownSupport = (): ThinkingSupport => ({ known: false, values: [] });
const key = (s: Pick<Settings, 'ollamaUrl' | 'model'>) =>
  `${endpoint(s.ollamaUrl)}\n${s.model.trim()}`;

export function clearThinkingCache() {
  cache.clear();
}
function cachedSupport(
  settings: Pick<Settings, 'ollamaUrl' | 'model'>,
): ThinkingSupport | undefined {
  const entry = cache.get(key(settings));
  return entry && entry.expires > Date.now() ? structuredClone(entry.support) : undefined;
}
/** Metadata only: this endpoint does not load the model or generate text. */
export async function readThinkingSupport(
  settings: Pick<Settings, 'ollamaUrl' | 'model'>,
  signal?: AbortSignal,
  force = false,
  timeout = 8000,
): Promise<ThinkingSupport> {
  const existing = !force && cachedSupport(settings);
  if (existing) return existing;
  const raw = await jsonRequest(
    `${endpoint(settings.ollamaUrl)}/api/show`,
    { model: settings.model.trim() },
    signal,
    timeout,
  );
  if (signal?.aborted) throw new Error('Cancelled.');
  const support = parseThinkingSupport(raw);
  if (cache.size >= 16) cache.delete(cache.keys().next().value!);
  cache.set(key(settings), { expires: Date.now() + 60_000, support });
  return structuredClone(support);
}
/** Shared by both modes, including supplemental vocabulary requests and writing retries. */
export async function chatRequest<T extends OllamaReply>(
  settings: Settings,
  payload: { options?: Record<string, number>; [key: string]: unknown },
  signal: AbortSignal,
  timeout: number,
): Promise<T> {
  const choice = settings.thinking ?? 'off';
  let support = cachedSupport(settings) ?? unknownSupport(),
    remaining = timeout;
  // Off keeps the existing fast path; false is also accepted by models without thinking.
  // The settings probe supplies metadata for models that cannot actually turn thinking off.
  if (choice !== 'off') {
    const start = performance.now();
    support = await readThinkingSupport(settings, signal, false, Math.min(8000, timeout));
    remaining -= performance.now() - start;
    if (remaining <= 0)
      throw new Error(
        'The request timed out while checking Thinking support. Increase Request timeout.',
      );
  }
  const value = thinkingValue(choice, support);
  const mayThink = usesThinking(value, support);
  const options = { ...payload.options };
  if (mayThink) {
    // Keep sampling defaults appropriate to this model's reasoning mode, rather than
    // forcing low-temperature direct-answer settings that can cause repetition.
    for (const parameter of ['temperature', 'top_p', 'top_k', 'presence_penalty'])
      delete options[parameter];
    options.num_predict = Math.max(8192, (options.num_predict ?? 2048) + 4096);
    options.num_ctx = Math.max(12288, options.num_ctx ?? 0);
  }
  const result = await jsonRequest<T>(
    `${endpoint(settings.ollamaUrl)}/api/chat`,
    { ...payload, think: value, options },
    signal,
    remaining,
  );
  if (
    typeof result?.message?.thinking === 'string' &&
    result.message.thinking.trim() &&
    (result.done_reason === 'length' || !result.message.content?.trim())
  )
    throw new Error(
      'The model used its generation budget on thinking before finishing an answer. Try a lower Thinking level or turn Thinking off.',
    );
  return result;
}
