import { loadSettings, settingsToSearchOptions } from "./settings.js";
import type {
  AnalyzeReply,
  AnalyzeResponse,
  Claim,
  ExtensionMessage,
  ProvenanceChain,
  ProvenanceNode,
  ProvenanceStatus,
} from "./types.js";

const sub = document.getElementById("sub") as HTMLParagraphElement;
const content = document.getElementById("content") as HTMLDivElement;
const analyzeBtn = document.getElementById("analyze-btn") as HTMLButtonElement;
const settingsBtn = document.getElementById("settings-btn") as HTMLButtonElement;

settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

// Per-tab state. The side panel is one document shared across all tabs in
// the window, so we cache analysis state by tabId and swap what's shown
// whenever the active tab changes. Switching to a tab that was never
// analyzed shows the empty state; switching back returns the prior result.
//
// Every state carries a `requestId`. When ANALYSIS_RESULT or ANALYSIS_ERROR
// arrives we only apply it if the tab's CURRENT requestId matches — this is
// what stops a late-arriving stale result from overwriting a newer one. The
// `analyzedUrl` records the URL the chains are about, so URL fluctuations
// (modal pushState, hash changes) can be detected and surfaced as a stale
// banner without wiping the analysis the user just waited 30s for.
type RunningState = {
  status: "running";
  requestId: string;
  startedAt: number;
  analyzedUrl: string;
  title: string;
};
type DoneState = {
  status: "done";
  requestId: string;
  data: AnalyzeResponse;
  highlightStats?: { matched: number; total: number };
  analyzedUrl: string;
  title: string;
};
type ErrorState = {
  status: "error";
  requestId: string;
  error: string;
  analyzedUrl: string;
  title: string;
};
type TabState = RunningState | DoneState | ErrorState;

const tabState = new Map<number, TabState>();
let currentTabId: number | null = null;
let progressTimer: number | null = null;

function makeRequestId(): string {
  return (
    "req_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 10)
  );
}

/**
 * URL changes from `pushState`, hash navigation, modal-driven query params,
 * and SPA routing should NOT be treated as page navigation. Only flag the
 * analysis as stale if the actual page identity changed — that means a
 * different origin, a different pathname, or a different non-fragment
 * query that's likely to indicate a different article (e.g. `?id=`,
 * `?p=`, `?article=`, `?page=`). Everything else is in-page noise.
 */
function pageIdentityChanged(prev: string, next: string): boolean {
  if (!prev || !next) return false;
  let a: URL, b: URL;
  try {
    a = new URL(prev);
    b = new URL(next);
  } catch {
    return prev !== next;
  }
  if (a.origin !== b.origin) return true;
  if (a.pathname !== b.pathname) return true;
  // Compare a small allow-list of identity-bearing query params. We
  // deliberately ignore `?utm_*`, `?ref=`, modal flags, etc.
  const idKeys = ["id", "p", "article", "page", "story", "post"];
  for (const k of idKeys) {
    if (a.searchParams.get(k) !== b.searchParams.get(k)) return true;
  }
  return false;
}

function statusLabel(s: ProvenanceStatus): string {
  return s.replace(/_/g, " ");
}

function clearContent() {
  if (progressTimer !== null) {
    window.clearInterval(progressTimer);
    progressTimer = null;
  }
  content.className = "";
  content.innerHTML = "";
}

function setEmpty(text: string) {
  clearContent();
  content.className = "empty";
  content.textContent = text;
}

function setError(text: string) {
  clearContent();
  const div = document.createElement("div");
  div.className = "error";
  div.textContent = text;
  content.appendChild(div);
}

function publisherFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ----- Progress bar (no backend streaming, so we estimate from elapsed time) -----

type ProgressPhase = {
  label: string;
  detail: string;
  /** Fraction of expected duration this phase covers, [0,1]. Sums to 1. */
  share: number;
};

const PROGRESS_PHASES: ProgressPhase[] = [
  {
    label: "Extracting checkable claims…",
    detail: "Reading the article and identifying factual statements that can be verified.",
    share: 0.18,
  },
  {
    label: "Searching the web for each claim…",
    detail: "Tavily is finding candidate sources for every extracted claim (parallel, 4 at a time).",
    share: 0.32,
  },
  {
    label: "Building provenance chains…",
    detail: "Classifying each claim's chain of custody back to its primary source.",
    share: 0.42,
  },
  {
    label: "Almost done — finalizing chains…",
    detail: "Long article or fabricated-source retries can push past the typical 25–40s window.",
    share: 0.08,
  },
];

