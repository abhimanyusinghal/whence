import type { SearchCandidate } from "../llm/utils.js";
import { publisherFromUrl } from "./publisher.js";
import type { ProviderKey, ProviderRequest, SearchProvider } from "./types.js";

const BRAVE_URL = "https://api.search.brave.com/res/v1/web/search";

type BraveWebResult = {
  url: string;
  title: string;
  description?: string;
  page_age?: string;
  profile?: { name?: string };
};

type BraveResponse = {
  web?: { results?: BraveWebResult[] };
};

export const braveProvider: SearchProvider = {
  name: "brave",
  async search(req: ProviderRequest, key: ProviderKey): Promise<SearchCandidate[]> {
    if (key.kind !== "string") throw new Error("brave requires a string API key");

    const params = new URLSearchParams({
      q: req.query,
      count: String(req.maxResults ?? 8),
      safesearch: "off",
    });
    const res = await fetch(`${BRAVE_URL}?${params.toString()}`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": key.value,
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`brave ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as BraveResponse;
    const items = data.web?.results ?? [];
    return items.map((r) => ({
      url: r.url,
      title: r.title ?? "",
      publisher: r.profile?.name ?? publisherFromUrl(r.url),
      // Brave's `page_age` is sometimes a duration string (e.g. "2 days ago")
      // — we only forward it when it parses as a date.
      published_date: parseAsIso(r.page_age),
      snippet: stripHtml(r.description ?? ""),
    }));
  },
};

function parseAsIso(s: string | undefined): string | null {
  if (!s) return null;
  const d = Date.parse(s);
  if (Number.isNaN(d)) return null;
  return new Date(d).toISOString().slice(0, 10);
}

function stripHtml(s: string): string {
  // Brave returns highlighted snippets with <strong> tags around matched terms.
  return s.replace(/<\/?[a-z][^>]*>/gi, "").replace(/\s+/g, " ").trim();
}
