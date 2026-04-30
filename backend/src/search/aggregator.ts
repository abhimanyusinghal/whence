import type { SearchCandidate } from "../llm/utils.js";
import { bingProvider } from "./bing.js";
import { braveProvider } from "./brave.js";
import { googlePseProvider } from "./google_pse.js";
import { serperProvider } from "./serper.js";
import { tavilyProvider } from "./tavily.js";
import type {
  AggregatedSearchResult,
  ProviderCredentials,
  ProviderKey,
  ProviderName,
  SearchProvider,
} from "./types.js";

const PROVIDERS: Record<ProviderName, SearchProvider> = {
  tavily: tavilyProvider,
  brave: braveProvider,
  serper: serperProvider,
  google_pse: googlePseProvider,
  bing: bingProvider,
};

const PER_PROVIDER_TIMEOUT_MS = 10_000;

export type EnvKeys = {
  tavily?: string;
  brave?: string;
  serper?: string;
  google_pse?: { key: string; cx: string };
  bing?: string;
};

export type AggregateOptions = {
  query: string;
  maxResults?: number;
  /** Tavily-specific: ask for full page text. Other providers ignore. */
  includeRawContent?: boolean;
  /** Subset of providers to run. If undefined, runs every provider for which a key is available. */
  providers?: ProviderName[];
  /** Per-request BYOK keys, take precedence over env keys. */
  byok?: ProviderCredentials;
  /** Server-side env keys (the public default). */
  env: EnvKeys;
};

/**
 * Resolve the credentials for a single provider. BYOK wins, otherwise env.
 * Returns null if neither path has a usable key.
 */
function resolveKey(
  name: ProviderName,
  byok: ProviderCredentials | undefined,
  env: EnvKeys,
): ProviderKey | null {
  if (name === "google_pse") {
    const b = byok?.google_pse;
    if (b?.key && b.cx) return { kind: "google_pse", key: b.key, cx: b.cx };
    const e = env.google_pse;
    if (e?.key && e.cx) return { kind: "google_pse", key: e.key, cx: e.cx };
    return null;
  }
  const b = (byok ?? {})[name];
  if (typeof b === "string" && b.length > 0) return { kind: "string", value: b };
  const e = (env ?? {})[name];
  if (typeof e === "string" && e.length > 0) return { kind: "string", value: e };
  return null;
}

/**
 * Pick the providers to actually run for this query.
 *  - if `opts.providers` is given, that's the candidate set; skip any
 *    provider in that list that has no resolvable key (record as skipped).
 *  - otherwise, run every provider that has a usable key.
 */
function selectProviders(
  opts: AggregateOptions,
): { runnable: ProviderName[]; skipped: ProviderName[] } {
  const requested: ProviderName[] = opts.providers ?? (Object.keys(PROVIDERS) as ProviderName[]);
  const runnable: ProviderName[] = [];
  const skipped: ProviderName[] = [];
  for (const name of requested) {
    if (!(name in PROVIDERS)) continue;
    const key = resolveKey(name, opts.byok, opts.env);
    if (key) runnable.push(name);
    else skipped.push(name);
  }
  return { runnable, skipped };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Canonicalize a URL for dedupe: drop fragment, default to https, strip
 * trailing slash on path, lowercase host. Tracking parameters are deliberately
 * NOT stripped — different `?utm_source` values could still legitimately point
 * at different cached/syndicated copies, and we'd rather over-keep than
 * accidentally collapse two different articles.
 */
function canonicalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    let s = url.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

type Bucket = {
  candidate: SearchCandidate;
  providersFound: Set<ProviderName>;
  /** Lowest first-position seen across providers — used as a coarse rank signal. */
  bestPosition: number;
};

/**
 * Merge results from all providers into a deduped, ranked candidate list.
 *
 * Ranking: cross-provider corroboration is the strongest signal — a URL
 * found by 3 providers ranks above a URL found by only 1, even if that 1
 * was first in its own list. After that, lower bestPosition wins.
 *
 * Snippet picking: when the same URL came from multiple providers, take
 * the longest snippet (more context for the classifier).
 *
 * `published_date`: take the first non-null value seen.
 */
function merge(
  perProvider: Array<{ provider: ProviderName; candidates: SearchCandidate[] }>,
  cap: number,
): SearchCandidate[] {
  const buckets = new Map<string, Bucket>();
  for (const { provider, candidates } of perProvider) {
    candidates.forEach((c, i) => {
      const key = canonicalizeUrl(c.url);
      const existing = buckets.get(key);
      if (existing) {
        existing.providersFound.add(provider);
        if (i < existing.bestPosition) existing.bestPosition = i;
        if ((c.snippet?.length ?? 0) > (existing.candidate.snippet?.length ?? 0)) {
          existing.candidate.snippet = c.snippet;
        }
        if (!existing.candidate.published_date && c.published_date) {
          existing.candidate.published_date = c.published_date;
        }
        if (!existing.candidate.title && c.title) existing.candidate.title = c.title;
      } else {
        buckets.set(key, {
          candidate: { ...c },
          providersFound: new Set([provider]),
          bestPosition: i,
        });
      }
    });
  }

  const sorted = Array.from(buckets.values()).sort((a, b) => {
    if (a.providersFound.size !== b.providersFound.size) {
      return b.providersFound.size - a.providersFound.size;
    }
    return a.bestPosition - b.bestPosition;
  });

  return sorted.slice(0, cap).map((b) => b.candidate);
}

export async function aggregateSearch(opts: AggregateOptions): Promise<AggregatedSearchResult> {
  const { runnable, skipped } = selectProviders(opts);
  const cap = opts.maxResults ?? 8;

  const settled = await Promise.all(
    runnable.map(async (name) => {
      const provider = PROVIDERS[name];
      const key = resolveKey(name, opts.byok, opts.env)!; // selectProviders guaranteed non-null
      try {
        const candidates = await withTimeout(
          provider.search(
            { query: opts.query, maxResults: cap, includeRawContent: opts.includeRawContent },
            key,
          ),
          PER_PROVIDER_TIMEOUT_MS,
          name,
        );
        return { name, ok: true as const, candidates };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { name, ok: false as const, error: msg };
      }
    }),
  );

  const successful = settled.filter((s): s is { name: ProviderName; ok: true; candidates: SearchCandidate[] } => s.ok);
  const failed = settled.filter((s): s is { name: ProviderName; ok: false; error: string } => !s.ok);

  const merged = merge(
    successful.map((s) => ({ provider: s.name, candidates: s.candidates })),
    cap,
  );

  const errors: Record<string, string> = {};
  for (const f of failed) errors[f.name] = f.error;

  return {
    candidates: merged,
    providersUsed: successful.filter((s) => s.candidates.length > 0).map((s) => s.name),
    providerErrors: errors,
    providersSkipped: skipped,
  };
}

/** Tavily-only re-search with raw_content=true, used for the false-untraceable retry. */
export async function tavilyRawRetry(
  query: string,
  cap: number,
  byok: ProviderCredentials | undefined,
  env: EnvKeys,
): Promise<{ candidates: SearchCandidate[]; error?: string } | null> {
  const key = resolveKey("tavily", byok, env);
  if (!key) return null;
  try {
    const candidates = await withTimeout(
      tavilyProvider.search(
        { query, maxResults: cap, includeRawContent: true },
        key,
      ),
      PER_PROVIDER_TIMEOUT_MS,
      "tavily",
    );
    return { candidates };
  } catch (err) {
    return { candidates: [], error: err instanceof Error ? err.message : String(err) };
  }
}
