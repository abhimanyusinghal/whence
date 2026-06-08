import type { SearchCandidate } from "../llm/utils.js";
import { publisherFromUrl } from "./publisher.js";
import type { ProviderKey, ProviderRequest, SearchProvider } from "./types.js";

const BING_URL = "https://api.bing.microsoft.com/v7.0/search";

type BingWebPage = {
  url: string;
  name?: string;
  snippet?: string;
  datePublished?: string;
  displayUrl?: string;
};

type BingResponse = {
  webPages?: { value?: BingWebPage[] };
};

export const bingProvider: SearchProvider = {
  name: "bing",
  async search(req: ProviderRequest, key: ProviderKey): Promise<SearchCandidate[]> {
    if (key.kind !== "string") throw new Error("bing requires a string API key");

    const params = new URLSearchParams({
      q: req.query,
      count: String(req.maxResults ?? 8),
      responseFilter: "Webpages",
      textFormat: "Raw",
    });

    const res = await fetch(`${BING_URL}?${params.toString()}`, {
      method: "GET",
      headers: { "Ocp-Apim-Subscription-Key": key.value },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`bing ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as BingResponse;
    const items = data.webPages?.value ?? [];
    return items.map((r) => ({
      url: r.url,
      title: r.name ?? "",
      publisher: r.displayUrl ?? publisherFromUrl(r.url),
      published_date: parseAsIso(r.datePublished),
      snippet: r.snippet ?? "",
    }));
  },
};

function parseAsIso(s: string | undefined): string | null {
  if (!s) return null;
  const d = Date.parse(s);
  if (Number.isNaN(d)) return null;
  return new Date(d).toISOString().slice(0, 10);
}
