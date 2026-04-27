import { config as loadEnv } from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

import { createProvider } from "../llm/index.js";
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
    const anchor = htmlToText(match[2]);
    if (!href.startsWith("http")) continue;

    const idx = match.index;
    const before = html.slice(Math.max(0, idx - 200), idx);
    const after = html.slice(idx + match[0].length, idx + match[0].length + 200);
    const near = htmlToText(`${before}${match[0]}${after}`);

    links.push({ href, anchor_text: anchor, near_text: near });
  }
  return links;
}

async function main() {
  const fixtureArg = process.argv[2] ?? "test/fixtures/article1.html";
  const fixturePath = path.resolve(fixtureArg);
  const html = await fs.readFile(fixturePath, "utf8");

  const input: AnalyzeRequest = {
    url: `file://${fixturePath}`,
    title: extractTitle(html),
    page_text: htmlToText(html),
    page_links: extractLinks(html),
  };

  const provider = createProvider();

  console.error(`[cli] fixture:  ${fixturePath}`);
  console.error(`[cli] provider: ${provider.name} (${provider.modelLabel})`);
  console.error(`[cli] title:    ${input.title}`);
  console.error(`[cli] text:     ${input.page_text.length} chars`);
  console.error(`[cli] links:    ${input.page_links.length}`);
  console.error(`[cli] calling extractClaims...`);

  const t0 = Date.now();
  const result = await provider.extractClaims(input);
  const ms = Date.now() - t0;

  console.error(
    `[cli] done in ${ms}ms — input=${result.usage.input_tokens} output=${result.usage.output_tokens} cache_read=${result.usage.cache_read_input_tokens} cache_write=${result.usage.cache_creation_input_tokens}`,
  );
  console.error(`[cli] ${result.claims.length} claims extracted\n`);

  console.log(JSON.stringify(result.claims, null, 2));
}

main().catch((err) => {
  console.error("[cli] error:", err);
  process.exit(1);
});
