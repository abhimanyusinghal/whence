import { promises as fs } from "node:fs";
import path from "node:path";
import type { Claim, ProvenanceChain } from "./types.js";

/**
 * One record per claim, denormalized so each line is self-sufficient when
 * we later parse it into a graph database. URL + title travel with every
 * record so we don't need a separate "request" table to reconstruct context.
 */
export type ChainLogRecord = {
  ts: string;
  request_id: string;
  url: string;
  title: string;
  claim: Claim;
  chain: ProvenanceChain;
  model: string;
  search_count: number;
  ms: number;
  fallback_used: boolean;
  error: string | null;
};

const DEFAULT_PATH = "./data/chains.jsonl";

let _resolvedPath: string | null = null;
let _disabled = false;
let _ensuredDir = false;

function getLogPath(): string | null {
  if (_disabled) return null;
  if (_resolvedPath !== null) return _resolvedPath;

  const raw = process.env.CHAINS_LOG_FILE;
  if (raw === "") {
    // explicit empty string = disabled
    _disabled = true;
    return null;
  }
  _resolvedPath = path.resolve(raw ?? DEFAULT_PATH);
  return _resolvedPath;
}

async function ensureDir(filePath: string): Promise<boolean> {
  if (_ensuredDir) return true;
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    _ensuredDir = true;
    return true;
  } catch (err) {
    console.error("[chain_log] failed to create directory:", err);
    _disabled = true;
    return false;
  }
}

/**
 * Append one record to the chain log. Awaits the write so failures are
 * surfaced before the response goes out, but we never throw — file errors
 * shouldn't kill an /analyze request.
 *
 * Linux/macOS: fs.appendFile in O_APPEND mode is atomic per call for short
 * writes, so concurrent claim handlers don't interleave lines. Windows has
 * the same guarantee for files opened with FILE_APPEND_DATA.
 */
export async function appendChainRecord(record: ChainLogRecord): Promise<void> {
  const filePath = getLogPath();
  if (!filePath) return;

  if (!(await ensureDir(filePath))) return;

  try {
    await fs.appendFile(filePath, JSON.stringify(record) + "\n", "utf8");
  } catch (err) {
    console.error("[chain_log] write failed:", err);
    // don't flip _disabled — could be transient
  }
}

/** Test helper — reset cached state so a new env var takes effect. */
export function _resetForTesting(): void {
  _resolvedPath = null;
  _disabled = false;
  _ensuredDir = false;
}
