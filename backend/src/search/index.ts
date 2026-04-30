export { aggregateSearch, tavilyRawRetry } from "./aggregator.js";
export type { AggregateOptions, EnvKeys } from "./aggregator.js";
export { publisherFromUrl } from "./publisher.js";
export type {
  AggregatedSearchResult,
  ProviderCredentials,
  ProviderName,
  SearchOptions,
} from "./types.js";

import type { SearchCandidate } from "../llm/utils.js";

/**
 * Inject the article's inline_link as an additional candidate if it exists
 * and isn't already in the search results. Treats it as the article's own
 * declared source — high-credibility lead for the classifier.
 *
 * Lifted unchanged from the legacy single-provider search module.
 */
export function withInlineLink(
  candidates: SearchCandidate[],
  inlineLink: string | null,
  inlineTitle?: string,
): SearchCandidate[] {
  if (!inlineLink) return candidates;
  const norm = (u: string) => {
    try {
      return new URL(u).toString().toLowerCase().replace(/\/$/, "");
    } catch {
      return u.toLowerCase();
    }
  };
  if (candidates.some((c) => norm(c.url) === norm(inlineLink))) return candidates;

  return [
    ...candidates,
    {
      url: inlineLink,
      title: inlineTitle ?? `[article inline link]`,
      publisher: publisherFromUrlForInline(inlineLink),
      published_date: null,
      snippet: "(injected from article's inline link; not from search results)",
    },
  ];
}

function publisherFromUrlForInline(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}
