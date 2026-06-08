import crypto from "node:crypto";
import { appendChainRecord } from "./chain_log.js";
import { createProvider, type LlmProvider } from "./llm/index.js";
import { logEntry, makeRequestId } from "./logger.js";
import {
  aggregateSearch,
  publisherFromUrl,
  tavilyRawRetry,
  withInlineLink,
  type EnvKeys,
} from "./search/index.js";
import type {
  AnalyzeMeta,
  AnalyzeRequest,
  AnalyzeResponse,
  Claim,
  ProvenanceChain,
  ProviderName,
  SearchOptions,
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
  env: EnvKeys;
  searchOptions?: SearchOptions;
  requestId?: string;
};

export type AnalyzeOutput = AnalyzeResponse & {
  request_id: string;
  /** Count of claims where the false-untraceable retry fired. Diagnostic counter surfaced in the API response. */
  fallback_uses: number;
};

export async function analyze(
  input: AnalyzeRequest,
  opts: AnalyzeOptions,
): Promise<AnalyzeOutput> {
  const requestId = opts.requestId ?? makeRequestId();
  const t0 = Date.now();
  const provider = opts.provider ?? createProvider();
  const env = opts.env;
  const searchOptions = input.search_options ?? opts.searchOptions ?? {};

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

  // Phase 2 — per-claim search (multi-provider) + classify, parallelized.
  const articlePublisher = publisherFromUrl(input.url);
  let totalIn = extract.usage.input_tokens;
  let totalOut = extract.usage.output_tokens;
  let searchQueries = 0;
  let fallbackUses = 0;
  const providersUsed = new Set<ProviderName>();
  const providersSkipped = new Set<ProviderName>();
  const providerErrors: Record<string, string> = {};

  const chains = await pLimit(claims, CLAIM_CONCURRENCY, async (claim) => {
    const claimT0 = Date.now();
    let searchCount = 0;
    let fallbackUsed = false;
    let claimError: string | null = null;
    let chain: ProvenanceChain;

    try {
      const aggregated = await aggregateSearch({
        query: claim.normalized,
        maxResults: 8,
        env,
        providers: searchOptions.providers,
        byok: searchOptions.byok,
      });
      searchCount = 1;
      searchQueries += aggregated.providersUsed.length || 1;
      for (const p of aggregated.providersUsed) providersUsed.add(p);
      for (const p of aggregated.providersSkipped) providersSkipped.add(p);
      for (const [k, v] of Object.entries(aggregated.providerErrors)) providerErrors[k] = v;

      // No candidates from any provider AND no inline link → don't waste an
      // LLM call; immediately classify as untraceable. This also covers the
      // total-search-outage case cleanly: the user gets a useful error, not
      // a generic claim-failed message.
      if (aggregated.candidates.length === 0 && !claim.inline_link) {
        const reason =
          Object.keys(aggregated.providerErrors).length > 0
            ? `Search failed across all providers: ${Object.entries(aggregated.providerErrors)
                .map(([n, e]) => `${n}=${e.slice(0, 80)}`)
                .join("; ")
                .slice(0, 250)}`
            : "No search candidates found.";
        chain = {
          claim_id: claim.id,
          status: "untraceable",
          hop_count: -1,
          nodes: [],
          notes: reason,
        };
      } else {
        const candidates = withInlineLink(
          aggregated.candidates,
          claim.inline_link ?? null,
        );

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

        // False-untraceable retry: Tavily-only, asks for raw_content. We
        // only attempt when Tavily is part of the configured set and the
        // first pass came back untraceable. Other providers don't expose
        // a comparable raw-content mode.
        const tavilyEnabled =
          (searchOptions.providers ?? ["tavily"]).includes("tavily") &&
          (Boolean(searchOptions.byok?.tavily) || Boolean(env.tavily));
        if (chain.status === "untraceable" && tavilyEnabled) {
          const retry = await tavilyRawRetry(
            claim.normalized,
            8,
            searchOptions.byok,
            env,
          );
          if (retry && retry.candidates.length > 0) {
            searchCount = 2;
            searchQueries++;
            const richWithInline = withInlineLink(retry.candidates, claim.inline_link ?? null);
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
            fallbackUses++;
            if (secondPass.chain.status !== "untraceable") {
              chain = { ...secondPass.chain, claim_id: claim.id } satisfies ProvenanceChain;
            }
          } else if (retry?.error) {
            providerErrors.tavily = retry.error;
          }
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
      page_provenance: input.provenance,
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
    search_providers_used: Array.from(providersUsed),
    search_providers_skipped: Array.from(providersSkipped),
  };
  if (Object.keys(providerErrors).length > 0) meta.search_provider_errors = providerErrors;

  return { claims, chains, meta, request_id: requestId, fallback_uses: fallbackUses };
}
