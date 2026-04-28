import crypto from "node:crypto";

export type ClaimLogEntry = {
  type: "claim";
  ts: string;
  request_id: string;
  claim_id: string;
  claim_category: string;
  importance: number;
  model: string;
  search_count: number;
  ms: number;
  status: string;
  hop_count: number;
  fallback_used: boolean;
  error: string | null;
};

export type RequestLogEntry = {
  type: "request";
  ts: string;
  request_id: string;
  url: string;
  title: string;
  page_text_len: number;
  page_links_count: number;
  cache_hit: boolean;
  claim_count: number;
  total_ms: number;
  total_tokens: number;
  search_queries: number;
  status_counts: Record<string, number>;
  error: string | null;
};

export type LogEntry = ClaimLogEntry | RequestLogEntry;

export function makeRequestId(): string {
  return "req_" + crypto.randomBytes(6).toString("hex");
}

/**
 * Emit a single structured log line to stderr.
 * One JSON object per line — feeds cleanly into log aggregators (loki, datadog,
 * elk, cloudflare logpush) and is the substrate for the JSONL chain log that
 * later becomes the graph database (next roadmap item).
 *
 * Goes to stderr so CLI runners can pipe their stdout JSON dump to jq without
 * interleaving log events.
 */
export function logEntry(entry: LogEntry): void {
  process.stderr.write(JSON.stringify(entry) + "\n");
}
