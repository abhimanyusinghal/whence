import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../.env") });

import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { analyze } from "./orchestrator.js";
import { analyzeCache, analyzeCacheKey } from "./cache.js";
import { logEntry, makeRequestId } from "./logger.js";
import { TRY_PAGE_HTML } from "./try_page.js";
import type { EnvKeys } from "./search/index.js";
import type { AnalyzeRequest, ProviderName, SearchOptions } from "./types.js";

const VALID_PROVIDERS: readonly ProviderName[] = [
  "tavily",
  "brave",
  "serper",
  "google_pse",
  "bing",
] as const;

function loadEnvKeys(): EnvKeys {
  const env: EnvKeys = {};
  if (process.env.TAVILY_API_KEY) env.tavily = process.env.TAVILY_API_KEY;
  if (process.env.BRAVE_API_KEY) env.brave = process.env.BRAVE_API_KEY;
  if (process.env.SERPER_API_KEY) env.serper = process.env.SERPER_API_KEY;
  if (process.env.BING_API_KEY) env.bing = process.env.BING_API_KEY;
  if (process.env.GOOGLE_PSE_KEY && process.env.GOOGLE_PSE_CX) {
    env.google_pse = { key: process.env.GOOGLE_PSE_KEY, cx: process.env.GOOGLE_PSE_CX };
  }
  return env;
}

function configuredProviders(env: EnvKeys): ProviderName[] {
  const out: ProviderName[] = [];
  if (env.tavily) out.push("tavily");
  if (env.brave) out.push("brave");
  if (env.serper) out.push("serper");
  if (env.google_pse) out.push("google_pse");
  if (env.bing) out.push("bing");
  return out;
}

const PORT = Number(process.env.PORT ?? 8787);

const app = express();

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origin.startsWith("chrome-extension://")) return cb(null, true);
      if (origin.startsWith("http://localhost")) return cb(null, true);
      if (origin.startsWith("http://127.0.0.1")) return cb(null, true);
      return cb(null, false);
    },
    exposedHeaders: ["X-Request-Id", "X-Cache"],
  }),
);
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req: Request, res: Response) => {
  res.redirect(302, "/try");
});

