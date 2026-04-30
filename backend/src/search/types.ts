import type { SearchCandidate } from "../llm/utils.js";

export type ProviderName = "tavily" | "brave" | "serper" | "google_pse" | "bing";

/** Per-provider auth. Optional — providers fall back to env-supplied keys. */
export type ProviderCredentials = {
  tavily?: string;
  brave?: string;
  serper?: string;
  google_pse?: { key: string; cx: string };
  bing?: string;
};

export type SearchOptions = {
  /** Subset of providers to use. Omit/null = use whichever the server has keys for. */
  providers?: ProviderName[];
  /** User-supplied keys (BYOK). Overrides env keys for the listed provider(s). */
  byok?: ProviderCredentials;
};

export type ProviderRequest = {
  query: string;
  maxResults?: number;
  /** Tavily-only: ask the provider for full page text instead of a teaser. */
  includeRawContent?: boolean;
};

export type ProviderResult = {
  candidates: SearchCandidate[];
  provider: ProviderName;
};

export interface SearchProvider {
  readonly name: ProviderName;
  /** Returns the provider's results, or throws if it cannot. The aggregator handles failures. */
  search(req: ProviderRequest, key: ProviderKey): Promise<SearchCandidate[]>;
}

/**
 * Resolved credentials handed to a provider's search() call. The aggregator
 * picks BYOK over env on a per-provider basis before invoking each provider.
 */
export type ProviderKey =
  | { kind: "string"; value: string }
  | { kind: "google_pse"; key: string; cx: string };

export type AggregatedSearchResult = {
  candidates: SearchCandidate[];
  /** Providers that returned at least one result. */
  providersUsed: ProviderName[];
  /** Providers that were enabled but failed; key is provider name, value is error message. */
  providerErrors: Record<string, string>;
  /** Providers that were requested but skipped because no key was available. */
  providersSkipped: ProviderName[];
};
