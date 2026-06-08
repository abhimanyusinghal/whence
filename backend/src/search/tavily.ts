import type { SearchCandidate } from "../llm/utils.js";
import { publisherFromUrl } from "./publisher.js";
import type { ProviderKey, ProviderRequest, SearchProvider } from "./types.js";

const TAVILY_URL = "https://api.tavily.com/search";
const RAW_CONTENT_CAP = 4000;

type TavilyResult = {
  url: string;
  title: string;
  content: string;
  raw_content?: string;
  score?: number;
  published_date?: string;
};

type TavilyResponse = {
  results: TavilyResult[];
};

export const tavilyProvider: SearchProvider = {
  name: "tavily",
  async search(req: ProviderRequest, key: ProviderKey): Promise<SearchCandidate[]> {
    if (key.kind !== "string") throw new Error("tavily requires a string API key");

    const res = await fetch(TAVILY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key.value}`,
      },
      body: JSON.stringify({
        query: req.query,
        search_depth: "advanced",
        max_results: req.maxResults ?? 8,
        include_raw_content: req.includeRawContent ?? false,
        include_answer: false,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`tavily ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as TavilyResponse;
    return data.results.map((r) => {
      const useRaw = req.includeRawContent && r.raw_content;
      const text = useRaw ? (r.raw_content as string).slice(0, RAW_CONTENT_CAP) : r.content;
      return {
        url: r.url,
        title: r.title,
        publisher: publisherFromUrl(r.url),
        published_date: r.published_date ?? null,
        snippet: text,
      };
    });
  },
};
