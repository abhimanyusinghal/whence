import { config as loadEnv } from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

import { analyze } from "../orchestrator.js";
import {
  confusionMatrix,
  findBestPinned,
  gradeChain,
  statusMetrics,
  type ChainGrade,
  type EvalDataset,
  type EvalEntry,
  type PinnedClaim,
  type StatusPair,
} from "../eval/grader.js";
import type { ProvenanceStatus } from "../types.js";
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

async function loadEntryRequest(entry: EvalEntry): Promise<AnalyzeRequest | null> {
  if (entry.fixture) {
    const fixturePath = path.resolve("test/fixtures", entry.fixture);
    const html = await fs.readFile(fixturePath, "utf8");
    return {
      url: entry.url,
      title: entry.title || extractTitle(html),
      page_text: htmlToText(html),
      page_links: extractLinks(html),
    };
  }
  // Real-source entries with no local fixture would need URL fetching;
  // out of scope for harness v1.
  return null;
}

function pct(n: number, d: number): string {
  if (d === 0) return "n/a";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function fmtFrac(x: number | null): string {
  if (x === null) return "  -  ";
  return `${(x * 100).toFixed(1)}%`.padStart(7);
}

type ClaimReport = {
  pinned_text?: string;
  extracted_text: string;
  match_score: "exact" | "prefix" | null;
  grade?: ChainGrade;
  known_issue?: boolean;
};

type EntryReport = {
  id: string;
  status: "graded" | "skipped";
  total_pinned: number;
  matched: number;
  missed: string[];           // pinned texts that no extracted claim matched
  unannotated: number;        // extracted claims with no pinned match
  claims: ClaimReport[];
  total_ms?: number;
};

async function main() {
  const datasetPath = process.argv[2] ?? "test/eval/dataset.json";
  const filterId = process.argv[3] ?? null; // optional: run only one entry by id
  const dataset: EvalDataset = JSON.parse(await fs.readFile(datasetPath, "utf8"));
  const env: import("../search/index.js").EnvKeys = {};
  if (process.env.TAVILY_API_KEY) env.tavily = process.env.TAVILY_API_KEY;
  if (process.env.BRAVE_API_KEY) env.brave = process.env.BRAVE_API_KEY;
  if (process.env.SERPER_API_KEY) env.serper = process.env.SERPER_API_KEY;
  if (process.env.BING_API_KEY) env.bing = process.env.BING_API_KEY;
  if (process.env.GOOGLE_PSE_KEY && process.env.GOOGLE_PSE_CX) {
    env.google_pse = { key: process.env.GOOGLE_PSE_KEY, cx: process.env.GOOGLE_PSE_CX };
  }
  if (Object.keys(env).length === 0) throw new Error("No search provider keys set in env");

  console.error(
    `[eval] dataset v${dataset.version}, ${dataset.entries.length} entries, target=${dataset.target_count}`,
  );
  if (filterId) console.error(`[eval] filter: only entry id="${filterId}"`);

  const totals = {
    pinned: 0,
    matched: 0,
    status_correct: 0,
    both_correct: 0,
    primary_correct: 0,
    primary_pinned: 0,
    known_issues: 0,
    known_issues_now_passing: 0,
    unannotated: 0,
    skipped: 0,
  };

  const entryReports: EntryReport[] = [];
  const statusPairs: StatusPair[] = [];
  const t0 = Date.now();

  for (const entry of dataset.entries) {
    if (filterId && entry.id !== filterId) continue;

    const request = await loadEntryRequest(entry);
    if (!request) {
      console.error(`[eval] ${entry.id}: skipped (no fixture)`);
      totals.skipped++;
      entryReports.push({
        id: entry.id,
        status: "skipped",
        total_pinned: entry.claims.length,
        matched: 0,
        missed: entry.claims.map((c) => c.text.slice(0, 80)),
        unannotated: 0,
        claims: [],
      });
      continue;
    }

    console.error(`[eval] ${entry.id}: analyzing ${entry.claims.length} pinned claims...`);
    const entryT0 = Date.now();
    const result = await analyze(request, { env });
    const entryMs = Date.now() - entryT0;

    const matchedPinned = new Set<number>();
    const claimReports: ClaimReport[] = [];
    let unannotated = 0;

    for (let i = 0; i < result.claims.length; i++) {
      const extracted = result.claims[i];
      const chain = result.chains[i];
      const match = findBestPinned(extracted.text, entry.claims);

      if (!match) {
        unannotated++;
        claimReports.push({
          extracted_text: extracted.text.slice(0, 100),
          match_score: null,
        });
        continue;
      }

      matchedPinned.add(match.pinnedIndex);
      const grade = gradeChain(chain, match.pinned);
      const known = match.pinned.known_issue ?? false;

      totals.status_correct += grade.status_correct ? 1 : 0;
      totals.both_correct += grade.overall ? 1 : 0;
      totals.known_issues += known ? 1 : 0;
      totals.known_issues_now_passing += known && grade.overall ? 1 : 0;
      if (match.pinned.expected_primary_url) {
        totals.primary_pinned++;
        if (grade.primary_correct === true) totals.primary_correct++;
      }

      statusPairs.push({
        expected: match.pinned.expected_status,
        actual: chain.status,
      });

      claimReports.push({
        pinned_text: match.pinned.text.slice(0, 100),
        extracted_text: extracted.text.slice(0, 100),
        match_score: match.score,
        grade,
        known_issue: known,
      });
    }

    const missed = entry.claims
      .map((c, i) => (matchedPinned.has(i) ? null : c.text.slice(0, 80)))
      .filter((x): x is string => x !== null);

    totals.pinned += entry.claims.length;
    totals.matched += matchedPinned.size;
    totals.unannotated += unannotated;

    entryReports.push({
      id: entry.id,
      status: "graded",
      total_pinned: entry.claims.length,
      matched: matchedPinned.size,
      missed,
      unannotated,
      claims: claimReports,
      total_ms: entryMs,
    });

    console.error(
      `[eval] ${entry.id}: matched ${matchedPinned.size}/${entry.claims.length} pinned, ${claimReports.filter((c) => c.grade?.overall).length} fully correct, ${entryMs}ms`,
    );
  }

  const totalMs = Date.now() - t0;

  console.error("");
  console.error("=== SUMMARY ===");
  console.error(`Entries:               ${entryReports.length} (${totals.skipped} skipped)`);
  console.error(`Pinned claims:         ${totals.pinned}`);
  console.error(
    `Matched:               ${totals.matched} (${pct(totals.matched, totals.pinned)} of pinned)`,
  );
  console.error(
    `Status correct:        ${totals.status_correct} (${pct(totals.status_correct, totals.matched)} of matched)`,
  );
  console.error(
    `Status + primary OK:   ${totals.both_correct} (${pct(totals.both_correct, totals.matched)} of matched)`,
  );
  console.error(
    `Primary correct:       ${totals.primary_correct} of ${totals.primary_pinned} pinned primaries (${pct(totals.primary_correct, totals.primary_pinned)})`,
  );
  console.error(
    `Known issues passing:  ${totals.known_issues_now_passing} of ${totals.known_issues} (flip known_issue:false on those)`,
  );
  console.error(`Unannotated extractions: ${totals.unannotated}`);
  console.error(`Total time:            ${totalMs}ms`);
  console.error("");

  // Per-class precision / recall / F1
  const metrics = statusMetrics(statusPairs);
  console.error("=== PER-STATUS METRICS ===");
  console.error("status            actual  pred  TP   precision  recall   F1");
  for (const m of metrics) {
    if (m.actual === 0 && m.predicted === 0) continue;
    console.error(
      `${m.status.padEnd(17)} ${String(m.actual).padStart(6)} ${String(m.predicted).padStart(5)} ${String(m.true_positive).padStart(4)}   ${fmtFrac(m.precision)}     ${fmtFrac(m.recall)}    ${fmtFrac(m.f1)}`,
    );
  }
  console.error("");

  // Confusion matrix (compact view, columns are actual)
  const cm = confusionMatrix(statusPairs);
  const cols = (
    ["primary", "direct_cited", "indirect_cited", "stale_cited", "circular", "untraceable"] as ProvenanceStatus[]
  ).filter((s) => statusPairs.some((p) => p.expected === s || p.actual === s));
  if (cols.length > 0) {
    console.error("=== CONFUSION MATRIX ===");
    console.error("(rows = expected, cols = actual)");
    const colShort = cols.map((c) => c.replace("_cited", "").slice(0, 4));
    console.error("                " + colShort.map((c) => c.padStart(6)).join(""));
    for (const row of cols) {
      const cells = cols.map((col) => String(cm[row][col]).padStart(6));
      console.error(row.padEnd(16) + cells.join(""));
    }
    console.error("");
  }

  // Print failures inline so they're easy to scan
  console.error("=== FAILURES ===");
  let failureCount = 0;
  for (const er of entryReports) {
    if (er.status === "skipped") continue;
    for (const cr of er.claims) {
      if (!cr.grade || cr.grade.overall) continue;
      failureCount++;
      const status = cr.grade.status_correct ? "STATUS-OK" : "STATUS-WRONG";
      const primary =
        cr.grade.primary_correct === null
          ? ""
          : cr.grade.primary_correct
            ? " PRIMARY-OK"
            : " PRIMARY-WRONG";
      const ki = cr.known_issue ? " [known]" : "";
      console.error(
        `  ${er.id} | ${status}${primary}${ki} | exp=${cr.grade.expected_status} got=${cr.grade.actual_status}`,
      );
      console.error(`    pinned:     ${cr.pinned_text}`);
      if (cr.grade.primary_correct === false) {
        console.error(`    exp prim:   (set on entry)`);
        console.error(`    got prim:   ${cr.grade.actual_primary_url}`);
      }
    }
  }
  if (failureCount === 0) console.error("  (none)");
  console.error("");

  // JSON dump on stdout for downstream tooling
  console.log(
    JSON.stringify(
      {
        dataset_version: dataset.version,
        run_ms: totalMs,
        summary: totals,
        per_status_metrics: metrics,
        confusion_matrix: cm,
        entries: entryReports,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("[eval] error:", err);
  process.exit(1);
});
