# Claim Provenance Engine

Chrome extension + Node backend that traces claims in articles back to their original sources.
Output is a chain-of-custody, not a true/false verdict. Status taxonomy:
`primary`, `direct_cited`, `indirect_cited`, `stale_cited`, `circular`, `untraceable`.

No accounts, no login, no API keys to provision. Clone it, drop your own provider keys in
`.env`, run it, use it.

## Quick start

```sh
git clone https://github.com/abhimanyusinghal/claim
cd claim
cp .env.example .env        # then edit .env — see "Configure keys" below
cd backend && npm install
npm run dev                 # starts on http://localhost:8787
```

Then either open the web UI at **http://localhost:8787/try**, or load the Chrome extension
(see [Chrome extension](#chrome-extension)).

Health check:

```sh
curl http://localhost:8787/healthz
```

The `search_providers_configured` array in the response tells you which search providers
the server found keys for.

> **Production build:** `npm run dev` runs the TypeScript directly via `tsx` (auto-reload).
> For a compiled run, use `cd backend && npm install && npm run build && npm start`.

> **Node:** requires Node.js **20+**.

## Configure keys

You need **two things**: one LLM provider (to read the article) and **at least one** web-search
provider (to find sources). Everything is set in `.env`.

### 1. LLM provider

Pick one with `LLM_PROVIDER`:

```ini
LLM_PROVIDER=anthropic            # "anthropic" or "azure_openai"
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6
```

For Azure OpenAI instead, set `LLM_PROVIDER=azure_openai` and fill the `AZURE_OPENAI_*` block.

**Optional content-filter fallback.** Azure's content filter rejects a lot of legitimate
news/medical/political articles. Set a fallback provider and, when the primary is blocked
by its safety filter, the request is automatically retried on the fallback:

```ini
LLM_PROVIDER=azure_openai
LLM_FALLBACK_PROVIDER=anthropic   # retried only on a content-filter block
```

Both providers must be credentialed for the fallback to engage; otherwise it's silently
disabled and the primary is used alone.

### 2. Search providers (multi-provider)

This is the part most people want to tune. The backend runs **every search provider it has a
key for**, in parallel, for each claim — then merges the results. You don't have to enable
all of them; **one is enough**, and more providers means broader source coverage.

| Provider | Free tier (typical) | Env vars |
|---|---|---|
| **Tavily** | 1,000 searches/mo | `TAVILY_API_KEY` |
| **Brave Search** | 2,000 queries/mo (card on file) | `BRAVE_API_KEY` |
| **Serper.dev** | 2,500 one-time credits, then paid | `SERPER_API_KEY` |
| **Google PSE** | 100 queries/day per CSE (tightest cap) | `GOOGLE_PSE_KEY` + `GOOGLE_PSE_CX` |
| **Bing Web Search** | 1,000 queries/mo (Azure F1) | `BING_API_KEY` |

Set whichever you have. For example, to run Tavily + Brave:

```ini
TAVILY_API_KEY=tvly-...
BRAVE_API_KEY=BSA...
# leave the rest blank
```

Google PSE needs **both** a Cloud API key and a Custom Search Engine id (`cx`):

```ini
GOOGLE_PSE_KEY=AIza...
GOOGLE_PSE_CX=0123456789:abcdef
```

#### How aggregation works

- Each enabled provider is queried **in parallel** per claim, with a 10s per-provider timeout.
- Results are **deduplicated** by canonical URL.
- **Cross-provider corroboration drives ranking** — a URL returned by 3 providers ranks above
  one returned by a single provider, even if that single result was first in its own list.
- A provider that errors or has no key is **skipped, not fatal** — the analysis continues on
  the others, and the skipped/errored providers are reported in `meta.search_providers_skipped`
  and `meta.search_provider_errors`.
- Adding a provider adds the *slower* of the two to per-claim latency (parallel, not summed),
  but does spend that provider's free-tier budget (one query per claim per analysis).

If the server can't resolve a usable key for any requested provider, `/v1/analyze` returns
`500 missing_config` with a message telling you which env vars to set.

#### Choosing providers per request (and BYOK)

Callers can override the server defaults per request via `search_options` — restrict the
provider set and/or bring your own keys (BYOK), which take precedence over the server's env keys:

```json
{
  "url": "https://example.com/article",
  "title": "Article title",
  "page_text": "…",
  "page_links": [],
  "search_options": {
    "providers": ["brave", "serper"],
    "byok": {
      "brave": "BSA...",
      "google_pse": { "key": "AIza...", "cx": "0123:abcd" }
    }
  }
}
```

Omit `search_options` entirely to just use whatever the server has keys for. See
[Docs/API.md](Docs/API.md) for the full contract.

## Chrome extension

```sh
cd extension && npm install && npm run build
```

Then load `extension/dist` as an unpacked extension at `chrome://extensions` (Developer mode on).
Click the toolbar icon on any article to open the side panel and Analyze.

The extension's **Options page** mirrors the multi-provider config: toggle which providers to use,
and optionally enter your own keys (BYOK) so your searches run on your quota instead of the
server's. These choices are sent to the backend as `search_options` on each Analyze.

## Data & privacy

Know what goes where before running this on sensitive material — it all runs under **your** keys
and **your** infrastructure; nothing is sent to the project authors. You are the operator.

- **To your LLM provider** (Anthropic or Azure OpenAI): the article's full text, title, and URL, on every analysis.
- **To your search providers** (whichever you enable): a search query derived from each claim.
- **Written to disk by default**: every analyzed claim and its provenance chain is appended to
  `./data/chains.jsonl` (set `CHAINS_LOG_FILE=` to an empty value to disable). Request-level logs
  (including URL + title) go to stderr.
- **Off by default**: setting `BLOB_CONNECTION_STRING` uploads those chain records to *your* Azure
  Blob Storage instead of the local file. Leave it blank to keep everything local.

## Security & deployment

The backend has **no authentication and no rate limiting** by design — it's meant to run locally or
inside infrastructure you control. `/analyze` and `/v1/analyze` are **unauthenticated and spend your
provider budget on every call** (LLM + search credits).

**Do not expose the backend directly on the public internet.** If you need remote access, put it
behind your own reverse proxy / auth / rate limiting (nginx, Cloudflare Access, an API gateway,
etc.). The server binds all interfaces on port 8787, so run it on `localhost` or a private network
unless you've added your own gating.

## Disclaimer & limitations

Output is an **automated, model-generated heuristic**, not a verdict. The six states (including
`stale_cited` and `untraceable`) describe only what the tool could trace from the page and search
results — they are **not** findings of dishonesty, plagiarism, or fabrication against any author or
publisher, and **not** a true/false judgment of the claim itself. The model can miss a real source,
misread a citation, or mislabel a chain.

Treat results as a research aid to be verified by a human, not as evidence. The software is provided
"as is", without warranty of any kind (see [LICENSE](LICENSE)).

## Docs

- [Docs/API.md](Docs/API.md) — `POST /v1/analyze` reference, six-state taxonomy, search providers.
- [Docs/postman_collection.json](Docs/postman_collection.json) — Postman collection with happy paths + error cases + assertions. Import and click run.
- [backend/openapi.yaml](backend/openapi.yaml) — machine-readable spec; also served live at `/v1/openapi.yaml` (and rendered at `/docs`).
- [Docs/Roadmap.md](Docs/Roadmap.md) — what's shipped, what's next.

## Layout

```
backend/   Node + Express + TypeScript service. /analyze + /v1/analyze, /try web UI.
extension/ Chrome MV3 extension.
Docs/      Roadmap, API reference.
scripts/   dev helpers.
```

## Contributing & security

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). To report a security issue
privately, see [SECURITY.md](SECURITY.md) (please don't open a public issue for vulnerabilities).

## License

[MIT](LICENSE) © 2026 Abhimanyu Singhal.
