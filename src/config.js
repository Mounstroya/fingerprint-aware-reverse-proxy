require('dotenv').config();

function bool(v, def) {
  if (v === undefined) return def;
  return v === 'true' || v === '1';
}

const targetBaseUrl = process.env.TARGET_BASE_URL || 'https://example-target.test';
const thirdPartyPageBase = process.env.THIRD_PARTY_PAGE_BASE || 'https://onboarding.third-party-verifier.test';

module.exports = {
  port: parseInt(process.env.PORT || '3099', 10),

  targetBaseUrl,
  targetPagePath: process.env.TARGET_PAGE_PATH || '/app/',
  targetApiBase: `${targetBaseUrl}${process.env.TARGET_API_PATH || '/app/api'}`,

  thirdPartyApiBase: process.env.THIRD_PARTY_API_BASE || 'https://api.third-party-verifier.test',
  thirdPartyPageBase,
  tokenIssuingPath: process.env.TOKEN_ISSUING_PATH || '/session/start',

  userAgent: process.env.PROXY_USER_AGENT
    || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',

  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),

  cookieSecure: bool(process.env.COOKIE_SECURE, true),
  cookieDir: process.env.COOKIE_DIR || null,
  sessionTtlMs: parseInt(process.env.SESSION_TTL_MS || String(30 * 60 * 1000), 10),

  forwardHeaderAllowlist: (process.env.VERIFY_FORWARD_HEADERS || 'content-type,accept,accept-language')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),

  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '60', 10),

  maxConcurrentCurl: parseInt(process.env.MAX_CONCURRENT_CURL || '20', 10),

  logLevel: process.env.LOG_LEVEL || 'info',
};
