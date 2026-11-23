// Live audit of the current Vocabulary client. Requires preinstalled Ollama models.
// Synthetic passages only; no vault/settings writes and no Anki calls.
// Runs models sequentially and unloads OTHER currently loaded models to isolate VRAM use.
// Default: four models from the 2026-11-23 comparison; pass exact tags as CLI arguments.
// AUDIT_DIR sets the output folder. Reuse a folder only to resume the SAME code/settings run.
// Gold expectations are stored locally and are NEVER included in generation requests.
// Transport instrumentation observes actual requests/responses without changing prompts or options.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const out = resolve(process.env.AUDIT_DIR || '.test-artifacts/vocabulary-model-audit-2026-11-23');
await mkdir(out, { recursive: true });
const models = process.argv.slice(2);
if (!models.length)
  models.push('gemma3:12b-it-q4_K_M', 'gemma4:12b-it-qat', 'qwen3:14b-q4_K_M', 'qwen3.5:9b-q4_K_M');
const url = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const api = async (path, body) => {
  const r = await fetch(url + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  return r.json();
};
const cases = [
  {
    id: 'power',
    target: 'power',
    source: 'After the storm damaged the cables, the whole village was without power for two days.',
    gold: 'Ready. Uncountable noun; electricity. General noun meanings and examples may cover ability, authority/influence, electricity, mathematical power. Merge paraphrases; do not add unrelated lexical derivatives.',
  },
  {
    id: 'charge',
    target: 'charged',
    source: 'The police charged Daniel with theft, but the court later found him not guilty.',
    gold: 'Ready. Lemma charge, verb, formally accuse; not conviction or a fee. General verb usages may include payment, accusation, charging a battery, rushing/attacking and assigning responsibility.',
  },
  {
    id: 'strain',
    target: 'strained',
    source: 'Mara strained to hear the distant voice, but the wind drowned out every word.',
    gold: 'Ready. Lemma strain; make great effort. No actual injury or damage is implied. Could not hear despite effort; do not invent physical damage or inevitable failure.',
  },
  {
    id: 'hitherto',
    target: 'hitherto',
    source:
      'The newly discovered letters revealed a hitherto unknown friendship between the two writers.',
    gold: 'Ready. Adverb meaning until then/up to the point in time in question. Fairly formal/literary. Unknown before discovery, not unknown forever; no invented derivational base.',
  },
  {
    id: 'conceivably',
    target: 'conceivably',
    source:
      'The missing receipt could conceivably be in the drawer, although I checked it yesterday.',
    gold: 'Ready. Adverb: possibly/as can be imagined; not likely/probably. Normally one common sense/group, not redundant topic-based groups or conceivably possible.',
  },
  {
    id: 'vagaries',
    target: 'vagaries',
    source: 'Farmers must plan for the vagaries of the weather, which can change without warning.',
    gold: 'Ready. Normally plural noun vagaries; unpredictable changes or variations, not personal eccentric behaviour exclusively. Do not reduce the entry to vague.',
  },
  {
    id: 'resort-to',
    target: 'had resorted to',
    source:
      'After every polite request failed, they had resorted to legal action to recover the money.',
    gold: 'Ready. Lemma resort to, verb plus noun/gerund, not to-infinitive; turn to a method when alternatives fail, often undesirable/last resort. Do not use holiday-resort noun examples.',
  },
  {
    id: 'put-up-with',
    target: 'put up with',
    source: 'I can put up with the noise during the day, but I need silence at night.',
    gold: 'Ready. Preserve put up with, tolerate something unpleasant; not accommodation, building, offering or postponing.',
  },
  {
    id: 'sanction',
    target: 'sanction',
    source:
      'The ethics board refused to sanction the experiment: without its official approval, the trial could not begin.',
    gold: 'Ready. Verb sanction = officially approve/authorize in this context. General explanation/examples may mention penalize as a contrasting established sense, clearly separated. Source meaning must not be punish.',
  },
  {
    id: 'tabled-uk',
    target: 'tabled',
    source:
      'At the British committee meeting, the chair tabled a motion for discussion, and the members began debating it immediately.',
    gold: 'Ready. Lemma table, verb. Here formally present for discussion, not US postpone. If describing dialect differences, do not reverse them or forbid attested uses.',
  },
  {
    id: 'inflammable',
    target: 'inflammable',
    source:
      'Keep this solvent away from sparks: it is highly inflammable and can catch fire very easily.',
    gold: 'Ready. Adjective: easily set on fire. Flammable has the same core meaning; NOT non-flammable. Do not invent a base verb inflame meaning to make less combustible.',
  },
  {
    id: 'seek-to',
    target: 'sought to',
    source:
      'The report sought to explain the sudden decline in attendance, but the evidence remained inconclusive.',
    gold: 'Ready. Lemma seek to (verb plus to-infinitive), attempted/tried to, not necessarily succeeded or physically searched for an object. Preserve essential to in this selected pattern.',
  },
  {
    id: 'ambiguous-bank',
    target: 'bank',
    source: 'She waited near the bank.',
    gold: 'Ambiguous: financial institution/building or river bank; ask for clarification, no confident invented teaching fields.',
  },
  {
    id: 'ambiguous-crane',
    target: 'crane',
    source: 'When I looked out of the window, I saw a crane.',
    gold: 'Ambiguous: bird or lifting machine; ask for clarification, no confident definition.',
  },
  {
    id: 'unknown-word',
    target: 'zindlebrate',
    source: 'We should zindlebrate the plan before Friday.',
    gold: 'Unknown/coined expression; do not invent a definition or pronunciation. Ask for clarification.',
  },
];
const background = Array.from(
  { length: 90 },
  (_, i) =>
    `Journal entry ${i + 1}. We compared the route maps, booked a room near the station and wrote down the address of the museum. The tickets were kept in a blue envelope. We agreed to leave after breakfast and meet the others at the station cafe.\n`,
).join('');
const sentence =
  'The suitcase was light enough for her to lift with one hand, although it contained all her clothes.';
const left = background.slice(0, 5900),
  right = background.slice(0, 12000 - left.length - sentence.length - 2);
cases.push({
  id: 'long-12000',
  target: 'light',
  source: left + '\n' + sentence + '\n' + right,
  gold: 'Ready. Adjective light = not heavy/easy to lift, not illumination, pale colour or brightness in source. General adjective examples may cover low weight, illumination (a light room), pale colour, mildness, small amount. Do not treat the source as ambiguous.',
});
for (const id of ['strain', 'resort-to', 'ambiguous-bank', 'inflammable']) {
  const item = cases.find((c) => c.id === id);
  cases.push({ ...item, id: id + '-repeat', repeatOf: id });
}
if (process.env.AUDIT_CASES_FILE) {
  const supplied = JSON.parse(await readFile(process.env.AUDIT_CASES_FILE, 'utf8'));
  if (!Array.isArray(supplied) || supplied.length === 0) throw new Error('Expected a nonempty case array');
  cases.splice(0, cases.length, ...supplied);
}
await writeFile(resolve(out, 'cases.json'), JSON.stringify(cases, null, 2));
await build({
  stdin: {
    contents: `export {Ollama} from './src/ollama.ts'; export {DEFAULTS} from './src/types.ts';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: resolve(out, 'client.mjs'),
  plugins: [
    {
      name: 'observe-transport',
      setup(b) {
        b.onLoad({ filter: /[\\/]src[\\/]http\.ts$/ }, async (args) => ({
          loader: 'ts',
          contents:
            (await readFile(args.path, 'utf8')).replace(
              'export function jsonRequest<T>(',
              'function baseJsonRequest<T>(',
            ) +
            `\nexport async function jsonRequest<T>(...args: Parameters<typeof baseJsonRequest<T>>): Promise<T> { const start=performance.now(); try { const response=await baseJsonRequest<T>(...args); await (globalThis as any).__auditTransport?.({url:args[0], request:args[1], timeoutMs:args[3], elapsedMs:performance.now()-start,response}); return response; } catch(error) { await (globalThis as any).__auditTransport?.({url:args[0],request:args[1], timeoutMs:args[3],elapsedMs:performance.now()-start,error:String(error)}); throw error; } }`,
        }));
      },
    },
  ],
});
const { Ollama, DEFAULTS } = await import(pathToFileURL(resolve(out, 'client.mjs')));
const tags = await api('/api/tags');
for (const model of models)
  if (!tags.models.some((m) => m.name === model)) throw new Error('Missing model: ' + model);
const settings = {
  ...DEFAULTS,
  ollamaUrl: url,
  contextSize: 12000,
  timeoutSeconds: 300,
  temperature: 0.2,
};
const info = {
  startedAt: new Date().toISOString(),
  models,
  server: await api('/api/version'),
  settings: { ...settings, ankiKey: undefined },
  cases: cases.length,
  thinking: false,
  description:
    'Actual plugin Ollama.generate, unmodified prompts/options/validation. Isolated sequential model runs. Synthetic text. Raw transport observed; no Anki writes or settings edits.',
};
await writeFile(resolve(out, 'environment.json'), JSON.stringify(info, null, 2));
let completed = [];
try {
  completed = JSON.parse(await readFile(resolve(out, 'results.json'), 'utf8'));
} catch {}
for (const model of models) {
  if (cases.every((c) => completed.some((r) => r.model === model && r.id === c.id))) continue;
  const running = await api('/api/ps');
  for (const item of running.models)
    if (item.name !== model) await api('/api/generate', { model: item.name, keep_alive: 0 });
  console.log('MODEL ' + model);
  for (const item of cases) {
    if (completed.some((r) => r.model === model && r.id === item.id)) continue;
    const trace = [];
    globalThis.__auditTransport = async (event) => {
      if (!event.url.endsWith('/api/chat')) return;
      let ps;
      try {
        ps = (await api('/api/ps')).models;
      } catch {}
      const body = event.request;
      const properties = body?.format?.properties || {};
      const stage = properties.lemma
        ? 'main'
        : properties.general_meaning
          ? 'generalMeaning'
          : properties.base_word
            ? 'wordFormation'
            : properties.examples
              ? 'examples'
              : 'pronunciation';
      const value = {
        model,
        id: item.id,
        stage,
        elapsedMs: event.elapsedMs,
        timeoutMs: event.timeoutMs,
        options: body?.options,
        think: body?.think,
        ps,
        response: event.response,
        error: event.error,
      };
      trace.push(value);
      await appendFile(resolve(out, 'trace.jsonl'), JSON.stringify(value) + '\n');
      console.log(
        `  ${item.id}/${stage} ${(event.elapsedMs / 1000).toFixed(1)}s ${event.error || event.response?.done_reason || 'done'}`,
      );
    };
    const started = performance.now();
    const result = {
      model,
      id: item.id,
      target: item.target,
      sourceCharacters: item.source.length,
      gold: item.gold,
      repeatOf: item.repeatOf,
    };
    try {
      const generated = await new Ollama({ ...settings, model }).generate(
        item.target,
        item.source,
        new AbortController().signal,
      );
      Object.assign(result, generated);
    } catch (error) {
      result.error = String(error);
    }
    result.wallSeconds = (performance.now() - started) / 1000;
    result.stages = trace.map(({ response, ps, ...rest }) => ({
      ...rest,
      doneReason: response?.done_reason,
      loadSeconds: (response?.load_duration || 0) / 1e9,
      evalCount: response?.eval_count,
      promptEvalCount: response?.prompt_eval_count,
      tokensPerSecond: response?.eval_duration
        ? response.eval_count / (response.eval_duration / 1e9)
        : null,
      thinkingCharacters: response?.message?.thinking?.length || 0,
      loaded: ps?.map((p) => ({
        name: p.name,
        size: p.size,
        sizeVram: p.size_vram,
        context: p.context_length,
      })),
    }));
    completed.push(result);
    await writeFile(resolve(out, 'results.json'), JSON.stringify(completed, null, 2));
    console.log(
      `RESULT ${model} ${item.id} ${result.wallSeconds.toFixed(1)}s ${result.error || result.content.status} (${completed.length}/${models.length * cases.length})`,
    );
  }
}
console.log('COMPLETE ' + completed.length);
