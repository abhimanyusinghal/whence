import type { AnalyzeReply } from "./types.js";

const button = document.getElementById("analyze") as HTMLButtonElement;
const openPanelBtn = document.getElementById("open-panel") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLDivElement;

function setStatus(text: string, kind: "" | "ok" | "error" = "") {
  status.textContent = text;
  status.className = "status" + (kind ? " " + kind : "");
}

async function ensureSidePanelOpen() {
  try {
    const win = await chrome.windows.getCurrent();
    if (win.id !== undefined) {
      await chrome.sidePanel.open({ windowId: win.id });
    }
  } catch {
    /* user gesture may have lapsed; ignore */
  }
}

button.addEventListener("click", async () => {
  button.disabled = true;
  setStatus("Opening side panel and starting analysis…");

  // Open the side panel synchronously inside the user-gesture context first.
  await ensureSidePanelOpen();

  setStatus("Analyzing page… 20–40s for a typical article.");

  try {
    const reply = (await chrome.runtime.sendMessage({ type: "ANALYZE" })) as AnalyzeReply;
    if (!reply) {
      setStatus("No response from service worker", "error");
      return;
    }
    if (!reply.ok) {
      setStatus(`Error: ${reply.error}`, "error");
      return;
    }
    const { claims, chains, meta } = reply.data;
    const counts = chains.reduce<Record<string, number>>((acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(counts)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    setStatus(
      `Done. ${claims.length} claim${claims.length === 1 ? "" : "s"} in ${meta.ms}ms.\n${summary}\nSee side panel for chains.`,
      "ok",
    );
  } catch (err) {
    setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`, "error");
  } finally {
    button.disabled = false;
  }
});

openPanelBtn.addEventListener("click", ensureSidePanelOpen);
