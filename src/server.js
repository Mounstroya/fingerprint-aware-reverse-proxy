const { execFile } = require('child_process');
const { createApp } = require('./app');
const config = require('./config');
const logger = require('./logger');
const session = require('./sessionStore');

const app = createApp();
session.startCleanupTimer();

const server = app.listen(config.port, () => {
  logger.info(`reverse-proxy-portfolio listening on http://localhost:${config.port}`);
  execFile('curl', ['--version'], (err) => {
    if (err) logger.warn('curl not found on PATH — the proxy cannot function without it');
  });
});

function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  session.stopCleanupTimer();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = server;
