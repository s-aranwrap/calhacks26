/**
 * Server-side configuration for the ingestion scripts.
 *
 * Secrets live in `server/.env` (git-ignored), deliberately separate from the
 * app's root `.env`: the mobile bundle only ever sees EXPO_PUBLIC_* values,
 * and keeping server secrets in another file makes accidental exposure
 * through an EXPO_PUBLIC_ rename much less likely.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface ServerEnv {
  supabaseUrl?: string;
  /** Secret (sb_secret_...) or legacy service_role key. Bypasses RLS: server only. */
  supabaseSecretKey?: string;
  apifyToken?: string;
  apifyActorId: string;
  /** Optional AI service for `--ai` / `--images` (see aiProviders.ts). */
  aiProvider?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  anthropicApiKey?: string;
  anthropicModel?: string;
  /** Apify actor used by `npm run hours:sf`. */
  apifyPlacesActorId: string;
}

let loaded = false;

export function loadServerEnv(): ServerEnv {
  if (!loaded) {
    const envPath = fileURLToPath(new URL('../.env', import.meta.url));
    if (existsSync(envPath)) process.loadEnvFile(envPath);
    loaded = true;
  }
  const env = process.env;
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    ...(env.SUPABASE_URL ? { supabaseUrl: env.SUPABASE_URL.replace(/\/+$/, '') } : {}),
    ...(secret ? { supabaseSecretKey: secret } : {}),
    ...(env.APIFY_API_TOKEN ? { apifyToken: env.APIFY_API_TOKEN } : {}),
    apifyActorId: env.APIFY_INSTAGRAM_ACTOR_ID || 'apify~instagram-scraper',
    ...(env.AI_PROVIDER ? { aiProvider: env.AI_PROVIDER } : {}),
    ...(env.GEMINI_API_KEY ? { geminiApiKey: env.GEMINI_API_KEY } : {}),
    ...(env.GEMINI_MODEL ? { geminiModel: env.GEMINI_MODEL } : {}),
    ...(env.OLLAMA_URL ? { ollamaUrl: env.OLLAMA_URL } : {}),
    ...(env.OLLAMA_MODEL ? { ollamaModel: env.OLLAMA_MODEL } : {}),
    ...(env.ANTHROPIC_API_KEY ? { anthropicApiKey: env.ANTHROPIC_API_KEY } : {}),
    ...(env.ANTHROPIC_MODEL ? { anthropicModel: env.ANTHROPIC_MODEL } : {}),
    apifyPlacesActorId: env.APIFY_PLACES_ACTOR_ID || 'compass~crawler-google-places',
  };
}

/** Removes a secret from any string before it is printed. */
export function redact(text: string, ...secrets: (string | undefined)[]): string {
  return secrets.reduce<string>(
    (out, secret) => (secret && secret.length >= 6 ? out.split(secret).join('[redacted]') : out),
    text,
  );
}

/** Tiny argv parser: `--flag value`, repeated flags collect into arrays, bare `--flag` = true. */
export function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string[]> } {
  const positional: string[] = [];
  const flags: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split('=', 2) as [string, string | undefined];
    const next = argv[i + 1];
    const value = inline ?? (next !== undefined && !next.startsWith('--') ? (i++, next) : 'true');
    (flags[key] ??= []).push(value);
  }
  return { positional, flags };
}