app.get("/docs", async (_req: Request, res: Response) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Provenance API — Reference</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
</head>
<body>
<redoc spec-url="/v1/openapi.yaml" hide-loading></redoc>
<script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>`;
  res.type("html").send(html);
});

app.get("/try", async (_req: Request, res: Response) => {
  res.type("html").send(TRY_PAGE_HTML);
});

app.get("/healthz", (_req: Request, res: Response) => {
  const env = loadEnvKeys();
  res.json({
    ok: true,
    service: "claim-provenance-backend",
    version: "0.1.0",
    provider: process.env.LLM_PROVIDER ?? "anthropic",
    has_anthropic_key: Boolean(process.env.ANTHROPIC_API_KEY),
    has_azure_key: Boolean(process.env.AZURE_OPENAI_API_KEY),
    search_providers_configured: configuredProviders(env),
    cache_size: analyzeCache.size,
  });
});

function validateSearchOptions(raw: unknown): SearchOptions | string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") return "search_options must be an object";
  const o = raw as Record<string, unknown>;

  let providers: ProviderName[] | undefined;
  if (o.providers !== undefined) {
    if (!Array.isArray(o.providers)) return "search_options.providers must be an array of strings";
    providers = [];
    for (const p of o.providers) {
      if (typeof p !== "string") return "search_options.providers entries must be strings";
      if (!(VALID_PROVIDERS as readonly string[]).includes(p)) {
        return `search_options.providers contains unknown provider "${p}"`;
      }
      providers.push(p as ProviderName);
    }
  }

  let byok: SearchOptions["byok"];
  if (o.byok !== undefined && o.byok !== null) {
    if (typeof o.byok !== "object") return "search_options.byok must be an object";
    const b = o.byok as Record<string, unknown>;
    byok = {};
    if (typeof b.tavily === "string" && b.tavily) byok.tavily = b.tavily;
    if (typeof b.brave === "string" && b.brave) byok.brave = b.brave;
    if (typeof b.serper === "string" && b.serper) byok.serper = b.serper;
    if (typeof b.bing === "string" && b.bing) byok.bing = b.bing;
    if (b.google_pse && typeof b.google_pse === "object") {
      const g = b.google_pse as Record<string, unknown>;
      if (typeof g.key === "string" && typeof g.cx === "string" && g.key && g.cx) {
        byok.google_pse = { key: g.key, cx: g.cx };
      }
    }
  }

  return { providers, byok };
}

function validateRequest(body: unknown): AnalyzeRequest | string {
  if (!body || typeof body !== "object") return "body must be an object";
  const r = body as Record<string, unknown>;
  if (typeof r.url !== "string" || !r.url) return "url is required";
  if (typeof r.title !== "string") return "title is required";
  if (typeof r.page_text !== "string" || !r.page_text)
    return "page_text is required and must be non-empty";
  if (!Array.isArray(r.page_links)) return "page_links must be an array";

  let provenance: AnalyzeRequest["provenance"];
  if (r.provenance !== undefined && r.provenance !== null) {
    if (typeof r.provenance !== "object") return "provenance must be an object";
    const p = r.provenance as Record<string, unknown>;
    const pickStr = (k: string): string | undefined =>
      typeof p[k] === "string" && (p[k] as string).length > 0 ? (p[k] as string) : undefined;
    provenance = {
      canonical_url: pickStr("canonical_url"),
      author: pickStr("author"),
      published_date: pickStr("published_date"),
      accessed_at: pickStr("accessed_at"),
      html_hash: pickStr("html_hash"),
    };
  }

  const searchOpts = validateSearchOptions(r.search_options);
  if (typeof searchOpts === "string") return searchOpts;

  return {
    url: r.url,
    title: r.title,
    page_text: r.page_text,
    page_links: r.page_links as AnalyzeRequest["page_links"],
    provenance,
    search_options: searchOpts,
  };
}

function statusCounts(chains: { status: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of chains) counts[c.status] = (counts[c.status] ?? 0) + 1;
  return counts;
}

// Serve the OpenAPI spec. Mounted at / and /v1 — both URLs resolve to the
// same file on disk so customers can pick whichever feels canonical.
app.get(["/openapi.yaml", "/v1/openapi.yaml"], async (_req: Request, res: Response) => {
  try {
    const specPath = path.resolve(__dirname, "../openapi.yaml");
    const { readFile } = await import("node:fs/promises");
    const yaml = await readFile(specPath, "utf8");
    res.type("application/yaml").send(yaml);
  } catch (err) {
    res.status(500).json({
      error: "internal_error",
      message: `Could not load openapi.yaml: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

const analyzeHandler = async (req: Request, res: Response, next: NextFunction) => {
    const requestId = makeRequestId();
    res.setHeader("X-Request-Id", requestId);

    try {
      const t0 = Date.now();
      const validated = validateRequest(req.body);
      if (typeof validated === "string") {
        res.status(400).json({ error: "invalid_request", message: validated, request_id: requestId });
        return;
      }

      const env = loadEnvKeys();
      const requestedProviders = validated.search_options?.providers;
      const requestedByok = validated.search_options?.byok ?? {};

      // We need at least one usable provider — either env-configured or BYOK
      // for whichever providers the request asked for. If the request named
      // specific providers, all of them must be resolvable.
      const requestedSet = requestedProviders ?? configuredProviders(env);
      const usable = requestedSet.filter((p) => {
        if (p === "google_pse") {
          const b = requestedByok.google_pse;
          if (b?.key && b.cx) return true;
          return Boolean(env.google_pse?.key && env.google_pse.cx);
        }
        const b = (requestedByok as Record<string, unknown>)[p];
        if (typeof b === "string" && b) return true;
        return Boolean((env as Record<string, unknown>)[p]);
      });
      if (usable.length === 0) {
        res.status(500).json({
          error: "missing_config",
          message:
            "No search providers usable. Configure at least one of TAVILY_API_KEY, BRAVE_API_KEY, SERPER_API_KEY, BING_API_KEY, or GOOGLE_PSE_KEY+GOOGLE_PSE_CX on the server, or supply BYOK keys via search_options.byok in the request.",
          request_id: requestId,
        });
        return;
      }

      const cacheKey = analyzeCacheKey(validated);
      const cached = analyzeCache.get(cacheKey);
      if (cached) {
        const totalMs = Date.now() - t0;
        res.setHeader("X-Cache", "hit");
        logEntry({
          type: "request",
          ts: new Date().toISOString(),
          request_id: requestId,
          url: validated.url,
          title: validated.title,
          page_text_len: validated.page_text.length,
          page_links_count: validated.page_links.length,
          cache_hit: true,
          claim_count: cached.claims.length,
          total_ms: totalMs,
          total_tokens: 0,
          search_queries: 0,
          status_counts: statusCounts(cached.chains),
          error: null,
        });
        res.json(cached);
        return;
      }

      const result = await analyze(validated, { env, requestId });
      analyzeCache.set(cacheKey, result);
      res.setHeader("X-Cache", "miss");

      logEntry({
        type: "request",
        ts: new Date().toISOString(),
        request_id: requestId,
        url: validated.url,
        title: validated.title,
        page_text_len: validated.page_text.length,
        page_links_count: validated.page_links.length,
        cache_hit: false,
        claim_count: result.claims.length,
        total_ms: result.meta.ms,
        total_tokens: result.meta.tokens_used,
        search_queries: result.meta.search_queries,
        status_counts: statusCounts(result.chains),
        error: null,
      });

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // Azure OpenAI's content filter rejects political / violence / news
      // content routinely. The OpenAI SDK surfaces it as `code: "content_filter"`
      // on the error object; Anthropic uses different signals. Detect both
      // and return a clean 422 with an actionable message instead of bubbling
      // up as a generic 500 with a stacktrace.
      const errAny = err as { code?: string; status?: number; message?: string };
      const isContentFilter =
        errAny?.code === "content_filter" ||
        (typeof errAny?.message === "string" &&
          /content management policy|content_filter|content[_ ]filter/i.test(errAny.message));

      if (isContentFilter) {
        const provider = process.env.LLM_PROVIDER ?? "anthropic";
        // Log the underlying provider error for our own debugging — keep the
        // public message generic and actionable.
        console.warn(
          `[content_filter] provider=${provider} request_id=${requestId} reason=${msg.slice(0, 300)}`,
        );
        res.status(422).json({
          error: "content_blocked",
          message:
            "The AI provider's safety filter blocked this article. This often happens with medical, political, or news content. Try a different article.",
          request_id: requestId,
        });
        return;
      }

      logEntry({
        type: "request",
        ts: new Date().toISOString(),
        request_id: requestId,
        url: (req.body as { url?: string })?.url ?? "",
        title: (req.body as { title?: string })?.title ?? "",
        page_text_len: (req.body as { page_text?: string })?.page_text?.length ?? 0,
        page_links_count: Array.isArray((req.body as { page_links?: unknown[] })?.page_links)
          ? (req.body as { page_links: unknown[] }).page_links.length
          : 0,
        cache_hit: false,
        claim_count: 0,
        total_ms: 0,
        total_tokens: 0,
        search_queries: 0,
        status_counts: {},
        error: msg.slice(0, 500),
      });
      next(err);
    }
  };

// Mount the same handler at the legacy and versioned paths.
// `/analyze`     — back-compat for the Chrome extension and informal callers.
// `/v1/analyze`  — the contract-stable endpoint. Future breaking changes go in
//                  `/v2/`; this URL's response shape is pinned by the OpenAPI spec.
// No auth: provide your own provider keys via .env (or per-request BYOK) and call it.
app.post("/analyze", analyzeHandler);
app.post("/v1/analyze", analyzeHandler);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[server] unhandled error:", err);
  res
    .status(500)
    .json({ error: "internal_error", message: err.message ?? String(err) });
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
