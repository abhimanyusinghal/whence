# Claim Provenance API

`POST /v1/analyze` takes an article (URL + title + text + links) and returns one `ProvenanceChain` per checkable claim it finds. Each chain says where the claim came from, not whether it's true.

- Machine-readable schema: [`backend/openapi.yaml`](../backend/openapi.yaml) (also served live at `/openapi.yaml` and `/v1/openapi.yaml`)
- Manual test collection: [`Docs/postman_collection.json`](postman_collection.json) — 8 pre-canned requests with assertions; import into Postman and run individually or as a suite.

## Six chain states

| Status | Meaning |
|---|---|
| `primary` | The article IS the originating evidence. `hop_count = 0`. |
| `direct_cited` | The article links to a primary source AND the claim matches what that source says. `hop_count = 1`. |
| `indirect_cited` | Chain reaches a primary through 1+ intermediaries. `hop_count` ≥ 2. |
| `stale_cited` | A linked source exists but the claim is distorted, oversimplified, or stripped of context. |
| `circular` | Chain loops without reaching a primary. `hop_count = -1`. |
| `untraceable` | No primary surfaces. Likely assertion, opinion, or fabrication. `hop_count = -1`. |

## Authentication

Bearer tokens. Provision them with the `API_KEYS` env on the server: `API_KEYS=tok_alpha:partner_a,tok_beta:partner_b`. The string before the colon is the secret; after the colon is the public name surfaced in logs and rate-limit buckets.

```
Authorization: Bearer tok_alpha
```

When `REQUIRE_AUTH=false` (default), unauthenticated calls are allowed and attributed to the `anonymous` principal. Set `REQUIRE_AUTH=true` in production.

`/healthz` is intentionally unauthenticated so probes and load balancers work without keys.

## POST `/v1/analyze`

### Request

```json
{
  "url": "https://example.com/article",
  "title": "Article title",
  "page_text": "Plain-text body of the article (cap: 60,000 chars; longer payloads are head+tail truncated server-side).",
  "page_links": [
    {
      "href": "https://www.bls.gov/news.release/atus.t05.htm",
      "anchor_text": "U.S. Bureau of Labor Statistics",
      "near_text": "According to the U.S. Bureau of Labor Statistics, 27 percent..."
    }
  ]
}
```

All four top-level fields are required. `page_links[]` may be empty but must be present.

### Response (200)

```json
{
  "request_id": "req_4f67f25c66c6",
  "claims": [
    {
      "id": "c_cf11bd80b663",
      "text": "27 percent of U.S. employees worked from home at least one day per week in 2023.",
      "normalized": "BLS 27% remote work 2023",
      "category": "statistic",
      "importance": 1,
      "inline_link": "https://www.bls.gov/news.release/atus.t05.htm"
    }
  ],
  "chains": [
    {
      "claim_id": "c_cf11bd80b663",
      "status": "direct_cited",
      "hop_count": 1,
      "nodes": [
        {
          "url": "https://example.com/article",
          "title": "Article title",
          "publisher": "example.com",
          "type": "secondary",
          "links_to_upstream": ["https://www.bls.gov/news.release/atus.t05.htm"],
          "snippet": "..."
        },
        {
          "url": "https://www.bls.gov/news.release/atus.t05.htm",
          "title": "BLS ATUS Table 5",
          "publisher": "bls.gov",
          "type": "primary",
          "links_to_upstream": [],
          "snippet": "..."
        }
      ],
      "notes": "Article links directly to a primary BLS source."
    }
  ],
  "meta": {
    "tokens_used": 7081,
    "search_queries": 1,
    "ms": 14500
  },
  "fallback_uses": 0
}
```

`chains[i]` lines up with `claims[i]` in order; you can also match by `claim_id`. The first node is always the article itself; the last is the most upstream source the classifier could reach.

### Headers on every response

| Header | Meaning |
|---|---|
| `X-Request-Id` | Same as `request_id` in the body. Quote when reporting issues. |
| `X-Cache` | `hit` or `miss`. Cache key is `sha256(url + page_text)`; LRU 50 entries. |
| `X-RateLimit-Limit` | Burst cap for your principal. |
| `X-RateLimit-Remaining` | Tokens left in your bucket. |

### Rate limiting

Per-principal token bucket. Refills at `RATE_LIMIT_PER_MINUTE` (default 60) requests/minute, capped at `RATE_LIMIT_BURST` (default 30). When exhausted you get **429** with `Retry-After` (seconds) and a JSON body:

```json
{
  "error": "rate_limited",
  "message": "Rate limit exceeded for principal \"partner_a\". Retry in 3s.",
  "retry_after_ms": 3000
}
```

### Error envelope

All non-200 responses match:

```json
{
  "error": "invalid_request",
  "message": "page_text is required and must be non-empty",
  "request_id": "req_abc123"
}
```

| Status | `error` values |
|---|---|
| 400 | `invalid_request` |
| 401 | `missing_auth`, `invalid_token` |
| 429 | `rate_limited` |
| 500 | `missing_config`, `internal_error` |

## curl example

Cold call (no token, REQUIRE_AUTH=false):

```sh
curl -X POST http://localhost:8787/v1/analyze \
  -H 'Content-Type: application/json' \
  -d @article.json | jq '.chains[] | {status, hop_count, primary: .nodes[-1].url}'
```

With auth:

```sh
curl -X POST http://localhost:8787/v1/analyze \
  -H 'Authorization: Bearer tok_alpha' \
  -H 'Content-Type: application/json' \
  -d @article.json
```

## GET `/healthz`

```json
{
  "ok": true,
  "service": "claim-provenance-backend",
  "version": "0.1.0",
  "provider": "azure_openai",
  "has_anthropic_key": true,
  "has_azure_key": true,
  "has_tavily_key": true,
  "require_auth": false,
  "api_keys_loaded": 2,
  "cache_size": 0
}
```

Unauthenticated. Useful for health probes and ops debugging — `api_keys_loaded` confirms the env was parsed without leaking the tokens.

## Versioning

The path encodes the version. `/v1/analyze` is the contract-stable URL — any breaking change to the response shape goes in `/v2/`. The legacy `/analyze` (no `/v1/` prefix) currently aliases to the same handler for back-compat with the Chrome extension; treat it as an alias, not a separate contract.

## Latency budget

Typical 5–10 claim article: **25–40 seconds** end-to-end. Most of the time is the classifier fanning out across claims with concurrency 4. Cache hits return in **~3ms**. The false-untraceable retry roughly doubles per-claim cost on `untraceable` first-pass results, so articles dominated by fabricated-source claims (where most claims fall through to retry) trend toward the upper end of the latency band.
