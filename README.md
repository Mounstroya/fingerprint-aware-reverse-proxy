# fingerprint-aware-reverse-proxy

A curl-based Node.js/Express reverse proxy built to solve a real-world
problem: fronting a browser-based flow against an upstream API protected by
WAF/TLS fingerprinting, while transparently relaying an embedded third-party
widget (identity verification, payments, etc.) and its own authentication
handshake.

This is a **generalized, sanitized version** of a proxy originally built for
an authorized security/integration engagement. All hostnames, brand names,
and vendor-specific API paths have been replaced with placeholders and moved
to configuration — this repo demonstrates the architecture and technique,
not a working exploit against any real service.

## What it demonstrates

- **WAF/TLS-fingerprint-aware proxying** — outbound requests are made with
  `curl` instead of a Node HTTP client (`fetch`/`axios`), because some
  upstream WAFs fingerprint clients by TLS handshake shape and header
  order/casing, which Node's HTTP stack doesn't reproduce the way a real
  browser or `curl` does.
- **Per-session cookie jar management** — each browser session gets its own
  on-disk cookie jar (in a dedicated `0700` directory, not the shared OS
  tmpdir), with writes to the same jar serialized so concurrent requests
  from one session can't race and clobber each other's cookies.
- **Server-issued session identifiers** — the proxy is the only party that
  can mint a valid session id; a client-supplied id that the server never
  issued is rejected rather than silently accepted (avoids session
  fixation).
- **Third-party widget relay + token capture** — a generic pattern for
  transparently proxying an embedded third-party widget's traffic while
  watching for the call that issues its session token, storing that token
  tied to the owning proxy session so only that session can read it back.
- **Binary-safe, delimiter-free response handling** — curl writes each
  response body to a temp file (`-o`) and status/content-type come back on
  a separate stream (`-w`), so binary assets never get mangled by string
  decoding and a body that happens to contain delimiter-like bytes can't
  corrupt parsing.
- **Bounded concurrency** — every curl invocation is a real OS process;
  calls are capped through a shared limiter so a traffic burst can't
  exhaust the process/file-descriptor table.
- **Origin allowlisting** — CORS is opt-in per origin via config, not a
  reflected wildcard with credentials enabled.

## Architecture

```
Browser ── /target-warmup ──────────► app ── curl (cookie jar, locked per sid) ──► TARGET_API_BASE
Browser ── /target-api/*   ──────────► app ── curl (cookie jar, locked per sid) ──► TARGET_API_BASE
Browser ── /verify-api/*   ──────────► app ── curl (header allowlist)          ──► THIRD_PARTY_API_BASE
                                          │
                                          └─ watches TOKEN_ISSUING_PATH,
                                             stores { sid → token } (owner-only read)
```

```
src/
  config.js        env-driven configuration
  logger.js        structured logging (pino)
  curl.js          shared curl invocation helper (binary-safe, concurrency-limited)
  sessionStore.js  session registry, cookie jar lifecycle, captured tokens
  app.js           Express app / routes (factory, for testability)
  server.js        entry point: listen + graceful shutdown
```

## Try it end-to-end (no real target needed)

`mock/server.js` stands in for both the upstream target and the
third-party widget, so you can exercise the whole flow — warmup, cookie
reuse, token capture, ownership check — without pointing at anything real.

```bash
npm install

# terminal 1
npm run mock

# terminal 2
cp .env.mock.example .env
npm start

# terminal 3
npm run demo
```

`scripts/demo.sh` walks through: `/target-warmup` → `/target-api/echo`
(reusing the upstream cookie the warmup call obtained) → `/verify-api/session/start`
(captures a token from the mock widget) → `/verify-tokens/me` (reads the
token back, then confirms the same call without the session cookie is
rejected).

## Setup against a real target

```bash
cp .env.example .env   # point at your own upstream/third-party test targets
npm install
npm start
```

Or via Docker:

```bash
docker compose up --build
```

## Development

```bash
npm run lint
npm test
```

CI (`.github/workflows/ci.yml`) runs lint + tests on every push/PR.

## Why this exists

Built while doing integration/security work for a telecom client's identity
verification flow. The original version was carrier- and vendor-specific;
this repo strips that out and hardens the pieces that mattered — session
handling, CORS, and process/IO robustness — to keep only the reusable
engineering pattern.

## Disclaimer

For educational and authorized-testing use only. Point it at systems you
own or have explicit authorization to test.
