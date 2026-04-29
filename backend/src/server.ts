import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../.env") });

import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { analyze } from "./orchestrator.js";
import { analyzeCache, analyzeCacheKey } from "./cache.js";
import { authMiddleware } from "./auth.js";
import { rateLimitMiddleware } from "./rate_limit.js";
import { appendUsage, bumpUsage } from "./usage.js";
import { logEntry, makeRequestId } from "./logger.js";
import type { AnalyzeRequest } from "./types.js";

const REQUIRE_AUTH = (process.env.REQUIRE_AUTH ?? "false").toLowerCase() === "true";

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

app.get("/healthz", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "claim-provenance-backend",
    version: "0.1.0",
    provider: process.env.LLM_PROVIDER ?? "anthropic",
    has_anthropic_key: Boolean(process.env.ANTHROPIC_API_KEY),
    has_azure_key: Boolean(process.env.AZURE_OPENAI_API_KEY),
    has_tavily_key: Boolean(process.env.TAVILY_API_KEY),
    require_auth: REQUIRE_AUTH,
    api_keys_loaded: (process.env.API_KEYS ?? "").split(",").filter((s) => s.includes(":")).length,
    cache_size: analyzeCache.size,
  });
});

function validateRequest(body: unknown): AnalyzeRequest | string {
  if (!body || typeof body !== "object") return "body must be an object";
  const r = body as Record<string, unknown>;
  if (typeof r.url !== "string" || !r.url) return "url is required";
  if (typeof r.title !== "string") return "title is required";
  if (typeof r.page_text !== "string" || !r.page_text)
    return "page_text is required and must be non-empty";
  if (!Array.isArray(r.page_links)) return "page_links must be an array";
  return {
    url: r.url,
    title: r.title,
    page_text: r.page_text,
    page_links: r.page_links as AnalyzeRequest["page_links"],
  };
}

function statusCounts(chains: { status: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of chains) counts[c.status] = (counts[c.status] ?? 0) + 1;
  return counts;
}

app.post(
  "/analyze",
  authMiddleware({ required: REQUIRE_AUTH }),
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    const requestId = makeRequestId();
    res.setHeader("X-Request-Id", requestId);
    const principal = req.principal ?? { name: "anonymous", is_anonymous: true };

    try {
      const t0 = Date.now();
      const validated = validateRequest(req.body);
      if (typeof validated === "string") {
        res.status(400).json({ error: "invalid_request", message: validated, request_id: requestId });
        return;
      }

      const tavilyKey = process.env.TAVILY_API_KEY;
      if (!tavilyKey) {
        res.status(500).json({
          error: "missing_config",
          message: "TAVILY_API_KEY not set on server",
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
        const usageRecord = {
          ts: new Date().toISOString(),
          request_id: requestId,
          principal: principal.name,
          is_anonymous: principal.is_anonymous,
          url: validated.url,
          cache_hit: true,
          claim_count: cached.claims.length,
          total_ms: totalMs,
          total_tokens: 0,
          search_queries: 0,
          fallback_uses: 0,
          status: "ok" as const,
          error: null,
        };
        bumpUsage(principal.name, {
          total_tokens: 0,
          total_searches: 0,
          cache_hit: true,
          fallback_uses: 0,
        });
        appendUsage(usageRecord).catch(() => void 0);
        res.json(cached);
        return;
      }

      const result = await analyze(validated, { tavilyKey, requestId });
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

      bumpUsage(principal.name, {
        total_tokens: result.meta.tokens_used,
        total_searches: result.meta.search_queries,
        cache_hit: false,
        fallback_uses: result.fallback_uses,
      });
      appendUsage({
        ts: new Date().toISOString(),
        request_id: requestId,
        principal: principal.name,
        is_anonymous: principal.is_anonymous,
        url: validated.url,
        cache_hit: false,
        claim_count: result.claims.length,
        total_ms: result.meta.ms,
        total_tokens: result.meta.tokens_used,
        search_queries: result.meta.search_queries,
        fallback_uses: result.fallback_uses,
        status: "ok",
        error: null,
      }).catch(() => void 0);

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logEntry({
        type: "request",
        ts: new Date().toISOString(),
        request_id: requestId,
        url: (req.body as { url?: string })?.url ?? "",
        title: (req.body as { title?: string })?.title ?? "",
        page_text_len: 0,
        page_links_count: 0,
        cache_hit: false,
        claim_count: 0,
        total_ms: 0,
        total_tokens: 0,
        search_queries: 0,
        status_counts: {},
        error: msg.slice(0, 500),
      });
      appendUsage({
        ts: new Date().toISOString(),
        request_id: requestId,
        principal: principal.name,
        is_anonymous: principal.is_anonymous,
        url: (req.body as { url?: string })?.url ?? "",
        cache_hit: false,
        claim_count: 0,
        total_ms: 0,
        total_tokens: 0,
        search_queries: 0,
        fallback_uses: 0,
        status: "error",
        error: msg.slice(0, 500),
      }).catch(() => void 0);
      next(err);
    }
  },
);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[server] unhandled error:", err);
  res
    .status(500)
    .json({ error: "internal_error", message: err.message ?? String(err) });
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
