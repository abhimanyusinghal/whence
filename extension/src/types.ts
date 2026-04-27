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

export type AnalyzeRequest = {
  url: string;
  title: string;
  page_text: string;
  page_links: PageLink[];
};

export type AnalyzeMeta = {
  tokens_used: number;
  search_queries: number;
  ms: number;
};

export type AnalyzeResponse = {
  claims: Claim[];
  chains: ProvenanceChain[];
  meta: AnalyzeMeta;
};

// Internal extension messages
export type AnalyzeMessage = { type: "ANALYZE" };
export type AnalyzeStartedMessage = { type: "ANALYSIS_STARTED"; tabId: number };
export type AnalyzeResultMessage = {
  type: "ANALYSIS_RESULT";
  tabId: number;
  data: AnalyzeResponse;
  highlight_stats?: { matched: number; total: number };
};
export type AnalyzeErrorMessage = { type: "ANALYSIS_ERROR"; error: string };
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
