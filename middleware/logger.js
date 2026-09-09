// Nestora Structured Logging & Request ID Middleware — Phase 5: Startup Essentials.
// Assigns a unique correlation ID to every incoming HTTP request and logs structured access metrics.

const crypto = require("crypto");

/**
 * Middleware that generates an X-Request-Id header and logs structured request details.
 */
function requestLogger(req, res, next) {
  const requestId = req.headers["x-request-id"] || crypto.randomUUID();
  req.id = requestId;
  res.setHeader("X-Request-Id", requestId);

  const start = Date.now();

  res.on("finish", () => {
    // Skip static asset logging to prevent noisy logs
    if (
      req.path.startsWith("/css") ||
      req.path.startsWith("/js") ||
      req.path.startsWith("/images") ||
      req.path === "/favicon.ico"
    ) {
      return;
    }

    const duration = Date.now() - start;
    const logData = {
      timestamp: new Date().toISOString(),
      requestId,
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: duration,
      ip: req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "127.0.0.1",
      userId: req.user ? req.user._id : null,
      role: req.user ? req.user.role : "anonymous",
    };

    if (process.env.NODE_ENV !== "test") {
      console.log(JSON.stringify(logData));
    }
  });

  next();
}

module.exports = {
  requestLogger,
};
