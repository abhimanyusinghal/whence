# Contributing

Thanks for your interest in the Claim Provenance Engine. Contributions of all
kinds are welcome — bug reports, fixes, docs, new search providers, eval data.

## Development setup

Requires **Node.js 20+**.

```sh
git clone https://github.com/abhimanyusinghal/whence
cd claim
cp .env.example .env        # add at least one LLM key + one search-provider key

# Backend
cd backend
npm install
npm run dev                 # http://localhost:8787 (auto-reload via tsx)

# Extension (separate package)
cd ../extension
npm install
npm run build               # outputs extension/dist (load unpacked in Chrome)
```

## Before you open a PR

Run both checks locally — they are the project's quality gate (no CI is required to pass yet,
but keep them green):

```sh
cd backend  && npm run typecheck && npm run build
cd extension && npm run typecheck && npm run build
```

- Keep changes focused; one logical change per PR.
- Match the surrounding code style (TypeScript strict mode, no `any` on public surfaces).
- Update `Docs/API.md` and `backend/openapi.yaml` together when you change the API contract.
- If you add a search provider, implement the `SearchProvider` interface in
  `backend/src/search/`, register it in the aggregator, and document its env var in
  `.env.example` and the README provider table.
- Don't commit secrets, real `.env` files, build artifacts (`dist/`), or logs (`*.jsonl`).

## Reporting bugs / requesting features

Use the GitHub issue templates. For anything security-sensitive, **do not** open a public
issue — see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the project's
[MIT License](LICENSE).
