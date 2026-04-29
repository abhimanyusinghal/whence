// Eval harness grader. Pure functions — no I/O, no side effects.
// Same algorithmic shape as extension/src/highlights.ts (whitespace-norm +
// 60-char-prefix fallback) but operating string→string instead of string→DOM.

import type { ProvenanceChain, ProvenanceStatus } from "../types.js";

export type PinnedClaim = {
  text: string;
  category: string;
  importance: number;
  inline_link: string | null;
  expected_status: ProvenanceStatus;
  acceptable_statuses?: ProvenanceStatus[];
  expected_primary_url?: string;
  known_issue?: boolean;
  notes?: string;
};

export type EvalEntry = {
  id: string;
  source: "synthetic" | "real";
  fixture?: string;
  url: string;
  title: string;
  added_date?: string;
  annotator?: string;
  notes?: string;
  claims: PinnedClaim[];
};

export type EvalDataset = {
  version: number;
  target_count: number;
  description: string;
  schema_notes?: string;
  entries: EvalEntry[];
};

const PUNCT_TRIM = /^[\s"'“”‘’(\[\{,.;:]+|[\s"'“”‘’),.;:!?\]\}]+$/g;

/**
 * Aggressive normalization for text-to-text matching at eval time.
 * Handles common LLM-output quirks: curly vs straight quotes, space-before-punct,
 * non-breaking spaces, leading/trailing punctuation. Reduces both sides to a
 * canonical form so equivalent claims with cosmetic differences match.
 */
export function normalizeText(s: string): string {
  return s
    .replace(/[‘’]/g, "'")           // curly single quotes → straight
    .replace(/[“”]/g, '"')           // curly double quotes → straight
    .replace(/[–—]/g, "-")           // en/em dash → hyphen
    .replace(/ /g, " ")                   // non-breaking space → space
    .replace(/\s+([,.;:!?])/g, "$1")           // strip space before punctuation
    .replace(/\s+/g, " ")                      // collapse whitespace runs
    .trim()
    .replace(PUNCT_TRIM, "")
    .toLowerCase();
}

export function normalizeUrl(u: string): string {
  try {
    const parsed = new URL(u);
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
    const host = parsed.host.replace(/^www\./i, "").toLowerCase();
    return `${parsed.protocol}//${host}${pathname}${parsed.search}`;
  } catch {
    return u.trim().toLowerCase();
  }
}

export function urlsMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  return normalizeUrl(a) === normalizeUrl(b);
}

export type MatchResult = {
  pinned: PinnedClaim;
  pinnedIndex: number;
  score: "exact" | "prefix";
};

/**
 * Find the closest pinned claim to an extracted claim's text.
 * Returns null if no match better than 60-char prefix is found.
 *
 * Algorithm:
 * 1. Normalize both sides (whitespace collapse, trim, lowercase, punctuation strip)
 * 2. Try mutual containment (either side contains the other) — score "exact"
 * 3. Try first-60-char prefix match — score "prefix"
 */
export function findBestPinned(
  extractedText: string,
  pinned: readonly PinnedClaim[],
): MatchResult | null {
  const ne = normalizeText(extractedText);
  if (ne.length < 20) return null;

  for (let i = 0; i < pinned.length; i++) {
    const np = normalizeText(pinned[i].text);
    if (np.length < 20) continue;
    if (np.includes(ne) || ne.includes(np)) {
      return { pinned: pinned[i], pinnedIndex: i, score: "exact" };
    }
  }

  if (ne.length < 60) return null;
  const probe = ne.slice(0, 60);
  for (let i = 0; i < pinned.length; i++) {
    const np = normalizeText(pinned[i].text);
    if (np.length < 60) continue;
    if (np.startsWith(probe) || np.includes(probe)) {
      return { pinned: pinned[i], pinnedIndex: i, score: "prefix" };
    }
  }

  return null;
}

export type ChainGrade = {
  status_correct: boolean;
  primary_correct: boolean | null; // null when expected_primary_url is unset
  overall: boolean;
  expected_status: ProvenanceStatus;
  acceptable_statuses: ProvenanceStatus[];
  actual_status: ProvenanceStatus;
  actual_primary_url: string | null;
};

const STATUS_LIST: ProvenanceStatus[] = [
  "primary",
  "direct_cited",
  "indirect_cited",
  "stale_cited",
  "circular",
  "untraceable",
];

export type StatusPair = { expected: ProvenanceStatus; actual: ProvenanceStatus };

export type StatusMetric = {
  status: ProvenanceStatus;
  predicted: number;       // count of pairs where actual_status === status
  actual: number;          // count of pairs where expected_status === status
  true_positive: number;
  precision: number | null; // null when predicted=0 (no division to do)
  recall: number | null;    // null when actual=0
  f1: number | null;
};

/**
 * Per-class precision / recall / F1 across the matched claims.
 *
 * Per-class metrics deliberately ignore acceptable_statuses — they treat
 * expected_status as the single ground-truth label. Use this view when
 * tuning prompts: it shows where the model systematically over- or
 * under-classifies a particular status. The overall accuracy stat
 * (which respects acceptable_statuses) is the user-facing pass/fail
 * number; this is the diagnostic.
 */
export function statusMetrics(pairs: readonly StatusPair[]): StatusMetric[] {
  return STATUS_LIST.map((status) => {
    const predicted = pairs.filter((p) => p.actual === status).length;
    const actual = pairs.filter((p) => p.expected === status).length;
    const tp = pairs.filter((p) => p.actual === status && p.expected === status).length;
    const precision = predicted ? tp / predicted : null;
    const recall = actual ? tp / actual : null;
    const f1 =
      precision !== null && recall !== null && precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : null;
    return { status, predicted, actual, true_positive: tp, precision, recall, f1 };
  });
}

export type ConfusionMatrix = Record<string, Record<string, number>>;

export function confusionMatrix(pairs: readonly StatusPair[]): ConfusionMatrix {
  const m: ConfusionMatrix = {};
  for (const e of STATUS_LIST) {
    m[e] = {};
    for (const a of STATUS_LIST) m[e][a] = 0;
  }
  for (const p of pairs) m[p.expected][p.actual]++;
  return m;
}

export function gradeChain(chain: ProvenanceChain, pinned: PinnedClaim): ChainGrade {
  const acceptable = pinned.acceptable_statuses ?? [pinned.expected_status];
  const status_correct = acceptable.includes(chain.status);

  let primary_correct: boolean | null = null;
  let actual_primary_url: string | null = null;
  if (chain.nodes.length > 0) {
    actual_primary_url = chain.nodes[chain.nodes.length - 1].url;
  }
  if (pinned.expected_primary_url) {
    primary_correct = urlsMatch(actual_primary_url, pinned.expected_primary_url);
  }

  const overall = status_correct && (primary_correct === null || primary_correct);

  return {
    status_correct,
    primary_correct,
    overall,
    expected_status: pinned.expected_status,
    acceptable_statuses: acceptable,
    actual_status: chain.status,
    actual_primary_url,
  };
}
