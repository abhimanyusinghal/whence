import { extractPageData } from "./page_extract.js";
import { applyHighlights } from "./highlights.js";
import type {
  AnalyzeReply,
  AnalyzeRequest,
  AnalyzeResponse,
  ExtensionMessage,
} from "./types.js";

const BACKEND_URL = "http://localhost:8787/analyze";

chrome.runtime.onInstalled.addListener(() => {
  console.log("[claim-provenance] installed");
});

chrome.sidePanel
  ?.setPanelBehavior({ openPanelOnActionClick: false })
  .catch(() => void 0);

chrome.runtime.onMessage.addListener(
  (msg: ExtensionMessage, _sender, sendResponse: (reply: AnalyzeReply) => void) => {
    if (msg.type !== "ANALYZE") return false;

    handleAnalyze()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      );

    return true; // keep channel open for async response
  },
);

async function handleAnalyze(): Promise<AnalyzeResponse> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");
  if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
    throw new Error("Cannot analyze chrome:// or extension pages");
  }

  // Notify side panel that work has started so it can render skeleton state.
  chrome.runtime
    .sendMessage({ type: "ANALYSIS_STARTED", tabId: tab.id })
    .catch(() => void 0);

  console.log("[claim-provenance] extracting from tab", tab.id);
  const injectionResults = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractPageData,
  });

  const result = injectionResults[0]?.result as AnalyzeRequest | undefined;
  if (!result) throw new Error("Failed to extract page data");

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
    chrome.runtime
      .sendMessage({ type: "ANALYSIS_ERROR", error: `Backend ${res.status}` })
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

  // Forward to side panel
  chrome.runtime
    .sendMessage({ type: "ANALYSIS_RESULT", tabId: tab.id, data, highlight_stats })
    .catch(() => void 0);

  return data;
}
