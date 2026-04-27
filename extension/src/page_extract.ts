// This function is serialized and injected into the active tab via
// chrome.scripting.executeScript. It runs in the page's main world,
// has DOM access but NO chrome.* APIs and NO closure over module scope —
// it must be entirely self-contained.

import type { AnalyzeRequest, PageLink } from "./types.js";

export function extractPageData(): AnalyzeRequest {
  const PAGE_TEXT_CAP = 60_000;

  const links: PageLink[] = [];
  const seen = new Set<string>();
  const anchors = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];

  for (const a of anchors) {
    const href = a.href;
    if (!href || !/^https?:/i.test(href)) continue;

    const anchor_text = (a.innerText || a.textContent || "").trim().slice(0, 200);
    if (!anchor_text) continue;

    // Dedupe by href + anchor text (same link repeated in nav etc.)
    const key = href + "|" + anchor_text;
    if (seen.has(key)) continue;
    seen.add(key);

    // Walk up to a sentence-ish container for context.
    const container =
      a.closest("p, li, blockquote, article, section, td, dd") ?? a.parentElement;
    let near = container ? (container as HTMLElement).innerText ?? "" : a.textContent ?? "";
    near = near.replace(/\s+/g, " ").trim();
    if (near.length > 600) near = near.slice(0, 600);

    links.push({ href, anchor_text, near_text: near });
  }

  const raw = (document.body.innerText || document.body.textContent || "").trim();
  const page_text =
    raw.length <= PAGE_TEXT_CAP
      ? raw
      : raw.slice(0, PAGE_TEXT_CAP * 0.75) +
        "\n\n[...truncated...]\n\n" +
        raw.slice(raw.length - PAGE_TEXT_CAP * 0.25);

  return {
    url: location.href,
    title: document.title,
    page_text,
    page_links: links,
  };
}
