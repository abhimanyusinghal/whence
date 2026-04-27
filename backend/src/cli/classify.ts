import { config as loadEnv } from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

import { createProvider } from "../llm/index.js";
import { publisherFromUrl, tavilySearch, withInlineLink } from "../search.js";
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
    const anchor = htmlToText(match[2]);
    const idx = match.index;
    const before = html.slice(Math.max(0, idx - 200), idx);
    const after = html.slice(idx + match[0].length, idx + match[0].length + 200);
    links.push({
      href,
      anchor_text: anchor,
      near_text: htmlToText(`${before}${match[0]}${after}`),
    });
  }
  return links;
}

async function main() {
  const fixtureArg = process.argv[2] ?? "test/fixtures/article1.html";
  const claimIndex = Number(process.argv[3] ?? 0);

  const fixturePath = path.resolve(fixtureArg);
  const html = await fs.readFile(fixturePath, "utf8");

  const article: AnalyzeRequest = {
    url: `file://${fixturePath}`,
    title: extractTitle(html),
    page_text: htmlToText(html),
    page_links: extractLinks(html),
  };

  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey) {
    throw new Error("TAVILY_API_KEY is not set in .env");
  }

  const provider = createProvider();

  console.error(`[cli] fixture:  ${fixturePath}`);
  console.error(`[cli] provider: ${provider.name} (${provider.modelLabel})`);
  console.error(`[cli] step 1/3: extracting claims...`);

  const tExtract = Date.now();
  const extract = await provider.extractClaims(article);
  console.error(
    `[cli]   extracted ${extract.claims.length} claims in ${Date.now() - tExtract}ms (in=${extract.usage.input_tokens} out=${extract.usage.output_tokens})`,
  );

  if (extract.claims.length === 0) {
    throw new Error("No claims extracted from fixture");
  }
  if (claimIndex < 0 || claimIndex >= extract.claims.length) {
    throw new Error(`claim index ${claimIndex} out of range (0..${extract.claims.length - 1})`);
  }

  const claim = extract.claims[claimIndex];
  console.error(`[cli]   selected claim [${claimIndex}]: ${claim.text.slice(0, 120)}...`);

  console.error(`[cli] step 2/3: searching Tavily for "${claim.normalized.slice(0, 80)}..."`);
  const tSearch = Date.now();
  const rawCandidates = await tavilySearch({
    apiKey: tavilyKey,
    query: claim.normalized,
    maxResults: 8,
  });
  const candidates = withInlineLink(rawCandidates, claim.inline_link ?? null);
  console.error(
    `[cli]   ${rawCandidates.length} from Tavily + ${candidates.length - rawCandidates.length} inline (${Date.now() - tSearch}ms)`,
  );

  console.error(`[cli] step 3/3: classifying chain...`);
  const tClassify = Date.now();
  const result = await provider.classifyChain({
    article_url: article.url,
    article_title: article.title,
    article_publisher: publisherFromUrl(article.url),
    claim: { ...claim, inline_link: claim.inline_link ?? null },
    candidates,
  });
  const ms = Date.now() - tClassify;
  console.error(
    `[cli]   done in ${ms}ms (in=${result.usage.input_tokens} out=${result.usage.output_tokens} cache_read=${result.usage.cache_read_input_tokens})`,
  );
  console.error("");

  const out = {
    claim,
    candidates: candidates.map((c) => ({ url: c.url, title: c.title, publisher: c.publisher })),
    chain: result.chain,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error("[cli] error:", err);
  process.exit(1);
});
