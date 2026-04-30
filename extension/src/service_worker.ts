import { extractPageData } from "./page_extract.js";
import { applyHighlights } from "./highlights.js";
import type {
  AnalyzeReply,
  AnalyzeRequest,
  AnalyzeResponse,
  ExtensionMessage,
  SearchOptions,
} from "./types.js";

const BACKEND_URL = "http://localhost:8787/analyze";

// Track in-flight analyses per tab so a second click while one is running
// short-circuits instead of starting a duplicate fetch. The map carries the
// requestId of the live run so the side panel can correlate.
const inFlight = new Map<number, string>();

chrome.runtime.onInstalled.addListener(() => {
  console.log("[claim-provenance] installed");
});

// Click the toolbar action → side panel opens directly. The Analyze button
// lives inside the panel itself, so there's no popup step in between.
chrome.sidePanel
  ?.setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => void 0);

chrome.runtime.onMessage.addListener(
  (msg: ExtensionMessage, _sender, sendResponse: (reply: AnalyzeReply) => void) => {
    if (msg.type !== "ANALYZE") return false;

    const requestId = msg.requestId;
    let analyzingTabId: number | undefined;
    handleAnalyze(requestId, msg.searchOptions, (tabId) => {
      analyzingTabId = tabId;
    })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (analyzingTabId !== undefined) inFlight.delete(analyzingTabId);
        // Surface the failure into the side panel for whichever tab we were
        // working on. handleAnalyze's `tabId` callback fires before any
        // network/extraction step, so we know which panel state to update.
        chrome.runtime
          .sendMessage({
            type: "ANALYSIS_ERROR",
            error: errMsg,
            tabId: analyzingTabId,
            requestId,
          })
          .catch(() => void 0);
        sendResponse({ ok: false, error: errMsg });
      });

    return true; // keep channel open for async response
  },
);

async function handleAnalyze(
  requestId: string,
  searchOptions: SearchOptions | undefined,
  onTab: (tabId: number) => void,
): Promise<AnalyzeResponse> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");
  if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
    throw new Error("Cannot analyze chrome:// or extension pages");
  }
  onTab(tab.id);

  // Refuse to start a second analysis for the same tab while one is in
  // flight. The user-facing button is disabled when running, so this is
  // belt-and-suspenders for stray sendMessage calls.
  if (inFlight.has(tab.id)) {
    throw new Error("An analysis is already running for this tab. Wait for it to finish.");
  }
  inFlight.set(tab.id, requestId);

  const pageUrl = tab.url ?? "";

  // Notify side panel that work has started so it can render the progress UI.
  chrome.runtime
    .sendMessage({ type: "ANALYSIS_STARTED", tabId: tab.id, requestId, pageUrl })
    .catch(() => void 0);

  console.log("[claim-provenance] extracting from tab", tab.id);
  const injectionResults = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractPageData,
  });

  const result = injectionResults[0]?.result as AnalyzeRequest | undefined;
  if (!result) throw new Error("Failed to extract page data");

  // Attach the user's provider preferences (if any) so the backend uses
  // the right subset of search providers and any BYOK keys.
  if (searchOptions) result.search_options = searchOptions;

  console.log(
    `[claim-provenance] ${result.page_text.length} chars, ${result.page_links.length} links → backend`,
  );

  const res = await fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    inFlight.delete(tab.id);
    chrome.runtime
      .sendMessage({
        type: "ANALYSIS_ERROR",
        error: `Backend ${res.status}: ${text.slice(0, 200)}`,
        tabId: tab.id,
        requestId,
      })
      .catch(() => void 0);
    throw new Error(`Backend ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as AnalyzeResponse;
  console.log("[claim-provenance] backend response", data);

  // Inject highlights into the page. Pass minimal payload — only id/text/status.
  let highlight_stats: { matched: number; total: number } | undefined;
  try {
    const claimsForPage = data.claims.map((c) => {
      const chain = data.chains.find((ch) => ch.claim_id === c.id);
      return { id: c.id, text: c.text, status: chain?.status ?? "untraceable" };
    });
    const [hl] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: applyHighlights,
      args: [{ claims: claimsForPage }],
    });
    highlight_stats = hl?.result as { matched: number; total: number } | undefined;
    if (highlight_stats) {
      console.log(
        `[claim-provenance] highlighted ${highlight_stats.matched}/${highlight_stats.total} claims`,
      );
    }
  } catch (err) {
    console.warn("[claim-provenance] highlight injection failed:", err);
  }

  inFlight.delete(tab.id);

  // Forward to side panel
  chrome.runtime
    .sendMessage({
      type: "ANALYSIS_RESULT",
      tabId: tab.id,
      requestId,
      pageUrl,
      data,
      highlight_stats,
    })
    .catch(() => void 0);

  return data;
}
