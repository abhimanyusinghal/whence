import crypto from "node:crypto";
import { appendChainRecord } from "./chain_log.js";
import { createProvider, type LlmProvider } from "./llm/index.js";
import { logEntry, makeRequestId } from "./logger.js";
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
  requestId?: string;
};

export type AnalyzeOutput = AnalyzeResponse & { request_id: string };

export async function analyze(
  input: AnalyzeRequest,
  opts: AnalyzeOptions,
): Promise<AnalyzeOutput> {
  const requestId = opts.requestId ?? makeRequestId();
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

  // Phase 2 — per-claim Tavily + classify, parallelized + logged per claim.
  const articlePublisher = publisherFromUrl(input.url);
  let totalIn = extract.usage.input_tokens;
  let totalOut = extract.usage.output_tokens;
  let searchQueries = 0;

  const chains = await pLimit(claims, CLAIM_CONCURRENCY, async (claim) => {
    const claimT0 = Date.now();
    let searchCount = 0;
    let fallbackUsed = false;
    let claimError: string | null = null;
    let chain: ProvenanceChain;

    try {
      const rawCandidates = await tavilySearch({
        apiKey: opts.tavilyKey,
        query: claim.normalized,
        maxResults: 8,
      });
      searchCount = 1;
      searchQueries++;
      const candidates = withInlineLink(rawCandidates, claim.inline_link ?? null);

      const firstPass = await provider.classifyChain({
        article_url: input.url,
        article_title: input.title,
        article_publisher: articlePublisher,
        claim: { ...claim, inline_link: claim.inline_link ?? null },
        candidates,
      });
      totalIn += firstPass.usage.input_tokens;
      totalOut += firstPass.usage.output_tokens;
      chain = { ...firstPass.chain, claim_id: claim.id } satisfies ProvenanceChain;

      // False-untraceable retry: when the first pass returns untraceable,
      // re-search with raw_content=true so the classifier sees full page
      // text instead of teaser snippets, then re-classify. Catches cases
      // where the primary IS in candidates but its snippet doesn't quote
      // the claim's specific figure verbatim.
      if (chain.status === "untraceable") {
        const richCandidates = await tavilySearch({
          apiKey: opts.tavilyKey,
          query: claim.normalized,
          maxResults: 8,
          includeRawContent: true,
        });
        searchCount = 2;
        searchQueries++;
        const richWithInline = withInlineLink(richCandidates, claim.inline_link ?? null);

        const secondPass = await provider.classifyChain({
          article_url: input.url,
          article_title: input.title,
          article_publisher: articlePublisher,
          claim: { ...claim, inline_link: claim.inline_link ?? null },
          candidates: richWithInline,
        });
        totalIn += secondPass.usage.input_tokens;
        totalOut += secondPass.usage.output_tokens;
        fallbackUsed = true;

        // Only adopt the second-pass chain if it actually found something.
        // If it also returns untraceable, keep the first-pass result —
        // they're equivalent on outcome and the first one's notes are
        // more honest about why nothing surfaced.
        if (secondPass.chain.status !== "untraceable") {
          chain = { ...secondPass.chain, claim_id: claim.id } satisfies ProvenanceChain;
        }
      }
    } catch (err) {
      claimError = err instanceof Error ? err.message : String(err);
      chain = {
        claim_id: claim.id,
        status: "untraceable",
        hop_count: -1,
        nodes: [],
        notes: `Classification failed: ${claimError.slice(0, 200)}`,
      };
    }

    const ts = new Date().toISOString();
    const claimMs = Date.now() - claimT0;

    logEntry({
      type: "claim",
      ts,
      request_id: requestId,
      claim_id: claim.id,
      claim_category: claim.category,
      importance: claim.importance,
      model: provider.classifyModelLabel,
      search_count: searchCount,
      ms: claimMs,
      status: chain.status,
      hop_count: chain.hop_count,
      fallback_used: fallbackUsed,
      error: claimError,
    });

    await appendChainRecord({
      ts,
      request_id: requestId,
      url: input.url,
      title: input.title,
      claim,
      chain,
      model: provider.classifyModelLabel,
      search_count: searchCount,
      ms: claimMs,
      fallback_used: fallbackUsed,
      error: claimError,
    });

    return chain;
  });

  const meta: AnalyzeMeta = {
    tokens_used: totalIn + totalOut,
    search_queries: searchQueries,
    ms: Date.now() - t0,
  };

  return { claims, chains, meta, request_id: requestId };
}
