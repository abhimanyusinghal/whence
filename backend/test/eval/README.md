# Eval set

Hand-annotated articles with expected per-claim chain status. Used by the eval harness (next roadmap item) to score the chain classifier and surface regressions.

## State today

- 3 / 20 entries seeded — all synthetic (the 3 fixtures we control ground truth on)
- 17 real-article slots remain. Add them one at a time.

## Schema

```ts
type EvalDataset = {
  version: 1;
  target_count: 20;
  description: string;
  entries: EvalEntry[];
};

type EvalEntry = {
  id: string;                  // stable, kebab-case
  source: "synthetic" | "real";
  fixture?: string;            // for synthetic: file under backend/test/fixtures/
  url: string;
  title: string;
  added_date: string;          // YYYY-MM-DD
  annotator?: string;
  notes?: string;
  claims: EvalClaim[];
};

type EvalClaim = {
  text: string;                // verbatim from the article — must match what
                               // the extractor produces (or fuzz-match within 60 chars)
  category: "statistic" | "quote" | "study_reference" | "event" | "attribution";
  importance: 1 | 2 | 3;
  inline_link: string | null;

  expected_status: "primary" | "direct_cited" | "indirect_cited"
                 | "stale_cited" | "circular" | "untraceable";

  // optional — list of statuses also acceptable for grading. If omitted,
  // only expected_status counts as correct.
  acceptable_statuses?: ProvenanceStatus[];

  // optional — the URL the harness expects as the primary node in the chain.
  // Used to detect "wrong primary among plausible candidates" errors even
  // when status itself is right.
  expected_primary_url?: string;

  // optional — set true to mark a claim where current behavior is known
  // to be wrong. The harness should still grade these but not flag them
  // as new regressions.
  known_issue?: boolean;

  notes?: string;              // why this annotation
};
```

## How to add a real-article entry

1. **Pick an article you've actually read** — investigative journalism, policy analysis, popular-science blog, or a piece you suspect distorts its sources.
2. **Run the analyzer** to get a draft extraction:
   ```sh
   cd backend
   # If it's a URL:
   curl -s -X POST http://localhost:8787/analyze -H 'Content-Type: application/json' \
     -d '{"url":"...","title":"...","page_text":"...","page_links":[...]}' | jq
   # If you've saved it as HTML:
   npm run analyze -- /path/to/saved.html
   ```
3. **Read the output and the article side-by-side.** For each extracted claim, decide what the *ideal* chain status should be — not what the model produced. The eval is for measuring how close we are to correct; it's not a snapshot of current behavior.
4. **Add an entry to `dataset.json`.** Set `source: "real"`. For each claim:
   - Copy the verbatim `text`
   - Set `expected_status` to the ideal
   - Add `acceptable_statuses` if multiple are defensible (e.g., `direct_cited` and `stale_cited` for borderline distortions)
   - Add `expected_primary_url` when you know what the upstream primary should be
   - Note any reasoning in `notes`
5. **Mark `known_issue: true`** if the ideal status is one the model demonstrably can't yet produce. This locks the annotation in for regression-prevention without flagging it as a new failure.

## Why claim text is pre-frozen

Claim extraction is non-deterministic — the same article can produce slightly different claim text on different runs. To make the eval reproducible, the harness:

1. Re-extracts claims fresh on each run
2. Matches each extracted claim to the nearest pinned claim by text similarity (whitespace-normalized prefix match, fuzzy fallback on first 60 chars — same logic as the inline highlighter)
3. Runs `classify_chain` on the matched pairs and grades the result

This isolates the `classify_chain` prompt for tuning. Tweaks to `extract_claims.md` change which annotated claims get matched, but don't break grading on the ones that do.

## Annotator guidance

- **Don't annotate to current behavior.** If the model returns `untraceable` but a real primary exists, mark `expected_status: indirect_cited` (or whatever the truth is) and `known_issue: true`. The point is to know how big the gap is.
- **Do allow alternates.** Lots of real claims are defensibly classifiable two ways (e.g., a stat that's slightly distorted from a real source: `direct_cited` if you're permissive, `stale_cited` if strict). Use `acceptable_statuses` for these.
- **Do prefer hard cases.** A perfect direct_cited claim with a primary inline link teaches us little. Borderline claims, fabricated quotes, and cherry-picked statistics teach us a lot. Aim for variety: ~5 clean, ~10 distorted, ~5 untraceable.
- **Skip articles where extraction is the bottleneck.** If the model can't reliably extract a claim's verbatim text, the eval grade will be noise. Pick clean, well-written articles.

## Distribution targets

Aim for the final 20 entries to cover:

- **By status:** 5–7 `direct_cited`/`primary`, 3–5 `indirect_cited`, 5–7 `stale_cited`, 3–5 `untraceable`
- **By topic:** at least one each from health/medicine, economics/finance, tech/AI, politics/policy, social science. Spread reduces topic bias.
- **By source quality:** mix outlets — a NYT investigative piece, a Substack post, a corporate blog, a Wikipedia article. The classifier should perform consistently across sources.
- **By known issues:** at least 3 entries that exercise known limitations (wrong-primary tie-break, false-untraceable on figure-mismatch). Without these in the eval, the Phase 1 prompt fixes have no measurable target.
