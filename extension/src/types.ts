// Mirrored from backend/src/types.ts. Keep in sync.

export type ClaimCategory =
  | "statistic"
  | "quote"
  | "study_reference"
  | "event"
  | "attribution";

export type Claim = {
  id: string;
  text: string;
  normalized: string;
  category: ClaimCategory;
  importance: 1 | 2 | 3;
  inline_link?: string;
};

export type SourceType = "primary" | "secondary" | "tertiary" | "social" | "unknown";

export type ProvenanceNode = {
  url: string;
  title: string;
  publisher: string;
  published_date?: string;
  type: SourceType;
  links_to_upstream: string[];
  snippet: string;
  evidence_quote: string;
  source_quality_score: number;
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
  hop_count: number;
  nodes: ProvenanceNode[];
  notes: string;
};

export type PageLink = {
  href: string;
  anchor_text: string;
  near_text: string;
};

export type PageProvenance = {
  canonical_url?: string;
  author?: string;
  published_date?: string;
  accessed_at?: string;
  html_hash?: string;
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
  providers?: ProviderName[];
  byok?: ProviderCredentials;
};

export type AnalyzeRequest = {
  url: string;
  title: string;
  page_text: string;
  page_links: PageLink[];
  provenance?: PageProvenance;
  search_options?: SearchOptions;
};

export type AnalyzeMeta = {
  tokens_used: number;
  search_queries: number;
  ms: number;
  search_providers_used?: ProviderName[];
  search_provider_errors?: Record<string, string>;
  search_providers_skipped?: ProviderName[];
};

export type AnalyzeResponse = {
  claims: Claim[];
  chains: ProvenanceChain[];
  meta: AnalyzeMeta;
};

// Internal extension messages.
//
// Every analyze flow carries a `requestId` end-to-end. The side panel
// generates it on click, the service worker echoes it through the
// STARTED / RESULT / ERROR replies, and the panel only applies a result
// if it matches the tab's currently-tracked running requestId. This is
// what prevents a stale, late-arriving result from overwriting a newer
// one when the user re-analyzes (or when concurrent runs overlap).
export type AnalyzeMessage = {
  type: "ANALYZE";
  requestId: string;
  searchOptions?: SearchOptions;
};
export type AnalyzeStartedMessage = {
  type: "ANALYSIS_STARTED";
  tabId: number;
  requestId: string;
  pageUrl: string;
};
export type AnalyzeResultMessage = {
  type: "ANALYSIS_RESULT";
  tabId: number;
  requestId: string;
  pageUrl: string;
  data: AnalyzeResponse;
  highlight_stats?: { matched: number; total: number };
};
export type AnalyzeErrorMessage = {
  type: "ANALYSIS_ERROR";
  error: string;
  tabId?: number;
  requestId?: string;
};
export type FocusHighlightMessage = { type: "FOCUS_HIGHLIGHT"; claim_id: string };
export type FocusClaimMessage = { type: "FOCUS_CLAIM"; claim_id: string };
export type ExtensionMessage =
  | AnalyzeMessage
  | AnalyzeStartedMessage
  | AnalyzeResultMessage
  | AnalyzeErrorMessage
  | FocusHighlightMessage
  | FocusClaimMessage;

export type AnalyzeReply =
  | { ok: true; data: AnalyzeResponse }
  | { ok: false; error: string };
