// This function is serialized via chrome.scripting.executeScript and runs
// in the active tab's ISOLATED world. Helpers are nested inside applyHighlights
// because executeScript only serializes the function body — module-scope
// references would be undefined in the page context.
//
// Type imports are erased by esbuild at compile time, so importing types
// is safe; only value imports would break.

export type HighlightPayload = {
  claims: Array<{ id: string; text: string; status: string }>;
};

export function applyHighlights(payload: HighlightPayload): {
  matched: number;
  total: number;
} {
  const STATUS_COLORS: Record<string, string> = {
    primary: "#2e8540",
    direct_cited: "#2e8540",
    indirect_cited: "#2563eb",
    stale_cited: "#d97706",
    circular: "#7c3aed",
    untraceable: "#dc2626",
  };

  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEXTAREA",
    "INPUT",
    "CODE",
    "PRE",
    "SELECT",
    "BUTTON",
  ]);

  const PUNCT_TRIM = /^[\s"'""''(\[\{,.;:]+|[\s"'""''),.;:!?\]\}]+$/g;

  // 1. Clear any prior highlights from this extension
  const existing = document.querySelectorAll(".cp-highlight");
  for (const el of Array.from(existing)) {
    const parent = el.parentNode;
    if (!parent) continue;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  }

  // 2. Inject styles once
  let style = document.getElementById("cp-highlights-css") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "cp-highlights-css";
    style.textContent = `
      .cp-highlight {
        cursor: pointer;
        padding: 0 1px;
        border-radius: 2px;
        transition: background-color 0.2s ease;
        background: transparent;
      }
      .cp-highlight:hover { background: rgba(0,0,0,0.06); }
      .cp-highlight.cp-flash { background: rgba(255, 221, 87, 0.5); }
      .cp-status-primary, .cp-status-direct_cited { border-bottom: 2px solid ${STATUS_COLORS.direct_cited}; }
      .cp-status-indirect_cited { border-bottom: 2px solid ${STATUS_COLORS.indirect_cited}; }
      .cp-status-stale_cited { border-bottom: 2px solid ${STATUS_COLORS.stale_cited}; }
      .cp-status-circular { border-bottom: 2px solid ${STATUS_COLORS.circular}; }
      .cp-status-untraceable { border-bottom: 2px solid ${STATUS_COLORS.untraceable}; }
    `;
    document.head.appendChild(style);
  }

  // 3. Build a normalized, lowercased flat string of the document body's
  //    visible text, plus a map from each character in the flat string to
  //    (text-node index, offset within node).
  const nodes: Text[] = [];
  let flat = "";
  // For each char in `flat`, charMap[i] = [nodeIndex, offsetInNode].
  const charMap: number[] = []; // packed: even = node idx, odd = offset

  function shouldSkip(parent: Element | null): boolean {
    let p = parent;
    while (p) {
      if (SKIP_TAGS.has(p.tagName)) return true;
      if (p.classList && p.classList.contains("cp-highlight")) return true;
      p = p.parentElement;
    }
    return false;
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (shouldSkip(node.parentElement)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let lastWasSpace = true;
  let cur: Node | null;
  while ((cur = walker.nextNode())) {
    const t = cur as Text;
    const data = t.data;
    if (!data) continue;
    nodes.push(t);
    const ni = nodes.length - 1;
    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      const isSpace = /\s/.test(ch);
      if (isSpace) {
        if (!lastWasSpace) {
          flat += " ";
          charMap.push(ni, i);
          lastWasSpace = true;
        }
      } else {
        flat += ch.toLowerCase();
        charMap.push(ni, i);
        lastWasSpace = false;
      }
    }
  }

  function normalizeNeedle(s: string): string {
    return s
      .replace(PUNCT_TRIM, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function findFlatIndex(needle: string): { start: number; end: number } | null {
    const trimmed = normalizeNeedle(needle);
    if (trimmed.length < 20) return null;

    let idx = flat.indexOf(trimmed);
    let used = trimmed.length;
    if (idx === -1) {
      // Fallback: try first 60 normalized chars (handle minor model paraphrasing)
      const probe = trimmed.slice(0, 60);
      if (probe.length < 20) return null;
      idx = flat.indexOf(probe);
      if (idx === -1) return null;
      used = probe.length;
    }
    return { start: idx, end: idx + used };
  }

  function flatToNodeOffset(flatIdx: number): { node: Text; offset: number } | null {
    if (flatIdx < 0 || flatIdx >= flat.length) return null;
    const ni = charMap[flatIdx * 2];
    const off = charMap[flatIdx * 2 + 1];
    return { node: nodes[ni], offset: off };
  }

  function buildRange(flatStart: number, flatEnd: number): Range | null {
    const startPos = flatToNodeOffset(flatStart);
    const endPos = flatToNodeOffset(flatEnd - 1);
    if (!startPos || !endPos) return null;
    const range = document.createRange();
    try {
      range.setStart(startPos.node, startPos.offset);
      range.setEnd(endPos.node, endPos.offset + 1);
    } catch {
      return null;
    }
    return range;
  }

  function wrapTextNodesInRange(range: Range, claimId: string, status: string): boolean {
    // Walk text nodes in the range, split each so the in-range portion is its
    // own text node, then wrap that node.
    const ancestor = range.commonAncestorContainer;
    const root = (ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentNode : ancestor) as Node;
    if (!root) return false;

    const intersecting: Text[] = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let nn: Node | null;
    while ((nn = w.nextNode())) {
      const t = nn as Text;
      if (range.intersectsNode(t)) intersecting.push(t);
    }
    if (intersecting.length === 0) return false;

    let wrapped = 0;
    for (const node of intersecting) {
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.data.length;
      if (start >= end) continue;

      let portion: Text = node;
      try {
        if (start > 0) portion = node.splitText(start);
        if (end - start < portion.data.length) portion.splitText(end - start);
      } catch {
        continue;
      }

      const parent = portion.parentNode;
      if (!parent) continue;
      const span = document.createElement("span");
      span.className = `cp-highlight cp-status-${status}`;
      span.dataset.claimId = claimId;
      span.title = "Click to view provenance chain";
      parent.insertBefore(span, portion);
      span.appendChild(portion);
      wrapped++;
    }
    return wrapped > 0;
  }

  // 4. Match each claim and wrap
  let matched = 0;
  for (const claim of payload.claims) {
    const found = findFlatIndex(claim.text);
    if (!found) continue;
    const range = buildRange(found.start, found.end);
    if (!range) continue;
    if (wrapTextNodesInRange(range, claim.id, claim.status)) matched++;
  }

  // 5. Click delegation — page → extension. Idempotent.
  const w = window as unknown as { __cpClickWired?: boolean };
  if (!w.__cpClickWired) {
    w.__cpClickWired = true;
    document.body.addEventListener(
      "click",
      (e) => {
        const target = (e.target as HTMLElement | null)?.closest(".cp-highlight") as
          | HTMLElement
          | null;
        if (!target) return;
        const id = target.dataset.claimId;
        if (!id) return;
        e.preventDefault();
        chrome.runtime.sendMessage({ type: "FOCUS_HIGHLIGHT", claim_id: id }).catch(() => {
          /* side panel may not be open */
        });
      },
      true,
    );
  }

  // 6. Listen for FOCUS_CLAIM from side panel — flash and scroll. Idempotent.
  const w2 = window as unknown as { __cpListenerWired?: boolean };
  if (!w2.__cpListenerWired) {
    w2.__cpListenerWired = true;
    chrome.runtime.onMessage.addListener((msg: { type?: string; claim_id?: string }) => {
      if (msg?.type !== "FOCUS_CLAIM" || !msg.claim_id) return;
      const els = document.querySelectorAll<HTMLElement>(
        `.cp-highlight[data-claim-id="${CSS.escape(msg.claim_id)}"]`,
      );
      if (els.length === 0) return;
      els[0].scrollIntoView({ behavior: "smooth", block: "center" });
      for (const el of Array.from(els)) {
        el.classList.add("cp-flash");
        setTimeout(() => el.classList.remove("cp-flash"), 1800);
      }
    });
  }

  return { matched, total: payload.claims.length };
}
