import {
  ALL_PROVIDERS,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Settings,
} from "./settings.js";
import type { ProviderName } from "./types.js";

type ProviderMeta = {
  label: string;
  freeTier: string;
  signupUrl: string;
  keyHelp: string;
  needsCx?: boolean;
};

const PROVIDER_META: Record<ProviderName, ProviderMeta> = {
  tavily: {
    label: "Tavily",
    freeTier: "1,000 searches/mo on the free tier",
    signupUrl: "https://app.tavily.com",
    keyHelp: "API key from the Tavily dashboard.",
  },
  brave: {
    label: "Brave Search",
    freeTier: "2,000 queries/mo on Data for AI free tier (card on file)",
    signupUrl: "https://api.search.brave.com",
    keyHelp: "Subscription token (X-Subscription-Token).",
  },
  serper: {
    label: "Serper.dev",
    freeTier: "2,500 one-time signup credits, then paid",
    signupUrl: "https://serper.dev",
    keyHelp: "API key from your Serper dashboard.",
  },
  google_pse: {
    label: "Google Programmable Search",
    freeTier: "100 queries/day per CSE — the tightest cap of the bunch",
    signupUrl: "https://programmablesearchengine.google.com",
    keyHelp: "Google Cloud API key + your CSE id (cx). Both required.",
    needsCx: true,
  },
  bing: {
    label: "Bing Web Search (Azure)",
    freeTier: "1,000 queries/mo on Azure F1 tier",
    signupUrl: "https://portal.azure.com",
    keyHelp: "Subscription key from your Azure Cognitive Services resource.",
  },
};

let current: Settings = { ...DEFAULT_SETTINGS, providers: { ...DEFAULT_SETTINGS.providers } };

const providersDiv = document.getElementById("providers") as HTMLDivElement;
const modeAuto = document.getElementById("mode-auto") as HTMLInputElement;
const modeManual = document.getElementById("mode-manual") as HTMLInputElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const resetBtn = document.getElementById("reset") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;

function setStatus(text: string, ok = true) {
  statusEl.textContent = text;
  statusEl.className = ok ? "" : "error";
  if (text) {
    setTimeout(() => {
      if (statusEl.textContent === text) statusEl.textContent = "";
    }, 2500);
  }
}

function renderProviders() {
  providersDiv.innerHTML = "";
  for (const name of ALL_PROVIDERS) {
    const meta = PROVIDER_META[name];
    const cfg = current.providers[name];

    const card = document.createElement("div");
    card.className = "provider" + (cfg.enabled ? "" : " disabled");

    const head = document.createElement("div");
    head.className = "provider-head";
    head.innerHTML = `
      <div class="provider-name">${meta.label}</div>
      <div class="provider-meta">${meta.freeTier}</div>
      <label class="switch">
        <input type="checkbox" data-provider="${name}" data-role="enabled" ${cfg.enabled ? "checked" : ""}>
        <span class="slider"></span>
      </label>
    `;
    card.appendChild(head);

    const sourceRow = document.createElement("div");
    sourceRow.className = "source-row";
    sourceRow.innerHTML = `
      <label><input type="radio" name="source-${name}" value="default" ${cfg.source === "default" ? "checked" : ""}> Use built-in (free tier)</label>
      <label><input type="radio" name="source-${name}" value="byok" ${cfg.source === "byok" ? "checked" : ""}> Use my own key</label>
    `;
    card.appendChild(sourceRow);

    const keyRow = document.createElement("div");
    keyRow.className = "key-row";
    const keyInput = document.createElement("input");
    keyInput.type = "password";
    keyInput.placeholder = meta.needsCx ? "Google API key" : "API key";
    keyInput.value = cfg.byokKey;
    keyInput.dataset.provider = name;
    keyInput.dataset.role = "byokKey";
    keyInput.disabled = cfg.source !== "byok";
    keyRow.appendChild(keyInput);

    if (meta.needsCx) {
      const cxInput = document.createElement("input");
      cxInput.type = "text";
      cxInput.placeholder = "CSE id (cx)";
      cxInput.value = cfg.byokCx;
      cxInput.dataset.provider = name;
      cxInput.dataset.role = "byokCx";
      cxInput.disabled = cfg.source !== "byok";
      keyRow.appendChild(cxInput);
    }
    card.appendChild(keyRow);

    const helper = document.createElement("div");
    helper.className = "helper";
    helper.innerHTML = `${meta.keyHelp} <a href="${meta.signupUrl}" target="_blank" rel="noopener">Get a key →</a>`;
    card.appendChild(helper);

    providersDiv.appendChild(card);
  }
}

function applyState() {
  modeAuto.checked = current.mode === "auto";
  modeManual.checked = current.mode === "manual";
  renderProviders();
}

function bindEvents() {
  for (const r of [modeAuto, modeManual]) {
    r.addEventListener("change", () => {
      current.mode = modeAuto.checked ? "auto" : "manual";
    });
  }

  providersDiv.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    const name = t.dataset.provider as ProviderName | undefined;

    if (t.type === "radio" && t.name?.startsWith("source-")) {
      const provider = t.name.replace("source-", "") as ProviderName;
      current.providers[provider].source = t.value === "byok" ? "byok" : "default";
      renderProviders();
      return;
    }

    if (!name) return;
    const role = t.dataset.role;
    const cfg = current.providers[name];
    if (role === "enabled") {
      cfg.enabled = t.checked;
      renderProviders();
    } else if (role === "byokKey") {
      cfg.byokKey = t.value.trim();
    } else if (role === "byokCx") {
      cfg.byokCx = t.value.trim();
    }
  });

  saveBtn.addEventListener("click", async () => {
    try {
      await saveSettings(current);
      setStatus("Saved.");
    } catch (err) {
      setStatus("Save failed: " + (err instanceof Error ? err.message : String(err)), false);
    }
  });

  resetBtn.addEventListener("click", () => {
    current = { ...DEFAULT_SETTINGS, providers: { ...DEFAULT_SETTINGS.providers } };
    applyState();
    setStatus("Reset (not saved).");
  });
}

(async function init() {
  current = await loadSettings();
  applyState();
  bindEvents();
})();
