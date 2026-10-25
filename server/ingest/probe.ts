/**
 * Scores candidate Instagram accounts by how many usable SF events their
 * recent posts contain, so sources.json can be filled with accounts that
 * actually post events. Pure apart from the optional readers passed in.
 */
import { postsToRecords, sourceFor, type PipelineOptions, type SfSource, type SfSourcesConfig } from './sfPipeline.ts';

export interface Candidate {
  url: string;
  category: string;
  note?: string;
}

export type Verdict = 'good' | 'some' | 'no_events' | 'no_posts';

export interface ProbeResult {
  url: string;
  category: string;
  note?: string;
  posts: number;
  events: number;
  /** ISO time of the newest post returned, if any. */
  newestPost?: string;
  verdict: Verdict;
  /** A few event titles, so you can judge quality at a glance. */
  examples: string[];
}

export function verdictFor(posts: number, events: number): Verdict {
  if (posts === 0) return 'no_posts';
  if (events === 0) return 'no_events';
  return events / posts >= 0.3 ? 'good' : 'some';
}

export async function scoreCandidates(
  items: unknown[],
  candidates: Candidate[],
  config: SfSourcesConfig,
  options: PipelineOptions,
): Promise<ProbeResult[]> {
  const sources: SfSource[] = candidates.map((c) => ({ url: c.url, limit: 0, category: c.category }));
  const results: ProbeResult[] = [];
  for (const [i, candidate] of candidates.entries()) {
    const mine = items.filter((item) => {
      if (!item || typeof item !== 'object') return false;
      return sourceFor(item as Record<string, unknown>, sources) === sources[i];
    });
    const posts = mine.filter((m) => !(m as { error?: unknown }).error);
    const { records } = await postsToRecords(posts, { ...config, sources: [sources[i]!] }, options);
    const newest = posts
      .map((p) => (p as { timestamp?: unknown }).timestamp)
      .filter((t): t is string => typeof t === 'string')
      .sort()
      .at(-1);
    results.push({
      url: candidate.url,
      category: candidate.category,
      ...(candidate.note ? { note: candidate.note } : {}),
      posts: posts.length,
      events: records.length,
      ...(newest ? { newestPost: newest } : {}),
      verdict: verdictFor(posts.length, records.length),
      examples: records.slice(0, 3).map((r) => String(r.title)),
    });
  }
  const rank: Record<Verdict, number> = { good: 0, some: 1, no_events: 2, no_posts: 3 };
  return results.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.events - a.events);
}

/** Adds accounts that gave events to the sources config, with a per-account limit scaled to their yield. */
export function adoptSources(
  config: SfSourcesConfig,
  results: ProbeResult[],
): { config: SfSourcesConfig; added: string[] } {
  const known = new Set(config.sources.map((s) => s.url.replace(/\/+$/, '').toLowerCase()));
  const added: string[] = [];
  const sources = [...config.sources];
  for (const r of results) {
    if (r.verdict !== 'good' && r.verdict !== 'some') continue;
    if (known.has(r.url.replace(/\/+$/, '').toLowerCase())) continue;
    sources.push({
      url: r.url,
      limit: r.verdict === 'good' ? 15 : 8,
      category: r.category,
      confirmed: true,
      note: `${r.note ?? 'Added by probe'} (probe: ${r.events} events in ${r.posts} posts)`,
    });
    added.push(r.url);
  }
  return { config: { ...config, sources }, added };
}
