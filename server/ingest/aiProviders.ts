/**
 * The AI services the caption/flyer reader can use. All three return the same
 * JSON shape; aiExtract.ts validates it the same way whichever one answered.
 *
 *  - gemini (default, free): Google's Gemini API free tier. Needs a free key from
 *    aistudio.google.com. Free-tier requests are rate-limited per day, and
 *    Google may use free-tier prompts to improve its products. The posts are
 *    public anyway, but don't send anything private through it.
 *  - ollama (free, local): a model running on your own computer with Ollama.
 *    No key, no limits, nothing leaves your machine; slower and less accurate
 *    than the hosted ones, and it needs a few GB of disk.
 *  - anthropic (paid): the Claude API. Pay-as-you-go; roughly a cent or two
 *    for a whole run with a small model.
 */

export interface AiImage {
  media_type: string;
  data: string;
}

export interface AiRequest {
  system: string;
  text: string;
  image: AiImage | null;
  /** Standard JSON Schema for the answer object. */
  schema: Record<string, unknown>;
}

export interface AiProvider {
  name: 'gemini' | 'ollama' | 'anthropic';
  /** Filled in by prepare() when it's chosen automatically. */
  model: string;
  /** Spacing between requests, to stay under free-tier per-minute limits. */
  minIntervalMs: number;
  /** One-time setup before the first request (e.g. picking a model). */
  prepare(): Promise<void>;
  ask(request: AiRequest): Promise<unknown>;
}

/** The service says the quota is used up (for example the free daily limit). */
export class QuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaError';
  }
}

interface Common {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** POST with retries for network errors, 5xx and short rate limits. */
async function postJson(
  url: string,
  init: { headers: Record<string, string>; body: unknown },
  options: Common & { secret?: string; quotaCheck?: (status: number, body: string) => number | 'quota' | null },
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? 3;
  const clean = (t: string) => (options.secret ? t.split(options.secret).join('[redacted]') : t);
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...init.headers },
        body: JSON.stringify(init.body),
      });
    } catch (error) {
      if (attempt < maxRetries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new Error(clean(`Could not reach ${new URL(url).host}: ${(error as Error).message}`));
    }
    if (response.ok) return response.json();
    const body = await response.text().catch(() => '');
    if (response.status === 429) {
      const verdict = options.quotaCheck?.(response.status, body) ?? null;
      if (verdict === 'quota') throw new QuotaError(clean(body.slice(0, 200)));
      if (attempt < maxRetries) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const wait = typeof verdict === 'number' ? verdict : retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt;
        await sleep(Math.min(wait, 65_000));
        continue;
      }
      throw new QuotaError(clean(`Still rate-limited after ${maxRetries + 1} tries`));
    }
    if (response.status >= 500 && attempt < maxRetries) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    throw new Error(clean(`${new URL(url).host} returned HTTP ${response.status}: ${body.slice(0, 200)}`));
  }
}

function parseJsonText(text: string | undefined): unknown {
  if (!text) throw new Error('The model returned an empty answer');
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error('The model’s answer was not valid JSON');
  }
}

// ---------------------------------------------------------------------------
// Gemini (free tier)
// ---------------------------------------------------------------------------

/** Converts standard JSON Schema to the OpenAPI subset Gemini's responseSchema accepts. */
export function toGeminiSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return schema;
  const s = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let type = s.type;
  if (Array.isArray(type)) {
    const nonNull = type.filter((t) => t !== 'null');
    if (nonNull.length < type.length) out.nullable = true;
    type = nonNull[0];
  }
  if (typeof type === 'string') out.type = type.toUpperCase();
  if (typeof s.description === 'string') out.description = s.description;
  if (Array.isArray(s.enum)) out.enum = s.enum;
  if (Array.isArray(s.required)) out.required = s.required;
  if (s.items) out.items = toGeminiSchema(s.items);
  if (s.properties && typeof s.properties === 'object') {
    out.properties = Object.fromEntries(
      Object.entries(s.properties as Record<string, unknown>).map(([k, v]) => [k, toGeminiSchema(v)]),
    );
  }
  return out;
}

