/**
 * Structured JSON logging for Node.js services.
 * Zero dependencies — replaces console.log/warn/error with JSON output.
 *
 * Usage:
 *   const { logger, requestLogger } = require('./json-logger');
 *   app.use(requestLogger);           // logs every HTTP request
 *   logger.info('server started');     // structured JSON output
 */

const crypto = require('crypto');

function jsonLine(level, msg, extra = {}) {
  const entry = {
    ts: new Date().toISOString().replace(/\.\d{3}Z$/, ''),
    level,
    logger: 'app',
    msg,
    ...extra,
  };
  process.stdout.write(JSON.stringify(entry) + '\n');
}

const logger = {
  info: (msg, extra) => jsonLine('INFO', msg, extra),
  warn: (msg, extra) => jsonLine('WARNING', msg, extra),
  error: (msg, extra) => jsonLine('ERROR', msg, extra),
};

function requestLogger(req, res, next) {
  const start = Date.now();
  const requestId = req.headers['x-request-id'] || crypto.randomBytes(6).toString('hex');
  req.requestId = requestId;

  res.on('finish', () => {
    const entry = {
      ts: new Date().toISOString().replace(/\.\d{3}Z$/, ''),
      level: 'INFO',
      logger: 'http',
      msg: JSON.stringify({
        method: req.method,
        path: req.originalUrl || req.url,
        status: res.statusCode,
        duration_ms: Date.now() - start,
        request_id: requestId,
      }),
    };
    process.stdout.write(JSON.stringify(entry) + '\n');
  });

  res.setHeader('X-Request-ID', requestId);
  next();
}

module.exports = { logger, requestLogger };
