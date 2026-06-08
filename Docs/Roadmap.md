# Claim Provenance Engine — Roadmap

Last updated: 2026-06-08

> **Direction note (2026-06-08):** simplified to a self-hosted, clone-and-run tool.
> The API auth, per-key rate limiting, and per-key usage metering added earlier in
> Phase 1 were **removed** — anyone can clone, supply their own provider keys
> (LLM + at least one search provider) via `.env` or per-request BYOK, and use it.
> Structured chain/request logging stays (it's the provenance-graph foundation).

This product traces claims in articles back to their primary sources. It does not say "true/false"; it shows the chain of custody.

Six chain states: `primary`, `direct_cited`, `indirect_cited`, `stale_cited`, `circular`, `untraceable`.

Design principle: hold the no-verdict line. The value is showing where claims actually come from, not adjudicating truth. Resist requests to add a true/false toggle.

---

## Phase 0 — Today

### Backend

- [x] Express server with `/healthz` and `/analyze`
- [x] Provider abstraction (Anthropic + Azure OpenAI behind `LLM_PROVIDER`)
- [x] Per-task deployment routing (nano for extract, gpt-5.4 for classify)
- [x] `extract_claims` prompt with strict JSON schema
- [x] `classify_chain` prompt with strict JSON schema
- [x] Six-state taxonomy enforced by JSON schema
- [x] Tavily search wrapper
- [x] Inline-link injection as 9th candidate
- [x] URL allow-list scrubber (rejects fabricated URLs)
- [x] Stable claim IDs (sha256 prefix)
- [x] Concurrency-4 fan-out across claims
- [x] Page text truncation (60K cap, head+tail split)
- [x] LRU cache (50 entries)
- [x] `X-Cache: hit/miss` response header
- [x] CORS for `chrome-extension://*` origins
- [x] Per-claim error isolation (production-tested on a real Azure 500)
- [x] Aggregated meta (tokens, searches, ms)
- [x] Anthropic prompt caching on system prompt
- [x] Azure OpenAI Responses API (supports gpt-5.4 family)

### Chrome extension (MV3)

- [x] Manifest V3 with side_panel + popup
- [x] Programmatic content-script injection (no `<all_urls>`)
- [x] Page extractor (title, text, links with anchor + near_text)
- [x] Service worker as message router
- [x] Popup with Analyze button + status
- [x] Side panel with chain card UI
- [x] Skeleton loading state
- [x] Status badges (color-coded per taxonomy)
- [x] Inline DOM highlights with status-color underlines
- [x] Robust text matcher (whitespace-norm + 60-char fallback)
- [x] Click highlight → side panel scrolls to card
- [x] Click card → page flashes the highlight
- [x] Idempotent listener registration
- [x] esbuild build pipeline
- [x] Pure-Node PNG icon generator

### Tests + CLIs

- [x] Synthetic article 1 (clean primary cites) — `direct_cited` / `indirect_cited` chains
- [x] Synthetic article 2 (stale/distorted cites) — 6/6 distortions detected as `stale_cited`
- [x] Synthetic article 3 (fully untraceable) — 8/8 fabricated sources detected as `untraceable`
- [x] `npm run extract` CLI
- [x] `npm run classify` CLI
- [x] `npm run analyze` CLI

---

## Phase 1

- [x] Structured logs per `/analyze` call: claim_id, model, search_count, ms, status, fallback_used, error
- [x] Append every chain to a JSONL log file (later becomes the graph database)
- [ ] Real-article eval set: 20 hand-annotated articles with expected chain status per claim (scaffold + 3 synthetic seeds shipped; 17 real articles still to annotate)
- [x] Eval harness that runs the set, scores precision/recall on status classification, surfaces regressions
- [x] Year-match rule in `classify_chain.md`
- [ ] Author-surname-match rule in `classify_chain.md`
- [ ] Tie-break heuristic for "wrong primary among plausible candidates": prefer official > peer-reviewed > government > major outlet > blog. Log when ties occur.
- [x] "False untraceable" fallback: Tavily `include_raw_content: true` retry before declaring untraceable
- [~] API key auth on `/analyze` — shipped then **removed** 2026-06-08 (self-host simplicity)
- [~] Rate limiting per key — shipped then **removed** 2026-06-08 (self-host simplicity)
- [~] Usage metering per key — shipped then **removed** 2026-06-08 (self-host simplicity)
- [x] `/v1/analyze` versioned endpoint with stable JSON contract (legacy `/analyze` aliased for back-compat)
- [x] OpenAPI 3.1 spec at `backend/openapi.yaml`, served live at `/openapi.yaml` and `/v1/openapi.yaml`
- [x] One-page API documentation at `Docs/API.md` (curl examples, response schema, six states explained)
- [ ] Host on Azure
- [x] BYOK override — per-request `search_options.byok` and the extension Options page let users supply their own search-provider keys (overriding the server's env keys)
- [x] Extension: capture canonicalUrl, author, publishedDate, accessedAt, htmlHash; pass through to /v1/analyze
- [x] Prompt-injection hardening: wrap page_text in `<untrusted_page_content>`, strip script/hidden DOM, add treat-as-data instruction
- [x] Numeric `source_quality_score` (0–1) on `ProvenanceNode`; feed the existing tie-break heuristic
- [x] Capture exact `evidence_quote` (verbatim span) per node, distinct from the Tavily snippet


---

## Phase 2

- [ ] Bulk analysis CLI (newsrooms want batch over watchlists)
- [ ] CSV / JSON export of chains for editorial review
- [ ] Per-author or per-domain "provenance fingerprint" — does this writer typically cite primaries
- [ ] Webhook on completion (long-running batch jobs)
- [ ] CMS plugin (WordPress first; Substack / Ghost / Medium are downstream of WordPress)


- [ ] One published case study: run the engine over a viral post or news cycle and publish the chain breakdown
- [ ] Chrome Web Store listing (extension stays free)

---

## Phase 3

- [ ] Move JSONL logs to Postgres or D1 — every claim, every chain, every node, every search query
- [ ] Public-by-default cache: anonymous users contribute to the graph, see other people's verified chains
- [ ] Provenance Score per publisher (now meaningful because the graph has volume)
- [ ] De-dup claims across articles (same statistic, different sources → graph nodes converge)

- [ ] Publisher provenance dataset (CSV / API) derived from the graph
- [ ] AI grounding API: structured claim → primary-source pairs for LLM developers

---

## Phase 4 — Scale (month 4+)

- [ ] LinkedIn / X URL-paste mode (URL-only, no DOM scraping)
- [ ] Latency optimization (parallelize Tavily within claims, prompt-caching gains, smaller model for extract)
- [ ] Firefox port
- [ ] Slack / Notion plugin (if there's demand)
- [ ] Multi-language support


## Known limitations (today)

- [ ] Model picks wrong primary when multiple plausible candidates exist (Phase 1: year-match rule shipped 2026-04-29 — primary URL accuracy 67% → 89% on the synthetic eval set; author-match and full tie-break still open since first bundled attempt regressed direct_cited cases)
- [x] `untraceable` returned when snippet doesn't quote claim's figure verbatim — fixed via raw-content retry shipped 2026-04-29 (status correct 85% → 95%; stale_cited recall 80% → 100% on synthetic eval set)
- [ ] Latency 30–40s for 9-claim articles (spec budget was 25s; defer until customer raises it)
- [ ] No telemetry on which prompts/models produce best chains (Phase 1: structured logs + eval harness)
- [ ] Inline highlights silently skipped when DOM matcher fails (low-pri; UI-only)
- [ ] Extract occasionally duplicates a claim with slightly different wording (Phase 1: prompt tightening)

---