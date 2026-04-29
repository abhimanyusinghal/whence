# Claim Provenance Engine

Chrome extension + Node backend that traces claims in articles back to their original sources.
Output is a chain-of-custody, not a true/false verdict. Status taxonomy:
`primary`, `direct_cited`, `indirect_cited`, `stale_cited`, `circular`, `untraceable`.

## Setup

```
cp .env.example .env       # fill in ANTHROPIC_API_KEY and TAVILY_API_KEY
cd backend && npm install
npm run dev                # starts on http://localhost:8787
```

Health check: `curl http://localhost:8787/healthz`

## Docs

- [Docs/API.md](Docs/API.md) — `POST /v1/analyze` reference, six-state taxonomy, auth, rate limits.
- [backend/openapi.yaml](backend/openapi.yaml) — machine-readable spec; also served live at `/v1/openapi.yaml`.
- [Docs/Roadmap.md](Docs/Roadmap.md) — what's shipped, what's next.

## Layout

```
backend/   Node + Express + TypeScript service. /analyze + /v1/analyze.
extension/ Chrome MV3 extension.
Docs/      Roadmap, API reference.
scripts/   dev helpers.
```
