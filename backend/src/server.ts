import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../.env") });

import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { analyze } from "./orchestrator.js";
import { analyzeCache, analyzeCacheKey } from "./cache.js";
import type { AnalyzeRequest, AnalyzeResponse } from "./types.js";

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

app.post(
  "/analyze",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = validateRequest(req.body);
      if (typeof validated === "string") {
        res.status(400).json({ error: "invalid_request", message: validated });
        return;
      }

      const tavilyKey = process.env.TAVILY_API_KEY;
      if (!tavilyKey) {
        res
          .status(500)
          .json({ error: "missing_config", message: "TAVILY_API_KEY not set on server" });
        return;
      }

      const cacheKey = analyzeCacheKey(validated);
      const cached = analyzeCache.get(cacheKey);
      if (cached) {
        res.setHeader("X-Cache", "hit");
        res.json(cached);
        return;
      }

      console.log(
        `[/analyze] url=${validated.url.slice(0, 80)} text=${validated.page_text.length}c links=${validated.page_links.length}`,
      );
      const result: AnalyzeResponse = await analyze(validated, { tavilyKey });
      analyzeCache.set(cacheKey, result);
      console.log(
        `[/analyze] done — claims=${result.claims.length} ms=${result.meta.ms} tokens=${result.meta.tokens_used} searches=${result.meta.search_queries}`,
      );
      res.setHeader("X-Cache", "miss");
      res.json(result);
    } catch (err) {
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
