// curl.js — shared curl invocation helper.
//
// Body is always written to a temp file via `-o` and status/content-type
// are read from `-w` on a *separate* stdout stream, instead of mixing a
// text delimiter into the same stream as the response body. That avoids
// two real bugs: (1) binary responses getting corrupted by UTF-8 decoding
// when read as a JS string, and (2) the delimiter pattern accidentally
// matching bytes that happen to appear inside the response body itself.
//
// Concurrency is capped globally (MAX_CONCURRENT_CURL) since each call
// spawns a real OS process — without a cap, traffic bursts can exhaust
// the process/file-descriptor table.

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const pLimit = require('p-limit');
const config = require('./config');

const limit = pLimit(config.maxConcurrentCurl);

function rawExecCurl({
  method = 'GET',
  url,
  headers = [],
  body,
  cookieJar,
  timeout = 15000,
  maxBuffer = 10 * 1024 * 1024,
  followRedirects = false,
}) {
  return new Promise((resolve, reject) => {
    const tmpOut = path.join(os.tmpdir(), `curlout_${crypto.randomBytes(8).toString('hex')}.bin`);
    const finalHeaders = [...headers];

    let stdinData = null;
    if (Buffer.isBuffer(body)) {
      stdinData = body;
    } else if (body !== undefined && body !== null) {
      if (!finalHeaders.some((h) => /^content-type:/i.test(h))) {
        finalHeaders.push('Content-Type: application/json');
      }
      stdinData = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    }

    const args = ['-s', '-X', method, '-o', tmpOut, '-w', '%{http_code} %{content_type}', '--compressed'];
    if (followRedirects) args.push('-L', '--proto-redir', 'https');
    if (cookieJar) args.push('-b', cookieJar, '-c', cookieJar);
    finalHeaders.forEach((h) => args.push('-H', h));
    if (stdinData) args.push('--data-binary', '@-');
    args.push(url);

    const child = execFile('curl', args, { timeout, maxBuffer }, (err, stdout) => {
      let bodyBuf = Buffer.alloc(0);
      try { bodyBuf = fs.readFileSync(tmpOut); } catch (_) { /* curl produced no output file */ }
      try { fs.unlinkSync(tmpOut); } catch (_) { /* already gone */ }

      if (err) return reject(err);

      const meta = stdout.toString().trim();
      const spaceIdx = meta.indexOf(' ');
      const status = parseInt(spaceIdx === -1 ? meta : meta.slice(0, spaceIdx), 10) || 0;
      const contentType = (spaceIdx === -1 ? '' : meta.slice(spaceIdx + 1)).split(';')[0].trim()
        || 'application/octet-stream';

      resolve({ status, contentType, body: bodyBuf });
    });

    if (child.stdin) {
      // curl may exit (e.g. connection refused) before we finish writing —
      // without this handler that EPIPE would be an uncaught exception and
      // take down the whole process, not just this one request.
      child.stdin.on('error', () => {});
      if (stdinData) child.stdin.write(stdinData);
      child.stdin.end();
    }
  });
}

function execCurl(opts) {
  return limit(() => rawExecCurl(opts));
}

module.exports = { execCurl };
