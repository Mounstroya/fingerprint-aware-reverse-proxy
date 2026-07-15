// sessionStore.js — server-side session registry, cookie jar lifecycle,
// and captured third-party tokens.
//
// The previous version accepted any client-supplied session id that merely
// matched a hex pattern, which is a session-fixation hole: an attacker who
// gets their own chosen sid planted in a victim's cookie jar could reuse
// it. Here `issueSid()` is the only way a sid becomes valid, and
// `isValidSid()` rejects anything the server didn't itself hand out.
//
// Cookie jars live in a dedicated 0700 directory (not the shared OS
// tmpdir) and each jar file is chmod'd 0600 after curl writes to it, so
// other local users/processes on a shared host can't read session cookies
// off disk.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const logger = require('./logger');

const COOKIE_DIR = config.cookieDir || path.join(os.tmpdir(), 'reverse-proxy-portfolio-cookies');
fs.mkdirSync(COOKIE_DIR, { recursive: true, mode: 0o700 });

const sessions = new Map(); // sid -> { createdAt, lastSeen }
const capturedTokens = new Map(); // sid -> { token, sessionId, ts }
const sidQueues = new Map(); // sid -> Promise chain, serializes curl calls sharing one cookie jar

function issueSid() {
  const sid = crypto.randomBytes(16).toString('hex');
  sessions.set(sid, { createdAt: Date.now(), lastSeen: Date.now() });
  return sid;
}

function sidFromReq(req) {
  const raw = req.headers.cookie || '';
  const m = raw.match(/proxy-sid=([a-f0-9]{32})/);
  return m ? m[1] : null;
}

function isValidSid(sid) {
  if (!sid) return false;
  const s = sessions.get(sid);
  if (!s) return false;
  if (Date.now() - s.lastSeen > config.sessionTtlMs) {
    destroySession(sid);
    return false;
  }
  s.lastSeen = Date.now();
  return true;
}

function destroySession(sid) {
  sessions.delete(sid);
  capturedTokens.delete(sid);
  try { fs.unlinkSync(cookieFile(sid)); } catch (_) { /* never had one */ }
}

function cookieFile(sid) {
  return path.join(COOKIE_DIR, `${sid}.jar`);
}

function secureCookieFile(sid) {
  try { fs.chmodSync(cookieFile(sid), 0o600); } catch (_) { /* jar not created (no cookies set) */ }
}

// Serializes curl invocations that share the same on-disk cookie jar.
// curl reads the whole jar, then rewrites it on exit — two concurrent
// requests for the same session race and one silently loses its update.
function withSidLock(sid, fn) {
  const prev = sidQueues.get(sid) || Promise.resolve();
  const next = prev.then(fn, fn).finally(() => {
    if (sidQueues.get(sid) === next) sidQueues.delete(sid);
  });
  sidQueues.set(sid, next);
  return next;
}

function captureToken(sid, { token, sessionId }) {
  capturedTokens.set(sid, { token, sessionId: sessionId || null, ts: Date.now() });
}

function getCapturedToken(sid) {
  return capturedTokens.get(sid) || null;
}

function cleanup() {
  const now = Date.now();
  for (const [sid, s] of sessions) {
    if (now - s.lastSeen > config.sessionTtlMs) destroySession(sid);
  }
  try {
    for (const f of fs.readdirSync(COOKIE_DIR)) {
      const full = path.join(COOKIE_DIR, f);
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs > config.sessionTtlMs) fs.unlinkSync(full);
    }
  } catch (err) {
    logger.warn({ err }, 'cookie jar cleanup failed');
  }
}

let cleanupTimer = null;
function startCleanupTimer() {
  const interval = Math.min(config.sessionTtlMs, 5 * 60 * 1000);
  cleanupTimer = setInterval(cleanup, interval);
  cleanupTimer.unref();
}
function stopCleanupTimer() {
  if (cleanupTimer) clearInterval(cleanupTimer);
}

module.exports = {
  issueSid,
  sidFromReq,
  isValidSid,
  destroySession,
  cookieFile,
  secureCookieFile,
  withSidLock,
  captureToken,
  getCapturedToken,
  startCleanupTimer,
  stopCleanupTimer,
};
