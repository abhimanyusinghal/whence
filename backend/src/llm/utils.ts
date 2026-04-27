import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AnalyzeRequest } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(__dirname, "../prompts");

const promptCache = new Map<string, string>();

export async function loadPrompt(name: string): Promise<string> {
  const cached = promptCache.get(name);
  if (cached) return cached;
  const text = await fs.readFile(path.join(PROMPTS_DIR, `${name}.md`), "utf8");
  promptCache.set(name, text);
  return text;
}

export function buildExtractUserMessage(input: AnalyzeRequest): string {
  return [
    `URL: ${input.url}`,
    `Title: ${input.title}`,
    "",
    "--- Article text ---",
    input.page_text,
    "",
    `--- Page links (${input.page_links.length}) ---`,
    JSON.stringify(input.page_links, null, 2),
  ].join("\n");
}

export type SearchCandidate = {
  url: string;
  title: string;
  publisher: string;
  published_date: string | null;
  snippet: string;
};

export type ClassifyChainInput = {
  article_url: string;
  article_title: string;
  article_publisher: string;
  claim: {
    text: string;
    normalized: string;
    category: string;
    importance: number;
    inline_link: string | null;
  };
  candidates: SearchCandidate[];
};

export function buildClassifyUserMessage(input: ClassifyChainInput): string {
  const lines: string[] = [
    "ARTICLE",
    `  url: ${input.article_url}`,
    `  title: ${input.article_title}`,
    `  publisher: ${input.article_publisher}`,
    "",
    "CLAIM",
    `  text: ${input.claim.text}`,
    `  normalized: ${input.claim.normalized}`,
    `  category: ${input.claim.category}`,
    `  importance: ${input.claim.importance}`,
    `  inline_link: ${input.claim.inline_link ?? "(none)"}`,
    "",
    `CANDIDATES (${input.candidates.length})`,
  ];
  for (const [i, c] of input.candidates.entries()) {
    lines.push(
      `  [${i + 1}] ${c.url}`,
      `      title: ${c.title}`,
      `      publisher: ${c.publisher}`,
      `      date: ${c.published_date ?? "(unknown)"}`,
      `      snippet: ${c.snippet.slice(0, 400).replace(/\s+/g, " ")}`,
    );
  }
  return lines.join("\n");
}

export const CLASSIFY_CHAIN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: [
        "primary",
        "direct_cited",
        "indirect_cited",
        "stale_cited",
        "circular",
        "untraceable",
      ],
    },
    hop_count: {
      type: "integer",
      description:
        "0 if article is primary; positive integer for direct/indirect; -1 for circular/untraceable",
    },
    nodes: {
      type: "array",
      description: "Ordered chain: article -> ... -> primary",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          publisher: { type: "string" },
          published_date: { type: ["string", "null"] },
          type: {
            type: "string",
            enum: ["primary", "secondary", "tertiary", "social", "unknown"],
          },
          links_to_upstream: { type: "array", items: { type: "string" } },
          snippet: { type: "string" },
        },
        required: [
          "url",
          "title",
          "publisher",
          "published_date",
          "type",
          "links_to_upstream",
          "snippet",
        ],
      },
    },
    notes: { type: "string", description: "1-2 sentence reasoning" },
  },
  required: ["status", "hop_count", "nodes", "notes"],
} as const;

export const EXTRACT_CLAIMS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string", description: "Verbatim claim text from the article" },
          normalized: { type: "string", description: "Search-friendly rewrite of the claim" },
          category: {
            type: "string",
            enum: ["statistic", "quote", "study_reference", "event", "attribution"],
          },
          importance: { type: "integer", enum: [1, 2, 3] },
          inline_link: {
            type: ["string", "null"],
            description: "URL the article links near this claim, or null",
          },
        },
        required: ["text", "normalized", "category", "importance", "inline_link"],
      },
    },
  },
  required: ["claims"],
} as const;
