import { config as loadEnv } from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

import { analyze } from "../orchestrator.js";
import type { AnalyzeRequest, PageLink } from "../types.js";

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rsquo;/g, "’")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return m ? m[1].trim() : "";
}

function extractLinks(html: string): PageLink[] {
  const links: PageLink[] = [];
  const re = /<a\s+[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const href = match[1];
    if (!href.startsWith("http")) continue;
    const idx = match.index;
    const before = html.slice(Math.max(0, idx - 200), idx);
    const after = html.slice(idx + match[0].length, idx + match[0].length + 200);
    links.push({
      href,
      anchor_text: htmlToText(match[2]),
      near_text: htmlToText(`${before}${match[0]}${after}`),
    });
  }
  return links;
}

async function main() {
  const fixtureArg = process.argv[2] ?? "test/fixtures/article1.html";
  const fixturePath = path.resolve(fixtureArg);
  const html = await fs.readFile(fixturePath, "utf8");

  const article: AnalyzeRequest = {
    url: `file://${fixturePath}`,
    title: extractTitle(html),
    page_text: htmlToText(html),
    page_links: extractLinks(html),
  };

  const env: import("../search/index.js").EnvKeys = {};
  if (process.env.TAVILY_API_KEY) env.tavily = process.env.TAVILY_API_KEY;
  if (process.env.BRAVE_API_KEY) env.brave = process.env.BRAVE_API_KEY;
  if (process.env.SERPER_API_KEY) env.serper = process.env.SERPER_API_KEY;
  if (process.env.BING_API_KEY) env.bing = process.env.BING_API_KEY;
  if (process.env.GOOGLE_PSE_KEY && process.env.GOOGLE_PSE_CX) {
    env.google_pse = { key: process.env.GOOGLE_PSE_KEY, cx: process.env.GOOGLE_PSE_CX };
  }
  if (Object.keys(env).length === 0) throw new Error("No search provider keys set in env");

  console.error(`[cli] fixture: ${fixturePath}`);
  console.error(`[cli] providers: ${Object.keys(env).join(", ")}`);
  console.error(`[cli] running full /analyze pipeline...`);
  console.error("");

  const result = await analyze(article, { env });

  console.error("");
  console.error(
    `[cli] done — claims=${result.claims.length} ms=${result.meta.ms} tokens=${result.meta.tokens_used} searches=${result.meta.search_queries}`,
  );
  console.error("");

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("[cli] error:", err);
  process.exit(1);
});
