import type { SearchCandidate } from "../llm/utils.js";
import { publisherFromUrl } from "./publisher.js";
import type { ProviderKey, ProviderRequest, SearchProvider } from "./types.js";

const SERPER_URL = "https://google.serper.dev/search";

type SerperOrganic = {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
};

type SerperResponse = {
  organic?: SerperOrganic[];
};

export const serperProvider: SearchProvider = {
  name: "serper",
  async search(req: ProviderRequest, key: ProviderKey): Promise<SearchCandidate[]> {
    if (key.kind !== "string") throw new Error("serper requires a string API key");

    const res = await fetch(SERPER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": key.value,
      },
      body: JSON.stringify({ q: req.query, num: req.maxResults ?? 8 }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`serper ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as SerperResponse;
    const items = data.organic ?? [];
    return items
      .filter((r): r is SerperOrganic & { link: string } => Boolean(r.link))
      .map((r) => ({
        url: r.link,
        title: r.title ?? "",
        publisher: publisherFromUrl(r.link),
        published_date: parseAsIso(r.date),
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
