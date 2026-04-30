/**
 * Provider-selection settings, persisted in chrome.storage.sync so the user's
 * choices follow them across Chrome installs. The options page edits these;
 * the service worker reads them on every Analyze and forwards the relevant
 * subset to the backend as `search_options`.
 *
 * The default "use_default" mode means: rely on whichever providers the
 * backend has env keys for. The user only needs to interact with this page
 * if they want to (a) restrict the set of providers, or (b) BYOK their own
 * keys to bypass the operator's free-tier defaults.
 */

import type { ProviderName, ProviderCredentials, SearchOptions } from "./types.js";

export const ALL_PROVIDERS: readonly ProviderName[] = [
  "tavily",
  "brave",
  "serper",
  "google_pse",
  "bing",
] as const;

export type ProviderSetting = {
  enabled: boolean;
  /**
   * `default`: send no key, let the backend use its env-configured key.
   * `byok`:    send the user's `byokKey` (and `byokCx` for google_pse).
   */
  source: "default" | "byok";
  byokKey: string;
  byokCx: string; // only used by google_pse
};

export type Settings = {
  /**
   * `auto`:   send no `search_options.providers`, let the backend use everything it has keys for.
   * `manual`: send only the providers the user has toggled on.
   */
  mode: "auto" | "manual";
  providers: Record<ProviderName, ProviderSetting>;
};

export const DEFAULT_SETTINGS: Settings = {
  mode: "auto",
  providers: {
    tavily: { enabled: true, source: "default", byokKey: "", byokCx: "" },
    brave: { enabled: true, source: "default", byokKey: "", byokCx: "" },
    serper: { enabled: false, source: "default", byokKey: "", byokCx: "" },
    google_pse: { enabled: false, source: "default", byokKey: "", byokCx: "" },
    bing: { enabled: false, source: "default", byokKey: "", byokCx: "" },
  },
};

const STORAGE_KEY = "claim-provenance:settings:v1";

export async function loadSettings(): Promise<Settings> {
  const obj = await chrome.storage.sync.get(STORAGE_KEY);
  const raw = obj[STORAGE_KEY] as Partial<Settings> | undefined;
  return mergeWithDefaults(raw);
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: s });
}

function mergeWithDefaults(raw: Partial<Settings> | undefined): Settings {
  const base: Settings = {
    mode: raw?.mode === "manual" ? "manual" : "auto",
    providers: { ...DEFAULT_SETTINGS.providers },
  };
  if (raw?.providers) {
    for (const name of ALL_PROVIDERS) {
      const r = raw.providers[name];
      if (!r) continue;
      base.providers[name] = {
        enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULT_SETTINGS.providers[name].enabled,
        source: r.source === "byok" ? "byok" : "default",
        byokKey: typeof r.byokKey === "string" ? r.byokKey : "",
        byokCx: typeof r.byokCx === "string" ? r.byokCx : "",
      };
    }
  }
  return base;
}

/**
 * Translate the user's settings into a `search_options` object suitable for
 * the backend. Returns `undefined` when no override is needed (auto mode and
 * no BYOK keys), so the request stays clean.
 */
export function settingsToSearchOptions(s: Settings): SearchOptions | undefined {
  let providers: ProviderName[] | undefined;
  if (s.mode === "manual") {
    providers = ALL_PROVIDERS.filter((name) => s.providers[name].enabled);
    if (providers.length === 0) providers = undefined; // empty list = let backend decide
  }

  const byok: ProviderCredentials = {};
  for (const name of ALL_PROVIDERS) {
    const cfg = s.providers[name];
    if (!cfg.enabled) continue;
    if (cfg.source !== "byok") continue;
    if (name === "google_pse") {
      if (cfg.byokKey && cfg.byokCx) byok.google_pse = { key: cfg.byokKey, cx: cfg.byokCx };
    } else if (cfg.byokKey) {
      (byok as Record<string, string>)[name] = cfg.byokKey;
    }
  }

  const hasByok = Object.keys(byok).length > 0;
  if (!providers && !hasByok) return undefined;
  const out: SearchOptions = {};
  if (providers) out.providers = providers;
  if (hasByok) out.byok = byok;
  return out;
}
