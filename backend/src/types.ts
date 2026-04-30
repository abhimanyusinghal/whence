// Shared types between backend and extension. Mirror this file exactly on the extension side.

export type ClaimCategory =
  | "statistic"
  | "quote"
  | "study_reference"
  | "event"
  | "attribution";

export type Claim = {
  id: string;
  text: string;            // verbatim from page
  normalized: string;      // entity-extracted, searchable form
  category: ClaimCategory;
  importance: 1 | 2 | 3;   // 1 = core to article, 3 = peripheral
  inline_link?: string;    // url if the article linked the claim
};

export type SourceType = "primary" | "secondary" | "tertiary" | "social" | "unknown";

export type ProvenanceNode = {
  url: string;
  title: string;
  publisher: string;
  published_date?: string;
  type: SourceType;
  links_to_upstream: string[]; // urls this node cites for the claim
  snippet: string;             // matched excerpt (raw Tavily content; can be a teaser)
  evidence_quote: string;      // verbatim span from snippet that anchors the chain decision; "" if none
  source_quality_score: number; // 0..1; tie-breaker between candidates. See classify_chain.md.
};

export type ProvenanceStatus =
  | "primary"
  | "direct_cited"
  | "indirect_cited"
  | "stale_cited"
  | "circular"
  | "untraceable";

export type ProvenanceChain = {
  claim_id: string;
  status: ProvenanceStatus;
  hop_count: number;            // 0 = article is primary, 1 = direct, N = indirect, -1 = circular/untraceable
  nodes: ProvenanceNode[];      // ordered: article -> ... -> primary
  notes: string;                // 1-2 sentence reasoning
};

export type PageLink = {
  href: string;
  anchor_text: string;
  near_text: string;            // sentence containing the link, or ~200 chars surrounding
};

export type PageProvenance = {
  canonical_url?: string;       // <link rel="canonical">, falls back to url
  author?: string;              // best-effort from meta/JSON-LD
  published_date?: string;      // ISO 8601 when known
  accessed_at?: string;         // ISO 8601 timestamp from extension at extraction time
  html_hash?: string;           // sha256 hex of documentElement.outerHTML at extraction time
};

export type ProviderName = "tavily" | "brave" | "serper" | "google_pse" | "bing";

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
  /** Per-request BYOK keys, override env keys when set. */
  byok?: ProviderCredentials;
};

export type AnalyzeRequest = {
  url: string;
  title: string;
  page_text: string;            // capped to 60k chars upstream
  page_links: PageLink[];
  provenance?: PageProvenance;  // optional; older clients may omit
  search_options?: SearchOptions;
};

export type AnalyzeMeta = {
  tokens_used: number;
  search_queries: number;
  ms: number;
  /** Distinct providers that returned at least one result for this analysis. */
  search_providers_used?: ProviderName[];
  /**
   * Map of provider name → most recent error seen across this analysis. Only
   * includes providers that were attempted and failed at least once. Skipped
   * providers (no key available) appear in `search_providers_skipped` instead.
   */
  search_provider_errors?: Record<string, string>;
  /** Providers requested but skipped because no env or BYOK key was available. */
  search_providers_skipped?: ProviderName[];
};

export type AnalyzeResponse = {
  claims: Claim[];
  chains: ProvenanceChain[];
  meta: AnalyzeMeta;
};
