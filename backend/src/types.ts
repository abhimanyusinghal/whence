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
  snippet: string;             // matched excerpt
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

export type AnalyzeRequest = {
  url: string;
  title: string;
  page_text: string;            // capped to 60k chars upstream
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
