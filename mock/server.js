// mock/server.js — a tiny stand-in for BOTH roles the real proxy talks to,
// so the whole flow can be exercised end-to-end with no real credentials
// or third-party accounts:
//
//   1. the "target" upstream (TARGET_BASE_URL)      — sets a session cookie
//      on GET /app/, then requires it on POST /app/api/echo.
//   2. the "third-party widget" (THIRD_PARTY_*_BASE) — serves a static
//      asset and a /session/start endpoint that issues a token, mirroring
//      what a real embedded verification/payments widget would do.
//
// Not meant to resemble any real vendor's API — just enough shape for the
// proxy's cookie-jar and token-capture logic to have something real to do.

const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = process.env.MOCK_PORT || 4000;

function hasSessionCookie(req) {
  const raw = req.headers.cookie || '';
  return raw.includes('target-session=');
}

// ─── Simulated target upstream ────────────────────────────────────────────
app.get('/app/', (req, res) => {
  res.setHeader('Set-Cookie', `target-session=${crypto.randomBytes(8).toString('hex')}; Path=/; HttpOnly`);
  res.type('html').send('<html><body>mock target landing page</body></html>');
});

app.post('/app/api/echo', (req, res) => {
  if (!hasSessionCookie(req)) {
    return res.status(401).json({ error: 'missing target-session cookie — GET /app/ first' });
  }
  res.json({ ok: true, youSent: req.body });
});

// ─── Simulated third-party widget ─────────────────────────────────────────
app.get('/assets/widget.js', (_req, res) => {
  res.type('application/javascript').send('console.log("mock third-party widget asset loaded");');
});

app.post('/session/start', (_req, res) => {
  res.json({
    token: `mock-token-${crypto.randomBytes(12).toString('hex')}`,
    sessionId: crypto.randomUUID(),
  });
});

app.listen(PORT, () => {
  console.log(`mock upstream + third-party server on http://localhost:${PORT}`);
  console.log('  GET  /app/               → sets target-session cookie');
  console.log('  POST /app/api/echo       → requires target-session cookie');
  console.log('  GET  /assets/widget.js   → static asset stand-in');
  console.log('  POST /session/start      → issues a mock token');
});