const TYPICAL_ANALYSIS_MS = 32_000;

function pickPhase(elapsedMs: number): { phase: ProgressPhase; pct: number } {
  let total = 0;
  let pct = elapsedMs / TYPICAL_ANALYSIS_MS;
  if (pct > 0.97) pct = 0.97; // never let estimate read 100% — that's a lie
  for (const phase of PROGRESS_PHASES) {
    total += phase.share;
    if (pct <= total) return { phase, pct };
  }
  return { phase: PROGRESS_PHASES[PROGRESS_PHASES.length - 1], pct };
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function renderProgress(state: RunningState) {
  clearContent();

  const wrap = document.createElement("div");
  wrap.className = "progress";

  const phaseLine = document.createElement("div");
  phaseLine.className = "progress-phase";
  const phaseLabel = document.createElement("span");
  const elapsedSpan = document.createElement("span");
  elapsedSpan.className = "progress-elapsed";
  phaseLine.appendChild(phaseLabel);
  phaseLine.appendChild(elapsedSpan);
  wrap.appendChild(phaseLine);

  const detail = document.createElement("div");
  detail.className = "progress-detail";
  wrap.appendChild(detail);

  const bar = document.createElement("div");
  bar.className = "progress-bar";
  const fill = document.createElement("div");
  fill.className = "progress-bar-fill";
  bar.appendChild(fill);
  wrap.appendChild(bar);

  content.appendChild(wrap);

  // Skeleton cards so the panel doesn't feel empty while we wait.
  for (let i = 0; i < 4; i++) {
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

  function tick() {
    const elapsed = Date.now() - state.startedAt;
    const { phase, pct } = pickPhase(elapsed);
    phaseLabel.textContent = phase.label;
    elapsedSpan.textContent = fmtElapsed(elapsed);
    detail.textContent = phase.detail;
    fill.style.width = `${(pct * 100).toFixed(1)}%`;
  }

  tick();
  progressTimer = window.setInterval(tick, 250);
}

// ----- Chain card rendering -----

function qualityBucket(score: number): "hi" | "mid" | "lo" {
  if (score >= 0.75) return "hi";
  if (score >= 0.5) return "mid";
  return "lo";
}

function makeNodeRow(node: ProvenanceNode): HTMLElement {
  const wrap = document.createElement("div");

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
  link.addEventListener("click", (e) => e.stopPropagation());
  row.appendChild(link);

  const typeChip = document.createElement("span");
  typeChip.className = `node-type t-${node.type}`;
  typeChip.textContent = node.type;
  row.appendChild(typeChip);

  if (typeof node.source_quality_score === "number") {
    const q = document.createElement("span");
    q.className = `node-quality q-${qualityBucket(node.source_quality_score)}`;
    q.textContent = `q ${node.source_quality_score.toFixed(2)}`;
    q.title = "Source quality score (0–1). See classify_chain rubric.";
    row.appendChild(q);
  }

  if (node.publisher) {
    const pub = document.createElement("span");
    pub.className = "node-publisher";
    pub.textContent = node.publisher;
    row.appendChild(pub);
  }

  wrap.appendChild(row);

  if (node.evidence_quote && node.evidence_quote.trim()) {
    const quote = document.createElement("div");
    quote.className = "evidence-quote";
    quote.textContent = `"${node.evidence_quote.trim()}"`;
    wrap.appendChild(quote);
  }

  return wrap;
}

function makeCard(claim: Claim, chain: ProvenanceChain, ownerTabId: number): HTMLElement {
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

  const downstream = chain.nodes.slice(1);
  if (downstream.length > 0) {
    const chainDiv = document.createElement("div");
    chainDiv.className = "chain";
    for (const n of downstream) {
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
    chrome.tabs
      .sendMessage(ownerTabId, { type: "FOCUS_CLAIM", claim_id: claim.id })
      .catch(() => void 0);
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

function renderResult(state: DoneState, ownerTabId: number) {
  clearContent();

  const meta = document.createElement("div");
  meta.className = "meta";
  const parts = [
    `${state.data.claims.length} claim${state.data.claims.length === 1 ? "" : "s"}`,
    `${state.data.meta.ms}ms`,
    `${state.data.meta.tokens_used.toLocaleString()} tokens`,
    `${state.data.meta.search_queries} searches`,
  ];
  const providersUsed = state.data.meta.search_providers_used ?? [];
  if (providersUsed.length > 0) parts.push(`providers: ${providersUsed.join(", ")}`);
  if (state.highlightStats) {
    parts.push(`${state.highlightStats.matched}/${state.highlightStats.total} highlighted on page`);
  }
  meta.textContent = parts.join(" · ");
  content.appendChild(meta);

  // Provider-error footnote — partial failures shouldn't be silent.
  const providerErrors = state.data.meta.search_provider_errors;
  const providersSkipped = state.data.meta.search_providers_skipped ?? [];
  if ((providerErrors && Object.keys(providerErrors).length > 0) || providersSkipped.length > 0) {
    const note = document.createElement("div");
    note.className = "tab-warning";
    const lines: string[] = [];
    if (providersSkipped.length > 0) {
      lines.push(`Skipped (no key): ${providersSkipped.join(", ")}.`);
    }
    if (providerErrors) {
      for (const [name, err] of Object.entries(providerErrors)) {
        lines.push(`${name}: ${err.slice(0, 140)}`);
      }
    }
    note.textContent = lines.join(" · ");
    content.appendChild(note);
  }

  const chainByClaim = new Map<string, ProvenanceChain>();
  for (const ch of state.data.chains) chainByClaim.set(ch.claim_id, ch);

  for (const claim of state.data.claims) {
    const chain = chainByClaim.get(claim.id);
    if (!chain) continue;
    content.appendChild(makeCard(claim, chain, ownerTabId));
  }

  if (state.data.claims.length === 0) {
    setEmpty("No checkable claims found on this page.");
  }
}

// ----- Top-level rendering: pick what to show based on currentTabId state -----

async function tabInfo(tabId: number): Promise<{ url: string; title: string } | null> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return { url: tab.url ?? "", title: tab.title ?? "" };
  } catch {
    return null;
  }
}

async function rerender() {
  syncAnalyzeButton();
  if (currentTabId === null) {
    setEmpty("Open a regular web page to analyze claims.");
    return;
  }

  const banners: HTMLElement[] = [];

  // Cross-tab banner — analysis still running on a different tab.
  for (const [tabId, state] of tabState.entries()) {
    if (tabId === currentTabId) continue;
    if (state.status === "running") {
      const info = await tabInfo(tabId);
      const label = info?.title || info?.url || `tab ${tabId}`;
      const b = document.createElement("div");
      b.className = "tab-warning";
      const strong = document.createElement("strong");
      strong.textContent = "Analysis still running on another tab: ";
      b.appendChild(strong);
      b.appendChild(
        document.createTextNode(`${label.slice(0, 80)}. Switch to it to watch progress.`),
      );
      banners.push(b);
      break;
    }
  }

  const state = tabState.get(currentTabId);

  // Stale-page banner — the URL has changed since this tab was analyzed.
  if (state && state.status === "done") {
    const live = await tabInfo(currentTabId);
    if (live && pageIdentityChanged(state.analyzedUrl, live.url)) {
      const b = document.createElement("div");
      b.className = "tab-warning";
      const strong = document.createElement("strong");
      strong.textContent = "Page changed since this analysis. ";
      b.appendChild(strong);
      b.appendChild(
        document.createTextNode("Click Re-analyze for the current page; the chains below are for the previous URL."),
      );
      banners.push(b);
    }
  }

  sub.textContent = headerSub(state);

  if (!state) {
    clearContent();
    for (const b of banners) content.appendChild(b);
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML = `No analysis yet for this page.<br>Click <em>Analyze this page</em> above.`;
    content.appendChild(empty);
    return;
  }

  if (state.status === "running") {
    renderProgress(state);
    for (const b of banners.reverse()) content.insertBefore(b, content.firstChild);
    return;
  }

  if (state.status === "error") {
    setError(state.error);
    for (const b of banners.reverse()) content.insertBefore(b, content.firstChild);
    return;
  }

  renderResult(state, currentTabId);
  for (const b of banners.reverse()) content.insertBefore(b, content.firstChild);
}

function headerSub(state: TabState | undefined): string {
  if (!state) return "Click Analyze to trace claims on this page.";
  if (state.status === "running") return "Analyzing this page…";
  if (state.status === "error") return "Analysis failed.";
  return "Click any claim card to flash its inline highlight on the page.";
}

function syncAnalyzeButton() {
  const state = currentTabId !== null ? tabState.get(currentTabId) : undefined;
  if (state?.status === "running") {
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = "Analyzing…";
    return;
  }
  analyzeBtn.disabled = false;
  analyzeBtn.textContent = state ? "Re-analyze" : "Analyze this page";
}

// ----- Wire up runtime + tab events -----
//
// All state transitions check `requestId` against the tab's currently-tracked
// run. A late-arriving message for a superseded run is dropped on the floor.

chrome.runtime.onMessage.addListener(async (msg: ExtensionMessage) => {
  if (msg.type === "ANALYSIS_STARTED") {
    const info = await tabInfo(msg.tabId);
    tabState.set(msg.tabId, {
      status: "running",
      requestId: msg.requestId,
      startedAt: Date.now(),
      analyzedUrl: msg.pageUrl || info?.url || "",
      title: info?.title ?? "",
    });
    rerender();
  } else if (msg.type === "ANALYSIS_RESULT") {
    const prior = tabState.get(msg.tabId);
    // Only apply if this result is for the run we're currently tracking.
    // Stale results from a superseded analysis are dropped silently.
    if (prior && prior.requestId !== msg.requestId) {
      console.debug(
        "[claim-provenance] dropping stale ANALYSIS_RESULT",
        msg.requestId,
        "current",
        prior.requestId,
      );
      return;
    }
    tabState.set(msg.tabId, {
      status: "done",
      requestId: msg.requestId,
      data: msg.data,
      highlightStats: msg.highlight_stats,
      analyzedUrl: msg.pageUrl || (prior?.analyzedUrl ?? ""),
      title: prior?.title ?? "",
    });
    rerender();
  } else if (msg.type === "ANALYSIS_ERROR") {
    const tabId = msg.tabId ?? currentTabId;
    if (tabId === null || tabId === undefined) return;
    const prior = tabState.get(tabId);
    if (msg.requestId && prior && prior.requestId !== msg.requestId) {
      console.debug("[claim-provenance] dropping stale ANALYSIS_ERROR", msg.requestId);
      return;
    }
    tabState.set(tabId, {
      status: "error",
      requestId: msg.requestId ?? prior?.requestId ?? "",
      error: msg.error,
      analyzedUrl: prior?.analyzedUrl ?? "",
      title: prior?.title ?? "",
    });
    rerender();
  } else if (msg.type === "FOCUS_HIGHLIGHT") {
    focusCardLocally(msg.claim_id);
  }
});

chrome.tabs.onActivated.addListener((info) => {
  currentTabId = info.tabId;
  rerender();
});

// IMPORTANT: do NOT delete tabState on URL changes. `chrome.tabs.onUpdated`
// fires changeInfo.url for hash navigation, pushState, modal-driven query
// params, and SPA routing — none of which mean "the analysis is invalid."
// Wiping state here would erase a 30s analysis the user just completed.
// Real-page changes are surfaced as a stale banner via pageIdentityChanged
// inside rerender(); the user can choose to re-analyze.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== currentTabId) return;
  if (changeInfo.url || changeInfo.status === "complete") rerender();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
});

analyzeBtn.addEventListener("click", async () => {
  // Don't start a second analysis for the same tab — be defensive even
  // though the button is supposed to be disabled in that state.
  if (currentTabId !== null) {
    const prior = tabState.get(currentTabId);
    if (prior?.status === "running") return;
  }

  const requestId = makeRequestId();
  const settings = await loadSettings();
  const searchOptions = settingsToSearchOptions(settings);

  // Optimistic UI: flip to "Analyzing…" before the service worker even gets
  // the message. The real running state arrives via ANALYSIS_STARTED, but
  // we also seed a placeholder so the button stays disabled and stale
  // STARTED echoes can't downgrade us.
  if (currentTabId !== null) {
    tabState.set(currentTabId, {
      status: "running",
      requestId,
      startedAt: Date.now(),
      analyzedUrl: "",
      title: "",
    });
    rerender();
  }

  chrome.runtime
    .sendMessage({ type: "ANALYZE", requestId, searchOptions })
    .then((reply: AnalyzeReply | undefined) => {
      if (reply && !reply.ok && currentTabId !== null) {
        const prior = tabState.get(currentTabId);
        if (prior?.requestId === requestId) {
          tabState.set(currentTabId, {
            status: "error",
            requestId,
            error: reply.error,
            analyzedUrl: "",
            title: prior.title,
          });
          rerender();
        }
      }
    })
    .catch((err) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (currentTabId !== null) {
        const prior = tabState.get(currentTabId);
        if (prior?.requestId === requestId) {
          tabState.set(currentTabId, {
            status: "error",
            requestId,
            error: errMsg,
            analyzedUrl: "",
            title: prior.title,
          });
          rerender();
        }
      }
    });
});

// Initial render: query whatever tab is active right now.
chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
  currentTabId = tabs[0]?.id ?? null;
  rerender();
});
