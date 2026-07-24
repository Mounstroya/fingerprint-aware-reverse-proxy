# fingerprint-aware-reverse-proxy

[![CI](https://github.com/Mounstroya/fingerprint-aware-reverse-proxy/actions/workflows/ci.yml/badge.svg)](https://github.com/Mounstroya/fingerprint-aware-reverse-proxy/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

A curl-based Node.js/Express reverse proxy for fronting a browser flow
against an upstream API protected by WAF/TLS fingerprinting, while
transparently relaying an embedded third-party widget (identity
verification, payments, etc.) and capturing the session token it issues.

Generalized and sanitized from a proxy originally built for an authorized
security/integration engagement for a telecom client — all hostnames,
brand names, and vendor-specific API paths were replaced with placeholders
and moved to configuration. This repo demonstrates the architecture and
technique, not a working exploit against any real service.

## Highlights

- **Evades naive WAF/TLS fingerprinting** by shelling out to `curl`
  instead of using Node's HTTP client, so outbound requests reproduce a
  real browser's TLS handshake and header shape.
- **Session-safe under concurrency** — per-session cookie jars live in a
  dedicated `0700` directory and writes to the same jar are serialized,
  closing a real race condition where two concurrent requests from one
  session could clobber each other's cookies.
- **Closes session fixation** — only sids the server itself issued are
  accepted; a client can't plant its own.
- **Binary-safe proxying** — response bodies are written to a temp file
  via curl's `-o`, with status/content-type read back on a separate
  stream, so binary assets can't be corrupted by string decoding and a
  body that happens to contain a delimiter-like byte sequence can't
  desync parsing.
- **Bounded process concurrency** — every curl call is a real OS process;
  a shared limiter caps how many run at once so a traffic burst can't
  exhaust file descriptors.
- **Runnable in under a minute** — a bundled mock server stands in for
  both the upstream and the third-party widget, so the whole flow is
  provable with zero real credentials (see below).

## Try it in under a minute

`mock/server.js` plays both the upstream target and the third-party
widget, so you can run the full flow with nothing real behind it.

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

`npm run demo` drives all five steps end-to-end and prints each response:

```
1) /target-warmup — issues a proxy session and primes the upstream cookie jar
{"ok":true}

2) POST /target-api/echo — reuses the jar's upstream cookie through the proxy
{"ok":true,"youSent":{"hello":"world"}}

3) POST /verify-api/session/start — relays to the third-party widget and captures its token
{"token":"mock-token-...","sessionId":"..."}

4) GET /verify-tokens/me — reads back the captured token (only valid for this session's cookie)
{"ok":true,"token":"mock-token-...","sessionId":"...","ts":...}

5) sanity check — the same call WITHOUT the session cookie must be rejected
status: 401
```

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
mock/server.js      stand-in upstream + third-party widget for local testing
scripts/demo.sh      curl walkthrough of the full flow
```

## Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/health` | GET | liveness check |
| `/target-warmup` | GET | issues a proxy session, primes the upstream cookie jar |
| `/target-api/*` | POST | proxies to `TARGET_API_BASE`, reusing the session's cookie jar |
| `/assets/*` | GET | static asset relay for an embedded third-party widget |
| `/verify-api/*` | ALL | transparent relay to `THIRD_PARTY_API_BASE`, captures the token issued at `TOKEN_ISSUING_PATH` |
| `/verify-tokens/me` | GET | returns the captured token for the caller's own session only |

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

---

## ☕ Was it useful?

If this project saved you some time, you can buy me a coffee:

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-mounstroya-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/mounstroya)
