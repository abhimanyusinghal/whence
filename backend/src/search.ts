import type { SearchCandidate } from "./llm/utils.js";

const TAVILY_URL = "https://api.tavily.com/search";

type TavilyResult = {
  url: string;
  title: string;
  content: string;
  score?: number;
  published_date?: string;
};

type TavilyResponse = {
  query: string;
  answer?: string;
  results: TavilyResult[];
  response_time?: number;
};

export type SearchOpts = {
  apiKey: string;
  query: string;
  maxResults?: number;
};

export async function tavilySearch(opts: SearchOpts): Promise<SearchCandidate[]> {
  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      query: opts.query,
      search_depth: "advanced",
      max_results: opts.maxResults ?? 8,
      include_raw_content: false,
      include_answer: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tavily ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as TavilyResponse;
  return data.results.map((r) => ({
    url: r.url,
    title: r.title,
    publisher: publisherFromUrl(r.url),
    published_date: r.published_date ?? null,
    snippet: r.content,
  }));
}

export function publisherFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

/**
 * Inject the article's inline_link as an additional candidate if it exists
 * and isn't already in the search results. Treats it as the article's own
 * declared source — high credibility lead for the classifier.
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
      publisher: publisherFromUrl(inlineLink),
      published_date: null,
      snippet: "(injected from article's inline link; not from search results)",
    },
  ];
}
