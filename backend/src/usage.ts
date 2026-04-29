import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Per-call usage record. One line per /analyze call, denormalized so each
 * line is self-sufficient when we later parse it for billing or quota
 * reporting. Same JSONL discipline as the chain log.
 */
export type UsageRecord = {
  ts: string;
  request_id: string;
  principal: string;
  is_anonymous: boolean;
  url: string;
  cache_hit: boolean;
  claim_count: number;
  total_ms: number;
  total_tokens: number;
  search_queries: number;
  fallback_uses: number;
  status: "ok" | "error";
  error: string | null;
};

const DEFAULT_PATH = "./data/usage.jsonl";

let _path: string | null = null;
let _disabled = false;
let _ensuredDir = false;

function getPath(): string | null {
  if (_disabled) return null;
  if (_path !== null) return _path;
  const raw = process.env.USAGE_LOG_FILE;
  if (raw === "") {
    _disabled = true;
    return null;
  }
  _path = path.resolve(raw ?? DEFAULT_PATH);
  return _path;
}

async function ensureDir(filePath: string): Promise<boolean> {
  if (_ensuredDir) return true;
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    _ensuredDir = true;
    return true;
  } catch (err) {
    console.error("[usage] mkdir failed:", err);
    _disabled = true;
    return false;
  }
}

export async function appendUsage(record: UsageRecord): Promise<void> {
  const filePath = getPath();
  if (!filePath) return;
  if (!(await ensureDir(filePath))) return;
  try {
    await fs.appendFile(filePath, JSON.stringify(record) + "\n", "utf8");
  } catch (err) {
    console.error("[usage] append failed:", err);
  }
}

/**
 * In-memory rolling counters. Process-local; resets on restart. The JSONL
 * file is the durable record. These exist so a future /usage endpoint can
 * answer a quick "current call count" query without re-reading the file.
 */
type Counter = {
  call_count: number;
  total_tokens: number;
  total_searches: number;
  cache_hits: number;
  fallback_uses: number;
};

const counters = new Map<string, Counter>();

export function bumpUsage(
  principal: string,
  deltas: { total_tokens: number; total_searches: number; cache_hit: boolean; fallback_uses: number },
): void {
  let c = counters.get(principal);
  if (!c) {
    c = { call_count: 0, total_tokens: 0, total_searches: 0, cache_hits: 0, fallback_uses: 0 };
    counters.set(principal, c);
  }
  c.call_count++;
  c.total_tokens += deltas.total_tokens;
  c.total_searches += deltas.total_searches;
  c.fallback_uses += deltas.fallback_uses;
  if (deltas.cache_hit) c.cache_hits++;
}

export function getUsage(principal: string): Counter | null {
  return counters.get(principal) ?? null;
}

/** Test helper — clear counters between runs. */
export function _resetCounters(): void {
  counters.clear();
}
