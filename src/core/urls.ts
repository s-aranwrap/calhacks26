/**
 * URL safety and canonicalization.
 *
 * Security boundary: catalog URLs come from untrusted sources (CSV files,
 * scraped posts) and are later opened with `Linking.openURL`. Only http(s)
 * URLs are allowed through, so `javascript:`, `intent:` or custom-scheme links
 * can never reach the device's URL handler.
 */

const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'igshid',
  'igsh',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'si',
  'spm',
]);

const MAX_URL_LENGTH = 2048;

/** Returns a trimmed http(s) URL, or undefined if the value is not a safe web URL. */
export function sanitizeHttpUrl(value: unknown, { httpsOnly = false } = {}): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  const allowed = httpsOnly ? ['https:'] : ['https:', 'http:'];
  if (!allowed.includes(parsed.protocol)) return undefined;
  if (!parsed.hostname || parsed.username || parsed.password) return undefined;
  return parsed.toString();
}

/**
 * Canonical form used for deduplication: lowercase host without "www.", no
 * fragment, no tracking parameters, sorted query, no trailing slash. Instagram
 * post/reel URLs collapse to `instagram.com/p/<shortcode>`.
 */
export function canonicalizeUrl(value: string | undefined): string | undefined {
  const safe = sanitizeHttpUrl(value);
  if (!safe) return undefined;
  const url = new URL(safe);
  const host = url.hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/^m\./, '');

  const instagramShortcode = instagramShortcodeFromUrl(url);
  if (instagramShortcode) return `instagram.com/p/${instagramShortcode}`;

  const params = [...url.searchParams.entries()]
    .filter(([key]) => !key.toLowerCase().startsWith('utm_') && !TRACKING_PARAMS.has(key.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  const path = url.pathname.replace(/\/+$/, '') || '';
  return `${host}${path}${query}`;
}

/** Extracts the shortcode from instagram.com/p/<code>, /reel/<code> or /tv/<code>. */
export function instagramShortcodeFromUrl(url: URL | string): string | undefined {
  let parsed: URL;
  try {
    parsed = typeof url === 'string' ? new URL(url) : url;
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'instagram.com' && !host.endsWith('.instagram.com')) return undefined;
  const match = parsed.pathname.match(/^\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return match?.[1];
}
