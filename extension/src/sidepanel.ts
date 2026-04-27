import type {
  AnalyzeResponse,
  Claim,
  ExtensionMessage,
  ProvenanceChain,
  ProvenanceNode,
  ProvenanceStatus,
} from "./types.js";

const sub = document.getElementById("sub") as HTMLParagraphElement;
const content = document.getElementById("content") as HTMLDivElement;

let activeTabId: number | null = null;

function statusLabel(s: ProvenanceStatus): string {
  return s.replace(/_/g, " ");
}

function setEmpty(text: string) {
  content.className = "empty";
  content.textContent = text;
}

function setError(text: string) {
  content.className = "";
  content.innerHTML = "";
  const div = document.createElement("div");
  div.className = "error";
  div.textContent = text;
  content.appendChild(div);
}

function renderSkeleton(count = 6) {
  content.className = "";
  content.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const sk = document.createElement("div");
    sk.className = "skeleton";
    sk.innerHTML = `
      <div class="skel-line short"></div>
      <div class="skel-line long"></div>
      <div class="skel-line long"></div>
      <div class="skel-line med"></div>
    `;
    content.appendChild(sk);
  }
}

function publisherFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function makeNodeRow(node: ProvenanceNode): HTMLElement {
  const row = document.createElement("div");
  row.className = "node";

  const arrow = document.createElement("span");
  arrow.className = "node-arrow";
  arrow.textContent = "→";
  row.appendChild(arrow);

  const link = document.createElement("a");
  link.className = "node-link";
  link.href = node.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  const titleText = node.title?.trim() || node.url;
  link.textContent = titleText.length > 90 ? titleText.slice(0, 87) + "…" : titleText;
  link.addEventListener("click", (e) => e.stopPropagation()); // don't trigger card click
  row.appendChild(link);

  const typeChip = document.createElement("span");
  typeChip.className = `node-type t-${node.type}`;
  typeChip.textContent = node.type;
  row.appendChild(typeChip);

  if (node.publisher) {
    const pub = document.createElement("span");
    pub.className = "node-publisher";
    pub.textContent = node.publisher;
    row.appendChild(pub);
  }

  return row;
}

function makeCard(claim: Claim, chain: ProvenanceChain): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  card.id = `card-${claim.id}`;
  card.dataset.claimId = claim.id;

  const header = document.createElement("div");
  header.className = "card-header";

  const badge = document.createElement("span");
  badge.className = `badge s-${chain.status}`;
  badge.textContent = statusLabel(chain.status);
  header.appendChild(badge);

  if (chain.hop_count >= 0) {
    const hops = document.createElement("span");
    hops.className = "hops";
    hops.textContent = `${chain.hop_count} hop${chain.hop_count === 1 ? "" : "s"}`;
    header.appendChild(hops);
  }

  const cat = document.createElement("span");
  cat.className = "category";
  cat.textContent = `${claim.category} · imp ${claim.importance}`;
  header.appendChild(cat);

  card.appendChild(header);

  const text = document.createElement("div");
  text.className = "claim-text";
  text.textContent = claim.text;
  card.appendChild(text);

  // Render chain nodes — skip the article (first node) since it's the page
  // we're already on. Show nodes from index 1 onward.
  const downstream = chain.nodes.slice(1);
  if (downstream.length > 0) {
    const chainDiv = document.createElement("div");
    chainDiv.className = "chain";
    for (const n of downstream) {
      // Backfill publisher if model returned empty
      const enriched: ProvenanceNode = {
        ...n,
        publisher: n.publisher || publisherFromUrl(n.url),
      };
      chainDiv.appendChild(makeNodeRow(enriched));
    }
    card.appendChild(chainDiv);
  }

  if (chain.notes) {
    const notes = document.createElement("div");
    notes.className = "notes";
    notes.textContent = chain.notes;
    card.appendChild(notes);
  }

  card.addEventListener("click", () => {
    focusCardLocally(claim.id);
    if (activeTabId !== null) {
      chrome.tabs
        .sendMessage(activeTabId, { type: "FOCUS_CLAIM", claim_id: claim.id })
        .catch(() => void 0); // page might not have highlights wired (no match)
    }
  });

  return card;
}

function focusCardLocally(claimId: string) {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(".card.focused"))) {
    el.classList.remove("focused");
  }
  const card = document.getElementById(`card-${claimId}`);
  if (card) {
    card.classList.add("focused");
    card.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function renderResult(data: AnalyzeResponse, highlightStats?: { matched: number; total: number }) {
  content.className = "";
  content.innerHTML = "";

  const meta = document.createElement("div");
  meta.className = "meta";
  const parts = [
    `${data.claims.length} claim${data.claims.length === 1 ? "" : "s"}`,
    `${data.meta.ms}ms`,
    `${data.meta.tokens_used.toLocaleString()} tokens`,
    `${data.meta.search_queries} searches`,
  ];
  if (highlightStats) {
    parts.push(`${highlightStats.matched}/${highlightStats.total} highlighted on page`);
  }
  meta.textContent = parts.join(" · ");
  content.appendChild(meta);

  // Build a chain lookup. Chains are claim_id-keyed.
  const chainByClaim = new Map<string, ProvenanceChain>();
  for (const ch of data.chains) chainByClaim.set(ch.claim_id, ch);

  for (const claim of data.claims) {
    const chain = chainByClaim.get(claim.id);
    if (!chain) continue;
    content.appendChild(makeCard(claim, chain));
  }

  if (data.claims.length === 0) {
    setEmpty("No checkable claims found on this page.");
  }
}

chrome.runtime.onMessage.addListener((msg: ExtensionMessage) => {
  if (msg.type === "ANALYSIS_STARTED") {
    activeTabId = msg.tabId;
    sub.textContent = "Analyzing page…";
    renderSkeleton();
  } else if (msg.type === "ANALYSIS_RESULT") {
    activeTabId = msg.tabId;
    sub.textContent = "Click any claim card to flash its inline highlight.";
    renderResult(msg.data, msg.highlight_stats);
  } else if (msg.type === "ANALYSIS_ERROR") {
    sub.textContent = "Analysis failed.";
    setError(msg.error);
  } else if (msg.type === "FOCUS_HIGHLIGHT") {
    focusCardLocally(msg.claim_id);
  }
});
