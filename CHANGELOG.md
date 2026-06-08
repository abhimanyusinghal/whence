# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `LICENSE` (MIT) and license/author/repository metadata in both `package.json` files and the OpenAPI spec.
- Open-source community-health files: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  and `.github/` issue + PR templates.
- README sections: **Data & privacy**, **Security & deployment**, **Disclaimer & limitations**,
  plus a production-build note and Node 20+ requirement.
- `BLOB_CONNECTION_STRING` documented in `.env.example` (off by default).
- `.gitattributes` (LF normalization), `.nvmrc`, and `engines.node >= 20`.
- NOTICE clarifying that test fixtures are deliberately fabricated synthetic data.

### Changed
- Standardized the human-facing product name to "Claim Provenance Engine".
- `tsconfig.json` now type-checks the CLIs and eval harness (previously excluded).
- Dockerfile runs as the non-root `node` user.
- OpenAPI spec version set to `0.1.0`; `content_blocked` (422) response synced to the actual server output.

### Removed
- Internal "Provenance by Zustis" branding and the placeholder production server URL.
- Dead test-only helpers (`_resetForTesting`, `_resetBlobCache`).
- Internal go-to-market language from the public roadmap.

### Fixed
- `npm audit` advisories (transitive `qs` via express; extension `esbuild` bumped to ≥0.25).

## [0.1.0] — initial

- Backend: Express + TypeScript service that extracts claims and traces each to its primary
  source via a multi-provider web-search aggregator (Tavily / Brave / Serper / Google PSE / Bing),
  with Anthropic or Azure OpenAI as the LLM (optional content-filter fallback).
- Six-state provenance taxonomy, `/v1/analyze` versioned endpoint, OpenAPI spec, `/try` web UI.
- Chrome MV3 extension with side panel, inline highlights, and a provider Options page (BYOK).
- Self-hosted, no-auth design: bring your own keys and run it.