/** Picks the newest stable Flash-Lite model (the free tier's most generous), else the newest Flash. */
export function pickGeminiModel(models: { name?: string; supportedGenerationMethods?: string[] }[]): string | null {
  const usable = models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => String(m.name ?? '').replace(/^models\//, ''))
    .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/(preview|exp|tts|live|image|audio|thinking|embedding)/i.test(n));
  const version = (n: string) =>
    Number(
      n
        .match(/^gemini-([\d.]+)/)?.[1]
        ?.split('.')
        .slice(0, 2)
        .join('.') ?? 0,
    );
  const best = (re: RegExp) =>
    usable
      .filter((n) => re.test(n))
      .sort((a, b) => version(b) - version(a) || a.length - b.length)
      .at(0);
  return best(/-flash-lite/) ?? best(/-flash(?!-lite)/) ?? null;
}

export function createGeminiProvider(options: Common & { apiKey: string; model?: string }): AiProvider {
  const base = 'https://generativelanguage.googleapis.com/v1beta';
  const fetchImpl = options.fetchImpl ?? fetch;
  const provider: AiProvider = {
    name: 'gemini',
    model: options.model ?? '',
    // ~12 requests a minute keeps well inside typical free per-minute limits.
    minIntervalMs: 5000,
    async prepare() {
      if (provider.model) return;
      const response = await fetchImpl(`${base}/models?pageSize=200`, {
        headers: { 'x-goog-api-key': options.apiKey },
      });
      if (!response.ok) {
        const hint = response.status === 400 || response.status === 403 ? ' Check GEMINI_API_KEY.' : '';
        throw new Error(`Could not list Gemini models (HTTP ${response.status}).${hint}`);
      }
      const json = (await response.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
      const picked = pickGeminiModel(json.models ?? []);
      if (!picked) throw new Error('No suitable Gemini Flash model found. Set GEMINI_MODEL in server/.env.');
      provider.model = picked;
    },
    async ask(request) {
      const json = (await postJson(
        `${base}/models/${encodeURIComponent(provider.model)}:generateContent`,
        {
          headers: { 'x-goog-api-key': options.apiKey },
          body: {
            systemInstruction: { parts: [{ text: request.system }] },
            contents: [
              {
                role: 'user',
                parts: [
                  ...(request.image
                    ? [{ inline_data: { mime_type: request.image.media_type, data: request.image.data } }]
                    : []),
                  { text: request.text },
                ],
              },
            ],
            generationConfig: {
              temperature: 0,
              responseMimeType: 'application/json',
              responseSchema: toGeminiSchema(request.schema),
            },
          },
        },
        {
          ...options,
          secret: options.apiKey,
          // A per-day quota won't recover by waiting; a per-minute one says how long to wait.
          quotaCheck: (_status, body) => {
            if (/PerDay|per day|daily/i.test(body)) return 'quota';
            const delay = body.match(/"retryDelay":\s*"(\d+)s"/);
            return delay ? Number(delay[1]) * 1000 + 500 : null;
          },
        },
      )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      return parseJsonText(json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join(''));
    },
  };
  return provider;
}

// ---------------------------------------------------------------------------
// Ollama (free, runs on your computer)
// ---------------------------------------------------------------------------

export const DEFAULT_OLLAMA_MODEL = 'gemma3:4b';

export function createOllamaProvider(options: Common & { baseUrl?: string; model?: string }): AiProvider {
  const base = (options.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const provider: AiProvider = {
    name: 'ollama',
    model: options.model ?? DEFAULT_OLLAMA_MODEL,
    minIntervalMs: 0,
    async prepare() {
      let response: Response;
      try {
        response = await fetchImpl(`${base}/api/tags`);
      } catch {
        throw new Error(`Ollama isn't running at ${base}. Install it from ollama.com and open it, then try again.`);
      }
      const json = (await response.json().catch(() => ({}))) as { models?: { name?: string }[] };
      const names = (json.models ?? []).map((m) => m.name ?? '');
      const wanted = provider.model.includes(':') ? provider.model : `${provider.model}:latest`;
      if (!names.includes(wanted) && !names.includes(provider.model)) {
        throw new Error(`Ollama doesn't have ${provider.model} yet. Run: ollama pull ${provider.model}`);
      }
    },
    async ask(request) {
      const json = (await postJson(
        `${base}/api/chat`,
        {
          headers: {},
          body: {
            model: provider.model,
            stream: false,
            format: request.schema,
            options: { temperature: 0 },
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.text, ...(request.image ? { images: [request.image.data] } : {}) },
            ],
          },
        },
        { ...options, maxRetries: options.maxRetries ?? 1 },
      )) as { message?: { content?: string } };
      return parseJsonText(json.message?.content);
    },
  };
  return provider;
}

// ---------------------------------------------------------------------------
// Anthropic (paid)
// ---------------------------------------------------------------------------

export function createAnthropicProvider(options: Common & { apiKey: string; model?: string }): AiProvider {
  return {
    name: 'anthropic',
    model: options.model ?? 'claude-haiku-5-5',
    minIntervalMs: 0,
    async prepare() {},
    async ask(request) {
      const json = (await postJson(
        'https://api.anthropic.com/v1/messages',
        {
          headers: { 'x-api-key': options.apiKey, 'anthropic-version': '2023-06-01' },
          body: {
            model: this.model,
            max_tokens: 1500,
            system: request.system,
            tools: [{ name: 'record_events', description: 'Record the events found.', input_schema: request.schema }],
            tool_choice: { type: 'tool', name: 'record_events' },
            messages: [
              {
                role: 'user',
                content: [
                  ...(request.image ? [{ type: 'image', source: { type: 'base64', ...request.image } }] : []),
                  { type: 'text', text: request.text },
                ],
              },
            ],
          },
        },
        { ...options, secret: options.apiKey },
      )) as { content?: { type: string; name?: string; input?: unknown }[] };
      const tool = json.content?.find((c) => c.type === 'tool_use' && c.name === 'record_events');
      if (!tool) throw new Error('Claude API answer had no tool call');
      return tool.input;
    },
  };
}

// ---------------------------------------------------------------------------
// Choosing one from server/.env
// ---------------------------------------------------------------------------

export interface AiEnv {
  aiProvider?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  anthropicApiKey?: string;
  anthropicModel?: string;
}

/**
 * AI_PROVIDER picks explicitly. Otherwise: Gemini if GEMINI_API_KEY is set,
 * then Ollama if OLLAMA_MODEL is set, then Claude if ANTHROPIC_API_KEY is set.
 */
export function providerFromEnv(env: AiEnv, common: Common = {}): AiProvider {
  const choice =
    env.aiProvider?.toLowerCase() ||
    (env.geminiApiKey ? 'gemini' : env.ollamaModel ? 'ollama' : env.anthropicApiKey ? 'anthropic' : '');
  if (choice === 'gemini') {
    if (!env.geminiApiKey) throw new Error('Set GEMINI_API_KEY in server/.env (free at aistudio.google.com/apikey).');
    return createGeminiProvider({
      ...common,
      apiKey: env.geminiApiKey,
      ...(env.geminiModel ? { model: env.geminiModel } : {}),
    });
  }
  if (choice === 'ollama') {
    return createOllamaProvider({
      ...common,
      ...(env.ollamaUrl ? { baseUrl: env.ollamaUrl } : {}),
      ...(env.ollamaModel ? { model: env.ollamaModel } : {}),
    });
  }
  if (choice === 'anthropic') {
    if (!env.anthropicApiKey) throw new Error('Set ANTHROPIC_API_KEY in server/.env.');
    return createAnthropicProvider({
      ...common,
      apiKey: env.anthropicApiKey,
      ...(env.anthropicModel ? { model: env.anthropicModel } : {}),
    });
  }
  if (choice) throw new Error(`AI_PROVIDER must be gemini, ollama or anthropic (got "${choice}").`);
  throw new Error(
    '--ai needs an AI service. The free option: get a key at aistudio.google.com/apikey and set GEMINI_API_KEY in server/.env. ' +
      'Or install Ollama (ollama.com) and set OLLAMA_MODEL=gemma3:4b.',
  );
}
