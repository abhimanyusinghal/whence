// This function is serialized and injected into the active tab via
// chrome.scripting.executeScript. It runs in the page's main world,
// has DOM access but NO chrome.* APIs and NO closure over module scope —
// it must be entirely self-contained.

import type { AnalyzeRequest, PageLink, PageProvenance } from "./types.js";

export async function extractPageData(): Promise<AnalyzeRequest> {
  const PAGE_TEXT_CAP = 60_000;

  // ---- Visible-text walker (display:none / visibility:hidden / aria-hidden /
  // <script>/<style>/<template>/<iframe>/<svg>/<canvas> are all excluded).
  // This is the prompt-injection defense at the DOM layer: text the user
  // never saw should never reach the model.
  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEMPLATE",
    "IFRAME",
    "SVG",
    "CANVAS",
  ]);

  function visibleText(root: Element): string {
    function walk(el: Element): string {
      if (SKIP_TAGS.has(el.tagName)) return "";
      if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return "";
      const cs = window.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return "";
      let out = "";
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          out += (child as Text).data;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          out += walk(child as Element);
        }
      }
      return out;
    }
    return walk(root);
  }

  // ---- Links
  const links: PageLink[] = [];
  const seen = new Set<string>();
  const anchors = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];

  for (const a of anchors) {
    const href = a.href;
    if (!href || !/^https?:/i.test(href)) continue;

    const anchor_text = (a.innerText || a.textContent || "").trim().slice(0, 200);
    if (!anchor_text) continue;

    const key = href + "|" + anchor_text;
    if (seen.has(key)) continue;
    seen.add(key);

    const container =
      a.closest("p, li, blockquote, article, section, td, dd") ?? a.parentElement;
    let near = container ? (container as HTMLElement).innerText ?? "" : a.textContent ?? "";
    near = near.replace(/\s+/g, " ").trim();
    if (near.length > 600) near = near.slice(0, 600);

    links.push({ href, anchor_text, near_text: near });
  }

  // ---- Page text (visible only, whitespace-collapsed, capped)
  const rawVisible = visibleText(document.body)
    .replace(/\s+/g, " ")
    .trim();
  const page_text =
    rawVisible.length <= PAGE_TEXT_CAP
      ? rawVisible
      : rawVisible.slice(0, PAGE_TEXT_CAP * 0.75) +
        "\n\n[...truncated...]\n\n" +
        rawVisible.slice(rawVisible.length - PAGE_TEXT_CAP * 0.25);

  // ---- Provenance metadata (best-effort; all fields optional downstream)
  function metaContent(selector: string): string | undefined {
    const el = document.querySelector<HTMLMetaElement>(selector);
    const v = el?.content?.trim();
    return v || undefined;
  }

  function jsonLdAuthor(): string | undefined {
    try {
      const scripts = Array.from(
        document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
      );
      for (const s of scripts) {
        const txt = s.textContent?.trim();
        if (!txt) continue;
        let data: unknown;
        try {
          data = JSON.parse(txt);
        } catch {
          continue;
        }
        const items = Array.isArray(data) ? data : [data];
        for (const raw of items) {
          if (!raw || typeof raw !== "object") continue;
          const obj = raw as Record<string, unknown>;
          const a = obj.author;
          if (typeof a === "string" && a.trim()) return a.trim();
          if (a && typeof a === "object") {
            const name = (a as Record<string, unknown>).name;
            if (typeof name === "string" && name.trim()) return name.trim();
          }
          if (Array.isArray(a) && a.length) {
            const first = a[0];
            if (typeof first === "string" && first.trim()) return first.trim();
            if (first && typeof first === "object") {
              const name = (first as Record<string, unknown>).name;
              if (typeof name === "string" && name.trim()) return name.trim();
            }
          }
        }
      }
    } catch {
      /* JSON-LD is optional */
    }
    return undefined;
  }

  function jsonLdPublishedDate(): string | undefined {
    try {
      const scripts = Array.from(
        document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
      );
      for (const s of scripts) {
        const txt = s.textContent?.trim();
        if (!txt) continue;
        let data: unknown;
        try {
          data = JSON.parse(txt);
        } catch {
          continue;
        }
        const items = Array.isArray(data) ? data : [data];
        for (const raw of items) {
          if (!raw || typeof raw !== "object") continue;
          const obj = raw as Record<string, unknown>;
          const dp = obj.datePublished ?? obj.dateCreated;
          if (typeof dp === "string" && dp.trim()) return dp.trim();
        }
      }
    } catch {
      /* optional */
    }
    return undefined;
  }

  const canonicalUrl =
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || undefined;

  const author =
    metaContent('meta[name="author"]') ??
    metaContent('meta[property="article:author"]') ??
    metaContent('meta[name="byl"]') ??
    jsonLdAuthor();

  const publishedDate =
    metaContent('meta[property="article:published_time"]') ??
    metaContent('meta[name="date"]') ??
    metaContent('meta[name="pubdate"]') ??
    metaContent('meta[name="DC.date.issued"]') ??
    document.querySelector<HTMLTimeElement>("time[datetime]")?.dateTime ??
    jsonLdPublishedDate();

  // sha256 of the full HTML so a later re-fetch can prove the page changed.
  // Using the rendered DOM (post-JS) means we hash what the user actually saw.
  let htmlHash: string | undefined;
  try {
    const html = document.documentElement.outerHTML;
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(html));
    htmlHash = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    /* crypto.subtle should be available; if not, leave hash unset */
  }

  const provenance: PageProvenance = {
    canonical_url: canonicalUrl,
    author,
    published_date: publishedDate,
    accessed_at: new Date().toISOString(),
    html_hash: htmlHash,
  };

  return {
    url: location.href,
    title: document.title,
    page_text,
    page_links: links,
    provenance,
  };
}
