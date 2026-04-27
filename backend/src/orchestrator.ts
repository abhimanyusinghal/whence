import crypto from "node:crypto";
import { createProvider, type LlmProvider } from "./llm/index.js";
import { publisherFromUrl, tavilySearch, withInlineLink } from "./search.js";
import type {
  AnalyzeMeta,
  AnalyzeRequest,
  AnalyzeResponse,
  Claim,
  ProvenanceChain,
} from "./types.js";

const PAGE_TEXT_HEAD = 45_000;
const PAGE_TEXT_TAIL = 15_000;
const PAGE_TEXT_CAP = PAGE_TEXT_HEAD + PAGE_TEXT_TAIL;
const CLAIM_CONCURRENCY = 4;

function truncatePageText(text: string): string {
  if (text.length <= PAGE_TEXT_CAP) return text;
  const dropped = text.length - PAGE_TEXT_CAP;
  return [
    text.slice(0, PAGE_TEXT_HEAD),
    `\n\n[...truncated ${dropped} chars from middle...]\n\n`,
    text.slice(text.length - PAGE_TEXT_TAIL),
  ].join("");
}

function makeClaimId(text: string): string {
  return "c_" + crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
}

async function pLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

export type AnalyzeOptions = {
  provider?: LlmProvider;
  tavilyKey: string;
};

export async function analyze(
  input: AnalyzeRequest,
  opts: AnalyzeOptions,
): Promise<AnalyzeResponse> {
  const t0 = Date.now();
  const provider = opts.provider ?? createProvider();

  const truncatedInput: AnalyzeRequest = {
    ...input,
    page_text: truncatePageText(input.page_text),
  };

  // Phase 1 — extract claims (one call).
  const extract = await provider.extractClaims(truncatedInput);
  const claims: Claim[] = extract.claims.map((c) => ({
    id: makeClaimId(c.text),
    text: c.text,
    normalized: c.normalized,
    category: c.category,
    importance: c.importance,
    inline_link: c.inline_link ?? undefined,
  }));

  // Phase 2 — per-claim Tavily + classify, parallelized.
  const articlePublisher = publisherFromUrl(input.url);
  let searchQueries = 0;
  let totalIn = extract.usage.input_tokens;
  let totalOut = extract.usage.output_tokens;

  const chains = await pLimit(claims, CLAIM_CONCURRENCY, async (claim) => {
    try {
      const rawCandidates = await tavilySearch({
        apiKey: opts.tavilyKey,
        query: claim.normalized,
        maxResults: 8,
      });
      searchQueries++;
      const candidates = withInlineLink(rawCandidates, claim.inline_link ?? null);

      const result = await provider.classifyChain({
        article_url: input.url,
        article_title: input.title,
        article_publisher: articlePublisher,
        claim: { ...claim, inline_link: claim.inline_link ?? null },
        candidates,
      });
      totalIn += result.usage.input_tokens;
      totalOut += result.usage.output_tokens;
      return { ...result.chain, claim_id: claim.id } satisfies ProvenanceChain;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[orchestrator] claim ${claim.id} failed:`, msg);
      return {
        claim_id: claim.id,
        status: "untraceable" as const,
        hop_count: -1,
        nodes: [],
        notes: `Classification failed: ${msg.slice(0, 200)}`,
      };
    }
  });

  const meta: AnalyzeMeta = {
    tokens_used: totalIn + totalOut,
    search_queries: searchQueries,
    ms: Date.now() - t0,
  };

  return { claims, chains, meta };
}
