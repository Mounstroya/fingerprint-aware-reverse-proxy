// app.js — Express app wiring. Exports a factory (createApp) rather than
// a top-level instance so tests can spin up isolated instances without
// binding a real port at import time.

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');
const crypto = require('crypto');

const config = require('./config');
const logger = require('./logger');
const { execCurl } = require('./curl');
const session = require('./sessionStore');

function createApp() {
  const app = express();

  app.use(pinoHttp({
    logger,
    genReqId: (req) => req.headers['x-request-id'] || crypto.randomUUID(),
  }));

  // /verify-api/* parses its own raw body below to preserve binary payloads.
  app.use((req, res, next) => {
    if (req.path.startsWith('/verify-api/')) return next();
    express.json()(req, res, next);
  });

  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // same-origin, curl, server-to-server
      if (config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error('origin_not_allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-XSRF-TOKEN'],
  }));
  app.options('*', cors());

  app.use(rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
  }));

  app.get('/health', (_req, res) => res.json({ status: 'ok', proxy: 'reverse-proxy-portfolio', version: '2.0' }));

  function requireSession(req, res, next) {
    const sid = session.sidFromReq(req);
    if (!session.isValidSid(sid)) {
      return res.status(401).json({ error: 'No valid session — call /target-warmup first' });
    }
    req.sid = sid;
    req.log = req.log.child({ sid });
    next();
  }

  function setSidCookie(res, sid) {
    const flags = ['Path=/', 'HttpOnly', 'SameSite=Strict'];
    if (config.cookieSecure) flags.push('Secure');
    res.setHeader('Set-Cookie', `proxy-sid=${sid}; ${flags.join('; ')}`);
  }

  const commonTargetHeaders = () => [
    `Origin: ${config.targetBaseUrl}`,
    `Referer: ${config.targetBaseUrl}${config.targetPagePath}`,
    `User-Agent: ${config.userAgent}`,
    'Accept-Language: es-MX,es;q=0.9,en;q=0.8',
    'sec-fetch-site: same-origin',
    'sec-fetch-mode: cors',
    'sec-fetch-dest: empty',
  ];

  // ─── Warmup: prime the upstream session before the SPA calls the API ──────
  app.get('/target-warmup', async (req, res) => {
    let sid = session.sidFromReq(req);
    if (!session.isValidSid(sid)) sid = session.issueSid();

    try {
      await session.withSidLock(sid, () => execCurl({
        method: 'GET',
        url: `${config.targetBaseUrl}${config.targetPagePath}`,
        cookieJar: session.cookieFile(sid),
        headers: [
          'Accept: text/html,application/xhtml+xml,*/*;q=0.8',
          `User-Agent: ${config.userAgent}`,
          'Accept-Language: es-MX,es;q=0.9',
          'sec-fetch-site: none',
          'sec-fetch-mode: navigate',
          'sec-fetch-dest: document',
        ],
      }));
      session.secureCookieFile(sid);
      setSidCookie(res, sid);
      req.log.info('warmup ok');
      res.json({ ok: true });
    } catch (err) {
      req.log.error({ err }, 'warmup failed');
      res.status(502).json({ ok: false, error: err.message });
    }
  });

  // ─── API proxy: forwards via curl, reusing the session's cookie jar ──────
  app.post('/target-api/*', requireSession, async (req, res) => {
    const targetPath = req.path.replace(/^\/target-api/, '');
    const targetUrl = `${config.targetApiBase}${targetPath}`;
    const xsrf = req.headers['x-xsrf-token'];
    const headers = [...commonTargetHeaders(), 'Accept: application/json, text/plain, */*'];
    if (xsrf) headers.push(`X-XSRF-TOKEN: ${xsrf}`);

    try {
      const result = await session.withSidLock(req.sid, () => execCurl({
        method: 'POST',
        url: targetUrl,
        headers,
        body: req.body,
        cookieJar: session.cookieFile(req.sid),
      }));
      session.secureCookieFile(req.sid);
      res.status(result.status).type(result.contentType).send(result.body);
    } catch (err) {
      req.log.error({ err }, 'target-api error');
      res.status(502).json({ error: 'Proxy error', detail: err.message });
    }
  });

  // ─── Static asset relay for an embedded third-party widget ───────────────
  app.get('/assets/*', async (req, res) => {
    const qs = Object.keys(req.query).length ? `?${new URLSearchParams(req.query)}` : '';
    try {
      const result = await execCurl({
        method: 'GET',
        url: `${config.thirdPartyPageBase}${req.path}${qs}`,
        headers: [
          `User-Agent: ${req.headers['user-agent'] || config.userAgent}`,
          `Referer: ${config.thirdPartyPageBase}/`,
        ],
        followRedirects: true,
      });
      res.status(result.status).type(result.contentType).send(result.body);
    } catch (err) {
      req.log.error({ err }, 'asset relay error');
      res.status(502).send('CDN error');
    }
  });

  // ─── Generic transparent relay + token capture ─────────────────────────────
  // Demonstrates: proxy an embedded third-party widget's own API traffic,
  // watch for the call that issues its session token, and store that token
  // tied to *our* session id so only the owning browser session can read it
  // back (see /verify-tokens/me below).
  app.use(
    '/verify-api/*',
    express.raw({ type: '*/*', limit: '20mb' }),
    requireSession,
    async (req, res) => {
      const apiPath = req.path.replace(/^\/verify-api/, '');
      const qs = Object.keys(req.query).length ? `?${new URLSearchParams(req.query).toString()}` : '';
      const targetUrl = `${config.thirdPartyApiBase}${apiPath}${qs}`;

      const headers = [];
      for (const [k, v] of Object.entries(req.headers)) {
        const lk = k.toLowerCase();
        if (lk === 'cookie') continue; // never leak our session cookie upstream
        if (config.forwardHeaderAllowlist.includes(lk)) headers.push(`${k}: ${v}`);
      }

      try {
        const result = await execCurl({
          method: req.method,
          url: targetUrl,
          headers,
          body: req.body && req.body.length > 0 ? req.body : undefined,
          maxBuffer: 20 * 1024 * 1024,
          timeout: 30000,
        });

        if (apiPath === config.tokenIssuingPath && result.status === 200) {
          try {
            const parsed = JSON.parse(result.body.toString('utf8'));
            if (parsed.token) {
              session.captureToken(req.sid, { token: parsed.token, sessionId: parsed.sessionId || parsed.id });
              req.log.info('third-party token captured');
            }
          } catch (_) { /* not JSON, nothing to capture */ }
        }

        res.status(result.status).type(result.contentType).send(result.body);
      } catch (err) {
        req.log.error({ err }, 'verify-api error');
        res.status(502).json({ error: err.message });
      }
    },
  );

  // Only the owning session can read back its own captured token —
  // the earlier version exposed an unauthenticated listing of every
  // captured token for every session (IDOR).
  app.get('/verify-tokens/me', requireSession, (req, res) => {
    const t = session.getCapturedToken(req.sid);
    if (!t) return res.status(404).json({ error: 'Token not captured yet' });
    res.json({ ok: true, ...t });
  });

  app.use((err, req, res, _next) => {
    if (err && err.message === 'origin_not_allowed') {
      return res.status(403).json({ error: 'Origin not allowed by CORS policy' });
    }
    (req.log || logger).error({ err }, 'unhandled error');
    res.status(500).json({ error: 'Internal error' });
  });

  return app;
}

module.exports = { createApp };
