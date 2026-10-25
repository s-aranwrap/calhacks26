/**
 * Runtime configuration from public environment variables.
 *
 * Expo inlines `EXPO_PUBLIC_*` variables into the JavaScript bundle at build
 * time, which means anyone can read them. Only values that are safe to publish
 * belong here: the Supabase project URL and its publishable (anon) key.
 * Never put a secret / service-role key or the Apify token in an
 * EXPO_PUBLIC_ variable.
 */

// Local declaration so this file also type-checks under Node without DOM/RN globals.
declare const process: { env: Record<string, string | undefined> };

export interface AppConfig {
  supabase: { url: string; publishableKey: string } | null;
  /** Bundled city pack to show. "sf" by default; "none" brings back the fictional sample town. */
  cityPack: 'sf' | null;
}

function readEnv(): Record<string, string | undefined> {
  // Each variable must be referenced literally for Expo's build-time inlining to work.
  try {
    return {
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      EXPO_PUBLIC_CITY_PACK: process.env.EXPO_PUBLIC_CITY_PACK,
    };
  } catch {
    return {};
  }
}

export function resolveConfig(env: Record<string, string | undefined> = readEnv()): AppConfig {
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const looksConfigured =
    !!url && !!key && /^https:\/\//.test(url) && !url.includes('your-project') && !key.startsWith('your-');
  // Refuse obviously secret keys even if someone configures one by mistake.
  const looksSecret = !!key && (key.startsWith('sb_secret_') || key.includes('service_role'));
  const pack = env.EXPO_PUBLIC_CITY_PACK?.trim().toLowerCase();
  return {
    supabase: looksConfigured && !looksSecret ? { url: url!, publishableKey: key! } : null,
    cityPack: pack === 'none' ? null : 'sf',
  };
}
