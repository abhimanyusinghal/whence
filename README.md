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

## Layout

```
backend/   Node + Express + TypeScript service. /analyze pipeline.
extension/ Chrome MV3 extension (added in later step).
scripts/   dev helpers.
```
