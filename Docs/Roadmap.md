# Claim Provenance Engine — Roadmap

Last updated: 2026-04-28

This product traces claims in articles back to their primary sources. It does not say "true/false"; it shows the chain of custody.

Six chain states: `primary`, `direct_cited`, `indirect_cited`, `stale_cited`, `circular`, `untraceable`.

---

## Today (Phase 0)

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
- [x] Per-claim error isolation
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

- [x] Synthetic article 1 (clean primary cites)
- [x] `npm run extract` CLI
- [x] `npm run classify` CLI
- [x] `npm run analyze` CLI
- [ ] Synthetic article 2 (stale/distorted cites)
- [ ] Synthetic article 3 (fully untraceable)

---

## Phase 1 — Finish v1

- [ ] Settings page (options.html)
- [ ] BYOK flow via `chrome.storage.sync`
- [ ] Configurable backend URL, provider, deployments, concurrency
- [ ] Year-match rule in `classify_chain.md`
- [ ] Author-surname-match rule in `classify_chain.md`
- [ ] Real-article eval set (20 hand-annotated articles)
- [ ] README with setup + env + taxonomy

## Phase 2 — Publishable

- [ ] Hosted backend (Hono on Cloudflare Workers)
- [ ] Bound default keys + BYOK override
- [ ] Chrome Web Store listing + privacy policy
- [ ] `include_raw_content: true` Tavily fallback for untraceable retries
- [ ] Static domain reputation table (~200 primaries / 200 low-cred)
- [ ] Re-analyze button in side panel

## Phase 3 — Defensible

- [ ] Server-side provenance cache database
- [ ] Provenance Score per publisher
- [ ] Public API for journalists/researchers
- [ ] LinkedIn / X URL-paste mode
- [ ] Bulk analysis CLI

## Phase 4 — Adjacent surfaces (pick one)

- [ ] Real-time scroll mode
- [ ] Firefox port
- [ ] Edge port
- [ ] Safari (Mac + iOS)
- [ ] Slack / Notion plugin

---

## Cut from scope

- [ ] User accounts / sharing / history
- [ ] Image / video / audio provenance
- [ ] LinkedIn / Twitter DOM scraping
- [ ] User-facing true/false verdict
- [ ] Real-time as-you-type analysis
- [ ] Multi-user / team features

---

## Known limitations (today)

- [ ] Model picks wrong primary when multiple plausible candidates exist
- [ ] `untraceable` returned when snippet doesn't quote claim's figure verbatim
- [ ] Latency 30–40s for 9-claim articles (spec budget was 25s)
- [ ] No telemetry on which prompts/models produce best chains
- [ ] Inline highlights silently skipped when DOM matcher fails
