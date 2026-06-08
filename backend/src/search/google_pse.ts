import type { SearchCandidate } from "../llm/utils.js";
import { publisherFromUrl } from "./publisher.js";
import type { ProviderKey, ProviderRequest, SearchProvider } from "./types.js";

const GOOGLE_PSE_URL = "https://www.googleapis.com/customsearch/v1";

type GoogleItem = {
  link?: string;
  title?: string;
  snippet?: string;
  displayLink?: string;
  pagemap?: {
    metatags?: Array<Record<string, string>>;
    newsarticle?: Array<Record<string, string>>;
  };
};

type GoogleResponse = {
  items?: GoogleItem[];
};

/**
 * Google Programmable Search Engine. Requires both an API key (Cloud
 * Console) and a CSE id ("cx") that points at the configured engine. The
 * default free tier is 100 queries/day per CSE — by far the tightest of
 * the providers we support.
 */
export const googlePseProvider: SearchProvider = {
  name: "google_pse",
  async search(req: ProviderRequest, key: ProviderKey): Promise<SearchCandidate[]> {
    if (key.kind !== "google_pse") {
      throw new Error("google_pse requires { key, cx } credentials");
    }

    const params = new URLSearchParams({
      q: req.query,
      key: key.key,
      cx: key.cx,
      num: String(Math.min(req.maxResults ?? 8, 10)), // PSE max is 10 per page
    });

    const res = await fetch(`${GOOGLE_PSE_URL}?${params.toString()}`, { method: "GET" });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`google_pse ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as GoogleResponse;
    const items = data.items ?? [];
    return items
      .filter((r): r is GoogleItem & { link: string } => Boolean(r.link))
      .map((r) => ({
        url: r.link,
        title: r.title ?? "",
        publisher: r.displayLink ?? publisherFromUrl(r.link),
        published_date: extractDate(r),
        snippet: r.snippet ?? "",
      }));
  },
};

function extractDate(r: GoogleItem): string | null {
  const tags = r.pagemap?.metatags?.[0];
  const candidates = [
    tags?.["article:published_time"],
    tags?.["og:article:published_time"],
    tags?.["pubdate"],
    tags?.["date"],
    r.pagemap?.newsarticle?.[0]?.datepublished,
  ];
  for (const c of candidates) {
    if (!c) continue;
    const d = Date.parse(c);
    if (!Number.isNaN(d)) return new Date(d).toISOString().slice(0, 10);
  }
  return null;
}
