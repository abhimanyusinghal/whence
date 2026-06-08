# Security Policy

## Reporting a vulnerability

**Please do not report security issues in public GitHub issues.**

Instead, use GitHub's private vulnerability reporting:
**Security → Report a vulnerability** on this repository
(<https://github.com/abhimanyusinghal/claim/security/advisories/new>).

Include reproduction steps and the affected component (backend or extension). You can expect an
acknowledgement and, where applicable, a fix or mitigation plan.

## Scope notes for self-hosters

This is a self-hosted tool. A few things are worth understanding about its security model:

- **The backend has no authentication or rate limiting by design.** `/analyze` and
  `/v1/analyze` are unauthenticated and spend your provider budget on every call. Do not expose
  the backend directly on the public internet — run it on localhost or behind your own
  reverse proxy / auth / rate limiting. See the README "Security & deployment" section.
- **Provider keys.** Keys live in your `.env` (server-side) or are passed per request as BYOK
  (`search_options.byok`). Keep `.env` out of version control (it is gitignored). BYOK keys are
  used in-memory for the request and are not persisted.
- **Logging.** By default, each analyzed claim + chain (with URL/title/provenance) is appended
  to `./data/chains.jsonl`, and request logs go to stderr. Disable chain logging by setting
  `CHAINS_LOG_FILE=` empty. If `BLOB_CONNECTION_STRING` is set, chains are uploaded to your
  Azure Blob Storage instead.

If you find a way that the software leaks keys or data beyond what is documented above, that is a
vulnerability — please report it via the channel above.
