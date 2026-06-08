# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.1.0] — 2026-06-09

Initial public release.

### Core

- Backend: Express + TypeScript service that extracts claims and traces each to its primary
  source via a multi-provider web-search aggregator (Tavily / Brave / Serper / Google PSE / Bing),
  with Anthropic or Azure OpenAI as the LLM (optional content-filter fallback).
- Six-state provenance taxonomy, `/v1/analyze` versioned endpoint, OpenAPI spec, `/try` web UI.
- Chrome MV3 extension with side panel, inline highlights, and a provider Options page (BYOK).
- Self-hosted, no-auth design: bring your own keys and run it (no login, rate limiting, or metering).

### Release readiness

- Added MIT `LICENSE` + license/author/repository metadata in both `package.json` files and the OpenAPI spec.
- Added community-health files: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `.github/` templates.
- Added README **Data & privacy**, **Security & deployment**, and **Disclaimer & limitations** sections;
  documented `BLOB_CONNECTION_STRING` (off by default) in `.env.example`.
- Added `.gitattributes` (LF normalization), `.nvmrc`, `engines.node >= 20`, and a NOTICE marking the
  test fixtures as deliberately fabricated synthetic data.
- Standardized the product name to "Claim Provenance Engine"; removed internal branding and the
  placeholder production server URL; removed dead test-only helpers.
- `tsconfig` now type-checks the CLIs and eval harness; `npm audit` clean (qs/express, esbuild ≥0.25);
  Dockerfile runs as the non-root `node` user.
